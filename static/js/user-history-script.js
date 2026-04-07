const BASE_URL = "http://127.0.0.1:5000";
const vehicleNo = "TS09UD0036";  // same as in user.js

let parkingHistory = [];

function toggleMenu() {
    const menu = document.getElementById("dropdownMenu");
    menu.style.display =
        menu.style.display === "block" ? "none" : "block";
}

// =============================
// LOAD HISTORY FROM BACKEND
// =============================
async function loadHistoryData() {

    const tableBody = document.getElementById('tableBody');
    const emptyState = document.getElementById('emptyState');

    try {

        const response = await fetch(`${BASE_URL}/api/history/${vehicleNo}`);
        const data = await response.json();

        parkingHistory = data;

        if (!parkingHistory || parkingHistory.length === 0) {
            emptyState.style.display = 'block';
            tableBody.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';

        tableBody.innerHTML = parkingHistory.map((entry) => {

            const entryDate = new Date(entry.entry_time);
            const durationMinutes = entry.total_duration_minutes;

            return `
                <tr>
                    <td>${entryDate.toLocaleDateString()}</td>
                    <td>${entry.slot_id}</td>
                    <td>${durationMinutes} mins</td>
                    <td>₹ ${entry.payment_amount}</td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error("History load error:", error);
    }
}

// =============================
// PDF DOWNLOAD
// =============================
function downloadPDF() {

    const element = document.getElementById('historyTable');

    if (!parkingHistory || parkingHistory.length === 0) {
        alert("No history available.");
        return;
    }

    const printWindow = window.open('', '', 'height=600,width=800');

    const htmlContent = `
        <html>
        <head>
            <title>Parking History</title>
            <style>
                body { font-family: Arial; padding: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #000; padding: 8px; }
                th { background: #f0f0f0; }
            </style>
        </head>
        <body>
            <h2>Parking History - ${vehicleNo}</h2>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Slot</th>
                        <th>Duration</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${parkingHistory.map(entry => `
                        <tr>
                            <td>${new Date(entry.entry_time).toLocaleDateString()}</td>
                            <td>${entry.slot_id}</td>
                            <td>${entry.total_duration_minutes} mins</td>
                            <td>₹ ${entry.payment_amount}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </body>
        </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    setTimeout(() => {
        printWindow.print();
    }, 300);
}

// =============================
// INIT
// =============================
document.addEventListener('DOMContentLoaded', loadHistoryData);