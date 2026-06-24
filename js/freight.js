document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-freight-form]");
    const result = document.querySelector("[data-freight-result]");
    const searchRoot = document.querySelector("[data-country-search]");
    const input = document.querySelector("#country");
    const dropdown = document.querySelector("[data-country-dropdown]");
    const advancedSection = document.querySelector("[data-advanced-section]");
    const cargoTypeRadios = document.querySelectorAll("[name=cargo_type]");
    const volPreview = document.querySelector("[data-vol-preview]");
    if (!form || !result || !input || !dropdown) return;

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
                ? '<div class="country-item muted">No matching destination \u2014 try a different spelling</div>'
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
            html += `<div class="country-item muted">${total - items.length} more \u2014 type to refine</div>`;
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
        const matches = filter(q);
        renderDropdown(matches, countries.length);
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

    // ── Cargo type segmented control ──
    cargoTypeRadios.forEach(radio => {
        radio.addEventListener("change", () => {
            cargoTypeRadios.forEach(r => r.closest("label").classList.remove("active"));
            if (radio.checked) radio.closest("label").classList.add("active");
        });
    });

    // ── Volumetric preview ──
    function updateVolPreview() {
        const l = parseFloat(document.querySelector("#length")?.value) || 0;
        const w = parseFloat(document.querySelector("#width")?.value) || 0;
        const h = parseFloat(document.querySelector("#height")?.value) || 0;
        const b = parseInt(document.querySelector("#boxes")?.value) || 1;
        if (l && w && h) {
            const vol = (l * w * h * b) / 5000;
            volPreview.style.display = "";
            volPreview.textContent = `Volumetric weight: ${vol.toFixed(2)} kg (divisor 5000)`;
        } else {
            volPreview.style.display = "none";
        }
    }

    document.querySelectorAll("#length, #width, #height, #boxes").forEach(el => {
        el?.addEventListener("input", updateVolPreview);
    });

    // ── Form submit ──
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const carriers = formData.getAll("carrier");
        const countryValue = selected || String(formData.get("country") || "").trim();
        const cargoType = String(formData.get("cargo_type") || "package");

        // Advanced dimensions
        const length = parseFloat(formData.get("length"));
        const width = parseFloat(formData.get("width"));
        const height = parseFloat(formData.get("height"));
        const boxes = parseInt(formData.get("boxes") || "1") || 1;

        let advanced;
        if (!isNaN(length) || !isNaN(width) || !isNaN(height)) {
            if (isNaN(length) || isNaN(width) || isNaN(height)) {
                result.innerHTML = '<div class="tool-note error">Enter length, width, and height together, or leave them all empty.</div>';
                return;
            }
            if (length <= 0 || width <= 0 || height <= 0) {
                result.innerHTML = '<div class="tool-note error">Dimensions must be greater than zero.</div>';
                return;
            }
            advanced = { boxes, dimensions: { length_cm: length, width_cm: width, height_cm: height } };
        }

        const payload = {
            country: countryValue,
            weight_kg: Number(formData.get("weight")),
            carriers,
            currency: String(formData.get("currency") || "USD"),
            cargo_type: cargoType,
        };
        if (advanced) payload.advanced = advanced;

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

            if (!quote.results || !quote.results.length) {
                const missing = quote.missing_carriers?.length
                    ? ` No rate available for: ${quote.missing_carriers.join(", ")}.`
                    : "";
                result.innerHTML = `<div class="tool-note warn">No rate found for this destination.${missing}</div>`;
                return;
            }

            let html = quote.results.map(r => {
                const total = r.converted_total ?? r.converted_amount ?? 0;
                const ccy = r.display_currency || r.currency || "CNY";
                const origCcy = r.original_currency || "CNY";
                const base = r.base_freight ?? r.freight_amount ?? 0;
                const modeLabel = { small_matrix: "Small Parcel", document: "Document", heavy_per_kg: "Heavy Cargo" }[r.pricing_mode] || r.pricing_mode;
                const surchargeRows = r.surcharges?.filter(s => s.amount > 0) || [];
                return `
                <section class="carrier-card ${r.carrier.toLowerCase()}">
                    <h3>${r.carrier} <small>${modeLabel}</small></h3>
                    <div class="quote-total">${ccy} ${total.toFixed(2)}</div>
                    <div class="metric-row"><span>Base Freight</span><strong>${origCcy} ${base.toFixed(2)}</strong></div>
                    ${surchargeRows.map(s => `
                    <div class="metric-row"><span>${escapeHtml(s.label)}</span><strong>${s.currency} ${s.amount.toFixed(2)}</strong></div>
                    `).join("")}
                    ${surchargeRows.length ? `<div class="metric-row"><span>Subtotal</span><strong>${r.original_currency} ${r.subtotal.toFixed(2)}</strong></div>` : ""}
                    <div class="metric-row"><span>Cargo Weight</span><strong>${r.actual_weight_kg} kg</strong></div>
                    ${r.volumetric_weight_kg != null ? `<div class="metric-row"><span>Volumetric Weight</span><strong>${r.volumetric_weight_kg} kg</strong></div>` : ""}
                    <div class="metric-row"><span>Charge Weight</span><strong>${r.charge_weight_kg} kg</strong></div>
                    ${r.packaging_adjusted_weight_kg != null ? `<div class="metric-row"><span>Packaging Adjusted</span><strong>${r.packaging_adjusted_weight_kg} kg</strong></div>` : ""}
                    ${r.unit_price != null ? `<div class="metric-row"><span>Unit Price</span><strong>${r.original_currency} ${r.unit_price}/kg</strong></div>` : ""}
                    <div class="metric-row"><span>Zone / Code</span><strong>${escapeHtml(r.zone || "-")}</strong></div>
                    <div class="tool-note" style="margin-top:0.75rem;font-size:0.78rem;">
                        ${(r.explanation || []).map(e => `<div>${escapeHtml(e)}</div>`).join("")}
                    </div>
                    ${r.source?.sheet ? `<div class="tool-note" style="margin-top:0.25rem;font-size:0.72rem;color:var(--muted);">Source: ${escapeHtml(r.source.sheet)} row ${r.source.row}</div>` : ""}
                </section>`;
            }).join("");

            const missing = quote.missing_carriers?.length
                ? `<div class="tool-note warn">No rate available for: ${quote.missing_carriers.join(", ")}</div>`
                : "";
            result.innerHTML = html + missing;
        } catch (error) {
            result.innerHTML = `<div class="tool-note error">${escapeHtml(error.message)}</div>`;
        }
    });

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    hydrateCountries();
});
