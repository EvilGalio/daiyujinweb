document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-freight-form]");
    const resultEl = document.querySelector("[data-freight-result]");
    const searchRoot = document.querySelector("[data-country-search]");
    const countryInput = document.querySelector("#country");
    const dropdown = document.querySelector("[data-country-dropdown]");
    const weightInput = document.querySelector('[name="weight"]');
    const currencySegment = document.querySelector("[data-currency-segment]");
    const CONFIG = window.DAIYUJIN_TOOLS_CONFIG || {};
    if (!form || !resultEl || !searchRoot || !countryInput || !dropdown || !weightInput || !currencySegment) return;

    const loadingPhases = [
        "Checking DHL route",
        "Applying fuel and infrastructure surcharge",
        "Preparing freight estimate",
    ];

    let countries = [];
    let selectedCountry = null;
    let progressTimer = null;

    function randomMs(minMs, maxMs) {
        return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[c]);
    }

    function parseNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function formatMoney(amount, currency) {
        const n = parseNumber(amount, NaN);
        if (!Number.isFinite(n)) return "-";
        return `${escapeHtml((currency || "USD").toUpperCase())} ${n.toFixed(2)}`;
    }

    function formatWeight(value) {
        return `${parseNumber(value, 0).toFixed(2)} kg`;
    }

    function validUntilDate(days = 14) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
    }

    function setState(state) {
        resultEl.dataset.state = state;
    }

    function formalShippingUrl() {
        return CONFIG.formalShippingUrl || CONFIG.formalQuoteUrl || CONFIG.engineerContactUrl || "https://mfg-solution.com/request-quote/";
    }

    function formalShippingLabel() {
        return CONFIG.formalShippingLabel || CONFIG.formalQuoteLabel || "Request Formal Shipping Confirmation";
    }

    function selectedCurrency() {
        const checked = currencySegment.querySelector('input[name="currency"]:checked');
        return (checked && checked.value) || "USD";
    }

    function syncCurrencySegmentState() {
        const checked = currencySegment.querySelector('input[name="currency"]:checked');
        const checkedValue = checked ? checked.value : "USD";
        currencySegment.querySelectorAll("label").forEach((label, idx) => {
            const input = label.querySelector("input");
            const active = input && input.value === checkedValue;
            label.classList.toggle("active", !!active);
            if (active) label.setAttribute("aria-checked", "true");
            else label.removeAttribute("aria-checked");
        });
    }

    function sanitizeCountries(items) {
        return (Array.isArray(items) ? items : []).filter(item => item && item.en);
    }

    async function hydrateCountries() {
        try {
            const payload = await window.DaiyujinAPI.request("/api/public/freight/countries");
            if (Array.isArray(payload.countries)) {
                countries = sanitizeCountries(payload.countries);
                countryInput.placeholder = `Search ${countries.length} destinations...`;
            }
        } catch (error) {
            countryInput.placeholder = "Type to search destinations...";
        }
    }

    function filterCountries(query) {
        const text = query.toLowerCase().trim();
        if (!text) return countries.slice(0, 30);
        return countries
            .filter(item => {
                const en = (item.en || "").toLowerCase();
                const cn = (item.cn || "").toLowerCase();
                return en.includes(text) || cn.includes(text);
            })
            .slice(0, 15);
    }

    function renderDropdown(items, total) {
        if (!items.length) {
            dropdown.innerHTML = countryInput.value.trim()
                ? '<div class="country-item muted">No matching destination</div>'
                : "";
            dropdown.classList.remove("open");
            return;
        }
        let html = items.map((item, index) => `
            <div class="country-item" data-index="${index}" data-country="${escapeHtml(item.en)}">
                <span class="country-en">${escapeHtml(item.en)}</span>
                ${item.cn && item.cn !== item.en ? `<span class="country-cn">${escapeHtml(item.cn)}</span>` : ""}
            </div>
        `).join("");
        if (total > items.length) {
            html += `<div class="country-item muted">${total - items.length} more - type to refine</div>`;
        }
        dropdown.innerHTML = html;
        dropdown.classList.add("open");
    }

    function selectCountry(item) {
        if (!item) return;
        const country = item.dataset.country;
        countryInput.value = country;
        selectedCountry = country;
        dropdown.classList.remove("open");
        countryInput.focus();
    }

    function renderEmptyState() {
        setState("idle");
        resultEl.innerHTML = `
            <div class="carrier-card">
                <div class="quote-result-title" style="font-weight:700;margin-bottom:0.45rem;">DHL Freight</div>
                <div class="metric-row">
                    <span>Freight total</span>
                    <strong>USD 0.00</strong>
                </div>
                <div class="metric-row">
                    <span>Status</span>
                    <strong>Ready for shipment estimate</strong>
                </div>
                <div class="tool-note">Select destination and weight, then request DHL freight estimate.</div>
            </div>
        `;
    }

    function renderErrorState(message) {
        setState("error");
        resultEl.innerHTML = `
            <div class="carrier-card">
                <div class="quote-result-title" style="font-weight:700;margin-bottom:0.45rem;">Freight estimate failed</div>
                <div class="tool-note error">${escapeHtml(message || "We are temporarily unable to fetch freight estimate.")}</div>
                <div class="tool-note" style="margin-top:.5rem;">Please verify destination and weight, then retry.</div>
            </div>
        `;
    }

    function renderDoneState(payload, response) {
        const amount = formatMoney(response.amount, response.currency || payload.currency || "USD");
        const chargeable = response.charge_weight_kg || response.chargeable_weight_kg || response.chargeable_weight || payload.weight_kg;
        const ctaUrl = formalShippingUrl();
        const ctaLabel = formalShippingLabel();
        const validDate = response.valid_until || validUntilDate(14);
        setState("done");
        resultEl.innerHTML = `
            <div class="carrier-card">
                <div class="quote-result-title" style="font-weight:700;margin-bottom:0.45rem;">DHL Freight Receipt</div>
                <div class="metric-row">
                    <span>Freight total</span>
                    <strong>${amount}</strong>
                </div>
                <div class="metric-row">
                    <span>Chargeable weight</span>
                    <strong>${formatWeight(chargeable)}</strong>
                </div>
                <div class="metric-row">
                    <span>Destination</span>
                    <strong>${escapeHtml(response.country || payload.country)}</strong>
                </div>
                <div class="metric-row">
                    <span>Valid date</span>
                    <strong>${escapeHtml(validDate)}</strong>
                </div>
                <div class="tool-note" style="margin-top:.5rem;">Includes applicable surcharge assumptions.</div>
                <a class="tool-button" href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener">${escapeHtml(ctaLabel)}</a>
            </div>
        `;
    }

    function renderLoadingState() {
        setState("loading");
        resultEl.innerHTML = `
            <div class="carrier-card">
                <div class="quote-result-title" style="font-weight:700;margin-bottom:.4rem;">DHL Freight Receipt</div>
                <div class="tool-note" style="margin-bottom:.7rem;">Calculating a professional estimate...</div>
                <div class="freight-progress" data-progress-bar>
                    <div class="freight-progress-bar">
                        <div class="freight-progress-fill" data-progress-fill></div>
                    </div>
                    <div class="freight-progress-text">
                        <span class="freight-progress-phase" data-progress-phase>${loadingPhases[0]}</span>
                        <span class="freight-progress-pct" data-progress-pct>0%</span>
                    </div>
                </div>
            </div>
        `;

        const fillEl = resultEl.querySelector("[data-progress-fill]");
        const phaseEl = resultEl.querySelector("[data-progress-phase]");
        const pctEl = resultEl.querySelector("[data-progress-pct]");
        const totalMs = randomMs(3200, 5600);
        const start = performance.now();

        progressTimer = setInterval(() => {
            const elapsed = performance.now() - start;
            const ratio = Math.min(elapsed / totalMs, 0.995);
            const pct = Math.round(ratio * 100);
            const phaseIdx = Math.min(
                loadingPhases.length - 1,
                Math.floor(ratio * loadingPhases.length)
            );
            if (fillEl) fillEl.style.width = `${Math.min(pct, 99)}%`;
            if (pctEl) pctEl.textContent = `${Math.min(pct, 99)}%`;
            if (phaseEl) phaseEl.textContent = loadingPhases[phaseIdx];
        }, 160);
    }

    function stopLoadingState() {
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    }

    function normalizeError(error) {
        const msg = String(error && error.message ? error.message : error || "Freight estimate request failed.");
        if (msg.includes("Destination is not supported")) {
            return "Destination is currently not supported. Please try another destination.";
        }
        if (msg.includes("NetworkError") || msg.includes("Failed to fetch")) {
            return "Freight API is temporarily unavailable. Please retry in a moment.";
        }
        return msg;
    }

    currencySegment.addEventListener("change", () => syncCurrencySegmentState());

    countryInput.addEventListener("input", () => {
        selectedCountry = null;
        renderDropdown(filterCountries(countryInput.value.trim()), countries.length);
    });
    countryInput.addEventListener("focus", () => {
        if (countryInput.value && !selectedCountry) {
            renderDropdown(filterCountries(countryInput.value), countries.length);
        } else if (!countryInput.value) {
            renderDropdown(countries.slice(0, 30), countries.length);
        }
    });
    countryInput.addEventListener("keydown", (event) => {
        const items = dropdown.querySelectorAll(".country-item:not(.muted)");
        if (!items.length) return;
        const active = dropdown.querySelector(".country-item.active");
        let index = -1;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            index = active ? [...items].indexOf(active) + 1 : 0;
            if (index >= items.length) index = 0;
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            index = active ? [...items].indexOf(active) - 1 : items.length - 1;
            if (index < 0) index = items.length - 1;
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (active) {
                selectCountry(active);
            } else if (items.length === 1) {
                selectCountry(items[0]);
            }
            return;
        } else if (event.key === "Escape") {
            dropdown.classList.remove("open");
            return;
        }
        if (index >= 0 && items[index]) {
            items.forEach(item => item.classList.remove("active"));
            items[index].classList.add("active");
            items[index].scrollIntoView({ block: "nearest" });
        }
    });
    document.addEventListener("click", (event) => {
        if (!searchRoot.contains(event.target)) dropdown.classList.remove("open");
    });
    dropdown.addEventListener("mousedown", (event) => {
        const item = event.target.closest(".country-item");
        if (!item || item.classList.contains("muted")) return;
        event.preventDefault();
        selectCountry(item);
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const country = selectedCountry || String(formData.get("country") || "").trim();
        const weight = parseNumber(formData.get("weight"), NaN);
        const currency = selectedCurrency();
        if (!country) {
            renderErrorState("Please choose a destination.");
            return;
        }
        if (!Number.isFinite(weight) || weight <= 0) {
            renderErrorState("Please enter a valid cargo weight.");
            return;
        }

        const payload = { country, weight_kg: weight, currency };
        renderLoadingState();
        try {
            const data = await window.DaiyujinAPI.request("/api/public/freight/calculate", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            stopLoadingState();
            renderDoneState(payload, data);
        } catch (error) {
            stopLoadingState();
            renderErrorState(normalizeError(error));
        }
    });

    syncCurrencySegmentState();
    hydrateCountries();
    renderEmptyState();
});
