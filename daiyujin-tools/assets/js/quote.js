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
    const batchProgress = document.querySelector("[data-batch-progress]");
    const batchProgressLabel = document.querySelector("[data-batch-progress-label]");
    const batchProgressbar = document.querySelector("[data-batch-progressbar]");
    const batchProgressFill = document.querySelector("[data-batch-progress-fill]");
    const networkStatus = document.querySelector("[data-network-status]");
    const cancelAnalysisButton = document.querySelector("[data-cancel-analysis]");
    const analysisLive = document.querySelector("[data-analysis-live]");
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
    /* State */
    const state = {
        batchId: "",
        activePartId: "",
        options: null,
        materialSearch: "",
        materialPickerOpen: true,
        materialConfirmed: false,
        materialDraft: {
            category: "",
            id: "",
        },
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
        analysisJobs: new Map(),
        nextSourceOrder: 0,
        userSelectedPart: false,
        analysisLoopRunning: false,
        networkStatus: "online",
    };

    function createBatchId() {
        try { return crypto.randomUUID(); } catch (e) { return `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
    }

    function createPartId() {
        try { return crypto.randomUUID(); } catch (e) { return `part-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
    }

    function makeFileKey(file) { return `${file.name}:${file.size}:${file.lastModified}`; }
    function cloneDefaults() { return JSON.parse(JSON.stringify(state.defaults)); }
    const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z"]);
    const SUPPORTED_CAD_EXTENSIONS = new Set(["stp", "step", "igs", "iges", ...ARCHIVE_EXTENSIONS]);
    const JOB_STORAGE_KEY = "dyj-quote-analysis-jobs-v1";
    const TERMINAL_JOB_STATES = new Set(["completed", "completed_with_errors", "failed", "cancelled", "expired"]);
    const ACTIVE_PART_STATES = new Set(["waiting", "queued", "extracting", "analyzing"]);
    const POLL_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
    const MAX_BATCH_FILES = 50;

    function asyncArchiveAnalysisEnabled() {
        return state.options?.async_archive_analysis === true;
    }

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
    /* Hydrate options */
    async function hydrateOptions() {
        try {
            state.options = await window.DaiyujinAPI.request("/api/public/quote/options");
            const cats = (state.options.material_categories || []);
            if (cats.length) {
                state.defaults.material_category = cats[0].id;
                state.defaults.material_id = cats[0].default_material_id || cats[0].materials?.[0]?.id || "";
                state.materialDraft.category = state.defaults.material_category;
                state.materialDraft.id = state.defaults.material_id;
                state.parts.forEach(part => {
                    if (!part.settings.material_category) part.settings.material_category = state.defaults.material_category;
                    if (!part.settings.material_id) part.settings.material_id = state.defaults.material_id;
                });
            }
            renderMaterialPicker();
            if (processSelect) processSelect.innerHTML = (state.options.processes || []).map(item => `<option value="${esc(item.id)}"${item.id==="CNC"?" selected":""}>${esc(item.label||item.name)}</option>`).join("");
            if (toleranceSelect) toleranceSelect.innerHTML = (state.options.tolerance_grades || []).map(item => `<option value="${esc(item.grade)}">${esc(item.label)}</option>`).join("");
            if (postprocessSelect) postprocessSelect.innerHTML = (state.options.postprocess_groups || []).map(item => `<option value="${esc(item.id)}">${esc(item.label||item.name)}</option>`).join("");
            if (currencySelect) currencySelect.innerHTML = (state.options.currencies || ["USD"]).map(c => `<option value="${esc(c)}"${c==="USD"?" selected":""}>${esc(c)}</option>`).join("");
        } catch (e) { /* silent */ }
    }
    /* Material picker */
    const materialPicker = document.querySelector("[data-material-picker]");

    function getCurrentMaterialContext() {
        const cats = (state.options && state.options.material_categories) || [];
        const currentCat = cats.find(c => c.id === state.materialDraft.category) || cats[0];
        const materials = currentCat ? (currentCat.materials || []) : [];
        const query = (state.materialSearch || "").trim().toLowerCase();
        const filtered = query ? materials.filter(m => `${m.label||""} ${m.subtitle||""}`.toLowerCase().includes(query)) : materials;
        return { cats, currentCat, materials, filtered };
    }

    function getMaterialSelection(categoryId, materialId) {
        const cats = (state.options && state.options.material_categories) || [];
        const category = cats.find(item => item.id === categoryId) || null;
        const material = (category?.materials || []).find(item => item.id === materialId) || null;
        return { category, material };
    }

    function renderMaterialGradeOptions(filtered) {
        if (!filtered.length) return '<div class="quote-material-empty">No matching grade. Try another keyword.</div>';
        return filtered.map(m => `<button type="button" role="option" aria-selected="${m.id===state.materialDraft.id?'true':'false'}" class="quote-material-grade-option${m.id===state.materialDraft.id?' active':''}" data-mat-id="${esc(m.id)}"><span class="quote-material-grade-label">${esc(m.label)}</span>${m.subtitle?`<span class="quote-material-grade-sub">${esc(m.subtitle)}</span>`:''}${(m.badges||[]).map(b=>`<span class="quote-material-badge">${esc(b)}</span>`).join('')}${m.review_recommended?'<span class="quote-material-badge review">Review</span>':''}</button>`).join("");
    }

    function bindMaterialOptionEvents() {
        materialPicker.querySelectorAll('[data-mat-id]').forEach(btn => { btn.addEventListener('click', () => { state.materialDraft.id = btn.dataset.matId; renderMaterialPicker(); }); });
    }

    function bindMaterialPickerEvents() {
        materialPicker.querySelectorAll('[data-cat-id]').forEach(btn => { btn.addEventListener('click', () => { const { cats } = getCurrentMaterialContext(); state.materialDraft.category = btn.dataset.catId; state.materialSearch = ""; const cat = cats.find(c=>c.id===state.materialDraft.category); const inCat = (cat?.materials||[]).find(m=>m.id===state.materialDraft.id); state.materialDraft.id = inCat ? state.materialDraft.id : (cat?.default_material_id||cat?.materials?.[0]?.id||""); renderMaterialPicker(); }); });
        bindMaterialOptionEvents();
        const searchInput = materialPicker.querySelector('[data-material-search]');
        if (searchInput) searchInput.addEventListener('input', () => { state.materialSearch = searchInput.value; renderMaterialGradeListOnly(); });
        const confirmButton = materialPicker.querySelector('[data-material-confirm]');
        if (confirmButton) confirmButton.addEventListener('click', confirmMaterialSelection);
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
        if (!state.materialPickerOpen && state.materialConfirmed) {
            const { category, material } = getMaterialSelection(state.defaults.material_category, state.defaults.material_id);
            materialPicker.classList.add("is-confirmed");
            materialPicker.innerHTML = `<div class="quote-material-summary" role="status" aria-live="polite"><span class="quote-material-check" aria-hidden="true">&#10003;</span><span class="quote-material-summary-copy"><small>Material selected</small><strong>${esc(category?.label || state.defaults.material_category)}${material ? ` <span>&middot;</span> ${esc(material.label)}` : ""}</strong></span><button type="button" class="quote-material-change" data-material-change>Change</button></div>`;
            const changeButton = materialPicker.querySelector('[data-material-change]');
            if (changeButton) changeButton.addEventListener('click', openMaterialPicker);
            return;
        }

        materialPicker.classList.remove("is-confirmed");
        const { cats, filtered } = getCurrentMaterialContext();
        const { category, material } = getMaterialSelection(state.materialDraft.category, state.materialDraft.id);
        materialPicker.innerHTML = `<div class="quote-material-categories">${cats.map(c=>`<button type="button" class="quote-material-cat-btn${c.id===state.materialDraft.category?' active':''}" data-cat-id="${esc(c.id)}" aria-pressed="${c.id===state.materialDraft.category?'true':'false'}">${esc(c.label)}</button>`).join("")}</div><div class="quote-material-grades"><input type="text" class="quote-material-search" placeholder="Search grade..." value="${esc(state.materialSearch)}" data-material-search><div class="quote-material-grade-list" role="listbox" aria-label="Material grade">${renderMaterialGradeOptions(filtered)}</div></div><div class="quote-material-actions"><span>Selection: <strong>${esc(category?.label || "Choose category")}${material ? ` &middot; ${esc(material.label)}` : ""}</strong></span><button type="button" class="quote-material-confirm" data-material-confirm${material ? "" : " disabled"}>Use this material</button></div>`;
        bindMaterialPickerEvents();
    }

    function openMaterialPicker() {
        state.materialDraft.category = state.defaults.material_category;
        state.materialDraft.id = state.defaults.material_id;
        state.materialSearch = "";
        state.materialPickerOpen = true;
        renderMaterialPicker();
    }

    function confirmMaterialSelection() {
        const { category, material } = getMaterialSelection(state.materialDraft.category, state.materialDraft.id);
        if (!category || !material) return;

        const activePart = getActivePart();
        const changed = state.defaults.material_category !== category.id || state.defaults.material_id !== material.id;
        state.defaults.material_category = category.id;
        state.defaults.material_id = material.id;
        state.materialConfirmed = true;
        state.materialPickerOpen = false;
        state.materialSearch = "";

        if (activePart) {
            activePart.settings.material_category = category.id;
            activePart.settings.material_id = material.id;
            activePart.settingsSource = "override";
            if (changed && activePart.estimate) {
                activePart.estimate = null;
                activePart.estimateStatus = "needs_recalculate";
                activePart.estimateCacheKey = "";
            }
        }

        renderMaterialPicker();
        render();
    }
    /* Batch upload */
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
            if (state.nextSourceOrder >= MAX_BATCH_FILES) { skipped++; return; }
            const extension = (file.name.toLowerCase().split(".").pop() || "");
            const part = {
                id: createPartId(),
                index: state.parts.length,
                sourceOrder: state.nextSourceOrder++,
                remotePosition: 0,
                file,
                fileName: file.name,
                fullFileName: file.name,
                fileKey: fk,
                isArchive: ARCHIVE_EXTENSIONS.has(extension),
                analysisStatus: "pending",
                uploadStatus: "pending",
                estimateStatus: "empty",
                analysis: null,
                estimate: null,
                settings: cloneDefaults(),
                settingsSource: "inherited",
                estimateCacheKey: "",
                error: "",
                estimateError: "",
                previewMode: "png",
                analysisPresentation: { phase: "Queued for CAD analysis" },
            };
            state.parts.push(part);
            existing.add(fk);
            added++;
        });
        if (!state.activePartId && state.parts.length) state.activePartId = state.parts[0].id;
        if (files.length !== valid.length || skipped) announce(`${added} file(s) added. ${files.length - added} file(s) skipped.`);
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
        if (state.analysisLoopRunning) return;
        state.analysisLoopRunning = true;
        try {
            for (const part of state.parts) {
                if (part.uploadStatus !== "pending" || part.jobId) continue;
                part.analysisStatus = "uploading";
                part.uploadStatus = "analyzing";
                part.analysisPresentation = { phase: "Uploading CAD file" };
                renderForPartUpdate(part);
                try {
                    if (part.isArchive && asyncArchiveAnalysisEnabled()) {
                        const handledAsynchronously = await createArchiveJob(part);
                        if (handledAsynchronously) continue;
                    }
                    const uploadResult = await uploadCad(part.file);
                    if (uploadResult.archive) {
                        expandLegacyArchivePart(part, uploadResult);
                        render();
                        continue;
                    }
                    part.analysis = uploadResult.analysis;
                    part.analysisStatus = "ready";
                    part.uploadStatus = "ready";
                    part.analysisPresentation.phase = "Preview ready";
                } catch (error) {
                    markPartAnalysisFailed(part, friendlyAnalysisError(error));
                }
                renderForPartUpdate(part);
            }
        } finally {
            state.analysisLoopRunning = false;
            if (state.parts.some(part => part.uploadStatus === "pending" && !part.jobId)) queueMicrotask(analyzePendingParts);
        }
    }

    function renderForPartUpdate(part, { force = false } = {}) {
        if (!part) return;
        if (force || part.id === state.activePartId) { render(); } else { renderPartList(); }
    }

    function markPartAnalysisFailed(part, message) {
        part.analysisStatus = "failed";
        part.uploadStatus = "failed";
        part.error = message || "This CAD file could not be analyzed.";
        part.analysisPresentation = { phase: "CAD analysis failed" };
    }

    function friendlyAnalysisError(error) {
        if (error?.network || error?.code === "network_unavailable") return "The analysis service is temporarily unreachable. Please retry.";
        if (error?.status === 429) return "The analysis queue is busy. Please wait and retry.";
        if (error?.status === 503) return "CAD analysis is temporarily unavailable. Please retry shortly.";
        const message = String(error?.message || "").trim();
        if (!message || /failed to fetch/i.test(message)) return "The analysis service is temporarily unreachable. Please retry.";
        return message;
    }

    async function uploadCad(file) {
        const site = currentSite();
        const body = new FormData();
        body.append("file", file);
        body.append("site", site);
        body.append("theme", site);
        const resp = await window.DaiyujinAPI.request("/api/public/quote/upload", { method: "POST", body });
        if (resp.archive) {
            return {
                archive: true,
                parts: resp.parts || [],
                warnings: resp.warnings || [],
                source_filename: resp.source_filename || file.name,
            };
        }
        if (!resp.success || !resp.data) throw new Error(resp.error || resp.message || "CAD analysis failed.");
        return { archive: false, analysis: { file_id: resp.file_id, source_filename: resp.source_filename || file.name, source_format: resp.source_format || "", ...resp.data } };
    }

    function normalizeLegacyArchiveAnalysis(item) {
        const data = item.data || {};
        return {
            file_id: item.file_id || data.file_id || "",
            source_filename: item.source_filename || data.source_filename || data.name || "CAD part",
            source_format: item.source_format || data.source_format || "",
            ...data,
        };
    }

    function expandLegacyArchivePart(parent, uploadResult) {
        const insertAt = state.parts.findIndex(part => part.id === parent.id);
        if (insertAt < 0) return;
        const parentWasActive = state.activePartId === parent.id;
        const settingsSnapshot = JSON.parse(JSON.stringify(parent.settings || state.defaults));
        const children = (uploadResult.parts || []).map((item, position) => {
            const fullName = item.source_filename || "CAD part";
            const ready = !!item.success;
            return {
                id: createPartId(),
                index: 0,
                sourceOrder: parent.sourceOrder,
                remotePosition: position,
                remotePartId: "",
                jobId: "",
                file: null,
                fileName: shortFileName(fullName),
                fullFileName: fullName,
                fileKey: `${parent.fileKey}::${item.file_id || fullName}`,
                isArchive: false,
                analysisStatus: ready ? "ready" : "failed",
                uploadStatus: ready ? "ready" : "failed",
                estimateStatus: "empty",
                analysis: ready ? normalizeLegacyArchiveAnalysis(item) : null,
                estimate: null,
                settings: JSON.parse(JSON.stringify(settingsSnapshot)),
                settingsSource: "inherited",
                estimateCacheKey: "",
                error: item.error || "",
                errorCode: item.error_code || "",
                estimateError: "",
                attemptCount: 0,
                previewMode: "png",
                analysisPresentation: { phase: ready ? "Preview ready" : "CAD analysis failed" },
            };
        });
        if (!children.length) {
            markPartAnalysisFailed(parent, "The archive did not contain supported CAD files.");
            return;
        }
        state.parts.splice(insertAt, 1, ...children);
        reindexParts();
        if (parentWasActive) {
            const firstReady = children.find(part => part.uploadStatus === "ready") || children[0];
            state.activePartId = firstReady.id;
            hydrateFormFromPart(firstReady);
        }
        updateUploadLabel();
        const readyCount = children.filter(part => part.uploadStatus === "ready").length;
        announce(`${readyCount} of ${children.length} archive part(s) ready.`);
    }

    function createJobToken() {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        let raw = "";
        bytes.forEach(value => { raw += String.fromCharCode(value); });
        return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    function jobHeaders(entry, extra = {}) {
        return {
            "X-Quote-Job-Token": entry.token,
            ...extra,
        };
    }

    function jobPath(entry, suffix = "") {
        return `/api/public/quote/analysis-jobs/${encodeURIComponent(entry.id)}${suffix}`;
    }

    async function postArchiveJob(entry, file) {
        const site = currentSite();
        const body = new FormData();
        body.append("file", file);
        body.append("site", site);
        body.append("theme", site);
        return window.DaiyujinAPI.requestWithMeta("/api/public/quote/analysis-jobs", {
            method: "POST",
            body,
            headers: jobHeaders(entry, { "Idempotency-Key": entry.id }),
        });
    }

    async function createArchiveJob(parent) {
        const entry = {
            id: createBatchId(),
            token: createJobToken(),
            parentId: parent.id,
            sourceOrder: parent.sourceOrder,
            settingsSnapshot: JSON.parse(JSON.stringify(parent.settings)),
            status: "queued",
            etag: "",
            failureCount: 0,
            pollAfterMs: 1000,
            pollTimer: 0,
            pollInFlight: false,
            readyCount: 0,
            createConfirmed: false,
            pendingFile: parent.file,
            connectionInterrupted: false,
        };
        parent.jobId = entry.id;
        parent.analysisStatus = "queued";
        parent.analysisPresentation = { phase: "Creating analysis job" };
        state.analysisJobs.set(entry.id, entry);
        persistAnalysisJobs();

        try {
            const response = await postArchiveJob(entry, parent.file);
            entry.createConfirmed = true;
            entry.pendingFile = null;
            applyJobResponse(entry, response);
            setJobConnectionState(entry, false);
            scheduleJobPoll(entry, entry.pollAfterMs);
            return true;
        } catch (error) {
            if (error?.code === "async_archives_disabled") {
                if (state.options) state.options.async_archive_analysis = false;
                clearTimeout(entry.pollTimer);
                state.analysisJobs.delete(entry.id);
                parent.jobId = "";
                parent.analysisStatus = "uploading";
                parent.uploadStatus = "analyzing";
                parent.analysisPresentation = { phase: "Switching to compatible archive analysis" };
                setJobConnectionState(entry, false);
                persistAnalysisJobs();
                render();
                return false;
            }
            if (error?.network || !error?.status || error.status >= 500) {
                entry.status = "recovering";
                parent.analysisStatus = "queued";
                parent.uploadStatus = "pending";
                parent.analysisPresentation = { phase: "Connection interrupted. Recovering upload" };
                setJobConnectionState(entry, true);
                persistAnalysisJobs();
                render();
                scheduleJobPoll(entry, retryDelay(error, entry.failureCount++));
            } else {
                state.analysisJobs.delete(entry.id);
                persistAnalysisJobs();
                markPartAnalysisFailed(parent, friendlyAnalysisError(error));
                render();
            }
            return true;
        }
    }

    function applyJobResponse(entry, response) {
        const etag = response?.headers?.get("ETag");
        if (etag) entry.etag = etag;
        if (response?.status === 304 || !response?.data) return;
        syncJobSnapshot(entry, response.data);
    }

    function normalizeJobAnalysis(item) {
        const raw = item.analysis || {};
        const data = raw.data || raw;
        return {
            file_id: item.file_id || data.file_id || "",
            source_filename: item.source_filename || data.source_filename || data.name || "CAD part",
            source_format: item.source_format || data.source_format || "",
            ...data,
        };
    }

    function mapRemotePartState(remoteStatus) {
        const status = String(remoteStatus || "queued").toLowerCase();
        if (status === "ready" || status === "completed") return { analysisStatus: "ready", uploadStatus: "ready" };
        if (status === "failed") return { analysisStatus: "failed", uploadStatus: "failed" };
        if (status === "cancelled") return { analysisStatus: "cancelled", uploadStatus: "cancelled" };
        if (status === "analyzing" || status === "processing") return { analysisStatus: "analyzing", uploadStatus: "analyzing" };
        return { analysisStatus: status, uploadStatus: "pending" };
    }

    function makeRemotePart(entry, item) {
        const fullName = item.source_filename || "CAD part";
        const mapped = mapRemotePartState(item.status);
        return {
            id: `job-${entry.id}-part-${item.id}`,
            remotePartId: String(item.id),
            jobId: entry.id,
            index: 0,
            sourceOrder: entry.sourceOrder,
            remotePosition: Number(item.position) || 0,
            file: null,
            fileName: shortFileName(fullName),
            fullFileName: fullName,
            fileKey: `${entry.id}::${item.id}`,
            isArchive: false,
            analysisStatus: mapped.analysisStatus,
            uploadStatus: mapped.uploadStatus,
            estimateStatus: "empty",
            analysis: mapped.analysisStatus === "ready" ? normalizeJobAnalysis(item) : null,
            estimate: null,
            settings: JSON.parse(JSON.stringify(entry.settingsSnapshot || state.defaults)),
            settingsSource: "inherited",
            estimateCacheKey: "",
            error: item.error || "",
            errorCode: item.error_code || "",
            estimateError: "",
            attemptCount: Number(item.attempt_count) || 0,
            previewMode: "png",
            analysisPresentation: { phase: item.phase || "Queued for CAD analysis" },
        };
    }

    function updateRemotePart(part, item) {
        const previousStatus = part.analysisStatus;
        const mapped = mapRemotePartState(item.status);
        part.analysisStatus = mapped.analysisStatus;
        part.uploadStatus = mapped.uploadStatus;
        part.remotePosition = Number(item.position) || part.remotePosition || 0;
        part.fullFileName = item.source_filename || part.fullFileName;
        part.fileName = shortFileName(part.fullFileName);
        part.error = item.error || "";
        part.errorCode = item.error_code || "";
        part.attemptCount = Number(item.attempt_count) || 0;
        part.analysisPresentation = { phase: item.phase || (mapped.analysisStatus === "ready" ? "Preview ready" : "Queued for CAD analysis") };
        if (mapped.analysisStatus === "ready" && item.analysis) part.analysis = normalizeJobAnalysis(item);
        if (previousStatus === "failed" && mapped.analysisStatus !== "failed") part.error = "";
    }

    function syncJobSnapshot(entry, payload) {
        const job = payload.job || {};
        const remoteParts = Array.isArray(payload.parts) ? payload.parts.slice().sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)) : [];
        entry.status = String(job.status || entry.status || "queued");
        entry.counts = job.counts || entry.counts || {};
        entry.pollAfterMs = Number(payload.poll_after_ms) || entry.pollAfterMs || 1000;

        const oldReady = entry.readyCount || 0;
        if (remoteParts.length) {
            const existing = new Map(state.parts.filter(part => part.jobId === entry.id && part.remotePartId).map(part => [part.remotePartId, part]));
            const nextParts = remoteParts.map(item => {
                const remoteId = String(item.id);
                const part = existing.get(remoteId) || makeRemotePart(entry, item);
                if (existing.has(remoteId)) updateRemotePart(part, item);
                return part;
            });
            const parentWasActive = state.activePartId === entry.parentId;
            state.parts = state.parts.filter(part => part.id !== entry.parentId && part.jobId !== entry.id).concat(nextParts);
            state.parts.sort((a, b) => (a.sourceOrder - b.sourceOrder) || ((a.remotePosition || 0) - (b.remotePosition || 0)));
            reindexParts();

            const readyParts = nextParts.filter(part => part.analysisStatus === "ready");
            entry.readyCount = readyParts.length;
            const active = getActivePart();
            const restoredActive = entry.restoreActivePartId ? nextParts.find(part => part.id === entry.restoreActivePartId) : null;
            if (restoredActive) {
                state.userSelectedPart = true;
                setActivePart(restoredActive.id, { userInitiated: false });
                entry.restoreActivePartId = "";
            } else if (parentWasActive || (!state.userSelectedPart && (!active || active.uploadStatus !== "ready"))) {
                const nextActive = readyParts[0] || nextParts[0];
                if (nextActive) setActivePart(nextActive.id, { userInitiated: false });
            }
            if (entry.readyCount > oldReady) {
                const newest = readyParts[readyParts.length - 1];
                announce(`${newest?.fileName || "A CAD part"} is ready. ${entry.readyCount} part(s) complete.`);
            }
        } else {
            const parent = state.parts.find(part => part.id === entry.parentId);
            if (parent) {
                if (entry.status === "cancelled") {
                    parent.analysisStatus = "cancelled";
                    parent.uploadStatus = "cancelled";
                    parent.analysisPresentation = { phase: "Analysis cancelled" };
                    parent.error = "";
                } else {
                    parent.analysisStatus = entry.status === "failed" ? "failed" : "queued";
                    parent.uploadStatus = entry.status === "failed" ? "failed" : "pending";
                    parent.analysisPresentation = { phase: entry.status === "extracting" ? "Scanning archive folders" : "Waiting for archive inventory" };
                    if (entry.status === "failed") parent.error = job.error || "The archive could not be analyzed.";
                }
            }
        }

        if (TERMINAL_JOB_STATES.has(entry.status)) {
            clearTimeout(entry.pollTimer);
            if (!remoteParts.length && entry.status !== "cancelled") {
                const parent = state.parts.find(part => part.id === entry.parentId);
                if (parent) markPartAnalysisFailed(parent, job.error || "The archive did not contain supported CAD files.");
            }
        }
        persistAnalysisJobs();
        updateUploadLabel();
        render();
    }

    function scheduleJobPoll(entry, delay = null) {
        if (!entry || TERMINAL_JOB_STATES.has(entry.status)) return;
        clearTimeout(entry.pollTimer);
        const baseDelay = delay === null ? (document.hidden ? 5000 : 1000) : delay;
        entry.pollTimer = window.setTimeout(() => pollAnalysisJob(entry), Math.max(0, baseDelay));
    }

    function retryDelay(error, failureCount) {
        if (error?.retryAfter) {
            const seconds = Number(error.retryAfter);
            if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
            const retryAt = Date.parse(error.retryAfter);
            if (Number.isFinite(retryAt)) return Math.max(1000, retryAt - Date.now());
        }
        const base = POLL_BACKOFF_MS[Math.min(failureCount, POLL_BACKOFF_MS.length - 1)];
        return Math.round(base * (0.85 + Math.random() * 0.3));
    }

    async function pollAnalysisJob(entry) {
        if (!entry || entry.pollInFlight || TERMINAL_JOB_STATES.has(entry.status)) return;
        entry.pollInFlight = true;
        try {
            const headers = jobHeaders(entry, entry.etag ? { "If-None-Match": entry.etag } : {});
            const response = await window.DaiyujinAPI.requestWithMeta(jobPath(entry), { headers });
            entry.createConfirmed = true;
            entry.pendingFile = null;
            entry.failureCount = 0;
            setJobConnectionState(entry, false);
            applyJobResponse(entry, response);
            scheduleJobPoll(entry, document.hidden ? 5000 : entry.pollAfterMs || 1000);
        } catch (error) {
            if (error?.status > 0 && error.status < 500) setJobConnectionState(entry, false);
            if (error?.status === 404 && !entry.createConfirmed && entry.pendingFile) {
                try {
                    const response = await postArchiveJob(entry, entry.pendingFile);
                    entry.createConfirmed = true;
                    entry.pendingFile = null;
                    entry.failureCount = 0;
                    setJobConnectionState(entry, false);
                    applyJobResponse(entry, response);
                    scheduleJobPoll(entry, entry.pollAfterMs || 1000);
                } catch (postError) {
                    if (postError?.status > 0 && postError.status < 500) setJobConnectionState(entry, false);
                    if (postError?.network || !postError?.status || postError.status >= 500) {
                        entry.failureCount += 1;
                        setJobConnectionState(entry, true);
                        scheduleJobPoll(entry, retryDelay(postError, entry.failureCount - 1));
                    } else {
                        entry.status = "failed";
                        const parent = state.parts.find(part => part.id === entry.parentId);
                        if (parent) markPartAnalysisFailed(parent, friendlyAnalysisError(postError));
                        persistAnalysisJobs();
                        render();
                    }
                }
            } else if (error?.status === 404 || error?.status === 410) {
                entry.status = "expired";
                state.parts.filter(part => part.jobId === entry.id || part.id === entry.parentId).forEach(part => {
                    if (part.uploadStatus !== "ready") markPartAnalysisFailed(part, "This analysis job has expired. Please upload the archive again.");
                });
                persistAnalysisJobs();
                render();
            } else if (error?.status === 401 || error?.status === 403) {
                entry.status = "failed";
                state.parts.filter(part => part.jobId === entry.id || part.id === entry.parentId).forEach(part => {
                    if (part.uploadStatus !== "ready") markPartAnalysisFailed(part, "This analysis session is no longer authorized. Please upload again.");
                });
                persistAnalysisJobs();
                render();
            } else {
                entry.failureCount += 1;
                setJobConnectionState(entry, true);
                scheduleJobPoll(entry, retryDelay(error, entry.failureCount - 1));
            }
        } finally {
            entry.pollInFlight = false;
        }
    }

    function setNetworkState(status) {
        if (state.networkStatus === status) return;
        state.networkStatus = status;
        if (status === "reconnecting") announce("Connection interrupted. CAD analysis will resume automatically.");
        renderBatchStatus();
    }

    function setJobConnectionState(entry, interrupted) {
        if (entry) entry.connectionInterrupted = interrupted;
        const anyInterrupted = Array.from(state.analysisJobs.values()).some(job => job.connectionInterrupted);
        setNetworkState(anyInterrupted ? "reconnecting" : "online");
    }

    function persistAnalysisJobs() {
        try {
            const jobs = Array.from(state.analysisJobs.values())
                .filter(entry => !TERMINAL_JOB_STATES.has(entry.status))
                .map(entry => ({
                    id: entry.id,
                    token: entry.token,
                    sourceOrder: entry.sourceOrder,
                    settingsSnapshot: entry.settingsSnapshot,
                }));
            const activePart = getActivePart();
            const activePartId = activePart?.jobId ? activePart.id : "";
            if (jobs.length) sessionStorage.setItem(JOB_STORAGE_KEY, JSON.stringify({ jobs, activePartId }));
            else sessionStorage.removeItem(JOB_STORAGE_KEY);
        } catch (error) {}
    }

    function restoreAnalysisJobs() {
        let saved = [], restoredActivePartId = "";
        try {
            const stored = JSON.parse(sessionStorage.getItem(JOB_STORAGE_KEY) || "[]");
            saved = Array.isArray(stored) ? stored : stored.jobs;
            restoredActivePartId = Array.isArray(stored) ? "" : String(stored.activePartId || "");
        } catch (error) { saved = []; }
        if (!Array.isArray(saved)) return;
        saved.forEach(savedJob => {
            if (!savedJob?.id || !savedJob?.token || state.analysisJobs.has(savedJob.id)) return;
            const storedOrder = Number(savedJob.sourceOrder);
            const sourceOrder = Number.isFinite(storedOrder) ? storedOrder : state.nextSourceOrder;
            state.nextSourceOrder = Math.max(state.nextSourceOrder, sourceOrder + 1);
            const settingsSnapshot = savedJob.settingsSnapshot && typeof savedJob.settingsSnapshot === "object" ? savedJob.settingsSnapshot : cloneDefaults();
            const placeholder = {
                id: `restored-${savedJob.id}`,
                index: state.parts.length,
                sourceOrder,
                remotePosition: 0,
                file: null,
                fileName: "Restoring archive analysis",
                fullFileName: "Restoring archive analysis",
                fileKey: `restored::${savedJob.id}`,
                isArchive: true,
                jobId: savedJob.id,
                analysisStatus: "queued",
                uploadStatus: "pending",
                estimateStatus: "empty",
                analysis: null,
                estimate: null,
                settings: JSON.parse(JSON.stringify(settingsSnapshot)),
                settingsSource: "inherited",
                estimateCacheKey: "",
                error: "",
                estimateError: "",
                previewMode: "png",
                analysisPresentation: { phase: "Restoring analysis session" },
            };
            const entry = {
                id: savedJob.id,
                token: savedJob.token,
                parentId: placeholder.id,
                sourceOrder,
                settingsSnapshot: JSON.parse(JSON.stringify(settingsSnapshot)),
                status: "queued",
                etag: "",
                failureCount: 0,
                pollAfterMs: 1000,
                pollTimer: 0,
                pollInFlight: false,
                readyCount: 0,
                createConfirmed: false,
                pendingFile: null,
                connectionInterrupted: false,
                restoreActivePartId: restoredActivePartId.startsWith(`job-${savedJob.id}-part-`) ? restoredActivePartId : "",
            };
            state.parts.push(placeholder);
            state.analysisJobs.set(entry.id, entry);
            if (!state.activePartId) state.activePartId = placeholder.id;
            scheduleJobPoll(entry, 0);
        });
    }

    function announce(message) {
        if (!analysisLive || !message) return;
        clearTimeout(state.liveTimer);
        analysisLive.textContent = "";
        state.liveTimer = window.setTimeout(() => { analysisLive.textContent = message; }, 40);
    }

    async function retryRemotePart(part) {
        const entry = state.analysisJobs.get(part?.jobId);
        if (!entry || !part?.remotePartId) return;
        part.analysisStatus = "queued";
        part.uploadStatus = "pending";
        part.error = "";
        part.analysisPresentation = { phase: "Retry requested" };
        render();
        try {
            const response = await window.DaiyujinAPI.requestWithMeta(jobPath(entry, `/parts/${encodeURIComponent(part.remotePartId)}/retry`), {
                method: "POST",
                headers: jobHeaders(entry),
            });
            entry.status = "analyzing";
            setJobConnectionState(entry, false);
            applyJobResponse(entry, response);
            scheduleJobPoll(entry, 0);
        } catch (error) {
            if (error?.network || !error?.status || error.status >= 500) {
                entry.status = "recovering";
                entry.failureCount += 1;
                part.analysisStatus = "queued";
                part.uploadStatus = "pending";
                part.analysisPresentation = { phase: "Connection interrupted. Recovering retry" };
                setJobConnectionState(entry, true);
                persistAnalysisJobs();
                render();
                scheduleJobPoll(entry, retryDelay(error, entry.failureCount - 1));
                return;
            }
            setJobConnectionState(entry, false);
            markPartAnalysisFailed(part, friendlyAnalysisError(error));
            render();
        }
    }

    async function cancelActiveJobs() {
        const activeJobs = Array.from(state.analysisJobs.values()).filter(entry => !TERMINAL_JOB_STATES.has(entry.status));
        cancelAnalysisButton?.setAttribute("disabled", "");
        await Promise.all(activeJobs.map(async entry => {
            try {
                const response = await window.DaiyujinAPI.requestWithMeta(jobPath(entry, "/cancel"), {
                    method: "POST",
                    headers: jobHeaders(entry),
                });
                setJobConnectionState(entry, false);
                applyJobResponse(entry, response);
            } catch (error) {
                if (error?.network) setJobConnectionState(entry, true);
            }
        }));
        cancelAnalysisButton?.removeAttribute("disabled");
        render();
    }

    if (cancelAnalysisButton) cancelAnalysisButton.addEventListener("click", cancelActiveJobs);

    function refreshActivePolls() {
        state.analysisJobs.forEach(entry => {
            if (!TERMINAL_JOB_STATES.has(entry.status) && !entry.pollInFlight) scheduleJobPoll(entry, document.hidden ? 5000 : 0);
        });
    }

    document.addEventListener("visibilitychange", refreshActivePolls);
    window.addEventListener("online", refreshActivePolls);

    function archivePartCanRetry(part) {
        const entry = part?.jobId ? state.analysisJobs.get(part.jobId) : null;
        return part?.analysisStatus === "failed" && !!entry && !["expired", "cancelled"].includes(entry.status) && Number(part.attemptCount || 0) < 2;
    }

    function updateWorkspaceMode() {
        if (!workspace) return;
        const count = state.parts.length;
        const showRail = count > 1 || state.analysisJobs.size > 0;
        workspace.classList.toggle("is-empty", count === 0);
        workspace.classList.toggle("is-single", count === 1 && !showRail);
        workspace.classList.toggle("is-batch", showRail);
        workspace.dataset.partCount = String(count);
        if (batchParts) batchParts.hidden = !showRail;
    }
    /* Part list UI */
    function renderPartList() {
        updateWorkspaceMode();
        if (!batchParts || !partList) return;
        renderBatchStatus();
        const showRail = state.parts.length > 1 || state.analysisJobs.size > 0;
        if (!showRail) {
            partList.replaceChildren();
            return;
        }

        const desiredIds = new Set(state.parts.map(part => part.id));
        Array.from(partList.querySelectorAll("[data-part-entry]")).forEach(entryEl => {
            if (!desiredIds.has(entryEl.dataset.partEntry)) entryEl.remove();
        });

        const entryById = new Map(Array.from(partList.querySelectorAll("[data-part-entry]")).map(entryEl => [entryEl.dataset.partEntry, entryEl]));
        state.parts.forEach((part, index) => {
            let entryEl = entryById.get(part.id);
            if (!entryEl) {
                entryEl = createPartRow(part.id);
                entryById.set(part.id, entryEl);
            }
            updatePartRow(entryEl, part);
            const currentAtIndex = partList.children[index];
            if (currentAtIndex !== entryEl) partList.insertBefore(entryEl, currentAtIndex || null);
        });
    }

    function createPartRow(partId) {
        const entryEl = document.createElement("div");
        entryEl.className = "quote-part-entry";
        entryEl.dataset.partEntry = partId;
        entryEl.setAttribute("role", "listitem");

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "quote-part-row";
        selectButton.dataset.partId = partId;
        ["quote-part-index", "quote-part-name", "quote-part-status", "quote-part-total"].forEach(className => {
            const span = document.createElement("span");
            span.className = className;
            selectButton.appendChild(span);
        });
        selectButton.addEventListener("click", () => setActivePart(selectButton.dataset.partId, { userInitiated: true }));

        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "quote-part-retry";
        retryButton.textContent = "Retry";
        retryButton.hidden = true;
        retryButton.addEventListener("click", () => {
            const part = state.parts.find(item => item.id === retryButton.dataset.retryPartId);
            if (part) retryRemotePart(part);
        });
        entryEl.append(selectButton, retryButton);
        return entryEl;
    }

    function partDisplayState(part) {
        if (part.uploadStatus !== "ready") {
            const status = part.analysisStatus || part.uploadStatus || "pending";
            const labels = { pending: "Pending", waiting: "Waiting", queued: "Queued", uploading: "Uploading", extracting: "Scanning", analyzing: "Analyzing", failed: "Failed", cancelled: "Cancelled" };
            const classes = { pending: "neutral", waiting: "neutral", queued: "neutral", uploading: "blue", extracting: "blue", analyzing: "blue", failed: "red", cancelled: "neutral" };
            return { label: labels[status] || "Pending", className: classes[status] || "neutral" };
        }
        const estimateLabels = { calculating: "Estimating", estimated: "Estimated", needs_recalculate: "Needs Update", failed: "Estimate Retry" };
        const estimateClasses = { calculating: "blue", estimated: "green", needs_recalculate: "amber", failed: "amber" };
        if (estimateLabels[part.estimateStatus]) return { label: estimateLabels[part.estimateStatus], className: estimateClasses[part.estimateStatus] };
        return { label: "Ready", className: "green" };
    }

    function updatePartRow(entryEl, part) {
        const selectButton = entryEl.querySelector("[data-part-id]");
        const retryButton = entryEl.querySelector(".quote-part-retry");
        const display = partDisplayState(part);
        const total = part.estimate && part.estimateStatus === "estimated" ? (part.estimate.total_estimate || {}).display || "" : "";
        entryEl.dataset.partEntry = part.id;
        entryEl.classList.toggle("has-action", archivePartCanRetry(part));
        selectButton.dataset.partId = part.id;
        selectButton.title = part.fullFileName || part.fileName;
        selectButton.classList.toggle("active", part.id === state.activePartId);
        selectButton.setAttribute("aria-current", part.id === state.activePartId ? "true" : "false");
        selectButton.setAttribute("aria-busy", ACTIVE_PART_STATES.has(part.analysisStatus) || part.analysisStatus === "uploading" ? "true" : "false");
        selectButton.querySelector(".quote-part-index").textContent = String(part.index + 1);
        selectButton.querySelector(".quote-part-name").textContent = part.fileName || "CAD part";
        const statusEl = selectButton.querySelector(".quote-part-status");
        statusEl.className = `quote-part-status ${display.className}`;
        statusEl.textContent = display.label;
        const totalEl = selectButton.querySelector(".quote-part-total");
        totalEl.textContent = total;
        totalEl.hidden = !total;
        retryButton.dataset.retryPartId = part.id;
        retryButton.hidden = !archivePartCanRetry(part);
        retryButton.setAttribute("aria-label", `Retry analysis for ${part.fileName || "CAD part"}`);
    }

    function renderBatchStatus() {
        const remoteParts = state.parts.filter(part => part.remotePartId);
        const displayParts = remoteParts.length ? remoteParts : state.parts.filter(part => !part.isArchive || !part.jobId);
        const total = remoteParts.length || Number(Array.from(state.analysisJobs.values()).find(entry => entry.counts?.total)?.counts?.total) || displayParts.length;
        const ready = remoteParts.filter(part => part.analysisStatus === "ready").length;
        const failed = remoteParts.filter(part => part.analysisStatus === "failed").length;
        const cancelled = remoteParts.filter(part => part.analysisStatus === "cancelled").length;
        const analyzing = remoteParts.filter(part => part.analysisStatus === "analyzing").length;
        const activeJobs = Array.from(state.analysisJobs.values()).filter(entry => !TERMINAL_JOB_STATES.has(entry.status));
        const finished = ready + failed + cancelled;
        const progress = total ? Math.round((finished / total) * 100) : 0;

        if (batchCount) batchCount.textContent = total ? `${total} part(s)` : "Reading archive";
        if (batchProgress) batchProgress.hidden = state.analysisJobs.size === 0;
        if (batchProgressLabel) {
            const suffix = [analyzing ? `${analyzing} analyzing` : "", failed ? `${failed} failed` : ""].filter(Boolean).join(", ");
            batchProgressLabel.textContent = total ? `${ready} / ${total} ready${suffix ? `, ${suffix}` : ""}` : "Reading archive inventory";
        }
        if (batchProgressbar) {
            batchProgressbar.setAttribute("aria-valuenow", String(progress));
            batchProgressbar.setAttribute("aria-valuetext", total ? `${finished} of ${total} processed, ${ready} ready, ${failed} failed` : "Reading archive inventory");
        }
        if (batchProgressFill) batchProgressFill.style.width = `${progress}%`;
        if (networkStatus) {
            networkStatus.hidden = state.networkStatus === "online";
            networkStatus.textContent = state.networkStatus === "online" ? "" : "Reconnecting";
        }
        if (cancelAnalysisButton) cancelAnalysisButton.hidden = activeJobs.length === 0;
    }

    function setActivePart(partId, { userInitiated = true } = {}) {
        if (userInitiated) state.userSelectedPart = true;
        if (state.activePartId === partId) return;
        const old = getActivePart();
        if (old && userInitiated) { old.settings = readSettingsFromForm(); old.settingsSource = "override"; }
        state.activePartId = partId;
        const part = getActivePart();
        if (part) { hydrateFormFromPart(part); }
        persistAnalysisJobs();
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
        state.defaults.material_category = s.material_category || state.defaults.material_category;
        state.defaults.material_id = s.material_id || state.defaults.material_id;
        state.materialDraft.category = state.defaults.material_category;
        state.materialDraft.id = state.defaults.material_id;
        state.materialPickerOpen = !state.materialConfirmed;
        renderMaterialPicker();
        if (processSelect) processSelect.value = s.process || state.defaults.process;
        if (toleranceSelect) toleranceSelect.value = s.tolerance_grade || state.defaults.tolerance_grade;
        if (postprocessSelect) postprocessSelect.value = s.postprocess_group || state.defaults.postprocess_group;
        form.querySelector('[name="quantity"]').value = s.quantity || state.defaults.quantity;
        if (currencySelect) currencySelect.value = s.currency || state.defaults.currency;
    }
    /* Calculate current part */
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await calculateCurrentPart();
    });

    async function calculateCurrentPart() {
        const part = getActivePart();
        if (!part) { renderError("Choose a CAD file first."); return; }
        if (part.uploadStatus !== "ready") { renderError("This part is not ready yet."); return; }
        if (!state.materialConfirmed) {
            state.materialPickerOpen = true;
            renderMaterialPicker();
            renderError("Confirm a material before calculating.");
            return;
        }
        const contact = validateContactDetails();
        if (!contact) return;

        part.settings = readSettingsFromForm();
        part.settingsSource = "override";
        const cacheKey = makeEstimateCacheKey(part);
        const cacheHit = part.estimate && part.estimateCacheKey === cacheKey;

        part.estimateStatus = "calculating";
        part.estimateError = "";
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
                part.estimateStatus = "failed";
                part.estimateError = friendlyEstimateError(err);
                finishEstimatePresentation(part, false);
                render();
                return;
            }
        }

        await waitForPresentationMinimum(part);
        estimate = { ...estimate, customer_name: contact.customer_name, customer_email: contact.customer_email };
        part.estimate = estimate;
        part.estimateCacheKey = cacheKey;
        part.estimateStatus = "estimated";
        finishEstimatePresentation(part, true);
        render();
    }

    function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function friendlyEstimateError(error) {
        const message = String(error?.message || "").trim();
        if (!message || error?.network || /failed to fetch/i.test(message)) return "The estimate service is temporarily unreachable. Please retry.";
        return message;
    }

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
    /* Render */
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
        else if (part.uploadStatus === "cancelled") calculateButton.textContent = "Analysis Cancelled";
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

        if (part.uploadStatus === "cancelled") {
            return `<section class="tool-panel quote-preview-panel"><h2>Part Preview</h2><div class="tool-note">CAD analysis was cancelled. Upload the archive again to restart this part.</div></section>`;
        }

        if (!part.analysis) {
            return previewAnalysisCard(part);
        }

        return previewReadyCard(part);
    }

    function previewAnalysisCard(part) {
        const p = part.analysisPresentation || {};
        const phase = p.phase || "Reading CAD geometry";
        return `<section class="tool-panel quote-preview-panel quote-preview-analysis" aria-busy="true">
            <div class="quote-preview-head"><h2>Part Preview</h2></div>
            <div class="quote-analysis-card">
                <div class="quote-analysis-title"><span>CAD analysis</span><strong>${esc(part.fileName || "Current part")}</strong></div>
                <div class="quote-progress quote-progress-indeterminate">
                    <div class="quote-progress-bar"><div class="quote-progress-fill"></div></div>
                    <div class="quote-progress-text"><span class="quote-progress-phase">${esc(phase)}</span><span>Working</span></div>
                </div>
                <div class="tool-note" style="margin-top:.75rem;">Each part becomes available as soon as its geometry and preview are ready.</div>
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
            return `<section class="tool-panel quote-estimate"><h2>Reference Estimate</h2><div class="tool-note error">Reference estimate failed. Please adjust inputs or retry. ${esc(part.estimateError || "Please try again.")}</div></section>`;
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
                <div class="metric-row"><span>Material</span><strong>${esc(sel.material_category||'-')}${sel.material?' &middot; '+esc(sel.material):''}</strong></div>
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
    /* Helpers */
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
    restoreAnalysisJobs();
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
