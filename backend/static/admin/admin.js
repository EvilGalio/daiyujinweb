/* 待雨尽 Tools 管理后台 */
(function () {
    var toast = document.getElementById('admin-toast');

    function showToast(msg, ok) {
        if (!toast) return;
        toast.textContent = msg; toast.hidden = false;
        toast.style.background = ok ? '#1a1d23' : '#dc2626';
        setTimeout(function () { toast.hidden = true; }, 2500);
    }

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-admin-save]');
        if (!btn) return;
        var scope = btn.dataset.adminSaveScope || 'global';
        var key = btn.dataset.adminSaveKey;
        var input = document.querySelector('[data-admin-input="' + scope + '/' + key + '"]');
        if (!input) return;
        btn.disabled = true;
        fetch('/api/admin/settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: scope, key: key, value: input.value }),
        }).then(function (r) { return r.json(); }).then(function (d) {
            showToast(d.ok ? '已保存' : '保存失败', d.ok);
        }).catch(function () { showToast('网络错误', false); }).finally(function () { btn.disabled = false; });
    });

    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
    function trunc(s, n) { var t = String(s); return t.length > n ? t.slice(0, n) + '...' : t; }

    /* ── 询盘管理 ── */
    var inqPage = 1, inqQuery = '', inqDateFrom = '', inqDateTo = '';

    function loadInquiries() {
        var tbody = document.getElementById('inq-body');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">加载中...</td></tr>';
        var params = new URLSearchParams({ page: inqPage, page_size: 25, q: inqQuery });
        if (inqDateFrom) params.set('date_from', inqDateFrom);
        if (inqDateTo) params.set('date_to', inqDateTo);
        fetch('/api/admin/inquiries?' + params).then(function (r) { return r.json(); }).then(function (data) {
            document.getElementById('inq-total').textContent = data.total;
            document.getElementById('inq-export').href = '/api/admin/inquiries/export.csv?' + params;
            tbody.innerHTML = data.items.length ? data.items.map(function (r) {
                return '<tr data-inq-id="' + r.record_id + '">' +
                    '<td>' + (r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '-') + '</td>' +
                    '<td title="' + esc(r.part_name) + '">' + esc(trunc(r.part_name, 28)) + '</td>' +
                    '<td>' + esc(r.customer_email) + '</td>' +
                    '<td>' + (r.quantity || '-') + '</td>' +
                    '<td>' + esc(trunc(r.material_name, 20)) + '</td>' +
                    '<td>' + esc(r.total_display) + '</td>' +
                    '<td>' + (r.batch_item_index ? r.batch_item_index + '/' + (r.batch_item_count || '-') : '-') + '</td>' +
                    '</tr>';
            }).join('') : '<tr><td colspan="7" class="admin-empty">未找到记录</td></tr>';
            tbody.querySelectorAll('[data-inq-id]').forEach(function (row) {
                row.addEventListener('click', function () { showInquiryDetail(row.dataset.inqId); });
            });
        }).catch(function () { tbody.innerHTML = '<tr><td colspan="7" class="admin-empty">加载失败</td></tr>'; });
    }

    function showInquiryDetail(id) {
        fetch('/api/admin/inquiries/' + id).then(function (r) { return r.json(); }).then(function (r) {
            var overlay = document.createElement('div');
            overlay.className = 'admin-overlay';
            overlay.innerHTML =
                '<div class="admin-drawer">' +
                '<div class="admin-drawer-head"><h3>询盘 #' + r.id + '</h3><button class="admin-close" onclick="this.closest(\'.admin-overlay\').remove()">&times;</button></div>' +
                '<div class="admin-drawer-body">' +
                '<div class="admin-detail-grid">' +
                '<div><span>时间</span><strong>' + (r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '-') + '</strong></div>' +
                '<div><span>零件</span><strong>' + esc(r.part_name) + '</strong></div>' +
                '<div><span>客户</span><strong>' + esc(r.customer_name || '-') + '</strong></div>' +
                '<div><span>邮箱</span><strong>' + esc(r.customer_email || '-') + '</strong></div>' +
                '<div><span>数量</span><strong>' + (r.quantity || '-') + '</strong></div>' +
                '<div><span>材料</span><strong>' + esc(r.material_name || '-') + '</strong></div>' +
                '<div><span>报价</span><strong>' + esc(r.total_display || '-') + '</strong></div>' +
                '<div><span>货币</span><strong>' + (r.currency || '-') + '</strong></div>' +
                '<div><span>文件</span><strong>' + esc(r.stp_filename || '-') + '</strong></div>' +
                '<div><span>IP</span><strong>' + (r.client_ip || '-') + '</strong></div>' +
                '</div>' +
                (r.input_params ? '<details style="margin-top:1rem"><summary>原始参数</summary><pre style="font-size:11px;overflow:auto;max-height:300px;background:#f9fafb;padding:.5rem;border-radius:4px">' + esc(JSON.stringify(r.input_params, null, 2)) + '</pre></details>' : '') +
                (r.result ? '<details style="margin-top:.5rem"><summary>原始结果</summary><pre style="font-size:11px;overflow:auto;max-height:300px;background:#f9fafb;padding:.5rem;border-radius:4px">' + esc(JSON.stringify(r.result, null, 2)) + '</pre></details>' : '') +
                '</div></div>';
            document.body.appendChild(overlay);
            overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        }).catch(function () { showToast('加载详情失败', false); });
    }

    function renderInquiriesPage() {
        return '<h2>询盘记录</h2>' +
            '<div class="admin-toolbar">' +
            '<input type="text" id="inq-search" placeholder="搜索邮箱 / 零件 / 材料..." value="' + esc(inqQuery) + '">' +
            '<input type="date" id="inq-date-from" value="' + inqDateFrom + '">' +
            '<input type="date" id="inq-date-to" value="' + inqDateTo + '">' +
            '<span style="color:#6b7280;font-size:13px"><span id="inq-total">0</span> 条记录</span>' +
            '<a id="inq-export" href="/api/admin/inquiries/export.csv" style="margin-left:auto;color:#2563eb;text-decoration:none;font-size:13px;font-weight:600">导出 CSV</a>' +
            '</div>' +
            '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>零件</th><th>邮箱</th><th>数量</th><th>材料</th><th>报价</th><th>批次</th></tr></thead><tbody id="inq-body"></tbody></table></div>' +
            '<div class="admin-pager"><button id="inq-prev">上一页</button><span id="inq-page">第 1 页</span><button id="inq-next">下一页</button></div>';
    }

    function bindInquiriesEvents() {
        var search = document.getElementById('inq-search'), timer;
        var from = document.getElementById('inq-date-from'), to = document.getElementById('inq-date-to');
        search && search.addEventListener('input', function (e) { clearTimeout(timer); timer = setTimeout(function () { inqQuery = e.target.value; inqPage = 1; loadInquiries(); }, 400); });
        from && from.addEventListener('change', function (e) { inqDateFrom = e.target.value; inqPage = 1; loadInquiries(); });
        to && to.addEventListener('change', function (e) { inqDateTo = e.target.value; inqPage = 1; loadInquiries(); });
        document.getElementById('inq-prev') && document.getElementById('inq-prev').addEventListener('click', function () { if (inqPage > 1) { inqPage--; loadInquiries(); } });
        document.getElementById('inq-next') && document.getElementById('inq-next').addEventListener('click', function () { inqPage++; loadInquiries(); });
    }

    /* ── 系统设置 ── */
    /* ── 系统设置 ── */
    function renderSettingControl(s) {
        var attr = 'data-admin-input="' + s.scope + '/' + s.key + '"';
        if (s.value_type === 'bool') {
            return '<select ' + attr + '><option value="true"' + (s.value === 'true' ? ' selected' : '') + '>是</option><option value="false"' + (s.value === 'false' ? ' selected' : '') + '>否</option></select>';
        }
        if (s.value_type === 'color') {
            return '<input type="color" ' + attr + ' value="' + esc(s.value) + '" style="width:60px;height:32px"><span style="margin-left:.5rem;font-size:13px;color:#6b7280">' + esc(s.value) + '</span>';
        }
        if (s.value_type === 'number') {
            return '<input type="number" ' + attr + ' value="' + esc(s.value) + '" step="0.01" style="width:120px">';
        }
        if (s.value_type === 'url') {
            return '<input type="url" ' + attr + ' value="' + esc(s.value) + '" placeholder="https://...">';
        }
        if (s.value.length > 120) {
            return '<textarea ' + attr + ' rows="3">' + esc(s.value) + '</textarea>';
        }
        return '<input type="text" ' + attr + ' value="' + esc(s.value) + '">';
    }

    var settingLabels = {
        customer_name_required: '客户称呼是否必填', customer_email_required: '客户邮箱是否必填',
        formal_quote_url: '正式报价链接', formal_quote_label: '正式报价按钮文案',
        engineer_contact_url: '工程师联系链接', engineer_contact_label: '工程师联系文案',
        preview_watermark_text: '预览图水印文字', preview_watermark_opacity: '水印透明度',
        preview_watermark_angle: '水印角度', preview_watermark_spacing: '水印间距',
        preview_watermark_color: '水印颜色', preview_watermark_font_scale: '水印字体比例',
        allowed_extensions: '允许上传格式', disclaimer_template: '报价免责声明模板',
        contact_note: '询盘引导文案', privacy_note: '隐私合规文案',
        customer_name_required_label: '', customer_email_required_label: '',
        thumbnail_background_color: '缩略图背景色', thumbnail_part_color: '缩略图零件色',
        thumbnail_width: '缩略图宽度', thumbnail_height: '缩略图高度',
    };

    function loadSettings(scope) {
        var container = document.getElementById('settings-content');
        if (!container) return;
        container.innerHTML = '<p>加载中...</p>';
        var url = site ? '/api/admin/settings?scope=' + encodeURIComponent('quote:' + site) : '/api/admin/settings';
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
            var items = data.settings || [];
            // Filter to only show quote:site scope items
            var scopePrefix = 'quote:' + site;
            items = items.filter(function (s) { return s.scope === scopePrefix; });

            // Group by functional category
            var groups = {
                'quote_entry': { title: '报价入口与 CTA', keys: ['formal_quote_url','formal_quote_label','engineer_contact_url','engineer_contact_label'] },
                'quote_text': { title: '报价结果文案', keys: ['disclaimer_template','contact_note','privacy_note'] },
                'quote_form': { title: '表单规则', keys: ['customer_name_required','customer_email_required','allowed_extensions'] },
                'watermark': { title: '预览水印', keys: ['preview_watermark_text','preview_watermark_opacity','preview_watermark_color','preview_watermark_angle','preview_watermark_spacing','preview_watermark_font_scale'] },
                'thumbnail': { title: '缩略图风格', keys: ['thumbnail_background_color','thumbnail_part_color','thumbnail_width','thumbnail_height'] },
                'other': { title: '其他', keys: [] }
            };

            var grouped = {};
            items.forEach(function (s) {
                var placed = false;
                for (var gk in groups) {
                    if (groups[gk].keys.indexOf(s.key) >= 0) {
                        if (!grouped[gk]) grouped[gk] = [];
                        grouped[gk].push(s);
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    if (!grouped['other']) grouped['other'] = [];
                    grouped['other'].push(s);
                }
            });

            container.innerHTML = '';
            for (var gk in groups) {
                var gItems = grouped[gk] || [];
                if (!gItems.length) continue;
                var cards = gItems.map(function (s) {
                    var label = settingLabels[s.key] || s.key;
                    return '<div class="admin-form-group">' +
                        '<label>' + esc(label) + (s.description ? '<br><small style="color:#9ca3af">' + esc(s.description) + '</small>' : '') + '</label>' +
                        renderSettingControl(s) +
                        '<button data-admin-save data-admin-save-scope="' + s.scope + '" data-admin-save-key="' + s.key + '" style="margin-top:.35rem;">保存</button>' +
                        '</div>';
                }).join('');
                container.innerHTML += '<h3 style="margin:1.25rem 0 .5rem;font-size:14px;color:#6b7280;">' + groups[gk].title + '</h3><div class="admin-form">' + cards + '</div>';
            }
        }).catch(function () { container.innerHTML = '<p>加载设置失败</p>'; });
    }

    /* ── 导航 ── */
    document.querySelector('[data-nav="inquiries"]') && document.querySelector('[data-nav="inquiries"]').addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector('.admin-main').innerHTML = renderInquiriesPage();
        bindInquiriesEvents();
        loadInquiries();
    });

    document.querySelector('[data-nav="settings"]') && document.querySelector('[data-nav="settings"]').addEventListener('click', function (e) {
        e.preventDefault();
        var main = document.querySelector('.admin-main');
        main.innerHTML = '<h2>系统设置</h2>' +
            '<div class="admin-tabs" id="site-tabs"><button data-site="default" class="active">默认站点</button><button data-site="mfg">MFG Solution</button><button data-site="gcindus">GC INDUS</button><button data-site="gcnov">GCNOV</button></div>' +
            '<div id="settings-content"><p>加载中...</p></div>';
        loadSettings('default');
        document.querySelectorAll('#site-tabs button').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('#site-tabs button').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                loadSettings(btn.dataset.site);
            });
        });
    });

    document.querySelector('[data-nav="system"]') && document.querySelector('[data-nav="system"]').addEventListener('click', function (e) {
        e.preventDefault();
        var main = document.querySelector('.admin-main');
        main.innerHTML = '<h2>系统状态</h2><p>加载中...</p>';
        fetch('/api/admin/system/health').then(function (r) { return r.json(); }).then(function (h) {
            main.innerHTML = '<h2>系统状态</h2>' +
                '<div class="admin-stats">' +
                '<div class="admin-stat-card"><span class="admin-stat-label">数据库大小</span><span class="admin-stat-value">' + h.db_size_mb + ' MB</span></div>' +
                '<div class="admin-stat-card"><span class="admin-stat-label">询盘总数</span><span class="admin-stat-value">' + h.total_inquiries + '</span></div>' +
                '<div class="admin-stat-card"><span class="admin-stat-label">上传文件</span><span class="admin-stat-value">' + h.uploads.files + ' 个 / ' + h.uploads.size_mb + ' MB</span></div>' +
                '<div class="admin-stat-card"><span class="admin-stat-label">缩略图</span><span class="admin-stat-value">' + h.thumbnails.files + ' 个 / ' + h.thumbnails.size_mb + ' MB</span></div>' +
                '<div class="admin-stat-card"><span class="admin-stat-label">STL 文件</span><span class="admin-stat-value">' + h.stl_files.files + ' 个 / ' + h.stl_files.size_mb + ' MB</span></div>' +
                '<div class="admin-stat-card"><span class="admin-stat-label">最新询盘</span><span class="admin-stat-value" style="font-size:13px">' + h.latest_inquiry + '</span></div>' +
                '</div>' +
                '<div class="admin-form" style="margin-top:1rem">' +
                '<p style="margin-bottom:.5rem;font-size:13px;color:#6b7280">数据库路径: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">' + esc(h.db_path) + '</code></p>' +
                '<p style="font-size:13px;color:#6b7280">API 状态: <span style="color:#059669;font-weight:600">' + h.api_status + '</span></p>' +
                '</div>';
        }).catch(function () { main.innerHTML = '<h2>系统状态</h2><p>加载失败</p>'; });
    });

    document.querySelector('[data-nav="audit"]') && document.querySelector('[data-nav="audit"]').addEventListener('click', function (e) {
        e.preventDefault();
        var main = document.querySelector('.admin-main');
        main.innerHTML = '<h2>操作日志</h2><p>加载中...</p>';
        fetch('/api/admin/audit-logs').then(function (r) { return r.json(); }).then(function (data) {
            var logs = data.logs || [];
            var badgeLabels = { login: '登录', logout: '退出', update_setting: '修改设置', export_csv: '导出CSV', login_failed: '登录失败', change_password: '修改密码' };
            main.innerHTML = '<h2>操作日志</h2>' +
                '<div class="admin-table-wrap"><table class="admin-table">' +
                '<thead><tr><th>时间</th><th>用户</th><th>操作</th><th>对象</th><th>旧值</th><th>新值</th></tr></thead>' +
                '<tbody>' + (logs.length ? logs.map(function (l) { return '<tr>' +
                    '<td>' + (l.created_at ? l.created_at.slice(0, 16).replace('T', ' ') : '-') + '</td>' +
                    '<td>' + esc(l.admin_username || '-') + '</td>' +
                    '<td><span class="admin-badge ' + l.action + '">' + esc(badgeLabels[l.action] || l.action) + '</span></td>' +
                    '<td>' + esc(l.target_key || '-') + '</td>' +
                    '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.old_value || '-') + '</td>' +
                    '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.new_value || '-') + '</td>' +
                    '</tr>'; }).join('') : '<tr><td colspan="6" class="admin-empty">暂无操作日志</td></tr>') + '</tbody>' +
                '</table></div>';
        }).catch(function () { main.innerHTML = '<h2>操作日志</h2><p>加载失败</p>'; });
    });

    document.querySelector('[data-nav="account"]') && document.querySelector('[data-nav="account"]').addEventListener('click', function (e) {
        e.preventDefault();
        var main = document.querySelector('.admin-main');
        main.innerHTML = '<h2>账户设置</h2>' +
            '<div class="admin-form" style="max-width:400px">' +
            '<p style="font-size:13px;color:#d97706;background:#fffbeb;padding:.5rem .75rem;border-radius:6px;margin-bottom:1rem">请勿使用默认密码 admin123。建议修改为高强度密码。</p>' +
            '<div class="admin-form-group"><label>当前密码</label><input type="password" id="pw-current"></div>' +
            '<div class="admin-form-group"><label>新密码（至少 6 个字符）</label><input type="password" id="pw-new"></div>' +
            '<div class="admin-form-group"><label>确认新密码</label><input type="password" id="pw-confirm"></div>' +
            '<div id="pw-strength" style="margin-bottom:.5rem;font-size:12px"></div>' +
            '<button id="pw-save">修改密码</button><div id="pw-msg" style="margin-top:.5rem;font-size:13px"></div></div>';

        document.getElementById('pw-new').addEventListener('input', function () {
            var v = this.value, s = document.getElementById('pw-strength');
            if (!v) { s.textContent = ''; return; }
            var score = 0;
            if (v.length >= 8) score++;
            if (v.length >= 12) score++;
            if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
            if (/\d/.test(v)) score++;
            if (/[^a-zA-Z0-9]/.test(v)) score++;
            var levels = ['弱', '弱', '中', '中', '强', '强'];
            var colors = ['#dc2626','#dc2626','#d97706','#d97706','#059669','#059669'];
            s.textContent = '密码强度: ' + (levels[score] || '强');
            s.style.color = colors[score] || '#059669';
        });

        document.getElementById('pw-save').addEventListener('click', function () {
            var current = document.getElementById('pw-current').value;
            var np = document.getElementById('pw-new').value;
            var cf = document.getElementById('pw-confirm').value;
            var msg = document.getElementById('pw-msg');
            if (np !== cf) { msg.textContent = '两次输入的密码不一致'; msg.style.color = '#dc2626'; return; }
            if (np.length < 6) { msg.textContent = '新密码至少需要 6 个字符'; msg.style.color = '#dc2626'; return; }
            fetch('/api/admin/password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: current, new: np }) })
                .then(function (r) { return r.json(); }).then(function (d) {
                    msg.textContent = d.ok ? '密码已修改，建议重新登录以确保安全' : (d.error || '修改失败');
                    msg.style.color = d.ok ? '#059669' : '#dc2626';
                }).catch(function () { msg.textContent = '网络错误'; msg.style.color = '#dc2626'; });
        });
    });
})();
