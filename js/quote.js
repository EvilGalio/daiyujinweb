document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-quote-form]");
    const result = document.querySelector("[data-quote-result]");
    const materialCardList = document.querySelector("[data-material-category-list]");
    const processSelect = document.querySelector("[data-process-select]");
    const toleranceSelect = document.querySelector("[data-tolerance-select]");
    const postprocessSelect = document.querySelector("[data-postprocess-select]");
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
            uploadLabel.querySelector("span").textContent = file ? file.name : "Choose STEP file";
        }
        render();
    });

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

            setProgressPhase("Cost assessment");
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

            /* Material category cards */
            if (materialCardList) {
                const cats = options.material_categories || [];
                materialCardList.innerHTML = cats.map((item, i) => `
                    <label class="material-card${i === 0 ? ' active' : ''}">
                        <input type="radio" name="material_category" value="${escapeHtml(item.id)}"${i === 0 ? ' checked' : ''}>
                        <span class="material-card-title">${escapeHtml(item.label)}</span>
                        ${item.description ? `<span class="material-card-desc">${escapeHtml(item.description)}</span>` : ''}
                    </label>
                `).join("");

                /* Radio change → update active state */
                materialCardList.addEventListener("change", (e) => {
                    const radio = e.target.closest("input[type=radio]");
                    if (!radio) return;
                    materialCardList.querySelectorAll(".material-card").forEach(c => c.classList.remove("active"));
                    radio.closest(".material-card")?.classList.add("active");
                });
            }

            if (processSelect) {
                processSelect.innerHTML = (options.processes || [])
                    .map((item) => `<option value="${escapeHtml(item.id)}"${item.id === "CNC" ? " selected" : ""}>${escapeHtml(item.label || item.name)}</option>`)
                    .join("");
            }

            toleranceSelect.innerHTML = (options.tolerance_grades || [])
                .map((item) => `<option value="${escapeHtml(item.grade)}">${escapeHtml(item.label)}</option>`)
                .join("");

            if (postprocessSelect) {
                postprocessSelect.innerHTML = (options.postprocess_groups || [])
                    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.name)}</option>`)
                    .join("");
            }

            currencySelect.innerHTML = (options.currencies || [])
                .map((currency) => `<option value="${escapeHtml(currency)}"${currency === "USD" ? " selected" : ""}>${escapeHtml(currency)}</option>`)
                .join("");
        } catch (error) {
            renderError(error.message);
        }
    }

    async function uploadStep(file) {
        const body = new FormData();
        body.append("file", file);
        const response = await window.DaiyujinAPI.request("/api/public/quote/upload", {
            method: "POST", body,
        });
        if (!response.success || !response.data) {
            throw new Error(response.error || "STEP analysis failed.");
        }
        return { file_id: response.file_id, ...response.data };
    }

    async function calculateEstimate() {
        const formData = new FormData(form);
        const catRadio = document.querySelector("input[name=material_category]:checked");
        const payload = {
            file_id: state.analysis.file_id,
            part_name: state.analysis.name,
            stp_filename: state.fileName,
            volume_mm3: state.analysis.volume_mm3,
            obb_dimensions_mm: state.analysis.obb_dimensions_mm,
            material_category: catRadio ? catRadio.value : "aluminum_alloy",
            process: String(formData.get("process") || "CNC"),
            postprocess_group: String(formData.get("postprocess_group") || "bead_blasting"),
            tolerance_grade: String(formData.get("tolerance_grade") || "ISO2768-M"),
            quantity: Number(formData.get("quantity")),
            currency: String(formData.get("currency") || "USD"),
            customer_email: String(formData.get("customer_email") || "").trim(),
        };
        return window.DaiyujinAPI.request("/api/public/quote/calculate", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    /* ── Render ── */
    function render() {
        result.innerHTML = `${partCard()}${estimateCard()}`;
    }

    function partCard() {
        if (!state.analysis) {
            return `<section class="tool-panel">
                    <h2>Part</h2>
                    <div class="tool-note">Upload a STEP file to begin.</div>
                </section>`;
        }
        const thumb = state.analysis.thumbnail_url ? thumbnailMarkup(state.analysis.thumbnail_url, state.analysis.name) : "";
        return `<section class="tool-panel quote-part">
            <h2>Part Analyzed</h2>
            ${thumb}
            <div class="metric-row"><span>File</span><strong>${escapeHtml(state.analysis.name)}</strong></div>
            <div class="metric-row"><span>Bounding Size</span><strong>${escapeHtml(state.analysis.obb_dimensions_mm)} mm</strong></div>
            <div class="metric-row"><span>Volume</span><strong>${formatNumber(state.analysis.volume_mm3)} mm&sup3;</strong></div>
        </section>`;
    }

    function estimateCard() {
        if (!state.estimate) {
            return `<section class="tool-panel quote-estimate">
                <h2>Reference Estimate</h2>
                <div class="quote-total">USD 0.00</div>
                <div class="metric-row"><span>Unit Estimate</span><strong>USD 0.00 / pc</strong></div>
                <div class="metric-row"><span>Status</span><strong>Waiting for STEP file</strong></div>
                <div class="tool-note">Upload a STEP file and complete the manufacturing details to generate an estimate.</div>
            </section>`;
        }
        const e = state.estimate;
        const sel = e.selections || {};
        const warningMsgs = (e.warnings || []).map(w => `<div class="tool-note warn">${escapeHtml(w)}</div>`).join("");

        const totalEst = e.total_estimate || {};
        const unitEst = e.unit_estimate || {};

        const mailSubject = encodeURIComponent(`Formal Quote Request - ${state.fileName || 'Part'}`);
        let mailBody = `Hello Daiyujin Engineering Team,%0D%0A%0D%0A` +
            `I would like to request a formal quote.%0D%0A%0D%0A` +
            `Part: ${state.fileName || '—'}%0D%0A` +
            `Material Category: ${(sel.material_category || {}).label || '—'}%0D%0A` +
            `Process: ${sel.process || '—'}%0D%0A` +
            `Postprocess: ${sel.postprocess_group || '—'}%0D%0A` +
            `Tolerance: ${sel.tolerance_grade || '—'}%0D%0A` +
            `Quantity: ${sel.quantity || 0} pcs%0D%0A` +
            `Reference Estimate: ${totalEst.display || '—'}%0D%0A` +
            `Unit Estimate: ${unitEst.display || '—'}%0D%0A%0D%0A` +
            `Please review the exact material grade, tolerance, surface finish, lead time, and manufacturability.%0D%0A%0D%0A` +
            `Thank you.`;

        return `<section class="tool-panel quote-estimate">
            <h2>Reference Estimate</h2>
            <div class="quote-total">${escapeHtml(totalEst.display || "—")}</div>
            <div class="metric-row"><span>Unit Estimate</span><strong>${escapeHtml(unitEst.display || "—")}</strong></div>
            <div class="metric-row"><span>Quantity</span><strong>${sel.quantity} pcs</strong></div>
            <div class="metric-row"><span>Valid Until</span><strong>${escapeHtml(e.valid_until)}</strong></div>
            <div class="metric-row"><span>Status</span><strong>Reference estimate</strong></div>
            <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--line);">
                <div class="metric-row"><span>Material</span><strong>${escapeHtml((sel.material_category || {}).label || "-")}</strong></div>
                <div class="metric-row"><span>Process</span><strong>${escapeHtml(sel.process)}</strong></div>
                <div class="metric-row"><span>Postprocess</span><strong>${escapeHtml(sel.postprocess_group)}</strong></div>
                <div class="metric-row"><span>Tolerance</span><strong>${escapeHtml(sel.tolerance_grade)}</strong></div>
            </div>
            ${warningMsgs}
            <div class="tool-note" style="margin-top:0.5rem;">${escapeHtml(e.disclaimer || "This estimate is for early cost evaluation and is not a formal commercial offer.")}</div>
            <div class="tool-note" style="margin-top:0.25rem;">${escapeHtml(e.review_note || "For an exact quote, contact our engineers.")}</div>
            <a class="tool-button" href="mailto:?subject=${mailSubject}&body=${mailBody}" style="display:inline-flex;text-decoration:none;margin-top:0.5rem;">Request Formal Quote</a>
        </section>`;
    }

    function thumbnailMarkup(path, name) {
        const src = new URL(path, window.DaiyujinAPI.config.baseUrl || window.location.href).href;
        return `<img class="quote-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(name)} preview">`;
    }

    /* ── Progress bar ── */
    function startProgress() {
        const phases = [
            "Secure file intake",
            "Geometry assessment",
            "Manufacturing review",
            "Cost assessment",
            "Estimate preparation",
        ];
        let phaseIdx = 1;
        let pct = 0;
        let timer = null;
        let stopped = false;

        function tick() {
            if (stopped) return;
            if (pct < 70) { pct += 12 + Math.random() * 10; phaseIdx = Math.min(Math.floor(pct / 20), phases.length - 2); }
            else if (pct < 92) { pct += 2 + Math.random() * 3; phaseIdx = phases.length - 1; }
            else { pct += Math.random() * 0.5; pct = Math.min(pct, 96); }
            renderProgress(pct, phases[phaseIdx]);
            timer = setTimeout(tick, 600 + Math.random() * 900);
        }

        renderProgress(0, phases[0]);
        timer = setTimeout(tick, 400);

        return function finish(success) {
            stopped = true;
            clearTimeout(timer);
            if (success) { renderProgress(100, "Assessment complete", true); }
            else { result.innerHTML = ""; }
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
        result.innerHTML = `<section class="tool-panel">
            <h2>Secure Assessment</h2>
            <div class="quote-progress">
                <div class="quote-progress-bar"><div class="quote-progress-fill${done ? " done" : ""}" style="width:${pct}%"></div></div>
                <div class="quote-progress-text">
                    <span class="quote-progress-phase">${escapeHtml(text)}</span>
                    <span class="quote-progress-pct">${Math.round(pct)}%</span>
                </div>
            </div>
            ${done ? '<div class="tool-note success" style="margin-top:1rem;">Processing complete. Rendering results&hellip;</div>' : ''}
        </section>`;
    }

    function renderError(message) {
        result.innerHTML = `<section class="tool-panel"><div class="tool-note error">${escapeHtml(message)}</div></section>`;
    }

    function formatNumber(value) { return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }); }
    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        })[char]);
    }
});
