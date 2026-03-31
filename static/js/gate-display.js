const GATE_BASE_URL = window.API_BASE_URL || "http://127.0.0.1:5000";

async function loadGateState() {
    try {
        const res = await fetch(`${GATE_BASE_URL}/api/gate_state`);
        const data = await res.json();
        console.log("[gate] state", data);

        const mode = String(data.mode || "entry").toUpperCase();
        const modeEl = document.getElementById("gateMode");
        const msgEl = document.getElementById("gateMessage");
        const vehicleEl = document.getElementById("gateVehicle");
        const dotEl = document.getElementById("statusDot");

        if (modeEl) modeEl.textContent = mode;
        if (msgEl) msgEl.textContent = data.message || "";
        if (vehicleEl) vehicleEl.textContent = data.vehicle_no || "--";

        if (dotEl) {
            dotEl.classList.remove("is-entry", "is-exit");
            dotEl.classList.add(mode === "EXIT" ? "is-exit" : "is-entry");
        }
    } catch (err) {
        console.error("[gate] failed", err);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadGateState();
    setInterval(loadGateState, 2500);
});
