document.addEventListener("DOMContentLoaded", () => {
    window.DaiyujinAPI.checkHealth();

    const input = document.querySelector("[data-search-input]");
    const btn = document.querySelector("[data-search-btn]");
    const resultsArea = document.querySelector("[data-results-area]");
    if (!input || !btn || !resultsArea) return;

    async function doSearch() {
        const q = input.value.trim();
        if (!q) return;
        resultsArea.innerHTML = '<div class="tool-note">Searching&hellip;</div>';
        try {
            const data = await window.DaiyujinAPI.request(`/api/public/material-standards/search?q=${encodeURIComponent(q)}&limit=10`);
            render(data);
        } catch (e) {
            resultsArea.innerHTML = `<div class="tool-note error">${esc(e.message)}</div>`;
        }
    }

    function render(data) {
        const results = data.results || [];
        if (!results.length) {
            resultsArea.innerHTML = `<div class="tool-note">No material match found for <strong>${esc(data.query)}</strong>.<br>Try another designation or contact us with your drawing and material requirement.</div>`;
            return;
        }
        resultsArea.innerHTML = results.map(r => {
            const s = r.standards || {};
            const cols = [
                ["ISO", s.ISO], ["EN", s.EN], ["DIN", s.DIN],
                ["ANSI/AA", s.ANSI_AA_USA], ["UNS", s.UNS], ["JIS", s.JIS_JP],
                ["BS", s.BS_GB], ["AFNOR", s.AFNOR_FR], ["UNE", s.UNE_ES],
                ["CSA", s.CSA_CA], ["SIS", s.SIS_SE],
            ].filter(c => c[1]);
            return `<div class="mat-result-card">
                <div class="mat-result-header">
                    <span class="mat-result-name">${esc(r.common_name)}</span>
                    <span class="mat-result-family">${esc(r.material_family)}</span>
                    ${r.review_status === 'verified' ? '<span class="mat-badge ok">Verified</span>' : '<span class="mat-badge warn">Needs Review</span>'}
                </div>
                <div class="mat-standards-grid">
                    ${cols.map(c => `<div class="mat-std-item"><span class="mat-std-key">${esc(c[0])}</span><span class="mat-std-val">${esc(c[1])}</span></div>`).join("")}
                </div>
                ${r.notes ? `<div class="tool-note" style="margin-top:0.5rem;font-size:0.78rem;">${esc(r.notes)}</div>` : ""}
                <div class="tool-note" style="margin-top:0.25rem;font-size:0.75rem;color:var(--muted);">Equivalent designations are reference mappings. Confirm final material requirements with engineering review.</div>
            </div>`;
        }).join("");
    }

    btn.addEventListener("click", doSearch);
    input.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

    function esc(v) { return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
});
