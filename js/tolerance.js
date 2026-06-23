document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const form = document.querySelector("[data-tolerance-form]");
    const result = document.querySelector("[data-tolerance-result]");
    const presetSelect = document.querySelector("#preset");
    const fitInput = document.querySelector("#fit-combination");
    const presetList = document.querySelector("#fit-presets");
    if (!form || !result || !fitInput) return;

    hydratePresets();
    renderEmpty();

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
        renderLoading();
        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/calculate", {
                method: "POST", body: JSON.stringify(payload),
            });
            renderResult(data);
        } catch (error) {
            renderError(error.message);
        }
    });

    async function hydratePresets() {
        try {
            const data = await window.DaiyujinAPI.request("/api/public/tolerance/presets");
            if (!Array.isArray(data.presets)) return;
            if (presetList) presetList.innerHTML = data.presets.map(p => `<option value="${esc(p)}"></option>`).join("");
            if (presetSelect) {
                const cur = presetSelect.value;
                presetSelect.innerHTML = ['<option value="">Custom</option>', ...data.presets.map(p => `<option value="${esc(p)}">${esc(p)}</option>`)].join("");
                presetSelect.value = cur;
            }
        } catch (e) {}
    }

    function renderEmpty() {
        result.innerHTML = zoneCard("Shaft", null, null) + zoneCard("Bore", null, null) + fitCard(null);
    }

    function renderLoading() {
        result.innerHTML = '<section class="tool-panel"><div class="tool-note">Calculating&hellip;</div></section>';
    }

    function renderResult(data) {
        result.innerHTML =
            chartsPanel(data) +
            zoneCard("Shaft", data.shaft, data.basic_size_mm) +
            zoneCard("Bore", data.hole, data.basic_size_mm) +
            fitCard(data.fit, data.fit_combination, data.size_range);
    }

    function renderError(msg) {
        result.innerHTML = `<section class="tool-panel"><div class="tool-note error">${esc(msg)}</div></section>`;
    }

    /* ── Three-panel zone chart ───────────────── */

    function chartsPanel(data) {
        const h = data.hole, s = data.shaft, f = data.fit, basic = data.basic_size_mm;

        const all = [h.lower_deviation_um, h.upper_deviation_um, s.lower_deviation_um, s.upper_deviation_um, 0];
        const dMin = Math.min(...all), dMax = Math.max(...all);
        const span = dMax - dMin || 20;
        const pad = Math.max(span * 0.3, 15);
        const rMin = dMin - pad, rMax = dMax + pad;

        const shared = { rMin, rMax, basic, h, s, f };

        return `
        <section class="tool-panel">
            <h2>Deviation Diagram <small>zero = ${basic.toFixed(3)} mm</small></h2>
            <div class="zone-charts">
                ${singleChart("Shaft", s.tolerance, s.lower_deviation_um, s.upper_deviation_um, shared, "#dc5c26", s.grade, s.it_um)}
                ${singleChart("Bore", h.tolerance, h.lower_deviation_um, h.upper_deviation_um, shared, "#0066cc", h.grade, h.it_um)}
                ${overlayChart(shared)}
            </div>
        </section>`;
    }

    function singleChart(label, code, lo, hi, s, color, grade, it) {
        const box = svgBox(s.rMin, s.rMax);
        const y0 = y(0, box);
        const yLo = y(lo, box), yHi = y(hi, box);
        const barW = 48, x = (box.w - barW) / 2;

        return `
        <div class="zone-chart">
            <div class="zone-chart-title">${label}<span>${esc(code)}</span></div>
            <svg viewBox="0 0 ${box.w} ${box.h}" class="zone-svg">
                <line x1="0" y1="${y0}" x2="${box.w}" y2="${y0}" stroke="#cbd5e1" stroke-dasharray="5 3" stroke-width="1"/>
                ${ticks(box, y0)}
                <rect class="zone-bar zone-anim" x="${x}" y="${Math.min(yLo, yHi)}" width="${barW}" height="${Math.abs(yHi - yLo)}" rx="3" fill="${color}" opacity="0.82" data-anim-from="${y0}" data-anim-to="${Math.min(yLo, yHi)}" data-anim-h="${Math.abs(yHi - yLo)}"/>
                <text x="${x + barW / 2}" y="${Math.min(yLo, yHi) - 5}" text-anchor="middle" fill="${color}" font-size="11" font-weight="700">${fmtSigned(hi)}</text>
                <text x="${x + barW / 2}" y="${Math.max(yLo, yHi) + 14}" text-anchor="middle" fill="${color}" font-size="11" font-weight="700">${fmtSigned(lo)}</text>
            </svg>
            <div class="zone-chart-meta">${esc(grade)} = ${it} μm</div>
        </div>`;
    }

    function overlayChart(s) {
        const box = svgBox(s.rMin, s.rMax);
        const y0 = y(0, box);
        const hLo = y(s.h.lower_deviation_um, box), hHi = y(s.h.upper_deviation_um, box);
        const sLo = y(s.s.lower_deviation_um, box), sHi = y(s.s.upper_deviation_um, box);
        const barW = 40, hX = 24, sX = box.w - 24 - barW;

        /* clearance / interference shading */
        let shade = "";
        const holeTop = Math.min(hLo, hHi), holeBot = Math.max(hLo, hHi);
        const shaftTop = Math.min(sLo, sHi), shaftBot = Math.max(sLo, sHi);
        const clearY = Math.min(holeBot, shaftTop);
        const clearH = Math.abs(shaftTop - holeBot);
        const interY = Math.min(holeTop, shaftBot);
        const interH = Math.abs(shaftBot - holeTop);

        if (s.f.type === "clearance" && clearH > 0.5) {
            shade = `<rect x="0" y="${clearY}" width="${box.w}" height="${clearH}" fill="#22c55e" opacity="0.12" rx="1"/>`;
        } else if (s.f.type === "interference" && interH > 0.5) {
            shade = `<rect x="0" y="${interY}" width="${box.w}" height="${interH}" fill="#ef4444" opacity="0.14" rx="1"/>`;
        } else {
            if (s.f.max_clearance_um > 0 && clearH > 0.5)
                shade += `<rect x="0" y="${clearY}" width="${box.w}" height="${clearH}" fill="#22c55e" opacity="0.10" rx="1"/>`;
            if (s.f.max_interference_um > 0 && interH > 0.5)
                shade += `<rect x="0" y="${interY}" width="${box.w}" height="${interH}" fill="#ef4444" opacity="0.12" rx="1"/>`;
        }

        return `
        <div class="zone-chart">
            <div class="zone-chart-title">Fit<span>${esc(s.f.type)}</span></div>
            <svg viewBox="0 0 ${box.w} ${box.h}" class="zone-svg">
                <line x1="0" y1="${y0}" x2="${box.w}" y2="${y0}" stroke="#0f172a" stroke-width="1.2"/>
                ${ticks(box, y0)}
                ${shade}
                <!-- Hole -->
                <rect class="zone-bar zone-anim" x="${hX}" y="${Math.min(hLo, hHi)}" width="${barW}" height="${Math.abs(hHi - hLo)}" rx="3" fill="#0066cc" opacity="0.82" data-anim-from="${y0}" data-anim-to="${Math.min(hLo, hHi)}" data-anim-h="${Math.abs(hHi - hLo)}"/>
                <text x="${hX + barW / 2}" y="${Math.min(hLo, hHi) - 5}" text-anchor="middle" fill="#0066cc" font-size="11" font-weight="700">${esc(s.h.tolerance)}</text>
                <!-- Shaft -->
                <rect class="zone-bar zone-anim" x="${sX}" y="${Math.min(sLo, sHi)}" width="${barW}" height="${Math.abs(sHi - sLo)}" rx="3" fill="#dc5c26" opacity="0.82" data-anim-from="${y0}" data-anim-to="${Math.min(sLo, sHi)}" data-anim-h="${Math.abs(sHi - sLo)}"/>
                <text x="${sX + barW / 2}" y="${Math.min(sLo, sHi) - 5}" text-anchor="middle" fill="#dc5c26" font-size="11" font-weight="700">${esc(s.s.tolerance)}</text>
            </svg>
            <div class="zone-chart-meta">
                <span class="tag tag-clearance">Clr ${s.f.max_clearance_um} μm</span>
                <span class="tag tag-interference">Int ${s.f.max_interference_um} μm</span>
            </div>
        </div>`;
    }

    function svgBox(rMin, rMax) {
        const rng = rMax - rMin;
        return { w: 140, h: 220, pad: 18, rMin, rMax, rng };
    }

    function y(val, box) {
        return box.pad + ((box.rMax - val) / box.rng) * (box.h - 2 * box.pad);
    }

    function ticks(box, y0) {
        const step = niceStep(box.rMin, box.rMax, 5);
        let html = "";
        for (let v = Math.ceil(box.rMin / step) * step; v <= box.rMax; v += step) {
            const yv = y(v, box);
            if (Math.abs(yv - y0) < 6) continue;
            html += `<text x="${box.w - 4}" y="${yv + 4}" text-anchor="end" fill="#94a3b8" font-size="9" font-family="SF Mono, monospace">${v > 0 ? "+" : ""}${Math.round(v)}</text>`;
        }
        return html;
    }

    function niceStep(min, max, n) {
        const rough = (max - min) / (n - 1);
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        const r = rough / mag;
        const step = r <= 1.5 ? mag : r <= 3.5 ? 2 * mag : r <= 7.5 ? 5 * mag : 10 * mag;
        return Math.max(step, 1);
    }

    /* ── Animation ────────────────────────────── */

    function animateCharts() {
        document.querySelectorAll(".zone-anim").forEach(el => {
            const from = parseFloat(el.dataset.animFrom);
            const to = parseFloat(el.dataset.animTo);
            const h = parseFloat(el.dataset.animH);
            el.setAttribute("y", from);
            el.setAttribute("height", "0");
            requestAnimationFrame(() => {
                el.style.transition = "y 0.4s cubic-bezier(0.22, 1, 0.36, 1), height 0.4s cubic-bezier(0.22, 1, 0.36, 1)";
                el.setAttribute("y", to);
                el.setAttribute("height", h);
            });
        });
    }

    /* ── Cards ────────────────────────────────── */

    function zoneCard(title, item, basic) {
        if (!item) return `<section class="tool-panel"><h2>${title}</h2><div class="tool-note">Enter parameters.</div></section>`;
        return `
        <section class="tool-panel">
            <h2>${title} <small>${esc(item.tolerance)}</small></h2>
            <div class="metric-row"><span>Limits</span><strong>${fmtMm(item.min_size_mm)} – ${fmtMm(item.max_size_mm)} mm</strong></div>
            <div class="metric-row"><span>Deviations</span><strong>${fmtSigned(item.lower_deviation_um)} / ${fmtSigned(item.upper_deviation_um)} μm</strong></div>
            <div class="metric-row"><span>Grade</span><strong>${esc(item.grade)} = ${item.it_um} μm</strong></div>
        </section>`;
    }

    function fitCard(fit, combo, range) {
        if (!fit) return '<section class="tool-panel"><h2>Fit</h2><div class="tool-note">Enter parameters.</div></section>';
        return `
        <section class="tool-panel fit-card fit-${esc(fit.type)}">
            <h2>Fit <small>${esc(combo)}</small></h2>
            <div class="metric-row"><span>Type</span><strong>${esc(fit.label)}</strong></div>
            <div class="metric-row"><span>Max Clearance</span><strong>${fit.max_clearance_um} μm</strong></div>
            <div class="metric-row"><span>Max Interference</span><strong>${fit.max_interference_um} μm</strong></div>
            <div class="metric-row"><span>Size Range</span><strong>${esc(range)} mm</strong></div>
        </section>`;
    }

    /* ── Helpers ──────────────────────────────── */

    function fmtMm(v) { return Number(v).toFixed(3); }
    function fmtSigned(v) { const n = Number(v); return n > 0 ? `+${n}` : `${n}`; }
    function esc(v) {
        return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    }

    /* ── Wire animation trigger ───────────────── */

    const observer = new MutationObserver(() => {
        if (document.querySelector(".zone-anim")) { animateCharts(); }
    });
    observer.observe(result, { childList: true, subtree: true });
});
