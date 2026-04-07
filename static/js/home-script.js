let _tooltipBound = false;
/* ---------------------------
   DASHBOARD STATS
----------------------------*/
async function loadDashboard() {
    try {
        const hasToken = !!localStorage.getItem("adminToken");
        const response = await adminFetch("/api/admin/dashboard", { method: "GET" });
        if (!response.ok) {
            const snippet = await response.text().catch(() => "");
            console.error(
                "[admin-dashboard] HTTP",
                response.status,
                snippet.slice(0, 300),
                "| token in storage:",
                hasToken
            );
            throw new Error("dashboard " + response.status);
        }
        const data = await response.json();
        console.log("[admin-dashboard] data:", data, "| token:", hasToken);

        document.getElementById("totalSlots").innerText = data.total_slots ?? 0;
        document.getElementById("availableSlots").innerText = data.available_slots ?? 0;
        document.getElementById("occupiedSlots").innerText = data.occupied_slots ?? 0;
    } catch (e) {
        console.error("Failed to load dashboard stats", e);
    }
}


/* ---------------------------
   LOAD SLOT STATUS
----------------------------*/
async function loadSlots() {
    try {
        const response = await adminFetch("/api/admin/slot_status", { method: "GET" });
        if (!response.ok) {
            const snippet = await response.text().catch(() => "");
            console.error("[slot_status] HTTP", response.status, snippet.slice(0, 300));
            throw new Error("slot_status " + response.status);
        }
        const slots = await response.json();
        console.log("[slot_status] slots from API:", Array.isArray(slots) ? slots.length : slots);

        slots.forEach(slot => {
            const sid = slot.slot_id != null ? String(slot.slot_id) : "";
            const element = document.querySelector(`[data-slot="${sid}"]`);
            if (!element) return;

            element.classList.remove("available", "occupied", "overtime");
            element.dataset.slot = slot.slot_id;

            if (slot.status === "available") {
                element.classList.add("available");
                element.dataset.vehicle = "";
                element.dataset.entryDate = "";
                element.dataset.entryTime = "";
                element.dataset.exitTime = "";
                element.dataset.overtime = "false";
            } else {
                element.classList.add(slot.overtime ? "overtime" : "occupied");

                const entryDt = slot.entry_time ? new Date(slot.entry_time) : null;
                const exitDt = slot.predicted_exit ? new Date(slot.predicted_exit) : null;

                element.dataset.vehicle = slot.vehicle_no ?? "";
                element.dataset.entryDate = entryDt ? entryDt.toLocaleDateString() : "";
                element.dataset.entryTime = entryDt ? entryDt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                element.dataset.exitTime = exitDt ? exitDt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                element.dataset.overtime = String(!!slot.overtime);
            }
        });
    } catch (e) {
        console.error("Failed to load slot status", e);
    }
}

function bindSlotTooltipOnce() {
    if (_tooltipBound) return;
    _tooltipBound = true;

    const tooltip = document.getElementById("tooltip");
    if (!tooltip) {
        console.warn("Tooltip container missing (#tooltip).");
        return;
    }

    document.querySelectorAll(".slot").forEach(slotEl => {
        slotEl.addEventListener("mouseenter", (e) => {
            if (!slotEl.dataset.vehicle) return;

            const overtime = slotEl.dataset.overtime === "true";
            const overtimeText = overtime ? "OVERTIME" : "On time";

            const setText = (id, value) => {
                const el = document.getElementById(id);
                if (el) el.innerText = value ?? "";
            };

            setText("tooltip-slot", slotEl.dataset.slot);
            setText("tooltip-vehicle", slotEl.dataset.vehicle);
            setText("tooltip-entry-date", slotEl.dataset.entryDate);
            setText("tooltip-entry-time", slotEl.dataset.entryTime);
            setText("tooltip-exit-time", slotEl.dataset.exitTime);
            setText("tooltip-overtime", overtimeText);

            tooltip.classList.remove("hidden");
            tooltip.style.left = e.pageX + "px";
            tooltip.style.top = e.pageY + "px";
        });

        slotEl.addEventListener("mouseleave", () => {
            tooltip.classList.add("hidden");
        });

        slotEl.addEventListener("mousemove", (e) => {
            if (tooltip.classList.contains("hidden")) return;
            tooltip.style.left = (e.pageX + 10) + "px";
            tooltip.style.top = (e.pageY + 10) + "px";
        });
    });
}

/* ---------------------------
   PARKING ENTRY LIST
----------------------------*/
async function loadEntryList() {

    try {
        const response = await adminFetch("/api/admin/active_sessions", { method: "GET" });
        if (!response.ok) {
            const snippet = await response.text().catch(() => "");
            console.error("[active_sessions] HTTP", response.status, snippet.slice(0, 300));
            throw new Error("active_sessions " + response.status);
        }
        const sessions = await response.json();
        console.log("[active_sessions] rows:", Array.isArray(sessions) ? sessions.length : sessions);

        const container = document.getElementById("entryListContainer");
        if (!container) return;

        container.innerHTML = "";

        (sessions ?? []).slice(0, 10).forEach(session => {
            const entryDt = session.entry_time ? new Date(session.entry_time) : null;
            const entryTime = entryDt ? entryDt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
            const entryDate = entryDt ? entryDt.toLocaleDateString() : "";

            const row = `
            <div class="entry-item">
                <div class="entry-left">
                    <span class="entry-time">${entryTime} • ${entryDate}</span>
                    <span class="entry-vehicle">${session.vehicle_no ?? ""}</span>
                </div>
                <span class="entry-count">${session.slot_id ?? ""}</span>
            </div>
            `;

            container.innerHTML += row;
        });
    } catch (e) {
        console.error("Failed to load entry list", e);
    }

}


/* ---------------------------
   AUTO REFRESH
----------------------------*/
function initAdminDashboard() {

    if (window.dashboardStarted) return;
    window.dashboardStarted = true;

    console.log("Initializing Admin Dashboard...");

    loadDashboard();
    loadSlots();
    loadEntryList();
    bindSlotTooltipOnce();

    setInterval(loadDashboard, 5000);
    setInterval(loadSlots, 5000);
    setInterval(loadEntryList, 5000);
}

window.addEventListener("admin-auth-ready", () => {
    console.log("Auth ready → loading dashboard");
    initAdminDashboard();
});

document.addEventListener("DOMContentLoaded", () => {
    console.log("Fallback → loading dashboard");
    setTimeout(() => {
        if (!window.dashboardStarted) {
            initAdminDashboard();
        }
    }, 500);
});