document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-freight-form]");
    const resultEl = document.querySelector("[data-freight-result]");
    const amountEl = resultEl?.querySelector(".dhl-result-amount");
    const metaEl = resultEl?.querySelector(".dhl-result-meta");
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

    input.addEventListener("input", () => {
        selected = null;
        const q = input.value.trim();
        renderDropdown(filter(q), countries.length);
    });

    input.addEventListener("focus", () => {
        if (input.value && !selected) {
            const matches = filter(input.value.trim());
            if (matches.length) renderDropdown(matches, countries.length);
        } else if (!input.value) {
            renderDropdown(countries.slice(0, 30), countries.length);
        }
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

    function resetResult() {
        if (amountEl) amountEl.textContent = "USD $0.00";
        if (metaEl) metaEl.textContent = "Ready for estimate";
        resultEl.classList.remove("error", "loading");
    }

    // ── Progress bar ──
    function startProgress() {
        const bar = document.querySelector("[data-progress-bar]");
        const fill = document.querySelector("[data-progress-fill]");
        const phase = document.querySelector("[data-progress-phase]");
        const pct = document.querySelector("[data-progress-pct]");
        if (!bar || !fill || !phase) return () => {};

        bar.style.display = "";
        const phases = [
            "Routing network analyzing",
            "Carrier rate matching",
            "Zone classification verifying",
            "Dynamic quotation generating",
        ];
        let currentPct = 0;
        let phaseIdx = 1;
        let stopped = false;
        let timer = null;

        function render(p, text) {
            fill.style.width = p + "%";
            fill.classList.toggle("done", p >= 100);
            phase.textContent = text;
            if (pct) pct.textContent = Math.round(p) + "%";
        }

        function tick() {
            if (stopped) return;
            if (currentPct < 70) {
                currentPct += 12 + Math.random() * 10;
                phaseIdx = Math.min(Math.floor(currentPct / 20), phases.length - 2);
            } else if (currentPct < 92) {
                currentPct += 2 + Math.random() * 3;
                phaseIdx = phases.length - 1;
            } else {
                currentPct += Math.random() * 0.5;
                currentPct = Math.min(currentPct, 96);
            }
            render(currentPct, phases[phaseIdx]);
            timer = setTimeout(tick, 600 + Math.random() * 900);
        }

        render(0, phases[0]);
        timer = setTimeout(tick, 400);

        return function finish(success) {
            stopped = true;
            clearTimeout(timer);
            if (success) {
                render(100, "Assessment complete", true);
                setTimeout(() => { bar.style.display = "none"; }, 1200);
            } else {
                bar.style.display = "none";
            }
        };
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const countryValue = selected || String(formData.get("country") || "").trim();
        const weight = Number(formData.get("weight"));
        const currency = String(formData.get("currency") || "USD");

        if (!countryValue) {
            if (amountEl) amountEl.textContent = "USD $0.00";
            if (metaEl) metaEl.textContent = "Please select a destination.";
            resultEl.classList.add("error");
            return;
        }
        if (!weight || weight <= 0) {
            if (amountEl) amountEl.textContent = "USD $0.00";
            if (metaEl) metaEl.textContent = "Enter a valid cargo weight.";
            resultEl.classList.add("error");
            return;
        }

        resultEl.classList.add("loading");
        if (metaEl) metaEl.textContent = "Calculating\u2026";

        const finishProgress = startProgress();

        try {
            const data = await window.DaiyujinAPI.request("/api/public/freight/calculate", {
                method: "POST",
                body: JSON.stringify({ country: countryValue, weight_kg: weight, currency }),
            });
            finishProgress(true);
            if (amountEl) amountEl.textContent = `${data.currency} $${data.amount.toFixed(2)}`;
            if (metaEl) metaEl.textContent = `${data.country} \u00b7 ${data.weight_kg} kg`;
            resultEl.classList.remove("error", "loading");
        } catch (error) {
            finishProgress(false);
            if (amountEl) amountEl.textContent = "USD $0.00";
            const msg = error.message || "Freight service is temporarily unavailable.";
            if (metaEl) metaEl.textContent = msg;
            resultEl.classList.add("error");
        }
    });

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    hydrateCountries();
});
