document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-quote-form]");
    const result = document.querySelector("[data-quote-result]");
    const materialSelect = document.querySelector("[data-material-select]");
    const toleranceSelect = document.querySelector("[data-tolerance-select]");
    const treatmentOptions = document.querySelector("[data-treatment-options]");
    const currencySelect = document.querySelector("[data-currency-select]");
    const uploadLabel = document.querySelector("[data-upload-label]");
    const fileInput = form ? form.querySelector('input[type="file"]') : null;
    if (!form || !result || !fileInput) return;

    const state = {
        fileKey: "",
        fileName: "",
        analysis: null,
        estimate: null,
        options: null,
    };

    hydrateOptions();
    render();

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        state.fileKey = "";
        state.analysis = null;
        state.estimate = null;
        if (uploadLabel) {
            const name = file ? file.name : "Choose STEP file";
            uploadLabel.querySelector("span").textContent = name;
        }
        render();
    });

    if (materialSelect) {
        materialSelect.addEventListener("change", () => {
            updateWeightPreview();
        });
    }

    result.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-request-formal]");
        if (!button || !state.estimate) return;
        button.disabled = true;
        button.textContent = "Submitting...";
        try {
            const response = await window.DaiyujinAPI.request("/api/public/quote/request-formal", {
                method: "POST",
                body: JSON.stringify({ quote_result: state.estimate }),
            });
            button.textContent = "Request received";
            button.insertAdjacentHTML(
                "afterend",
                `<div class="tool-note">Inquiry #${response.inquiry_id} received for engineering review.</div>`,
            );
        } catch (error) {
            button.disabled = false;
            button.textContent = "Request Formal Quote";
            renderError(error.message);
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = fileInput.files[0];
        if (!file) {
            renderError("Choose a STEP file first.");
            return;
        }

        try {
            setBusy("Uploading STEP file...");
            const key = `${file.name}:${file.size}:${file.lastModified}`;
            if (state.fileKey !== key) {
                state.analysis = await uploadStep(file);
                state.fileKey = key;
                state.fileName = file.name;
            }

            setBusy("Calculating estimate...");
            const estimate = await calculateEstimate();
            state.estimate = estimate;
            render();
        } catch (error) {
            renderError(error.message);
        }
    });

    async function hydrateOptions() {
        try {
            const options = await window.DaiyujinAPI.request("/api/public/quote/options");
            state.options = options;
            materialSelect.innerHTML = options.materials
                .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
                .join("");
            toleranceSelect.innerHTML = options.tolerance_grades
                .map((item) => `<option value="${escapeHtml(item.grade)}">${escapeHtml(item.label)}</option>`)
                .join("");
            const visibleTreatments = options.surface_treatments.filter((item) => item.name.toLowerCase() !== "none");
            treatmentOptions.innerHTML = visibleTreatments.length
                ? visibleTreatments
                    .map((item) => `<label><input type="checkbox" name="surface_treatment_ids" value="${item.id}"> ${escapeHtml(item.name)}</label>`)
                    .join("")
                : '<span class="tool-note">No treatments configured.</span>';
            currencySelect.innerHTML = options.currencies
                .map((currency) => `<option value="${escapeHtml(currency)}">${escapeHtml(currency)}</option>`)
                .join("");
            currencySelect.value = options.default_currency || "USD";
        } catch (error) {
            renderError(error.message);
        }
    }

    async function uploadStep(file) {
        const body = new FormData();
        body.append("file", file);
        const response = await window.DaiyujinAPI.request("/api/public/quote/upload", {
            method: "POST",
            body,
        });
        if (!response.success || !response.data) {
            throw new Error(response.error || "STEP analysis failed.");
        }
        return {
            file_id: response.file_id,
            ...response.data,
        };
    }

    async function calculateEstimate() {
        const formData = new FormData(form);
        const payload = {
            file_id: state.analysis.file_id,
            part_name: state.analysis.name,
            stp_filename: state.fileName,
            volume_mm3: state.analysis.volume_mm3,
            obb_dimensions_mm: state.analysis.obb_dimensions_mm,
            max_dim_mm: maxDimension(state.analysis.obb_dimensions_mm),
            material_id: Number(formData.get("material_id")),
            tolerance_grade: String(formData.get("tolerance_grade") || ""),
            surface_treatment_ids: formData.getAll("surface_treatment_ids").map(Number),
            quantity: Number(formData.get("quantity")),
            currency: String(formData.get("currency") || "USD"),
        };
        return window.DaiyujinAPI.request("/api/public/quote/calculate", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async function updateWeightPreview() {
        if (!state.analysis || !materialSelect.value) return;
        try {
            const preview = await window.DaiyujinAPI.request("/api/public/quote/recalculate-weight", {
                method: "POST",
                body: JSON.stringify({
                    volume_mm3: state.analysis.volume_mm3,
                    material_id: Number(materialSelect.value),
                }),
            });
            state.analysis.weight_kg = preview.weight_kg;
            state.analysis.material_name = preview.material.name;
            render();
        } catch (error) {
            renderError(error.message);
        }
    }

    function render() {
        result.innerHTML = `${partCard()}${estimateCard()}`;
    }

    function partCard() {
        if (!state.analysis) {
            return `
                <section class="tool-panel">
                    <h2>Part</h2>
                    <div class="tool-note">Awaiting STEP analysis.</div>
                </section>
            `;
        }
        const thumbnail = state.analysis.thumbnail_url ? thumbnailMarkup(state.analysis.thumbnail_url, state.analysis.name) : "";
        const weight = state.estimate ? state.estimate.part.weight_kg : state.analysis.weight_kg;
        return `
            <section class="tool-panel quote-part">
                <h2>Part</h2>
                ${thumbnail}
                <div class="metric-row"><span>Name</span><strong>${escapeHtml(state.analysis.name)}</strong></div>
                <div class="metric-row"><span>OBB</span><strong>${escapeHtml(state.analysis.obb_dimensions_mm)} mm</strong></div>
                <div class="metric-row"><span>Volume</span><strong>${formatNumber(state.analysis.volume_mm3)} mm3</strong></div>
                <div class="metric-row"><span>Weight</span><strong>${weight ? `${formatNumber(weight)} kg` : "-"}</strong></div>
            </section>
        `;
    }

    function estimateCard() {
        if (!state.estimate) {
            return `
                <section class="tool-panel">
                    <h2>Estimate</h2>
                    <div class="tool-note">Select parameters and calculate after upload.</div>
                </section>
            `;
        }
        return `
            <section class="tool-panel quote-estimate">
                <h2>Estimate <small>${escapeHtml(state.estimate.quote_status)}</small></h2>
                <div class="quote-total">${escapeHtml(state.estimate.total.display)}</div>
                <div class="metric-row"><span>Valid Until</span><strong>${escapeHtml(state.estimate.valid_until)}</strong></div>
                <div class="metric-row"><span>Material</span><strong>${escapeHtml(state.estimate.selections.material.name)}</strong></div>
                <div class="metric-row"><span>Tolerance</span><strong>${escapeHtml(state.estimate.selections.tolerance_grade.grade)}</strong></div>
                <div class="metric-row"><span>Quantity</span><strong>${state.estimate.selections.quantity} pcs</strong></div>
                <div class="quote-breakdown">
                    ${state.estimate.breakdown.map((line) => `
                        <div class="metric-row"><span>${escapeHtml(line.label)}</span><strong>${escapeHtml(line.display)}</strong></div>
                    `).join("")}
                </div>
                <div class="tool-note">${escapeHtml(state.estimate.disclaimer)}</div>
                <button class="tool-button secondary" type="button" data-request-formal>Request Formal Quote</button>
            </section>
        `;
    }

    function thumbnailMarkup(path, name) {
        const src = new URL(path, window.DaiyujinAPI.config.baseUrl || window.location.href).href;
        return `<img class="quote-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(name)} preview">`;
    }

    function setBusy(message) {
        result.innerHTML = `<section class="tool-panel"><div class="tool-note">${escapeHtml(message)}</div></section>`;
    }

    function renderError(message) {
        result.innerHTML = `<section class="tool-panel"><div class="tool-note error">${escapeHtml(message)}</div></section>`;
    }

    function maxDimension(value) {
        const numbers = String(value || "")
            .replace(/×/g, "x")
            .split("x")
            .map((part) => Number(part.trim()))
            .filter((number) => Number.isFinite(number));
        return Math.max(...numbers);
    }

    function formatNumber(value) {
        return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        })[char]);
    }
});
