const GATE_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:5000";
<<<<<<< HEAD
let enteredResetScheduled = false;
=======
>>>>>>> e93bac245633b21ba562ae61a1af75b3054bc45e

async function loadGateState() {
    try {
        const res = await fetch(`${GATE_BASE_URL}/api/gate_state`);
        const data = await res.json();
        console.log("[gate] state", data);

<<<<<<< HEAD
        const modeRaw = String(data.mode || "idle").toLowerCase();
        const mode = modeRaw.toUpperCase();
=======
        const mode = String(data.mode || "entry").toUpperCase();
>>>>>>> e93bac245633b21ba562ae61a1af75b3054bc45e
        const modeEl = document.getElementById("gateMode");
        const msgEl = document.getElementById("gateMessage");
        const vehicleEl = document.getElementById("gateVehicle");
        const dotEl = document.getElementById("statusDot");
<<<<<<< HEAD
        const qrEl = document.getElementById("qr-wrapper");
=======
>>>>>>> e93bac245633b21ba562ae61a1af75b3054bc45e

        if (modeEl) modeEl.textContent = mode;
        if (msgEl) msgEl.textContent = data.message || "";
        if (vehicleEl) vehicleEl.textContent = data.vehicle_no || "--";
<<<<<<< HEAD
        if (qrEl) {
            qrEl.style.display = data.show_qr ? "block" : "none";
        }
=======
>>>>>>> e93bac245633b21ba562ae61a1af75b3054bc45e

        if (dotEl) {
            dotEl.classList.remove("is-entry", "is-exit");
            dotEl.classList.add(mode === "EXIT" ? "is-exit" : "is-entry");
        }
<<<<<<< HEAD

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
=======
>>>>>>> e93bac245633b21ba562ae61a1af75b3054bc45e
    } catch (err) {
        console.error("[gate] failed", err);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadGateState();
    setInterval(loadGateState, 2500);
});
