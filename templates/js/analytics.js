(() => {
    "use strict";

    const endpoint = "/api/analytics/track";
    let currentPage = "";
    let heartbeatTimer = 0;
    let requestQueue = Promise.resolve();

    function cleanPath(value) {
        try {
            const url = new URL(value || window.location.pathname, window.location.origin);
            if (url.origin !== window.location.origin) return "";
            return url.pathname || "/";
        } catch (_) { return ""; }
    }

    async function send(event, path) {
        const payload = JSON.stringify({ event, path: path || "" });
        // Serialize events so the first request can set the visitor/session
        // cookies before a heartbeat or SPA navigation is submitted.
        requestQueue = requestQueue.then(() => fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: event === "heartbeat"
        })).catch(() => { /* Analytics must never interrupt the website. */ });
        return requestQueue;
    }

    function pageView(path) {
        const normalized = cleanPath(path);
        if (!normalized || normalized === currentPage) return;
        currentPage = normalized;
        void send("page_view", normalized);
    }

    function heartbeat() {
        if (document.visibilityState !== "visible") return;
        void send("heartbeat", "");
    }

    function start() {
        pageView(window.location.pathname);
        // Do not send an immediate heartbeat alongside the first page view;
        // both would otherwise arrive before the browser stores the first cookies.
        heartbeatTimer = window.setInterval(heartbeat, 60000);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") heartbeat();
        });
    }

    window.MoviPilotAnalytics = Object.freeze({ pageView, heartbeat });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    window.addEventListener("pagehide", () => window.clearInterval(heartbeatTimer), { once: true });
})();
