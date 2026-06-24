document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-tolerance-form]");
    const result = document.querySelector("[data-tolerance-result]");
    const presetSelect = document.querySelector("#preset");
    const fitInput = document.querySelector("#fit-combination");
    const presetList = document.querySelector("#fit-presets");
    const summary = document.querySelector("[data-tolerance-summary]");
    if (!form || !result || !fitInput) return;

    /* ── DOM refs ── */
    const $ = (s) => document.querySelector(s);
    const shaftCode = $("[data-shaft-code]"), boreCode = $("[data-bore-code]"), fitCode = $("[data-fit-code]");
    const shaftSvg = $("[data-shaft-svg]"), boreSvg = $("[data-bore-svg]"), fitSvgWrap = $("[data-fit-svg]");
    const shaftData = $("[data-shaft-data]"), boreData = $("[data-bore-data]"), fitDataEl = $("[data-fit-data]");
    const fitDot = $("[data-fit-dot]"), fitLabel = $("[data-fit-label]");
    const clearanceEl = $("[data-clearance]"), interferenceEl = $("[data-interference]"), sizeRangeEl = $("[data-size-range]");

    hydratePresets();
    if (presetSelect) presetSelect.addEventListener("change", () => { if (presetSelect.value) fitInput.value = presetSelect.value; });

    /* ── Placeholder SVGs ── */
    drawPlaceholders();

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const payload = {
            basic_size_mm: Number(formData.get("basic_size")),
            fit_combination: String(formData.get("fit_combination") || "").trim(),
        };

        setState("loading");
        clearAll();

        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/calculate", {
                method: "POST", body: JSON.stringify(payload),
            });
            renderResult(data);
            setState("result");
        } catch (error) {
            setState("error");
            summary.hidden = true;
            shaftData.innerHTML = `<div class="tz-data-error">${esc(error.message)}</div>`;
            boreData.innerHTML = "";
            fitDataEl.innerHTML = "";
        }
    });

    /* ── State ── */
    function setState(s) { result.dataset.state = s; }
    function clearAll() {
        shaftCode.textContent = "\u2014"; boreCode.textContent = "\u2014"; fitCode.textContent = "\u2014";
        shaftData.innerHTML = ""; boreData.innerHTML = ""; fitDataEl.innerHTML = "";
        summary.hidden = true;
        drawPulse(shaftSvg); drawPulse(boreSvg); drawPulse(fitSvgWrap);
    }

    /* ── Placeholder / Pulse SVG ── */
    function drawPlaceholders() {
        [shaftSvg, boreSvg, fitSvgWrap].forEach(el => {
            el.innerHTML = `<svg viewBox="0 0 160 200" class="tz-svg">
                <line x1="18" y1="100" x2="146" y2="100" stroke="#cbd5e1" stroke-width="1"/>
                <text x="8" y="104" fill="#94a3b8" font-size="10" font-weight="600">0</text>
                <text x="80" y="120" text-anchor="middle" fill="#94a3b8" font-size="12" font-family="system-ui, -apple-system, sans-serif">Enter values above</text>
            </svg>`;
        });
    }

    function drawPulse(el) {
        el.innerHTML = `<svg viewBox="0 0 160 200" class="tz-svg">
            <line x1="18" y1="100" x2="146" y2="100" stroke="#e2e8f0" stroke-width="1"/>
            <text x="8" y="104" fill="#94a3b8" font-size="10" font-weight="600">0</text>
            <rect class="tz-pulse" x="30" y="94" width="100" height="6" rx="3" fill="#e2e8f0" opacity="0.6"/>
        </svg>`;
        /* pulse animation via CSS */
    }

    /* ── Coordinate system ── */
    function coord(data) {
        const h = data.hole, s = data.shaft;
        const all = [h.lower_deviation_um, h.upper_deviation_um, s.lower_deviation_um, s.upper_deviation_um, 0];
        const dMin = Math.min(...all), dMax = Math.max(...all);
        const span = dMax - dMin || 20;
        const pad = Math.max(span * 0.35, 16);
        return { rMin: dMin - pad, rMax: dMax + pad };
    }

    function y(val, c) {
        const rng = c.rMax - c.rMin;
        const H = 160, pad = 24;
        return pad + ((c.rMax - val) / rng) * (H - 2 * pad);
    }

    /* ── Render ── */
    function renderResult(data) {
        const c = coord(data);
        const h = data.hole, s = data.shaft, f = data.fit;
        const y0 = y(0, c);
        const steps = niceSteps(c.rMin, c.rMax);

        /* Shaft */
        shaftCode.textContent = s.tolerance;
        shaftCode.style.color = "#dc5c26";
        shaftSvg.innerHTML = singleBarSvg("Shaft", s.tolerance, s.lower_deviation_um, s.upper_deviation_um, s.grade, "#dc5c26", c, y0, steps);
        shaftData.innerHTML = dataRows(s, s.grade);

        /* Bore */
        boreCode.textContent = h.tolerance;
        boreCode.style.color = "#0066cc";
        boreSvg.innerHTML = singleBarSvg("Bore", h.tolerance, h.lower_deviation_um, h.upper_deviation_um, h.grade, "#0066cc", c, y0, steps);
        boreData.innerHTML = dataRows(h, h.grade);

        /* Fit */
        fitCode.textContent = f.type;
        fitCode.style.color = f.type === "clearance" ? "#0d8c4a" : f.type === "interference" ? "#dc2626" : "#c9780c";
        fitSvgWrap.innerHTML = fitSvg(data, c, y0, steps);
        fitDataEl.innerHTML = `
            <div class="tz-data-row"><span>Max Clearance</span><strong>${f.max_clearance_um} μm</strong></div>
            <div class="tz-data-row"><span>Max Interference</span><strong>${f.max_interference_um} μm</strong></div>`;

        /* Summary */
        summary.hidden = false;
        summary.className = `tolerance-summary fit-${esc(f.type)}`;
        fitDot.className = `fit-dot fit-dot-${esc(f.type)}`;
        fitLabel.textContent = `${esc(f.label)} \u2014 ${esc(data.fit_combination)}`;
        clearanceEl.textContent = `${f.max_clearance_um} μm`;
        interferenceEl.textContent = `${f.max_interference_um} μm`;
        sizeRangeEl.textContent = `${esc(data.size_range)} mm`;

        /* Animate bars */
        requestAnimationFrame(() => {
            document.querySelectorAll(".tz-bar-anim").forEach(el => {
                const lo = parseFloat(el.dataset.lo);
                const hi = parseFloat(el.dataset.hi);
                const top = Math.min(lo, hi);
                const hgt = Math.abs(hi - lo);
                el.setAttribute("y", lo); // start at one end
                el.setAttribute("height", "0");
                requestAnimationFrame(() => {
                    el.style.transition = "y 0.5s cubic-bezier(0.22, 1, 0.36, 1), height 0.5s cubic-bezier(0.22, 1, 0.36, 1)";
                    el.setAttribute("y", top);
                    el.setAttribute("height", Math.max(hgt, 2));
                });
            });
        });
    }

    /* ── Single tolerance bar (Shaft / Bore) ── */
    function singleBarSvg(label, code, lo, hi, grade, color, c, y0, steps) {
        const yLo = y(lo, c), yHi = y(hi, c);
        const barTop = Math.min(yLo, yHi);
        const barH = Math.abs(yHi - yLo);
        const barW = 56, barX = (160 - barW) / 2;

        /* Label the bar */
        const labelY = barTop - 6;
        const loLabel = lo > 0 ? `+${lo}` : `${lo}`;
        const hiLabel = hi > 0 ? `+${hi}` : `${hi}`;

        return `<svg viewBox="0 0 160 200" class="tz-svg">
            ${gridLines(c, y0, steps, 160)}
            <line x1="0" y1="${y0}" x2="160" y2="${y0}" stroke="#0f172a" stroke-width="1.2"/>
            <text x="4" y="${y0 - 5}" fill="#0f172a" font-size="10" font-weight="700">0</text>
            <rect class="tz-bar-anim" x="${barX}" y="${yLo}" width="${barW}" height="0" rx="4"
                fill="${color}" opacity="0.85" data-lo="${yLo}" data-hi="${yHi}"/>
            <text x="${barX + barW / 2}" y="${labelY}" text-anchor="middle" fill="${color}" font-size="9" font-weight="700">${loLabel} / ${hiLabel}</text>
        </svg>`;
    }

    /* ── Fit overlay SVG ── */
    function fitSvg(data, c, y0, steps) {
        const h = data.hole, s = data.shaft, f = data.fit;
        const hLo = y(h.lower_deviation_um, c), hHi = y(h.upper_deviation_um, c);
        const sLo = y(s.lower_deviation_um, c), sHi = y(s.upper_deviation_um, c);
        const holeTop = Math.min(hLo, hHi), holeBot = Math.max(hLo, hHi);
        const shaftTop = Math.min(sLo, sHi), shaftBot = Math.max(sLo, sHi);
        const barW = 32, hX = 28, sX = 100;

        /* Clearance / interference shading */
        let shade = "";
        if (f.type === "clearance" && holeBot < shaftTop) {
            shade = `<rect x="4" y="${holeBot}" width="152" height="${shaftTop - holeBot}" fill="#22c55e" opacity="0.12" rx="2"/>`;
        } else if (f.type === "interference" && shaftBot < holeTop) {
            shade = `<rect x="4" y="${shaftBot}" width="152" height="${holeTop - shaftBot}" fill="#ef4444" opacity="0.14" rx="2"/>`;
        }

        return `<svg viewBox="0 0 160 200" class="tz-svg">
            ${gridLines(c, y0, steps, 160)}
            <line x1="0" y1="${y0}" x2="160" y2="${y0}" stroke="#0f172a" stroke-width="1.2"/>
            <text x="4" y="${y0 - 5}" fill="#0f172a" font-size="10" font-weight="700">0</text>
            ${shade}
            <rect class="tz-bar-anim" x="${hX}" y="${hLo}" width="${barW}" height="0" rx="4"
                fill="#0066cc" opacity="0.8" data-lo="${hLo}" data-hi="${hHi}"/>
            <text x="${hX + barW / 2}" y="${holeTop - 5}" text-anchor="middle" fill="#0066cc" font-size="9" font-weight="700">${esc(h.tolerance)}</text>
            <rect class="tz-bar-anim" x="${sX}" y="${sLo}" width="${barW}" height="0" rx="4"
                fill="#dc5c26" opacity="0.8" data-lo="${sLo}" data-hi="${sHi}"/>
            <text x="${sX + barW / 2}" y="${shaftTop - 5}" text-anchor="middle" fill="#dc5c26" font-size="9" font-weight="700">${esc(s.tolerance)}</text>
        </svg>`;
    }

    /* ── Data rows ── */
    function dataRows(part, grade) {
        return `
            <div class="tz-data-row"><span>Deviations</span><strong>${fs(part.lower_deviation_um)} / ${fs(part.upper_deviation_um)} μm</strong></div>
            <div class="tz-data-row"><span>Limits</span><strong>${fm(part.min_size_mm)} – ${fm(part.max_size_mm)} mm</strong></div>
            <div class="tz-data-meta">${esc(grade)} = ${part.it_um} μm</div>`;
    }

    /* ── SVG helpers ── */
    function gridLines(c, y0, steps, w) {
        let html = "";
        for (const v of steps) {
            const yv = y(v, c);
            if (Math.abs(yv - y0) < 3) continue;
            html += `<line x1="0" y1="${yv}" x2="${w}" y2="${yv}" stroke="#e2e8f0" stroke-width="0.5"/>
                     <text x="${w - 4}" y="${yv + 4}" text-anchor="end" fill="#94a3b8" font-size="9" font-family="SF Mono, JetBrains Mono, monospace">${v > 0 ? "+" : ""}${Math.round(v)}</text>`;
        }
        return html;
    }

    function niceSteps(min, max) {
        const rough = (max - min) / 4;
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        const r = rough / mag;
        const step = r <= 1.5 ? mag : r <= 3.5 ? 2 * mag : r <= 7.5 ? 5 * mag : 10 * mag;
        const s = Math.max(step, 1);
        const steps = [];
        for (let v = Math.ceil(min / s) * s; v <= max + s * 0.5; v += s) steps.push(v);
        return steps;
    }

    /* ── Presets ── */
    async function hydratePresets() {
        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/presets");
            if (!Array.isArray(data.presets)) return;
            if (presetList) presetList.innerHTML = data.presets.map(p => `<option value="${esc(p)}"></option>`).join("");
            if (presetSelect) {
                const cur = presetSelect.value;
                presetSelect.innerHTML = [
                    '<option value="">Custom</option>',
                    ...data.presets.map(p => `<option value="${esc(p)}">${esc(p)}</option>`),
                ].join("");
                presetSelect.value = cur;
            }
        } catch (e) {}
    }

    function fm(v) { return Number(v).toFixed(3); }
    function fs(v) { const n = Number(v); return n > 0 ? `+${n}` : `${n}`; }
    function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
});
