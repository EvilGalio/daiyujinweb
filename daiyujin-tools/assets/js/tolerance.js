/* ISO Tolerance Calculator instrument panel */

document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-tolerance-form]");
    const result = document.querySelector("[data-tolerance-result]");
    const fitInput = document.querySelector("#fit-combination");
    const presetSelect = document.querySelector("#preset");
    const calcBtn = document.querySelector("[data-calc-btn]");
    const validation = document.querySelector("[data-validation]");
    const fitModeGroup = document.querySelector("[data-fit-mode]");
    const customGroup = document.querySelector("[data-custom-group]");
    const presetGroup = document.querySelector("[data-preset-group]");
    const customBasisGroup = document.querySelector("[data-custom-basis-group]");
    const singleGroup = document.querySelector("[data-single-group]");
    const singleBasisGroup = document.querySelector("[data-single-basis]");
    if (!form || !result || !fitInput) return;

    const $ = (s) => document.querySelector(s);
    const fitmapSvg = $("[data-fitmap-svg]");
    const boreBody = $("[data-bore-body]");
    const shaftBody = $("[data-shaft-body]");
    const boreCode = $("[data-bore-code]");
    const shaftCode = $("[data-shaft-code]");
    const summaryType = $("[data-summary-type]");
    const summaryCombo = $("[data-summary-combo]");
    const summaryClearance = $("[data-summary-clearance]");
    const summaryInterference = $("[data-summary-interference]");

    const holeZoneSelect = $("[data-hole-zone]");
    const holeGradeSelect = $("[data-hole-grade]");
    const shaftZoneSelect = $("[data-shaft-zone]");
    const shaftGradeSelect = $("[data-shaft-grade]");
    const singleBasisInputs = document.querySelectorAll("[name='single_part']");
    const singleZoneSelect = $("[data-single-zone]");
    const singleGradeSelect = $("[data-single-grade]");

    let currentResult = null;

    drawPlaceholderFitmap();

    initControls();

    fitModeGroup.addEventListener("change", () => {
        const mode = fitModeGroup.querySelector("input:checked")?.value || "common";
        setMode(mode);
    });

    presetSelect.addEventListener("change", () => {
        const mode = fitModeGroup?.querySelector("input[name=fit_mode]:checked")?.value || "";
        if (presetSelect.value && mode === "common") {
            fitInput.value = presetSelect.value;
        }
    });

    presetSelect.addEventListener("change", () => {
        if (presetSelect.value && fitModeGroup.querySelector("input[name=fit_mode]:checked")?.value === "common") {
            autoCalc();
        }
    });

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        doCalc();
    });

    $("[data-reset-btn]")?.addEventListener("click", () => {
        document.querySelector("#basic-size").value = "25";
        fitInput.value = "H7/g6";
        presetSelect.value = "";
        currentResult = null;
        clearCards();
        drawPlaceholderFitmap();
        setState("idle");
        syncSingleSelectors();
    });

    $("[data-copy-btn]")?.addEventListener("click", () => {
        if (!currentResult) return;
        const lines = [];
        const d = currentResult;
        const size = d.basic_size_mm ?? 0;
        if (isFitMode(d)) {
            const h = d.hole;
            const s = d.shaft;
            const f = d.fit;
            const clearanceText = f.min_clearance_um != null && f.max_clearance_um != null
                ? `clearance range = ${f.min_clearance_um}\u2013${f.max_clearance_um} \u00b5m`
                : "";
            const interferenceText = f.max_interference_um > 0
                ? `, max interference = ${f.max_interference_um} \u00b5m`
                : "";
            lines.push(`${size} mm ${d.fit_combination}: ${f.label}.`);
            lines.push(`Bore ${h.tolerance} = ${fm(h.min_size_mm)}\u2013${fm(h.max_size_mm)} mm.`);
            lines.push(`Shaft ${s.tolerance} = ${fm(s.min_size_mm)}\u2013${fm(s.max_size_mm)} mm.`);
            if (clearanceText) lines.push(clearanceText + interferenceText);
        } else {
            const part = d.mode === "shaft" ? d.shaft : d.hole;
            if (part) {
                const partLabel = d.mode === "shaft" ? "Shaft" : "Bore";
                lines.push(`${size} mm ${d.fit_combination} (${partLabel})`);
                lines.push(`${partLabel} min size = ${fm(part.min_size_mm)} mm`);
                lines.push(`${partLabel} max size = ${fm(part.max_size_mm)} mm`);
                lines.push(`Tolerance width = ${part.it_um} \u00b5m`);
            }
        }
        navigator.clipboard.writeText(lines.join(" ")).catch(() => {});
        const btn = $("[data-copy-btn]");
        const orig = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });

    function autoCalc() {
        const size = Number(document.querySelector("#basic-size")?.value);
        if (!size || size < 1 || size > 3150) return;
        doCalc();
    }

    async function doCalc() {
        validation.hidden = true;
        const basicSize = Number(document.querySelector("#basic-size")?.value);
        const mode = fitModeGroup.querySelector("input[name=fit_mode]:checked")?.value || "common";
        const payload = buildPayload(mode, basicSize);
        if (!payload) return;

        if (!basicSize || basicSize < 1 || basicSize > 3150) {
            showValidation("Basic size must be between 1 and 3150 mm.");
            return;
        }

        setState("loading");
        if (calcBtn) {
            calcBtn.disabled = true;
            calcBtn.textContent = "Calculating\u2026";
        }
        drawLoadingFitmap();

        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/calculate", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            currentResult = data;
            renderAll(data);
            setState("result");
        } catch (error) {
            showValidation(error.message || "Calculation failed.");
            if (!currentResult) { clearCards(); drawPlaceholderFitmap(); }
            setState("error");
        } finally {
            if (calcBtn) {
                calcBtn.disabled = false;
                calcBtn.textContent = "Calculate";
            }
        }
    }

    function buildPayload(mode, basicSize) {
        const payload = { basic_size_mm: basicSize };
        if (!Number.isFinite(basicSize)) {
            return null;
        }

        if (mode === "single") {
            const basis = getSingleBasis();
            const zone = singleZoneSelect?.value?.trim() || "";
            const grade = singleGradeSelect?.value?.trim() || "";
            if (!zone || !grade) {
                showValidation("Choose one zone and one IT grade for single-zone mode.");
                return null;
            }
            payload.mode = basis;
            payload.single_basis = basis;
            payload.single_zone = zone;
            payload.single_grade = grade;
            payload[`${basis}_zone`] = zone;
            payload[`${basis}_grade`] = grade;
            return payload;
        }

        const holeFromSelectors = composeTolerance(holeZoneSelect?.value, holeGradeSelect?.value);
        const shaftFromSelectors = composeTolerance(shaftZoneSelect?.value, shaftGradeSelect?.value);

        if (mode === "common") {
            const combination = String(presetSelect?.value || fitInput.value || "").trim();
            if (!combination) {
                showValidation("Choose a common fit.");
                return null;
            }
            if (!combination.includes("/")) {
                showValidation("Common mode expects a hole-shaft fit like H7/g6.");
                return null;
            }
            payload.fit_combination = combination;
            return payload;
        }

        if (holeFromSelectors && shaftFromSelectors) {
            payload.mode = "fit";
            payload.hole_tolerance = holeFromSelectors;
            payload.shaft_tolerance = shaftFromSelectors;
            return payload;
        }

        if (holeFromSelectors) {
            payload.mode = "hole";
            payload.hole_tolerance = holeFromSelectors;
            return payload;
        }

        if (shaftFromSelectors) {
            payload.mode = "shaft";
            payload.shaft_tolerance = shaftFromSelectors;
            return payload;
        }

        showValidation("Choose hole basis and/or shaft basis.");
        return null;
    }

    function isFitMode(data) {
        return data && data.mode === "fit" || (data && data.fit && data.hole && data.shaft);
    }

    function setMode(mode) {
        const isCommon = mode === "common";
        const isCustom = mode === "custom";
        const isSingle = mode === "single";

        presetGroup.hidden = !isCommon;
        customGroup.hidden = true;
        customBasisGroup.hidden = !isCustom;
        singleGroup.hidden = !isSingle;

        fitModeGroup.querySelectorAll("label").forEach((l) => l.classList.remove("active"));
        const active = fitModeGroup.querySelector(`input[value="${mode}"]`);
        active?.closest("label")?.classList.add("active");
        if (isCustom) {
            fitInput.value = "";
        } else if (isCommon) {
            fitInput.value = presetSelect.value || "H7/g6";
        } else if (isSingle) {
            const basis = getSingleBasis();
            fitInput.value = basis === "hole" ? "H7" : "h6";
        }
    }

    function getSingleBasis() {
        const checked = [...singleBasisInputs].find((input) => input.checked)?.value;
        return checked === "shaft" ? "shaft" : "hole";
    }

    function clearCards() {
        summaryType.textContent = "Ready";
        summaryCombo.textContent = "H7/g6";
        summaryClearance.innerHTML = "0 &ndash; 0 &micro;m";
        summaryInterference.innerHTML = "0 &micro;m";
        boreBody.innerHTML = "";
        shaftBody.innerHTML = "";
        clearCardLabels();
    }

    function clearCardLabels() {
        boreBody.innerHTML = '<div class="tol-detail-row"><span>Not selected</span><strong>Ready</strong></div>';
        shaftBody.innerHTML = '<div class="tol-detail-row"><span>Not selected</span><strong>Ready</strong></div>';
        boreCode.textContent = "\u2014";
        shaftCode.textContent = "\u2014";
    }

    function renderAll(data) {
        if (!data) {
            return;
        }
        if (isFitMode(data)) {
            renderFit(data);
            return;
        }
        renderSingle(data);
    }

    function renderFit(data) {
        const h = data.hole;
        const s = data.shaft;
        const f = data.fit;

        summaryType.textContent = f.label;
        summaryCombo.textContent = data.fit_combination;
        summaryClearance.innerHTML = f.min_clearance_um != null
            ? `${f.min_clearance_um} &ndash; ${f.max_clearance_um} &micro;m`
            : `${f.max_clearance_um} &micro;m`;
        summaryInterference.innerHTML = f.max_interference_um > 0
            ? `${f.max_interference_um} &micro;m`
            : `0 &micro;m`;

        fitmapSvg.innerHTML = masterFitMap(data);

        boreCode.textContent = h.tolerance;
        boreCode.style.color = "#0066cc";
        boreBody.innerHTML = detailRows(h, true);

        shaftCode.textContent = s.tolerance;
        shaftCode.style.color = "#dc5c26";
        shaftBody.innerHTML = detailRows(s, false);
    }

    function renderSingle(data) {
        const singleMode = data.mode === "shaft" ? "shaft" : "hole";
        const part = singleMode === "shaft" ? data.shaft : data.hole;

        if (!part) {
            clearCards();
            return;
        }

        summaryType.textContent = singleMode === "shaft" ? "Single Shaft Zone" : "Single Bore Zone";
        summaryCombo.textContent = part.tolerance;
        summaryClearance.innerHTML = "&mdash;";
        summaryInterference.innerHTML = "&mdash;";

        drawSingleFitMap(part, singleMode);
        clearCardLabels();

        if (singleMode === "shaft") {
            shaftCode.textContent = part.tolerance;
            shaftCode.style.color = "#dc5c26";
            shaftBody.innerHTML = detailRows(part, false);
            boreCode.textContent = "\u2014";
            boreBody.textContent = "";
        } else {
            boreCode.textContent = part.tolerance;
            boreCode.style.color = "#0066cc";
            boreBody.innerHTML = detailRows(part, true);
            shaftCode.textContent = "\u2014";
            shaftBody.textContent = "";
        }
    }

    function drawPlaceholderFitmap() {
        fitmapSvg.innerHTML = `<svg viewBox="0 0 600 240" class="tol-fitmap-main">
            <line x1="80" y1="120" x2="580" y2="120" stroke="#cbd5e1" stroke-width="1.5"/>
            <text x="586" y="124" fill="#94a3b8" font-size="11" font-weight="600">0</text>
            <text x="586" y="112" fill="#94a3b8" font-size="9">Basic size</text>
            <rect x="185" y="116" width="230" height="4" rx="2" fill="#e2e8f0" opacity="0.6"/>
            <text x="300" y="150" text-anchor="middle" fill="#94a3b8" font-size="11">Choose a fit mode and calculate</text>
        </svg>`;
    }

    function drawSingleFitMap(part, modeLabel) {
        const W = 600, H = 240;
        const left = 80, right = 580, top = 35, bottom = 220;
        const mid = (top + bottom) / 2;
        const span = Math.max(Math.abs(part.upper_deviation_um - part.lower_deviation_um), 20);
        const min = part.lower_deviation_um - 8;
        const max = part.upper_deviation_um + 8;
        const loY = mapY(part.lower_deviation_um, min, max, top, bottom);
        const upY = mapY(part.upper_deviation_um, min, max, top, bottom);
        const color = modeLabel === "shaft" ? "#dc5c26" : "#0066cc";

        fitmapSvg.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="tol-fitmap-main">
            <line x1="${left}" y1="${mid}" x2="${right}" y2="${mid}" stroke="#cbd5e1" stroke-width="1.5"/>
            <text x="${right + 2}" y="${mid + 4}" fill="#64748b" font-size="11">0</text>
            <rect x="${left}" y="${Math.min(loY, upY)}" width="${right - left}" height="${Math.abs(upY - loY) || 4}" fill="${color}" opacity="0.18"/>
            <text x="${(left + right) / 2}" y="${Math.min(loY, upY) - 6}" text-anchor="middle" fill="${color}" font-size="11" font-weight="700">
                ${modeLabel === "shaft" ? "Shaft" : "Bore"} ${esc(part.tolerance)}
            </text>
            <text x="${left - 8}" y="${loY + 4}" text-anchor="end" fill="${color}" font-size="10">${devLabel(part.lower_deviation_um)}</text>
            <text x="${left - 8}" y="${upY + 4}" text-anchor="end" fill="${color}" font-size="10">${devLabel(part.upper_deviation_um)}</text>
            <text x="${W / 2}" y="${H - 10}" text-anchor="middle" fill="#64748b" font-size="10">
                Single tolerance
            </text>
        </svg>`;
    }

    function drawLoadingFitmap() {
        fitmapSvg.innerHTML = `<svg viewBox="0 0 600 240" class="tol-fitmap-main">
            <line x1="80" y1="120" x2="580" y2="120" stroke="#e2e8f0" stroke-width="1.5"/>
            <text x="586" y="124" fill="#94a3b8" font-size="11" font-weight="600">0</text>
            <rect class="tz-pulse" x="285" y="116" width="30" height="4" rx="2" fill="#cbd5e1"/>
        </svg>`;
    }

    function masterFitMap(data) {
        const h = data.hole, s = data.shaft, f = data.fit;
        const allVals = [h.lower_deviation_um, h.upper_deviation_um, s.lower_deviation_um, s.upper_deviation_um, 0];
        const dMin = Math.min(...allVals), dMax = Math.max(...allVals);
        const span = dMax - dMin || 20;
        const pad = Math.max(span * 0.4, 20);
        const rMin = dMin - pad, rMax = dMax + pad;

        const W = 600, H = 300;
        const left = 80, right = W - 20, topPad = 30, botPad = 30;
        const chartH = H - topPad - botPad;

        function y(v) { return topPad + ((rMax - v) / (rMax - rMin)) * chartH; }

        const y0 = y(0);
        const boreLo = y(h.lower_deviation_um), boreHi = y(h.upper_deviation_um);
        const boreTop = Math.min(boreLo, boreHi), boreHgt = Math.max(Math.abs(boreHi - boreLo), 4);
        const shaftLo = y(s.lower_deviation_um), shaftHi = y(s.upper_deviation_um);
        const shaftTop = Math.min(shaftLo, shaftHi), shaftHgt = Math.max(Math.abs(shaftHi - shaftLo), 4);

        const bandW = 220, bandX = (W - bandW) / 2;

        let gridHtml = "";
        const sStep = niceStep(rMin, rMax, 5);
        for (const v of sStep) {
            const yv = y(v);
            gridHtml += `<line x1="${left}" y1="${yv}" x2="${right}" y2="${yv}" stroke="#e2e8f0" stroke-width="0.5"/>`;
            gridHtml += `<text x="${left - 6}" y="${yv + 4}" text-anchor="end" fill="#64748b" font-size="10" font-family="SF Mono, JetBrains Mono, Consolas, monospace">${v > 0 ? "+" + v : v}</text>`;
        }

        let shadeHtml = "";
        if (f.type === "clearance") {
            shadeHtml = `<rect x="${bandX}" y="${Math.min(boreTop + boreHgt, shaftTop)}" width="${bandW}" height="${Math.abs(shaftTop - (boreTop + boreHgt))}" fill="#22c55e" opacity="0.18" rx="2"/>`;
        } else if (f.type === "interference") {
            shadeHtml = `<rect x="${bandX}" y="${boreTop}" width="${bandW}" height="${shaftTop + shaftHgt - boreTop}" fill="#ef4444" opacity="0.16" rx="2"/>`;
        } else {
            if (shaftTop > boreTop + boreHgt) {
                shadeHtml = `<rect x="${bandX}" y="${boreTop + boreHgt}" width="${bandW}" height="${shaftTop - (boreTop + boreHgt)}" fill="#22c55e" opacity="0.12" rx="2"/>`;
            }
            if (shaftTop + shaftHgt > boreTop) {
                shadeHtml += `<rect x="${bandX}" y="${shaftTop + shaftHgt}" width="${bandW}" height="${boreTop - (shaftTop + shaftHgt)}" fill="#ef4444" opacity="0.12" rx="2"/>`;
            }
        }

        return `<svg viewBox="0 0 ${W} ${H}" class="tol-fitmap-main" xmlns="http://www.w3.org/2000/svg">
            ${gridHtml}
            <line x1="${left}" y1="${y0}" x2="${right}" y2="${y0}" stroke="#0f172a" stroke-width="1.5"/>
            <text x="${right + 4}" y="${y0 + 4}" fill="#0f172a" font-size="11" font-weight="700">0</text>
            <text x="${right + 4}" y="${y0 - 8}" fill="#64748b" font-size="9">Basic size</text>
            ${shadeHtml}
            <rect x="${bandX}" y="${boreTop}" width="${bandW}" height="${boreHgt}" rx="4" fill="#0066cc" opacity="0.82"/>
            <text x="${bandX + bandW / 2}" y="${boreTop - 6}" text-anchor="middle" fill="#0066cc" font-size="11" font-weight="700">Bore ${esc(data.hole.tolerance)}</text>
            <text x="${bandX - 6}" y="${boreTop + boreHgt / 2 + 4}" text-anchor="end" fill="#0066cc" font-size="9">${devLabel(h.upper_deviation_um)}</text>
            <text x="${bandX - 6}" y="${boreTop + boreHgt - 4}" text-anchor="end" fill="#0066cc" font-size="9">${devLabel(h.lower_deviation_um)}</text>
            <rect x="${bandX}" y="${shaftTop}" width="${bandW}" height="${shaftHgt}" rx="4" fill="#dc5c26" opacity="0.78"/>
            <text x="${bandX + bandW / 2}" y="${shaftTop + shaftHgt + 14}" text-anchor="middle" fill="#dc5c26" font-size="11" font-weight="700">Shaft ${esc(data.shaft.tolerance)}</text>
            <text x="${bandX - 6}" y="${shaftTop + shaftHgt / 2 + 4}" text-anchor="end" fill="#dc5c26" font-size="9">${devLabel(s.upper_deviation_um)}</text>
            <text x="${bandX - 6}" y="${shaftTop + shaftHgt - 4}" text-anchor="end" fill="#dc5c26" font-size="9">${devLabel(s.lower_deviation_um)}</text>
            <text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#334155" font-size="10" font-weight="600">
                ${fitRangeLabel(f)}
            </text>
        </svg>`;
    }

    function fitRangeLabel(f) {
        if (f.type === "clearance") return `Clearance range: ${f.min_clearance_um ?? f.max_clearance_um} \u2013 ${f.max_clearance_um} \u00b5m`;
        if (f.type === "interference") return `Interference: ${f.max_interference_um} \u00b5m`;
        return `Clearance ${f.max_clearance_um} \u00b5m / Interference ${f.max_interference_um} \u00b5m`;
    }

    function detailRows(part, isBore) {
        const es = isBore ? "ES" : "es";
        const ei = isBore ? "EI" : "ei";
        return `
            <div class="tol-detail-row"><span>${es} (Upper)</span><strong>${devLabel(part.upper_deviation_um)} &micro;m</strong></div>
            <div class="tol-detail-row"><span>${ei} (Lower)</span><strong>${devLabel(part.lower_deviation_um)} &micro;m</strong></div>
            <div class="tol-detail-row"><span>Max size</span><strong>${fm(part.max_size_mm)} mm</strong></div>
            <div class="tol-detail-row"><span>Min size</span><strong>${fm(part.min_size_mm)} mm</strong></div>
            <div class="tol-detail-row"><span>IT grade</span><strong>${esc(part.grade)}</strong></div>
            <div class="tol-detail-row"><span>Tolerance width</span><strong>${part.it_um} &micro;m</strong></div>
        `;
    }

    function showValidation(msg) {
        validation.textContent = msg;
        validation.hidden = false;
    }

    function setState(s) { result.dataset.state = s; }

    function mapY(v, min, max, top, bottom) {
        if (max === min) return (top + bottom) / 2;
        return top + ((max - v) / (max - min)) * (bottom - top);
    }

    function composeTolerance(zone, grade) {
        const z = String(zone || "").trim();
        const g = String(grade || "").trim();
        return z && g ? `${z}${g}` : "";
    }

    function devLabel(v) { return v > 0 ? `+${v}` : `${v}`; }
    function fm(v) { return Number(v).toFixed(3); }
    function esc(v) { return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

    function niceStep(min, max, count) {
        const rough = (max - min) / count;
        const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-12))));
        const r = rough / mag;
        const step = r <= 1.5 ? mag : r <= 3.5 ? 2 * mag : r <= 7.5 ? 5 * mag : 10 * mag;
        const s = Math.max(step, 1);
        const steps = [];
        const start = Math.ceil(min / s) * s;
        for (let v = start; v <= max + s * 0.5; v += s) steps.push(v);
        return steps;
    }

    async function hydratePresets() {
        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/presets");
            const presets = data.presets;
            if (!presets) return;
            const datalist = document.querySelector("#fit-presets");
            const seenCodes = new Set();
            if (!Array.isArray(presets)) {
                const groupedSource = presets.hole_basis || presets;
                const groups = {
                    clearance: [],
                    transition: [],
                    interference: [],
                    legacy: [],
                };
                const addItem = (bucket, item, includeInSelect) => {
                    const code = typeof item === "string" ? item : item.code;
                    if (!code) return;
                    if (datalist && !seenCodes.has(code)) {
                        datalist.innerHTML += `<option value="${esc(code)}"></option>`;
                        seenCodes.add(code);
                    }
                    if (includeInSelect) {
                        const label = typeof item === "string" ? code : `${code}: ${item.label || ""}`.trim();
                        groups[bucket].push({ code, label, preferred: item?.preferred !== false });
                    }
                };
                const processGroup = (source, bucket) => {
                    const list = source?.[bucket] || [];
                    for (const item of list) addItem(bucket, item, true);
                };
                processGroup(groupedSource, "clearance");
                processGroup(groupedSource, "transition");
                processGroup(groupedSource, "interference");
                if (Array.isArray(presets.legacy)) {
                    presets.legacy.forEach((item) => addItem("legacy", item, true));
                }
                if (presetSelect) {
                    presetSelect.innerHTML = "";
                    const orderedBuckets = ["clearance", "transition", "interference", "legacy"];
                    const groupTitles = {
                        clearance: "Clearance",
                        transition: "Transition",
                        interference: "Interference",
                        legacy: "Legacy",
                    };
                    const seen = new Set();
                    for (const bucket of orderedBuckets) {
                        const items = (groups[bucket] || []).filter((it) => it.preferred !== false);
                        if (items.length === 0) continue;
                        const optgroup = document.createElement("optgroup");
                        optgroup.label = groupTitles[bucket];
                        for (const item of items) {
                            if (seen.has(item.code)) continue;
                            seen.add(item.code);
                            const option = document.createElement("option");
                            option.value = item.code;
                            option.textContent = item.label || item.code;
                            optgroup.appendChild(option);
                        }
                        presetSelect.appendChild(optgroup);
                    }
                    if (!presetSelect.value && presetSelect.options.length > 0) {
                        presetSelect.value = presetSelect.options[0].value;
                    }
                    if (presetSelect.value) fitInput.value = presetSelect.value;
                }
            } else {
                if (datalist) datalist.innerHTML = presets.map((p) => `<option value="${esc(p)}"></option>`).join("");
                if (presetSelect) {
                    presetSelect.innerHTML = presets.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
                    if (presetSelect.value) fitInput.value = presetSelect.value;
                }
            }
        } catch (e) {
            // silently fail
        }
    }

    async function hydrateCapabilities() {
        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/capabilities");
            const holes = data.hole?.zones || [];
            const shafts = data.shaft?.zones || [];
            const rawGrades = data.grades || [];
            const grades = extractGrades(rawGrades, 5, 12);

            fillSelect(holeZoneSelect, holes);
            fillSelect(shaftZoneSelect, shafts);
            fillSelect(holeGradeSelect, grades);
            fillSelect(shaftGradeSelect, grades);
            fillSelect(singleZoneSelect, [...holes, ...shafts]);
            fillSelect(singleGradeSelect, grades);
            syncSingleSelectors();
        } catch (e) {
            if (holeZoneSelect && holeZoneSelect.children.length === 0) {
                holeZoneSelect.innerHTML = '<option value="H">H</option><option value="JS">JS</option><option value="K">K</option><option value="N">N</option><option value="P">P</option>';
                shaftZoneSelect.innerHTML = '<option value="h">h</option><option value="js">js</option><option value="f">f</option><option value="g">g</option><option value="k">k</option><option value="n">n</option><option value="p">p</option>';
                singleZoneSelect.innerHTML = '<option value="H">H</option><option value="h">h</option>';
            }
            if (singleGradeSelect && singleGradeSelect.children.length === 0) {
                fillSelect(singleGradeSelect, ["5", "6", "7", "8", "9", "10", "11", "12"]);
            }
            if (holeGradeSelect && holeGradeSelect.children.length === 0) {
                fillSelect(holeGradeSelect, ["5", "6", "7", "8", "9", "10", "11", "12"]);
                fillSelect(shaftGradeSelect, ["5", "6", "7", "8", "9", "10", "11", "12"]);
            }
            syncSingleSelectors();
        }
    }

    function extractGrades(items, minGrade, maxGrade) {
        const set = new Set();
        for (const item of items) {
            const match = String(item).match(/^IT(\d+)$/i);
            if (!match) continue;
            const grade = Number(match[1]);
            if (!Number.isInteger(grade)) continue;
            if (grade >= minGrade && grade <= maxGrade) set.add(String(grade));
        }
        return [...set].sort((a, b) => Number(a) - Number(b));
    }

    function fillSelect(select, values) {
        if (!select) return;
        select.innerHTML = "";
        for (const value of values) {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = String(value);
            select.appendChild(option);
        }
        if (select.children.length > 0) select.value = select.children[0].value;
    }

    async function initControls() {
        await hydrateCapabilities();
        await hydratePresets();
        setMode("common");
    }

    function syncSingleSelectors() {
        const basis = getSingleBasis();
        if (!singleZoneSelect || !holeZoneSelect || !shaftZoneSelect) return;
        if (basis === "shaft") {
            const shaftZone = shaftZoneSelect.value || shaftZoneSelect.options[0]?.value || "";
            const shaftGrade = shaftGradeSelect.value || shaftGradeSelect.options[0]?.value || "";
            if (shaftZone) singleZoneSelect.value = shaftZone;
            if (shaftGrade) singleGradeSelect.value = shaftGrade;
        } else {
            const holeZone = holeZoneSelect.value || holeZoneSelect.options[0]?.value || "";
            const holeGrade = holeGradeSelect.value || holeGradeSelect.options[0]?.value || "";
            if (holeZone) singleZoneSelect.value = holeZone;
            if (holeGrade) singleGradeSelect.value = holeGrade;
        }
    }

    singleBasisGroup?.addEventListener("change", () => {
        syncSingleSelectors();
    });
});
