const BASE_URL =
    window.API_BASE_URL || window.ADMIN_BASE_URL || "http://127.0.0.1:5000";
const TOKEN_KEY = "adminToken";

document.getElementById("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const messageElement = document.getElementById("message");
    const loginButton = document.querySelector(".login-button");

    messageElement.className = "message";
    messageElement.textContent = "";

    if (!username) {
        showError("Please enter your username");
        return;
    }
    if (!password) {
        showError("Please enter your password");
        return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Logging in...";

    try {
        console.log("[login] POST /api/login");
        const response = await fetch(`${BASE_URL}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json().catch(() => ({}));

        if (data.success && data.token) {
            localStorage.setItem(TOKEN_KEY, data.token);
            showSuccess("Login successful! Redirecting...");
            setTimeout(() => {
                window.location.href = "/admin";
            }, 600);
        } else {
            showError(data.message || "Invalid username or password");
            loginButton.disabled = false;
            loginButton.textContent = "login";
        }
    } catch (err) {
        console.error("[login] error", err);
        showError("Cannot reach server. Is Flask running?");
        loginButton.disabled = false;
        loginButton.textContent = "login";
    }
});

function showError(message) {
    const messageElement = document.getElementById("message");
    messageElement.textContent = message;
    messageElement.className = "message error";
}

function showSuccess(message) {
    const messageElement = document.getElementById("message");
    messageElement.textContent = message;
    messageElement.className = "message success";
}

document.querySelector(".forgot-password a").addEventListener("click", function (e) {
    e.preventDefault();
    showError("Contact system administrator to reset password.");
});

document.getElementById("username").addEventListener("input", function () {
    const messageElement = document.getElementById("message");
    if (messageElement.className.includes("error")) {
        messageElement.className = "message";
        messageElement.textContent = "";
    }
});

document.getElementById("password").addEventListener("input", function () {
    const messageElement = document.getElementById("message");
    if (messageElement.className.includes("error")) {
        messageElement.className = "message";
        messageElement.textContent = "";
    }
});

document.getElementById("password").addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
        document.getElementById("loginForm").dispatchEvent(new Event("submit"));
    }
});
