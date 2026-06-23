document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-tolerance-form]");
    const result = document.querySelector("[data-tolerance-result]");
    if (!form || !result) return;

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const size = Number(new FormData(form).get("basic_size"));
        const fit = String(new FormData(form).get("fit_combination") || "").trim();
        result.innerHTML = `
            <div class="metric-row"><span>Basic Size</span><strong>${Number.isFinite(size) ? size.toFixed(3) : "-"} mm</strong></div>
            <div class="metric-row"><span>Fit Combination</span><strong>${fit || "-"}</strong></div>
            <div class="tool-note">No calculated result yet.</div>
        `;
    });
});
