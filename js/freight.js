document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-freight-form]");
    const result = document.querySelector("[data-freight-result]");
    const searchRoot = document.querySelector("[data-country-search]");
    const input = document.querySelector("#country");
    const dropdown = document.querySelector("[data-country-dropdown]");
    if (!form || !result || !input || !dropdown) return;

    let countries = [];
    let selected = null;

    async function hydrateCountries() {
        try {
            const payload = await window.DaiyujinAPI.request("/api/public/freight/countries");
            if (Array.isArray(payload.countries)) {
                countries = payload.countries;
                input.placeholder = `Search ${countries.length} destinations…`;
            }
        } catch (e) { /* keep static fallback */ }
    }

    function filter(query) {
        const q = query.toLowerCase().trim();
        if (!q) return [];
        return countries.filter(c =>
            c.en.toLowerCase().includes(q) || (c.cn && c.cn.includes(q))
        ).slice(0, 12);
    }

    function renderDropdown(items) {
        if (!items.length) {
            dropdown.innerHTML = query
                ? '<div class="country-item muted">No matching destination</div>'
                : '';
            dropdown.classList.remove("open");
            return;
        }
        dropdown.innerHTML = items.map((c, i) => `
            <div class="country-item" data-index="${i}" data-en="${escapeHtml(c.en)}">
                <span class="country-en">${escapeHtml(c.en)}</span>
                ${c.cn && c.cn !== c.en ? `<span class="country-cn">${escapeHtml(c.cn)}</span>` : ""}
            </div>
        `).join("");
        dropdown.classList.add("open");
    }

    function selectCountry(item) {
        if (!item) return;
        input.value = item.dataset.en;
        selected = item.dataset.en;
        dropdown.classList.remove("open");
        dropdown.innerHTML = "";
    }

    input.addEventListener("input", () => {
        selected = null;
        const items = filter(input.value);
        renderDropdown(items);
    });

    input.addEventListener("focus", () => {
        if (input.value && !selected) {
            const items = filter(input.value);
            if (items.length) renderDropdown(items);
        } else if (!input.value) {
            renderDropdown(countries.slice(0, 8));
        }
    });

    input.addEventListener("keydown", (e) => {
        const items = dropdown.querySelectorAll(".country-item:not(.muted)");
        if (!items.length) return;
        const current = dropdown.querySelector(".country-item.active");
        let idx = -1;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            idx = current ? [...items].indexOf(current) + 1 : 0;
            if (idx >= items.length) idx = 0;
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            idx = current ? [...items].indexOf(current) - 1 : items.length - 1;
            if (idx < 0) idx = items.length - 1;
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (current) { selectCountry(current); return; }
            if (items.length === 1) { selectCountry(items[0]); return; }
            form.dispatchEvent(new Event("submit", { cancelable: true }));
            return;
        } else if (e.key === "Escape") {
            dropdown.classList.remove("open");
            return;
        }

        if (idx >= 0 && items[idx]) {
            items.forEach(el => el.classList.remove("active"));
            items[idx].classList.add("active");
            items[idx].scrollIntoView({ block: "nearest" });
        }
    });

    document.addEventListener("click", (e) => {
        if (!searchRoot.contains(e.target)) {
            dropdown.classList.remove("open");
        }
    });

    dropdown.addEventListener("mousedown", (e) => {
        const item = e.target.closest(".country-item");
        if (item && !item.classList.contains("muted")) {
            e.preventDefault();
            selectCountry(item);
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const carriers = formData.getAll("carrier");
        const countryValue = selected || String(formData.get("country") || "").trim();
        const payload = {
            country: countryValue,
            weight_kg: Number(formData.get("weight")),
            carriers,
            currency: String(formData.get("currency") || "CNY"),
        };

        if (!payload.country) {
            result.innerHTML = '<div class="tool-note error">Please select a destination.</div>';
            return;
        }

        result.innerHTML = '<div class="tool-note">Calculating rates&hellip;</div>';
        try {
            const quote = await window.DaiyujinAPI.request("/api/public/freight/calculate", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            const rows = quote.results.map((item) => `
                <section class="carrier-card ${item.carrier.toLowerCase()}">
                    <h3>${item.carrier}</h3>
                    <div class="metric-row"><span>Freight</span><strong>${item.display_currency} ${item.converted_amount.toFixed(2)}</strong></div>
                    <div class="metric-row"><span>Original</span><strong>${item.original_currency} ${item.freight_amount.toFixed(2)}</strong></div>
                    <div class="metric-row"><span>Billable Weight</span><strong>${item.billable_weight_kg} kg</strong></div>
                    <div class="metric-row"><span>Zone</span><strong>${item.zone || "-"}</strong></div>
                </section>
            `).join("");
            const missing = quote.missing_carriers.length
                ? `<div class="tool-note warn">No rate available for: ${quote.missing_carriers.join(", ")}</div>`
                : "";
            result.innerHTML = rows || '<div class="tool-note">No rate found for this destination.</div>';
            result.insertAdjacentHTML("beforeend", missing);
        } catch (error) {
            result.innerHTML = `<div class="tool-note error">${escapeHtml(error.message)}</div>`;
        }
    });

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    hydrateCountries();
});
