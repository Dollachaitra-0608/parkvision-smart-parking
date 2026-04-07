// User Dropdown Toggle
const userBtn = document.querySelector('.user-btn');
const userDropdown = document.querySelector('.user-dropdown');

if (userBtn && userDropdown) {
    userBtn.addEventListener('click', () => {
        userDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!userDropdown.contains(e.target) && !userBtn.contains(e.target)) {
            userDropdown.classList.remove('active');
        }
    });
}

// Navigation Link Active State
const navLinks = document.querySelectorAll('.nav-link');
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        navLinks.forEach(l => l.classList.remove('active'));
        e.target.classList.add('active');
    });
});

// Initialize charts with Chart.js
let vehicleTypeChart = null;
let revenueChart = null;
let sessionsChart = null;

// ============================
// FETCH & INIT
// ============================
// Fallback keeps charts working if script order is wrong (still sends Bearer token).
function adminApiFetch(path, options) {
    if (typeof adminFetch === "function") {
        return adminFetch(path, options);
    }
    const base =
        window.ADMIN_BASE_URL ||
        window.API_BASE_URL ||
        "http://127.0.0.1:5000";
    const token = localStorage.getItem("adminToken");
    const opts = Object.assign({}, options);
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers["Authorization"] = "Bearer " + token;
    opts.headers = headers;
    return fetch(base + path, opts);
}

async function fetchStatistics(start = "", end = "") {
    try {
        const path =
            start && end
                ? `/api/admin/statistics?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`
                : `/api/admin/statistics`;

        const response = await adminApiFetch(path, { method: "GET" });
        if (!response.ok) {
            const snippet = await response.text().catch(() => "");
            console.error("[statistics] HTTP", response.status, snippet.slice(0, 300));
            throw new Error(`API error ${response.status}`);
        }
        const data = await response.json();
        console.log("[statistics] loaded", start || "all", end || "all", "| keys:", data && Object.keys(data));

        renderNoDataMessageIfNeeded(data, start, end);

        updateStatCards(data);
        initializeVehicleTypeChart(data);
        initializeRevenueChart(data);
        initializeSessionsChart(data);

        console.log('Statistics loaded:', start || 'all', '-', end || 'all');
    } catch (error) {
        console.error('Failed to load statistics data', error);
    }
}

function renderNoDataMessageIfNeeded(data, start, end) {
    const hasVehicleCounts =
        data && data.vehicle_type_counts && Object.keys(data.vehicle_type_counts).length > 0;
    const hasRevenue = Array.isArray(data && data.revenue_by_date) && data.revenue_by_date.length > 0;
    const hasSessions = Array.isArray(data && data.sessions_by_date) && data.sessions_by_date.length > 0;

    const noData = !hasVehicleCounts && !hasRevenue && !hasSessions;

    // Create a message container without changing layout/CSS files
    let msg = document.getElementById("noDataMessage");
    if (!msg) {
        msg = document.createElement("div");
        msg.id = "noDataMessage";
        msg.style.marginTop = "10px";
        msg.style.padding = "10px 12px";
        msg.style.borderRadius = "8px";
        msg.style.background = "rgba(245, 166, 73, 0.15)";
        msg.style.color = "#8b5a3c";
        msg.style.fontWeight = "600";

        const filtersSection = document.querySelector(".filters-section");
        if (filtersSection) {
            filtersSection.appendChild(msg);
        } else {
            document.body.appendChild(msg);
        }
    }

    if (noData && start && end) {
        msg.textContent = "No parking data available for selected date range";
        msg.style.display = "block";
    } else {
        msg.style.display = "none";
    }
}

function updateStatCards(data) {
    const amountEl = document.querySelector('.amount');
    const durationEl = document.querySelector('.duration-text');
    const peakEl = document.querySelector('.peak-time');
    const bestTimeEl = document.querySelector('.best-time');

    if (amountEl) {
        const total = data.total_revenue || 0;
        amountEl.textContent = `₹${total.toFixed(2)}`;
    }

    if (durationEl) {
        const minutes = data.average_duration_minutes || 0;
        const hrs = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        durationEl.textContent = (hrs || mins)
            ? `${hrs ? hrs + ' hr ' : ''}${mins ? mins + ' min' : ''}`.trim()
            : '0 min';
    }

    if (peakEl) {
        peakEl.textContent = data.peak_hour || 'N/A';
    }

    if (bestTimeEl) {
        bestTimeEl.textContent = data.best_time_to_park || 'N/A';
    }
}

// ============================
// CHARTS
// ============================

function initializeVehicleTypeChart(stats) {
    const ctx = document.getElementById('vehicleTypeChart');
    if (!ctx) return;

    const rawCounts = stats.vehicle_type_counts || {};

    // ORDER (VERY IMPORTANT)
    const labels = ["car", "bike", "heavy"];

    // Pretty labels for UI legend
    const displayLabels = ["Car", "Bike", "Heavy"];

    // Colors aligned with legend
    const colors = ["#5a8f5a", "#d4a574", "#f5a649"];

    // Make backend mapping case-insensitive (e.g., "Bike" vs "bike").
    const normalizedCounts = {};
    Object.entries(rawCounts).forEach(([k, v]) => {
        const key = (k ?? "").toString().trim().toLowerCase();
        normalizedCounts[key] = Number(v || 0);
    });

    const values = labels.map((k) => normalizedCounts[k] || 0);

    if (vehicleTypeChart) {
        vehicleTypeChart.data.labels = displayLabels;
        vehicleTypeChart.data.datasets[0].data = values;
        vehicleTypeChart.data.datasets[0].backgroundColor = colors;
        vehicleTypeChart.update();
        return;
    }

    vehicleTypeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: displayLabels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: ${context.parsed}%`
                    }
                }
            }
        }
    });
}

function initializeRevenueChart(stats) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;

    const revenue = stats.revenue_by_date || [];
    const labels = revenue.map(r => r.date);
    const values = revenue.map(r => r.revenue);

    if (revenueChart) {
        revenueChart.data.labels = labels;
        revenueChart.data.datasets[0].data = values;
        revenueChart.update();
        return;
    }

    revenueChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Revenue',
                data: values,
                backgroundColor: '#5a8f5a',
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => '₹' + context.parsed.y
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: (value) => '₹' + value },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function initializeSessionsChart(stats) {
    const ctx = document.getElementById('sessionsChart');
    if (!ctx) return;

    const sessions = stats.sessions_by_date || [];
    const labels = sessions.map(s => s.date);
    const values = sessions.map(s => s.count);

    if (sessionsChart) {
        sessionsChart.data.labels = labels;
        sessionsChart.data.datasets[0].data = values;
        sessionsChart.update();
        return;
    }

    sessionsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Parking Sessions',
                data: values,
                borderColor: '#f5a649',
                backgroundColor: 'rgba(245,166,73,0.2)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#f5a649',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(245,166,73,0.9)',
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => context.parsed.y + ' sessions'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 20,
                    ticks: { stepSize: 4 },
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ============================
// FILTER BUTTON LOGIC
// ============================

function toISODate(d) {
    // Use LOCAL date (avoid UTC shift that breaks "Yesterday").
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function attachFilterButtons() {
    const filterButtons = document.querySelectorAll(".filter-btn"); // Today / Yesterday / This Week
    const applyButtons = document.querySelectorAll(".btn-apply"); // there are 2 Apply buttons in the UI
    const startInput = document.getElementById("startDate");
    const endInput = document.getElementById("endDate");

    function setActive(clickedBtn) {
        filterButtons.forEach(b => b.classList.remove("active"));
        if (clickedBtn) clickedBtn.classList.add("active");
    }

    filterButtons.forEach((button) => {
        button.addEventListener("click", async () => {
            const label = (button.innerText || "").trim();
            setActive(button);

            let start = "";
            let end = "";

            if (label === "Today") {
                const today = new Date();
                start = toISODate(today);
                end = start;
            } else if (label === "Yesterday") {
                 const today = new Date();
                 const yesterday = new Date(
                    today.getFullYear(),
                    today.getMonth(),
                    today.getDate() - 1
                );
                start = toISODate(yesterday);
                end = start;
            }
            else if (label === "This Week") {
                // As required: last 7 days (including today)
                const endDt = new Date();
                const startDt = new Date();
                startDt.setDate(endDt.getDate() - 6);
                start = toISODate(startDt);
                end = toISODate(endDt);
            }

            if (startInput && endInput && start && end) {
                startInput.value = start;
                endInput.value = end;
            }

            await fetchStatistics(start, end);
        });
    });

    applyButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
            if (!startInput || !endInput) return;

            const start = startInput.value;
            const end = endInput.value;

            if (!start || !end) {
                console.warn("Select both start and end dates.");
                return;
            }

            // Custom apply: clear active state
            setActive(null);

            await fetchStatistics(start, end);
        });
    });
}

async function loadAIInsights() {
    try {
        const res = await adminApiFetch("/api/predict", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                hour: new Date().getHours(),
                day_of_week: new Date().getDay(),
                vehicle_type: "car"
            })
        });

        const data = await res.json();

        console.log("AI response:", data);  // DEBUG

        const predEl = document.getElementById("aiPrediction");
        const confEl = document.getElementById("aiConfidence");
        if (predEl) predEl.textContent = data.prediction;
        if (confEl) confEl.textContent = Number(data.confidence || 0).toFixed(0) + "%";

    } catch (err) {
        console.error("AI fetch error", err);
    }
}

async function loadSmartStatus() {
    try {
        const res = await adminApiFetch("/api/smart_status", { method: "GET" });
        const data = await res.json();

        document.getElementById("currentStatus").textContent = data.current_status;
        document.getElementById("availableSlots").textContent = data.available_slots;
        document.getElementById("occupiedSlots").textContent = data.occupied_slots;
        const totalSlots = Number(data.available_slots || 0) + Number(data.occupied_slots || 0);
        const occupancyPct = Math.round(Number(data.occupancy_percentage || 0));

        let occupancyEl = document.getElementById("occupancyLine");
        if (!occupancyEl) {
            occupancyEl = document.createElement("div");
            occupancyEl.id = "occupancyLine";
            occupancyEl.style.marginTop = "8px";
            occupancyEl.style.fontWeight = "600";
            occupancyEl.style.color = "#334155";
            const leftCol = document.querySelector(".smart-insight-left");
            if (leftCol) leftCol.appendChild(occupancyEl);
        }
        if (occupancyEl) {
            occupancyEl.textContent = `Occupancy: ${data.occupied_slots} / ${totalSlots} (${occupancyPct}%)`;
        }

        // Parking load-level line (Low / Medium / High Load)
        let loadEl = document.getElementById("loadLevelLine");
        if (!loadEl) {
            loadEl = document.createElement("div");
            loadEl.id = "loadLevelLine";
            loadEl.style.marginTop = "4px";
            loadEl.style.fontWeight = "500";
            loadEl.style.color = "#64748b";
            const leftCol = document.querySelector(".smart-insight-left");
            if (leftCol) leftCol.appendChild(loadEl);
        }
        if (loadEl) {
            const label = data.load_level || "";
            loadEl.textContent = label ? `Parking load: ${label}` : "";
        }

        document.getElementById("smartPrediction").textContent = data.prediction;
        document.getElementById("smartConfidence").textContent =
            Number(data.confidence || 0).toFixed(0) + "%";

        document.getElementById("smartMessage").textContent = data.message;

    } catch (err) {
        console.error("Smart status error", err);
    }
}

// ============================
// DOM READY
// ============================

document.addEventListener("DOMContentLoaded", () => {
    attachFilterButtons();
    loadSmartStatus();

    window.addEventListener("admin-auth-ready", () => {
        const startInput = document.getElementById("startDate");
        const endInput = document.getElementById("endDate");
        const todayIso = toISODate(new Date());
        fetchStatistics();
    });
});
