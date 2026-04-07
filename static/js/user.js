
// Persist across navigation so timer resumes from backend state.
// QR entry flow writes these keys:
// - `vehicle_no`
// - `vehicle_type`
const VEHICLE_NO_KEY = "vehicle_no";
const VEHICLE_TYPE_KEY = "vehicle_type";
const USER_EXITED_KEY = "userExited";

let vehicleNo = "";
let vehicleType = "";

function loadUserSession() {
    try {
        vehicleNo = (localStorage.getItem(VEHICLE_NO_KEY) || "").trim();
        vehicleType = (localStorage.getItem(VEHICLE_TYPE_KEY) || "").trim();
    } catch (e) {
        console.warn("[user] loadUserSession failed", e);
    }
}

function saveUserSession() {
    try {
        localStorage.setItem(VEHICLE_NO_KEY, vehicleNo);
        localStorage.setItem(VEHICLE_TYPE_KEY, vehicleType);
    } catch (e) {
        console.warn("[user] saveUserSession failed", e);
    }
}

// Expose for debugging and optional inline HTML (onclick)
window.vehicleNo = vehicleNo;
window.vehicleType = vehicleType;

function syncVehicleGlobals() {
    window.vehicleNo = vehicleNo;
    window.vehicleType = vehicleType;
}

// =============================
// CONFIG (match admin / Live Server — override with window.API_BASE_URL)
// =============================
const BASE_URL = window.API_BASE_URL || "";

// =============================
// DOM ELEMENTS (after DOM ready we re-resolve if needed)
// =============================
let payBtn;
let timerDisplay;
let parkingCostDisplay;
let extraCostDisplay;
let totalCostDisplay;
let slotValueEl;
let levelValueEl;
let vehicleValueEl;
let warningMsg;
let overtimeContainer;
let overtimeTimer;
let extendBtn;

function cacheDomRefs() {
    payBtn = document.getElementById("payBtn");
    timerDisplay = document.getElementById("timer");
    parkingCostDisplay = document.getElementById("parkingCost");
    extraCostDisplay = document.getElementById("extraCost");
    totalCostDisplay = document.getElementById("totalCost");
    slotValueEl = document.getElementById("slotValue");
    levelValueEl = document.getElementById("levelValue");
    vehicleValueEl = document.getElementById("vehicleValue");
    warningMsg = document.getElementById("warningMsg");
    overtimeContainer = document.getElementById("overtimeContainer");
    overtimeTimer = document.getElementById("overtimeTimer");
    extendBtn = document.getElementById("extendBtn");
}

// =============================
// MENU
// =============================
function toggleMenu() {
    const menu = document.getElementById("dropdownMenu");
    if (!menu) return;
    menu.style.display =
        menu.style.display === "block" ? "none" : "block";
}

window.toggleMenu = toggleMenu;

// =============================
// STATE VARIABLES
// =============================
let timerInterval = null;
let timeRemaining = 0;
let currentTotalSeconds = 0;
let overtimeSeconds = 0;

// =============================
// FORMAT TIME
// =============================
function formatTime(seconds) {
    seconds = Math.max(Math.floor(seconds), 0);

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// =============================
// TIMER
// =============================
function startTimer() {
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        if (!vehicleNo) {
            console.debug("[timer] skip tick: no vehicleNo");
            return;
        }

        if (!timerDisplay) return;

        // ---------- NORMAL ----------
        if (timeRemaining > 0) {
            timeRemaining--;
            currentTotalSeconds++;

            timerDisplay.textContent = formatTime(timeRemaining);

            const totalDurEl = document.getElementById("totalDuration");
            if (totalDurEl) totalDurEl.textContent = formatTime(currentTotalSeconds);

            const totalMinutes = Math.floor(currentTotalSeconds / 60);
            const blocks = Math.ceil(totalMinutes / 15);
            const payment = blocks * 10;

            if (parkingCostDisplay) parkingCostDisplay.textContent = payment.toFixed(2);
            if (totalCostDisplay) totalCostDisplay.textContent = payment.toFixed(2);

            if (warningMsg) {
                if (timeRemaining === 900) {
                    warningMsg.textContent = "⚠ Only 15 minutes left!";
                    showNotification("15 minutes remaining!");
                }
                if (timeRemaining === 600) {
                    warningMsg.textContent = "⚠ Only 10 minutes left!";
                    showNotification("10 minutes remaining!");
                }
            }
        } else {
            // ---------- OVERTIME ----------
            overtimeSeconds++;
            currentTotalSeconds++;

            if (overtimeContainer) overtimeContainer.style.display = "block";
            if (overtimeTimer) overtimeTimer.textContent = formatTime(overtimeSeconds);

            const overtimeMinutes = Math.floor(overtimeSeconds / 60);
            const overtimeBlocks = Math.ceil(overtimeMinutes / 15);
            const overtimeCost = overtimeBlocks * 15;

            if (extraCostDisplay) extraCostDisplay.textContent = overtimeCost.toFixed(2);

            const normalCost = parseFloat(parkingCostDisplay && parkingCostDisplay.textContent) || 0;
            if (totalCostDisplay) {
                totalCostDisplay.textContent = (normalCost + overtimeCost).toFixed(2);
            }

            const totalDurEl = document.getElementById("totalDuration");
            if (totalDurEl) totalDurEl.textContent = formatTime(currentTotalSeconds);
        }
    }, 1000);
}

// =============================
// ENTRY
// =============================
async function allocateSlot() {
    if (!vehicleNo || !vehicleType) {
        console.error("[allocateSlot] missing vehicleNo or vehicleType", { vehicleNo, vehicleType });
        alert("Vehicle number or type is not set.");
        return;
    }

    console.log("[allocateSlot] POST /api/entry", { vehicle_no: vehicleNo, vehicle_type: vehicleType });

    try {
        const response = await fetch(`${BASE_URL}/api/entry`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                vehicle_no: vehicleNo,
                vehicle_type: vehicleType,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
        console.log("[allocateSlot] recommendation", data.recommendation || null);
        if (slotValueEl) slotValueEl.textContent = data.slot_id || "--";
        if (levelValueEl) levelValueEl.textContent = data.level || "--";
        if (vehicleValueEl) vehicleValueEl.textContent = vehicleNo;

        timeRemaining = 120 * 60;
        currentTotalSeconds = 0;
        overtimeSeconds = 0;

        saveUserSession();
        try {
            localStorage.removeItem(USER_EXITED_KEY);
        } catch (_) {}

        if (overtimeContainer) overtimeContainer.style.display = "none";
        if (warningMsg) warningMsg.textContent = "";

        startTimer();
        console.log("[allocateSlot] success", data);
        } else {
            console.warn("[allocateSlot] failed", response.status, data);
            alert(data.message || "Could not allocate slot");
        }
    } catch (err) {
        console.error("API Error:", err);
        alert("Could not allocate slot");
    }
}

// =============================
// LIVE STATUS
// =============================
async function updateLiveStatus() {
    if (!vehicleNo) {
        console.debug("[updateLiveStatus] skip: no vehicleNo");
        return;
    }

    let response;
    let data = {};
    try {
        response = await fetch(`${BASE_URL}/api/status/${encodeURIComponent(vehicleNo)}`);
        try {
            data = await response.json();
        } catch (_) {
            data = {};
        }
    } catch (err) {
        console.error("API Error:", err);
        return;
    }

    if (!response.ok || !data.active) {
        clearInterval(timerInterval);
        timerInterval = null;
        timeRemaining = 0;
        currentTotalSeconds = 0;
        overtimeSeconds = 0;
        if (timerDisplay) timerDisplay.textContent = "00:00:00";
        const totalDurEl = document.getElementById("totalDuration");
        if (totalDurEl) totalDurEl.textContent = "00:00:00";
        if (parkingCostDisplay) parkingCostDisplay.textContent = "0.00";
        if (totalCostDisplay) totalCostDisplay.textContent = "0.00";
        if (overtimeContainer) overtimeContainer.style.display = "none";
        if (warningMsg) warningMsg.textContent = "";
        console.log("[updateLiveStatus] no active session for", vehicleNo);
        return;
    }

    applyStatusToTimerAndUI(data, { start: true });
}

function applyStatusToTimerAndUI(data, { start } = { start: true }) {
    // Resume timer state from backend values (no hardcoded base-duration resets).
    if (slotValueEl) slotValueEl.textContent = data.slot_id || "--";
    if (levelValueEl) levelValueEl.textContent = data.level || "--";
    if (vehicleValueEl) vehicleValueEl.textContent = vehicleNo;

    currentTotalSeconds = (data.total_minutes || 0) * 60;
    timeRemaining = (data.remaining_minutes || 0) * 60;

    const entryTimeStr = data.entry_time;
    let elapsedSeconds = null;
    if (entryTimeStr) {
        const dt = new Date(entryTimeStr);
        if (!isNaN(dt.getTime())) {
            elapsedSeconds = Math.floor((Date.now() - dt.getTime()) / 1000);
        }
    }

    // If already in overtime, keep overtimeTimer continuous by starting from elapsed time.
    if (timeRemaining > 0) {
        overtimeSeconds = 0;
        if (overtimeContainer) overtimeContainer.style.display = "none";
        if (overtimeTimer) overtimeTimer.textContent = "00:00:00";
        if (warningMsg) warningMsg.textContent = "";
    } else {
        overtimeSeconds = Math.max(elapsedSeconds ?? currentTotalSeconds, 0);
        if (overtimeContainer) overtimeContainer.style.display = "block";
        if (overtimeTimer) overtimeTimer.textContent = formatTime(overtimeSeconds);
    }

    if (timerDisplay) timerDisplay.textContent = formatTime(timeRemaining);
    if (parkingCostDisplay)
        parkingCostDisplay.textContent = (data.total_payment ?? 0).toFixed(2);
    if (totalCostDisplay)
        totalCostDisplay.textContent = (data.total_payment ?? 0).toFixed(2);

    const totalDurEl = document.getElementById("totalDuration");
    if (totalDurEl) totalDurEl.textContent = formatTime(currentTotalSeconds);

    // If resuming exactly at warning thresholds, set the message immediately.
    if (warningMsg && timeRemaining > 0) {
        if (timeRemaining === 900) warningMsg.textContent = "⚠ Only 15 minutes left!";
        if (timeRemaining === 600) warningMsg.textContent = "⚠ Only 10 minutes left!";
    }

    if (start) startTimer();
}

// =============================
// EXIT
// =============================
async function exitParking() {
    if (!vehicleNo) {
        alert("No active vehicle session.");
        return;
    }

    try {
        const response = await fetch("/api/exit/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vehicle_no: vehicleNo }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
        clearInterval(timerInterval);
        timerInterval = null;
        timeRemaining = 0;
        currentTotalSeconds = 0;
        overtimeSeconds = 0;

        showNotification("Payment Successful! Rs. " + (data.total_payment ?? 0));

        if (timerDisplay) timerDisplay.textContent = "00:00:00";
        const totalDurEl = document.getElementById("totalDuration");
        if (totalDurEl) totalDurEl.textContent = "00:00:00";
        if (parkingCostDisplay) parkingCostDisplay.textContent = "0.00";
        if (totalCostDisplay) totalCostDisplay.textContent = "0.00";
        if (overtimeContainer) overtimeContainer.style.display = "none";
        if (warningMsg) warningMsg.textContent = "";

        if (slotValueEl) slotValueEl.textContent = "--";
        if (levelValueEl) levelValueEl.textContent = "--";
        if (vehicleValueEl) vehicleValueEl.textContent = "--";

        vehicleNo = null;
        syncVehicleGlobals();
        try {
            localStorage.setItem(USER_EXITED_KEY, "true");
            localStorage.removeItem(VEHICLE_NO_KEY);
            localStorage.removeItem(VEHICLE_TYPE_KEY);
        } catch (_) {}
        console.log("[exitParking] session cleared");
        } else {
            alert(data.message || "Exit failed");
        }
    } catch (err) {
        console.error("API Error:", err);
        alert("Exit failed");
    }
}

// =============================
// EXTEND
// =============================
async function extendParking(minutes) {
    if (!vehicleNo) {
        alert("No active session to extend.");
        return;
    }

    try {
        const response = await fetch(`${BASE_URL}/api/extend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                vehicle_no: vehicleNo,
                minutes: minutes,
            }),
        });

        if (response.ok) {
            showNotification("Extended by " + minutes + " minutes");
            await updateLiveStatus();
        } else {
            const err = await response.json().catch(() => ({}));
            alert(err.message || "Extend failed");
        }
    } catch (err) {
        console.error("API Error:", err);
        alert("Extend failed");
    }
}

window.extendParking = extendParking;

// =============================
// NOTIFICATION
// =============================
function showNotification(message) {
    const notification = document.createElement("div");
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #16a34a;
        color: white;
        padding: 12px 18px;
        border-radius: 8px;
        z-index: 1000;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// =============================
// INIT
// =============================
document.addEventListener("DOMContentLoaded", async () => {
    cacheDomRefs();
    loadUserSession();

    // If QR entry didn't set vehicle details, keep the dashboard empty
    // (do not call /api/status with an empty vehicle_no).
    if (!vehicleNo || !vehicleType) {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        timeRemaining = 0;
        currentTotalSeconds = 0;
        overtimeSeconds = 0;
        if (timerDisplay) timerDisplay.textContent = "00:00:00";
        const totalDurEl = document.getElementById("totalDuration");
        if (totalDurEl) totalDurEl.textContent = "00:00:00";
        if (parkingCostDisplay) parkingCostDisplay.textContent = "0.00";
        if (totalCostDisplay) totalCostDisplay.textContent = "0.00";
        if (overtimeContainer) overtimeContainer.style.display = "none";
        if (warningMsg) warningMsg.textContent = "";
        if (slotValueEl) slotValueEl.textContent = "--";
        if (levelValueEl) levelValueEl.textContent = "--";
        if (vehicleValueEl) vehicleValueEl.textContent = "--";
        return;
    }

    if (extendBtn) {
        extendBtn.addEventListener("click", () => {
            const options = document.getElementById("extendOptions");
            if (!options) return;
            options.style.display =
                options.style.display === "block" ? "none" : "block";
        });
    }

    if (payBtn) payBtn.addEventListener("click", exitParking);

    syncVehicleGlobals();
    console.log("[init] User dashboard", { vehicleNo, vehicleType, BASE_URL });

    try {
        const exited = localStorage.getItem(USER_EXITED_KEY) === "true";
        const statusUrl = `${BASE_URL}/api/status/${encodeURIComponent(vehicleNo)}`;
        console.log("[init] GET", statusUrl);
        const response = await fetch(statusUrl);

        const data = await response.json().catch(() => ({}));

        if (response.ok && data && data.active) {
            // Resume timer from backend values; do not allocate a new session.
            try {
                localStorage.removeItem(USER_EXITED_KEY);
            } catch (_) {}
            console.log("[init] Active session → resume timer");
            applyStatusToTimerAndUI(data, { start: true });
            return;
        }

        // No active session.
        if (exited) {
            // After payment, keep dashboard in empty state (no re-allocation).
            console.log("[init] No active session, but userExited=true → keep empty UI");
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = null;
            timeRemaining = 0;
            currentTotalSeconds = 0;
            overtimeSeconds = 0;
            if (timerDisplay) timerDisplay.textContent = "00:00:00";
            const totalDurEl = document.getElementById("totalDuration");
            if (totalDurEl) totalDurEl.textContent = "00:00:00";
            if (parkingCostDisplay) parkingCostDisplay.textContent = "0.00";
            if (totalCostDisplay) totalCostDisplay.textContent = "0.00";
            if (overtimeContainer) overtimeContainer.style.display = "none";
            if (warningMsg) warningMsg.textContent = "";
            if (slotValueEl) slotValueEl.textContent = "--";
            if (levelValueEl) levelValueEl.textContent = "--";
            if (vehicleValueEl) vehicleValueEl.textContent = "--";
            return;
        }

        console.log("[init] No active session; opening entry form.");
        window.location.href = "/entry";
    } catch (e) {
        console.error("[init] fetch failed", e);
    }
});
