(function () {
    const defaultBaseUrl = window.location.protocol === "file:" ? "http://127.0.0.1:5000" : "";
    const config = {
        baseUrl: window.DAIYUJIN_API_BASE || defaultBaseUrl,
    };

    async function request(path, options = {}) {
        const response = await fetch(`${config.baseUrl}${path}`, {
            headers: {
                ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
                ...(options.headers || {}),
            },
            ...options,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.error === true) {
            const message = payload.message || `Request failed with ${response.status}`;
            throw new Error(message);
        }
        return payload;
    }

    async function checkHealth(target = "[data-api-status]") {
        const el = document.querySelector(target);
        if (!el) return;
        try {
            const health = await request("/api/health");
            el.textContent = health.ok ? "API ready" : "API unavailable";
            el.dataset.state = health.ok ? "ready" : "error";
        } catch (error) {
            el.textContent = "API offline";
            el.dataset.state = "error";
        }
    }

    window.DaiyujinAPI = {
        config,
        request,
        checkHealth,
    };
})();
