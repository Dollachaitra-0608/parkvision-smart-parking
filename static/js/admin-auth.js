/**
 * Admin auth: signed token in localStorage + adminFetch (Bearer).
 * Load BEFORE other admin scripts. Skips guard on login.html.
 *
 * Override API host: <script>window.API_BASE_URL="http://127.0.0.1:5000";</script> before this file.
 */
(function () {
    const BASE_URL = window.API_BASE_URL || "http://127.0.0.1:5000";
    const TOKEN_KEY = "adminToken";

    window.ADMIN_BASE_URL = BASE_URL;
    window.ADMIN_TOKEN_KEY = TOKEN_KEY;

    const path = (window.location.pathname || "").toLowerCase();
    const isLoginPage = path.endsWith("login.html") || path.endsWith("/login") || path.endsWith("/admin/login");

    window.adminFetch = function (urlPath, options) {
        options = options || {};
        const method = (options.method || "GET").toUpperCase();
        const token = localStorage.getItem(TOKEN_KEY);
        const headers = Object.assign({}, options.headers || {});
        if (token) {
            headers["Authorization"] = "Bearer " + token;
        }
        if (
            method !== "GET" &&
            method !== "HEAD" &&
            options.body != null &&
            !headers["Content-Type"]
        ) {
            headers["Content-Type"] = "application/json";
        }
        return fetch(BASE_URL + urlPath, Object.assign({}, options, { headers }));
    };

    if (isLoginPage) {
        return;
    }

    function bindUserMenuActions() {
        try {
            const logoutLink = document.querySelector('a[href="#logout"]');
            const profileLink = document.querySelector('a[href="#profile"]');
            const settingsLink = document.querySelector('a[href="#settings"]');

            if (logoutLink) {
                logoutLink.addEventListener("click", async (e) => {
                    e.preventDefault();
                    try {
                        await window.adminFetch("/api/logout", { method: "POST" });
                    } catch (err) {
                        // Still clear local token and redirect even if API fails.
                    } finally {
                        localStorage.removeItem(TOKEN_KEY);
                        window.location.href = "/admin/login";
                    }
                });
            }

            if (profileLink) {
                profileLink.addEventListener("click", async (e) => {
                    e.preventDefault();
                    try {
                        const r = await window.adminFetch("/api/auth/me", { method: "GET" });
                        const data = await r.json().catch(() => ({}));
                        if (!r.ok) throw new Error("unauthorized");
                        alert(`Profile:\\n${data.username} (${data.role})`);
                    } catch (err) {
                        alert("Profile not available right now.");
                    }
                });
            }

            if (settingsLink) {
                settingsLink.addEventListener("click", (e) => {
                    e.preventDefault();
                    alert("Settings are not implemented in this demo.");
                });
            }
        } catch (err) {
            // Never block admin page rendering on JS errors.
            console.warn("[admin-auth] failed to bind user menu actions", err);
        }
    }

    async function guard() {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) {
            window.location.href = "/admin/login";
            return;
        }
        try {
            const r = await window.adminFetch("/api/auth/me", { method: "GET" });
            if (!r.ok) {
                throw new Error("unauthorized");
            }
            // Defer one macrotask so later <script> tags have registered "admin-auth-ready"
            // listeners (when document.readyState !== "loading", guard() runs immediately).
            setTimeout(function () {
                console.log("[admin-auth] ready | token stored:", !!localStorage.getItem(TOKEN_KEY));
                window.dispatchEvent(new CustomEvent("admin-auth-ready"));
            }, 0);
        } catch (e) {
            console.warn("[admin-auth] session invalid, redirecting to login");
            localStorage.removeItem(TOKEN_KEY);
            window.location.href = "/admin/login";
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            bindUserMenuActions();
            guard();
        });
    } else {
        bindUserMenuActions();
        guard();
    }
})();
