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
                presetList.innerHTML = data.presets.map((preset) => `<option value="${escapeHtml(preset)}"></option>`).join("");
            }
            if (presetSelect) {
                const current = presetSelect.value;
                presetSelect.innerHTML = [
                    '<option value="">Custom</option>',
                    ...data.presets.map((preset) => `<option value="${escapeHtml(preset)}">${escapeHtml(preset)}</option>`),
                ].join("");
                presetSelect.value = current;
            }
        } catch (error) {
            // Static fallback options in the HTML keep the form usable offline.
        }
    }

    function renderEmpty() {
        result.innerHTML = `
            ${dimensionCard("Shaft", null, "ei / es")}
            ${dimensionCard("Bore", null, "EI / ES")}
            ${fitCard(null)}
        `;
    }

    function renderLoading() {
        result.innerHTML = `<section class="tool-panel"><div class="tool-note">Calculating tolerance stack...</div></section>`;
    }

    function renderResult(data) {
        result.innerHTML = `
            ${dimensionCard("Shaft", data.shaft, "ei / es")}
            ${dimensionCard("Bore", data.hole, "EI / ES")}
            ${fitCard(data.fit, data.fit_combination, data.size_range)}
        `;
    }

    function renderError(message) {
        result.innerHTML = `<section class="tool-panel"><div class="tool-note error">${escapeHtml(message)}</div></section>`;
    }

    function dimensionCard(title, item, deviationLabel) {
        if (!item) {
            return `
                <section class="tool-panel">
                    <h2>${title}</h2>
                    <div class="metric-row"><span>Limits of Size</span><strong>-</strong></div>
                    <div class="metric-row"><span>${deviationLabel}</span><strong>-</strong></div>
                </section>
            `;
        }
        return `
            <section class="tool-panel tolerance-card">
                <h2>${title} <small>${escapeHtml(item.tolerance)}</small></h2>
                <div class="metric-row"><span>Limits of Size</span><strong>${formatMm(item.min_size_mm)} - ${formatMm(item.max_size_mm)} mm</strong></div>
                <div class="metric-row"><span>${deviationLabel}</span><strong>${formatSigned(item.lower_deviation_um)} / ${formatSigned(item.upper_deviation_um)} um</strong></div>
                <div class="metric-row"><span>Grade</span><strong>${escapeHtml(item.grade)} = ${item.it_um} um</strong></div>
            </section>
        `;
    }

    function fitCard(fit, combination = "-", sizeRange = "-") {
        if (!fit) {
            return `
                <section class="tool-panel">
                    <h2>Fit</h2>
                    <div class="metric-row"><span>Type</span><strong>-</strong></div>
                    <div class="metric-row"><span>Clearance</span><strong>-</strong></div>
                    <div class="metric-row"><span>Interference</span><strong>-</strong></div>
                </section>
            `;
        }
        return `
            <section class="tool-panel tolerance-card fit-${escapeHtml(fit.type)}">
                <h2>Fit <small>${escapeHtml(combination)}</small></h2>
                <div class="metric-row"><span>Type</span><strong>${escapeHtml(fit.label)}</strong></div>
                <div class="metric-row"><span>Max Clearance</span><strong>${fit.max_clearance_um} um</strong></div>
                <div class="metric-row"><span>Max Interference</span><strong>${fit.max_interference_um} um</strong></div>
                <div class="metric-row"><span>Size Range</span><strong>${escapeHtml(sizeRange)} mm</strong></div>
            </section>
        `;
    }

    function formatMm(value) {
        return Number(value).toFixed(3);
    }

    function formatSigned(value) {
        const number = Number(value);
        return number > 0 ? `+${number}` : `${number}`;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        })[char]);
    }
});
