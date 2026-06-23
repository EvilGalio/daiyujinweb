document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-quote-form]");
    const result = document.querySelector("[data-quote-result]");
    if (!form || !result) return;

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = form.querySelector('input[type="file"]').files[0];
        if (!file) {
            result.textContent = "Choose a STEP file first.";
            return;
        }
        const body = new FormData();
        body.append("file", file);
        result.textContent = "Uploading STEP file...";
        try {
            const upload = await window.DaiyujinAPI.request("/api/public/quote/upload", {
                method: "POST",
                body,
            });
            result.innerHTML = `
                <div class="metric-row"><span>Name</span><strong>${upload.data.name}</strong></div>
                <div class="metric-row"><span>OBB</span><strong>${upload.data.obb_dimensions_mm}</strong></div>
                <div class="metric-row"><span>Volume</span><strong>${upload.data.volume_mm3.toFixed(2)} mm³</strong></div>
            `;
        } catch (error) {
            result.textContent = error.message;
        }
    });
});
