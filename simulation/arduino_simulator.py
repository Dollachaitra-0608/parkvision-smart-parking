"""
Run this when a vehicle is detected at entry or exit in Wokwi.
Usage:
  python simulation/arduino_simulator.py entry
  python simulation/arduino_simulator.py exit
  python simulation/arduino_simulator.py exit --vehicle TS09AB1234
"""
import os
import socket
import sys
import requests

DEFAULT_HOST = socket.gethostbyname(socket.gethostname())
FLASK_URL = os.environ.get("PARKVISION_BACKEND_URL", f"http://{DEFAULT_HOST}:5000")

def trigger(action, vehicle_no=""):
    resp = requests.post(f"{FLASK_URL}/api/sensor/trigger", json={
        "action": action,
        "vehicle_no": vehicle_no
    })
    print(f"[{action.upper()}] Server response: {resp.json()}")

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "entry"
    vehicle = ""
    if "--vehicle" in sys.argv:
        idx = sys.argv.index("--vehicle")
        vehicle = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else ""
    trigger(action, vehicle)