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
            if (presetSelect.value) {
                fitInput.value = presetSelect.value;
            }
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
                method: "POST",
                body: JSON.stringify(payload),
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
            if (presetList) {
                presetList.innerHTML = data.presets.map(p => `<option value="${escapeHtml(p)}"></option>`).join("");
            }
            if (presetSelect) {
                const current = presetSelect.value;
                presetSelect.innerHTML = [
                    '<option value="">Custom</option>',
                    ...data.presets.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`),
                ].join("");
                presetSelect.value = current;
            }
        } catch (e) {}
    }

    function renderEmpty() {
        result.innerHTML = `
            ${dimensionCard("Shaft", null, "ei / es")}
            ${dimensionCard("Bore", null, "EI / ES")}
            ${fitCard(null)}
        `;
    }

    function renderLoading() {
        result.innerHTML = '<section class="tool-panel"><div class="tool-note">Calculating tolerance stack&hellip;</div></section>';
    }

    function renderResult(data) {
        result.innerHTML = `
            ${dimensionCard("Shaft", data.shaft, "ei / es")}
            ${dimensionCard("Bore", data.hole, "EI / ES")}
            ${toleranceChart(data)}
            ${fitCard(data.fit, data.fit_combination, data.size_range)}
        `;
    }

    function renderError(message) {
        result.innerHTML = `<section class="tool-panel"><div class="tool-note error">${escapeHtml(message)}</div></section>`;
    }

    /* ── SVG Tolerance Zone Chart ─────────────── */

    function toleranceChart(data) {
        const hole = data.hole;
        const shaft = data.shaft;
        const fit = data.fit;
        const size = data.basic_size_mm;

        const hMin = hole.lower_deviation_um;
        const hMax = hole.upper_deviation_um;
        const sMin = shaft.lower_deviation_um;
        const sMax = shaft.upper_deviation_um;

        const allVals = [hMin, hMax, sMin, sMax, 0];
        const dataMin = Math.min(...allVals);
        const dataMax = Math.max(...allVals);
        const span = dataMax - dataMin || 10;
        const pad = span * 0.25;
        const rangeMin = dataMin - pad;
        const rangeMax = dataMax + pad;
        const rangeSpan = rangeMax - rangeMin;

        const W = 520;
        const H = 180;
        const margin = { top: 22, right: 16, bottom: 30, left: 100 };
        const plotW = W - margin.left - margin.right;
        const plotH = H - margin.top - margin.bottom;

        function x(val) { return margin.left + ((val - rangeMin) / rangeSpan) * plotW; }
        const zeroX = x(0);
        const boreY = margin.top + plotH * 0.18;
        const shaftY = margin.top + plotH * 0.62;
        const barH = plotH * 0.22;

        const tickVals = niceTicks(rangeMin, rangeMax, 5);
        const zeroLineClamped = Math.max(margin.left + 1, Math.min(margin.left + plotW - 1, zeroX));

        const boreColor = "#0066cc";
        const shaftColor = "#dc5c26";
        const clearanceColor = "#22c55e";
        const interferenceColor = "#ef4444";

        let zoneHtml = "";
        const boreLeft = x(hMin), boreRight = x(hMax);
        const shaftLeft = x(sMin), shaftRight = x(sMax);

        if (fit.type === "clearance") {
            zoneHtml += `<rect x="${shaftRight}" y="${boreY + barH}" width="${boreLeft - shaftRight}" height="${shaftY - boreY - barH}" fill="${clearanceColor}" opacity="0.15" rx="2"/>`;
        } else if (fit.type === "interference") {
            zoneHtml += `<rect x="${boreLeft}" y="${boreY + barH}" width="${shaftRight - boreLeft}" height="${shaftY - boreY - barH}" fill="${interferenceColor}" opacity="0.18" rx="2"/>`;
        } else {
            const clearW = boreLeft - shaftRight;
            const interfW = shaftRight - boreLeft;
            if (clearW > 1) zoneHtml += `<rect x="${shaftRight}" y="${boreY + barH}" width="${clearW}" height="${shaftY - boreY - barH}" fill="${clearanceColor}" opacity="0.12" rx="2"/>`;
            if (interfW > 1) zoneHtml += `<rect x="${boreLeft}" y="${boreY + barH}" width="${interfW}" height="${shaftY - boreY - barH}" fill="${interferenceColor}" opacity="0.15" rx="2"/>`;
        }

        const svg = `
        <section class="tool-panel tolerance-chart">
            <h2>Deviation Chart <small>${fit.type} fit</small></h2>
            <svg viewBox="0 0 ${W} ${H}" class="chart-svg" aria-label="ISO tolerance zone diagram">
                <!-- Grid lines -->
                ${tickVals.map(v => {
                    const tx = x(v);
                    return `<line x1="${tx}" y1="${margin.top}" x2="${tx}" y2="${margin.top + plotH}" stroke="#e2e8f0" stroke-width="0.5"/><text x="${tx}" y="${H - 6}" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="SF Mono, monospace">${v > 0 ? "+" : ""}${Math.round(v)}</text>`;
                }).join("")}

                <!-- Zero line -->
                <line x1="${zeroLineClamped}" y1="${margin.top}" x2="${zeroLineClamped}" y2="${margin.top + plotH}" stroke="#0f172a" stroke-width="1.5" stroke-dasharray="4 2"/>
                <text x="${zeroLineClamped}" y="${margin.top - 6}" text-anchor="middle" fill="#0f172a" font-size="11" font-weight="600">${size.toFixed(3)} mm</text>

                <!-- Bore bar -->
                <rect x="${boreLeft}" y="${boreY}" width="${Math.max(boreRight - boreLeft, 2)}" height="${barH}" fill="${boreColor}" opacity="0.85" rx="3"/>
                <text x="${boreLeft - 6}" y="${boreY + barH / 2 + 4}" text-anchor="end" fill="${boreColor}" font-size="11" font-weight="600">Bore ${escapeHtml(hole.tolerance)}</text>
                <text x="${boreLeft + 4}" y="${boreY + barH / 2 + 4}" fill="#fff" font-size="9" font-weight="600">${hMin > 0 ? "+" : ""}${hMin}</text>
                ${hMax !== hMin ? `<text x="${boreRight - 4}" y="${boreY + barH / 2 + 4}" text-anchor="end" fill="#fff" font-size="9" font-weight="600">${hMax > 0 ? "+" : ""}${hMax}</text>` : ""}

                <!-- Shaft bar -->
                <rect x="${shaftLeft}" y="${shaftY}" width="${Math.max(shaftRight - shaftLeft, 2)}" height="${barH}" fill="${shaftColor}" opacity="0.85" rx="3"/>
                <text x="${shaftLeft - 6}" y="${shaftY + barH / 2 + 4}" text-anchor="end" fill="${shaftColor}" font-size="11" font-weight="600">Shaft ${escapeHtml(shaft.tolerance)}</text>
                <text x="${shaftLeft + 4}" y="${shaftY + barH / 2 + 4}" fill="#fff" font-size="9" font-weight="600">${sMin > 0 ? "+" : ""}${sMin}</text>
                ${sMax !== sMin ? `<text x="${shaftRight - 4}" y="${shaftY + barH / 2 + 4}" text-anchor="end" fill="#fff" font-size="9" font-weight="600">${sMax > 0 ? "+" : ""}${sMax}</text>` : ""}

                <!-- Fit zone -->
                ${zoneHtml}

                <!-- Axis label -->
                <text x="${margin.left + plotW / 2}" y="${H - 2}" text-anchor="middle" fill="#94a3b8" font-size="9">deviation (μm)</text>
            </svg>
        </section>`;
        return svg;
    }

    function niceTicks(min, max, count) {
        const rough = (max - min) / (count - 1);
        const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
        const residual = rough / magnitude;
        let step;
        if (residual <= 1.5) step = 1 * magnitude;
        else if (residual <= 3.5) step = 2 * magnitude;
        else if (residual <= 7.5) step = 5 * magnitude;
        else step = 10 * magnitude;
        const start = Math.ceil(min / step) * step;
        const end = Math.floor(max / step) * step;
        const ticks = [];
        for (let v = start; v <= end + step * 0.5; v += step) ticks.push(v);
        return ticks;
    }

    /* ── Cards ────────────────────────────────── */

    function dimensionCard(title, item, deviationLabel) {
        if (!item) {
            return `
                <section class="tool-panel">
                    <h2>${title}</h2>
                    <div class="metric-row"><span>Limits of Size</span><strong>-</strong></div>
                    <div class="metric-row"><span>${deviationLabel}</span><strong>-</strong></div>
                </section>`;
        }
        return `
            <section class="tool-panel tolerance-card">
                <h2>${title} <small>${escapeHtml(item.tolerance)}</small></h2>
                <div class="metric-row"><span>Limits of Size</span><strong>${formatMm(item.min_size_mm)} – ${formatMm(item.max_size_mm)} mm</strong></div>
                <div class="metric-row"><span>${deviationLabel}</span><strong>${formatSigned(item.lower_deviation_um)} / ${formatSigned(item.upper_deviation_um)} μm</strong></div>
                <div class="metric-row"><span>Grade</span><strong>${escapeHtml(item.grade)} = ${item.it_um} μm</strong></div>
            </section>`;
    }

    function fitCard(fit, combination = "-", sizeRange = "-") {
        if (!fit) {
            return `
                <section class="tool-panel">
                    <h2>Fit</h2>
                    <div class="metric-row"><span>Type</span><strong>-</strong></div>
                    <div class="metric-row"><span>Clearance</span><strong>-</strong></div>
                    <div class="metric-row"><span>Interference</span><strong>-</strong></div>
                </section>`;
        }
        return `
            <section class="tool-panel tolerance-card fit-${escapeHtml(fit.type)}">
                <h2>Fit <small>${escapeHtml(combination)}</small></h2>
                <div class="metric-row"><span>Type</span><strong>${escapeHtml(fit.label)}</strong></div>
                <div class="metric-row"><span>Max Clearance</span><strong>${fit.max_clearance_um} μm</strong></div>
                <div class="metric-row"><span>Max Interference</span><strong>${fit.max_interference_um} μm</strong></div>
                <div class="metric-row"><span>Size Range</span><strong>${escapeHtml(sizeRange)} mm</strong></div>
            </section>`;
    }

    function formatMm(value) {
        return Number(value).toFixed(3);
    }

    function formatSigned(value) {
        const n = Number(value);
        return n > 0 ? `+${n}` : `${n}`;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    }
});
