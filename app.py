import logging
import math
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from functools import wraps

import pytz
import joblib
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pymongo import ReturnDocument
from werkzeug.security import check_password_hash

from db import (
    admins_collection,
    db,
    sessions_collection,
    slots_collection,
    vehicles_collection,
)

app = Flask(__name__)
app.logger.setLevel(logging.INFO)
logging.basicConfig(level=logging.INFO)

app.config["SECRET_KEY"] = os.environ.get(
    "SECRET_KEY", "dev-smart-parking-secret-change-me"
)

CORS(app)

gate_state_collection = db["gate_state"]
IST = pytz.timezone("Asia/Kolkata")

@app.route("/")
@app.route("/user")
def user_page():
    return render_template("user.html")

@app.route("/entry")
def entry_page():
    return render_template("entry.html")

@app.route("/user-history")
def user_history_page():
    return render_template("user-history.html")


@app.route("/gate")
def gate_page():
    return render_template("gate.html")

@app.route("/admin")
def admin_home():
    return render_template("admin/home.html")

@app.route("/admin/login")
def admin_login():
    return render_template("admin/login.html")

@app.route("/admin/history")
def admin_history():
    return render_template("admin/history.html")

@app.route("/admin/statistics")
@app.route("/admin/stats")
def admin_statistics():
    return render_template("admin/statistics.html")


TOKEN_TTL_SECONDS = 24 * 3600


def _token_serializer():
    return URLSafeTimedSerializer(app.config["SECRET_KEY"], salt="smart-parking-admin-v1")


def create_admin_token(username, role):
    return _token_serializer().dumps({"u": username, "r": role})


def verify_admin_token(token):
    if not token:
        return None
    try:
        data = _token_serializer().loads(token, max_age=TOKEN_TTL_SECONDS)
        return {"username": data["u"], "role": data.get("r", "admin")}
    except (BadSignature, SignatureExpired):
        return None


# -----------------------------
# HELPERS
# -----------------------------
def normalize_type(vtype):
    return str(vtype).strip().lower()


def normalize_vehicle_no(vno):
    return (str(vno or "").strip().upper())


def _safe_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _iso(dt):
    if isinstance(dt, datetime):
        # Normalize to UTC for consistent frontend parsing.
        # MongoDB typically stores tz-aware datetimes as UTC naive; treat naive as UTC.
        if dt.tzinfo is None:
            dt = pytz.UTC.localize(dt)
        dt_utc = dt.astimezone(pytz.UTC).replace(microsecond=0)
        # Use trailing `Z` to match common ISO-8601 expectations.
        return dt_utc.isoformat().replace("+00:00", "Z")
    return None


def _norm_slot_id(value):
    """Match slot_id across slots vs sessions (int vs str from Mongo / legacy data)."""
    if value is None:
        return None
    return str(value).strip()


def _parse_slot_parts(slot_id):
    """
    Parse slot patterns like G2-14 into (level='G2', number=14).
    Returns (None, None) on parse failure.
    """
    slot_txt = _norm_slot_id(slot_id)
    if not slot_txt:
        return None, None
    m = re.match(r"^([A-Za-z0-9]+)-(\d+)$", slot_txt)
    if not m:
        return None, None
    return m.group(1), int(m.group(2))


def _allowed_minutes(session):
    base = int(session.get("base_duration_minutes", 120))
    ext = int(session.get("extended_minutes", 0))
    return max(base + ext, 0)


def _get_vehicle_profile(vehicle_no):
    return vehicles_collection.find_one({"vehicle_no": vehicle_no}) or {}


def _verify_admin_password(admin_doc, password_plain):
    if not password_plain:
        return False
    ph = admin_doc.get("password_hash") or admin_doc.get("hash")
    if ph:
        if isinstance(ph, str) and ph.startswith("$2"):
            try:
                import bcrypt

                return bcrypt.checkpw(
                    password_plain.encode("utf-8"), ph.encode("utf-8")
                )
            except Exception:
                return False
        try:
            return check_password_hash(ph, password_plain)
        except Exception:
            return False
    plain = admin_doc.get("password")
    return plain == password_plain


def _get_bearer_token():
    auth = request.headers.get("Authorization", "") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def require_admin(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        token = _get_bearer_token()
        if not token:
            app.logger.warning("admin: missing bearer token | path=%s", request.path)
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        user = verify_admin_token(token)
        if not user:
            app.logger.warning("admin: invalid or expired token | path=%s", request.path)
            return jsonify({"success": False, "message": "Session expired or invalid"}), 401
        return f(*args, **kwargs)

    return wrapped


def _slot_counts():
    """Single source of truth: slots collection only."""
    total = slots_collection.count_documents({})
    occupied = slots_collection.count_documents({"status": "occupied"})
    available = total - occupied
    return total, available, occupied


def _normalize_confidence(confidence):
    """
    Normalize ML confidence into [0, 1].
    - If confidence comes in as percent (> 1), divide by 100.
    - Clamp to [0, 1].
    """
    confidence = float(confidence)
    if confidence > 1:
        confidence = confidence / 100.0
    return max(0.0, min(confidence, 1.0))


def _ensure_ist(dt):
    """
    Ensure a datetime is timezone-aware in Asia/Kolkata.
    - If dt is naive, localize it to IST.
    - If dt is aware, convert to IST.
    """
    if not isinstance(dt, datetime):
        return dt
    if dt.tzinfo is None:
        # Treat naive datetimes as UTC (common when stored by MongoDB).
        return pytz.UTC.localize(dt).astimezone(IST)
    return dt.astimezone(IST)


def _safe_model_load():
    model_path = os.path.join(os.getcwd(), "model.pkl")
    try:
        if os.path.exists(model_path):
            model_obj = joblib.load(model_path)
            app.logger.info("ML model loaded from %s", model_path)
            return model_obj
    except Exception:
        app.logger.exception("ML model loading failed")
    app.logger.warning("ML model unavailable; APIs will use fallback logic")
    return None


model = _safe_model_load()
vehicle_map = {"bike": 0, "car": 1, "heavy": 2}


def _ml_predict(hour, day_of_week, vehicle_type):
    is_weekend = 1 if day_of_week >= 5 else 0
    vtype = vehicle_map.get(normalize_type(vehicle_type), 1)
    if model is None:
        # Fallback heuristic when model is missing.
        peak = 1 if hour in {8, 9, 10, 17, 18, 19, 20} else 0
        confidence = 0.62 if peak else 0.58
        return peak, _normalize_confidence(confidence)

    x = [[int(hour), int(day_of_week), int(is_weekend), int(vtype)]]
    prediction = int(model.predict(x)[0])
    confidence = float(max(model.predict_proba(x)[0]))
    return prediction, _normalize_confidence(confidence)


def _recommend_slot(vehicle_no, vehicle_type):
    vtype = normalize_type(vehicle_type)
    vehicle_profile = _get_vehicle_profile(vehicle_no)
    preferred_level = str(vehicle_profile.get("preferred_level", "") or "").strip()

    total_slots = list(
        slots_collection.find(
            {"vehicle_type_allowed": {"$regex": f"^{re.escape(vtype)}$", "$options": "i"}},
            {"_id": 0, "slot_id": 1, "level": 1, "status": 1},
        )
    )
    if not total_slots:
        return None

    grouped_total = defaultdict(list)
    grouped_free = defaultdict(list)
    slot_status_map = {}
    for s in total_slots:
        level = str(s.get("level", "")).strip()
        grouped_total[level].append(s)
        sid = _norm_slot_id(s.get("slot_id"))
        status = str(s.get("status", "")).lower()
        if sid:
            slot_status_map[sid] = status
        if status == "available":
            grouped_free[level].append(s)

    now = datetime.now(IST)
    pred, conf = _ml_predict(now.hour, now.weekday(), vtype)
    # ML-aware normalization: lower confidence in peak implies stronger low-traffic bonus.
    low_traffic_bonus = max(0.0, min(1.0, 1.0 - float(conf)))

    # Collect all available-slot candidates, then pick the top ones by score.
    # This enables returning alternatives without changing the meaning of best_slot.
    candidate_slots = []

    for level, all_slots in grouped_total.items():
        free_slots = grouped_free.get(level, [])
        if not free_slots:
            continue
        free_slots_ratio = len(free_slots) / max(len(all_slots), 1)
        historical_pref = 1.0 if preferred_level and preferred_level == level else 0.0

        for slot in free_slots:
            slot_id = _norm_slot_id(slot.get("slot_id"))
            if not slot_id:
                continue
            _, slot_number = _parse_slot_parts(slot_id)

            # Local congestion around this slot (neighbors +/-1 in same level).
            neighbor_statuses = []
            if slot_number is not None:
                for neighbor in (slot_number - 1, slot_number + 1):
                    if neighbor <= 0:
                        continue
                    neighbor_slot_id = f"{level}-{neighbor}"
                    n_status = slot_status_map.get(neighbor_slot_id)
                    if n_status:
                        neighbor_statuses.append(n_status)
            occupied_neighbors = sum(1 for n in neighbor_statuses if n == "occupied")
            total_neighbors = len(neighbor_statuses)
            if total_neighbors == 0:
                local_congestion_score = 1.0
            else:
                local_congestion_score = max(
                    0.0, min(1.0, 1.0 - (occupied_neighbors / total_neighbors))
                )

            # Slot number proximity score — lower slot number = closer to entry = better
            if slot_number is not None:
                proximity_score = max(0.05, 1.0 - ((slot_number - 1) / 20))
            else:
                proximity_score = 0.5
            
            # Level priority — G1 before G2 for cars
            level_num = 0
            try:
                level_num = int(level[1:]) if level and level[0].upper() == 'G' else 0
            except Exception:
                level_num = 0
            level_priority = max(0.0, 1.0 - (level_num * 0.2))
            score = (
                (free_slots_ratio       * 0.20)
                 + (low_traffic_bonus    * 0.10)
                 + (historical_pref      * 0.10)
                 + (local_congestion_score * 0.05)
                 + (proximity_score      * 0.30)
                 + (level_priority       * 0.25)
            )

            reasons = []
            if slot_number is not None and slot_number <= 5:
                reasons.append("Closest to entry point")
            elif slot_number is not None and slot_number <= 10:
                reasons.append("Near entry — easy access")
            else:
                reasons.append("Available slot")
            if level_num == 1:
                reasons.append("Ground level — nearest floor")
            if local_congestion_score >= 0.5:
                reasons.append("Less crowded area")

            candidate_slots.append(
                {
                    "slot_id": slot_id,
                    "level": level,
                    "score": float(score),
                    "reasons": reasons,
                }
            )

    if not candidate_slots:
        return None

    # 1) Sort by score descending, after scoring all slots.
    candidate_slots.sort(key=lambda x: (x.get("score", 0.0), x.get("slot_id", "")), reverse=True)

    # 2) Select best + alternatives
    best_candidate = candidate_slots[0]
    alternatives = candidate_slots[1:4]  # up to 3 alternatives

    result = {
        "best_level": best_candidate.get("level"),
        "best_slot": best_candidate.get("slot_id"),
        "score": round(float(best_candidate.get("score", 0.0)), 3),
        "prediction": "Low Traffic" if pred == 0 else "High Traffic",
        "confidence": round(conf * 100, 2),
        "reasons": best_candidate.get("reasons", []),
        "alternatives": [c.get("slot_id") for c in alternatives if c.get("slot_id")],
    }
    app.logger.info(
        "recommendation vehicle_no=%s level=%s slot_id=%s score=%s reasons=%s alternatives=%s",
        vehicle_no,
        result["best_level"],
        result["best_slot"],
        result["score"],
        "|".join(result["reasons"]),
        ",".join(result["alternatives"]),
    )
    return result


# -----------------------------
# AUTH
# -----------------------------
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Username and password required",
                    "role": None,
                }
            ),
            400,
        )

    admin = admins_collection.find_one({"username": username})
    if not admin or not _verify_admin_password(admin, password):
        app.logger.info("login failed for username=%s", username)
        return jsonify(
            {"success": False, "message": "Invalid username or password", "role": None}
        )

    role = admin.get("role", "admin")
    token = create_admin_token(username, role)
    app.logger.info("login ok username=%s role=%s", username, role)
    return jsonify(
        {
            "success": True,
            "message": "Login successful",
            "role": role,
            "token": token,
        }
    )


@app.route("/api/logout", methods=["POST"])
def logout():
    # Stateless JWT-style token: client discards token; no server store.
    return jsonify({"success": True, "message": "Logged out"})


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    token = _get_bearer_token()
    if not token:
        return jsonify({"success": False, "message": "Unauthorized"}), 401
    user = verify_admin_token(token)
    if not user:
        return jsonify({"success": False, "message": "Invalid session"}), 401
    return jsonify(
        {
            "success": True,
            "username": user["username"],
            "role": user["role"],
        }
    )

# -----------------------------
# ENTRY
# -----------------------------
@app.route("/api/entry", methods=["POST"])
def vehicle_entry():
    if not request.is_json:
        return jsonify({"message": "Request body must be JSON"}), 400
    data = request.json or {}
    vehicle_no = normalize_vehicle_no(data.get("vehicle_no") or "")
    vehicle_type = normalize_type(data.get("vehicle_type") or "")

    if not vehicle_no:
        return jsonify({"message": "vehicle_no required"}), 400
    if not vehicle_type:
        return jsonify({"message": "vehicle_type required"}), 400

    app.logger.info("ENTRY attempt vehicle_no=%s vehicle_type=%s", vehicle_no, vehicle_type)

    # Prevent duplicate active sessions (return existing, do not fail).
    existing = sessions_collection.find_one(
        {"vehicle_no": vehicle_no, "status": "active"}
    )
    if existing:
        app.logger.info(
            "ENTRY existing active session vehicle_no=%s slot_id=%s",
            vehicle_no,
            existing.get("slot_id"),
        )
        return jsonify(
            {
                "message": "Session already exists",
                "vehicle_no": existing.get("vehicle_no"),
                "slot_id": existing.get("slot_id"),
                "level": existing.get("level"),
                "entry_time": _iso(existing.get("entry_time")),
            }
        ), 200

    # If frontend sends slot_id, use it; otherwise use internal recommendation.
    requested_slot_id = data.get("slot_id")
    requested_slot_id = _norm_slot_id(requested_slot_id) if requested_slot_id else None

    recommendation = None
    if requested_slot_id:
        slot_id = requested_slot_id
    else:
        recommendation = _recommend_slot(vehicle_no, vehicle_type)
        if not recommendation:
            return jsonify({"message": f"No slots available for {vehicle_type}"}), 400
        slot_id = recommendation["best_slot"]

    # Atomic slot assignment.
    slot = slots_collection.find_one_and_update(
        {"slot_id": slot_id, "status": "available"},
        {"$set": {"status": "occupied", "vehicle_no": vehicle_no}},
        return_document=ReturnDocument.AFTER,
    )
    if not slot:
        app.logger.warning(
            "ENTRY slot assignment failed vehicle_no=%s slot_id=%s",
            vehicle_no,
            slot_id,
        )
        return jsonify({"error": "Slot already occupied"}), 400

    app.logger.info(f"ENTRY: {vehicle_no} → {slot_id}")

    slot_id = slot["slot_id"]
    level = slot.get("level", "")
    now = datetime.now(IST)

    # 1) Session creation must succeed; otherwise rollback slot.
    try:
        app.logger.info(
            "ENTRY session creation vehicle_no=%s slot_id=%s",
            vehicle_no,
            slot_id,
        )
        sessions_collection.insert_one(
            {
                "vehicle_no": vehicle_no,
                "vehicle_type": vehicle_type,
                "slot_id": slot_id,
                "level": level,
                "entry_time": now,
                "exit_time": None,
                "base_duration_minutes": 120,
                "extended_minutes": 0,
                "total_duration_minutes": 0,
                "payment_amount": 0,
                "payment_status": "pending",
                "status": "active",
            }
        )
    except Exception:
        app.logger.exception("ENTRY session insert failed; releasing slot %s", slot_id)
        slots_collection.update_one(
            {"slot_id": slot_id},
            {"$set": {"status": "available", "vehicle_no": None}},
        )
        return jsonify({"message": "Could not create session; try again"}), 500

    # 2) Vehicle profile update is best-effort; do NOT rollback slot if it fails.
    try:
        vehicles_collection.update_one(
            {"vehicle_no": vehicle_no},
            {
                "$setOnInsert": {
                    "vehicle_type": vehicle_type,
                    "total_time_spent": 0,
                },
                "$set": {
                    "vehicle_type": vehicle_type,
                    "last_visit": now,
                    "preferred_level": str(level),
                },
                "$inc": {"total_visits": 1},
            },
            upsert=True,
        )
    except Exception:
        app.logger.exception("ENTRY vehicle profile update failed vehicle_no=%s", vehicle_no)

    app.logger.info(
        "ENTRY session created vehicle_no=%s slot_id=%s level=%s",
        vehicle_no,
        slot_id,
        level,
    )

    try:
        gate_state_collection.update_one(
            {"_id": "main"},
            {
                "$set": {
                    "mode": "entered",
                    "message": "Entry successful. Proceed to slot.",
                    "vehicle_no": vehicle_no,
                    "updated_at": datetime.now(IST),
                }
            },
            upsert=True,
        )
    except Exception:
        app.logger.exception("ENTRY gate_state update failed vehicle_no=%s", vehicle_no)

    resp = {"message": "Slot allocated", "slot_id": slot_id, "level": level}
    if recommendation:
        resp["recommendation"] = {
            "best_level": recommendation["best_level"],
            "best_slot": recommendation["best_slot"],
            "reasons": recommendation["reasons"],
            "prediction": recommendation["prediction"],
            "confidence": recommendation["confidence"],
        }
    return jsonify(resp)

# -----------------------------
# EXIT
# -----------------------------
@app.route("/api/exit", methods=["POST"])
def exit_vehicle():
    if not request.is_json:
        return jsonify({"message": "Request body must be JSON"}), 400
    vehicle_no = normalize_vehicle_no((request.json or {}).get("vehicle_no"))
    if not vehicle_no:
        return jsonify({"message": "vehicle_no required"}), 400

    session = sessions_collection.find_one(
        {"vehicle_no": vehicle_no, "status": "active"}, sort=[("entry_time", -1)]
    )
    if not session:
        return jsonify({"message": "No active session"}), 404

    slot_id = session["slot_id"]
    now = datetime.now(IST)
    entry = _ensure_ist(session["entry_time"])
    total_minutes = max(int((now - entry).total_seconds() / 60), 0)
    blocks = math.ceil(total_minutes / 15) if total_minutes else 0
    parking_cost = max(blocks * 10, 0)

    allowed_minutes = 120
    overtime_minutes = max(total_minutes - allowed_minutes, 0)
    overtime_blocks = math.ceil(overtime_minutes / 15) if overtime_minutes > 0 else 0
    overtime_cost = overtime_blocks * 15
    total_payment = parking_cost + overtime_cost

    resp = None
    status_code = 200
    try:
        # --- Complete session first ---
        sessions_collection.update_one(
            {"_id": session["_id"]},
            {
                "$set": {
                    "status": "completed",
                    "exit_time": now,
                    "total_duration_minutes": total_minutes,
                    "payment_amount": total_payment,
                    "total_payment": total_payment,
                    "payment_status": "paid",
                }
            },
        )

        vehicles_collection.update_one(
            {"vehicle_no": vehicle_no},
            {"$inc": {"total_time_spent": total_minutes}, "$set": {"last_visit": now}},
            upsert=True,
        )

        gate_state_collection.update_one(
            {"_id": "main"},
            {"$set": {
                "mode": "exit",
                "message": "Payment received. Opening gate",
                "vehicle_no": vehicle_no,
                "updated_at": now,
            }},
            upsert=True,
        )

        app.logger.info(
            "exit ok vehicle_no=%s slot_id=%s duration_minutes=%s total_payment=%s",
            vehicle_no, slot_id, total_minutes, total_payment,
        )

        resp = jsonify({
            "message": "Exit successful",
            "parking_cost": parking_cost,
            "overtime_cost": overtime_cost,
            "total_payment": total_payment,
            "payment": total_payment,
        })
    except Exception:
        app.logger.exception("exit failed; releasing slot_id=%s vehicle_no=%s", slot_id, vehicle_no)
        resp = jsonify({"message": "Exit failed"})
        status_code = 500
    finally:
        # Ensure slot is freed even if downstream writes fail.
        slots_collection.update_one(
            {"slot_id": slot_id},
            {"$set": {"status": "available", "vehicle_no": None}}
        )
        app.logger.info(f"EXIT: {vehicle_no} freed {slot_id}")

    return resp, status_code

# -----------------------------
# EXTEND
# -----------------------------
@app.route("/api/extend", methods=["POST"])
def extend_parking():
    if not request.is_json:
        return jsonify({"message": "Request body must be JSON"}), 400
    data = request.json or {}
    vehicle_no = normalize_vehicle_no(data.get("vehicle_no"))
    minutes = _safe_int(data.get("minutes"), default=0)
    if not vehicle_no:
        return jsonify({"message": "vehicle_no required"}), 400
    if minutes <= 0:
        return jsonify({"message": "minutes must be a positive integer"}), 400

    session = sessions_collection.find_one(
        {"vehicle_no": vehicle_no, "status": "active"}
    )
    if not session:
        return jsonify({"message": "No active session"}), 404

    new_time = session.get("extended_minutes", 0) + minutes
    sessions_collection.update_one(
        {"_id": session["_id"]}, {"$set": {"extended_minutes": new_time}}
    )
    return jsonify({"message": "Extended", "extended_minutes": new_time})


# -----------------------------
# STATUS (per vehicle_no — multi-user)
# -----------------------------
@app.route("/api/status/<vehicle_no>", methods=["GET"])
@app.route("/api/user/status/<vehicle_no>", methods=["GET"])
def get_status(vehicle_no):
    vehicle_no = normalize_vehicle_no(vehicle_no)
    session = sessions_collection.find_one(
        {"vehicle_no": vehicle_no, "status": "active"}
    )
    if not session:
        return jsonify({"active": False})

    now = datetime.now(IST)
    entry = _ensure_ist(session["entry_time"])
    total_minutes = max(int((now - entry).total_seconds() / 60), 0)
    allowed = _allowed_minutes(session)
    remaining = max(allowed - total_minutes, 0)
    blocks = math.ceil(total_minutes / 15) if total_minutes else 0
    payment = max(blocks * 10, 0)

    return jsonify(
        {
            "active": True,
            "slot_id": session["slot_id"],
            "level": session["level"],
            "entry_time": _iso(entry),
            "total_minutes": total_minutes,
            "remaining_minutes": remaining,
            "payment": payment,
            "total_payment": payment,
        }
    )


# -----------------------------
# USER HISTORY (optional)
# -----------------------------
@app.route("/api/history/<vehicle_no>", methods=["GET"])
@app.route("/api/user/history/<vehicle_no>", methods=["GET"])
def get_history(vehicle_no):
    vehicle_no = normalize_vehicle_no(vehicle_no)
    sessions = list(
        sessions_collection.find(
            {"vehicle_no": vehicle_no, "status": "completed"}, {"_id": 0}
        ).sort("entry_time", -1)
    )
    return jsonify(sessions)


# -----------------------------
# ADMIN DASHBOARD (counts aligned with slot_status)
# -----------------------------
@app.route("/api/admin/dashboard", methods=["GET"])
@require_admin
def admin_dashboard():
    total_slots, available_slots, occupied_slots = _slot_counts()
    active_sessions = sessions_collection.count_documents({"status": "active"})
    completed_sessions = sessions_collection.count_documents({"status": "completed"})

    total_revenue = 0
    for p in sessions_collection.find({"payment_status": "paid"}):
        total_revenue += int(p.get("payment_amount", 0) or 0)

    raw_slot_docs = slots_collection.count_documents({})
    raw_session_docs = sessions_collection.count_documents({})
    app.logger.info(
        "GET /api/admin/dashboard | derived slots total=%s avail=%s occ=%s | "
        "active_sessions=%s completed=%s | raw_counts slots_coll=%s sessions_coll=%s",
        total_slots,
        available_slots,
        occupied_slots,
        active_sessions,
        completed_sessions,
        raw_slot_docs,
        raw_session_docs,
    )

    now = datetime.now(IST)
    hour = now.hour
    day = now.weekday()
    occupancy_ratio = occupied_slots / total_slots if total_slots > 0 else 0
    prediction, confidence = _ml_predict(hour, day, "car")

    # Final occupancy+ML traffic label logic
    if occupancy_ratio < 0.2:
        pred_label = "Low Traffic"
    elif occupancy_ratio < 0.5:
        pred_label = "Moderate Traffic"
    else:
        pred_label = "High Traffic"

    if prediction == 1 and occupancy_ratio > 0.3:
        pred_label = "High Traffic (Likely)"
    elif prediction == 1:
        pred_label = "Traffic Increasing"
    elif occupancy_ratio < 0.2:
        pred_label = "Low Traffic"

    return jsonify(
        {
            "total_slots": total_slots,
            "available_slots": available_slots,
            "occupied_slots": occupied_slots,
            "active_sessions": active_sessions,
            "completed_sessions": completed_sessions,
            "total_revenue": total_revenue,
            "ai": {
                "prediction": pred_label,
                "confidence": round(confidence * 100, 2),
            },
        }
    )


# -----------------------------
# ADMIN SLOT STATUS
# -----------------------------
@app.route("/api/admin/slot_status", methods=["GET"])
@require_admin
def slot_status():
    slots = list(slots_collection.find({}, {"_id": 0}))
    sessions = list(sessions_collection.find({"status": "active"}, {"_id": 0}))

    session_by_slot = {}
    for x in sessions:
        key = _norm_slot_id(x.get("slot_id"))
        if key is not None:
            session_by_slot[key] = x

    result = []
    now = datetime.now(IST)
    for slot in slots:
        sk = _norm_slot_id(slot.get("slot_id"))
        s = session_by_slot.get(sk) if sk is not None else None
        # Use the slot's own status field as the authoritative source of truth.
        # The session lookup only enriches the response with vehicle details.
        slot_db_status = str(slot.get("status", "available")).lower()

        if slot_db_status == "occupied" and s:
            entry = s["entry_time"]
            entry = _ensure_ist(entry)
            predicted_exit = entry + timedelta(minutes=_allowed_minutes(s))
            overtime = now > predicted_exit
            result.append(
                {
                    "slot_id": slot["slot_id"],
                    "level": slot["level"],
                    "status": "occupied",
                    "vehicle_no": s["vehicle_no"],
                    "entry_time": _iso(entry),
                    "predicted_exit": _iso(predicted_exit),
                    "overtime": overtime,
                }
            )
        elif slot_db_status == "occupied" and not s:
            # Orphaned slot — occupied in DB but no matching active session.
            app.logger.warning(
                "slot_status: orphaned occupied slot slot_id=%s (no active session)",
                slot.get("slot_id"),
            )
            result.append(
                {
                    "slot_id": slot["slot_id"],
                    "level": slot["level"],
                    "status": "occupied",
                    "vehicle_no": "UNKNOWN",
                    "entry_time": None,
                    "predicted_exit": None,
                    "overtime": False,
                }
            )
        else:
            result.append(
                {
                    "slot_id": slot["slot_id"],
                    "level": slot["level"],
                    "status": "available",
                }
            )
    return jsonify(result)


# -----------------------------
# ADMIN HISTORY
# -----------------------------
@app.route("/api/admin/history", methods=["GET"])
@require_admin
def get_admin_history():
    page = max(_safe_int(request.args.get("page"), default=1) or 1, 1)
    limit = max(_safe_int(request.args.get("limit"), default=20) or 20, 1)
    skip = (page - 1) * limit

    total = sessions_collection.count_documents({"status": "completed"})
    total_pages = max(1, math.ceil(total / limit))

    sessions = (
        sessions_collection.find({"status": "completed"})
        .sort("exit_time", -1)
        .skip(skip)
        .limit(limit)
    )
    data = []
    for s in sessions:
        entry = s.get("entry_time")
        exit_t = s.get("exit_time")
        entry_dt = entry if isinstance(entry, datetime) else None
        exit_dt = exit_t if isinstance(exit_t, datetime) else None
        date_str = entry_dt.strftime("%Y-%m-%d") if entry_dt else ""
        entry_time_str = entry_dt.strftime("%H:%M:%S") if entry_dt else ""
        exit_time_str = exit_dt.strftime("%H:%M:%S") if exit_dt else ""
        duration_minutes = s.get("total_duration_minutes", 0)
        payment_value = s.get("total_payment", s.get("payment_amount", 0))
        data.append(
            {
                "date": date_str,
                "vehicle_no": s.get("vehicle_no", ""),
                "vehicle_type": s.get("vehicle_type", ""),
                "slot_id": s.get("slot_id", ""),
                "level": s.get("level", ""),
                "entry_time": entry_time_str,
                "exit_time": exit_time_str,
                "duration_minutes": duration_minutes,
                "payment": payment_value,
                "total_payment": payment_value,
                "payment_status": s.get("payment_status", "pending"),
                "extended_minutes": s.get("extended_minutes", 0),
            }
        )
    return jsonify({"data": data, "page": page, "total_pages": total_pages})


# -----------------------------
# ADMIN ACTIVE SESSIONS
# -----------------------------
@app.route("/api/admin/active_sessions", methods=["GET"])
@require_admin
def active_sessions():
    sessions = list(
        sessions_collection.find(
            {"status": "active"},
            {"_id": 0, "vehicle_no": 1, "slot_id": 1, "level": 1, "entry_time": 1},
        )
        .sort("entry_time", -1)
        .limit(10)
    )
    out = []
    for s in sessions:
        et = s.get("entry_time")
        out.append(
            {
                "vehicle_no": s.get("vehicle_no", ""),
                "slot_id": s.get("slot_id", ""),
                "level": s.get("level", ""),
                "entry_time": _iso(et) if isinstance(et, datetime) else None,
            }
        )
    app.logger.info("GET /api/admin/active_sessions | rows=%s", len(out))
    return jsonify(out)


# -----------------------------
# ADMIN STATISTICS
# -----------------------------
@app.route("/api/admin/statistics", methods=["GET"])
@app.route("/api/admin/stats", methods=["GET"])
@require_admin
def admin_statistics_api():
    start_str = request.args.get("start_date") or request.args.get("start")
    end_str = request.args.get("end_date") or request.args.get("end")

    total_slots, available_slots, occupied_slots = _slot_counts()
    query = {"status": "completed"}
    if start_str and end_str:
        try:
            start_dt_naive = datetime.strptime(start_str, "%Y-%m-%d")
            end_next_naive = datetime.strptime(end_str, "%Y-%m-%d") + timedelta(days=1)
            start_dt = IST.localize(start_dt_naive)
            end_next = IST.localize(end_next_naive)
            query["entry_time"] = {"$gte": start_dt, "$lt": end_next}
        except ValueError:
            pass

    sessions = list(sessions_collection.find(query))

    def _parse_maybe_datetime(dt_value):
        """
        Parse MongoDB datetime values or stored ISO strings into IST-aware datetime.
        Returns None when parsing fails.
        """
        if isinstance(dt_value, datetime):
            return _ensure_ist(dt_value)
        if not isinstance(dt_value, str):
            return None

        txt = dt_value.strip()
        if not txt:
            return None

        # Handle common ISO variants (with or without trailing 'Z').
        try:
            if txt.endswith("Z"):
                parsed = datetime.fromisoformat(txt.replace("Z", "+00:00"))
            else:
                parsed = datetime.fromisoformat(txt)
            return _ensure_ist(parsed) if isinstance(parsed, datetime) else None
        except ValueError:
            pass

        # Fallback: a few common formats.
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"):
            try:
                parsed = datetime.strptime(txt, fmt)
                return _ensure_ist(parsed)
            except ValueError:
                continue
        return None

    vehicle_counter = Counter()
    revenue_by_date = defaultdict(float)
    sessions_by_date = defaultdict(int)
    total_revenue = 0.0
    total_duration = 0
    duration_count = 0
    hour_counter = Counter()  # group-by hour(entry_time)

    for s in sessions:
        vtype = s.get("vehicle_type", "unknown")
        vehicle_counter[vtype] += 1
        entry_time = s.get("entry_time")
        exit_time = s.get("exit_time")
        payment = float(s.get("payment_amount", 0) or 0)
        total_revenue += payment

        entry_dt = _parse_maybe_datetime(entry_time)
        exit_dt = _parse_maybe_datetime(exit_time)

        # Sessions-by-date + peak hour aggregation come from entry_time only.
        if entry_dt:
            dk = entry_dt.strftime("%Y-%m-%d")
            sessions_by_date[dk] += 1
            hour_counter[entry_dt.hour] += 1
            revenue_by_date[dk] += payment

        # Duration/payment calculations require both entry_time and exit_time.
        if entry_dt and exit_dt:
            dm = int((exit_dt - entry_dt).total_seconds() / 60)
            if dm > 0:
                total_duration += dm
                duration_count += 1

    avg_duration = (total_duration / duration_count) if duration_count else 0
    if hour_counter:
        h, _ = hour_counter.most_common(1)[0]
        # Dynamic peak hour derived from aggregated parking_sessions.
        peak_hour_label = f"{h:02d}:00-{(h + 1) % 24:02d}:00"
    else:
        peak_hour_label = "N/A"

    # Next best time to park:
    # Use session history frequency per hour(entry_time) and pick the 2 least busy hours.
    best_time_to_park_label = "N/A"
    if hour_counter:
        hour_counts = {hh: int(hour_counter.get(hh, 0)) for hh in range(24)}

        def _hour12(hh):
            suffix = "AM" if hh < 12 else "PM"
            h12 = hh % 12
            if h12 == 0:
                h12 = 12
            return f"{h12} {suffix}"

        def _format_range(start_hh):
            end_hh = (start_hh + 1) % 24
            return f"{_hour12(start_hh)} - {_hour12(end_hh)}"

        # Sort by lowest frequency, then by hour (stable deterministic tie-breaker).
        sorted_hours = sorted(range(24), key=lambda hh: (hour_counts.get(hh, 0), hh))
        best_hours = sorted_hours[:2]
        best_time_to_park_label = (
            f"{_format_range(best_hours[0])} and {_format_range(best_hours[1])}"
        )

    return jsonify(
        {
            "vehicle_type_counts": dict(vehicle_counter),
            "revenue_by_date": [
                {"date": d, "revenue": revenue_by_date[d]}
                for d in sorted(revenue_by_date.keys())
            ],
            "sessions_by_date": [
                {"date": d, "count": sessions_by_date[d]}
                for d in sorted(sessions_by_date.keys())
            ],
            "total_revenue": total_revenue,
            "average_duration_minutes": avg_duration,
            "peak_hour": peak_hour_label,
            "best_time_to_park": best_time_to_park_label,
            "active_sessions": sessions_collection.count_documents({"status": "active"}),
            "total_slots": total_slots,
            "available_slots": available_slots,
            "occupied_slots": occupied_slots,
        }
    )

# -----------------------------
# PREDICTION API
# -----------------------------
@app.route("/api/predict", methods=["POST"])
def predict_parking():
    if not request.is_json:
        return jsonify({"message": "Request body must be JSON"}), 400
    data = request.json or {}
    hour = _safe_int(data.get("hour"), default=None)
    day = _safe_int(data.get("day_of_week"), default=None)
    vehicle_type = normalize_type(data.get("vehicle_type") or "")
    if hour is None or day is None:
        return jsonify({"message": "hour and day_of_week must be integers"}), 400
    if hour < 0 or hour > 23 or day < 0 or day > 6:
        return jsonify({"message": "hour must be 0-23 and day_of_week 0-6"}), 400
    if not vehicle_type:
        return jsonify({"message": "vehicle_type required"}), 400

    # Traffic label must reflect *live occupancy* (single source of truth).
    total, available, occupied = _slot_counts()
    occupancy_ratio = occupied / total if total > 0 else 0

    prediction, confidence_norm = _ml_predict(hour, day, "car")
    confidence = confidence_norm * 100

    # Final occupancy+ML traffic label logic
    if occupancy_ratio < 0.2:
        pred_label = "Low Traffic"
    elif occupancy_ratio < 0.5:
        pred_label = "Moderate Traffic"
    else:
        pred_label = "High Traffic"

    if prediction == 1 and occupancy_ratio > 0.3:
        pred_label = "High Traffic (Likely)"
    elif prediction == 1:
        pred_label = "Traffic Increasing"
    elif occupancy_ratio < 0.2:
        pred_label = "Low Traffic"

    return jsonify({"prediction": pred_label, "confidence": round(confidence, 2)})


@app.route("/api/recommend_slot", methods=["POST"])
def recommend_slot():
    if not request.is_json:
        return jsonify({"message": "Request body must be JSON"}), 400
    payload = request.json or {}
    vehicle_no = normalize_vehicle_no(payload.get("vehicle_no"))
    vehicle_type = normalize_type(payload.get("vehicle_type"))
    if not vehicle_no or not vehicle_type:
        return jsonify({"message": "vehicle_no and vehicle_type required"}), 400

    rec = _recommend_slot(vehicle_no, vehicle_type)
    if not rec:
        return jsonify({"message": "No recommendation available"}), 404
    return jsonify(
        {
            "vehicle_no": vehicle_no,
            "vehicle_type": vehicle_type,
            "best_level": rec["best_level"],
            "best_slot": rec["best_slot"],
            "prediction": rec["prediction"],
            "confidence": rec["confidence"],
            "reasons": rec["reasons"],
            "alternatives": rec.get("alternatives", []),
        }
    )


@app.route("/api/recommend", methods=["GET"])
def recommend_legacy():
    now = datetime.now(IST)
    day = now.weekday()
    results = []
    for h in range(24):
        pred, conf = _ml_predict(h, day, "car")
        prob_peak = conf if pred == 1 else (1 - conf)
        results.append((h, prob_peak))
    results.sort(key=lambda x: x[1])
    best_hour = results[0][0]
    best_time = f"{best_hour:02d}:00"
    low_conf = round((1 - results[0][1]) * 100, 2)
    return jsonify(
        {
            "best_time": best_time,
            "traffic_level": "Low",
            "confidence": low_conf,
            "message": "Low traffic expected at this time",
        }
    )

@app.route("/api/smart_status", methods=["GET"])
def smart_status():
    now = datetime.now(IST)
    hour = now.hour
    day = now.weekday()
    peak_hours = {8, 9, 10, 17, 18, 19, 20}

    total_slots, available, occupied = _slot_counts()
    occupancy_percentage = (occupied / total_slots) * 100 if total_slots > 0 else 0

    # Use occupancy ratio for current status.
    # This prevents a single occupied slot from always showing "Moderate".
    occupancy_ratio = occupied / total_slots if total_slots > 0 else 0
    if occupancy_ratio < 0.3:
        current_status = "Free"
        load_level = "Low Load"
    elif occupancy_ratio < 0.7:
        current_status = "Moderate"
        load_level = "Medium Load"
    else:
        current_status = "Busy"
        load_level = "High Load"

    prediction, confidence = _ml_predict(hour, day, "car")

    # Prediction label combined with real occupancy.
    if prediction == 1 and occupied > 0:
        pred_label = "High Traffic (Likely)"
    elif prediction == 1:
        pred_label = "Traffic Increasing"
    else:
        pred_label = "Low Traffic"

    # Build advice message (message can still leverage ML signal)
    if current_status == "Free":
        message = (
            "Parking is free now. " +
            ("Expected traffic increase soon. Park quickly." if prediction == 1 else "Likely to remain free.")
        )
    elif current_status == "Moderate":
        message = "Parking is moderately occupied."
    else:
        message = "Parking is busy currently."

    return jsonify(
        {
            "current_status": current_status,
            "load_level": load_level,
            "available_slots": available,
            "occupied_slots": occupied,
            "occupancy_percentage": round(occupancy_percentage, 2),
            "prediction": pred_label,
            "confidence": round(confidence * 100, 2),
            "message": message,
            "explanation": [
                "Live occupancy analyzed",
                "Traffic prediction combined with current hour and day",
            ],
        }
    )


# -----------------------------
# ADMIN DEBUG + ONE-TIME DATA REPAIR
# -----------------------------
@app.route("/api/reset", methods=["POST"])
def reset():
    """
    DEBUG ONLY: reset database state (sessions cleared, all slots marked available).
    """
    sessions_collection.delete_many({})
    slots_collection.update_many(
        {},
        {"$set": {"status": "available", "vehicle_no": None}},
    )
    app.logger.info("RESET: cleared sessions and set all slots to available")
    return {"message": "reset done"}


@app.route("/api/debug/slot_status", methods=["GET"])
def debug_slot_status():
    """Diagnostic: returns raw slot + session join summary."""
    slots = list(slots_collection.find({}, {"_id": 0, "slot_id": 1, "status": 1}))
    sessions = list(sessions_collection.find({"status": "active"}, {"_id": 0, "slot_id": 1, "vehicle_no": 1}))
    occupied_in_db = [s for s in slots if str(s.get("status", "")).lower() == "occupied"]
    return jsonify({
        "total_slots": len(slots),
        "active_sessions": len(sessions),
        "occupied_slots_in_db": len(occupied_in_db),
        "occupied_slot_ids": [s.get("slot_id") for s in occupied_in_db],
        "active_session_slot_ids": [_norm_slot_id(s.get("slot_id")) for s in sessions],
    })


@app.route("/api/debug/repair_slots", methods=["POST"])
def repair_slots():
    """
    One-time repair: finds active sessions whose slot is NOT marked occupied
    and fixes the slot document. Safe to call multiple times (idempotent).
    """
    active_sessions = list(sessions_collection.find({"status": "active"}, {"_id": 0}))
    repaired = []
    for s in active_sessions:
        sid = s.get("slot_id")
        if not sid:
            continue
        slot = slots_collection.find_one({"slot_id": sid})
        if slot and str(slot.get("status", "")).lower() != "occupied":
            slots_collection.update_one(
                {"slot_id": sid},
                {"$set": {"status": "occupied"}}
            )
            repaired.append(sid)
            app.logger.info("repair_slots: fixed slot_id=%s for vehicle_no=%s", sid, s.get("vehicle_no"))
    return jsonify({
        "repaired_count": len(repaired),
        "repaired_slot_ids": repaired,
        "message": "Done. Refresh the admin dashboard." if repaired else "Nothing to repair — all slots consistent.",
    })


@app.route("/api/gate_state", methods=["GET"])
def gate_state():
    now = datetime.now(IST)
    state = (
        gate_state_collection.find_one({"_id": "main"})
        or gate_state_collection.find_one({"_id": "main_gate"})
        or {}
    )
    if not state:
        state = {
            "mode": "idle",
            "message": "Vehicle detected. Scan QR / Open entry form",
            "vehicle_no": None,
            "updated_at": now,
        }
        gate_state_collection.insert_one({"_id": "main", **state})
    mode = str(state.get("mode", "idle")).lower()
    if mode == "entry":
        mode = "waiting"
    return jsonify(
        {
            "mode": mode,
            "message": state.get("message", ""),
            "show_qr": mode == "waiting",
            "vehicle_no": state.get("vehicle_no"),
            "updated_at": _iso(state.get("updated_at")) or _iso(now),
        }
    )


@app.route("/api/gate/update", methods=["POST"])
def gate_update():
    if not request.is_json:
        return jsonify({"message": "Request body must be JSON"}), 400
    payload = request.json or {}
    mode = str(payload.get("mode", "idle")).strip().lower()
    if mode not in {"idle", "waiting", "entered", "entry", "exit", "pay"}:
        return jsonify({"message": "mode must be one of idle, waiting, entered, entry, exit, pay"}), 400
    if mode == "entry":
        mode = "waiting"
    message = payload.get("message") or (
        "Vehicle detected. Scan QR / Open entry form"
        if mode == "waiting"
        else (
            "Entry successful. Proceed to slot."
            if mode == "entered"
            else (
                "Payment received. Opening gate"
                if mode == "exit"
                else "Waiting for vehicle..."
            )
        )
    )
    vehicle_no = normalize_vehicle_no(payload.get("vehicle_no", ""))
    gate_state_collection.update_one(
        {"_id": "main"},
        {
            "$set": {
                "mode": mode,
                "message": message,
                "vehicle_no": vehicle_no or None,
                "updated_at": datetime.now(IST),
            }
        },
        upsert=True,
    )
    return jsonify({"success": True, "mode": mode, "message": message})

# ─── ARDUINO / WOKWI SENSOR INTEGRATION ────────────────────────────────────
@app.route("/api/sensor/update", methods=["POST"])
def sensor_update():
    """Receives slot occupancy data from arduino_simulator.py or wokwi_bridge.py"""
    if not request.is_json:
        return jsonify({"message": "Request body must be JSON"}), 400

    payload       = request.json or {}
    slots_payload = payload.get("slots", {})
    gate_payload  = payload.get("gate", {})
    source        = payload.get("source", "unknown")

    if not slots_payload:
        return jsonify({"message": "No slot data provided"}), 400

    slot_ids = list(slots_payload.keys())
    active_sessions = sessions_collection.find(
        {"slot_id": {"$in": slot_ids}, "status": "active"}, {"slot_id": 1}
    )
    session_slot_ids = {_norm_slot_id(s["slot_id"]) for s in active_sessions}

    updated, skipped, errors = [], [], []

    for slot_id, sensor in slots_payload.items():
        norm_id = _norm_slot_id(slot_id)
        if norm_id in session_slot_ids:   # never override active sessions
            skipped.append(slot_id)
            continue
        new_status = "occupied" if sensor.get("occupied") else "available"
        try:
            result = slots_collection.update_one(
                {"slot_id": norm_id},
                {"$set": {
                    "status": new_status,
                    "last_sensor_update": datetime.now(IST),
                    "sensor_distance_cm": sensor.get("distance_cm"),
                    "sensor_source": source,
                }},
            )
            if result.matched_count:
                updated.append({"slot_id": slot_id, "status": new_status})
            else:
                errors.append(f"{slot_id}: not found in DB")
        except Exception as exc:
            errors.append(f"{slot_id}: {exc}")

    # Gate state sync when IR triggered
    if gate_payload.get("ir_triggered"):
        any_free = gate_payload.get("any_slot_free", True)
        gate_state_collection.update_one(
            {"_id": "main"},
            {"$set": {
                "mode":       "entry" if any_free else "exit",
                "message":    "Vehicle detected. Scan QR / Open entry form" if any_free else "Parking Full",
                "vehicle_no": None,
                "updated_at": datetime.now(IST),
            }},
            upsert=True,
        )

    return jsonify({"success": True, "source": source, "updated": updated,
                    "skipped_active_sessions": skipped, "errors": errors})


@app.route("/api/sensor/status", methods=["GET"])
def sensor_status():
    slot_ids_param = request.args.get("slots", "G1-1,G1-2,G1-3")
    slot_ids = [s.strip() for s in slot_ids_param.split(",") if s.strip()]
    slots = list(slots_collection.find(
        {"slot_id": {"$in": slot_ids}},
        {"_id": 0, "slot_id": 1, "status": 1, "level": 1,
         "last_sensor_update": 1, "sensor_distance_cm": 1, "sensor_source": 1}
    ))
    for s in slots:
        if s.get("last_sensor_update"):
            s["last_sensor_update"] = _iso(s["last_sensor_update"])
    occupied = sum(1 for s in slots if s.get("status") == "occupied")
    return jsonify({"slots": slots, "summary": {"total": len(slots),
                   "occupied": occupied, "free": len(slots) - occupied}})


# Add this route for the sensor monitor page
@app.route("/sensor-monitor")
def sensor_monitor():
    return render_template("sensor_monitor.html")

@app.route("/api/pay", methods=["POST"])
def pay_only():
    data = request.json or {}
    vehicle_no = str(data.get("vehicle_no", "")).strip().upper()
    print(f"[PAY] vehicle_no received: {vehicle_no}")

    if not vehicle_no:
        return jsonify({"message": "vehicle_no required"}), 400

    session = sessions_collection.find_one(
        {"vehicle_no": vehicle_no, "status": "active"}
    )
    print(f"[PAY] session found: {bool(session)}")

    if not session:
        return jsonify({"message": "No active session found"}), 404

    now = datetime.now(IST)
    entry = _ensure_ist(session["entry_time"])
    total_minutes = max(int((now - entry).total_seconds() / 60), 0)

    blocks = math.ceil(total_minutes / 15) if total_minutes else 0
    estimated_cost = max(blocks * 10, 0)

    result = sessions_collection.update_one(
        {"_id": session["_id"]},
        {
            "$set": {
                "payment_status": "paid",
                "payment_amount": estimated_cost,
                "total_duration_minutes": total_minutes,
            }
        },
    )
    print(f"[PAY] update modified_count: {result.modified_count}")

    return jsonify({
        "message": "Payment successful",
        "total_payment": estimated_cost
    })

@app.errorhandler(404)
def not_found(_err):
    if request.path.startswith("/api/"):
        return jsonify({"message": "Resource not found"}), 404
    return "Not Found", 404


@app.errorhandler(500)
def internal_error(err):
    app.logger.exception("Unhandled server error: %s", err)
    if request.path.startswith("/api/"):
        return jsonify({"message": "Internal server error"}), 500
    return "Internal Server Error", 500

# ── SENSOR TRIGGER (called by arduino_simulator.py) ──────────────────────
@app.route("/api/sensor/trigger", methods=["POST"])
def sensor_trigger():
    """
    Called when Wokwi sensor detects a vehicle (distance < threshold).
    Sets gate state so the display screen shows the QR code.
    """
    data = request.json or {}
    action = data.get("action", "entry")   # "entry" or "exit"
    vehicle_no = normalize_vehicle_no(data.get("vehicle_no", ""))

    if action == "entry":
        msg = "Vehicle detected — please scan QR to enter"
    else:
        msg = "Vehicle at exit — please scan QR or pay first"

    gate_state_collection.update_one(
        {"_id": "main"},
        {"$set": {
            "mode": action,
            "message": msg,
            "vehicle_no": vehicle_no or None,
            "updated_at": datetime.now(IST),
            "sensor_triggered": True,
        }},
        upsert=True,
    )
    return jsonify({"success": True, "mode": action, "message": msg})


# ── EXIT GATE CHECK (checks payment before opening gate) ─────────────────
@app.route("/api/exit/check", methods=["POST"])
def exit_check():
    """
    Display screen calls this when a vehicle reaches the exit.
    Returns whether gate should open or show 'please pay' message.
    """
    data = request.json or {}
    vehicle_no = normalize_vehicle_no(data.get("vehicle_no", ""))
    if not vehicle_no:
        return jsonify({"allowed": False, "message": "No vehicle number provided"}), 400

    session = sessions_collection.find_one(
        {"vehicle_no": vehicle_no, "status": "active"},
    )
    if not session:
        # No active session — might already be paid and exited
        return jsonify({"allowed": True, "message": "No active session found — gate open"})

    payment_status = str(session.get("payment_status", "pending")).strip().lower()
    if payment_status == "paid":
        # Mark session complete and free the slot
        sessions_collection.update_one(
            {"_id": session["_id"]},
            {"$set": {"status": "completed", "exit_time": datetime.now(IST)}}
        )
        slots_collection.update_one(
            {"slot_id": session.get("slot_id")},
            {"$set": {"status": "available"}}
        )
        gate_state_collection.update_one(
            {"_id": "main"},
            {"$set": {"mode": "exit", "message": "Payment verified — gate opening", "updated_at": datetime.now(IST)}},
            upsert=True,
        )
        return jsonify({"allowed": True, "message": "Payment verified — gate opening"})
    else:
        gate_state_collection.update_one(
            {"_id": "main"},
            {"$set": {"mode": "pay", "message": f"Please pay first — vehicle {vehicle_no}", "updated_at": datetime.now(IST)}},
            upsert=True,
        )
        return jsonify({"allowed": False, "message": f"Payment not done for {vehicle_no} — please pay"})


# ── SENSOR MONITOR PAGE ───────────────────────────────────────────────────
@app.route("/sensor-monitor")
def sensor_monitor_page():
    return render_template("sensor_monitor.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)