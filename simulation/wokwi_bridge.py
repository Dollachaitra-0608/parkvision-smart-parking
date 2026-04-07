"""
ParkVision Wokwi Bridge
Reads Wokwi Serial Monitor output and calls Flask API automatically.
Run: python simulation/wokwi_bridge.py
"""
import sys, requests, time, threading, msvcrt

FLASK_URL = "http://127.0.0.1:5000"
last_entry = 0
last_exit  = 0
COOLDOWN   = 6

def call_api(action):
    global last_entry, last_exit
    now = time.time()
    if action == "entry":
        if now - last_entry < COOLDOWN: return
        last_entry = now
    else:
        if now - last_exit < COOLDOWN: return
        last_exit = now
    try:
        r = requests.post(f"{FLASK_URL}/api/sensor/trigger",
                          json={"action": action}, timeout=3)
        print(f"\n  *** [{action.upper()}] {r.json().get('message')} ***\n")
    except Exception as e:
        print(f"\n  ERROR: {e}\n")

def watch_wokwi_serial():
    """Watches Wokwi Serial Monitor output file"""
    print("=" * 52)
    print("  ParkVision IoT Bridge — READY")
    print("=" * 52)
    print("  Watching Wokwi serial output...")
    print("  Also: press E = entry | X = exit manually")
    print("=" * 52 + "\n")

    # Also allow manual keyboard override
    def keyboard_listener():
        while True:
            if msvcrt.kbhit():
                key = msvcrt.getch().decode('utf-8', errors='ignore').lower()
                if key == 'e':
                    print("  [MANUAL] Entry triggered!")
                    threading.Thread(target=call_api, args=("entry",), daemon=True).start()
                elif key == 'x':
                    print("  [MANUAL] Exit triggered!")
                    threading.Thread(target=call_api, args=("exit",), daemon=True).start()
            time.sleep(0.1)

    t = threading.Thread(target=keyboard_listener, daemon=True)
    t.start()

    # Read Wokwi serial from stdin if piped
    if not sys.stdin.isatty():
        for raw in sys.stdin:
            line = raw.strip()
            if not line: continue
            print(f"  [ESP32] {line}")
            if "CAR_AT_ENTRY" in line:
                threading.Thread(target=call_api, args=("entry",), daemon=True).start()
            elif "CAR_AT_EXIT" in line:
                threading.Thread(target=call_api, args=("exit",), daemon=True).start()
    else:
        # Keep running for keyboard input
        while True:
            time.sleep(1)

watch_wokwi_serial()