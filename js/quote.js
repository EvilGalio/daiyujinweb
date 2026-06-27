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
    const quoteScript = document.querySelector('script[src$="quote.js"]');
    const viewerModuleUrl = window.DAIYUJIN_QUOTE_3D_MODULE_URL
        || new URL("quote-3d-viewer.js", quoteScript ? quoteScript.src : new URL("js/quote.js", window.location.href).href).href;

    const state = {
        fileKey: "",
        fileName: "",
        analysis: null,
        estimate: null,
        options: null,
        selectedMaterialCategory: "",
        selectedMaterialId: "",
        materialSearch: "",
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

            /* Material picker */
            const cats = options.material_categories || [];
            if (cats.length) {
                state.selectedMaterialCategory = cats[0].id;
                state.selectedMaterialId = cats[0].default_material_id || cats[0].materials?.[0]?.id || "";
            }
            renderMaterialPicker();

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

    /* ── Material picker ── */
    const materialPicker = document.querySelector("[data-material-picker]");

    function getCurrentMaterialContext() {
        const cats = (state.options && state.options.material_categories) || [];
        const currentCat = cats.find(c => c.id === state.selectedMaterialCategory) || cats[0];
        const materials = currentCat ? (currentCat.materials || []) : [];
        const query = (state.materialSearch || "").trim().toLowerCase();
        const filtered = query
            ? materials.filter(m => `${m.label || ""} ${m.subtitle || ""}`.toLowerCase().includes(query))
            : materials;
        return { cats, currentCat, materials, filtered };
    }

    function renderMaterialGradeOptions(filtered) {
        if (!filtered.length) return '<div class="quote-material-empty">No matching grade. Try another keyword.</div>';
        return filtered.map(m => `
            <button type="button" role="option" aria-selected="${m.id === state.selectedMaterialId ? 'true' : 'false'}"
                class="quote-material-grade-option${m.id === state.selectedMaterialId ? ' active' : ''}"
                data-mat-id="${escapeHtml(m.id)}">
                <span class="quote-material-grade-label">${escapeHtml(m.label)}</span>
                ${m.subtitle ? `<span class="quote-material-grade-sub">${escapeHtml(m.subtitle)}</span>` : ''}
                ${(m.badges || []).map(b => `<span class="quote-material-badge">${escapeHtml(b)}</span>`).join('')}
                ${m.review_recommended ? '<span class="quote-material-badge review">Review</span>' : ''}
            </button>
        `).join("");
    }

    function bindMaterialOptionEvents() {
        materialPicker.querySelectorAll('[data-mat-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.selectedMaterialId = btn.dataset.matId;
                renderMaterialPicker();
            });
        });
    }

    function bindMaterialPickerEvents() {
        materialPicker.querySelectorAll('[data-cat-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const { cats } = getCurrentMaterialContext();
                state.selectedMaterialCategory = btn.dataset.catId;
                state.materialSearch = "";
                const cat = cats.find(c => c.id === state.selectedMaterialCategory);
                const inCat = (cat?.materials || []).find(m => m.id === state.selectedMaterialId);
                state.selectedMaterialId = inCat ? state.selectedMaterialId : (cat?.default_material_id || cat?.materials?.[0]?.id || "");
                renderMaterialPicker();
            });
        });

        bindMaterialOptionEvents();

        const searchInput = materialPicker.querySelector('[data-material-search]');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                state.materialSearch = searchInput.value;
                renderMaterialGradeListOnly();
            });
        }
    }

    function renderMaterialGradeListOnly() {
        const list = materialPicker.querySelector('.quote-material-grade-list');
        if (!list) return;
        const { filtered } = getCurrentMaterialContext();
        list.innerHTML = renderMaterialGradeOptions(filtered);
        bindMaterialOptionEvents();
    }

    function renderMaterialPicker() {
        if (!materialPicker || !state.options) return;
        const { cats, filtered } = getCurrentMaterialContext();

        materialPicker.innerHTML = `
            <div class="quote-material-categories">
                ${cats.map(c => `
                    <button type="button" class="quote-material-cat-btn${c.id === state.selectedMaterialCategory ? ' active' : ''}"
                        data-cat-id="${escapeHtml(c.id)}"
                        aria-pressed="${c.id === state.selectedMaterialCategory ? 'true' : 'false'}">${escapeHtml(c.label)}</button>
                `).join("")}
            </div>
            <div class="quote-material-grades">
                <input type="text" class="quote-material-search" placeholder="Search grade..."
                    value="${escapeHtml(state.materialSearch)}" data-material-search>
                <div class="quote-material-grade-list" role="listbox" aria-label="Material grade">
                    ${renderMaterialGradeOptions(filtered)}
                </div>
            </div>`;

        bindMaterialPickerEvents();
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
            material_category: state.selectedMaterialCategory,
            material_id: state.selectedMaterialId,
            process: String(formData.get("process") || "CNC"),
            postprocess_group: String(formData.get("postprocess_group") || "bead_blasting"),
            tolerance_grade: String(formData.get("tolerance_grade") || "ISO2768-M"),
            quantity: Number(formData.get("quantity")),
            currency: String(formData.get("currency") || "USD"),
            customer_name: String(formData.get("customer_name") || "").trim(),
            customer_email: String(formData.get("customer_email") || "").trim(),
        };
        return window.DaiyujinAPI.request("/api/public/quote/calculate", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    /* ── Render ── */
    function render() {
        result.innerHTML = `${previewCard()}${estimateCard()}`;
        bindPreviewTabs();
    }

    function previewCard() {
        if (!state.analysis) {
            return `<section class="tool-panel quote-preview-panel">
                    <h2>Part Preview</h2>
                    <div class="tool-note">Upload a STEP file to begin.</div>
                </section>`;
        }
        const analysis = state.analysis;
        const thumbUrl = analysis.thumbnail_url
            ? new URL(analysis.thumbnail_url, window.DaiyujinAPI.config.baseUrl || window.location.href).href
            : '';

        return `<section class="tool-panel quote-preview-panel">
            <div class="quote-preview-head">
                <h2>Part Preview</h2>
                <div class="quote-preview-tabs" role="tablist">
                    <button type="button" data-preview-tab="png" class="active" aria-selected="true">Static PNG</button>
                    <button type="button" data-preview-tab="3d" aria-selected="false">3D View</button>
                </div>
            </div>
            <div class="quote-preview-stage">
                <img class="quote-thumb" src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(analysis.name)} preview" data-png-preview>
                <div class="quote-3d-stage" data-3d-stage hidden></div>
            </div>
            <div class="metric-row" style="margin-top:0.5rem;"><span>File</span><strong>${escapeHtml(analysis.name)}</strong></div>
            <div class="metric-row"><span>Bounding Size</span><strong>${escapeHtml(analysis.obb_dimensions_mm)} mm</strong></div>
            <div class="metric-row"><span>Volume</span><strong>${formatNumber(analysis.volume_mm3)} mm&sup3;</strong></div>
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
            `Material: ${sel.material_category || '—'}${sel.material ? ' / ' + sel.material : ''}%0D%0A` +
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
                <div class="metric-row"><span>Material</span><strong>${escapeHtml(sel.material_category || '-')}${sel.material ? ' &middot; ' + escapeHtml(sel.material) : ''}</strong></div>
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

    function bindPreviewTabs() {
    const tabs = document.querySelectorAll('[data-preview-tab]');
    if (!tabs.length) return;

    const pngEl = document.querySelector('[data-png-preview]');
    const stage3d = document.querySelector('[data-3d-stage]');
    let viewerLoaded = false;
    let viewerPaused = false;

    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            const mode = tab.dataset.previewTab;
            tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');

            if (mode === 'png') {
                if (stage3d) stage3d.hidden = true;
                if (pngEl) pngEl.hidden = false;
                if (viewerLoaded && !viewerPaused) {
                    const mod = await import(viewerModuleUrl);
                    mod.pause();
                    viewerPaused = true;
                }
            } else {
                if (pngEl) pngEl.hidden = true;
                if (stage3d) stage3d.hidden = false;
                if (!viewerLoaded) {
                    if (stage3d) {
                        try {
                            const mod = await import(viewerModuleUrl);
                            stage3d.innerHTML = '';
                            await mod.mount(stage3d, {
                                apiBase: window.DaiyujinAPI.config.baseUrl || 'http://127.0.0.1:5000',
                                fileId: state.analysis.file_id || state.analysis.fileId,
                                partName: state.analysis.name || state.fileName || 'Part',
                            });
                            viewerLoaded = true;
                            viewerPaused = false;
                        } catch (err) {
                            stage3d.innerHTML = '<div class="quote-3d-status">3D preview is unavailable. Static preview remains available.</div>';
                            console.error('3D viewer:', err);
                        }
                    }
                } else if (viewerPaused) {
                    const mod = await import(viewerModuleUrl);
                    mod.resume(stage3d);
                    viewerPaused = false;
                }
            }
        });
    });
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
