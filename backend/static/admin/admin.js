/* Admin Console */
(function () {
    const toast = document.getElementById('admin-toast');

    function showToast(msg, ok) {
        if (!toast) return;
        toast.textContent = msg; toast.hidden = false;
        toast.style.background = ok ? '#1a1d23' : '#dc2626';
        setTimeout(() => { toast.hidden = true; }, 2500);
    }

    document.addEventListener('click', e => {
        const btn = e.target.closest('[data-admin-save]');
        if (!btn) return;
        const scope = btn.dataset.adminSaveScope || 'global';
        const key = btn.dataset.adminSaveKey;
        const input = document.querySelector(`[data-admin-input="${scope}/${key}"]`);
        if (!input) return;
        btn.disabled = true;
        fetch('/api/admin/settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope, key, value: input.value }),
        }).then(r => r.json()).then(d => {
            showToast(d.ok ? 'Saved' : 'Save failed', d.ok);
        }).catch(() => showToast('Network error', false)).finally(() => { btn.disabled = false; });
    });

    /* ── Shared ── */
    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }
    function trunc(s, n) { const t = String(s); return t.length > n ? t.slice(0, n) + '...' : t; }

    /* ── Inquiries ── */
    let inqPage = 1, inqQuery = '', inqDateFrom = '', inqDateTo = '';

    async function loadInquiries() {
        const tbody = document.getElementById('inq-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">Loading...</td></tr>';
        const params = new URLSearchParams({ page: inqPage, page_size: 25, q: inqQuery });
        if (inqDateFrom) params.set('date_from', inqDateFrom);
        if (inqDateTo) params.set('date_to', inqDateTo);
        try {
            const res = await fetch(`/api/admin/inquiries?${params}`);
            const data = await res.json();
            document.getElementById('inq-total').textContent = data.total;
            document.getElementById('inq-export').href = `/api/admin/inquiries/export.csv?${params}`;
            tbody.innerHTML = data.items.length ? data.items.map(r =>
                `<tr data-inq-id="${r.record_id}">
                    <td>${r.created_at ? r.created_at.slice(0,16).replace('T',' ') : '-'}</td>
                    <td title="${esc(r.part_name)}">${esc(trunc(r.part_name, 28))}</td>
                    <td>${esc(r.customer_email)}</td>
                    <td>${r.quantity || '-'}</td>
                    <td>${esc(trunc(r.material_name, 20))}</td>
                    <td>${esc(r.total_display)}</td>
                    <td>${r.batch_item_index ? `${r.batch_item_index}/${r.batch_item_count || '-'}` : '-'}</td>
                </tr>`
            ).join('') : '<tr><td colspan="7" class="admin-empty">No records found.</td></tr>';
            tbody.querySelectorAll('[data-inq-id]').forEach(row => {
                row.addEventListener('click', () => showInquiryDetail(row.dataset.inqId));
            });
        } catch (e) { tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">Failed to load.</td></tr>'; }
    }

    async function showInquiryDetail(id) {
        try {
            const r = await fetch(`/api/admin/inquiries/${id}`).then(r => r.json());
            const overlay = document.createElement('div');
            overlay.className = 'admin-overlay';
            overlay.innerHTML = `
                <div class="admin-drawer">
                    <div class="admin-drawer-head"><h3>Inquiry #${r.id}</h3><button class="admin-close" onclick="this.closest('.admin-overlay').remove()">&times;</button></div>
                    <div class="admin-drawer-body">
                        <div class="admin-detail-grid">
                            <div><span>Time</span><strong>${r.created_at ? r.created_at.slice(0,16).replace('T',' ') : '-'}</strong></div>
                            <div><span>Part</span><strong>${esc(r.part_name)}</strong></div>
                            <div><span>Customer</span><strong>${esc(r.customer_name || '-')}</strong></div>
                            <div><span>Email</span><strong>${esc(r.customer_email || '-')}</strong></div>
                            <div><span>Qty</span><strong>${r.quantity || '-'}</strong></div>
                            <div><span>Material</span><strong>${esc(r.material_name || '-')}</strong></div>
                            <div><span>Total</span><strong>${esc(r.total_display || '-')}</strong></div>
                            <div><span>Currency</span><strong>${r.currency || '-'}</strong></div>
                            <div><span>File</span><strong>${esc(r.stp_filename || '-')}</strong></div>
                            <div><span>IP</span><strong>${r.client_ip || '-'}</strong></div>
                        </div>
                        ${r.input_params ? `<details style="margin-top:1rem"><summary>Raw params</summary><pre style="font-size:11px;overflow:auto;max-height:300px;background:#f9fafb;padding:.5rem;border-radius:4px">${esc(JSON.stringify(r.input_params, null, 2))}</pre></details>` : ''}
                        ${r.result ? `<details style="margin-top:.5rem"><summary>Raw result</summary><pre style="font-size:11px;overflow:auto;max-height:300px;background:#f9fafb;padding:.5rem;border-radius:4px">${esc(JSON.stringify(r.result, null, 2))}</pre></details>` : ''}
                    </div></div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        } catch (e) { showToast('Failed to load detail', false); }
    }

    function renderInquiriesPage() {
        return `<h2>Inquiries</h2>
            <div class="admin-toolbar">
                <input type="text" id="inq-search" placeholder="Search email / part / material..." value="${esc(inqQuery)}">
                <input type="date" id="inq-date-from" value="${inqDateFrom}">
                <input type="date" id="inq-date-to" value="${inqDateTo}">
                <span style="color:#6b7280;font-size:13px"><span id="inq-total">0</span> records</span>
                <a id="inq-export" href="/api/admin/inquiries/export.csv" style="margin-left:auto;color:#2563eb;text-decoration:none;font-size:13px;font-weight:600">Export CSV</a>
            </div>
            <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Time</th><th>Part</th><th>Email</th><th>Qty</th><th>Material</th><th>Total</th><th>Batch</th></tr></thead><tbody id="inq-body"></tbody></table></div>
            <div class="admin-pager"><button id="inq-prev">Previous</button><span id="inq-page">Page 1</span><button id="inq-next">Next</button></div>`;
    }

    function bindInquiriesEvents() {
        const search = document.getElementById('inq-search');
        const from = document.getElementById('inq-date-from');
        const to = document.getElementById('inq-date-to');
        let timer;
        search?.addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { inqQuery = e.target.value; inqPage = 1; loadInquiries(); }, 400); });
        from?.addEventListener('change', e => { inqDateFrom = e.target.value; inqPage = 1; loadInquiries(); });
        to?.addEventListener('change', e => { inqDateTo = e.target.value; inqPage = 1; loadInquiries(); });
        document.getElementById('inq-prev')?.addEventListener('click', () => { if (inqPage > 1) { inqPage--; loadInquiries(); } });
        document.getElementById('inq-next')?.addEventListener('click', () => { inqPage++; loadInquiries(); });
    }

    /* ── Settings ── */
    async function loadSettings(scope) {
        const container = document.getElementById('settings-content');
        if (!container) return;
        container.innerHTML = '<p>Loading...</p>';
        const url = scope ? `/api/admin/settings?scope=${encodeURIComponent(scope)}` : '/api/admin/settings';
        try {
            const res = await fetch(url);
            const data = await res.json();
            const groups = {};
            data.settings.forEach(s => { const g = s.scope; if (!groups[g]) groups[g] = []; groups[g].push(s); });
            const scopes = Object.keys(groups).sort();
            const sel = document.getElementById('site-scope');
            if (sel && sel.options.length <= 1) {
                sel.innerHTML = '<option value="">All scopes</option>' + scopes.map(s => `<option value="${esc(s)}" ${s===scope?'selected':''}>${esc(s)}</option>`).join('');
            }
            container.innerHTML = Object.entries(groups).map(([scopeName, items]) =>
                `<h3 style="margin:1.25rem 0 .5rem;font-size:14px;color:#6b7280;">${esc(scopeName)}</h3>
                <div class="admin-form">${items.map(s => `
                    <div class="admin-form-group">
                        <label>${esc(s.key)} <small style="color:#9ca3af">(${s.value_type}${s.is_public?' · public':''})</small>${s.description ? `<br><small style="color:#9ca3af">${esc(s.description)}</small>` : ''}</label>
                        ${s.value_type === 'bool'
                            ? `<select data-admin-input="${s.scope}/${s.key}"><option value="true" ${s.value==='true'?'selected':''}>Yes</option><option value="false" ${s.value==='false'?'selected':''}>No</option></select>`
                            : s.value.length > 120
                                ? `<textarea data-admin-input="${s.scope}/${s.key}" rows="3">${esc(s.value)}</textarea>`
                                : `<input type="text" data-admin-input="${s.scope}/${s.key}" value="${esc(s.value)}">`
                        }
                        <button data-admin-save data-admin-save-scope="${s.scope}" data-admin-save-key="${s.key}" style="margin-top:.35rem;">Save</button>
                    </div>`).join('')}</div>`
            ).join('');
        } catch (e) { container.innerHTML = '<p>Failed to load settings.</p>'; }
    }

    /* ── Nav clicks ── */
    document.querySelector('[data-nav="inquiries"]')?.addEventListener('click', e => {
        e.preventDefault();
        document.querySelector('.admin-main').innerHTML = renderInquiriesPage();
        bindInquiriesEvents();
        loadInquiries();
    });

    document.querySelector('[data-nav="settings"]')?.addEventListener('click', e => {
        e.preventDefault();
        document.querySelector('.admin-main').innerHTML =
            '<h2>Settings</h2><div class="admin-toolbar"><select id="site-scope"><option value="">All scopes</option></select></div><div id="settings-content"><p>Loading...</p></div>';
        loadSettings('');
        document.getElementById('site-scope').addEventListener('change', ev => loadSettings(ev.target.value));
    });

    document.querySelector('[data-nav="system"]')?.addEventListener('click', async e => {
        e.preventDefault();
        const main = document.querySelector('.admin-main');
        main.innerHTML = '<h2>System Health</h2><p>Loading...</p>';
        try {
            const h = await fetch('/api/admin/system/health').then(r => r.json());
            main.innerHTML = `<h2>System Health</h2>
                <div class="admin-stats">
                    <div class="admin-stat-card"><span class="admin-stat-label">DB Size</span><span class="admin-stat-value">${h.db_size_mb} MB</span></div>
                    <div class="admin-stat-card"><span class="admin-stat-label">Total Inquiries</span><span class="admin-stat-value">${h.total_inquiries}</span></div>
                    <div class="admin-stat-card"><span class="admin-stat-label">Uploads</span><span class="admin-stat-value">${h.uploads.files} files / ${h.uploads.size_mb} MB</span></div>
                    <div class="admin-stat-card"><span class="admin-stat-label">Thumbnails</span><span class="admin-stat-value">${h.thumbnails.files} files / ${h.thumbnails.size_mb} MB</span></div>
                    <div class="admin-stat-card"><span class="admin-stat-label">STL Files</span><span class="admin-stat-value">${h.stl_files.files} files / ${h.stl_files.size_mb} MB</span></div>
                    <div class="admin-stat-card"><span class="admin-stat-label">Latest Inquiry</span><span class="admin-stat-value" style="font-size:13px">${h.latest_inquiry}</span></div>
                </div>
                <div class="admin-form" style="margin-top:1rem">
                    <p style="margin-bottom:.5rem;font-size:13px;color:#6b7280">Database: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${esc(h.db_path)}</code></p>
                    <p style="font-size:13px;color:#6b7280">API: <span style="color:#059669;font-weight:600">${h.api_status}</span></p>
                </div>`;
        } catch (e) { main.innerHTML = '<h2>System Health</h2><p>Failed to load.</p>'; }
    });

    document.querySelector('[data-nav="audit"]')?.addEventListener('click', async e => {
        e.preventDefault();
        const main = document.querySelector('.admin-main');
        main.innerHTML = '<h2>Audit Logs</h2><p>Loading...</p>';
        try {
            const logs = (await fetch('/api/admin/audit-logs').then(r => r.json())).logs || [];
            main.innerHTML = `<h2>Audit Logs</h2>
                <div class="admin-table-wrap"><table class="admin-table">
                    <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Old</th><th>New</th></tr></thead>
                    <tbody>${logs.length ? logs.map(l => `<tr>
                        <td>${l.created_at ? l.created_at.slice(0,16).replace('T',' ') : '-'}</td>
                        <td>${esc(l.admin_username || '-')}</td>
                        <td><span class="admin-badge ${l.action}">${esc(l.action)}</span></td>
                        <td>${esc(l.target_key || '-')}</td>
                        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.old_value || '-')}</td>
                        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.new_value || '-')}</td>
                    </tr>`).join('') : '<tr><td colspan="6" class="admin-empty">No audit records yet.</td></tr>'}</tbody>
                </table></div>`;
        } catch (e) { main.innerHTML = '<h2>Audit Logs</h2><p>Failed to load.</p>'; }
    });
})();
