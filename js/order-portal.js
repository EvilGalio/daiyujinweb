/* Order Portal v4.5 — customer + sales workspace */
(function () {
    window.DaiyujinAPI.checkHealth();

    var form = document.querySelector('[data-login-form]');
    var btn = document.querySelector('[data-login-btn]');
    var error = document.querySelector('[data-login-error]');
    var main = document.querySelector('[data-portal-main]');
    if (!form) return;

    var mediaObjectUrls = [];
    var autoRefreshTimer = null;

    var portalChannel = null;

    function currentUserKey() {
        var u = user();
        return String(u.id || u.email || 'anonymous');
    }

    function initPortalBroadcast() {
        try {
            portalChannel = new BroadcastChannel('daiyujin-portal');
            portalChannel.onmessage = function (msg) { handlePortalBroadcastMessage(msg); };
        } catch (e) {}
    }

    function broadcastPortalMessage(type, payload) {
        if (!portalChannel) return;
        payload = payload || {};
        payload.userKey = currentUserKey();
        try { portalChannel.postMessage({ type: type, payload: payload }); } catch (e) {}
    }

    function handlePortalBroadcastMessage(msg) {
        if (!msg.data || !msg.data.payload) return;
        var d = msg.data;
        if (d.payload.userKey !== currentUserKey()) return;
        if (d.type === 'logout') { clearSession(); leaveAppMode(); location.reload(); }
        else if (d.type === 'order_changed' && d.payload.orderId) {
            markOrderChanged(d.payload.orderId, d.payload);
            patchOrderCardBadge(d.payload.orderId);
        }
        else if (d.type === 'cursor_updated') {
            portalState.lastEventId = Math.max(portalState.lastEventId, d.payload.lastEventId || 0);
        }
    }

    var portalState = {
        currentView: null,
        currentOrderId: null,
        currentIsSales: false,
        listKind: null,
        lastEventId: 0,
        eventAbort: null,
        eventReconnectTimer: null,
        ordersById: {},
        updatesByOrderId: {},
        messagesByOrderId: {},
        mediaByOrderId: {},
        changedOrders: {},
        toastQueue: [],
        activeToasts: [],
        syncStatus: 'connecting',
        lastEventAt: null,
        dirtyLists: {},
        sseFailCount: 0,
        sseConnectedAt: null,
        lastHeartbeatAt: null,
        lastReconnectAt: null,
        consecutiveFailures: 0,
        needsReconcile: false,
        processedEventIds: {},
        processedEventQueue: [],
        navStack: [],
        isNavigatingBack: false
    };

    function eventCursorKey() {
        var u = user();
        return 'portal_last_event_id_' + (u.id || u.email || 'anonymous');
    }

    function getLastEventId() { return Number(localStorage.getItem(eventCursorKey()) || 0); }
    function setLastEventId(id) { if (!id) return; portalState.lastEventId = id; localStorage.setItem(eventCursorKey(), String(id)); }

    function setCurrentView(view, opts) {
        opts = opts || {};
        portalState.currentView = view;
        portalState.currentOrderId = opts.orderId || null;
        portalState.currentIsSales = !!opts.isSales;
        portalState.listKind = opts.listKind || null;
    }

    function pushPortalView(label, fn, args) {
        if (portalState.isNavigatingBack) return;
        portalState.navStack.push({ label: label, fn: fn, args: args });
    }

    function portalBack() {
        if (!portalState.navStack.length) return;
        var prev = portalState.navStack.pop();
        portalState.isNavigatingBack = true;
        try {
            if (typeof prev.fn === 'function') prev.fn.apply(null, prev.args || []);
        } finally {
            setTimeout(function () { portalState.isNavigatingBack = false; }, 0);
        }
    }

    function renderBreadcrumb(stack) {
        if (!stack || !stack.length) return '';
        return '<div class="portal-breadcrumb">' +
            stack.map(function (s) { return '<span>' + esc(s.label) + '</span>'; }).join(' <span style="color:var(--muted)">/</span> ') +
            '</div>';
    }

    function markOrderChanged(orderId, evt) {
        var entry = portalState.changedOrders[orderId] || { count: 0, types: {}, lastAt: null };
        entry.count++;
        entry.types[evt.event_type] = true;
        entry.lastAt = new Date().toISOString();
        portalState.changedOrders[orderId] = entry;
        portalState.dirtyLists['orders'] = true;
        portalState.dirtyLists['sales-orders'] = true;
        portalState.dirtyLists['admin-orders'] = true;
    }

    function clearOrderChanged(orderId) {
        delete portalState.changedOrders[orderId];
    }

    function shouldProcessEvent(evt) {
        if (!evt || !evt.id) return true;
        if (portalState.processedEventIds[evt.id]) return false;
        portalState.processedEventIds[evt.id] = true;
        portalState.processedEventQueue.push(evt.id);
        if (portalState.processedEventQueue.length > 300) {
            var old = portalState.processedEventQueue.shift();
            delete portalState.processedEventIds[old];
        }
        return true;
    }

    function startAutoRefresh(loader, intervalMs) {
        stopAutoRefresh();
        autoRefreshTimer = setInterval(function () {
            if (!document.hidden) loader({ silent: true });
        }, intervalMs);
    }

    function stopAutoRefresh() {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var email = document.getElementById('login-email').value.trim();
        var password = document.getElementById('login-password').value;
        if (!email || !password) { showError('Please enter your email and password.'); return; }
        btn.disabled = true; btn.textContent = 'Signing in...'; error.hidden = true;
        try {
            var resp = await window.DaiyujinAPI.request('/api/portal/auth/login', { method: 'POST', body: JSON.stringify({ email: email, password: password }) });
            if (!resp.token) throw new Error('No token returned');
            saveSession(resp.token, resp.user);
            if (resp.user.must_change_password) {
                showChangePassword(true);
            } else {
                routeByRole(resp.user.role);
            }
        } catch (err) { showError(err.message || 'Login failed.'); }
        btn.disabled = false; btn.textContent = 'Sign In';
    });

    function showError(msg) { error.textContent = msg; error.hidden = false; }
    var token = function () { return localStorage.getItem('portal_token') || sessionStorage.getItem('portal_token'); };
    function enterAppMode() { document.body.classList.add('portal-authenticated'); }

    function leaveAppMode() { document.body.classList.remove('portal-authenticated'); }

    function saveSession(t, u) {
        localStorage.setItem('portal_token', t);
        localStorage.setItem('portal_user', JSON.stringify(u));
        portalState.lastEventId = getLastEventId();
    }

    function clearSession() {
        localStorage.removeItem('portal_token');
        localStorage.removeItem('portal_user');
        sessionStorage.clear();
    }

    function routeByRole(role) {
        if (role === 'admin') showAdminWorkspace();
        else if (role === 'sales') showSalesWorkspace();
        else showCustomerDashboard();
    }

    function showChangePassword(required) {
        setCurrentView('list');
        stopAutoRefresh();
        var me = user();
        main.innerHTML = renderRoleHeader('Account Settings', me.display_name || me.email, required ? 'Password change required.' : 'Update your password.') +
            (required ? '<p style="color:var(--portal-danger);font-size:13px;margin:0 0 1rem">You must change your password before continuing.</p>' : '') +
            '<div class="portal-panel portal-panel-compact">' +
            '<h3>' + (required ? 'Set New Password' : 'Change Password') + '</h3>' +
            '<p><input id="chpwd-current" type="password" placeholder="Current password" style="width:100%;padding:.5rem;border:1px solid var(--line);border-radius:4px;font:inherit;font-size:14px"></p>' +
            '<p><input id="chpwd-new" type="password" placeholder="New password (min 12 characters)" style="width:100%;padding:.5rem;border:1px solid var(--line);border-radius:4px;font:inherit;font-size:14px"></p>' +
            '<p><input id="chpwd-confirm" type="password" placeholder="Confirm new password" style="width:100%;padding:.5rem;border:1px solid var(--line);border-radius:4px;font:inherit;font-size:14px"></p>' +
            '<p id="chpwd-error" style="color:var(--portal-danger, #dc2626);font-size:13px;display:none"></p>' +
            '<p><button class="portal-btn" onclick="doChangePassword(' + (required ? 'true' : 'false') + ')">' + (required ? 'Set Password & Continue' : 'Change Password') + '</button></p></div>';
        enterAppMode();
    }

    window.doChangePassword = async function (required) {
        var cur = document.getElementById('chpwd-current').value;
        var np = document.getElementById('chpwd-new').value;
        var cf = document.getElementById('chpwd-confirm').value;
        var err = document.getElementById('chpwd-error');
        if (np.length < 12) { err.textContent = 'New password must be at least 12 characters.'; err.style.display = ''; return; }
        if (np !== cf) { err.textContent = 'Passwords do not match.'; err.style.display = ''; return; }
        err.style.display = 'none';
        try {
            await api('/api/portal/auth/change-password', { method: 'POST', body: JSON.stringify({ current: cur, new: np }) });
            var currentUser = user();
            currentUser.must_change_password = false;
            saveSession(token(), currentUser);
            routeByRole(currentUser.role);
        } catch (e) { err.textContent = e.message; err.style.display = ''; }
    };
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
                        if (payload.code === 'password_change_required') {
                            if (typeof showChangePassword === 'function') showChangePassword(true);
                        }
                        throw new Error(payload.message || ('Request failed with ' + r.status));
                    }
                    return payload;
                });
            });
    };
    var user = function () { return JSON.parse(localStorage.getItem('portal_user') || sessionStorage.getItem('portal_user') || '{}'); };


    /* ── SSE event stream ── */
    function connectPortalEvents() {
        if (!token()) return;
        disconnectPortalEvents();
        setSyncStatus('connecting');
        var controller = new AbortController();
        portalState.eventAbort = controller;
        streamPortalEvents(controller.signal);
    }

    function disconnectPortalEvents() {
        if (portalState.eventAbort) { portalState.eventAbort.abort(); portalState.eventAbort = null; }
        if (portalState.eventReconnectTimer) { clearTimeout(portalState.eventReconnectTimer); portalState.eventReconnectTimer = null; }
    }

    function scheduleEventReconnect() {
        if (portalState.eventReconnectTimer || !token()) return;
        portalState.eventReconnectTimer = setTimeout(function () {
            portalState.eventReconnectTimer = null;
            connectPortalEvents();
        }, 2000);
    }

    async function streamPortalEvents(signal) {
        try {
            var url = window.DaiyujinAPI.config.baseUrl + '/api/portal/events?after_id=' + encodeURIComponent(portalState.lastEventId || 0);
            var resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token() }, signal: signal });
            if (resp.status === 401) { clearSession(); leaveAppMode(); return; }
            if (!resp.ok || !resp.body) throw new Error('Event stream failed');
            var prevStatus = portalState.syncStatus;
            setSyncStatus('live');
            if (prevStatus !== 'live' && prevStatus !== 'connecting') {
                reconcilePortalSnapshot('stream_recovered_' + prevStatus);
            }
            await readSseStream(resp.body, signal);
        } catch (e) {
            if (!signal.aborted) {
                portalState.sseFailCount++;
                var status = portalState.sseFailCount > 45 ? 'offline' : portalState.sseFailCount > 15 ? 'stale' : 'reconnecting';
                setSyncStatus(status);
                console.warn('Portal event stream disconnected:', e);
                scheduleEventReconnect();
            }
        }
    }

    async function readSseStream(body, signal) {
        var reader = body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buffer = '';
        while (!signal.aborted) {
            var result = await reader.read();
            if (result.done) break;
            buffer += decoder.decode(result.value, { stream: true });
            var chunks = buffer.split('\n\n');
            buffer = chunks.pop();
            chunks.forEach(handleSseChunk);
        }
        if (!signal.aborted) scheduleEventReconnect();
    }

    function handleSseChunk(chunk) {
        if (!chunk) return;
        if (chunk.indexOf(': heartbeat') >= 0) {
            portalState.lastHeartbeatAt = Date.now();
            setSyncStatus('live');
            return;
        }
        if (chunk.indexOf('data:') < 0) return;
        var id = null, eventType = null, dataLines = [];
        chunk.split('\n').forEach(function (line) {
            if (line.indexOf('id:') === 0) id = Number(line.slice(3).trim());
            else if (line.indexOf('event:') === 0) eventType = line.slice(6).trim();
            else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
        });
        if (!dataLines.length) return;
        try {
            var evt = JSON.parse(dataLines.join('\n'));
        } catch (e) { return; }
        evt.event_type = evt.event_type || eventType;
        evt.id = id;
        if (id) setLastEventId(id);
        if (!shouldProcessEvent(evt)) return;
        handlePortalEvent(evt);
    }

    function handlePortalEvent(evt) {
        if (!evt || !evt.event_type) return;
        var orderId = evt.order_id || (evt.payload && evt.payload.order_id);
        if (!orderId) return;
        if (portalState.currentView === 'order-detail' && Number(portalState.currentOrderId) === Number(orderId)) {
            handleCurrentOrderEvent(evt);
        } else {
            markBackgroundOrderChanged(orderId, evt);
        }
    }

    function handleCurrentOrderEvent(evt) {
        var oid = evt.order_id || (evt.payload && evt.payload.order_id);
        switch (evt.event_type) {
            case 'message_created': refreshCurrentOrderMessages(oid); break;
            case 'order_update_created': refreshCurrentOrderUpdates(oid); break;
            case 'media_created': refreshCurrentOrderMedia(oid); break;
            case 'order_stage_changed': refreshCurrentOrderSummary(oid); refreshCurrentOrderUpdates(oid); break;
            case 'order_summary_changed': refreshCurrentOrderSummary(oid); break;
            case 'order_internal_changed': if (user().role !== 'customer') refreshCurrentOrderSummary(oid); break;
            default: reconcilePortalSnapshot('unknown_event_' + evt.event_type);
        }
    }

    async function refreshCurrentOrderMessages(orderId) {
        var resp = await api('/api/portal/orders/' + orderId + '/messages');
        patchMessages(orderId, resp.messages || [], portalState.currentIsSales);
    }

    async function refreshCurrentOrderUpdates(orderId) {
        var resp = await api('/api/portal/orders/' + orderId + '/updates');
        patchTimeline(orderId, resp.updates || []);
    }

    async function refreshCurrentOrderMedia(orderId) {
        var resp = await api('/api/portal/orders/' + orderId + '/media');
        patchMedia(orderId, resp.media || []);
    }

    async function refreshCurrentOrderSummary(orderId) {
        var resp = await api('/api/portal/orders/' + orderId);
        var o = resp.order;
        portalState.ordersById[orderId] = o;
        patchOrderHeader(o);
        patchStageStepper(o.current_stage);
    }

    function markBackgroundOrderChanged(orderId, evt) {
        markOrderChanged(orderId, evt);
        patchOrderCardBadge(orderId);
        enqueueEventToast(evt);
    }

    async function reconcilePortalSnapshot(reason) {
        setSyncStatus('resyncing');
        try {
            var snap = await api('/api/portal/snapshot');
            applySnapshot(snap);
            setSyncStatus('live');
            console.info('Portal reconciled via snapshot (' + reason + ')');
        } catch (e) {
            setSyncStatus('live');
            console.warn('Portal snapshot reconciliation failed:', e);
        }
    }

    function applySnapshot(snap) {
        if (!snap || !snap.orders) return;
        snap.orders.forEach(function (o) {
            portalState.ordersById[o.id] = o;
            if (portalState.changedOrders[o.id]) {
                portalState.changedOrders[o.id].orderNo = o.order_no;
                portalState.changedOrders[o.id].title = o.title;
            }
        });
        // If user is on a detail page, check if current order still exists
        if (portalState.currentView === 'order-detail' && portalState.currentOrderId) {
            var cur = snap.orders.find(function (o) { return o.id === Number(portalState.currentOrderId); });
            if (cur) refreshCurrentOrderSummary(cur.id);
        }
        if (snap.latest_event_id) setLastEventId(snap.latest_event_id);
    }

    /* ── Toast ── */
    function enqueueEventToast(evt) {
        var msg = eventToastMessage(evt);
        if (!msg) return;
        var orderId = evt.order_id || (evt.payload && evt.payload.order_id);
        // Merge if same order toasted within 10s
        var recent = portalState.activeToasts.find(function (t) { return t.orderId === orderId; });
        if (recent) {
            recent.count = (recent.count || 1) + 1;
            recent.el.querySelector('.portal-toast-count').textContent = recent.count + ' updates';
            recent.el.querySelector('.portal-toast-title').textContent = 'Order #' + orderId;
            return;
        }
        showPortalToast({ title: msg, orderId: orderId });
    }

    function eventToastMessage(evt) {
        var t = evt.event_type;
        if (t === 'message_created') return 'New message';
        if (t === 'order_update_created') return 'Progress updated';
        if (t === 'media_created') return 'New production photo';
        if (t === 'order_stage_changed') return 'Stage changed';
        if (t === 'order_summary_changed') return 'Order details updated';
        if (t === 'order_created') return 'New order created';
        return null;
    }

    function showPortalToast(opts) {
        var region = document.getElementById('toast-region');
        if (!region) return;
        if (portalState.activeToasts.length >= 3) {
            var oldest = portalState.activeToasts.shift();
            if (oldest.el) oldest.el.remove();
            if (oldest.timer) clearTimeout(oldest.timer);
        }
        var el = document.createElement('div');
        el.className = 'portal-toast is-entering';
        el.setAttribute('role', 'status');
        el.innerHTML = '<div class="portal-toast-title">' + esc(opts.title) + '</div>' +
            '<span class="portal-toast-count">1 update</span>';
        if (opts.orderId) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function () {
                if (user().role === 'customer') showCustomerOrderDetail(opts.orderId);
                else showSalesOrderDetail(opts.orderId);
            });
        }
        region.appendChild(el);
        requestAnimationFrame(function () { el.classList.remove('is-entering'); });
        var entry = { el: el, orderId: opts.orderId, count: 1 };
        entry.timer = setTimeout(function () { dismissPortalToast(entry); }, 5000);
        el.addEventListener('mouseenter', function () { clearTimeout(entry.timer); });
        el.addEventListener('mouseleave', function () { entry.timer = setTimeout(function () { dismissPortalToast(entry); }, 3000); });
        portalState.activeToasts.push(entry);
    }

    function dismissPortalToast(entry) {
        if (!entry || !entry.el) return;
        entry.el.style.opacity = '0';
        entry.el.style.transform = 'translateY(8px)';
        setTimeout(function () { if (entry.el) entry.el.remove(); }, 200);
        portalState.activeToasts = portalState.activeToasts.filter(function (t) { return t !== entry; });
    }

    /* ── Order card badge ── */
    function patchOrderCardBadge(orderId) {
        var badge = document.querySelector('[data-order-unread-badge="' + orderId + '"]');
        if (!badge) {
            showListRefreshBanner();
            return false;
        }
        badge.hidden = false;
        badge.textContent = portalState.changedOrders[orderId] ? portalState.changedOrders[orderId].count : '!';
        var card = document.getElementById('portal-order-card-' + orderId);
        if (card) card.classList.add('has-updates');
        return true;
    }

    function showListRefreshBanner() {
        var existing = document.getElementById('list-refresh-banner');
        if (existing) return;
        var bar = document.querySelector('.portal-user-bar, .portal-role-header, .portal-bar');
        if (!bar) return;
        var banner = document.createElement('div');
        banner.id = 'list-refresh-banner';
        banner.className = 'portal-note-card';
        banner.style.cssText = 'cursor:pointer;margin:0 0 1rem;display:flex;justify-content:space-between;align-items:center';
        banner.innerHTML = '<span>Updates available — refresh list</span><button class="portal-btn portal-btn-sm portal-btn-secondary portal-btn-auto">Refresh</button>';
        banner.querySelector('button').onclick = function () {
            banner.remove();
            var role = user().role;
            if (role === 'customer') { showCustomerDashboard(); }
            else if (role === 'sales') { showSalesOrders(); }
            else if (role === 'admin') { showAdminDashboard(); }
        };
        bar.parentNode.insertBefore(banner, bar.nextSibling);
    }

    function refreshAdminOrderBadge() {}

    /* ── Sync status ── */
    function setSyncStatus(status) {
        portalState.syncStatus = status;
        var dot = document.getElementById('sync-dot');
        if (dot) {
            dot.className = 'portal-sync-dot portal-sync-' + status;
            dot.title = status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting...' : status === 'offline' ? 'Offline' : status === 'stale' ? 'Data may be stale' : status === 'resyncing' ? 'Syncing...' : 'Connecting...';
        }
        var strip = document.getElementById('sync-strip');
        if (strip) {
            strip.className = 'portal-sync-strip';
            strip.hidden = true;
            if (status === 'stale') { strip.className += ' portal-sync-stale visible'; strip.textContent = 'Connection unstable. Updates may be delayed.'; strip.hidden = false; }
            else if (status === 'offline') { strip.className += ' portal-sync-offline visible'; strip.textContent = 'Offline. Reconnecting automatically...'; strip.hidden = false; }
            else if (status === 'resyncing') { strip.className += ' portal-sync-resyncing visible'; strip.textContent = 'Syncing latest order data...'; strip.hidden = false; }
            else if (status === 'reconnecting') { strip.className += ' portal-sync-reconnecting visible'; strip.textContent = 'Reconnecting...'; strip.hidden = false; }
        }
        if (status === 'live') { portalState.lastEventAt = new Date().toISOString(); portalState.sseFailCount = 0; }
    }

    window.showCustomerDashboard = showCustomerDashboard;
    window.showSalesWorkspace = showSalesWorkspace;
    window.showSalesOrders = showSalesOrders;
    window.showSalesCustomers = showSalesCustomers;
    window.showCreateCustomer = showCreateCustomer;
    window.showCreateOrder = showCreateOrder;
    window.showChangePassword = showChangePassword;
    window.clearMediaUrls = clearMediaUrls;

    window.portalLogout = async function () {
        try { await api('/api/portal/auth/logout', { method: 'POST' }); } catch (e) {}
        broadcastPortalMessage('logout', {});
        disconnectPortalEvents();
        clearSession(); leaveAppMode(); location.reload();
    };

    function showChangePasswordBtn() {
        return '<button onclick="showChangePassword(false)" class="portal-btn portal-btn-ghost portal-btn-sm portal-btn-auto">Change Password</button>';
    }


    function renderErrorState(title, detail, backLabel, backAction) {
        return '<div class="portal-empty-state portal-error-state"><h3>' + esc(title) + '</h3>' +
            '<p>' + esc(detail || 'Please try again. If the issue persists, contact your sales representative.') + '</p>' +
            '<div class="portal-cta-row"><button class="portal-btn portal-btn-secondary portal-btn-sm" onclick="' + backAction + '">' + esc(backLabel || 'Back') + '</button></div></div>';
    }

    function renderRoleHeader(title, name, subtitle) {
        var back = portalState.navStack.length
            ? '<button onclick="portalBack()" class="portal-btn portal-btn-ghost portal-btn-sm">&larr; Back</button>'
            : '';
        return '<div class="portal-role-header">' + back + '<h2>' + esc(title) + '</h2>' +
            '<b>' + esc(name) + '</b><span>' + esc(subtitle) + '</span>' +
            '<div class="portal-header-actions"><button onclick="showChangePassword(false)" class="portal-btn portal-btn-ghost portal-btn-sm">Change Password</button>' +
            '<button onclick="portalLogout()" class="portal-btn portal-btn-ghost portal-btn-sm">Sign Out</button></div></div>';
    }

    /* ── Skeleton loaders ── */
    function renderSkeleton(className, h) {
        return '<div class="portal-skeleton ' + (className || '') + '" style="height:' + (h || '20') + 'px"></div>';
    }

    function renderTableSkeleton(cols, rows) {
        cols = cols || 4; rows = rows || 5;
        var html = '<div class="portal-panel" style="padding:.5rem">';
        for (var r = 0; r < rows; r++) {
            html += '<div class="portal-skeleton portal-skeleton-row" style="margin-bottom:4px"></div>';
        }
        return html + '</div>';
    }

    function renderOrderDetailSkeleton() {
        return '<div class="portal-panel" style="margin-bottom:1rem">' +
            renderSkeleton('portal-skeleton-title', 20) +
            renderSkeleton('portal-skeleton-text', 14) +
            '</div>' +
            '<div class="portal-detail-grid">' +
            '<div>' + renderSkeleton('portal-skeleton-row', 36) + renderSkeleton('portal-skeleton-row', 36) + renderSkeleton('portal-skeleton-row', 36) + '</div>' +
            '<div>' + renderSkeleton('portal-skeleton-img', 140) + '</div>' +
            '</div>';
    }

    function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; }); }

    var stageLabels = { order_confirmed: 'Order Confirmed', material_purchasing: 'Material Purchasing', material_ready: 'Material Ready', machining: 'CNC Machining', in_process_qc: 'In-process QC', surface_treatment: 'Surface Treatment', final_inspection: 'Final Inspection', packing: 'Packing', shipped: 'Shipped', delivered: 'Delivered', on_hold: 'On Hold' };

    /* ══════════════════════════════════════════════════
       Customer Dashboard
       ══════════════════════════════════════════════════ */

    async function showCustomerDashboard() { setCurrentView('list'); clearMediaUrls(); stopAutoRefresh();
        try {
            var resp = await api('/api/portal/orders');
            var u = user();
            main.innerHTML = renderRoleHeader('My Orders', u.display_name || u.email, 'Track your production progress and updates.') +
                '<div class="portal-dashboard">' + (resp.orders && resp.orders.length ? resp.orders.map(renderOrderCard).join('') : '<div class="portal-empty-state"><div class="portal-empty-state-icon">📦</div><h3>No active orders yet</h3><p>Your manufacturing orders will appear here once your sales representative creates them.</p><p style="font-size:12px;color:var(--portal-muted)">If you expected to see an order, contact your sales representative.</p></div>') + '</div>';
        } catch (e) { main.innerHTML = '<div class="portal-empty">Unable to load orders.</div>'; }
    }

    var stageProgress = { order_confirmed: 8, material_purchasing: 18, material_ready: 28, machining: 48, in_process_qc: 58, surface_treatment: 70, final_inspection: 82, packing: 90, shipped: 96, delivered: 100, on_hold: 40 };
    var stageDefaultProgress = 10;

    function renderOrderCard(order) {
        var stageLabel = stageLabels[order.current_stage] || 'N/A';
        var progress = stageProgress[order.current_stage] || stageDefaultProgress;
        return '<article class="portal-order-card" id="portal-order-card-' + order.id + '" data-order-id="' + order.id + '" class="portal-clickable" onclick="showOrderDetail(' + order.id + ')">' +
            '<div class="portal-card-head"><div>' +
            '<p class="portal-eyebrow">Order #' + esc(order.order_no) + ' <span class="portal-live-badge" data-order-unread-badge="' + order.id + '" hidden></span></p>' +
            '<h3>' + esc(order.title || 'Part / Project') + '</h3>' +
            '</div><span class="portal-badge status-' + esc(order.status) + '">' + esc(order.status) + '</span></div>' +
            '<div class="portal-stage-summary"><span>Current stage</span><strong>' + esc(stageLabel) + '</strong></div>' +
            '<div class="portal-progress-track"><span style="width:' + progress + '%"></span></div>' +
            '<div class="portal-card-meta"><span>ETA: ' + esc(order.estimated_delivery_date || 'TBD') + '</span>' +
            '<span>Updated: ' + esc((order.updated_at || '').slice(0,10)) + '</span></div></article>';
    }

    /* ══════════════════════════════════════════════════
       Admin Workspace — Order Portal Operations Console
       ══════════════════════════════════════════════════ */

    function showAdminWorkspace() { clearMediaUrls(); showAdminDashboard(); }
    window.showAdminDashboard = showAdminDashboard;
    window.showAdminTab = showAdminTab;
    window.showAdminCreateUser = showAdminCreateUser;

    async function showAdminDashboard() { showAdminTab("overview"); }

    async function showAdminTab(tab) {
        setCurrentView('list', { listKind: 'admin-' + tab });
        var me = user();
        main.innerHTML = renderRoleHeader('Operations Console', me.display_name || me.email, 'Manage reps, customers, orders, and portal activity.') +
            '<div class="portal-admin-tabs">' +
            ['overview','sales-reps','customers','orders','activity'].map(function (t) {
                return '<button class="' + (t === tab ? 'active' : '') + '" onclick="showAdminTab(\'' + t + '\')">' + ['Dashboard','Sales Reps','Customers','Orders','Activity Logs'][['overview','sales-reps','customers','orders','activity'].indexOf(t)] + '</button>';
            }).join('') + '</div>' +
            '<div id="admin-content" class="portal-admin-content">' + renderTableSkeleton(4, 5) + '</div>';
        try {
            if (tab === 'overview') await renderAdminOverview();
            else if (tab === 'sales-reps') await renderAdminSalesReps();
            else if (tab === 'customers') await renderAdminCustomers();
            else if (tab === 'orders') await renderAdminOrders();
            else if (tab === 'activity') await renderAdminActivity();
        } catch (e) { document.getElementById('admin-content').innerHTML = '<div class="portal-empty">Unable to load.</div>'; }
    }

    async function renderAdminOverview() {
        var ov = (await api('/api/portal/admin/overview')).overview;
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-admin-kpi-grid">' +
            ['Active Sales Reps','Active Customers','Orders in Production','Updates Today'].map(function (label, i) {
                var val = [ov.sales_count, ov.customer_count, ov.active_orders, ov.updates_today][i];
                var help = ['People responsible for customers','Assigned customer accounts','Orders currently in production','Progress entries today'][i];
                return '<div class="portal-admin-kpi"><strong>' + val + '</strong><span>' + label + '</span><small>' + help + '</small></div>';
            }).join('') + '</div>' +
            '<div style="margin-top:1rem"><button class="portal-btn portal-btn-primary portal-btn-auto" onclick="showAdminCreateUser()">+ Create User</button></div>';
    }

    async function renderAdminSalesReps() {
        var d = await api('/api/portal/admin/sales-reps');
        var reps = d.sales_reps || [];
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-command-bar"><h3>Sales Reps</h3><span>Monitor workload and customer ownership. ' + reps.length + ' reps found.</span><button class="portal-btn portal-btn-primary portal-btn-sm" onclick="showAdminCreateUser()">+ Create User</button></div>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Customers</th><th>Orders</th><th>Last Activity</th><th></th></tr></thead><tbody>' +
            reps.map(function (r) {
                return '<tr><td>' + esc(r.display_name || '-') + '</td><td>' + esc(r.email) + '</td>' +
                    '<td><span class="portal-badge status-' + r.status + '">' + esc(r.status) + '</span></td>' +
                    '<td>' + r.customer_count + '</td><td>' + r.order_count + '</td>' +
                    '<td>' + (r.last_action || '—') + ' ' + (r.last_activity ? r.last_activity.slice(0,16).replace('T',' ') : '') + '</td>' +
                    '<td><button class="portal-btn portal-btn-auto" style="padding:.2rem .5rem;font-size:12px" onclick="showAdminSalesRepDetail(' + r.id + ')">View</button></td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    window.showAdminSalesRepDetail = async function(sid) {
        pushPortalView('Sales Reps', showAdminTab, ['sales-reps']);
        var d = await api('/api/portal/admin/sales-reps/' + sid);
        var r = d.rep; var cxs = d.customers || []; var ords = d.orders || []; var logs = d.recent_logs || [];
        document.getElementById('admin-content').innerHTML =
            '<h3>' + esc(r.display_name || r.email) + ' <span class="portal-badge status-' + (r.status||'active') + '">' + esc(r.status||'active') + '</span></h3>' +
            '<p>Email: ' + esc(r.email) + '</p>' +
            '<h4>Customers (' + cxs.length + ')</h4>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead><tbody>' +
            cxs.map(function(c) { return '<tr><td>' + esc(c.display_name || '-') + '</td><td>' + esc(c.email) + '</td><td>' + esc(c.status) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
            '<h4>Orders (' + ords.length + ')</h4>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Order</th><th>Stage</th><th>Status</th></tr></thead><tbody>' +
            ords.map(function(o) { return '<tr onclick="showAdminOrderDetail(' + o.id + ', \'Sales Rep\', showAdminSalesRepDetail, [' + sid + '])" class="portal-clickable"><td>' + esc(o.order_no) + ' ' + esc(o.title) + '</td><td>' + esc(o.current_stage||'N/A') + '</td><td>' + esc(o.status) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
            '<h4>Recent Activity</h4>' +
            renderActivityTable(logs);
    };

    async function renderAdminCustomers() {
        var d = await api('/api/portal/admin/customers');
        var cxs = d.customers || [];
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-command-bar"><h3>Customers</h3><span>Search by name, company, email, or sales rep. ' + cxs.length + ' records.</span></div>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Name</th><th>Email</th><th>Sales Rep</th><th>Orders</th><th>Latest Status</th><th></th></tr></thead><tbody>' +
            cxs.map(function(c) {
                return '<tr><td>' + esc(c.display_name || '-') + '</td><td>' + esc(c.email) + '</td>' +
                    '<td>' + esc(c.sales_name || '—') + '</td><td>' + c.order_count + '</td>' +
                    '<td>' + esc(c.latest_order_status || '—') + '</td>' +
                    '<td><button class="portal-btn portal-btn-auto" style="padding:.2rem .5rem;font-size:12px" onclick="showAdminCustomerDetail(' + c.id + ')">View</button></td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    window.showAdminCustomerDetail = async function(cid) {
        pushPortalView('Customers', showAdminTab, ['customers']);
        var d = await api('/api/portal/admin/customers/' + cid);
        var c = d.customer; var ords = d.orders || [];
        document.getElementById('admin-content').innerHTML =
            '<h3>' + esc(c.display_name || c.email) + ' <span class="portal-badge status-' + (c.status||'active') + '">' + esc(c.status||'active') + '</span></h3>' +
            '<p>Email: ' + esc(c.email) + ' | Sales: ' + esc(d.sales_name || 'Unassigned') + '</p>' +
            '<h4>Orders (' + ords.length + ')</h4>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Order</th><th>Stage</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
            ords.map(function(o) { return '<tr onclick="showAdminOrderDetail(' + o.id + ', \'Customer\', showAdminCustomerDetail, [' + cid + '])" class="portal-clickable"><td>' + esc(o.order_no) + ' ' + esc(o.title) + '</td><td>' + esc(o.current_stage||'N/A') + '</td><td>' + esc(o.status) + '</td><td>' + (o.updated_at||'').slice(0,10) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    };

    async function renderAdminOrders() {
        var d = await api('/api/portal/admin/orders');
        var ords = d.orders || [];
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-command-bar"><h3>Orders</h3><span>All orders across all sales reps and customers. ' + ords.length + ' total.</span></div>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Order #</th><th>Title</th><th>Customer</th><th>Sales</th><th>Stage</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
            ords.map(function(o) {
                return '<tr onclick="showAdminOrderDetail(' + o.id + ')" class="portal-clickable">' +
                    '<td>' + esc(o.order_no) + '</td><td>' + esc(o.title || '—') + '</td>' +
                    '<td>' + esc(o.customer_name || '—') + '</td><td>' + esc(o.sales_name || '—') + '</td>' +
                    '<td>' + esc(o.current_stage||'N/A') + '</td><td>' + esc(o.status) + '</td>' +
                    '<td>' + (o.updated_at||'').slice(0,10) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    window.showAdminOrderDetail = async function(orderId, backLabel, backFn, backArgs, opts) {
        opts = opts || {};
        if (!opts.skipPush) pushPortalView(backLabel || 'Orders', backFn || showAdminTab, backArgs || ['orders']);
        var d = await api('/api/portal/admin/orders/' + orderId + '/full');
        var o = d.order;
        var content = document.getElementById('admin-content');
        content.innerHTML = '<h3>Order ' + esc(o.order_no) + ': ' + esc(o.title) + '</h3>' +
            '<div class="portal-admin-detail-layout">' +
            '<div><strong>Customer:</strong> ' + esc((o.customer||{}).display_name || (o.customer||{}).email || '—') + '<br>' +
            '<strong>Sales:</strong> ' + esc((o.sales||{}).display_name || (o.sales||{}).email || '—') + '<br>' +
            '<strong>Stage:</strong> ' + esc(o.current_stage||'N/A') + ' | <strong>Status:</strong> ' + esc(o.status) + '<br>' +
            '<strong>Delivery:</strong> ' + esc(o.estimated_delivery_date||'TBD') + '<br>' +
            '<strong>PO:</strong> ' + esc(o.po_number||'—') + '</div>' +
            '<div><button class="portal-btn portal-btn-auto" style="padding:.3rem .75rem" onclick="showAdminAssignSales(' + o.id + ')">Transfer Sales Rep</button></div></div>' +
            '<h4>Timeline</h4>' + (o.updates||[]).map(function(u) { return '<div class="portal-msg"><strong>' + esc(u.title) + '</strong><small> ' + (u.created_at||'').slice(0,16).replace('T',' ') + '</small><p>' + esc(u.message||'—') + '</p></div>'; }).join('') +
            '<h4>Messages (' + (o.messages||[]).length + ')</h4>' + (o.messages||[]).map(function(m) {
                return '<div class="portal-msg' + (m.parent_message_id ? ' portal-msg-reply' : '') + '"><strong>User #' + m.sender_user_id + '</strong><small> ' + (m.created_at||'').slice(0,16).replace('T',' ') + '</small><p>' + esc(m.message) + '</p></div>';
            }).join('') +
            '<h4>Photos (' + (o.media||[]).length + ')</h4>' +
            '<div class="portal-media-grid" id="admin-media-grid">' + ((o.media||[]).length ? '<div class="portal-empty">Loading photos...</div>' : '<div class="portal-empty">No photos yet.</div>') + '</div>';
        if ((o.media||[]).length) loadAuthorizedImages(o.id, o.media, 'admin-media-grid');
    };

    window.showAdminAssignSales = function(orderId) {
        var sid = prompt('Enter new sales user ID:');
        if (!sid) return;
        var parsed = parseInt(sid, 10);
        if (isNaN(parsed)) { alert('Must be a number.'); return; }
        api('/api/portal/admin/orders/' + orderId + '/assign-sales', { method: 'PATCH', body: JSON.stringify({ sales_user_id: parsed }) })
            .then(function() { showAdminOrderDetail(orderId, null, null, null, { skipPush: true }); }).catch(function() { alert('Transfer failed. Check the sales user ID is valid and active.'); });
    };

    async function renderAdminActivity() {
        var d = await api('/api/portal/admin/audit-logs');
        var logs = d.logs || [];
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-command-bar"><h3>Activity Logs</h3><span>Trace portal actions by admins and sales reps. ' + logs.length + ' entries.</span></div>' + renderActivityTable(logs);
    }

    function renderActivityTable(logs) {
        return '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th></tr></thead><tbody>' +
            logs.map(function(l) {
                return '<tr><td>' + (l.created_at||'').slice(0,16).replace('T',' ') + '</td>' +
                    '<td>' + esc(l.actor_email || '—') + '</td>' +
                    '<td>' + esc(l.actor_role || '—') + '</td>' +
                    '<td>' + esc(l.action) + '</td>' +
                    '<td>' + esc(l.entity_type || '') + ' ' + esc(l.entity_label || '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    window.adminDisableUser = async function(userId) {
        if (!confirm('Disable this user?')) return;
        try { await api('/api/portal/admin/users/' + userId, { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) }); showAdminTab('sales-reps'); }
        catch (e) { alert('Failed to disable user.'); }
    };

    var selectedAdminSalesRep = null;
    var adminSalesRepsCache = [];

    function showAdminCreateUser() {
        pushPortalView('Dashboard', showAdminDashboard, []);
        stopAutoRefresh();
        var me = user();
        selectedAdminSalesRep = null;
        main.innerHTML = renderRoleHeader('Operations Console', me.display_name || me.email, 'Create a new user account.') +
            '<div class="portal-panel portal-panel-compact">' +
            '<h3>Create User</h3>' +
            '<p><input id="new-user-email" placeholder="Email" style="width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px"></p>' +
            '<p><input id="new-user-name" placeholder="Display name (optional)" style="width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px"></p>' +
            '<p><select id="new-user-role" style="width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px"><option value="sales">Sales</option><option value="admin">Admin</option><option value="customer">Customer</option></select></p>' +
            '<div id="admin-sales-picker" style="display:none">' +
                '<p style="margin-bottom:.25rem;font-size:12px;color:var(--muted)">Bind Sales Rep</p>' +
                '<input id="admin-sales-search" placeholder="Search sales name or email">' +
                '<div id="admin-sales-selected"></div>' +
                '<div id="admin-sales-results"></div>' +
            '</div>' +
            '<p><button class="portal-btn" onclick="adminCreateUser()">Create User</button></p></div>';
        document.getElementById('new-user-role').addEventListener('change', function () {
            var isCust = this.value === 'customer';
            document.getElementById('admin-sales-picker').style.display = isCust ? '' : 'none';
            if (isCust) {
                if (!adminSalesRepsCache.length) { loadAdminSalesReps(); }
                else { bindAdminSalesSearch(); }
            }
        });
    }

    function loadAdminSalesReps() {
        api('/api/portal/admin/sales-reps').then(function (resp) {
            adminSalesRepsCache = resp.sales_reps || [];
            bindAdminSalesSearch();
        });
    }

    function bindAdminSalesSearch() {
        var input = document.getElementById('admin-sales-search');
        var results = document.getElementById('admin-sales-results');
        if (!input || !results) return;
        input.oninput = function () {
            var q = input.value.trim().toLowerCase();
            var rows = adminSalesRepsCache.filter(function (r) {
                return !q ||
                    String(r.display_name || '').toLowerCase().indexOf(q) >= 0 ||
                    String(r.email || '').toLowerCase().indexOf(q) >= 0;
            }).slice(0, 8);
            results.innerHTML = rows.map(function (r) {
                return '<button type="button" class="portal-picker-option" onclick="window.selectAdminSalesRep(' + r.id + ')">' +
                    '<strong>' + esc(r.display_name || r.email) + '</strong>' +
                    '<span>' + esc(r.email) + ' · ' + (r.customer_count || 0) + ' customers</span>' +
                    '</button>';
            }).join('');
        };
        input.dispatchEvent(new Event('input'));
    }

    window.selectAdminSalesRep = function (id) {
        selectedAdminSalesRep = adminSalesRepsCache.find(function (r) { return r.id === id; });
        if (!selectedAdminSalesRep) return;
        document.getElementById('admin-sales-selected').innerHTML =
            '<div class="portal-picker-selected">' +
            '<strong>' + esc(selectedAdminSalesRep.display_name || selectedAdminSalesRep.email) + '</strong>' +
            '<span>' + esc(selectedAdminSalesRep.email) + '</span>' +
            '<button type="button" onclick="window.clearAdminSalesRep()">×</button>' +
            '</div>';
        document.getElementById('admin-sales-results').innerHTML = '';
        document.getElementById('admin-sales-search').value = '';
    };

    window.clearAdminSalesRep = function () {
        selectedAdminSalesRep = null;
        document.getElementById('admin-sales-selected').innerHTML = '';
    };

    window.adminCreateUser = async function() {
        var email = document.getElementById('new-user-email').value.trim();
        var name = document.getElementById('new-user-name').value.trim();
        var role = document.getElementById('new-user-role').value;
        if (!email) { alert('Email is required.'); return; }
        try {
            var body = { email: email, role: role, display_name: name };
            if (role === 'customer') {
                if (!selectedAdminSalesRep) { alert('Please select a sales rep for this customer.'); return; }
                body.assigned_sales_id = selectedAdminSalesRep.id;
            }
            var resp = await api('/api/portal/admin/users', { method: 'POST', body: JSON.stringify(body) });
            alert('User created. Initial password: ' + resp.initial_password);
            showAdminDashboard();
        } catch (e) { alert('Failed to create user.'); }
    };

    /* ══════════════════════════════════════════════════
       Sales Workspace
       ══════════════════════════════════════════════════ */

    function showSalesWorkspace() { clearMediaUrls(); showSalesOrders(); }

    async function showSalesOrders() {
        setCurrentView('list', { listKind: 'sales-orders' });
        var u = user();
        try {
            var resp = await api('/api/portal/orders');
            var orders = resp.orders || [];
            main.innerHTML = renderRoleHeader('Sales Workspace', u.display_name || u.email, 'Manage customers, orders, updates, and production photos.') +
                renderSalesCommandBar('orders') +
                '<div class="portal-dashboard">' + (orders.length ? orders.map(renderSalesOrderCard).join('') :
                '<div class="portal-empty-state"><div class="portal-empty-state-icon">📋</div><h3>No orders yet</h3><p>Create a customer first, then create the first order.</p><div class="portal-cta-row"><button class="portal-btn" onclick="showCreateCustomer()">Create Customer</button><button class="portal-btn portal-btn-secondary" onclick="showCreateOrder()">Create Order</button></div></div>') + '</div>';
        } catch (e) { main.innerHTML = '<div class="portal-empty">Unable to load.</div>'; }
    }


    function renderSalesCommandBar(activeTab) {
        return '<div class="portal-sales-tabs">' +
            '<button' + (activeTab === 'orders' ? ' class="active"' : '') + ' onclick="showSalesOrders()">Orders</button>' +
            '<button' + (activeTab === 'customers' ? ' class="active"' : '') + ' onclick="showSalesCustomers()">Customers</button>' +
            '<div style="flex:1"></div>' +
            '<a href="javascript:void(0)" onclick="showCreateCustomer()" class="portal-btn portal-btn-secondary portal-btn-sm" style="text-decoration:none;margin-right:.25rem">+ Customer</a>' +
            '<a href="javascript:void(0)" onclick="showCreateOrder()" class="portal-btn portal-btn-sm" style="text-decoration:none">+ Order</a>' +
            '</div>';
    }

    function renderSalesOrderCard(order) {
        return '<div class="portal-order-card" id="portal-order-card-' + order.id + '" data-order-id="' + order.id + '" class="portal-clickable" onclick="showSalesOrderDetail(' + order.id + ')">' +
            '<h3>' + esc(order.title || 'Order #' + order.order_no) + ' <span class="portal-live-badge" data-order-unread-badge="' + order.id + '" hidden></span></h3>' +
            '<div class="portal-order-meta"><span>Stage: <span class="portal-badge active">' + esc(order.current_stage || 'N/A') + '</span></span>' +
            '<span>Delivery: ' + esc(order.estimated_delivery_date || 'TBD') + '</span><span>' + esc(order.updated_at || '-') + '</span></div></div>';
    }

    async function showSalesCustomers() {
        setCurrentView('list', { listKind: 'sales-customers' });
        clearMediaUrls();
        stopAutoRefresh();
        try {
            var resp = await api('/api/portal/sales/customers');
            var customers = resp.customers || [];
            var u = user();
            main.innerHTML = renderRoleHeader('Sales Workspace', u.display_name || u.email, 'Manage customers, orders, updates, and production photos.') +
                renderSalesCommandBar('customers') +
                '<div class="portal-dashboard">' + (customers.length ? customers.map(function (c) {
                    return '<div class="portal-order-card"><h3>' + esc(c.display_name || c.email) + '</h3><div class="portal-order-meta"><span>' + esc(c.email) + '</span><span>' + esc(c.company_name || '-') + '</span><span>' + esc(c.status) + '</span></div></div>';
                }).join('') : '<div class="portal-empty-state"><div class="portal-empty-state-icon">👥</div><h3>No customers yet</h3><p>Add a customer account before creating orders.</p><div class="portal-cta-row"><button class="portal-btn" onclick="showCreateCustomer()">Create Customer</button></div></div>') + '</div>';
        } catch (e) { main.innerHTML = '<div class="portal-empty">Unable to load.</div>'; }
    }

    function showCreateCustomer() {
        setCurrentView('list', { listKind: 'form' });
        stopAutoRefresh();
        main.innerHTML = renderRoleHeader('Sales Workspace', user().display_name || user().email, 'Add a new customer account.') +
            '<div class="portal-panel portal-panel-narrow"><h3>Create Customer</h3>' +
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
        setCurrentView('list', { listKind: 'form' });
        stopAutoRefresh();
        selectedOrderCustomer = null;
        main.innerHTML = renderRoleHeader('Sales Workspace', user().display_name || user().email, 'Create a new order.') +
            '<div class="portal-panel portal-panel-narrow"><h3>Create Order</h3>' +
            '<div class="portal-field"><label>Customer</label>' +
                '<input id="order-customer-search" type="text" placeholder="Search customer name, company, or email">' +
                '<div id="order-customer-selected"></div>' +
                '<div id="order-customer-results"></div></div>' +
            '<div class="portal-field"><label>Title / Part Name</label><input id="new-order-title" type="text" placeholder="Widget Assembly"></div>' +
            '<div class="portal-field"><label>PO Number</label><input id="new-order-po" type="text" placeholder="Optional"></div>' +
            '<div class="portal-error" id="order-error" hidden></div>' +
            '<button class="portal-btn" onclick="createOrder()">Create Order</button></div>';
        api('/api/portal/sales/customers').then(function (resp) {
            salesCustomersCache = resp.customers || [];
            bindOrderCustomerSearch();
        });
    }

    var selectedOrderCustomer = null;
    var salesCustomersCache = [];

    function bindOrderCustomerSearch() {
        var input = document.getElementById('order-customer-search');
        var results = document.getElementById('order-customer-results');
        if (!input || !results) return;
        input.addEventListener('input', function () {
            var q = input.value.trim().toLowerCase();
            var rows = salesCustomersCache.filter(function (c) {
                return !q ||
                    String(c.display_name || '').toLowerCase().indexOf(q) >= 0 ||
                    String(c.company_name || '').toLowerCase().indexOf(q) >= 0 ||
                    String(c.email || '').toLowerCase().indexOf(q) >= 0;
            }).slice(0, 8);
            results.innerHTML = rows.map(function (c) {
                return '<button type="button" class="portal-picker-option" onclick="window.selectOrderCustomer(' + c.id + ')">' +
                    '<strong>' + esc(c.display_name || c.company_name || c.email) + '</strong>' +
                    '<span>' + esc(c.email) + (c.company_name ? ' · ' + esc(c.company_name) : '') + '</span>' +
                    '</button>';
            }).join('');
        });
        input.dispatchEvent(new Event('input'));
    }

    window.selectOrderCustomer = function (id) {
        selectedOrderCustomer = salesCustomersCache.find(function (c) { return c.id === id; });
        if (!selectedOrderCustomer) return;
        document.getElementById('order-customer-selected').innerHTML =
            '<div class="portal-picker-selected">' +
            '<strong>' + esc(selectedOrderCustomer.display_name || selectedOrderCustomer.company_name || selectedOrderCustomer.email) + '</strong>' +
            '<span>' + esc(selectedOrderCustomer.email) + '</span>' +
            '<button type="button" onclick="window.clearOrderCustomer()">×</button>' +
            '</div>';
        document.getElementById('order-customer-results').innerHTML = '';
        document.getElementById('order-customer-search').value = '';
    };

    window.clearOrderCustomer = function () {
        selectedOrderCustomer = null;
        document.getElementById('order-customer-selected').innerHTML = '';
    };

    window.createOrder = async function () {
        var title = document.getElementById('new-order-title').value.trim();
        var po = document.getElementById('new-order-po').value.trim();
        var err = document.getElementById('order-error');
        if (!selectedOrderCustomer || !title) {
            if (!selectedOrderCustomer) err.textContent = 'Please select a customer.';
            else err.textContent = 'Title is required.';
            err.hidden = false;
            return;
        }
        try {
            var body = { customer_user_id: selectedOrderCustomer.id, title: title };
            if (po) body.po_number = po;
            await api('/api/portal/sales/orders', { method: 'POST', body: JSON.stringify(body) });
            showSalesOrders();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
    };

    /* ══════════════════════════════════════════════════
       Order Detail (shared)
       ══════════════════════════════════════════════════ */

    window.showOrderDetail = showCustomerOrderDetail;
    window.showSalesOrderDetail = showSalesOrderDetail;

    async function showCustomerOrderDetail(orderId) {
        pushPortalView('My Orders', showCustomerDashboard, []);
        main.innerHTML = renderRoleHeader('Order Detail', user().display_name || user().email, '') + renderOrderDetailSkeleton();
        try {
            var results = await Promise.all([
                api('/api/portal/orders/' + orderId), api('/api/portal/orders/' + orderId + '/updates'), api('/api/portal/orders/' + orderId + '/messages'), api('/api/portal/orders/' + orderId + '/media')
            ]);
            var o = results[0].order, updates = results[1].updates || [], messages = results[2].messages || [], media = results[3].media || [];
            renderOrderDetail(o, updates, messages, media, false);
        } catch (e) { console.error('Order detail load failed:', e); main.innerHTML = renderErrorState('Unable to load order details.', e && e.message ? e.message : 'The order detail request or rendering failed.', 'Back to Orders', 'showCustomerDashboard()'); }
    }

    async function showSalesOrderDetail(orderId) {
        pushPortalView('Orders', showSalesOrders, []);
        main.innerHTML = renderRoleHeader('Sales Workspace', user().display_name || user().email, '') + renderOrderDetailSkeleton();
        try {
            var results = await Promise.all([
                api('/api/portal/orders/' + orderId), api('/api/portal/orders/' + orderId + '/updates'), api('/api/portal/orders/' + orderId + '/messages'), api('/api/portal/orders/' + orderId + '/media')
            ]);
            var o = results[0].order, updates = results[1].updates || [], messages = results[2].messages || [], media = results[3].media || [];
            renderOrderDetail(o, updates, messages, media, true);
        } catch (e) { console.error('Order detail load failed:', e); main.innerHTML = renderErrorState('Unable to load order details.', e && e.message ? e.message : 'The order detail request or rendering failed.', 'Back to Orders', 'showSalesOrders()'); }
    }

    function renderOrderDetail(o, updates, messages, media, isSales) { enterAppMode();
        setCurrentView('order-detail', { orderId: o.id, isSales: isSales });
        clearOrderChanged(o.id);
        portalState.ordersById[o.id] = o;
        portalState.updatesByOrderId[o.id] = updates;
        portalState.messagesByOrderId[o.id] = messages;
        portalState.mediaByOrderId[o.id] = media;

        main.innerHTML =
            renderRoleHeader(isSales ? 'Sales Workspace' : 'Order Detail', user().display_name || user().email, '') +
            '<div id="order-header" class="portal-panel" style="margin-bottom:1rem"></div>' +
            (isSales ? '<div id="order-sales-actions">' + renderSalesActions(o.id) + '<input type="hidden" id="update-stage" value="' + (o.current_stage || '') + '"></div>' : '') +
            '<div id="order-stepper"></div>' +
            '<div class="portal-detail-grid">' +
            '<div>' +
                '<div class="portal-section-title">Progress Timeline</div>' +
                '<div id="order-timeline" class="portal-timeline"></div>' +
                '<div id="order-messages"></div>' +
            '</div>' +
            '<div>' +
                '<div class="portal-section-title">Photos</div>' +
                '<div class="portal-media-grid" id="order-media"></div>' +
                (isSales ? '<div class="portal-section-title">Actions</div><div class="portal-action-rail">' +
                    '<button class="portal-btn portal-btn-secondary" onclick="focusSalesUpdate()">Go to Progress Form</button>' +
                    '<button class="portal-btn portal-btn-secondary" onclick="focusSalesUpload()">Go to Photo Upload</button></div>' : '') +
            '</div></div>';

        patchOrderHeader(o);
        patchStageStepper(o.current_stage);
        patchTimeline(o.id, updates);
        patchMessages(o.id, messages, isSales);
        patchMedia(o.id, media);
    }

    function patchOrderHeader(o) {
        var el = document.getElementById('order-header');
        if (!el) return;
        el.innerHTML =
            '<h3 class="portal-order-title">' + esc(o.title) + ' <small>#' + esc(o.order_no) + '</small></h3>' +
            '<div class="portal-order-meta" style="margin-top:.5rem">' +
            '<span>Status: <span class="portal-badge ' + (o.status === 'active' ? 'active' : 'shipped') + '">' + esc(o.status) + '</span></span>' +
            '<span>Delivery: ' + esc(o.estimated_delivery_date || 'TBD') + '</span></div>' +
            (o.customer_visible_note ? '<div class="portal-note-card">' + esc(o.customer_visible_note) + '</div>' : '');
    }

    function patchStageStepper(stage) {
        var el = document.getElementById('order-stepper');
        if (!el) return;
        el.innerHTML = renderStageStepper(stage);
    }

    function patchTimeline(orderId, updates) {
        var el = document.getElementById('order-timeline');
        if (!el) return;
        portalState.updatesByOrderId[orderId] = updates || [];
        el.innerHTML = updates && updates.length
            ? updates.map(renderTimelineItem).join('')
            : '<div class="portal-empty">No updates yet.</div>';
    }

    function patchMessages(orderId, messages, isSales) {
        var el = document.getElementById('order-messages');
        if (!el) return;
        var mainActive = document.activeElement && document.activeElement.id === 'msg-text';
        var replyActive = document.activeElement && document.activeElement.id === 'reply-text';
        portalState.messagesByOrderId[orderId] = messages || [];
        if (mainActive || replyActive) {
            var banner = document.getElementById('order-messages-banner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'order-messages-banner';
                banner.className = 'portal-note-card';
                banner.style.cursor = 'pointer';
                banner.textContent = 'New messages available — click to refresh';
                banner.onclick = function () { banner.remove(); patchMessages(orderId, portalState.messagesByOrderId[orderId], isSales); };
                el.insertBefore(banner, el.firstChild);
            }
            return;
        }
        var banner = document.getElementById('order-messages-banner');
        if (banner) banner.remove();
        var draft = document.getElementById('msg-text') ? document.getElementById('msg-text').value : '';
        var wasFocused = document.activeElement && document.activeElement.id === 'msg-text';
        el.innerHTML = renderMessages(messages, isSales, orderId);
        var input = document.getElementById('msg-text');
        if (input && draft) input.value = draft;
        if (input && wasFocused) input.focus();
    }

    function patchMedia(orderId, media) {
        var el = document.getElementById('order-media');
        if (!el) return;
        clearMediaUrls();
        portalState.mediaByOrderId[orderId] = media || [];
        el.innerHTML = media && media.length
            ? '<div class="portal-empty">Loading photos...</div>'
            : '<div class="portal-empty">No photos yet.</div>';
        if (media && media.length) loadAuthorizedImages(orderId, media, 'order-media');
    }

    function renderSalesActions(orderId) {
        return '<div class="portal-sales-actions" id="sales-actions">' +
            '<h4>Update Stage</h4>' +
            '<div class="portal-stage-control" id="stage-control">' +
            Object.keys(stageLabels).map(function (k) {
                return '<button type="button" class="portal-stage-option" data-stage="' + k + '" onclick="selectStageOption(\'' + k + '\', \'' + stageLabels[k] + '\')">' + stageLabels[k] + '</button>';
            }).join('') + '</div>' +
            '<div id="stage-confirm" class="portal-stage-confirm" style="display:none">' +
                '<p>Change stage to <strong id="stage-confirm-label"></strong>?</p>' +
                '<button class="portal-btn portal-btn-primary portal-btn-sm" onclick="updateOrderStage(' + orderId + ')">Update Stage</button>' +
                '<button class="portal-btn portal-btn-ghost portal-btn-sm" onclick="cancelStageSelect()">Cancel</button></div>' +
            '<h4>Add Progress Update</h4>' +
            '<div class="portal-field"><input id="update-title" type="text" placeholder="Title" class="portal-input-full"></div>' +
            '<div class="portal-field"><input id="update-msg" type="text" placeholder="Message (optional)" class="portal-input-full"></div>' +
            '<div class="portal-form-inline">' +
                '<input id="update-pct" type="number" min="0" max="100" placeholder="Progress %" style="width:80px;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit">' +
                '<label style="font-size:12px"><input type="checkbox" id="update-public" checked> Visible to customer</label>' +
                '<button class="portal-btn portal-btn-primary portal-btn-sm portal-btn-auto" onclick="addProgressUpdate(' + orderId + ')">Add Update</button></div>' +
            '<h4>Upload Photo</h4>' +
            '<div class="portal-field"><input type="file" id="upload-file" accept="image/*"></div>' +
            '<div class="portal-field"><input id="upload-caption" type="text" placeholder="Caption (optional)" class="portal-input-full"></div>' +
            '<div class="portal-form-inline">' +
                '<label style="font-size:12px"><input type="checkbox" id="upload-public" checked> Visible to customer</label>' +
                '<button class="portal-btn portal-btn-primary portal-btn-sm portal-btn-auto" onclick="uploadPhoto(' + orderId + ')">Upload</button></div>' +
            '</div>';
    }

    window.selectStageOption = function (stage, label) {
        document.getElementById('update-stage').value = stage;
        document.getElementById('stage-confirm-label').textContent = label;
        document.getElementById('stage-confirm').style.display = '';
        var opts = document.querySelectorAll('.portal-stage-option');
        opts.forEach(function (el) { el.classList.remove('active'); });
        document.querySelector('.portal-stage-option[data-stage="' + stage + '"]').classList.add('active');
    };

    window.cancelStageSelect = function () {
        document.getElementById('stage-confirm').style.display = 'none';
        document.querySelectorAll('.portal-stage-option').forEach(function (el) { el.classList.remove('active'); });
    };

    window.updateOrderStage = async function (orderId) {
        var stage = document.getElementById('update-stage').value;
        try {
            await api('/api/portal/sales/orders/' + orderId, { method: 'PATCH', body: JSON.stringify({ current_stage: stage }) });
            await refreshCurrentOrderSummary(orderId);
            await refreshCurrentOrderUpdates(orderId);
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
            document.getElementById('update-title').value = '';
            document.getElementById('update-msg').value = '';
            document.getElementById('update-pct').value = '';
            await refreshCurrentOrderUpdates(orderId);
        } catch (e) { alert('Failed to add update.'); }
    };

    window.focusSalesUpdate = function () {
        var el = document.getElementById('update-title');
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
    };

    window.focusSalesUpload = function () {
        var el = document.getElementById('upload-file');
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
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
            fileEl.value = '';
            document.getElementById('upload-caption').value = '';
            await refreshCurrentOrderMedia(orderId);
        } catch (e) { alert('Upload failed.'); }
    };

    /* ══════════════════════════════════════════════════
       Media loading
       ══════════════════════════════════════════════════ */

    async function loadAuthorizedImages(orderId, media, gridId) {
        var grid = document.getElementById(gridId || 'media-grid');
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
                item.innerHTML = '<img src="' + url + '" alt="' + esc(m.caption || m.original_filename || m.filename || '') + '"><small>' + esc(m.caption || '') + '</small>';
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
        var input = document.getElementById('msg-text');
        var text = input.value.trim();
        if (!text) { alert('Message cannot be empty.'); return; }
        try {
            input.disabled = true;
            await api('/api/portal/orders/' + orderId + '/messages', { method: 'POST', body: JSON.stringify({ message: text }) });
            input.value = '';
            await refreshCurrentOrderMessages(orderId);
        } catch (e) { alert('Failed to send message.'); }
        finally { input.disabled = false; input.focus(); }
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
        var input = document.getElementById('reply-text');
        var text = input.value.trim();
        if (!text) { alert('Reply cannot be empty.'); return; }
        try {
            input.disabled = true;
            await api('/api/portal/sales/orders/' + orderId + '/messages/' + msgId + '/reply', { method: 'POST', body: JSON.stringify({ message: text }) });
            var form = document.getElementById('reply-form');
            if (form) form.remove();
            await refreshCurrentOrderMessages(orderId);
        } catch (e) { alert('Failed to send reply.'); }
    };

    /* ═══ Helpers ═══ */

    function renderTimelineItem(u) {
        var label = stageLabels[u.stage_key] || u.stage_key || 'Update';
        return '<div class="portal-timeline-item"><div class="portal-timeline-dot"></div><div class="portal-timeline-content"><strong>' + esc(u.title || label) + '</strong>' + (u.progress_percent ? ' (' + u.progress_percent + '%)' : '') + (u.message ? '<p style="margin-top:.25rem;color:var(--muted);font-size:13px">' + esc(u.message) + '</p>' : '') + '<small style="color:var(--muted)">' + (u.created_at ? u.created_at.slice(0, 16).replace('T', ' ') : '') + '</small></div></div>';
    }

    async function bootstrapPortal() {
        if (!token()) {
            clearSession();
            leaveAppMode();
            return;
        }
        initPortalBroadcast();
        try {
            var me = await api('/api/portal/auth/me');
            saveSession(token(), me.user);
            connectPortalEvents();
            if (me.user.must_change_password) {
                showChangePassword(true);
            } else {
                routeByRole(me.user.role);
            }
        } catch (e) {
            clearSession();
            leaveAppMode();
        }
    }

    var stageOrder = ["order_confirmed","material_purchasing","material_ready","machining","in_process_qc","surface_treatment","final_inspection","packing","shipped","delivered"];

    bootstrapPortal();

    function renderStageStepper(currentStage) {
        var currentIdx = stageOrder.indexOf(currentStage);
        if (currentIdx < 0) currentIdx = 0;
        return '<div class="portal-stepper">' + stageOrder.map(function (s, i) {
            var cls = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
            return '<div class="portal-stepper-step ' + cls + '"><div class="portal-stepper-dot"></div><small>' + (stageLabels[s] || s) + '</small></div>';
        }).join('') + '</div>';
    }

})();