const PAGE_SIZE = 20;
let currentPage = 1;
let totalPages = 1;
let pageRows = [];

const vehicleSearch = document.getElementById("vehicleTypeSearch");
const dateFilter = document.getElementById("dateFilter");
const clearFilterBtn = document.getElementById("clearFilterBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const historyTableBody = document.getElementById("historyTableBody");
const paginationContainer = document.getElementById("paginationContainer");

function getVehicleType(slot) {
    if (slot.startsWith("G0")) return "bike";
    if (slot.startsWith("G1") || slot.startsWith("G2")) return "car";
    if (slot.startsWith("G3")) return "heavy";
    return "";
}

function applyLocalFilters(rows) {
    const typeSearch = document.getElementById("vehicleTypeSearch").value.toLowerCase();
    const level = document.getElementById("levelFilter").value;
    const date = document.getElementById("dateFilter").value;

    return rows.filter(row => {
        const vehicleType = getVehicleType(row.slot);

        return (
            (!typeSearch || vehicleType.includes(typeSearch)) &&
            (!level || row.slot.startsWith(level)) &&
            (!date || row.date === date)
        );
    });
}

function renderTable(rows) {
    historyTableBody.innerHTML = "";
    if (!rows.length) {
        historyTableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No records found.</td></tr>';
        return;
    }
    rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${row.vehicleNo || ""}</td>
            <td>${row.slot || ""}</td>
            <td>${row.entryTime || ""}</td>
            <td>${row.exitTime || ""}</td>
            <td>${row.durationMinutes || 0} min</td>
            <td>${Number(row.payment || 0).toFixed(2)}</td>
            <td>${String(row.paymentStatus || "pending").toUpperCase()}</td>
        `;
        historyTableBody.appendChild(tr);
    });
}

function renderPagination() {
    if (!paginationContainer) return;
    paginationContainer.innerHTML = "";

    const prevBtn = document.createElement("button");
    prevBtn.className = "page-btn";
    prevBtn.textContent = "Previous";
    prevBtn.disabled = currentPage <= 1;
    prevBtn.addEventListener("click", () => {
        if (currentPage > 1) loadHistory(currentPage - 1).catch((err) => console.error("API Error:", err));
    });

    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Page ${currentPage} of ${totalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.className = "page-btn";
    nextBtn.textContent = "Next";
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.addEventListener("click", () => {
        if (currentPage < totalPages) loadHistory(currentPage + 1).catch((err) => console.error("API Error:", err));
    });

    paginationContainer.appendChild(prevBtn);
    paginationContainer.appendChild(info);
    paginationContainer.appendChild(nextBtn);
}

async function loadHistory(page = 1) {
    const response = await adminFetch(`/api/admin/history?page=${page}&limit=${PAGE_SIZE}`, { method: "GET" });
    if (!response.ok) {
        const snippet = await response.text().catch(() => "");
        throw new Error(`history ${response.status} ${snippet.slice(0, 150)}`);
    }
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    currentPage = Number(payload?.page || page || 1);
    totalPages = Math.max(1, Number(payload?.total_pages || 1));
    pageRows = rows.map((row) => ({
        date: row.date || "",
        vehicleNo: row.vehicle_no || "",
        slot: row.slot_id || "",
        entryTime: row.entry_time || "",
        exitTime: row.exit_time || "",
        durationMinutes: row.duration_minutes || 0,
        payment: row.total_payment ?? row.payment ?? 0,
        paymentStatus: row.payment_status || "pending",
    }));

    renderTable(applyLocalFilters(pageRows));
    renderPagination();
}

function clearFilters() {
    if (vehicleSearch) vehicleSearch.value = "";
    if (dateFilter) dateFilter.value = "";
    renderTable(applyLocalFilters(pageRows));
}

function downloadCSV() {
    const rows = applyLocalFilters(pageRows);
    if (!rows.length) return;
    const esc = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    let csv = "Vehicle No,Slot,Entry Time,Exit Time,Duration,Payment,Status\n";
    rows.forEach((r) => {
        csv += `${esc(r.vehicleNo)},${esc(r.slot)},${esc(r.entryTime)},${esc(r.exitTime)},${esc(r.durationMinutes)} min,${esc(Number(r.payment || 0).toFixed(2))},${esc(String(r.paymentStatus || "").toUpperCase())}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parking_history.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadPDF() {
    const rows = applyLocalFilters(pageRows);
    if (!rows.length || !window.jspdf?.jsPDF) return;
    const doc = new window.jspdf.jsPDF({ orientation: "landscape" });
    doc.text("Parking history", 14, 14);
    doc.autoTable({
        startY: 20,
        head: [["Vehicle No", "Slot", "Entry Time", "Exit Time", "Duration", "Payment", "Status"]],
        body: rows.map((r) => [
            r.vehicleNo || "",
            r.slot || "",
            r.entryTime || "",
            r.exitTime || "",
            `${r.durationMinutes || 0} min`,
            Number(r.payment || 0).toFixed(2),
            String(r.paymentStatus || "").toUpperCase(),
        ]),
    });
    doc.save("parking_history.pdf");
}

document.addEventListener("DOMContentLoaded", () => {

    console.log("Page loaded - forcing init");

    if (typeof initAdminDashboard === "function") {
        initAdminDashboard();
    }

    if (typeof loadHistory === "function") {
        loadHistory(1);
    }

    // ================= FILTERS START =================

    const typeFilter = document.getElementById("vehicleTypeSearch");
    const levelFilter = document.getElementById("levelFilter");
    const dateFilter = document.getElementById("dateFilter");
    const clearBtn = document.getElementById("clearFilterBtn");

    function applyAllFilters() {
        const type = typeFilter.value.toLowerCase();
        const level = levelFilter.value;
        const date = dateFilter.value;

        const filtered = pageRows.filter(row => {
            const slot = row.slot || "";

            let vehicleType = "";
            if (slot.startsWith("G0")) vehicleType = "bike";
            else if (slot.startsWith("G1") || slot.startsWith("G2")) vehicleType = "car";
            else if (slot.startsWith("G3")) vehicleType = "heavy";

            return (
                (!type || vehicleType === type) &&
                (!level || slot.startsWith(level)) &&
                (!date || (row.entry_time && row.entry_time.startsWith(date)))
            );
        });

        renderTable(filtered);
    }

    if (typeFilter) typeFilter.addEventListener("change", applyAllFilters);
    if (levelFilter) levelFilter.addEventListener("change", applyAllFilters);
    if (dateFilter) dateFilter.addEventListener("change", applyAllFilters);

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            typeFilter.value = "";
            levelFilter.value = "";
            dateFilter.value = "";
            renderTable(pageRows);
        });
    }

    // ================= FILTERS END =================

    // DROPDOWN (your existing code continues...)
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
    // ================= DOWNLOAD BUTTONS =================

const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");

if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener("click", () => {
        console.log("CSV clicked");
        downloadCSV();
    });
}

if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener("click", () => {
        console.log("PDF clicked");
        downloadPDF();
    });
}
});

window.addEventListener("admin-auth-ready", () => {
    loadHistory(1).catch((err) => {
        console.error("API Error:", err);
        historyTableBody.innerHTML = '<tr><td colspan="7" class="empty-state">Error loading data from backend.</td></tr>';
    });
});
