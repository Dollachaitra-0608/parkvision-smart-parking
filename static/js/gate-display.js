const GATE_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:5000";
let enteredResetScheduled = false;

async function loadGateState() {
    try {
        const res = await fetch(`${GATE_BASE_URL}/api/gate_state`);
        const data = await res.json();
        console.log("[gate] state", data);

        const modeRaw = String(data.mode || "idle").toLowerCase();
        const mode = modeRaw.toUpperCase();
        const modeEl = document.getElementById("gateMode");
        const msgEl = document.getElementById("gateMessage");
        const vehicleEl = document.getElementById("gateVehicle");
        const dotEl = document.getElementById("statusDot");
        const qrEl = document.getElementById("qr-wrapper");

        if (modeEl) modeEl.textContent = mode;
        if (msgEl) msgEl.textContent = data.message || "";
        if (vehicleEl) vehicleEl.textContent = data.vehicle_no || "--";
        if (qrEl) {
            qrEl.style.display = data.show_qr ? "block" : "none";
        }

        if (dotEl) {
            dotEl.classList.remove("is-entry", "is-exit");
            dotEl.classList.add(mode === "EXIT" ? "is-exit" : "is-entry");
        }

        if (modeRaw === "entered" && !enteredResetScheduled) {
            enteredResetScheduled = true;
            setTimeout(async () => {
                try {
                    await fetch(`${GATE_BASE_URL}/api/gate/update`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            mode: "idle",
                            message: "Waiting for vehicle...",
                            vehicle_no: "",
                        }),
                    });
                } catch (e) {
                    console.error("[gate] idle reset failed", e);
                } finally {
                    enteredResetScheduled = false;
                }
            }, 5000);
        }
    } catch (err) {
        console.error("[gate] failed", err);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadGateState();
    setInterval(loadGateState, 2500);
});
