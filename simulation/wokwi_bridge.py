"""
wokwi_bridge.py
===============
Bridges the real Wokwi Arduino simulation (running in VS Code / Wokwi CLI)
to the ParkVision Flask dashboard.

Wokwi serial output format (from src/main.cpp):
    d1 = 2.59 cm
    d2 = 3.89 cm
    d3 = 400.00 cm
    Empty slot!!           (or "Car is parked")

This script reads that output from stdin (pipe from Wokwi CLI) or from a
serial port, parses the distances, and POSTs them to /api/sensor/update.

Usage (pipe from Wokwi CLI):
    wokwi-cli --serial | python wokwi_bridge.py

Usage (real or emulated serial port):
    python wokwi_bridge.py --port /dev/ttyUSB0 --baud 9600

Usage (replay a saved serial log file):
    python wokwi_bridge.py --file serial_log.txt
"""

import argparse
import re
import sys
import time
from datetime import datetime

import requests

FLASK_BASE_URL = "http://127.0.0.1:5000"
SENSOR_API     = f"{FLASK_BASE_URL}/api/sensor/update"
GATE_API       = f"{FLASK_BASE_URL}/api/gate/update"
DISTANCE_THRESHOLD_CM = 100

SENSOR_SLOT_MAP = {
    "d1": "G1-1",
    "d2": "G1-2",
    "d3": "G1-3",
}

_DIST_PATTERN = re.compile(r"^(d[123])\s*=\s*([\d.]+)\s*cm", re.IGNORECASE)


def push(distances: dict, ir: bool):
    slots = {}
    for key, cm in distances.items():
        slot_id = SENSOR_SLOT_MAP.get(key)
        if slot_id:
            slots[slot_id] = {"distance_cm": round(cm, 2), "occupied": cm < DISTANCE_THRESHOLD_CM}

    payload = {
        "source": "wokwi_bridge",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "slots": slots,
        "gate": {
            "ir_triggered": ir,
            "any_slot_free": any(not v["occupied"] for v in slots.values()),
        },
    }
    try:
        resp = requests.post(SENSOR_API, json=payload, timeout=5)
        ts = datetime.now().strftime("%H:%M:%S")
        if resp.status_code == 200:
            print(f"[{ts}] ✅  Dashboard synced | slots={list(slots.keys())}")
        else:
            print(f"[{ts}] ⚠️  API {resp.status_code}: {resp.text[:100]}")
    except requests.exceptions.ConnectionError:
        print(f"❌  Flask not reachable at {FLASK_BASE_URL}")


def parse_stream(stream):
    """Read lines from stream and push updates whenever a full set is received."""
    distances: dict[str, float] = {}
    ir_triggered = False

    for raw_line in stream:
        if isinstance(raw_line, bytes):
            raw_line = raw_line.decode("utf-8", errors="replace")
        line = raw_line.strip()
        if not line:
            continue

        m = _DIST_PATTERN.match(line)
        if m:
            key = m.group(1).lower()
            distances[key] = float(m.group(2))

        if "empty slot" in line.lower():
            pass  # counted in distances

        if "car is parked" in line.lower():
            pass

        # IR trigger heuristic: if the Arduino opens the servo it prints "IR LOW"
        if "ir" in line.lower() and "low" in line.lower():
            ir_triggered = True

        # Once all 3 distances are collected, push and reset
        if len(distances) >= 3:
            push(distances, ir_triggered)
            distances = {}
            ir_triggered = False

        time.sleep(0.01)  # small yield


def from_stdin():
    print("Reading Wokwi serial from stdin ... (Ctrl+C to stop)")
    parse_stream(sys.stdin)


def from_serial_port(port: str, baud: int):
    try:
        import serial  # pyserial
    except ImportError:
        print("Install pyserial:  pip install pyserial")
        sys.exit(1)

    print(f"Opening serial port {port} @ {baud} baud ...")
    with serial.Serial(port, baud, timeout=1) as ser:
        parse_stream(ser)


def from_file(path: str):
    print(f"Replaying serial log: {path}")
    with open(path, "r") as f:
        parse_stream(f)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ParkVision Wokwi Serial Bridge")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--port", help="Serial port (e.g. /dev/ttyUSB0 or COM3)")
    group.add_argument("--file", help="Replay a saved serial log file")
    parser.add_argument("--baud", type=int, default=9600)
    args = parser.parse_args()

    if args.port:
        from_serial_port(args.port, args.baud)
    elif args.file:
        from_file(args.file)
    else:
        from_stdin()