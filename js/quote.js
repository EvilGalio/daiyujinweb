document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-quote-form]");
    const result = document.querySelector("[data-quote-result]");
    const processSelect = document.querySelector("[data-process-select]");
    const toleranceSelect = document.querySelector("[data-tolerance-select]");
    const postprocessSelect = document.querySelector("[data-postprocess-select]");
    const currencySelect = document.querySelector("[data-currency-select]");
    const uploadLabel = document.querySelector("[data-upload-label]");
    const fileInput = form ? form.querySelector('input[type="file"]') : null;
    const batchParts = document.querySelector("[data-batch-parts]");
    const batchCount = document.querySelector("[data-batch-count]");
    const partList = document.querySelector("[data-part-list]");
    if (!form || !result || !fileInput) return;

    const workspace = document.querySelector("[data-quote-workspace]") || document.querySelector(".quote-workspace");
    const calculateButton = document.querySelector("[data-calculate-current]");
    const quoteScript = document.querySelector('script[src$="quote.js"]');
    const viewerModuleUrl = window.DAIYUJIN_QUOTE_3D_MODULE_URL
        || new URL("quote-3d-viewer.js", quoteScript ? quoteScript.src : new URL("js/quote.js", window.location.href).href).href;
    const CONFIG = window.DAIYUJIN_TOOLS_CONFIG || {};
    const toolRoot = form.closest(".dyj-tool-embed") || document;
    function queryTool(selector) {
        return toolRoot.querySelector ? toolRoot.querySelector(selector) : document.querySelector(selector);
    }
    function queryToolAll(selector) {
        return toolRoot.querySelectorAll ? Array.from(toolRoot.querySelectorAll(selector)) : Array.from(document.querySelectorAll(selector));
    }
    function currentSite() {
        const raw = (toolRoot.dataset && toolRoot.dataset.dyjTheme) || CONFIG.theme || "default";
        const site = String(raw || "default").trim().toLowerCase();
        const allowed = new Set(["default", "mfg", "gcindus", "gcnov"]);
        return allowed.has(site) ? site : "default";
    }
    CONFIG.theme = currentSite();
    function formalQuoteUrl() { return CONFIG.formalQuoteUrl || "https://mfg-solution.com/request-quote/"; }
    function formalQuoteLabel() { return CONFIG.formalQuoteLabel || "Request Formal Quote"; }
    function engineerContactUrl() { return CONFIG.engineerContactUrl || formalQuoteUrl(); }
    function engineerContactLabel() { return CONFIG.engineerContactLabel || "Contact our engineers"; }

    const contactRules = {
        customer_name_required: true,
        customer_email_required: true,
    };

    /* ══════════════════════════════════════════════════
       State
       ══════════════════════════════════════════════════ */
    const state = {
        batchId: "",
        activePartId: "",
        options: null,
        materialSearch: "",
        defaults: {
            material_category: "",
            material_id: "",
            process: "CNC",
            tolerance_grade: "ISO2768-M",
            postprocess_group: "bead_blasting",
            quantity: 100,
            currency: "USD",
        },
        parts: [],
    };

    function createBatchId() {
        try { return crypto.randomUUID(); } catch (e) { return `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
    }

    function createPartId() {
        try { return crypto.randomUUID(); } catch (e) { return `part-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
    }

    function makeFileKey(file) { return `${file.name}:${file.size}:${file.lastModified}`; }
    function cloneDefaults() { return JSON.parse(JSON.stringify(state.defaults)); }
    const SUPPORTED_CAD_EXTENSIONS = new Set(["stp", "step", "igs", "iges", "zip"]);

    function makeEstimateCacheKey(part) {
        const s = part.settings || {};
        return `${part.fileKey}|${s.material_id}|${s.process}|${s.tolerance_grade}|${s.postprocess_group}|${s.quantity}|${s.currency}`;
    }

    function getActivePart() {
        return state.parts.find(p => p.id === state.activePartId) || state.parts[0] || null;
    }

    function reindexParts() {
        state.parts.forEach((part, index) => { part.index = index; });
    }

    function shortFileName(name) {
        return String(name || "").split(/[\\/]/).pop() || String(name || "CAD part");
    }

    /* ══════════════════════════════════════════════════
       Hydrate options
       ══════════════════════════════════════════════════ */
    async function hydrateOptions() {
        try {
            state.options = await window.DaiyujinAPI.request("/api/public/quote/options");
            const cats = (state.options.material_categories || []);
            if (cats.length) {
                state.defaults.material_category = cats[0].id;
                state.defaults.material_id = cats[0].default_material_id || cats[0].materials?.[0]?.id || "";
            }
            renderMaterialPicker();
            if (processSelect) processSelect.innerHTML = (state.options.processes || []).map(item => `<option value="${esc(item.id)}"${item.id==="CNC"?" selected":""}>${esc(item.label||item.name)}</option>`).join("");
            if (toleranceSelect) toleranceSelect.innerHTML = (state.options.tolerance_grades || []).map(item => `<option value="${esc(item.grade)}">${esc(item.label)}</option>`).join("");
            if (postprocessSelect) postprocessSelect.innerHTML = (state.options.postprocess_groups || []).map(item => `<option value="${esc(item.id)}">${esc(item.label||item.name)}</option>`).join("");
            if (currencySelect) currencySelect.innerHTML = (state.options.currencies || ["USD"]).map(c => `<option value="${esc(c)}"${c==="USD"?" selected":""}>${esc(c)}</option>`).join("");
        } catch (e) { /* silent */ }
    }

    /* ══════════════════════════════════════════════════
       Material picker
       ══════════════════════════════════════════════════ */
    const materialPicker = document.querySelector("[data-material-picker]");

    function getCurrentMaterialContext() {
        const cats = (state.options && state.options.material_categories) || [];
        const currentCat = cats.find(c => c.id === state.defaults.material_category) || cats[0];
        const materials = currentCat ? (currentCat.materials || []) : [];
        const query = (state.materialSearch || "").trim().toLowerCase();
        const filtered = query ? materials.filter(m => `${m.label||""} ${m.subtitle||""}`.toLowerCase().includes(query)) : materials;
        return { cats, currentCat, materials, filtered };
    }

    function renderMaterialGradeOptions(filtered) {
        if (!filtered.length) return '<div class="quote-material-empty">No matching grade. Try another keyword.</div>';
        return filtered.map(m => `<button type="button" role="option" aria-selected="${m.id===state.defaults.material_id?'true':'false'}" class="quote-material-grade-option${m.id===state.defaults.material_id?' active':''}" data-mat-id="${esc(m.id)}"><span class="quote-material-grade-label">${esc(m.label)}</span>${m.subtitle?`<span class="quote-material-grade-sub">${esc(m.subtitle)}</span>`:''}${(m.badges||[]).map(b=>`<span class="quote-material-badge">${esc(b)}</span>`).join('')}${m.review_recommended?'<span class="quote-material-badge review">Review</span>':''}</button>`).join("");
    }

    function bindMaterialOptionEvents() {
        materialPicker.querySelectorAll('[data-mat-id]').forEach(btn => { btn.addEventListener('click', () => { state.defaults.material_id = btn.dataset.matId; renderMaterialPicker(); }); });
    }

    function bindMaterialPickerEvents() {
        materialPicker.querySelectorAll('[data-cat-id]').forEach(btn => { btn.addEventListener('click', () => { const { cats } = getCurrentMaterialContext(); state.defaults.material_category = btn.dataset.catId; state.materialSearch = ""; const cat = cats.find(c=>c.id===state.defaults.material_category); const inCat = (cat?.materials||[]).find(m=>m.id===state.defaults.material_id); state.defaults.material_id = inCat ? state.defaults.material_id : (cat?.default_material_id||cat?.materials?.[0]?.id||""); renderMaterialPicker(); }); });
        bindMaterialOptionEvents();
        const searchInput = materialPicker.querySelector('[data-material-search]');
        if (searchInput) searchInput.addEventListener('input', () => { state.materialSearch = searchInput.value; renderMaterialGradeListOnly(); });
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
        materialPicker.innerHTML = `<div class="quote-material-categories">${cats.map(c=>`<button type="button" class="quote-material-cat-btn${c.id===state.defaults.material_category?' active':''}" data-cat-id="${esc(c.id)}" aria-pressed="${c.id===state.defaults.material_category?'true':'false'}">${esc(c.label)}</button>`).join("")}</div><div class="quote-material-grades"><input type="text" class="quote-material-search" placeholder="Search grade..." value="${esc(state.materialSearch)}" data-material-search><div class="quote-material-grade-list" role="listbox" aria-label="Material grade">${renderMaterialGradeOptions(filtered)}</div></div>`;
        bindMaterialPickerEvents();
    }

    /* ══════════════════════════════════════════════════
       Batch upload
       ══════════════════════════════════════════════════ */
    fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files || []);
        addFilesToBatch(files);
        fileInput.value = "";
    });

    function addFilesToBatch(files) {
        if (!state.batchId) state.batchId = createBatchId();
        const existing = new Set(state.parts.map(p => p.fileKey));
        const valid = files.filter(f => SUPPORTED_CAD_EXTENSIONS.has((f.name.toLowerCase().split(".").pop() || "")));
        let added = 0, skipped = 0;
        valid.forEach(file => {
            const fk = makeFileKey(file);
            if (existing.has(fk)) { skipped++; return; }
            if (state.parts.length >= 20) return;
            const part = { id: createPartId(), index: state.parts.length, file, fileName: file.name, fullFileName: file.name, fileKey: fk, status: "pending", uploadStatus: "pending", estimateStatus: "empty", analysis: null, estimate: null, settings: cloneDefaults(), settingsSource: "inherited", estimateCacheKey: "", error: "", previewMode: "png", analysisPresentation: { startedAt: 0, progress: 0, phase: "Queued for CAD analysis" } };
            state.parts.push(part);
            existing.add(fk);
            added++;
        });
        if (!state.activePartId && state.parts.length) state.activePartId = state.parts[0].id;
        updateUploadLabel();
        render();
        analyzePendingParts();
    }

    function updateUploadLabel() {
        if (!uploadLabel) return;
        const span = uploadLabel.querySelector("span");
        if (!span) return;
        span.textContent = state.parts.length === 0 ? "Choose CAD files" : state.parts.length === 1 ? "1 CAD file selected" : `${state.parts.length} CAD files selected`;
    }

    async function analyzePendingParts() {
        for (const part of state.parts) {
            if (part.uploadStatus !== "pending") continue;
            part.uploadStatus = "analyzing"; part.status = "analyzing";
            part.analysisPresentation = { startedAt: performance.now(), progress: 5, phase: ANALYSIS_PHASES[0] };
            renderForPartUpdate(part);
            try {
                const uploadResult = await uploadCad(part.file);
                if (uploadResult.archive) {
                    expandArchivePart(part, uploadResult);
                    render();
                    continue;
                }
                part.analysis = uploadResult.analysis;
                part.uploadStatus = "ready"; part.status = "ready";
                part.analysisPresentation.progress = 100;
                part.analysisPresentation.phase = "Preview ready";
            } catch (e) {
                part.uploadStatus = "failed"; part.status = "failed"; part.error = e.message;
                part.analysisPresentation.phase = "CAD analysis failed";
            }
            renderForPartUpdate(part);
        }
    }

    const ANALYSIS_PHASES = ["Uploading CAD file", "Reading geometry data", "Extracting bounding dimensions", "Generating static preview", "Preparing manufacturability inputs"];

    function renderForPartUpdate(part, { force = false } = {}) {
        if (!part) return;
        if (force || part.id === state.activePartId) { render(); } else { renderPartList(); }
    }

    function tickAnalysisProgress() {
        const part = getActivePart();
        if (!part || part.uploadStatus !== "analyzing") return;
        const elapsed = performance.now() - (part.analysisPresentation?.startedAt || 0);
        const ratio = Math.min(elapsed / 8000, 0.92);
        part.analysisPresentation.progress = Math.round(8 + ratio * 84);
        part.analysisPresentation.phase = ANALYSIS_PHASES[Math.min(Math.floor(ratio * ANALYSIS_PHASES.length), ANALYSIS_PHASES.length - 1)];
        updateVisibleAnalysisProgress(part);
    }

    function updateVisibleAnalysisProgress(part) {
        if (!part || part.id !== state.activePartId) return;
        const fill = document.querySelector(".quote-preview-analysis .quote-progress-fill");
        const phase = document.querySelector(".quote-preview-analysis .quote-progress-phase");
        const pct = document.querySelector(".quote-preview-analysis .quote-progress-pct");
        if (fill) fill.style.width = `${part.analysisPresentation.progress}%`;
        if (phase) phase.textContent = part.analysisPresentation.phase;
        if (pct) pct.textContent = `${part.analysisPresentation.progress}%`;
    }

    setInterval(tickAnalysisProgress, 350);

    async function uploadCad(file) {
        const site = currentSite();
        const body = new FormData();
        body.append("file", file);
        body.append("site", site);
        body.append("theme", site);
        const resp = await window.DaiyujinAPI.request("/api/public/quote/upload", { method: "POST", body });
        if (resp.archive) {
            return { archive: true, parts: resp.parts || [], warnings: resp.warnings || [], source_filename: resp.source_filename || file.name };
        }
        if (!resp.success || !resp.data) throw new Error(resp.error || resp.message || "CAD analysis failed.");
        return { archive: false, analysis: { file_id: resp.file_id, source_filename: resp.source_filename || file.name, source_format: resp.source_format || "", ...resp.data } };
    }

    function normalizeArchiveAnalysis(item) {
        const data = item.data || {};
        return {
            file_id: item.file_id,
            source_filename: item.source_filename || data.source_filename || data.name || "CAD part",
            source_format: item.source_format || data.source_format || "",
            ...data,
        };
    }

    function expandArchivePart(parent, uploadResult) {
        const insertAt = state.parts.findIndex(p => p.id === parent.id);
        if (insertAt < 0) return;
        const children = (uploadResult.parts || []).map(item => {
            const fullName = item.source_filename || "CAD part";
            const ok = !!item.success;
            return {
                id: createPartId(),
                index: 0,
                file: null,
                fileName: shortFileName(fullName),
                fullFileName: fullName,
                fileKey: `${parent.fileKey}::${item.file_id || fullName}`,
                status: ok ? "ready" : "failed",
                uploadStatus: ok ? "ready" : "failed",
                estimateStatus: "empty",
                analysis: ok ? normalizeArchiveAnalysis(item) : null,
                estimate: null,
                settings: cloneDefaults(),
                settingsSource: "inherited",
                estimateCacheKey: "",
                error: item.error || "",
                previewMode: "png",
                analysisPresentation: { startedAt: performance.now(), progress: ok ? 100 : 0, phase: ok ? "Preview ready" : "CAD analysis failed" },
            };
        });
        if (!children.length) {
            parent.uploadStatus = "failed";
            parent.status = "failed";
            parent.error = "ZIP archive did not contain supported CAD files.";
            return;
        }
        state.parts.splice(insertAt, 1, ...children);
        reindexParts();
        if (state.activePartId === parent.id) {
            const firstReady = children.find(p => p.uploadStatus === "ready") || children[0];
            state.activePartId = firstReady.id;
            hydrateFormFromPart(firstReady);
        }
        updateUploadLabel();
    }

    function updateWorkspaceMode() {
        if (!workspace) return;
        const count = state.parts.length;
        workspace.classList.toggle("is-empty", count === 0);
        workspace.classList.toggle("is-single", count === 1);
        workspace.classList.toggle("is-batch", count > 1);
        workspace.dataset.partCount = String(count);
        if (batchParts) batchParts.hidden = count <= 1;
    }

    /* ══════════════════════════════════════════════════
       Part list UI
       ══════════════════════════════════════════════════ */
    function renderPartList() {
        updateWorkspaceMode();
        if (!batchParts || !partList) return;
        if (batchCount) batchCount.textContent = `${state.parts.length} part(s)`;

        if (state.parts.length <= 1) {
            partList.innerHTML = "";
            return;
        }

        partList.innerHTML = state.parts.map(p => {
            const statusLabel = { pending: "Pending", analyzing: "Analyzing", ready: "Ready", needs_recalculate: "Needs Update", calculating: "Estimating", estimated: "Estimated", failed: "Failed" }[p.status] || p.status;
            const statusClass = { estimated: "green", ready: "neutral", analyzing: "blue", calculating: "blue", failed: "red", needs_recalculate: "amber" }[p.status] || "";
            const total = p.estimate && p.status === "estimated" ? (p.estimate.total_estimate || {}).display || "" : "";
            return `<button type="button" class="quote-part-row${p.id === state.activePartId ? ' active' : ''}" data-part-id="${esc(p.id)}" title="${esc(p.fullFileName || p.fileName)}">
                <span class="quote-part-index">${p.index + 1}</span>
                <span class="quote-part-name">${esc(p.fileName)}</span>
                <span class="quote-part-status ${statusClass}">${statusLabel}</span>
                ${total ? `<span class="quote-part-total">${esc(total)}</span>` : ""}
            </button>`;
        }).join("");

        partList.querySelectorAll('[data-part-id]').forEach(btn => {
            btn.addEventListener('click', () => setActivePart(btn.dataset.partId));
        });
    }

    function setActivePart(partId) {
        if (state.activePartId === partId) return;
        // Save current form to old active part
        const old = getActivePart();
        if (old) { old.settings = readSettingsFromForm(); old.settingsSource = "override"; }
        state.activePartId = partId;
        const part = getActivePart();
        if (part) { hydrateFormFromPart(part); }
        render();
    }

    function readSettingsFromForm() {
        const fd = new FormData(form);
        return {
            material_category: state.defaults.material_category,
            material_id: state.defaults.material_id,
            process: String(fd.get("process") || ""),
            tolerance_grade: String(fd.get("tolerance_grade") || ""),
            postprocess_group: String(fd.get("postprocess_group") || ""),
            quantity: Number(fd.get("quantity")),
            currency: String(fd.get("currency") || ""),
        };
    }

    function readContactDetails() {
        const fd = new FormData(form);
        return {
            customer_name: String(fd.get("customer_name") || "").trim(),
            customer_email: String(fd.get("customer_email") || "").trim(),
        };
    }

    function validateContactDetails() {
        if (form.reportValidity && !form.reportValidity()) return null;
        const contact = readContactDetails();
        if (contactRules.customer_name_required && !contact.customer_name) {
            renderError("Please enter your name before calculating.");
            return null;
        }
        if (contactRules.customer_email_required && !contact.customer_email) {
            renderError("Please enter your email address before calculating.");
            return null;
        }
        return contact;
    }

    function hydrateFormFromPart(part) {
        const s = part.settings;
        if (processSelect) processSelect.value = s.process || state.defaults.process;
        if (toleranceSelect) toleranceSelect.value = s.tolerance_grade || state.defaults.tolerance_grade;
        if (postprocessSelect) postprocessSelect.value = s.postprocess_group || state.defaults.postprocess_group;
        form.querySelector('[name="quantity"]').value = s.quantity || state.defaults.quantity;
        if (currencySelect) currencySelect.value = s.currency || state.defaults.currency;
    }

    /* ══════════════════════════════════════════════════
       Calculate current part
       ══════════════════════════════════════════════════ */
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await calculateCurrentPart();
    });

    async function calculateCurrentPart() {
        const part = getActivePart();
        if (!part) { renderError("Choose a CAD file first."); return; }
        if (part.uploadStatus !== "ready") { renderError("This part is not ready yet."); return; }
        const contact = validateContactDetails();
        if (!contact) return;

        part.settings = readSettingsFromForm();
        part.settingsSource = "override";
        const cacheKey = makeEstimateCacheKey(part);
        const cacheHit = part.estimate && part.estimateCacheKey === cacheKey;

        part.estimateStatus = "calculating"; part.status = "calculating";
        part.presentation = { progress: 0, phase: 0, startedAt: performance.now(), durationMs: randomInt(2200, 4800) };
        render();

        let estimate;
        if (cacheHit) {
            estimate = part.estimate;
        } else {
            try {
                const site = currentSite();
                const payload = {
                    site,
                    theme: site,
                    batch_id: state.batchId, batch_item_id: part.id, batch_item_index: part.index + 1, batch_item_count: state.parts.length,
                    file_id: part.analysis.file_id, part_name: part.analysis.name, stp_filename: part.fullFileName || part.fileName,
                    volume_mm3: part.analysis.volume_mm3, obb_dimensions_mm: part.analysis.obb_dimensions_mm,
                    material_category: part.settings.material_category, material_id: part.settings.material_id,
                    process: part.settings.process || state.defaults.process,
                    postprocess_group: part.settings.postprocess_group || state.defaults.postprocess_group,
                    tolerance_grade: part.settings.tolerance_grade || state.defaults.tolerance_grade,
                    quantity: Number(part.settings.quantity) || 100, currency: part.settings.currency || "USD",
                    customer_name: contact.customer_name,
                    customer_email: contact.customer_email,
                };
                estimate = await window.DaiyujinAPI.request("/api/public/quote/calculate", { method: "POST", body: JSON.stringify(payload) });
            } catch (err) {
                part.estimateStatus = "failed"; part.status = "failed"; part.error = err.message;
                finishEstimatePresentation(part, false);
                render();
                return;
            }
        }

        await waitForPresentationMinimum(part);
        estimate = { ...estimate, customer_name: contact.customer_name, customer_email: contact.customer_email };
        part.estimate = estimate;
        part.estimateCacheKey = cacheKey;
        part.estimateStatus = "estimated"; part.status = "estimated";
        finishEstimatePresentation(part, true);
        render();
    }

    function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function estimatePhases() { return ["Preparing manufacturing model", "Reviewing machinability factors", "Evaluating material and process data", "Calibrating tolerance requirements", "Assessing surface finish impact", "Generating reference estimate"]; }

    async function waitForPresentationMinimum(part) {
        const elapsed = performance.now() - (part.presentation?.startedAt || 0);
        const remaining = Math.max(0, (part.presentation?.durationMs || 3000) - elapsed);
        if (remaining > 0) await sleep(remaining);
    }

    function finishEstimatePresentation(part, success) {
        if (part.presentation) part.presentation.completed = true;
    }

    function updateEstimateProgress() {
        const fill = document.querySelector(".quote-progress-fill");
        const phase = document.querySelector(".quote-progress-phase");
        const pct = document.querySelector(".quote-progress-pct");
        const part = getActivePart();
        if (!part || part.estimateStatus !== "calculating" || !fill || !phase || !pct) return;

        const elapsed = performance.now() - (part.presentation?.startedAt || 0);
        const total = part.presentation?.durationMs || 3000;
        const phases = estimatePhases();
        const ratio = Math.min(elapsed / total, 0.96);
        const p = ratio * 100;
        fill.style.width = p + "%";
        pct.textContent = Math.round(p) + "%";
        const phaseIdx = Math.min(Math.floor(ratio * phases.length), phases.length - 1);
        phase.textContent = phases[phaseIdx];
    }

    setInterval(updateEstimateProgress, 300);

    /* ══════════════════════════════════════════════════
       Render
       ══════════════════════════════════════════════════ */
    function render() {
        renderPartList();
        result.innerHTML = `${previewCard()}${estimateCard()}`;
        bindPreviewTabs();
        updateCalculateButton();
    }

    function updateCalculateButton() {
        if (!calculateButton) return;
        const part = getActivePart();
        const isCalculating = part?.estimateStatus === "calculating";
        const isReady = part?.uploadStatus === "ready";
        calculateButton.disabled = !part || !isReady || isCalculating;
        if (!part) calculateButton.textContent = "Upload CAD First";
        else if (part.uploadStatus === "pending" || part.uploadStatus === "analyzing") calculateButton.textContent = "Analyzing CAD...";
        else if (part.uploadStatus === "failed") calculateButton.textContent = "Analysis Failed";
        else if (isCalculating) calculateButton.textContent = "Estimating...";
        else calculateButton.textContent = "Calculate Current Part";
    }

    function previewCard() {
        const part = getActivePart();

        if (!part) {
            return `<section class="tool-panel quote-preview-panel"><h2>Part Preview</h2><div class="tool-note">Upload CAD files to begin.</div></section>`;
        }

        if (part.uploadStatus === "pending" || part.uploadStatus === "analyzing") {
            return previewAnalysisCard(part);
        }

        if (part.uploadStatus === "failed") {
            return `<section class="tool-panel quote-preview-panel"><h2>Part Preview</h2><div class="tool-note error">CAD analysis failed: ${esc(part.error || "Unknown error")}</div></section>`;
        }

        if (!part.analysis) {
            return previewAnalysisCard(part);
        }

        return previewReadyCard(part);
    }

    function previewAnalysisCard(part) {
        const p = part.analysisPresentation || {};
        const pct = Math.round(p.progress || 8);
        const phase = p.phase || "Reading CAD geometry";
        return `<section class="tool-panel quote-preview-panel quote-preview-analysis" aria-live="polite">
            <div class="quote-preview-head"><h2>Part Preview</h2></div>
            <div class="quote-analysis-card">
                <div class="quote-analysis-title"><span>CAD analysis</span><strong>${esc(part.fileName || "Current part")}</strong></div>
                <div class="quote-progress">
                    <div class="quote-progress-bar"><div class="quote-progress-fill" style="width:${pct}%"></div></div>
                    <div class="quote-progress-text"><span class="quote-progress-phase">${esc(phase)}</span><span class="quote-progress-pct">${pct}%</span></div>
                </div>
                <div class="tool-note" style="margin-top:.75rem;">Extracting geometry and preparing preview. Calculation available once ready.</div>
            </div>
        </section>`;
    }

    function previewReadyCard(part) {
        const a = part.analysis;
        const mode = part.previewMode || "png";
        const thumbUrl = a.thumbnail_url ? new URL(a.thumbnail_url, window.DaiyujinAPI.config.baseUrl || window.location.href).href : "";
        return `<section class="tool-panel quote-preview-panel" data-preview-ready>
            <div class="quote-preview-head">
                <h2>Part Preview</h2>
                <div class="quote-preview-tabs" role="tablist">
                    <button type="button" data-preview-tab="png" class="${mode==="png"?"active":""}" aria-selected="${mode==="png"?"true":"false"}">Static PNG</button>
                    <button type="button" data-preview-tab="3d" class="${mode==="3d"?"active":""}" aria-selected="${mode==="3d"?"true":"false"}">3D View</button>
                </div>
            </div>
            <div class="quote-preview-stage">
                <img class="quote-thumb" src="${esc(thumbUrl)}" alt="${esc(a.name)} preview" data-png-preview ${mode==="3d"?"hidden":""}>
                <div class="quote-3d-stage" data-3d-stage ${mode==="png"?"hidden":""}></div>
            </div>
            <div class="metric-row" style="margin-top:0.5rem;"><span>File</span><strong>${esc(a.name)}</strong></div>
            <div class="metric-row"><span>Bounding Size</span><strong>${esc(a.obb_dimensions_mm)} mm</strong></div>
            <div class="metric-row"><span>Volume</span><strong>${formatNum(a.volume_mm3)} mm&sup3;</strong></div>
        </section>`;
    }

    function setPreviewMode(mode) {
        const part = getActivePart();
        if (part) part.previewMode = mode === "3d" ? "3d" : "png";
    }

    function estimateLoadingCard(part) {
        return `<section class="tool-panel quote-estimate quote-estimate-loading" aria-live="polite">
            <h2>Reference Estimate</h2>
            <div class="quote-eval-head">
                <span class="quote-eval-kicker">Manufacturing review</span>
                <strong>Evaluating ${esc(part?.fileName || 'current part')}</strong>
            </div>
            <div class="quote-progress">
                <div class="quote-progress-bar">
                    <div class="quote-progress-fill" style="width:0%"></div>
                </div>
                <div class="quote-progress-text">
                    <span class="quote-progress-phase">Preparing manufacturing model</span>
                    <span class="quote-progress-pct">0%</span>
                </div>
            </div>
            <div class="quote-eval-steps">
                <span>Geometry</span><span>Material</span><span>Tolerance</span><span>Finish</span>
            </div>
        </section>`;
    }

    function estimateCard() {
        const part = getActivePart();

        if (part?.estimateStatus === "calculating") {
            return estimateLoadingCard(part);
        }

        if (part?.estimateStatus === "failed") {
            return `<section class="tool-panel quote-estimate"><h2>Reference Estimate</h2><div class="tool-note error">Reference estimate failed. Please adjust inputs or retry. ${esc(part.error || "Please try again.")}</div></section>`;
        }

        if (!part || !part.estimate) {
            return `<section class="tool-panel quote-estimate"><h2>Reference Estimate</h2><div class="tool-note">${part && part.uploadStatus==="ready" ? "Ready to calculate." : "Upload CAD files to begin."}</div></section>`;
        }
        const e = part.estimate;
        const sel = e.selections || {};
        const totalEst = e.total_estimate || {};
        const unitEst = e.unit_estimate || {};
        const warnings = (e.warnings||[]).map(w=>`<div class="tool-note warn">${esc(w)}</div>`).join("");
        const disclaimer = estimateDisclaimer(e.customer_name);

        return `<section class="tool-panel quote-estimate"><h2>Reference Estimate</h2>
            <div class="quote-total">${esc(totalEst.display||"-")}</div>
            <div class="metric-row"><span>Unit Estimate</span><strong>${esc(unitEst.display||"-")}</strong></div>
            <div class="metric-row"><span>Quantity</span><strong>${sel.quantity} pcs</strong></div>
            <div class="metric-row"><span>Valid Until</span><strong>${esc(e.valid_until)}</strong></div>
            <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--line);">
                <div class="metric-row"><span>Material</span><strong>${esc(sel.material_category||'-')}${sel.material?' · '+esc(sel.material):''}</strong></div>
                <div class="metric-row"><span>Process</span><strong>${esc(sel.process)}</strong></div>
                <div class="metric-row"><span>Postprocess</span><strong>${esc(sel.postprocess_group)}</strong></div>
                <div class="metric-row"><span>Tolerance</span><strong>${esc(sel.tolerance_grade)}</strong></div>
            </div>
            ${warnings}
            <div class="tool-note" style="margin-top:0.5rem;">${formalQuoteText(disclaimer)}</div>
            <a class="tool-button" href="${formalQuoteUrl()}" target="_blank" rel="noopener" style="display:inline-flex;text-decoration:none;margin-top:0.5rem;">${esc(formalQuoteLabel())}</a>
        </section>`;
    }

    function bindPreviewTabs() {
        const tabs = document.querySelectorAll('[data-preview-tab]'); if (!tabs.length) return;
        const pngEl = document.querySelector('[data-png-preview]'), stage3d = document.querySelector('[data-3d-stage]');
        let viewerLoaded = false;

        tabs.forEach(tab => { tab.addEventListener('click', async () => {
            const mode = tab.dataset.previewTab === '3d' ? '3d' : 'png';
            setPreviewMode(mode);
            await applyPreviewMode(mode, { pngEl, stage3d, tabs });
        });});

        const part = getActivePart();
        if (part?.previewMode === '3d' && stage3d && !stage3d.hidden) {
            applyPreviewMode('3d', { pngEl, stage3d, tabs });
        }
    }

    async function applyPreviewMode(mode, { pngEl, stage3d, tabs }) {
        if (tabs) tabs.forEach(t => {
            const active = t.dataset.previewTab === mode;
            t.classList.toggle('active', active); t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (mode === 'png') {
            if (stage3d) stage3d.hidden = true;
            if (pngEl) pngEl.hidden = false;
            return;
        }
        if (pngEl) pngEl.hidden = true;
        if (stage3d) {
            stage3d.hidden = false;
            if (!stage3d.dataset.viewerLoaded) {
                try {
                    const m = await import(viewerModuleUrl);
                    stage3d.innerHTML = '';
                    const part = getActivePart();
                    await m.mount(stage3d, { apiBase: window.DaiyujinAPI.config.baseUrl || 'http://127.0.0.1:5000', fileId: part?.analysis?.file_id || '', partName: part?.analysis?.name || part?.fileName || 'Part' });
                    stage3d.dataset.viewerLoaded = '1';
                } catch (e) {
                    stage3d.innerHTML = '<div class="quote-3d-status">3D preview is unavailable.</div>';
                }
            } else {
                try { const m = await import(viewerModuleUrl); m.resume(stage3d); } catch (e) {}
            }
        }
    }

    function renderError(msg) {
        const est = result.querySelector('.quote-estimate');
        if (est) est.innerHTML = `<h2>Reference Estimate</h2><div class="tool-note error">${esc(msg)}</div>`;
    }

    /* ══════════════════════════════════════════════════
       Helpers
       ══════════════════════════════════════════════════ */
    function formatNum(v) { return Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }); }
    function esc(v) { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
    function estimateDisclaimer(customerName) {
        const name = String(customerName || "").trim();
        if (CONFIG.disclaimerTemplate) {
            return CONFIG.disclaimerTemplate
                .replace(/\{customer_name\}/g, name || "Customer")
                .replace(/\{formal_quote_label\}/g, formalQuoteLabel());
        }
        const opening = name ? `Dear ${name}, this` : "This";
        return `${opening} reference estimate is generated by our AI-assisted quoting system, which is continuously learning from manufacturing data. At this stage, the price is for reference only. For accurate pricing, please click ${formalQuoteLabel()}.`;
    }
    function escapeRegExp(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function formalQuoteText(v) {
        const labelPattern = new RegExp(escapeRegExp(formalQuoteLabel()), "gi");
        return esc(v)
            .replace(/contact our engineers/gi, match => `<a href="${formalQuoteUrl()}" target="_blank" rel="noopener">${match}</a>`)
            .replace(labelPattern, match => `<a href="${formalQuoteUrl()}" target="_blank" rel="noopener">${match}</a>`);
    }

    /* Init */
    hydrateOptions();
    render();

    /* Apply config-driven links */
    if (CONFIG.engineerContactUrl) {
        const el = queryTool('[data-engineer-contact]');
        if (el) { el.href = CONFIG.engineerContactUrl; el.textContent = engineerContactLabel(); }
    }

    /* Fetch live public settings from API */
    (async () => {
        try {
            const site = currentSite();
            const res = await window.DaiyujinAPI.request(`/api/public/settings?tool=quote&site=${encodeURIComponent(site)}`);
            const live = res.settings || {};
            if (live.formal_quote_url) CONFIG.formalQuoteUrl = live.formal_quote_url;
            if (live.formal_quote_label) CONFIG.formalQuoteLabel = live.formal_quote_label;
            if (live.engineer_contact_url) CONFIG.engineerContactUrl = live.engineer_contact_url;
            if (live.engineer_contact_label) CONFIG.engineerContactLabel = live.engineer_contact_label;
            if (live.customer_name_required !== undefined || live.customer_email_required !== undefined) {
                contactRules.customer_name_required = asBool(live.customer_name_required, true);
                contactRules.customer_email_required = asBool(live.customer_email_required, true);
                renderContactRequired(contactRules);
            }
            if (live.disclaimer_template) CONFIG.disclaimerTemplate = live.disclaimer_template;
            if (live.contact_note) CONFIG.contactNote = live.contact_note;
            if (live.privacy_note) CONFIG.privacyNote = live.privacy_note;
            // Re-apply engineer contact link in the static HTML
            applyLiveTextSettings();
            // Re-render to pick up new CTA text in results
            const part = getActivePart();
            if (part && part.estimate) render();
            console.log('Live settings loaded for', site);
        } catch (e) {
            console.warn('Live settings failed', e);
        }
    })();

function renderContactRequired(rules) {
    const nameEl = queryTool('[name="customer_name"]');
    const emailEl = queryTool('[name="customer_email"]');
    if (nameEl) {
        if (rules.customer_name_required) nameEl.setAttribute('required', '');
        else nameEl.removeAttribute('required');
    }
    if (emailEl) {
        if (rules.customer_email_required) emailEl.setAttribute('required', '');
        else emailEl.removeAttribute('required');
    }
}

function asBool(v, fallback) {
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    return fallback;
}

function applyLiveTextSettings() {
    const contactNote = queryTool('[data-quote-contact-note]');
    if (contactNote && CONFIG.contactNote) {
        contactNote.textContent = CONFIG.contactNote.trim() + ' ';
    }
    const privacyNote = queryTool('[data-quote-privacy-note]');
    if (privacyNote && CONFIG.privacyNote) {
        privacyNote.textContent = CONFIG.privacyNote;
    }
    queryToolAll('[data-engineer-contact]').forEach(engineer => {
        engineer.href = engineerContactUrl();
        engineer.textContent = engineerContactLabel();
    });
}

});
