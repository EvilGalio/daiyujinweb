(function () {
    const defaultBaseUrl = window.location.protocol === "file:" ? "http://127.0.0.1:5000" : "";
    const config = {
        baseUrl: window.DAIYUJIN_API_BASE || defaultBaseUrl,
    };

    class DaiyujinAPIError extends Error {
        constructor(message, { status = 0, code = "", payload = null, network = false, retryAfter = "" } = {}) {
            super(message);
            this.name = "DaiyujinAPIError";
            this.status = status;
            this.code = code;
            this.payload = payload;
            this.network = network;
            this.retryAfter = retryAfter;
        }
    }

    async function requestWithMeta(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (options.body && !(options.body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
        }
        let response;
        try {
            response = await fetch(`${config.baseUrl}${path}`, {
                ...options,
                headers,
            });
        } catch (error) {
            throw new DaiyujinAPIError("The service could not be reached.", { code: "network_unavailable", network: true });
        }
        const noBody = response.status === 204 || response.status === 304;
        const payload = noBody ? null : await response.json().catch(() => ({}));
        const acceptable = response.ok || response.status === 304;
        if (!acceptable || payload?.error === true) {
            const message = payload?.message || payload?.error_message || `Request failed with ${response.status}`;
            throw new DaiyujinAPIError(message, {
                status: response.status,
                code: payload?.code || payload?.error_code || "",
                payload,
                retryAfter: response.headers.get("Retry-After") || "",
            });
        }
        return {
            data: payload,
            status: response.status,
            headers: response.headers,
        };
    }

    async function request(path, options = {}) {
        const result = await requestWithMeta(path, options);
        return result.data;
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
        requestWithMeta,
        DaiyujinAPIError,
        checkHealth,
    };
})();
