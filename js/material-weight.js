document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-weight-form]");
    const shapeSelect = document.querySelector("[data-shape-select]");
    const dimsArea = document.querySelector("[data-dimensions-area]");
    const resultEl = document.querySelector("[data-weight-result]");
    if (!form || !shapeSelect || !dimsArea || !resultEl) return;

    let options = null;

    async function hydrate() {
        try {
            options = await window.DaiyujinAPI.request("/api/public/material-weight/options");
            document.querySelector("[data-material-select]").innerHTML = options.materials
                .map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join("");
            shapeSelect.innerHTML = options.shapes
                .map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join("");
            document.querySelector("[data-unit-select]").innerHTML = options.units
                .map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
            document.querySelector("[data-output-unit-select]").innerHTML = options.output_units
                .map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
            renderDimensions();
        } catch (e) { /* silent */ }
    }

    function renderDimensions() {
        const shapeId = shapeSelect.value;
        const shapeCfg = (options?.shapes || []).find(s => s.id === shapeId);
        if (!shapeCfg) return;
        dimsArea.innerHTML = shapeCfg.dimensions.map(d => `
            <div class="tool-field">
                <label for="dim-${esc(d.key)}">${esc(d.label)}</label>
                <input id="dim-${esc(d.key)}" name="dim-${esc(d.key)}" type="number" min="0" step="any" value="10">
            </div>
        `).join("");
    }

    shapeSelect.addEventListener("change", renderDimensions);

    form.addEventListener("submit", async e => {
        e.preventDefault();
        const formData = new FormData(form);
        const shapeId = shapeSelect.value;
        const shapeCfg = (options?.shapes || []).find(s => s.id === shapeId);
        if (!shapeCfg) return;

        const dims = {};
        for (const d of shapeCfg.dimensions) {
            dims[d.key] = Number(formData.get(`dim-${d.key}`));
        }

        resultEl.innerHTML = '<div class="tool-note">Calculating&hellip;</div>';
        try {
            const r = await window.DaiyujinAPI.request("/api/public/material-weight/calculate", {
                method: "POST",
                body: JSON.stringify({
                    material_id: formData.get("material_id"),
                    shape: shapeId,
                    unit: formData.get("unit"),
                    output_unit: formData.get("output_unit"),
                    quantity: Number(formData.get("quantity")),
                    dimensions: dims,
                }),
            });
            resultEl.innerHTML = `
                <div class="dhl-result-amount">${esc(r.total_weight.display)}</div>
                <div class="dhl-result-meta">Piece weight: ${esc(r.piece_weight.display)} · ${esc(r.material.label)} ${esc(r.shape.label)}</div>
                <div class="tool-note" style="margin-top:0.5rem;">${esc(r.note)}</div>`;
        } catch (err) {
            resultEl.innerHTML = `<div class="tool-note error">${esc(err.message)}</div>`;
        }
    });

    function esc(v) { return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
    hydrate();
});
