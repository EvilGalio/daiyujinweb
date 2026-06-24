document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-tolerance-form]");
    const result = document.querySelector("[data-tolerance-result]");
    const presetSelect = document.querySelector("#preset");
    const fitInput = document.querySelector("#fit-combination");
    const presetList = document.querySelector("#fit-presets");
    if (!form || !result || !fitInput) return;

    hydratePresets();

    if (presetSelect) {
        presetSelect.addEventListener("change", () => {
            if (presetSelect.value) fitInput.value = presetSelect.value;
        });
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const payload = {
            basic_size_mm: Number(formData.get("basic_size")),
            fit_combination: String(formData.get("fit_combination") || "").trim(),
        };
        result.innerHTML = '<div class="tolerance-loading">Analyzing tolerance stack&hellip;</div>';
        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/calculate", {
                method: "POST", body: JSON.stringify(payload),
            });
            renderResult(data);
        } catch (error) {
            result.innerHTML = `<div class="tool-note error">${esc(error.message)}</div>`;
        }
    });

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

    /* ── Shared coordinate system ─────────────── */

    function coord(data) {
        const h = data.hole, s = data.shaft;
        const all = [h.lower_deviation_um, h.upper_deviation_um, s.lower_deviation_um, s.upper_deviation_um, 0];
        const dMin = Math.min(...all), dMax = Math.max(...all);
        const span = dMax - dMin || 20;
        const pad = Math.max(span * 0.3, 12);
        return { rMin: dMin - pad, rMax: dMax + pad };
    }

    function y(val, c) {
        const rng = c.rMax - c.rMin;
        const H = 180, P = 16;
        return P + ((c.rMax - val) / rng) * (H - 2 * P);
    }

    /* ── Render ───────────────────────────────── */

    function renderResult(data) {
        const c = coord(data);
        const h = data.hole, s = data.shaft, f = data.fit;
        const y0 = y(0, c);
        const steps = niceSteps(c.rMin, c.rMax);

        result.innerHTML = `
        <div class="tolerance-columns">
            ${col("Shaft", s.tolerance, s.lower_deviation_um, s.upper_deviation_um, s.grade, s.it_um,
                s.min_size_mm, s.max_size_mm, "#dc5c26", c, y0, steps, false)}
            ${col("Bore", h.tolerance, h.lower_deviation_um, h.upper_deviation_um, h.grade, h.it_um,
                h.min_size_mm, h.max_size_mm, "#0066cc", c, y0, steps, false)}
            ${fitCol(data, c, y0, steps)}
        </div>
        <div class="tolerance-summary fit-${esc(f.type)}">
            <div class="fit-summary-type">
                <span class="fit-dot fit-dot-${esc(f.type)}"></span>
                ${esc(f.label)} &mdash; ${esc(data.fit_combination)}
            </div>
            <div class="fit-summary-metrics">
                <span class="fit-metric">Max Clearance <strong>${f.max_clearance_um} μm</strong></span>
                <span class="fit-metric">Max Interference <strong>${f.max_interference_um} μm</strong></span>
                <span class="fit-metric">Size Range <strong>${esc(data.size_range)} mm</strong></span>
            </div>
        </div>`;

        /* animate bars from zero line */
        requestAnimationFrame(() => {
            document.querySelectorAll(".tz-bar").forEach(el => {
                const from = parseFloat(el.dataset.from);
                const to = parseFloat(el.dataset.to);
                const hgt = Math.abs(to - from);
                el.setAttribute("y", from);
                el.setAttribute("height", "0");
                requestAnimationFrame(() => {
                    el.style.transition = "y 0.45s cubic-bezier(0.22, 1, 0.36, 1), height 0.45s cubic-bezier(0.22, 1, 0.36, 1)";
                    el.setAttribute("y", Math.min(from, to));
                    el.setAttribute("height", hgt);
                });
            });
        });
    }

    /* ── Single column (Shaft / Bore) ─────────── */

    function col(label, code, lo, hi, grade, it, minS, maxS, color, c, y0, steps, isFit) {
        const yLo = y(lo, c), yHi = y(hi, c);
        const barW = 52, x = (140 - barW) / 2;
        return `
        <div class="tz-col">
            <div class="tz-col-head">
                <span class="tz-col-label">${label}</span>
                <span class="tz-col-code" style="color:${color}">${esc(code)}</span>
            </div>
            <svg viewBox="0 0 140 180" class="tz-svg">
                ${gridLines(c, y0, steps)}
                <line x1="0" y1="${y0}" x2="140" y2="${y0}" stroke="#0f172a" stroke-width="1.2"/>
                <text x="2" y="${y0 - 4}" fill="#0f172a" font-size="9" font-weight="700">0</text>
                <rect class="tz-bar" x="${x}" y="${y0}" width="${barW}" height="0" rx="3" fill="${color}" opacity="0.85"
                    data-from="${y0}" data-to="${yLo}" style="will-change:transform"/>
            </svg>
            <div class="tz-col-data">
                <div class="tz-data-row"><span>Deviations</span><strong>${fs(lo)} / ${fs(hi)} μm</strong></div>
                <div class="tz-data-row"><span>Limits</span><strong>${fm(minS)} – ${fm(maxS)} mm</strong></div>
                <div class="tz-data-meta">${esc(grade)} = ${it} μm</div>
            </div>
        </div>`;
    }

    /* ── Fit overlay column ───────────────────── */

    function fitCol(data, c, y0, steps) {
        const h = data.hole, s = data.shaft, f = data.fit;
        const hLo = y(h.lower_deviation_um, c), hHi = y(h.upper_deviation_um, c);
        const sLo = y(s.lower_deviation_um, c), sHi = y(s.upper_deviation_um, c);
        const barW = 36, hX = 30, sX = 74;
        const holeTop = Math.min(hLo, hHi), holeBot = Math.max(hLo, hHi);
        const shaftTop = Math.min(sLo, sHi), shaftBot = Math.max(sLo, sHi);

        let shade = "";
        if (f.type === "clearance") {
            shade = `<rect x="0" y="${holeBot}" width="140" height="${shaftTop - holeBot}" fill="#22c55e" opacity="0.12" rx="1"/>`;
        } else if (f.type === "interference") {
            shade = `<rect x="0" y="${shaftBot}" width="140" height="${holeTop - shaftBot}" fill="#ef4444" opacity="0.14" rx="1"/>`;
        } else {
            if (f.max_clearance_um > 1) shade += `<rect x="0" y="${holeBot}" width="140" height="${Math.max(shaftTop - holeBot, 0)}" fill="#22c55e" opacity="0.10" rx="1"/>`;
            if (f.max_interference_um > 1) shade += `<rect x="0" y="${Math.min(holeTop, shaftBot)}" width="140" height="${Math.abs(shaftBot - holeTop)}" fill="#ef4444" opacity="0.12" rx="1"/>`;
        }

        return `
        <div class="tz-col">
            <div class="tz-col-head">
                <span class="tz-col-label">Fit</span>
                <span class="tz-col-code">${esc(f.type)}</span>
            </div>
            <svg viewBox="0 0 140 180" class="tz-svg">
                ${gridLines(c, y0, steps)}
                <line x1="0" y1="${y0}" x2="140" y2="${y0}" stroke="#0f172a" stroke-width="1.2"/>
                <text x="2" y="${y0 - 4}" fill="#0f172a" font-size="9" font-weight="700">0</text>
                ${shade}
                <rect class="tz-bar" x="${hX}" y="${y0}" width="${barW}" height="0" rx="3" fill="#0066cc" opacity="0.8"
                    data-from="${y0}" data-to="${holeTop}"/>
                <text x="${hX + barW / 2}" y="${holeTop - 5}" text-anchor="middle" fill="#0066cc" font-size="9" font-weight="700">${esc(h.tolerance)}</text>
                <rect class="tz-bar" x="${sX}" y="${y0}" width="${barW}" height="0" rx="3" fill="#dc5c26" opacity="0.8"
                    data-from="${y0}" data-to="${shaftTop}"/>
                <text x="${sX + barW / 2}" y="${shaftTop - 5}" text-anchor="middle" fill="#dc5c26" font-size="9" font-weight="700">${esc(s.tolerance)}</text>
            </svg>
            <div class="tz-col-data">
                <div class="tz-data-row"><span>Max Clearance</span><strong>${f.max_clearance_um} μm</strong></div>
                <div class="tz-data-row"><span>Max Interference</span><strong>${f.max_interference_um} μm</strong></div>
            </div>
        </div>`;
    }

    /* ── SVG helpers ──────────────────────────── */

    function gridLines(c, y0, steps) {
        let html = "";
        for (const v of steps) {
            const yv = y(v, c);
            if (Math.abs(yv - y0) < 4) continue;
            html += `<line x1="0" y1="${yv}" x2="140" y2="${yv}" stroke="#e2e8f0" stroke-width="0.5"/>
                     <text x="138" y="${yv + 4}" text-anchor="end" fill="#94a3b8" font-size="9" font-family="SF Mono, monospace">${v > 0 ? "+" : ""}${Math.round(v)}</text>`;
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

    /* ── Helpers ──────────────────────────────── */

    function fm(v) { return Number(v).toFixed(3); }
    function fs(v) { const n = Number(v); return n > 0 ? `+${n}` : `${n}`; }
    function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
});
