document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-freight-form]");
    const resultEl = document.querySelector("[data-freight-result]");
    const amountEl = resultEl?.querySelector(".dhl-result-amount");
    const metaEl = resultEl?.querySelector(".dhl-result-meta");
    const resultMain = resultEl?.querySelector(".dhl-result-main");
    const progressBar = document.querySelector("[data-progress-bar]");
    const progressFill = document.querySelector("[data-progress-fill]");
    const progressPhase = document.querySelector("[data-progress-phase]");
    const progressPct = document.querySelector("[data-progress-pct]");
    const searchRoot = document.querySelector("[data-country-search]");
    const input = document.querySelector("#country");
    const dropdown = document.querySelector("[data-country-dropdown]");
    if (!form || !resultEl || !input || !dropdown) return;

    let countries = [];
    let selected = null;

    async function hydrateCountries() {
        try {
            const payload = await window.DaiyujinAPI.request("/api/public/freight/countries");
            if (Array.isArray(payload.countries)) {
                countries = payload.countries;
                input.placeholder = `Search ${countries.length} destinations\u2026`;
            }
        } catch (e) {
            input.placeholder = "Type to search destinations\u2026";
        }
    }

    function filter(query) {
        const q = query.toLowerCase().trim();
        if (!q) return countries.slice(0, 30);
        return countries.filter(c => {
            const en = (c.en || "").toLowerCase();
            const cn = (c.cn || "").toLowerCase();
            return en.includes(q) || cn.includes(q);
        }).slice(0, 15);
    }

    function renderDropdown(items, total) {
        if (!items.length) {
            dropdown.innerHTML = input.value.trim()
                ? '<div class="country-item muted">No matching destination</div>'
                : '';
            dropdown.classList.remove("open");
            return;
        }
        let html = items.map((c, i) => `
            <div class="country-item" data-index="${i}" data-en="${escapeHtml(c.en)}">
                <span class="country-en">${escapeHtml(c.en)}</span>
                ${c.cn && c.cn !== c.en ? `<span class="country-cn">${escapeHtml(c.cn)}</span>` : ""}
            </div>
        `).join("");
        if (total > items.length) {
            html += `<div class="country-item muted">${total - items.length} more — type to refine</div>`;
        }
        dropdown.innerHTML = html;
        dropdown.classList.add("open");
    }

    function selectCountry(item) {
        if (!item) return;
        input.value = item.dataset.en;
        selected = item.dataset.en;
        dropdown.classList.remove("open");
    }

    input.addEventListener("input", () => { selected = null; renderDropdown(filter(input.value.trim()), countries.length); });
    input.addEventListener("focus", () => {
        if (input.value && !selected) { const m = filter(input.value.trim()); if (m.length) renderDropdown(m, countries.length); }
        else if (!input.value) renderDropdown(countries.slice(0, 30), countries.length);
    });
    input.addEventListener("keydown", (e) => {
        const items = dropdown.querySelectorAll(".country-item:not(.muted)");
        if (!items.length) return;
        const current = dropdown.querySelector(".country-item.active");
        let idx = -1;
        if (e.key === "ArrowDown") { e.preventDefault(); idx = current ? [...items].indexOf(current) + 1 : 0; if (idx >= items.length) idx = 0; }
        else if (e.key === "ArrowUp") { e.preventDefault(); idx = current ? [...items].indexOf(current) - 1 : items.length - 1; if (idx < 0) idx = items.length - 1; }
        else if (e.key === "Enter") { e.preventDefault(); if (current) { selectCountry(current); return; } if (items.length === 1) { selectCountry(items[0]); return; } }
        else if (e.key === "Escape") { dropdown.classList.remove("open"); return; }
        if (idx >= 0 && items[idx]) { items.forEach(el => el.classList.remove("active")); items[idx].classList.add("active"); items[idx].scrollIntoView({ block: "nearest" }); }
    });
    document.addEventListener("click", (e) => { if (!searchRoot.contains(e.target)) dropdown.classList.remove("open"); });
    dropdown.addEventListener("mousedown", (e) => {
        const item = e.target.closest(".country-item");
        if (item && !item.classList.contains("muted")) { e.preventDefault(); selectCountry(item); }
    });

    // ── State machine ──
    function setState(state) {
        resultEl.dataset.state = state;
    }

    function resetResult() {
        if (amountEl) amountEl.textContent = "USD $0.00";
        if (metaEl) metaEl.textContent = "Ready for estimate";
        if (progressBar) progressBar.hidden = true;
        if (resultMain) resultMain.hidden = false;
        setState("idle");
    }

    // ── Progress bar (inside result panel) ──
    function startProgress() {
        if (!progressBar || !progressFill || !progressPhase) return () => {};

        setState("loading");
        if (resultMain) resultMain.hidden = true;
        progressBar.hidden = false;
        progressFill.style.width = "0%";
        progressFill.classList.remove("done");

        const phases = [
            "Routing network analyzing",
            "Carrier rate matching",
            "Zone classification verifying",
            "Dynamic quotation generating",
        ];
        let pct = 0;
        let phaseIdx = 1;
        let stopped = false;
        let timer = null;

        function render(p, text) {
            progressFill.style.width = p + "%";
            progressFill.classList.toggle("done", p >= 100);
            progressPhase.textContent = text;
            if (progressPct) progressPct.textContent = Math.round(p) + "%";
        }

        function tick() {
            if (stopped) return;
            if (pct < 70) { pct += 12 + Math.random() * 10; phaseIdx = Math.min(Math.floor(pct / 20), phases.length - 2); }
            else if (pct < 92) { pct += 2 + Math.random() * 3; phaseIdx = phases.length - 1; }
            else { pct += Math.random() * 0.5; pct = Math.min(pct, 96); }
            render(pct, phases[phaseIdx]);
            timer = setTimeout(tick, 600 + Math.random() * 900);
        }

        render(0, phases[0]);
        timer = setTimeout(tick, 400);

        return function finish(success) {
            stopped = true;
            clearTimeout(timer);
            if (success) {
                render(100, "Assessment complete", true);
                setTimeout(() => {
                    progressBar.hidden = true;
                    if (resultMain) resultMain.hidden = false;
                    setState("done");
                }, 800);
            } else {
                progressBar.hidden = true;
                if (resultMain) resultMain.hidden = false;
                setState("error");
            }
        };
    }

    // ── Form submit ──
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const countryValue = selected || String(formData.get("country") || "").trim();
        const weight = Number(formData.get("weight"));
        const currency = String(formData.get("currency") || "USD");

        if (!countryValue) {
            if (amountEl) amountEl.textContent = "USD $0.00";
            if (metaEl) metaEl.textContent = "Please select a destination.";
            setState("error");
            if (progressBar) progressBar.hidden = true;
            if (resultMain) resultMain.hidden = false;
            return;
        }
        if (!weight || weight <= 0) {
            if (amountEl) amountEl.textContent = "USD $0.00";
            if (metaEl) metaEl.textContent = "Enter a valid cargo weight.";
            setState("error");
            if (progressBar) progressBar.hidden = true;
            if (resultMain) resultMain.hidden = false;
            return;
        }

        const finishProgress = startProgress();

        try {
            const data = await window.DaiyujinAPI.request("/api/public/freight/calculate", {
                method: "POST",
                body: JSON.stringify({ country: countryValue, weight_kg: weight, currency }),
            });
            finishProgress(true);
            if (amountEl) amountEl.textContent = `${data.currency} $${data.amount.toFixed(2)}`;
            if (metaEl) metaEl.textContent = `${data.country} \u00b7 ${data.weight_kg} kg`;
        } catch (error) {
            finishProgress(false);
            if (amountEl) amountEl.textContent = "USD $0.00";
            if (metaEl) metaEl.textContent = (error.message || "Freight service is temporarily unavailable.");
        }
    });

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    hydrateCountries();
});
