let enteredResetScheduled = false;

async function loadGateState() {
    try {
        const res = await fetch("/api/gate_state");
        const data = await res.json();

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
        if (qrEl) qrEl.style.display = data.show_qr ? "block" : "none";

        if (dotEl) {
            dotEl.classList.remove("is-entry", "is-exit");
            dotEl.classList.add(mode === "EXIT" ? "is-exit" : "is-entry");
        }

        if (modeRaw === "entered" && !enteredResetScheduled) {
            enteredResetScheduled = true;
            setTimeout(async () => {
                try {
                    await fetch("/api/gate/update", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            mode: "idle",
                            message: "Waiting for vehicle...",
                            vehicle_no: "",
                        }),
                    });
                } catch (err) {
                    console.error("API Error:", err);
                } finally {
                    enteredResetScheduled = false;
                }
            }, 5000);
        }
    } catch (err) {
        console.error("API Error:", err);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadGateState().catch((err) => console.error("API Error:", err));
    setInterval(() => {
        loadGateState().catch((err) => console.error("API Error:", err));
    }, 2500);
});
