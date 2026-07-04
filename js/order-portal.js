/* Order Portal v4.5 — customer + sales workspace */
(function () {
    window.DaiyujinAPI.checkHealth();

    var form = document.querySelector('[data-login-form]');
    var btn = document.querySelector('[data-login-btn]');
    var error = document.querySelector('[data-login-error]');
    var main = document.querySelector('[data-portal-main]');
    if (!form) return;

    var mediaObjectUrls = [];

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
            var role = resp.user.role;
            if (role === 'sales' || role === 'admin') { showSalesWorkspace(); }
            else { showCustomerDashboard(); }
        } catch (err) { showError(err.message || 'Login failed.'); }
        btn.disabled = false; btn.textContent = 'Sign In';
    });

    function showError(msg) { error.textContent = msg; error.hidden = false; }
    var token = function () { return sessionStorage.getItem('portal_token'); };
    function enterAppMode() { document.body.classList.add('portal-authenticated'); }
    var api = function (path, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        opts.headers['Authorization'] = 'Bearer ' + token();
        if (opts.body && !(opts.body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
        }
        return fetch(window.DaiyujinAPI.config.baseUrl + path, opts)
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (payload) {
                    if (!r.ok || payload.error === true) {
                        throw new Error(payload.message || ('Request failed with ' + r.status));
                    }
                    return payload;
                });
            });
    };
    var user = function () { return JSON.parse(sessionStorage.getItem('portal_user') || '{}'); };

    
    window.showCustomerDashboard = showCustomerDashboard;
    window.showSalesWorkspace = showSalesWorkspace;
    window.showSalesOrders = showSalesOrders;
    window.showSalesCustomers = showSalesCustomers;
    window.showCreateCustomer = showCreateCustomer;
    window.showCreateOrder = showCreateOrder;
    window.clearMediaUrls = clearMediaUrls;

    window.portalLogout = async function () {
        try { await api('/api/portal/auth/logout', { method: 'POST' }); } catch (e) {}
        sessionStorage.clear(); document.body.classList.remove('portal-authenticated'); location.reload();
    };

    function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

    var stageLabels = { order_confirmed: 'Order Confirmed', material_purchasing: 'Material Purchasing', material_ready: 'Material Ready', machining: 'CNC Machining', in_process_qc: 'In-process QC', surface_treatment: 'Surface Treatment', final_inspection: 'Final Inspection', packing: 'Packing', shipped: 'Shipped', delivered: 'Delivered', on_hold: 'On Hold' };

    /* ══════════════════════════════════════════════════
       Customer Dashboard
       ══════════════════════════════════════════════════ */

    async function showCustomerDashboard() { clearMediaUrls();
        try {
            var resp = await api('/api/portal/orders');
            var u = user();
            main.innerHTML = '<div class="portal-user-bar"><span>' + esc(u.display_name || u.email) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
                '<div class="portal-dashboard">' + (resp.orders && resp.orders.length ? resp.orders.map(renderOrderCard).join('') : '<div class="portal-empty">No orders yet.</div>') + '</div>';
        } catch (e) { main.innerHTML = '<div class="portal-empty">Unable to load orders.</div>'; }
    }

    function renderOrderCard(order) {
        return '<div class="portal-order-card" style="cursor:pointer" onclick="showOrderDetail(' + order.id + ')">' +
            '<h3>' + esc(order.title || 'Order #' + order.order_no) + '</h3>' +
            '<div class="portal-order-meta"><span>Stage: <span class="portal-badge active">' + esc(order.current_stage || 'N/A') + '</span></span>' +
            '<span>Delivery: ' + esc(order.estimated_delivery_date || 'TBD') + '</span><span>' + esc(order.updated_at || '-') + '</span></div></div>';
    }

    /* ══════════════════════════════════════════════════
       Sales Workspace
       ══════════════════════════════════════════════════ */

    function showSalesWorkspace() { clearMediaUrls(); showSalesOrders(); }

    async function showSalesOrders() {
        var u = user();
        try {
            var resp = await api('/api/portal/orders');
            var orders = resp.orders || [];
            main.innerHTML = '<div class="portal-user-bar"><span>Sales: ' + esc(u.display_name || u.email) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
                '<div class="portal-sales-tabs"><button class="active" onclick="showSalesOrders()">My Orders</button><button onclick="showSalesCustomers()">Customers</button><button onclick="showCreateCustomer()">+ New Customer</button><button onclick="showCreateOrder()">+ New Order</button></div>' +
                '<div class="portal-dashboard">' + (orders.length ? orders.map(renderSalesOrderCard).join('') : '<div class="portal-empty">No orders yet. Create a customer first, then create an order.</div>') + '</div>';
        } catch (e) { main.innerHTML = '<div class="portal-empty">Unable to load.</div>'; }
    }

    function renderSalesOrderCard(order) {
        return '<div class="portal-order-card" style="cursor:pointer" onclick="showSalesOrderDetail(' + order.id + ')">' +
            '<h3>' + esc(order.title || 'Order #' + order.order_no) + '</h3>' +
            '<div class="portal-order-meta"><span>Stage: <span class="portal-badge active">' + esc(order.current_stage || 'N/A') + '</span></span>' +
            '<span>Delivery: ' + esc(order.estimated_delivery_date || 'TBD') + '</span><span>' + esc(order.updated_at || '-') + '</span></div></div>';
    }

    async function showSalesCustomers() {
        try {
            var resp = await api('/api/portal/sales/customers');
            var customers = resp.customers || [];
            main.innerHTML = '<div class="portal-user-bar"><span>' + esc(user().display_name) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
                '<div class="portal-sales-tabs"><button onclick="showSalesOrders()">My Orders</button><button class="active" onclick="showSalesCustomers()">Customers</button><button onclick="showCreateCustomer()">+ New Customer</button><button onclick="showCreateOrder()">+ New Order</button></div>' +
                '<div class="portal-dashboard">' + (customers.length ? customers.map(function (c) {
                    return '<div class="portal-order-card"><h3>' + esc(c.display_name || c.email) + '</h3><div class="portal-order-meta"><span>' + esc(c.email) + '</span><span>' + esc(c.company_name || '-') + '</span><span>' + esc(c.status) + '</span></div></div>';
                }).join('') : '<div class="portal-empty">No customers yet.</div>') + '</div>';
        } catch (e) { main.innerHTML = '<div class="portal-empty">Unable to load.</div>'; }
    }

    function showCreateCustomer() {
        main.innerHTML = '<div class="portal-user-bar"><button onclick="showSalesCustomers()" style="border:none;background:none;color:var(--accent);cursor:pointer;font:inherit;font-size:13px">&larr; Back</button><span>' + esc(user().display_name) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
            '<div class="portal-form-card"><h2>Create Customer</h2>' +
            '<div class="portal-field"><label>Email</label><input id="new-cust-email" type="email" placeholder="customer@example.com"></div>' +
            '<div class="portal-field"><label>Display Name</label><input id="new-cust-name" type="text" placeholder="John Smith"></div>' +
            '<div class="portal-field"><label>Company</label><input id="new-cust-company" type="text" placeholder="Optional"></div>' +
            '<div class="portal-error" id="cust-error" hidden></div>' +
            '<button class="portal-btn" onclick="createCustomer()">Create Customer</button></div>';
    }

    window.createCustomer = async function () {
        var email = document.getElementById('new-cust-email').value.trim();
        var name = document.getElementById('new-cust-name').value.trim();
        var company = document.getElementById('new-cust-company').value.trim();
        var err = document.getElementById('cust-error');
        if (!email) { err.textContent = 'Email is required.'; err.hidden = false; return; }
        try {
            var resp = await api('/api/portal/sales/customers', { method: 'POST', body: JSON.stringify({ email: email, display_name: name, company_name: company }) });
            if (resp.error) { err.textContent = resp.message; err.hidden = false; return; }
            alert('Customer created! Initial password: ' + (resp.initial_password || '(already exists)'));
            showSalesCustomers();
        } catch (e) { err.textContent = 'Failed to create customer.'; err.hidden = false; }
    };

    function showCreateOrder() {
        main.innerHTML = '<div class="portal-user-bar"><button onclick="showSalesOrders()" style="border:none;background:none;color:var(--accent);cursor:pointer;font:inherit;font-size:13px">&larr; Back</button><span>' + esc(user().display_name) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
            '<div class="portal-form-card"><h2>Create Order</h2>' +
            '<div class="portal-field"><label>Customer Email</label><input id="new-order-email" type="email" placeholder="customer@example.com"></div>' +
            '<div class="portal-field"><label>Title / Part Name</label><input id="new-order-title" type="text" placeholder="Widget Assembly"></div>' +
            '<div class="portal-field"><label>PO Number</label><input id="new-order-po" type="text" placeholder="Optional"></div>' +
            '<div class="portal-error" id="order-error" hidden></div>' +
            '<button class="portal-btn" onclick="createOrder()">Create Order</button></div>';
    }

    window.createOrder = async function () {
        var email = document.getElementById('new-order-email').value.trim();
        var title = document.getElementById('new-order-title').value.trim();
        var po = document.getElementById('new-order-po').value.trim();
        var err = document.getElementById('order-error');
        if (!email || !title) { err.textContent = 'Email and title are required.'; err.hidden = false; return; }
        try {
            var body = { customer_email: email, title: title };
            if (po) body.po_number = po;
            var resp = await api('/api/portal/sales/orders', { method: 'POST', body: JSON.stringify(body) });
            if (resp.error) { err.textContent = resp.message; err.hidden = false; return; }
            showSalesOrders();
        } catch (e) { err.textContent = 'Failed to create order.'; err.hidden = false; }
    };

    /* ══════════════════════════════════════════════════
       Order Detail (shared)
       ══════════════════════════════════════════════════ */

    window.showOrderDetail = showCustomerOrderDetail;
    window.showSalesOrderDetail = showSalesOrderDetail;

    async function showCustomerOrderDetail(orderId) {
        main.innerHTML = '<p>Loading...</p>';
        try {
            var results = await Promise.all([
                api('/api/portal/orders/' + orderId), api('/api/portal/orders/' + orderId + '/updates'), api('/api/portal/orders/' + orderId + '/media')
            ]);
            var o = results[0].order, updates = results[1].updates || [], messages = results[2].messages || [], media = results[3].media || [];
            renderOrderDetail(o, updates, messages, media, false);
        } catch (e) { main.innerHTML = '<p>Unable to load order details.</p>'; }
    }

    async function showSalesOrderDetail(orderId) {
        main.innerHTML = '<p>Loading...</p>';
        try {
            var results = await Promise.all([
                api('/api/portal/orders/' + orderId), api('/api/portal/orders/' + orderId + '/updates'), api('/api/portal/orders/' + orderId + '/media')
            ]);
            var o = results[0].order, updates = results[1].updates || [], messages = results[2].messages || [], media = results[3].media || [];
            renderOrderDetail(o, updates, messages, media, true);
        } catch (e) { main.innerHTML = '<p>Unable to load order details.</p>'; }
    }

    function renderOrderDetail(o, updates, messages, media, isSales) { enterAppMode();
        var backFn = isSales ? 'showSalesOrders()' : 'showCustomerDashboard()';
        var base = window.DaiyujinAPI.config.baseUrl;
        main.innerHTML =
            '<div class="portal-user-bar"><button onclick="' + backFn + '" style="border:none;background:none;color:var(--accent);cursor:pointer;font:inherit;font-size:13px">&larr; Back</button><span>' + esc(user().display_name || user().email) + '</span><button onclick="portalLogout()">Sign Out</button></div>' +
            '<div class="portal-order-detail">' +
            '<h2>' + esc(o.title) + '</h2>' +
            '<div class="portal-order-meta" style="margin-bottom:1rem">' +
            '<span>Order #: ' + esc(o.order_no) + '</span>' +
            '<span>Status: <span class="portal-badge ' + (o.status === 'active' ? 'active' : 'shipped') + '">' + esc(o.status) + '</span></span>' +
            '<span>Delivery: ' + esc(o.estimated_delivery_date || 'TBD') + '</span></div>' +
            (o.customer_visible_note ? '<div class="portal-note-card">' + esc(o.customer_visible_note) + '</div>' : '') +
            (isSales ? renderSalesActions(o.id) : '') +
            '<h3 style="margin:1rem 0 .5rem">Progress Timeline</h3>' +
            '<div class="portal-timeline">' + (updates.length ? updates.map(renderTimelineItem).join('') : '<div class="portal-empty">No updates yet.</div>') + '</div>' +
            '<h3 style="margin:1rem 0 .5rem">Messages</h3>' + renderMessages(messages, isSales, o.id) + '<h3 style="margin:1rem 0 .5rem">Photos</h3>' +
            '<div class="portal-media-grid" id="media-grid">' + (media.length ? '<div class="portal-empty">Loading photos...</div>' : '<div class="portal-empty">No photos yet.</div>') + '</div></div>';

        if (media.length) loadAuthorizedImages(o.id, media);
    }

    function renderSalesActions(orderId) {
        return '<div class="portal-sales-actions">' +
            '<h4 style="margin:.5rem 0">Update Stage</h4>' +
            '<select id="update-stage" style="margin-right:.5rem;padding:.3rem">' + Object.keys(stageLabels).map(function (k) { return '<option value="' + k + '">' + stageLabels[k] + '</option>'; }).join('') + '</select>' +
            '<button class="portal-btn" style="width:auto;padding:.3rem .75rem" onclick="updateOrderStage(' + orderId + ')">Update</button>' +
            '<h4 style="margin:1rem 0 .25rem">Add Progress Update</h4>' +
            '<input id="update-title" type="text" placeholder="Title" style="width:100%;margin-bottom:.25rem;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit">' +
            '<input id="update-msg" type="text" placeholder="Message (optional)" style="width:100%;margin-bottom:.25rem;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit">' +
            '<input id="update-pct" type="number" min="0" max="100" placeholder="Progress %" style="width:80px;margin-bottom:.25rem;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit">' +
            '<label style="font-size:12px;margin-left:.5rem"><input type="checkbox" id="update-public" checked> Visible to customer</label>' +
            '<button class="portal-btn" style="width:auto;padding:.3rem .75rem;margin-left:.5rem" onclick="addProgressUpdate(' + orderId + ')">Add Update</button>' +
            '<h4 style="margin:1rem 0 .25rem">Upload Photo</h4>' +
            '<input type="file" id="upload-file" accept="image/*" style="margin-bottom:.25rem">' +
            '<input id="upload-caption" type="text" placeholder="Caption (optional)" style="width:100%;margin-bottom:.25rem;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit">' +
            '<label style="font-size:12px"><input type="checkbox" id="upload-public" checked> Visible to customer</label>' +
            '<button class="portal-btn" style="width:auto;padding:.3rem .75rem;margin-left:.5rem" onclick="uploadPhoto(' + orderId + ')">Upload</button>' +
            '</div>';
    }

    window.updateOrderStage = async function (orderId) {
        var stage = document.getElementById('update-stage').value;
        try {
            await api('/api/portal/sales/orders/' + orderId, { method: 'PATCH', body: JSON.stringify({ current_stage: stage }) });
            showSalesOrderDetail(orderId);
        } catch (e) { alert('Failed to update stage.'); }
    };

    window.addProgressUpdate = async function (orderId) {
        var title = document.getElementById('update-title').value.trim();
        var msg = document.getElementById('update-msg').value.trim();
        var pct = document.getElementById('update-pct').value;
        var pub = document.getElementById('update-public').checked;
        if (!title) { alert('Title is required.'); return; }
        try {
            var body = { title: title, message: msg || null, visible_to_customer: pub };
            if (pct) body.progress_percent = parseInt(pct);
            await api('/api/portal/sales/orders/' + orderId + '/updates', { method: 'POST', body: JSON.stringify(body) });
            showSalesOrderDetail(orderId);
        } catch (e) { alert('Failed to add update.'); }
    };

    window.uploadPhoto = async function (orderId) {
        var fileEl = document.getElementById('upload-file');
        var file = fileEl.files[0];
        if (!file) { alert('Select a file first.'); return; }
        var caption = document.getElementById('upload-caption').value.trim();
        var pub = document.getElementById('upload-public').checked;
        var fd = new FormData();
        fd.append('file', file);
        if (caption) fd.append('caption', caption);
        fd.append('visible_to_customer', pub ? '1' : '0');
        try {
            await api('/api/portal/sales/orders/' + orderId + '/media', { method: 'POST', body: fd });
            showSalesOrderDetail(orderId);
        } catch (e) { alert('Upload failed.'); }
    };

    /* ══════════════════════════════════════════════════
       Media loading
       ══════════════════════════════════════════════════ */

    async function loadAuthorizedImages(orderId, media) {
        var grid = document.getElementById('media-grid');
        if (!grid) return;
        var frag = document.createDocumentFragment();
        for (var i = 0; i < media.length; i++) {
            var m = media[i];
            try {
                var blob = await fetch(window.DaiyujinAPI.config.baseUrl + '/api/portal/orders/' + orderId + '/media/' + m.id, { headers: { 'Authorization': 'Bearer ' + token() } }).then(function (r) { return r.blob(); });
                var url = URL.createObjectURL(blob);
                mediaObjectUrls.push(url);
                var item = document.createElement('div');
                item.className = 'portal-media-item';
                item.innerHTML = '<img src="' + url + '" alt="' + esc(m.caption || m.filename) + '"><small>' + esc(m.caption || '') + '</small>';
                frag.appendChild(item);
            } catch (e) {}
        }
        grid.innerHTML = '';
        grid.appendChild(frag);
        if (!grid.children.length) { grid.innerHTML = '<div class="portal-empty">No photos available.</div>'; }
    }

    window.addEventListener('beforeunload', function () { mediaObjectUrls.forEach(function (u) { URL.revokeObjectURL(u); }); });

    function clearMediaUrls() { mediaObjectUrls.forEach(function (u) { URL.revokeObjectURL(u); }); mediaObjectUrls = []; }

        /* ── Messages UI ── */
    function renderMessages(messages, isSales, orderId) {
        var h = "<h3 style=\"margin:1rem 0 .5rem\">Messages</h3>";
        if (messages && messages.length) {
            h += "<div class=\"portal-messages\">" + messages.map(function (m) {
                var rep = !!m.parent_message_id;
                return "<div class=\"portal-msg" + (rep ? " portal-msg-reply" : "") + "\">" +
                    "<div class=\"portal-msg-head\"><strong>" + esc(m.sender_name) + "</strong><small>" + (m.created_at ? m.created_at.slice(0,16).replace("T"," ") : "") + "</small></div>" +
                    "<p>" + esc(m.message) + "</p>" +
                    (isSales && !rep ? "<button class=\"portal-btn\" style=\"width:auto;padding:.2rem .6rem;font-size:12px\" onclick=\"window.showReplyForm(" + orderId + "," + m.id + ",event)\">Reply</button>" : "") +
                    "</div>";
            }).join("") + "</div>";
        } else {
            h += "<div class=\"portal-empty\">No messages yet.</div>";
        }
        h += "<div class=\"portal-msg-form\"><textarea id=\"msg-text\" placeholder=\"Write a message...\" rows=\"2\" style=\"width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit;font-size:13px\"></textarea>" +
            "<button class=\"portal-btn\" style=\"width:auto;padding:.3rem .75rem;margin-top:.25rem\" onclick=\"window.sendMessage(" + orderId + ")\">Send</button></div>";
        return h;
    }

    window.sendMessage = async function (orderId) {
        var text = document.getElementById("msg-text").value.trim();
        if (!text) { alert("Message cannot be empty."); return; }
        try {
            await api("/api/portal/orders/" + orderId + "/messages", { method: "POST", body: JSON.stringify({ message: text }) });
            if (user().role === "sales" || user().role === "admin") showSalesOrderDetail(orderId);
            else showCustomerOrderDetail(orderId);
        } catch (e) { alert("Failed to send message."); }
    };

    window.showReplyForm = function (orderId, msgId, evt) {
        var old = document.getElementById("reply-form");
        if (old) old.remove();
        var row = evt.target.closest(".portal-msg");
        var div = document.createElement("div");
        div.id = "reply-form"; div.className = "portal-msg-form portal-msg-reply"; div.style.marginLeft = "2rem";
        div.innerHTML = "<textarea id=\"reply-text\" placeholder=\"Reply...\" rows=\"2\" style=\"width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit;font-size:13px\"></textarea>" +
            "<button class=\"portal-btn\" style=\"width:auto;padding:.3rem .75rem;margin-top:.25rem\" onclick=\"window.sendReply(" + orderId + "," + msgId + ")\">Reply</button>";
        row.parentNode.insertBefore(div, row.nextSibling);
    };

    window.sendReply = async function (orderId, msgId) {
        var text = document.getElementById("reply-text").value.trim();
        if (!text) { alert("Reply cannot be empty."); return; }
        try {
            await api("/api/portal/sales/orders/" + orderId + "/messages/" + msgId + "/reply", { method: "POST", body: JSON.stringify({ message: text }) });
            showSalesOrderDetail(orderId);
        } catch (e) { alert("Failed to send reply."); }
    };

    /* ═══ Helpers ═══ */
    var stageLabels = { order_confirmed: 'Order Confirmed', material_purchasing: 'Material Purchasing', material_ready: 'Material Ready', machining: 'CNC Machining', in_process_qc: 'In-process QC', surface_treatment: 'Surface Treatment', final_inspection: 'Final Inspection', packing: 'Packing', shipped: 'Shipped', delivered: 'Delivered', on_hold: 'On Hold' };

    function renderTimelineItem(u) {
        var label = stageLabels[u.stage_key] || u.stage_key || 'Update';
        return '<div class="portal-timeline-item"><div class="portal-timeline-dot"></div><div class="portal-timeline-content"><strong>' + esc(u.title || label) + '</strong>' + (u.progress_percent ? ' (' + u.progress_percent + '%)' : '') + (u.message ? '<p style="margin-top:.25rem;color:var(--muted);font-size:13px">' + esc(u.message) + '</p>' : '') + '<small style="color:var(--muted)">' + (u.created_at ? u.created_at.slice(0, 16).replace('T', ' ') : '') + '</small></div></div>';
    }
})();
