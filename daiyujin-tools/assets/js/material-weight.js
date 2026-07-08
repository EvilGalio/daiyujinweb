document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-weight-form]");
    const shapeSelect = document.querySelector("[data-shape-select]");
    const unitSelect = document.querySelector("[data-unit-select]");
    const dimsArea = document.querySelector("[data-dimensions-area]");
    const diagram = document.querySelector("[data-shape-diagram]");
    const resultEl = document.querySelector("[data-weight-result]");
    if (!form || !shapeSelect || !dimsArea || !resultEl) return;

    let options = null;
    let currentShape = "round_bar";

    async function hydrate() {
        try {
            options = await window.DaiyujinAPI.request("/api/public/material-weight/options");
            document.querySelector("[data-material-select]").innerHTML = options.materials
                .map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`)
                .join("");
            shapeSelect.innerHTML = options.shapes
                .map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`)
                .join("");
            document.querySelector("[data-unit-select]").innerHTML = (options.units || ["mm", "cm", "m", "inch", "ft"])
                .map(u => `<option value="${esc(u)}">${esc(u)}</option>`)
                .join("");
            document.querySelector("[data-output-unit-select]").innerHTML = (options.output_units || ["kg", "g", "lb"])
                .map(u => `<option value="${esc(u)}">${esc(u)}</option>`)
                .join("");
            updateShape();
        } catch (e) {
            /* silent */
        }
    }

    function updateShape() {
        currentShape = shapeSelect.value;
        const spec = SHAPE_SPECS[currentShape] || SHAPE_SPECS.round_bar;
        const unit = (unitSelect && unitSelect.value) || "mm";
        dimsArea.innerHTML = spec.dimensions.map(d => `
            <div class="tool-field">
                <label for="dim-${esc(d.key)}">${esc(d.label)}${d.unit ? ' <span class="tol-unit">' + esc(unit) + '</span>' : ''}</label>
                <input id="dim-${esc(d.key)}" name="dim-${esc(d.key)}" type="number" min="0" step="any" value="10">
            </div>
        `).join("");

        dimsArea.querySelectorAll("input").forEach((input) => {
            input.addEventListener("focus", () => {
                if (diagram) {
                    diagram.innerHTML = renderShapeDiagram(currentShape, input.name.replace("dim-", ""));
                }
            });
            input.addEventListener("blur", () => {
                if (diagram) {
                    diagram.innerHTML = renderShapeDiagram(currentShape);
                }
            });
        });

        if (diagram) {
            diagram.innerHTML = renderShapeDiagram(currentShape);
        }
    }

    shapeSelect.addEventListener("change", () => {
        updateShape();
    });
    if (unitSelect) {
        unitSelect.addEventListener("change", () => {
            updateShape();
        });
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const spec = SHAPE_SPECS[currentShape] || SHAPE_SPECS.round_bar;
        const dims = {};
        for (const d of spec.dimensions) {
            dims[d.key] = Number(formData.get(`dim-${d.key}`));
        }

        resultEl.innerHTML = '<div class="tool-note">Calculating&hellip;</div>';
        try {
            const r = await window.DaiyujinAPI.request("/api/public/material-weight/calculate", {
                method: "POST",
                body: JSON.stringify({
                    material_id: formData.get("material_id"),
                    shape: currentShape,
                    unit: formData.get("unit") || "mm",
                    output_unit: formData.get("output_unit") || "kg",
                    quantity: Number(formData.get("quantity")) || 1,
                    dimensions: dims,
                }),
            });

            const density = r.density || {};
            const densityRange =
                density.min_g_cm3 == null || density.max_g_cm3 == null
                    ? ""
                    : `Density range: ${fmtNumber(density.min_g_cm3)} - ${fmtNumber(density.max_g_cm3)} g/cm<sup>3</sup>`;
            const confidence = density.confidence == null ? null : Number(density.confidence);
            const confidenceText =
                confidence == null || Number.isNaN(confidence)
                    ? ""
                    : `Confidence: ${(confidence * 100).toFixed(0)}%`;
            const pieceRange =
                r.piece_weight_range
                    ? ` (${fmtNumber(r.piece_weight_range.min)} - ${fmtNumber(r.piece_weight_range.max)} ${esc(r.piece_weight.unit)})`
                    : "";
            const totalRange =
                r.total_weight_range
                    ? ` (${fmtNumber(r.total_weight_range.min)} - ${fmtNumber(r.total_weight_range.max)} ${esc(r.total_weight.unit)})`
                    : "";

            resultEl.innerHTML = `
                <div class="dhl-result-amount">${esc(r.total_weight.display)}</div>
                <div class="dhl-result-meta">Piece weight: ${esc(r.piece_weight.display)}${pieceRange} &middot; ${esc(r.material.label)} ${esc(r.shape.label)}</div>
                <div class="dhl-result-meta">Total: ${esc(r.total_weight.display)}${totalRange}</div>
                <div class="tool-note">${densityRange}${confidenceText ? ` ¡¤ ${confidenceText}` : ""}</div>
                <div class="tool-note">${esc(r.note)}</div>`;
        } catch (err) {
            resultEl.innerHTML = `<div class="tool-note error">${esc(err.message)}</div>`;
        }
    });

    function esc(v) {
        return String(v).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        })[c]);
    }

    function fmtNumber(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return "";
        if (n === 0) return "0";
        if (n >= 1) {
            return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
        }
        return n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
    }

    hydrate();
});
