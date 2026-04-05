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

let allHistoryRows = [];
let filterState = {
    vehicleType: '',
    level: '',
    date: ''
};
let currentPage = 1;
const PAGE_SIZE = 25;

const vehicleTypeSearch = document.getElementById('vehicleTypeSearch');
const levelFilter = document.getElementById('levelFilter');
const dateFilter = document.getElementById('dateFilter');
const clearFilterBtn = document.getElementById('clearFilterBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const historyTableBody = document.getElementById('historyTableBody');
const paginationContainer = document.getElementById('paginationContainer');

async function loadHistory() {
    console.log("History data:", allHistoryRows);
    try {
        const response = await adminFetch("/api/admin/history", { method: "GET" });
        if (!response.ok) {
            const snippet = await response.text().catch(() => "");
            console.error("[admin-history] HTTP", response.status, snippet.slice(0, 300));
            throw new Error("history " + response.status);
        }
        const data = await response.json();
        console.log("[admin-history] rows:", Array.isArray(data) ? data.length : data);

        allHistoryRows = (data || []).map(row => ({
            date: row.date,
            vehicleNo: row.vehicle_no,
            vehicleType: row.vehicle_type,
            level: row.level || '',
            slot: row.slot_id,
            entryTime: row.entry_time,
            exitTime: row.exit_time,
            payment: row.payment
        }));
        applyFilters();
    } catch (error) {
        console.error("Error loading history data", error);
        historyTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">Error loading data from backend.</td>
            </tr>
        `;
    }
}

function applyFilters() {
    // Normalize all values before comparing (case-insensitive + trimmed).
    const normStr = (v) => (v ?? "").toString().trim();
    const normLower = (v) => normStr(v).toLowerCase();

    filterState.vehicleType = normLower(vehicleTypeSearch?.value);
    filterState.level = normLower(levelFilter?.value);
    filterState.date = normStr(dateFilter?.value); // YYYY-MM-DD from <input type="date">

    const filtered = allHistoryRows.filter((row) => {
        const rowVehicleType = normLower(row.vehicleType);
        const rowLevel = normLower(row.level);
        const rowDate = normStr(row.date);

        if (filterState.vehicleType) {
            if (!rowVehicleType.includes(filterState.vehicleType)) return false;
        }
        if (filterState.level) {
            if (rowLevel !== filterState.level) return false;
        }
        if (filterState.date) {
            if (rowDate !== filterState.date) return false;
        }
        return true;
    });

    currentPage = 1;
    console.log("[history] applyFilters → rows:", filtered.length, filterState);
    renderTableWithPagination(filtered);
}

/** All rows matching current filters (for PDF/CSV export, not just current page). */
function getFilteredHistoryRows() {
    // Reuse the same comparison logic as applyFilters.
    const normStr = (v) => (v ?? "").toString().trim();
    const normLower = (v) => normStr(v).toLowerCase();

    const vt = normLower(vehicleTypeSearch?.value);
    const level = normLower(levelFilter?.value);
    const df = normStr(dateFilter?.value);

    return allHistoryRows.filter((row) => {
        const rowVehicleType = normLower(row.vehicleType);
        const rowLevel = normLower(row.level);
        const rowDate = normStr(row.date);

        if (vt) {
            if (!rowVehicleType.includes(vt)) return false;
        }
        if (level) {
            if (rowLevel !== level) return false;
        }
        if (df) {
            if (rowDate !== df) return false;
        }
        return true;
    });
}

function renderTableWithPagination(data) {
    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = data.slice(start, start + PAGE_SIZE);

    renderTable(pageRows);
    renderPagination(totalPages);
}

function renderTable(data) {
    historyTableBody.innerHTML = '';

    if (!data.length) {
        historyTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">No records found matching your filters.</td>
            </tr>
        `;
        return;
    }

    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.date || ''}</td>
            <td>${row.vehicleNo || ''}</td>
            <td>${row.vehicleType || ''}</td>
            <td>${row.slot || ''}</td>
            <td>${row.entryTime || ''}</td>
            <td>${row.exitTime || ''}</td>
            <td>${row.payment != null ? row.payment : ''}</td>
        `;
        historyTableBody.appendChild(tr);
    });
}

function renderPagination(totalPages) {
    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';
    if (totalPages <= 1) return;

    const filtered = getFilteredHistoryRows();
    const total = filtered.length;
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);

    // Info line
    const info = document.createElement('div');
    info.className = 'page-info';
    info.style.width = '100%';
    info.textContent = `Showing ${start}–${end} of ${total} records`;
    paginationContainer.appendChild(info);

    const makeButton = (label, page, disabled = false, active = false) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = 'page-btn' + (active ? ' active' : '');
        btn.disabled = disabled;
        btn.addEventListener('click', () => {
            currentPage = page;
            applyFilters();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        return btn;
    };

    // Prev arrow
    paginationContainer.appendChild(
        makeButton('← Prev', currentPage - 1, currentPage === 1)
    );

    // Page number buttons — show max 5 around current page
    const delta = 2;
    const rangeStart = Math.max(1, currentPage - delta);
    const rangeEnd = Math.min(totalPages, currentPage + delta);

    if (rangeStart > 1) {
        paginationContainer.appendChild(makeButton('1', 1));
        if (rangeStart > 2) {
            const dots = document.createElement('span');
            dots.textContent = '...';
            dots.style.cssText = 'padding:0 4px;color:var(--color-text-secondary,#888);';
            paginationContainer.appendChild(dots);
        }
    }

    for (let p = rangeStart; p <= rangeEnd; p++) {
        paginationContainer.appendChild(makeButton(String(p), p, false, p === currentPage));
    }

    if (rangeEnd < totalPages) {
        if (rangeEnd < totalPages - 1) {
            const dots = document.createElement('span');
            dots.textContent = '...';
            dots.style.cssText = 'padding:0 4px;color:var(--color-text-secondary,#888);';
            paginationContainer.appendChild(dots);
        }
        paginationContainer.appendChild(makeButton(String(totalPages), totalPages));
    }

    // Next arrow
    paginationContainer.appendChild(
        makeButton('Next →', currentPage + 1, currentPage === totalPages)
    );
}

function clearFilters() {
    vehicleTypeSearch.value = '';
    if (levelFilter) levelFilter.value = '';
    dateFilter.value = '';
    filterState = { vehicleType: '', level: '', date: '' };
    applyFilters();
}

function downloadPDF() {
    const rows = getFilteredHistoryRows();
    if (!rows.length) {
        alert("No data to export for the current filters.");
        return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
        console.error("jsPDF not loaded");
        alert("PDF library failed to load. Check your network connection.");
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Parking history (filtered)", 14, 16);
    doc.autoTable({
        startY: 22,
        head: [
            [
                "Date",
                "Vehicle No.",
                "Slot",
                "Level",
                "Entry time",
                "Exit time",
                "Payment",
            ],
        ],
        body: rows.map((r) => [
            r.date || "",
            r.vehicleNo || "",
            r.slot || "",
            r.level || "",
            r.entryTime || "",
            r.exitTime || "",
            r.payment != null ? String(r.payment) : "",
        ]),
    });
    doc.save("parking_history.pdf");
    console.log("[PDF] exported", rows.length, "rows");
}

function downloadCSV() {
    const rows = getFilteredHistoryRows();

    if (!rows.length) {
        alert("No data to export");
        return;
    }
    console.log("[CSV] export rows:", rows.length, "filters:", filterState);

    let csv = "Date,Vehicle No.,Vehicle Type,Slot,Level,Entry Time,Exit Time,Payment\n";

    rows.forEach((r) => {
        // Quote to keep CSV valid when fields contain commas/quotes.
        const esc = (v) => {
            const s = (v ?? "").toString();
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        csv += `${esc(r.date)},${esc(r.vehicleNo)},${esc(r.vehicleType)},${esc(r.slot)},${esc(r.level)},${esc(r.entryTime)},${esc(r.exitTime)},${esc(r.payment)}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "parking_history.csv");

    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
}

document.addEventListener("DOMContentLoaded", () => {
    // Bind UI events as soon as DOM is ready (independent from admin-auth-ready).
    if (vehicleTypeSearch) vehicleTypeSearch.addEventListener("input", applyFilters);
    if (levelFilter) levelFilter.addEventListener("change", applyFilters);
    if (dateFilter) dateFilter.addEventListener("change", applyFilters);
    if (clearFilterBtn) clearFilterBtn.addEventListener("click", clearFilters);
    if (downloadPdfBtn) downloadPdfBtn.addEventListener("click", downloadPDF);
    if (downloadCsvBtn) downloadCsvBtn.addEventListener("click", downloadCSV);

    // If admin-auth-ready already fired before this page bound handlers,
    // token existence is our fallback trigger.
    if (localStorage.getItem("adminToken")) {
        console.log("[history] fallback token present → loadHistory");
        loadHistory();
    }
});

window.addEventListener("admin-auth-ready", () => {
    console.log("[history] auth ready → loadHistory");
    loadHistory();
});
