document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const input = document.querySelector("[data-search-input]");
    const btn = document.querySelector("[data-search-btn]");
    const resultsArea = document.querySelector("[data-results-area]");
    const familyFilter = document.querySelector("[data-filter-family]");
    const standardFilter = document.querySelector("[data-filter-standard]");
    const confidenceFilter = document.querySelector("[data-filter-confidence]");
    if (!input || !btn || !resultsArea) return;

    function getFilters() {
        return {
            family: (familyFilter && familyFilter.value) || "",
            standard: (standardFilter && standardFilter.value) || "",
            minConfidence: (confidenceFilter && confidenceFilter.value) || "",
        };
    }

    async function doSearch() {
        const q = input.value.trim();
        if (!q) return;
        const filters = getFilters();
        const params = new URLSearchParams();
        params.set("q", q);
        params.set("limit", "10");
        if (filters.family) params.set("family", filters.family);
        if (filters.standard) params.set("standard", filters.standard);
        if (filters.minConfidence) params.set("min_confidence", filters.minConfidence);

        resultsArea.innerHTML = '<div class="tool-note">Searching&hellip;</div>';
        try {
            const data = await window.DaiyujinAPI.request(`/api/public/material-standards/search?${params.toString()}`);
            render(data);
        } catch (e) {
            resultsArea.innerHTML = `<div class="tool-note error">${esc(e.message)}</div>`;
        }
    }

    async function loadFamilies() {
        if (!familyFilter) return;
        try {
            const data = await window.DaiyujinAPI.request("/api/public/material-standards/families");
            const families = Array.isArray(data.families) ? data.families : [];
            familyFilter.innerHTML = '<option value="">All Families</option>' + families.map(
                f => `<option value="${escAttr(f)}">${esc(f)}</option>`
            ).join("");
        } catch (_e) {
            familyFilter.innerHTML = '<option value="">All Families</option>';
        }
    }

    function render(data) {
        const results = data.results || [];
        if (!results.length) {
            resultsArea.innerHTML = `<div class="tool-note">No material match found for <strong>${esc(data.query)}</strong>.<br>Try another designation or contact us with your drawing and material requirement.</div>`;
            return;
        }

        const disclaimer = results[0].equivalence_disclaimer || "";
        resultsArea.innerHTML = results.map(r => {
            const s = r.standards || {};
            const cols = [
                ["ISO", s.ISO], ["EN", s.EN], ["DIN", s.DIN],
                ["ANSI/AA", s.ANSI_AA_USA], ["SAE/AISI", s.SAE_AISI], ["UNS", s.UNS], ["JIS", s.JIS_JP],
                ["GB", s.GB_CN], ["BS", s.BS_GB], ["AFNOR", s.AFNOR_FR], ["UNE", s.UNE_ES],
                ["UNI", s.UNI_IT], ["CSA", s.CSA_CA], ["SIS", s.SIS_SE], ["WNr", s.WNr],
            ].filter(c => c[1]);
            const confidenceText = typeof r.confidence === "number" ? r.confidence.toFixed(2) : "N/A";
            const sourceText = (r.source_ids || []).length ? `Sources: ${r.source_ids.join(", ")}` : "Sources: N/A";
            const badge = r.review_status === "verified" ? "<span class=\"mat-badge ok\">Verified</span>" : "<span class=\"mat-badge warn\">Needs Review</span>";
            return `<div class=\"mat-result-card\">
                <div class=\"mat-result-header\">
                    <span class=\"mat-result-name\">${esc(r.common_name)}</span>
                    <span class=\"mat-result-family\">${esc(r.material_family)}</span>
                    ${badge}
                    <span class=\"mat-badge ${r.confidence_label === "high" ? "ok" : "warn"}\">${esc((r.confidence_label || "").toUpperCase())}</span>
                </div>
                <div class=\"tool-note mat-result-meta\">Confidence ${esc(confidenceText)} &middot; ${esc(sourceText)}</div>
                <div class=\"mat-standards-grid\">${cols.map(
                    c => `<div class=\"mat-std-item\"><span class=\"mat-std-key\">${esc(c[0])}</span><span class=\"mat-std-val\">${esc(c[1])}</span></div>`
                ).join("")}</div>
                ${r.notes ? `<div class=\"tool-note\">${esc(r.notes)}</div>` : ""}
                ${disclaimer ? `<div class=\"tool-note\">${esc(disclaimer)}</div>` : ""}
            </div>`;
        }).join("");
    }

    function initStandardFilter() {
        if (!standardFilter) return;
        const list = [
            ["", "All Standards"],
            ["ISO", "ISO"],
            ["EN", "EN"],
            ["DIN", "DIN"],
            ["ANSI", "ANSI/AA"],
            ["SAE", "SAE/AISI"],
            ["UNS", "UNS"],
            ["JIS", "JIS"],
            ["GB", "GB/CN"],
            ["BS", "BS"],
            ["AFNOR", "AFNOR"],
            ["UNE", "UNE"],
            ["UNI", "UNI"],
            ["CSA", "CSA"],
            ["SIS", "SIS"],
            ["WNR", "WNr"],
        ];
        standardFilter.innerHTML = list.map(
            item => `<option value="${escAttr(item[0])}">${esc(item[1])}</option>`
        ).join("");
    }

    function initConfidenceFilter() {
        if (!confidenceFilter) return;
        if (!confidenceFilter.options || !confidenceFilter.options.length) {
            confidenceFilter.innerHTML = `
                <option value="">Any confidence</option>
                <option value="high">High (0.90+)</option>
                <option value="medium">Medium (0.75+)</option>
                <option value="low">Low</option>
            `;
        }
    }

    btn.addEventListener("click", doSearch);
    input.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
    initStandardFilter();
    initConfidenceFilter();
    loadFamilies();

    function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]); }
    function escAttr(v) { return String(v).replace(/["'&<>,]/g, c => ({ '"': "&quot;", "'": "&#39;", "&": "&amp;", "<": "&lt;", ">": "&gt;", ",": "&#44;" })[c]); }
});
