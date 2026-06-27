/* ISO Tolerance Calculator — instrument panel design */

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
    if (!form || !result || !fitInput) return;

    /* DOM refs */
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

    let currentResult = null;

    /* ── Placeholder fit map ── */
    drawPlaceholderFitmap();

    /* ── Presets ── */
    hydratePresets();

    /* ── Fit mode toggle ── */
    fitModeGroup.addEventListener("change", () => {
        const mode = fitModeGroup.querySelector("input:checked")?.value;
        fitModeGroup.querySelectorAll("label").forEach(l => l.classList.remove("active"));
        fitModeGroup.querySelector(`input[value="${mode}"]`)?.closest("label")?.classList.add("active");
        if (mode === "common") {
            customGroup.style.display = "none";
            presetGroup.style.display = "";
            if (presetSelect.value) fitInput.value = presetSelect.value;
        } else {
            customGroup.style.display = "";
            presetGroup.style.display = "none";
        }
    });
    /* Init: Common mode visible */
    customGroup.style.display = "none";
    presetGroup.style.display = "";

    presetSelect.addEventListener("change", () => {
        if (presetSelect.value) fitInput.value = presetSelect.value;
    });

    /* ── Auto-calc on preset click ── */
    presetSelect.addEventListener("change", () => {
        if (presetSelect.value && form.querySelector("input[name=fit_mode]:checked")?.value === "common") {
            autoCalc();
        }
    });

    /* ── Submit ── */
    form.addEventListener("submit", (e) => { e.preventDefault(); doCalc(); });

    /* ── Reset ── */
    $("[data-reset-btn]")?.addEventListener("click", () => {
        document.querySelector("#basic-size").value = "25";
        fitInput.value = "H7/g6";
        presetSelect.value = "";
        currentResult = null;
        resetAll();
        drawPlaceholderFitmap();
        setState("idle");
    });

    /* ── Copy ── */
    $("[data-copy-btn]")?.addEventListener("click", () => {
        if (!currentResult) return;
        const d = currentResult;
        const h = d.hole, s = d.shaft, f = d.fit;
        const clearanceText = f.min_clearance_um != null && f.max_clearance_um != null
            ? `clearance range = ${f.min_clearance_um}\u2013${f.max_clearance_um} \u00b5m`
            : "";
        const interferenceText = f.max_interference_um > 0
            ? `, max interference = ${f.max_interference_um} \u00b5m`
            : "";
        const text = `${d.basic_size_mm ?? h.min_size_mm} mm ${d.fit_combination}: ${f.label}. `
            + `Bore ${h.tolerance} = ${fm(h.min_size_mm)}\u2013${fm(h.max_size_mm)} mm, `
            + `shaft ${s.tolerance} = ${fm(s.min_size_mm)}\u2013${fm(s.max_size_mm)} mm, `
            + clearanceText + interferenceText + ".";
        navigator.clipboard.writeText(text).catch(() => {});
        /* Brief feedback */
        const btn = $("[data-copy-btn]");
        const orig = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });

    /* ── Auto calc ── */
    function autoCalc() {
        const size = Number(document.querySelector("#basic-size")?.value);
        if (!size || size < 1 || size > 3150) return;
        doCalc();
    }

    async function doCalc() {
        validation.hidden = true;
        const basicSize = Number(document.querySelector("#basic-size")?.value);
        const combo = String(fitInput.value || "").trim();

        /* Local validation */
        if (!basicSize || basicSize < 1 || basicSize > 3150) {
            showValidation("Basic size must be between 1 and 3150 mm.");
            return;
        }
        if (!combo) {
            showValidation("Enter a fit combination like H7/g6.");
            return;
        }
        if (!/^[A-Za-z]+\d+\/[A-Za-z]+\d+$/.test(combo)) {
            showValidation('Fit combination must look like "H7/g6".');
            return;
        }

        setState("loading");
        if (calcBtn) { calcBtn.disabled = true; calcBtn.textContent = "Calculating\u2026"; }
        drawLoadingFitmap();

        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/calculate", {
                method: "POST",
                body: JSON.stringify({ basic_size_mm: basicSize, fit_combination: combo }),
            });
            currentResult = data;
            renderAll(data);
            setState("result");
        } catch (error) {
            showValidation(error.message || "Calculation failed.");
            if (!currentResult) { resetAll(); drawPlaceholderFitmap(); }
            setState("error");
        } finally {
            if (calcBtn) { calcBtn.disabled = false; calcBtn.textContent = "Calculate"; }
        }
    }

    function showValidation(msg) {
        validation.textContent = msg;
        validation.hidden = false;
    }

    /* ── State ── */
    function setState(s) { result.dataset.state = s; }

    function resetAll() {
        summaryType.textContent = "Ready";
        summaryCombo.textContent = "H7/g6";
        summaryClearance.innerHTML = "0 – 0 µm";
        summaryInterference.innerHTML = "0 µm";
        boreBody.innerHTML = "";
        shaftBody.innerHTML = "";
        boreCode.textContent = "—";
        shaftCode.textContent = "—";
    }

    /* ── Render ── */
    function renderAll(data) {
        const h = data.hole, s = data.shaft, f = data.fit;

        /* Summary */
        summaryType.textContent = f.label;
        summaryCombo.textContent = data.fit_combination;
        summaryClearance.innerHTML = f.min_clearance_um != null
            ? `${f.min_clearance_um} – ${f.max_clearance_um} &micro;m`
            : `${f.max_clearance_um} &micro;m`;
        summaryInterference.innerHTML = f.max_interference_um > 0
            ? `${f.max_interference_um} &micro;m`
            : `0 &micro;m`;

        /* Master fit map */
        fitmapSvg.innerHTML = masterFitMap(data);

        /* Detail cards */
        boreCode.textContent = h.tolerance;
        boreCode.style.color = "#0066cc";
        boreBody.innerHTML = detailRows(h, "Bore", true);

        shaftCode.textContent = s.tolerance;
        shaftCode.style.color = "#dc5c26";
        shaftBody.innerHTML = detailRows(s, "Shaft", false);
    }

    /* ── Master Fit Map SVG ── */
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
        /* Bore band */
        const boreLo = y(h.lower_deviation_um), boreHi = y(h.upper_deviation_um);
        const boreTop = Math.min(boreLo, boreHi), boreHgt = Math.max(Math.abs(boreHi - boreLo), 4);
        /* Shaft band */
        const shaftLo = y(s.lower_deviation_um), shaftHi = y(s.upper_deviation_um);
        const shaftTop = Math.min(shaftLo, shaftHi), shaftHgt = Math.max(Math.abs(shaftHi - shaftLo), 4);

        const bandW = 220, bandX = (W - bandW) / 2;

        /* Grid */
        let gridHtml = "";
        const sStep = niceStep(rMin, rMax, 5);
        for (const v of sStep) {
            const yv = y(v);
            gridHtml += `<line x1="${left}" y1="${yv}" x2="${right}" y2="${yv}" stroke="#e2e8f0" stroke-width="0.5"/>`;
            gridHtml += `<text x="${left - 6}" y="${yv + 4}" text-anchor="end" fill="#64748b" font-size="10" font-family="SF Mono, JetBrains Mono, Consolas, monospace">${v > 0 ? "+"+v : v}</text>`;
        }

        /* Shading */
        let shadeHtml = "";
        if (f.type === "clearance") {
            shadeHtml = `<rect x="${bandX}" y="${Math.min(boreTop + boreHgt, shaftTop)}" width="${bandW}" height="${Math.abs(shaftTop - (boreTop + boreHgt))}" fill="#22c55e" opacity="0.18" rx="2"/>`;
        } else if (f.type === "interference") {
            const overlap = Math.abs(boreTop - shaftTop);
            shadeHtml = `<rect x="${bandX}" y="${boreTop}" width="${bandW}" height="${shaftTop + shaftHgt - boreTop}" fill="#ef4444" opacity="0.16" rx="2"/>`;
        } else {
            /* Transition: both clearance and interference possible */
            if (shaftTop > boreTop + boreHgt) {
                shadeHtml = `<rect x="${bandX}" y="${boreTop + boreHgt}" width="${bandW}" height="${shaftTop - (boreTop + boreHgt)}" fill="#22c55e" opacity="0.12" rx="2"/>`;
            }
            if (shaftTop + shaftHgt > boreTop) {
                shadeHtml += `<rect x="${bandX}" y="${shaftTop + shaftHgt}" width="${bandW}" height="${boreTop - (shaftTop + shaftHgt)}" fill="#ef4444" opacity="0.12" rx="2"/>`;
            }
        }

        return `<svg viewBox="0 0 ${W} ${H}" class="tol-fitmap-main" xmlns="http://www.w3.org/2000/svg">
            ${gridHtml}
            <!-- zero line -->
            <line x1="${left}" y1="${y0}" x2="${right}" y2="${y0}" stroke="#0f172a" stroke-width="1.5"/>
            <text x="${right + 4}" y="${y0 + 4}" fill="#0f172a" font-size="11" font-weight="700">0</text>
            <text x="${right + 4}" y="${y0 - 8}" fill="#64748b" font-size="9">Basic size</text>

            ${shadeHtml}

            <!-- Bore band -->
            <rect x="${bandX}" y="${boreTop}" width="${bandW}" height="${boreHgt}" rx="4" fill="#0066cc" opacity="0.82"/>
            <text x="${bandX + bandW / 2}" y="${boreTop - 6}" text-anchor="middle" fill="#0066cc" font-size="11" font-weight="700">Bore ${esc(data.hole.tolerance)}</text>
            <text x="${bandX - 6}" y="${boreTop + boreHgt / 2 + 4}" text-anchor="end" fill="#0066cc" font-size="9">${devLabel(h.upper_deviation_um)}</text>
            <text x="${bandX - 6}" y="${boreTop + boreHgt - 4}" text-anchor="end" fill="#0066cc" font-size="9">${devLabel(h.lower_deviation_um)}</text>

            <!-- Shaft band -->
            <rect x="${bandX}" y="${shaftTop}" width="${bandW}" height="${shaftHgt}" rx="4" fill="#dc5c26" opacity="0.78"/>
            <text x="${bandX + bandW / 2}" y="${shaftTop + shaftHgt + 14}" text-anchor="middle" fill="#dc5c26" font-size="11" font-weight="700">Shaft ${esc(data.shaft.tolerance)}</text>
            <text x="${bandX - 6}" y="${shaftTop + shaftHgt / 2 + 4}" text-anchor="end" fill="#dc5c26" font-size="9">${devLabel(s.upper_deviation_um)}</text>
            <text x="${bandX - 6}" y="${shaftTop + shaftHgt - 4}" text-anchor="end" fill="#dc5c26" font-size="9">${devLabel(s.lower_deviation_um)}</text>

            <!-- Fit range label -->
            <text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#334155" font-size="10" font-weight="600">
                ${fitRangeLabel(f)}
            </text>
        </svg>`;
    }

    /* ── Fit range label ── */
    function fitRangeLabel(f) {
        if (f.type === "clearance") return `Clearance range: ${f.min_clearance_um ?? f.max_clearance_um} \u2013 ${f.max_clearance_um} \u00b5m`;
        if (f.type === "interference") return `Interference: ${f.max_interference_um} \u00b5m`;
        return `Clearance ${f.max_clearance_um} \u00b5m / Interference ${f.max_interference_um} \u00b5m`;
    }

    /* ── Detail row builder ── */
    function detailRows(part, label, isBore) {
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

    /* ── Placeholder / Loading fitmap ── */
    function drawPlaceholderFitmap() {
        fitmapSvg.innerHTML = `<svg viewBox="0 0 600 240" class="tol-fitmap-main">
            <line x1="80" y1="120" x2="580" y2="120" stroke="#cbd5e1" stroke-width="1.5"/>
            <text x="586" y="124" fill="#94a3b8" font-size="11" font-weight="600">0</text>
            <text x="586" y="112" fill="#94a3b8" font-size="9">Basic size</text>
            <rect x="185" y="116" width="230" height="4" rx="2" fill="#e2e8f0" opacity="0.6"/>
            <text x="300" y="150" text-anchor="middle" fill="#94a3b8" font-size="11">Enter basic size and fit combination above</text>
        </svg>`;
    }

    function drawLoadingFitmap() {
        fitmapSvg.innerHTML = `<svg viewBox="0 0 600 240" class="tol-fitmap-main">
            <line x1="80" y1="120" x2="580" y2="120" stroke="#e2e8f0" stroke-width="1.5"/>
            <text x="586" y="124" fill="#94a3b8" font-size="11" font-weight="600">0</text>
            <rect class="tz-pulse" x="285" y="116" width="30" height="4" rx="2" fill="#cbd5e1"/>
        </svg>`;
    }

    /* ── Helpers ── */
    function niceStep(min, max, count) {
        const rough = (max - min) / count;
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        const r = rough / mag;
        const step = r <= 1.5 ? mag : r <= 3.5 ? 2 * mag : r <= 7.5 ? 5 * mag : 10 * mag;
        const s = Math.max(step, 1);
        const steps = [];
        for (let v = Math.ceil(min / s) * s; v <= max + s * 0.5; v += s) steps.push(v);
        return steps;
    }

    function devLabel(v) { return v > 0 ? `+${v}` : `${v}`; }
    function fm(v) { return Number(v).toFixed(3); }
    function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

    /* ── Hydrate presets ── */
    async function hydratePresets() {
        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/presets");
            const presets = data.presets;
            if (!presets) return;

            const datalist = document.querySelector("#fit-presets");
            const allCodes = [];

            // Support both old flat array and new grouped format
            if (Array.isArray(presets)) {
                allCodes.push(...presets);
                if (datalist) datalist.innerHTML = presets.map(p => `<option value="${esc(p)}"></option>`).join("");
                if (presetSelect) {
                    presetSelect.innerHTML = presets.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
                }
            } else {
                // Grouped: { clearance: [...], transition: [...], interference: [...] }
                if (datalist) {
                    datalist.innerHTML = '';
                    for (const [group, items] of Object.entries(presets)) {
                        for (const item of items) {
                            const code = typeof item === 'string' ? item : item.code;
                            datalist.innerHTML += `<option value="${esc(code)}">${esc(code)}</option>`;
                            allCodes.push(code);
                        }
                    }
                }
                if (presetSelect) {
                    presetSelect.innerHTML = '';
                    for (const [group, items] of Object.entries(presets)) {
                        const groupLabel = { clearance: 'Clearance', transition: 'Transition', interference: 'Interference' }[group] || group;
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = groupLabel;
                        for (const item of items) {
                            const code = typeof item === 'string' ? item : item.code;
                            const label = typeof item === 'string' ? code : `${code} — ${item.label}`;
                            const option = document.createElement('option');
                            option.value = code;
                            option.textContent = label;
                            if (item.preferred !== false) optgroup.appendChild(option);
                            else { /* keep non-preferred in datalist but not select */ }
                        }
                        if (optgroup.children.length > 0) presetSelect.appendChild(optgroup);
                    }
                }
            }
        } catch (e) { /* silently fail */ }
    }
});
