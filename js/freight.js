document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-freight-form]");
    const result = document.querySelector("[data-freight-result]");
    const countryList = document.querySelector("[data-country-list]");
    if (!form || !result) return;

    async function hydrateCountries() {
        if (!countryList) return;
        try {
            const payload = await window.DaiyujinAPI.request("/api/public/freight/countries");
            if (!Array.isArray(payload.countries)) return;
            countryList.innerHTML = payload.countries
                .map((country) => `<option value="${String(country).replaceAll('"', "&quot;")}"></option>`)
                .join("");
        } catch (error) {
            // Phase 0 keeps a small static fallback list in the HTML.
        }
    }

    hydrateCountries();

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const carriers = formData.getAll("carrier");
        const payload = {
            country: String(formData.get("country") || "").trim(),
            weight_kg: Number(formData.get("weight")),
            carriers,
            currency: String(formData.get("currency") || "CNY"),
        };

        result.textContent = "Calculating freight...";
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
                ? `<div class="tool-note">No rate found for: ${quote.missing_carriers.join(", ")}</div>`
                : "";
            result.innerHTML = rows || `<div class="tool-note">No freight rate found for ${payload.country} at ${payload.weight_kg} kg.</div>`;
            result.insertAdjacentHTML("beforeend", missing);
        } catch (error) {
            result.textContent = error.message;
        }
    });
});
