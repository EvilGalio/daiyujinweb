document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-freight-form]");
    const result = document.querySelector("[data-freight-result]");
    if (!form || !result) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        result.textContent = "Checking freight table...";
        try {
            const summary = await window.DaiyujinAPI.request("/api/public/freight/prototype");
            result.innerHTML = `
                <div class="metric-row"><span>Records</span><strong>${summary.record_count}</strong></div>
                <div class="metric-row"><span>Countries</span><strong>${summary.country_count}</strong></div>
                <div class="metric-row"><span>Carriers</span><strong>${summary.carriers.join(", ")}</strong></div>
                <div class="metric-row"><span>Weight Range</span><strong>${summary.min_weight_kg}-${summary.max_weight_kg} kg</strong></div>
            `;
        } catch (error) {
            result.textContent = error.message;
        }
    });
});
