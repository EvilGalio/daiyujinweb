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

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = fileInput.files[0];
        if (!file) {
            renderError("Choose a STEP file first.");
            return;
        }

        let stopProgress = startProgress();
        try {
            const startedAt = Date.now();
            const key = `${file.name}:${file.size}:${file.lastModified}`;
            if (state.fileKey !== key) {
                state.analysis = await uploadStep(file);
                state.fileKey = key;
                state.fileName = file.name;
            }

            setProgressPhase("Cost matrix evaluating");
            const estimate = await calculateEstimate();
            state.estimate = estimate;

            const elapsed = Date.now() - startedAt;
            if (elapsed < 4000) {
                await new Promise(r => setTimeout(r, 4000 - elapsed));
            }
            stopProgress(true);
            render();
        } catch (error) {
            stopProgress(false);
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
                <h2>Estimate</h2>
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
                <a class="tool-button secondary" href="mailto:" style="display:inline-flex;text-decoration:none;">Email Us for Formal Quote</a>
            </section>
        `;
    }

    function thumbnailMarkup(path, name) {
        const src = new URL(path, window.DaiyujinAPI.config.baseUrl || window.location.href).href;
        return `<img class="quote-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(name)} preview">`;
    }

    function startProgress() {
        const phases = [
            "Intelligent system compiling",
            "Geometric model parsing",
            "Manufacturing feature analysis",
            "Cost matrix evaluating",
            "Dynamic quotation generating",
        ];
        let phaseIdx = 1;
        let pct = 0;
        let timer = null;
        let stopped = false;

        function tick() {
            if (stopped) return;
            if (pct < 70) {
                pct += 12 + Math.random() * 10;
                phaseIdx = Math.min(Math.floor(pct / 20), phases.length - 2);
            } else if (pct < 92) {
                pct += 2 + Math.random() * 3;
                phaseIdx = phases.length - 1;
            } else {
                pct += Math.random() * 0.5;
                pct = Math.min(pct, 96);
            }
            renderProgress(pct, phases[phaseIdx]);
            timer = setTimeout(tick, 600 + Math.random() * 900);
        }

        renderProgress(0, phases[0]);
        timer = setTimeout(tick, 400);

        return function finish(success) {
            stopped = true;
            clearTimeout(timer);
            if (success) {
                renderProgress(100, "Assessment complete", true);
            } else {
                result.innerHTML = "";
            }
        };
    }

    function setProgressPhase(text) {
        const bar = document.querySelector(".quote-progress-fill");
        const phase = document.querySelector(".quote-progress-phase");
        if (phase) phase.textContent = text;
        if (bar && !bar.classList.contains("done")) {
            const pct = parseFloat(bar.style.width) || 85;
            if (pct < 92) { bar.style.width = (pct + 3 + Math.random() * 4) + "%"; }
        }
    }

    function renderProgress(pct, text, done) {
        result.innerHTML = `
            <section class="tool-panel">
                <h2>Assessment in Progress</h2>
                <div class="quote-progress">
                    <div class="quote-progress-bar">
                        <div class="quote-progress-fill${done ? " done" : ""}" style="width:${pct}%"></div>
                    </div>
                    <div class="quote-progress-text">
                        <span class="quote-progress-phase">${escapeHtml(text)}</span>
                        <span class="quote-progress-pct">${Math.round(pct)}%</span>
                    </div>
                </div>
                ${done ? '<div class="tool-note success" style="margin-top:1rem;">Processing complete. Rendering results&hellip;</div>' : ''}
            </section>
        `;
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
