/* Order Portal v4 */
(function () {
    window.DaiyujinAPI.checkHealth();

    var mediaObjectUrls = [];

    var form = document.querySelector('[data-login-form]');
    var btn = document.querySelector('[data-login-btn]');
    var error = document.querySelector('[data-login-error]');
    var main = document.querySelector('[data-portal-main]');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var email = document.getElementById('login-email').value.trim();
        var password = document.getElementById('login-password').value;
        if (!email || !password) { showError('Please enter your email and password.'); return; }
        btn.disabled = true; btn.textContent = 'Signing in...'; error.hidden = true;
        try {
            var resp = await window.DaiyujinAPI.request('/api/portal/auth/login', { method: 'POST', body: JSON.stringify({ email: email, password: password }) });
            if (!resp.token) throw new Error('No token returned');
            sessionStorage.setItem('portal_token', resp.token);
            sessionStorage.setItem('portal_user', JSON.stringify(resp.user));
            loadOrders();
        } catch (err) { showError(err.message || 'Login failed.'); }
        btn.disabled = false; btn.textContent = 'Sign In';
    });

    function showError(msg) { error.textContent = msg; error.hidden = false; }

    window.portalLogout = async function () {
        var token = sessionStorage.getItem('portal_token');
        if (token) {
            try { await fetch(window.DaiyujinAPI.config.baseUrl + '/api/portal/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }); } catch (e) {}
        }
        sessionStorage.clear();
        location.reload();
    };

    var stageLabels = {
        order_confirmed: 'Order Confirmed', material_purchasing: 'Material Purchasing',
        material_ready: 'Material Ready', machining: 'CNC Machining',
        in_process_qc: 'In-process QC', surface_treatment: 'Surface Treatment',
        final_inspection: 'Final Inspection', packing: 'Packing',
        shipped: 'Shipped', delivered: 'Delivered', on_hold: 'On Hold'
    };

    async function loadOrders(token) {
        token = token || sessionStorage.getItem('portal_token');
        try {
            var resp = await fetch(window.DaiyujinAPI.config.baseUrl + '/api/portal/orders', { headers: { 'Authorization': 'Bearer ' + token } }).then(function (r) { return r.json(); });
            var user = JSON.parse(sessionStorage.getItem('portal_user') || '{}');
            main.innerHTML = '<div class="portal-user-bar"><span>' + esc(user.display_name || user.email) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
                '<div class="portal-dashboard">' + (resp.orders && resp.orders.length ? resp.orders.map(renderOrderCard).join('') : '<div class="portal-empty">No orders yet.</div>') + '</div>';
        } catch (e) { main.innerHTML = '<div class="portal-dashboard"><div class="portal-empty">Unable to load orders.</div></div>'; }
    }

    function renderOrderCard(order) {
        return '<div class="portal-order-card" style="cursor:pointer" onclick="showOrderDetail(' + order.id + ')">' +
            '<h3>' + esc(order.title || 'Order #' + order.order_no) + '</h3>' +
            '<div class="portal-order-meta">' +
            '<span>Stage: <span class="portal-badge active">' + esc(order.current_stage || 'N/A') + '</span></span>' +
            '<span>Delivery: ' + esc(order.estimated_delivery_date || 'TBD') + '</span>' +
            '<span>Updated: ' + esc(order.updated_at || '-') + '</span></div></div>';
    }

    window.showOrderDetail = async function (orderId) {
        var token = sessionStorage.getItem('portal_token');
        main.innerHTML = '<p>Loading...</p>';
        try {
            var results = await Promise.all([
                fetch(window.DaiyujinAPI.config.baseUrl + '/api/portal/orders/' + orderId, { headers: { 'Authorization': 'Bearer ' + token } }).then(function (r) { return r.json(); }),
                fetch(window.DaiyujinAPI.config.baseUrl + '/api/portal/orders/' + orderId + '/updates', { headers: { 'Authorization': 'Bearer ' + token } }).then(function (r) { return r.json(); }),
                fetch(window.DaiyujinAPI.config.baseUrl + '/api/portal/orders/' + orderId + '/media', { headers: { 'Authorization': 'Bearer ' + token } }).then(function (r) { return r.json(); }),
            ]);
            var o = results[0].order, updates = results[1].updates || [], media = results[2].media || [];
            var user = JSON.parse(sessionStorage.getItem('portal_user') || '{}');

            main.innerHTML =
                '<div class="portal-user-bar"><button onclick="loadOrders()" style="border:none;background:none;color:var(--accent);cursor:pointer;font:inherit;font-size:13px">&larr; Back</button><span>' + esc(user.display_name || user.email) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
                '<div class="portal-order-detail">' +
                '<h2>' + esc(o.title) + '</h2>' +
                '<div class="portal-order-meta" style="margin-bottom:1rem">' +
                '<span>Order #: ' + esc(o.order_no) + '</span>' +
                '<span>Status: <span class="portal-badge ' + (o.status === 'active' ? 'active' : 'shipped') + '">' + esc(o.status) + '</span></span>' +
                '<span>Delivery: ' + esc(o.estimated_delivery_date || 'TBD') + '</span></div>' +
                (o.customer_visible_note ? '<div class="portal-note-card">' + esc(o.customer_visible_note) + '</div>' : '') +
                '<h3 style="margin:1rem 0 .5rem">Progress Timeline</h3>' +
                '<div class="portal-timeline">' + (updates.length ? updates.map(renderTimelineItem).join('') : '<div class="portal-empty">No updates yet.</div>') + '</div>' +
                '<h3 style="margin:1rem 0 .5rem">Photos</h3>' +
                '<div class="portal-media-grid" id="media-grid">' + (media.length ? '<div class="portal-empty">Loading photos...</div>' : '<div class="portal-empty">No photos uploaded yet.</div>') + '</div></div>';

            if (media.length) loadMediaImages(orderId, media);
        } catch (e) { main.innerHTML = '<p>Unable to load order details.</p>'; }
    };

    function renderTimelineItem(u) {
        var label = stageLabels[u.stage_key] || u.stage_key || 'Update';
        return '<div class="portal-timeline-item"><div class="portal-timeline-dot"></div><div class="portal-timeline-content">' +
            '<strong>' + esc(u.title || label) + '</strong>' + (u.progress_percent ? ' (' + u.progress_percent + '%)' : '') +
            (u.message ? '<p style="margin-top:.25rem;color:var(--muted);font-size:13px">' + esc(u.message) + '</p>' : '') +
            '<small style="color:var(--muted)">' + (u.created_at ? u.created_at.slice(0, 16).replace('T', ' ') : '') + '</small></div></div>';
    }

    async function loadMediaImages(orderId, media) {
        var token = sessionStorage.getItem('portal_token');
        var base = window.DaiyujinAPI.config.baseUrl;
        var grid = document.getElementById('media-grid');
        if (!grid) return;
        grid.innerHTML = '';
        for (var i = 0; i < media.length; i++) {
            var m = media[i];
            try {
                var resp = await fetch(base + '/api/portal/orders/' + orderId + '/media/' + m.id, { headers: { 'Authorization': 'Bearer ' + token } });
                if (!resp.ok) continue;
                var blob = await resp.blob();
                var url = URL.createObjectURL(blob);
                var div = document.createElement('div');
                div.className = 'portal-media-item';
                var img = document.createElement('img');
                img.src = url;
                img.alt = m.caption || m.filename || '';
                img.loading = 'lazy';
                div.appendChild(img);
                if (m.caption) { var cap = document.createElement('small'); cap.textContent = m.caption; div.appendChild(cap); }
                grid.appendChild(div);
            } catch (e) {}
        }
        if (!grid.children.length) { grid.innerHTML = '<div class="portal-empty">No photos available.</div>'; }
    }

    function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }
})();
