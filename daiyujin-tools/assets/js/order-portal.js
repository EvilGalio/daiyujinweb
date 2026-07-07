/* Order Portal v4.5 / customer + sales workspace */
(function () {
    window.DaiyujinAPI.checkHealth();

    var portalRoot = document.querySelector('.dyj-order-portal-embed') || document;

    function currentPortalSite() {
        var raw =
            (portalRoot.dataset && (portalRoot.dataset.portalSite || portalRoot.dataset.dyjTheme)) ||
            (window.DAIYUJIN_TOOLS_CONFIG && (window.DAIYUJIN_TOOLS_CONFIG.site || window.DAIYUJIN_TOOLS_CONFIG.theme)) ||
            'default';
        raw = String(raw || 'default').toLowerCase();
        return ['mfg', 'gcindus', 'gcnov', 'default'].indexOf(raw) >= 0 ? raw : 'default';
    }

    function portalBrandName() {
        var site = currentPortalSite();
        if (site === 'mfg') return 'MFG Solution';
        if (site === 'gcindus') return 'GCINDUS';
        if (site === 'gcnov') return 'GCNOV';
        return '';
    }

    function portalFullTitle() {
        var brand = portalBrandName();
        return brand ? brand + ' Order Portal' : 'Order Portal';
    }

    function firstName(name) {
        var raw = (name || '').trim();
        if (!raw) return 'there';
        var base = raw.indexOf('@') >= 0 ? raw.split('@')[0] : raw;
        return base.split(/\s+/)[0] || base;
    }

    function customerGreeting(u) {
        return 'Welcome back, ' + firstName((u && (u.display_name || u.email)) || '');
    }

    function salesGreeting(u) {
        return 'Welcome, ' + firstName((u && (u.display_name || u.email)) || '');
    }

    function adminGreeting(u) {
        return 'Welcome, ' + firstName((u && (u.display_name || u.email)) || '');
    }

    function userDisplayName(u) {
        var raw = (u && (u.display_name || u.email)) || '';
        if (!raw) return 'User';
        if (raw.indexOf('@') >= 0) return raw.split('@')[0];
        return raw;
    }

    function portalWatermarkBrand() {
        var site = currentPortalSite();
        if (site === 'mfg') return 'MFG SOLUTION CO., LIMITED';
        if (site === 'gcindus') return 'GCINDUS CO., LIMITED';
        if (site === 'gcnov') return 'GCNOV';
        return 'DAIYUJIN';
    }

    function updatePortalWatermark() {
        var brand = portalWatermarkBrand();
        var u = user();
        var text = brand + ' / ' + userDisplayName(u) + ' / ' + (u.email || '');
        var root = portalRoot !== document ? portalRoot : document.body;
        var existing = root.querySelector('.portal-watermark-layer');
        if (existing) existing.remove();
        var layer = document.createElement('div');
        layer.className = 'portal-watermark-layer';
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden';
        var html = '';
        for (var y = 0; y < 2000; y += 180) {
            for (var x = 0; x < 2500; x += 400) {
                html += '<span style="position:absolute;left:' + x + 'px;top:' + y + 'px;transform:rotate(-45deg);font-size:14px;color:#000;opacity:0.06;white-space:nowrap;font-family:monospace">' + esc(text) + '</span>';
            }
        }
        layer.innerHTML = html;
        root.appendChild(layer);
    }

    function removePortalWatermark() {
        var root = portalRoot !== document ? portalRoot : document.body;
        var existing = root.querySelector('.portal-watermark-layer');
        if (existing) existing.remove();
    }

    function applyPortalBranding() {
        var titleEl = portalRoot.querySelector
            ? portalRoot.querySelector('[data-portal-title]')
            : document.querySelector('[data-portal-title]');
        if (titleEl) titleEl.textContent = portalFullTitle();
        if (document.title) document.title = portalFullTitle() || 'Order Portal';
    }

    var form = document.querySelector('[data-login-form]');
    var btn = document.querySelector('[data-login-btn]');
    var error = document.querySelector('[data-login-error]');
    var main = document.querySelector('[data-portal-main]');
    if (!form) return;

    var mediaObjectUrls = [];
    var autoRefreshTimer = null;
    var _searchQuery = '';
    var _searchState = { q: '', stage: '', status: '' };

    var portalChannel = null;

    function currentUserKey() {
        var u = user();
        return String(u.id || u.email || 'anonymous');
    }

    function initPortalBroadcast() {
        try {
            portalChannel = new BroadcastChannel('daiyujin-portal');
            portalChannel.onmessage = function (msg) { handlePortalBroadcastMessage(msg); };
        } catch (e) { }
    }

    function broadcastPortalMessage(type, payload) {
        if (!portalChannel) return;
        payload = payload || {};
        payload.userKey = currentUserKey();
        try { portalChannel.postMessage({ type: type, payload: payload }); } catch (e) { }
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
            if (d.payload.reset === true) {
                setLastEventId(d.payload.lastEventId || 0);
            } else {
                portalState.lastEventId = Math.max(portalState.lastEventId, d.payload.lastEventId || 0);
            }
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
        uploadInFlight: false,
        sseConnectedAt: null,
        lastHeartbeatAt: null,
        lastReconnectAt: null,
        consecutiveFailures: 0,
        needsReconcile: false,
        processedEventIds: {},
        processedEventQueue: [],
        navStack: [],
        isNavigatingBack: false,
        pendingStage: null,
        pendingStageLabel: null,
        backTarget: null
    };

    function eventCursorKey() {
        var u = user();
        return 'portal_last_event_id_' + (u.id || u.email || 'anonymous');
    }

    function getLastEventId() { return Number(localStorage.getItem(eventCursorKey()) || 0); }
    function setLastEventId(id) {
        id = Number(id || 0);
        if (id < 0) id = 0;
        portalState.lastEventId = id;
        localStorage.setItem(eventCursorKey(), String(id));
    }

    function setCurrentView(view, opts) {
        opts = opts || {};
        portalState.currentView = view;
        portalState.currentOrderId = opts.orderId || null;
        portalState.currentIsSales = !!opts.isSales;
        portalState.listKind = opts.listKind || null;
    }

    function resetPortalNav() {
        if (portalState.isNavigatingBack) return;
        portalState.navStack = [];
        clearPortalBackTarget();
    }

    function setPortalBackTarget(label, fn, args) {
        portalState.backTarget = { label: label, fn: fn, args: args || [] };
    }

    function clearPortalBackTarget() {
        portalState.backTarget = null;
    }

    function pushPortalView(label, fn, args) {
        if (portalState.isNavigatingBack) return;
        portalState.navStack.push({ label: label, fn: fn, args: args });
    }


    function portalBack() {
        var prev = portalState.backTarget || (portalState.navStack.length ? portalState.navStack.pop() : null);
        if (!prev) return;
        portalState.backTarget = null;
        portalState.isNavigatingBack = true;
        try {
            if (typeof prev.fn === 'function') prev.fn.apply(null, prev.args || []);
        } finally {
            setTimeout(function () { portalState.isNavigatingBack = false; }, 0);
        }
    }
    window.portalBack = portalBack;


    function renderBreadcrumb(stack) {
        if (!stack || !stack.length) return '';
        return '<div class="portal-breadcrumb">' +
            stack.map(function (s) { return '<span>' + esc(s.label) + '</span>'; }).join(' <span class="portal-breadcrumb-separator">/</span> ') +
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
                stopPortalRealtime();
                showChangePassword(true);
            } else {
                startPortalRealtime();
                updatePortalWatermark();
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
        main.innerHTML = renderRoleHeader('Account Settings', 'Account', required ? 'Password change required.' : 'Update your password.') +
            (required ? '<p class="portal-inline-note portal-inline-note-danger">You must change your password before continuing.</p>' : '') +
            '<div class="portal-panel portal-panel-compact portal-panel-spaced">' +
            '<h3>' + (required ? 'Set New Password' : 'Change Password') + '</h3>' +
            '<div class="portal-stack-sm">' +
            '<input id="chpwd-current" class="portal-input-full" type="password" placeholder="Current password">' +
            '<input id="chpwd-new" class="portal-input-full" type="password" placeholder="New password (min 12 characters)">' +
            '<input id="chpwd-confirm" class="portal-input-full" type="password" placeholder="Confirm new password">' +
            '<p id="chpwd-error" class="portal-error" hidden></p>' +
            '<button class="portal-btn portal-btn-primary portal-action-button" onclick="doChangePassword(' + (required ? 'true' : 'false') + ')">' + (required ? 'Set Password & Continue' : 'Change Password') + '</button>' +
            '</div></div>';
        enterAppMode();
    }

    window.doChangePassword = async function (required) {
        var cur = document.getElementById('chpwd-current').value;
        var np = document.getElementById('chpwd-new').value;
        var cf = document.getElementById('chpwd-confirm').value;
        var err = document.getElementById('chpwd-error');
        if (np.length < 12) { err.textContent = 'New password must be at least 12 characters.'; err.hidden = false; return; }
        if (np !== cf) { err.textContent = 'Passwords do not match.'; err.hidden = false; return; }
        err.hidden = true;
        try {
            await api('/api/portal/auth/change-password', { method: 'POST', body: JSON.stringify({ current: cur, new: np }) });
            var currentUser = user();
            currentUser.must_change_password = false;
            saveSession(token(), currentUser);
            startPortalRealtime();
            routeByRole(currentUser.role);
        } catch (e) { err.textContent = e.message; err.hidden = false; }
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


    /* SSE event stream */
    function connectPortalEvents() {
        if (!token()) return;
        disconnectPortalEvents();
        setSyncStatus('connecting');
        var controller = new AbortController();
        portalState.eventAbort = controller;
        streamPortalEvents(controller.signal);
    }

    async function startPortalRealtime() {
        if (!token()) return;
        initPortalBroadcast();

        var localCursor = getLastEventId();
        portalState.lastEventId = localCursor;

        try {
            var snap = await api('/api/portal/snapshot');
            var serverCursor = Number(snap.latest_event_id || 0);

            if (serverCursor < localCursor) {
                console.warn('[portal:sse] local cursor is ahead of server, reset cursor', { localCursor: localCursor, serverCursor: serverCursor });
                setLastEventId(serverCursor);
                broadcastPortalMessage('cursor_updated', { lastEventId: serverCursor, reset: true });
            } else if (serverCursor > localCursor) {
                setLastEventId(serverCursor);
            }

            applySnapshot(snap);
        } catch (e) {
            console.warn('[portal:sse] cursor preflight snapshot failed, continue with local cursor', e);
        }

        connectPortalEvents();
    }

    function stopPortalRealtime() {
        disconnectPortalEvents();
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
        if (eventType === 'heartbeat') {
            portalState.lastHeartbeatAt = Date.now();
            setSyncStatus('live');
            return;
        }
        if (!dataLines.length) return;
        try {
            var evt = JSON.parse(dataLines.join('\n'));
        } catch (e) { return; }
        evt.event_type = evt.event_type || eventType;
        evt.id = id;
        if (id) setLastEventId(id);
        if (!shouldProcessEvent(evt)) return;
        console.info('[portal:sse:event]', evt.event_type, evt.id, evt.order_id || (evt.payload && evt.payload.order_id));
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
        console.info('[portal:sse:patch]', evt.event_type, oid);
        switch (evt.event_type) {
            case 'message_created': refreshCurrentOrderMessages(oid, { force: true }).catch(function() { refreshCurrentOrderMessages(oid); }); break;
            case 'order_update_created': refreshCurrentOrderUpdates(oid); break;
            case 'media_created': refreshCurrentOrderMedia(oid); break;
            case 'order_stage_changed': refreshCurrentOrderSummary(oid); refreshCurrentOrderUpdates(oid); break;
            case 'order_summary_changed': refreshCurrentOrderSummary(oid); break;
            case 'order_internal_changed': if (user().role !== 'customer') refreshCurrentOrderSummary(oid); break;
            case 'complaint_changed': refreshCurrentOrderSummary(oid); break;
            default: reconcilePortalSnapshot('unknown_event_' + evt.event_type);
        }
    }

    function showInlineSyncNotice(msg, retryFn) {
        var el = document.getElementById('order-messages');
        if (!el) return;
        var note = document.createElement('div');
        note.className = 'portal-note-card';
        note.style.cursor = 'pointer';
        note.textContent = msg + ' Click to retry.';
        note.onclick = function () { note.remove(); if (typeof retryFn === 'function') retryFn(); };
        el.insertBefore(note, el.firstChild);
        setTimeout(function () { if (note.parentNode) note.remove(); }, 15000);
    }

    async function refreshCurrentOrderMessages(orderId, opts) {
        opts = opts || {};
        try {
            var resp = await api('/api/portal/orders/' + orderId + '/messages');
            patchMessages(orderId, resp.messages || [], portalState.currentIsSales, opts);
        } catch (e) {
            console.warn('[portal:patch:messages:failed]', e);
            showInlineSyncNotice('Messages could not refresh automatically.', function () { refreshCurrentOrderMessages(orderId); });
        }
    }

    async function refreshCurrentOrderUpdates(orderId) {
        try {
            var resp = await api('/api/portal/orders/' + orderId + '/updates');
            patchTimeline(orderId, resp.updates || []);
        } catch (e) { console.warn('[portal:patch:updates:failed]', e); }
    }

    async function refreshCurrentOrderMedia(orderId) {
        try {
            var resp = await api('/api/portal/orders/' + orderId + '/media');
            patchMedia(orderId, resp.media || []);
        } catch (e) { console.warn('[portal:patch:media:failed]', e); }
    }

    async function refreshCurrentOrderSummary(orderId) {
        try {
            var resp = await api('/api/portal/orders/' + orderId);
            var o = resp.order;
            portalState.ordersById[orderId] = o;
            patchOrderHeader(o);
            patchStageStepper(o.current_stage);
            var actions = document.getElementById('order-sales-actions');
            if (actions && portalState.currentIsSales) actions.innerHTML = renderSalesActions(orderId, o.current_stage);
        } catch (e) { console.warn('[portal:patch:summary:failed]', e); }
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
            if (cur) {
                refreshCurrentOrderSummary(cur.id);
                refreshCurrentOrderUpdates(cur.id);
                refreshCurrentOrderMessages(cur.id);
                refreshCurrentOrderMedia(cur.id);
            }
        }
        if (snap.latest_event_id !== undefined && snap.latest_event_id !== null) setLastEventId(snap.latest_event_id);
    }

    /* Toast */
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
        if (t === 'media_created') return 'New attachment added';
        if (t === 'order_stage_changed') return 'Stage changed';
        if (t === 'order_summary_changed') return 'Order details updated';
        if (t === 'order_created') return 'New order created';
        if (t === 'complaint_changed') return 'Complaint status updated';
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
            el.classList.add('is-clickable');
            el.addEventListener('click', function () {
                var role = user().role;
                if (role === 'customer') showCustomerOrderDetail(opts.orderId);
                else if (role === 'admin' && window.showAdminOrderDetail) window.showAdminOrderDetail(opts.orderId, 'Dashboard', showAdminDashboard, []);
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
        entry.el.classList.add('is-leaving');
        setTimeout(function () { if (entry.el) entry.el.remove(); }, 200);
        portalState.activeToasts = portalState.activeToasts.filter(function (t) { return t !== entry; });
    }

    /* Order card badge */
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
        banner.className = 'portal-note-card portal-list-refresh-banner';
        banner.innerHTML = '<span>Updates available / refresh list</span><button class="portal-btn portal-btn-sm portal-btn-secondary portal-btn-auto">Refresh</button>';
        banner.querySelector('button').onclick = function () {
            banner.remove();
            var role = user().role;
            if (role === 'customer') { showCustomerDashboard(); }
            else if (role === 'sales') { showSalesOrders(); }
            else if (role === 'admin') { showAdminDashboard(); }
        };
        bar.parentNode.insertBefore(banner, bar.nextSibling);
    }

    function refreshAdminOrderBadge() { }

    /* Sync status */
    function setSyncStatus(status) {
        portalState.syncStatus = status;
        var dot = document.getElementById('sync-dot');
        if (dot) {
            dot.className = 'portal-sync-dot portal-sync-' + status;
            dot.title = status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting...' : status === 'offline' ? 'Offline' : status === 'stale' ? 'Data may be stale' : status === 'resyncing' ? 'Syncing...' : 'Connecting...';
        }
        var labels = document.querySelectorAll('[data-sync-label]');
        labels.forEach(function (label) {
            label.innerHTML = '<span class="portal-sync-dot portal-sync-' + status + '"></span>' + syncStatusTitle(status);
        });
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

    window.portalDebugSync = function () {
        return {
            role: user().role,
            email: user().email,
            currentView: portalState.currentView,
            currentOrderId: portalState.currentOrderId,
            currentIsSales: portalState.currentIsSales,
            syncStatus: portalState.syncStatus,
            lastEventId: portalState.lastEventId,
            lastHeartbeatAt: portalState.lastHeartbeatAt,
            hasEventStream: !!portalState.eventAbort,
            reconnectScheduled: !!portalState.eventReconnectTimer
        };
    };


    async function showSalesCustomers() {
        setCurrentView('list', { listKind: 'sales-customers' });
        resetPortalNav();
        clearMediaUrls();
        stopAutoRefresh();
        var u = user();
        main.innerHTML =
            renderRoleHeader('Sales Workspace', salesGreeting(u), 'Ready to move orders forward today.') +
            renderSalesCommandBar('customers') +
            renderCardGridSkeleton(4);
        try {
            var resp = await api('/api/portal/sales/customers');
            var customers = resp.customers || [];
            main.innerHTML =
                renderRoleHeader('Sales Workspace', salesGreeting(u), 'Ready to move orders forward today.') +
                renderSalesCommandBar('customers') +
                '<div class="portal-dashboard">' +
                (customers.length ? customers.map(function (c) {
                    return '<div class="portal-order-card">' +
                        '<h3>' + esc(c.display_name || c.email) + '</h3>' +
                        '<div class="portal-order-meta">' +
                        '<span>' + esc(c.email) + '</span>' +
                        '<span>' + esc(c.company_name || '-') + '</span>' +
                        '<span>' + esc(c.status || '-') + '</span>' +
                        '</div>' +
                        '</div>';
                }).join('') :
                    '<div class="portal-empty-state">' +
                    '<div class="portal-empty-state-icon">👥</div>' +
                    '<h3>No customers yet</h3>' +
                    '<p>Add a customer account before creating orders.</p>' +
                    '<div class="portal-cta-row">' +
                    '<button class="portal-btn" onclick="showCreateCustomer()">Create Customer</button>' +
                    '</div>' +
                    '</div>') +
                '</div>';
        } catch (e) {
            main.innerHTML =
                renderRoleHeader('Sales Workspace', salesGreeting(u), 'Ready to move orders forward today.') +
                renderErrorState('Unable to load customers.', e.message, 'Retry', 'showSalesCustomers()');
        }
    }

    window.showCustomerDashboard = showCustomerDashboard;
    window.showSalesWorkspace = showSalesWorkspace;
    window.showSalesOrders = showSalesOrders;
    window.showSalesCustomers = showSalesCustomers;
    window.showCreateCustomer = showCreateCustomer;
    window.showCreateOrder = showCreateOrder;
    window.showChangePassword = showChangePassword;
    window.clearMediaUrls = clearMediaUrls;

    window.openPortalLightbox = function (url, caption) {
        closePortalLightbox();
        var overlay = document.createElement('div');
        overlay.id = 'portal-lightbox';
        overlay.className = 'portal-lightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Image preview');
        overlay.innerHTML =
            '<button class="portal-lightbox-close" type="button" aria-label="Close">&times;</button>' +
            '<figure><img src="' + url + '" alt="' + esc(caption || 'Production photo') + '">' +
            (caption ? '<figcaption>' + esc(caption) + '</figcaption>' : '') +
            '</figure>';
        overlay.querySelector('.portal-lightbox-close').onclick = closePortalLightbox;
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closePortalLightbox();
        });
        document.body.appendChild(overlay);
        document.body.classList.add('portal-lightbox-open');
    };

    window.closePortalLightbox = function () {
        var old = document.getElementById('portal-lightbox');
        if (old) old.remove();
        document.body.classList.remove('portal-lightbox-open');
    };

    var closePortalLightbox = window.closePortalLightbox;

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closePortalLightbox();
    });

    window.portalLogout = async function () {
        try { await api('/api/portal/auth/logout', { method: 'POST' }); } catch (e) { }
        broadcastPortalMessage('logout', {});
        removePortalWatermark();
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

    function renderBackButton() {
        var target = portalState.backTarget || portalState.navStack[portalState.navStack.length - 1];
        if (!target) return '';
        return '<button onclick="portalBack()" class="portal-btn portal-btn-ghost portal-btn-sm portal-back-button">&larr; Back to ' + esc(target.label || 'Previous') + '</button>';
    }

    function syncStatusTitle(status) {
        return status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting' : status === 'offline' ? 'Offline' : status === 'stale' ? 'Stale' : status === 'resyncing' ? 'Syncing' : 'Connecting';
    }



    function renderSyncLabel() {
        var status = portalState.syncStatus || 'connecting';
        return '<span class="portal-sync-label" data-sync-label><span class="portal-sync-dot portal-sync-' + status + '"></span>' + syncStatusTitle(status) + '</span>';
    }

    function renderRoleHeader(title, name, subtitle) {
        return '<div class="portal-role-header">' +
            '<div class="portal-header-main">' + renderBackButton() +
            '<div><h2>' + esc(title) + '</h2><b>' + esc(name) + '</b>' + (subtitle ? '<span>' + esc(subtitle) + '</span>' : '') + '</div></div>' +
            '<div class="portal-header-actions">' + renderSyncLabel() + '<button onclick="showChangePassword(false)" class="portal-btn portal-btn-ghost portal-btn-sm">Change Password</button>' +
            '<button onclick="portalLogout()" class="portal-btn portal-btn-ghost portal-btn-sm">Sign Out</button></div></div>';
    }

    function refreshRoleHeader(title, name, subtitle) {
        var header = main.querySelector('.portal-role-header');
        if (!header) return;
        header.outerHTML = renderRoleHeader(title, name, subtitle);
    }

    function refreshAdminHeader(subtitle) {
        var me = user();
        refreshRoleHeader('Operations Console', me.display_name || me.email, subtitle || 'Manage reps, customers, orders, and portal activity.');
    }

    /* Skeleton loaders */
    function renderSkeleton(className) {
        return '<div class="portal-skeleton ' + (className || '') + '"></div>';
    }

    function renderTableSkeleton(cols, rows) {
        cols = cols || 4; rows = rows || 5;
        var html = '<div class="portal-panel portal-skeleton-table">';
        for (var r = 0; r < rows; r++) {
            html += '<div class="portal-skeleton portal-skeleton-row"></div>';
        }
        return html + '</div>';
    }

    function renderCardGridSkeleton(count) {
        count = count || 4;
        var cards = [];
        for (var i = 0; i < count; i++) {
            cards.push('<article class="portal-order-card portal-skeleton-card">' +
                renderSkeleton('portal-skeleton-title') +
                renderSkeleton('portal-skeleton-text') +
                renderSkeleton('portal-skeleton-row') +
                '</article>');
        }
        return '<div class="portal-dashboard">' + cards.join('') + '</div>';
    }

    function renderMediaSkeleton(count) {
        count = count || 3;
        var html = '';
        for (var i = 0; i < count; i++) {
            html += '<div class="portal-media-item portal-media-skeleton">' + renderSkeleton('portal-skeleton-img') + renderSkeleton('portal-skeleton-text') + '</div>';
        }
        return html;
    }

    function renderPageShellSkeleton(role) {
        return renderRoleHeader(role || 'Workspace', user().display_name || user().email, 'Loading workspace data.') +
            renderCardGridSkeleton(3);
    }

    function renderOrderDetailSkeleton() {
        return '<div class="portal-panel portal-panel-spaced">' +
            renderSkeleton('portal-skeleton-title') +
            renderSkeleton('portal-skeleton-text') +
            '</div>' +
            '<div class="portal-detail-grid">' +
            '<div class="portal-stack-sm">' + renderSkeleton('portal-skeleton-row') + renderSkeleton('portal-skeleton-row') + renderSkeleton('portal-skeleton-row') + '</div>' +
            '<div class="portal-media-grid">' + renderMediaSkeleton(2) + '</div>' +
            '</div>';
    }

    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    function parsePortalDate(value) {
        if (!value) return null;
        var normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z';
        var d = new Date(normalized);
        return isNaN(d.getTime()) ? null : d;
    }

    function portalTimeZone() {
        var role = user().role;
        if (role === 'customer') return Intl.DateTimeFormat().resolvedOptions().timeZone;
        return 'Asia/Shanghai';
    }

    function formatPortalDateTime(value) {
        var d = parsePortalDate(value);
        if (!d) return '-';
        return new Intl.DateTimeFormat('en-GB', { timeZone: portalTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', '');
    }

    function formatPortalDate(value) {
        var d = parsePortalDate(value);
        if (!d) return '-';
        return new Intl.DateTimeFormat('en-GB', { timeZone: portalTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    }

    var stageLabels = { order_confirmed: 'Order Confirmed', material_ready: 'Material Ready', machining: 'Machining', surface_treatment: 'Surface Treatment', quality_inspection: 'Quality Inspection', packing: 'Packing', shipped: 'Shipped', received: 'Received', on_hold: 'On Hold' };

    /* =========================================
       Customer Dashboard
       ========================================= */

    async function showCustomerDashboard() {
        setCurrentView('list'); resetPortalNav(); clearMediaUrls(); stopAutoRefresh();
        var u = user();
        main.innerHTML = renderRoleHeader('My Orders', customerGreeting(u), 'Track your current production orders.') + renderCardGridSkeleton(3);
        try {
            var resp = await api('/api/portal/orders' + _searchQuery);
            main.innerHTML = renderRoleHeader('My Orders', customerGreeting(u), 'Track your current production orders.') +
                renderSearchBar({ refreshFn: 'showCustomerDashboard' }) + '<div class="portal-dashboard">' + (resp.orders && resp.orders.length ? resp.orders.map(function (order) { return renderOrderCard(order, 'showOrderDetail'); }).join('') : '<div class="portal-empty-state"><div class="portal-empty-state-icon">📦</div><h3>No active orders yet</h3><p>Your manufacturing orders will appear here once your sales representative creates them.</p><p class="portal-muted">If you expected to see an order, contact your sales representative.</p></div>') + '</div>';
        } catch (e) { main.innerHTML = renderRoleHeader('My Orders', customerGreeting(u), 'Track your current production orders.') + renderErrorState('Unable to load orders.', e.message, 'Retry', 'showCustomerDashboard()'); }
    }

    var stageProgress = { order_confirmed: 10, material_ready: 22, machining: 38, surface_treatment: 55, quality_inspection: 70, packing: 82, shipped: 92, received: 100, on_hold: 40 };
    var stageDefaultProgress = 10;

    function renderOrderCard(order, detailFn) {
        if (typeof detailFn !== 'string') detailFn = 'showOrderDetail';
        detailFn = detailFn || 'showOrderDetail';
        var stageLabel = stageLabels[order.current_stage] || 'N/A';
        var progress = stageProgress[order.current_stage] || stageDefaultProgress;
        var status = order.display_status || order.status || 'normal';
        var customerLabel = order.customer_name || (order.customer && (order.customer.display_name || order.customer.email)) || 'Customer';

        return '<article class="portal-order-card portal-order-card-large portal-clickable" id="portal-order-card-' + order.id + '" data-order-id="' + order.id + '" onclick="' + detailFn + '(' + order.id + ')">' +
            '<div class="portal-card-topline">' +
            '<span class="portal-order-no">' + esc(order.order_no) + '</span>' +
            '<span class="portal-badge portal-status-' + esc(status) + '">' + esc(status) + '</span>' +
            '<span class="portal-live-badge" data-order-unread-badge="' + order.id + '" hidden></span>' +
            '</div>' +
            '<div class="portal-card-main">' +
            '<h3>' + esc(order.title || 'Part / Project') + '</h3>' +
            '<span class="portal-card-customer">' + esc(customerLabel) + '</span>' +
            '</div>' +
            '<div class="portal-stage-summary"><span>Current stage</span><strong>' + esc(stageLabel) + '</strong></div>' +
            '<div class="portal-progress-track"><span class="portal-progress-fill" style="--progress:' + progress + '%"></span></div>' +
            '<div class="portal-card-meta-grid">' +
            '<span>Due: ' + esc(formatPortalDate(order.estimated_delivery_date)) + '</span>' +
            '<span>Created: ' + esc(formatPortalDate(order.created_at)) + '</span>' +
            '<span>Shipping: ' + renderDeliveryInfo(order) + '</span>' +
            '<span>Updated: ' + esc(formatPortalDate(order.updated_at)) + '</span>' +
            '</div></article>';
    }

    function renderSalesOrderCard(order) {
        return renderOrderCard(order, 'showSalesOrderDetail');
    }

    /* =========================================
       Admin Workspace / Order Portal Operations Console
       ========================================= */

    function showAdminWorkspace() { clearMediaUrls(); showAdminDashboard(); }
    window.showAdminDashboard = showAdminDashboard;
    window.showAdminTab = showAdminTab;
    window.showAdminCreateUser = showAdminCreateUser;

    async function showAdminDashboard() { showAdminTab("overview"); }

    async function showAdminTab(tab) {
        setCurrentView('list', { listKind: 'admin-' + tab });
        resetPortalNav();
        var me = user();
        main.innerHTML = renderRoleHeader('Operations Console', adminGreeting(me), 'Monitor reps, customers, orders, and activity.') +
            '<div class="portal-admin-tabs">' +
            ['overview', 'sales-reps', 'customers', 'orders', 'activity'].map(function (t) {
                return '<button class="' + (t === tab ? 'active' : '') + '" onclick="showAdminTab(\'' + t + '\')">' + ['Dashboard', 'Sales Reps', 'Customers', 'Orders', 'Activity Logs'][['overview', 'sales-reps', 'customers', 'orders', 'activity'].indexOf(t)] + '</button>';
            }).join('') + '</div>' +
            '<div id="admin-content" class="portal-admin-content">' + renderTableSkeleton(4, 5) + '</div>';
        try {
            if (tab === 'overview') await renderAdminOverview();
            else if (tab === 'sales-reps') await renderAdminSalesReps();
            else if (tab === 'customers') await renderAdminCustomers();
            else if (tab === 'orders') await renderAdminOrders();
            else if (tab === 'activity') await renderAdminActivity();
        } catch (e) { document.getElementById('admin-content').innerHTML = renderErrorState('Unable to load admin data.', e.message, 'Retry', 'showAdminTab(\'' + tab + '\')'); }
    }

    function renderDeliveryInfo(order) {
        if (!order || (order.current_stage !== 'shipped' && order.current_stage !== 'received')) return 'TBD';
        var method = order.shipping_method || 'Shipping';
        var tracking = order.shipping_tracking_no ? ' / ' + esc(order.shipping_tracking_no) : '';
        return method + tracking;
    }

    function renderSearchBar(opts) {
        opts = opts || {};
        _searchState = _searchState || { q: '', stage: '', status: '' };
        var q = _searchState.q || '';
        var stage = _searchState.stage || '';
        var status = _searchState.status || '';
        var refreshFn = opts.refreshFn || '';
        return '<div class="portal-search-bar"><input id="search-q" type="text" placeholder="Search order #, PO, title..." value="' + esc(q) + '">' +
            (opts.stages ? '<select id="search-stage"><option value="">All stages</option>' + opts.stages.map(function (s) { return '<option value="' + s + '"' + selectedAttr(stage, s) + '>' + (stageLabels[s] || s) + '</option>'; }).join('') + '</select>' : '') +
            '<select id="search-status"><option value="">All statuses</option>' +
            '<option value="normal"' + selectedAttr(status, 'normal') + '>Normal</option>' +
            '<option value="delayed"' + selectedAttr(status, 'delayed') + '>Delayed</option>' +
            '<option value="complaint"' + selectedAttr(status, 'complaint') + '>Complaint</option>' +
            '<option value="on_hold"' + selectedAttr(status, 'on_hold') + '>On Hold</option>' +
            '<option value="cancelled"' + selectedAttr(status, 'cancelled') + '>Cancelled</option>' +
            '</select>' +
            '<button class="portal-btn portal-btn-primary portal-btn-sm portal-btn-auto" onclick="applySearch(\'' + refreshFn + '\')">Search</button>' +
            '</div>';
    }

    function renderStatusBadge(status) {
        status = status || 'unknown';
        return '<span class="portal-badge status-' + esc(status) + '">' + esc(status) + '</span>';
    }

    function renderCell(cell) {
        if (cell && typeof cell === 'object' && cell.html != null) return cell.html;
        return esc(cell == null || cell === '' ? '-' : cell);
    }

    function cellTitle(cell) {
        if (cell && typeof cell === 'object') return esc(cell.title || String(cell.html || '').replace(/<[^>]*>/g, ''));
        return esc(cell == null || cell === '' ? '-' : cell);
    }

    function renderAdminTable(config) {
        var columns = config.columns || [];
        var rows = config.rows || [];
        var clickable = rows.some(function (row) { return !!row.onClick; });
        var headers = columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + (clickable ? '<th class="portal-disclosure-col"></th>' : '');
        if (!rows.length) {
            return '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr>' + headers + '</tr></thead><tbody><tr><td class="portal-table-empty" colspan="' + (columns.length + (clickable ? 1 : 0)) + '">' + esc(config.emptyText || 'No records yet.') + '</td></tr></tbody></table></div>';
        }
        return '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr>' + headers + '</tr></thead><tbody>' +
            rows.map(function (row) {
                var cls = row.onClick ? ' class="portal-table-row-clickable"' : '';
                var click = row.onClick ? ' onclick="' + row.onClick + '"' : '';
                var cells = (row.cells || []).map(function (cell) {
                    return '<td title="' + cellTitle(cell) + '">' + renderCell(cell) + '</td>';
                }).join('');
                return '<tr' + cls + click + '>' + cells + (clickable ? '<td class="portal-disclosure">' + (row.onClick ? '&rsaquo;' : '') + '</td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>';
    }

    async function renderAdminOverview() {
        var results = await Promise.all([
            api('/api/portal/admin/overview'),
            api('/api/portal/admin/orders' + _searchQuery),
            api('/api/portal/admin/audit-logs')
        ]);
        var ov = results[0].overview || {};
        var recentOrders = (results[1].orders || []).slice(0, 6);
        var recentLogs = (results[2].logs || []).slice(0, 6);
        var otr = Math.round((ov.on_time_rate || 0) * 100) + '%';
        var cr = Math.round((ov.complaint_rate || 0) * 100) + '%';
        var otrHelp = (ov.on_time_orders || 0) + ' / ' + (ov.total_orders || 0) + ' orders';
        var crHelp = (ov.complaint_orders || 0) + ' / ' + (ov.total_orders || 0) + ' orders';
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-admin-kpi-grid">' +
            ['Active Sales Reps', 'Active Customers', 'Orders in Production', 'Updates Today', 'On-time Rate', 'Complaint Rate'].map(function (label, i) {
                var val = [ov.sales_count, ov.customer_count, ov.active_orders, ov.updates_today, otr, cr][i];
                var help = ['People responsible for customers', 'Assigned customer accounts', 'Orders currently in production', 'Progress entries today', otrHelp, crHelp][i];
                return '<div class="portal-admin-kpi"><strong>' + val + '</strong><span>' + label + '</span><small>' + help + '</small></div>';
            }).join('') + '</div>' +
            '<div class="portal-admin-overview-grid">' +
            '<section class="portal-panel portal-admin-overview-main"><div class="portal-command-bar"><h3>Recent Orders</h3><span>Latest active production records</span></div>' +
            renderAdminTable({
                columns: ['Order', 'Customer', 'Sales', 'Stage', 'Status'],
                rows: recentOrders.map(function (o) {
                    return { onClick: 'showAdminOrderDetail(' + o.id + ', \'Dashboard\', showAdminDashboard, [])', cells: [o.order_no + ' ' + (o.title || ''), o.customer_name || '-', o.sales_name || '-', o.current_stage || 'N/A', { html: renderStatusBadge(o.display_status || o.status), title: o.display_status || o.status }] };
                }),
                emptyText: 'No recent orders.'
            }) + '</section>' +
            '<section class="portal-panel portal-admin-overview-side"><div class="portal-command-bar"><h3>Recent Activity</h3><span>Portal operations</span></div>' +
            renderActivityTable(recentLogs) +
            '<div class="portal-cta-row portal-cta-row-left"><button class="portal-btn portal-btn-primary portal-btn-auto" onclick="showAdminCreateUser()">+ Create User</button><button class="portal-btn portal-btn-secondary portal-btn-auto" onclick="showAdminTab(\'orders\')">View Orders</button></div></section></div>';
    }

    async function renderAdminSalesReps() {
        var d = await api('/api/portal/admin/sales-reps');
        var reps = d.sales_reps || [];
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-command-bar"><h3>Sales Reps</h3><span>Monitor workload and customer ownership. ' + reps.length + ' reps found.</span><button class="portal-btn portal-btn-primary portal-btn-sm" onclick="showAdminCreateUser()">+ Create User</button></div>' +
            renderAdminTable({
                columns: ['Name', 'Email', 'Status', 'Customers', 'Orders', 'Last Activity'],
                rows: reps.map(function (r) {
                    return {
                        onClick: 'showAdminSalesRepDetail(' + r.id + ')',
                        cells: [
                            r.display_name || '-',
                            r.email,
                            { html: renderStatusBadge(r.status), title: r.status },
                            r.customer_count,
                            r.order_count,
                            (r.last_action || '-') + ' ' + (formatPortalDateTime(r.last_activity))
                        ]
                    };
                }),
                emptyText: 'No sales reps yet.'
            });
    }

    window.showAdminSalesRepDetail = async function (sid) {
        setPortalBackTarget('Sales Reps', showAdminTab, ['sales-reps']); pushPortalView('Sales Reps', showAdminTab, ['sales-reps']);
        refreshAdminHeader('Sales representative detail.');
        var d = await api('/api/portal/admin/sales-reps/' + sid);
        var r = d.rep; var cxs = d.customers || []; var ords = d.orders || []; var logs = d.recent_logs || [];
        document.getElementById('admin-content').innerHTML =
            '<h3>' + esc(r.display_name || r.email) + ' <span class="portal-badge status-' + (r.status || 'active') + '">' + esc(r.status || 'active') + '</span></h3>' +
            '<p>Email: ' + esc(r.email) + '</p>' +
            '<h4>Customers (' + cxs.length + ')</h4>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead><tbody>' +
            cxs.map(function (c) { return '<tr><td>' + esc(c.display_name || '-') + '</td><td>' + esc(c.email) + '</td><td>' + esc(c.status) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
            '<h4>Orders (' + ords.length + ')</h4>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Order</th><th>Stage</th><th>Status</th></tr></thead><tbody>' +
            ords.map(function (o) { return '<tr onclick="showAdminOrderDetail(' + o.id + ', \'Sales Rep\', showAdminSalesRepDetail, [' + sid + '])" class="portal-clickable"><td>' + esc(o.order_no) + ' ' + esc(o.title) + '</td><td>' + esc(o.current_stage || 'N/A') + '</td><td>' + esc(o.display_status || o.status) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
            '<h4>Recent Activity</h4>' +
            renderActivityTable(logs);
    };

    async function renderAdminCustomers() {
        var d = await api('/api/portal/admin/customers');
        var cxs = d.customers || [];
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-command-bar"><h3>Customers</h3><span>Search by name, company, email, or sales rep. ' + cxs.length + ' records.</span></div>' +
            renderAdminTable({
                columns: ['Name', 'Email', 'Sales Rep', 'Orders', 'Latest Status'],
                rows: cxs.map(function (c) {
                    return {
                        onClick: 'showAdminCustomerDetail(' + c.id + ')',
                        cells: [c.display_name || '-', c.email, c.sales_name || '-', c.order_count, c.latest_order_status || '-']
                    };
                }),
                emptyText: 'No customers yet.'
            });
    }

    window.showAdminCustomerDetail = async function (cid) {
        setPortalBackTarget('Customers', showAdminTab, ['customers']); pushPortalView('Customers', showAdminTab, ['customers']);
        refreshAdminHeader('Customer detail.');
        var d = await api('/api/portal/admin/customers/' + cid);
        var c = d.customer; var ords = d.orders || [];
        document.getElementById('admin-content').innerHTML =
            '<h3>' + esc(c.display_name || c.email) + ' <span class="portal-badge status-' + (c.status || 'active') + '">' + esc(c.status || 'active') + '</span></h3>' +
            '<p>Email: ' + esc(c.email) + ' | Sales: ' + esc(d.sales_name || 'Unassigned') + '</p>' +
            '<h4>Orders (' + ords.length + ')</h4>' +
            '<div class="portal-table-wrap"><table class="portal-admin-table"><thead><tr><th>Order</th><th>Stage</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
            ords.map(function (o) { return '<tr onclick="showAdminOrderDetail(' + o.id + ', \'Customer\', showAdminCustomerDetail, [' + cid + '])" class="portal-clickable"><td>' + esc(o.order_no) + ' ' + esc(o.title) + '</td><td>' + esc(o.current_stage || 'N/A') + '</td><td>' + esc(o.display_status || o.status) + '</td><td>' + formatPortalDate(o.updated_at) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    };

    async function renderAdminOrders() {
        var d = await api('/api/portal/admin/orders' + _searchQuery);
        var ords = d.orders || [];
        document.getElementById('admin-content').innerHTML =
            renderSearchBar({ stages: stageOrder, refreshFn: 'showAdminTab' }) +
            '<div class="portal-command-bar"><h3>Orders</h3><span>All orders across all sales reps and customers. ' + ords.length + ' total.</span></div>' +
            renderAdminTable({
                columns: ['Order #', 'Title', 'Customer', 'Sales', 'Stage', 'Status', 'Updated'],
                rows: ords.map(function (o) {
                    return {
                        onClick: 'showAdminOrderDetail(' + o.id + ')',
                        cells: [o.order_no, o.title || '-', o.customer_name || '-', o.sales_name || '-', o.current_stage || 'N/A', { html: renderStatusBadge(o.display_status || o.status), title: o.display_status || o.status }, formatPortalDate(o.updated_at)]
                    };
                }),
                emptyText: 'No orders yet.'
            });
    }

    window.showAdminOrderDetail = async function (orderId, backLabel, backFn, backArgs, opts) {
        opts = opts || {};
        if (!opts.skipPush) {
            setPortalBackTarget(backLabel || 'Orders', backFn || showAdminTab, backArgs || ['orders']);
            pushPortalView(backLabel || 'Orders', backFn || showAdminTab, backArgs || ['orders']);
        }
        refreshAdminHeader('Order detail.');
        var d = await api('/api/portal/admin/orders/' + orderId + '/full');
        var o = d.order;
        var content = document.getElementById('admin-content');
        content.innerHTML = '<h3>Order ' + esc(o.order_no) + ': ' + esc(o.title) + '</h3>' +
            '<div class="portal-admin-detail-layout">' +
            '<div><strong>Customer:</strong> ' + esc((o.customer || {}).display_name || (o.customer || {}).email || '-') + '<br>' +
            '<strong>Sales:</strong> ' + esc((o.sales || {}).display_name || (o.sales || {}).email || '-') + '<br>' +
            '<strong>Stage:</strong> ' + esc(o.current_stage || 'N/A') + ' | <strong>Status:</strong> ' + esc(o.display_status || o.status) + '<br>' +
            '<strong>Delivery:</strong> ' + esc(renderDeliveryInfo(o)) + '<br>' +
            '<strong>PO:</strong> ' + esc(o.po_number || '-') + '</div>' +
            '<div><button class="portal-btn portal-btn-secondary portal-btn-auto" onclick="showAdminAssignSales(' + o.id + ')">Transfer Sales Rep</button></div></div>' +
            '<h4>Timeline</h4>' + (o.updates || []).map(function (u) { return '<div class="portal-msg"><strong>' + esc(u.title) + '</strong><small> ' + formatPortalDateTime(u.created_at) + '</small><p>' + esc(u.message || '-') + '</p></div>'; }).join('') +
            '<h4>Messages (' + (o.messages || []).length + ')</h4>' + (o.messages || []).map(function (m) {
                return '<div class="portal-msg' + (m.parent_message_id ? ' portal-msg-reply' : '') + '"><strong>User #' + m.sender_user_id + '</strong><small> ' + formatPortalDateTime(m.created_at) + '</small><p>' + esc(m.message) + '</p></div>';
            }).join('') +
            '<h4>Attachments (' + (o.media || []).length + ')</h4>' +
            '<div class="portal-media-grid" id="admin-media-grid">' + ((o.media || []).length ? renderMediaSkeleton(Math.min((o.media || []).length, 6)) : '<div class="portal-empty">No attachments yet.</div>') + '</div>';
        if ((o.media || []).length) loadAuthorizedImages(o.id, o.media, 'admin-media-grid');
    };

    window.showAdminAssignSales = function (orderId) {
        var sid = prompt('Enter new sales user ID:');
        if (!sid) return;
        var parsed = parseInt(sid, 10);
        if (isNaN(parsed)) { alert('Must be a number.'); return; }
        api('/api/portal/admin/orders/' + orderId + '/assign-sales', { method: 'PATCH', body: JSON.stringify({ sales_user_id: parsed }) })
            .then(function () { showAdminOrderDetail(orderId, null, null, null, { skipPush: true }); }).catch(function () { alert('Transfer failed. Check the sales user ID is valid and active.'); });
    };

    async function renderAdminActivity() {
        var d = await api('/api/portal/admin/audit-logs');
        var logs = d.logs || [];
        document.getElementById('admin-content').innerHTML =
            '<div class="portal-command-bar"><h3>Activity Logs</h3><span>Trace portal actions by admins and sales reps. ' + logs.length + ' entries.</span></div>' + renderActivityTable(logs);
    }

    function renderActivityTable(logs) {
        return renderAdminTable({
            columns: ['Time', 'User', 'Role', 'Action', 'Entity'],
            rows: (logs || []).map(function (l) {
                return {
                    cells: [
                        formatPortalDateTime(l.created_at),
                        l.actor_email || '-',
                        { html: renderStatusBadge(l.actor_role || '-'), title: l.actor_role || '-' },
                        l.action || '-',
                        (l.entity_type || '') + ' ' + (l.entity_label || '')
                    ]
                };
            }),
            emptyText: 'No activity logs yet.'
        });
    }

    window.adminDisableUser = async function (userId) {
        if (!confirm('Disable this user?')) return;
        try { await api('/api/portal/admin/users/' + userId, { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) }); showAdminTab('sales-reps'); }
        catch (e) { alert('Failed to disable user.'); }
    };

    var selectedAdminSalesRep = null;
    var adminSalesRepsCache = [];

    function showAdminCreateUser() {
        setPortalBackTarget('Dashboard', showAdminDashboard, []); pushPortalView('Dashboard', showAdminDashboard, []);
        stopAutoRefresh();
        var me = user();
        selectedAdminSalesRep = null;
        main.innerHTML = renderRoleHeader('Operations Console', adminGreeting(me), 'Create a new user account.') +
            '<div class="portal-panel portal-panel-compact">' +
            '<h3>Create User</h3>' +
            '<div class="portal-stack-sm">' +
            '<div class="portal-field"><label>Email</label><input id="new-user-email" type="email" placeholder="Email"></div>' +
            '<div class="portal-field"><label>Display name</label><input id="new-user-name" placeholder="Optional"></div>' +
            '<div class="portal-field"><label>Role</label><select id="new-user-role"><option value="sales">Sales</option><option value="admin">Admin</option><option value="customer">Customer</option></select></div>' +
            '<div id="admin-sales-picker" class="portal-field" hidden>' +
            '<label>Bind Sales Rep</label>' +
            '<input id="admin-sales-search" placeholder="Search sales name or email">' +
            '<div id="admin-sales-selected"></div>' +
            '<div id="admin-sales-results"></div>' +
            '</div>' +
            '<button class="portal-btn portal-btn-primary portal-action-button" onclick="adminCreateUser()">Create User</button></div></div>';
        document.getElementById('new-user-role').addEventListener('change', function () {
            var isCust = this.value === 'customer';
            document.getElementById('admin-sales-picker').hidden = !isCust;
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
                    '<span>' + esc(r.email) + ' / ' + (r.customer_count || 0) + ' customers</span>' +
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

    window.adminCreateUser = async function () {
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

    /* =========================================
       Sales Workspace
       ========================================= */

    function showSalesWorkspace() { clearMediaUrls(); showSalesOrders(); }

    async function showSalesOrders() {
        setCurrentView('list', { listKind: 'sales-orders' });
        var u = user();
        resetPortalNav();
        clearMediaUrls();
        stopAutoRefresh();
        main.innerHTML = renderRoleHeader('Sales Workspace', salesGreeting(u), 'Ready to move orders forward today.') +
            renderSalesCommandBar('orders') + renderSearchBar({ stages: stageOrder, refreshFn: 'showSalesOrders' }) + renderCardGridSkeleton(4);
        try {
            var results = await Promise.all([
                api('/api/portal/sales/overview'),
                api('/api/portal/orders' + _searchQuery)
            ]);
            var ov = results[0].overview || {};
            var orders = results[1].orders || [];
            var otr = Math.round((ov.on_time_rate || 0) * 100) + '%';
            var cr = Math.round((ov.complaint_rate || 0) * 100) + '%';
            main.innerHTML = renderRoleHeader('Sales Workspace', salesGreeting(u), 'Ready to move orders forward today.') +
                renderSalesCommandBar('orders') + renderSearchBar({ stages: stageOrder, refreshFn: 'showSalesOrders' }) +
                '<div class="portal-admin-kpi-grid" style="margin-bottom:1rem"><div class="portal-admin-kpi"><strong>' + otr + '</strong><span>On-time Rate</span><small>' + (ov.on_time_orders || 0) + ' / ' + (ov.total_orders || 0) + ' orders</small></div>' +
                '<div class="portal-admin-kpi"><strong>' + cr + '</strong><span>Complaint Rate</span><small>' + (ov.complaint_orders || 0) + ' / ' + (ov.total_orders || 0) + ' orders</small></div></div>' +
                '<div class="portal-dashboard">' + (orders.length ? orders.map(renderSalesOrderCard).join('') :
                    '<div class="portal-empty-state"><div class="portal-empty-state-icon">📋</div><h3>No orders yet</h3><p>Create a customer first, then create the first order.</p><div class="portal-cta-row"><button class="portal-btn" onclick="showCreateCustomer()">Create Customer</button><button class="portal-btn portal-btn-secondary" onclick="showCreateOrder()">Create Order</button></div></div>') + '</div>';
        } catch (e) { main.innerHTML = renderRoleHeader('Sales Workspace', salesGreeting(u), 'Ready to move orders forward today.') + renderErrorState('Unable to load orders.', e.message, 'Retry', 'showSalesOrders()'); }
    }


    function renderSalesCommandBar(activeTab) {
        return '<div class="portal-sales-tabs">' +
            '<button' + (activeTab === 'orders' ? ' class="active"' : '') + ' onclick="showSalesOrders()">Orders</button>' +
            '<button' + (activeTab === 'customers' ? ' class="active"' : '') + ' onclick="showSalesCustomers()">Customers</button>' +
            '<div class="portal-nav-spacer"></div>' +
            '<button type="button" onclick="showCreateCustomer()" class="portal-btn portal-btn-secondary portal-btn-sm">+ Customer</button>' +
            '<button type="button" onclick="showCreateOrder()" class="portal-btn portal-btn-primary portal-btn-sm">+ Order</button>' +
            '</div>';
    }


    function showCreateCustomer() {
        setCurrentView('list', { listKind: 'form' });
        stopAutoRefresh();
        main.innerHTML = renderRoleHeader('Sales Workspace', salesGreeting(user()), 'Add a new customer account.') +
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
        main.innerHTML = renderRoleHeader('Sales Workspace', salesGreeting(user()), 'Create a new order.') +
            '<div class="portal-panel portal-panel-narrow"><h3>Create Order</h3>' +
            '<div class="portal-field"><label>Customer</label>' +
            '<input id="order-customer-search" type="text" placeholder="Search customer name, company, or email">' +
            '<div id="order-customer-selected"></div>' +
            '<div id="order-customer-results"></div></div>' +
            '<div class="portal-field"><label>Title / Part Name</label><input id="new-order-title" type="text" placeholder="Widget Assembly"></div>' +
            '<div class="portal-field"><label>Estimated Delivery Date</label><input id="new-order-delivery-date" type="date"></div><div class="portal-field"><label>PO Number</label><input id="new-order-po" type="text" placeholder="Optional"></div>' +
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
                    '<span>' + esc(c.email) + (c.company_name ? ' / ' + esc(c.company_name) : '') + '</span>' +
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
            var due = document.getElementById('new-order-delivery-date').value; var body = { customer_user_id: selectedOrderCustomer.id, title: title, site: currentPortalSite(), theme: currentPortalSite() }; if (due) body.estimated_delivery_date = due;
            if (po) body.po_number = po;
            await api('/api/portal/sales/orders', { method: 'POST', body: JSON.stringify(body) });
            showSalesOrders();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
    };

    /* =========================================
       Order Detail (shared)
       ========================================= */

    window.showOrderDetail = showCustomerOrderDetail;
    window.showSalesOrderDetail = showSalesOrderDetail;

    async function showCustomerOrderDetail(orderId) {
        setPortalBackTarget('My Orders', showCustomerDashboard, []);
        main.innerHTML = renderRoleHeader('Order Detail', userDisplayName(user()), '') + renderOrderDetailSkeleton();
        try {
            var orderResp = await api('/api/portal/orders/' + orderId);
            var o = orderResp.order;
            var updates = [], messages = [], media = [];
            var detailErrors = { updates: false, messages: false, media: false };
            renderOrderDetail(o, updates, messages, media, false, detailErrors);
            Promise.allSettled([
                api('/api/portal/orders/' + orderId + '/updates'),
                api('/api/portal/orders/' + orderId + '/messages'),
                api('/api/portal/orders/' + orderId + '/media')
            ]).then(function(parts) {
                if (parts[0].status === 'fulfilled') { patchTimeline(orderId, parts[0].value.updates || []); }
                else { var elU = document.getElementById('order-timeline'); if (elU) elU.innerHTML = '<div class="portal-note-card">Updates unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderUpdates(' + orderId + ')">Retry</a></div>'; }
                if (parts[1].status === 'fulfilled') { patchMessages(orderId, parts[1].value.messages || [], false); }
                else { var elM = document.getElementById('order-messages'); if (elM) elM.innerHTML = '<div class="portal-note-card">Messages unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderMessages(' + orderId + ')">Retry</a></div>'; }
                if (parts[2].status === 'fulfilled') { patchMedia(orderId, parts[2].value.media || []); }
                else { var elD = document.getElementById('order-media'); if (elD) elD.innerHTML = '<div class="portal-note-card">Attachments unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderMedia(' + orderId + ')">Retry</a></div>'; }
            });
        } catch (e) { console.error('Order detail load failed:', e); main.innerHTML = renderErrorState('Unable to load order details.', e && e.message ? e.message : 'The order detail request or rendering failed.', 'Back to My Orders', 'showCustomerDashboard()'); }
    }

    async function showSalesOrderDetail(orderId) {
        setPortalBackTarget('Orders', showSalesOrders, []);
        main.innerHTML = renderRoleHeader('Order Detail', userDisplayName(user()), '') + renderOrderDetailSkeleton();
        try {
            var orderResp = await api('/api/portal/orders/' + orderId);
            var o = orderResp.order;
            var updates = [], messages = [], media = [];
            var detailErrors = { updates: false, messages: false, media: false };
            renderOrderDetail(o, updates, messages, media, true, detailErrors);
            Promise.allSettled([
                api('/api/portal/orders/' + orderId + '/updates'),
                api('/api/portal/orders/' + orderId + '/messages'),
                api('/api/portal/orders/' + orderId + '/media')
            ]).then(function(parts) {
                if (parts[0].status === 'fulfilled') { patchTimeline(orderId, parts[0].value.updates || []); }
                else { var elU = document.getElementById('order-timeline'); if (elU) elU.innerHTML = '<div class="portal-note-card">Updates unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderUpdates(' + orderId + ')">Retry</a></div>'; }
                if (parts[1].status === 'fulfilled') { patchMessages(orderId, parts[1].value.messages || [], true); }
                else { var elM = document.getElementById('order-messages'); if (elM) elM.innerHTML = '<div class="portal-note-card">Messages unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderMessages(' + orderId + ')">Retry</a></div>'; }
                if (parts[2].status === 'fulfilled') { patchMedia(orderId, parts[2].value.media || []); }
                else { var elD = document.getElementById('order-media'); if (elD) elD.innerHTML = '<div class="portal-note-card">Attachments unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderMedia(' + orderId + ')">Retry</a></div>'; }
            });
        } catch (e) { console.error('Order detail load failed:', e); main.innerHTML = renderErrorState('Unable to load order details.', e && e.message ? e.message : 'The order detail request or rendering failed.', 'Back to Orders', 'showSalesOrders()'); }
    }

    function renderOrderDetail(o, updates, messages, media, isSales, detailErrors) {
        enterAppMode();
        detailErrors = detailErrors || {};
        setCurrentView('order-detail', { orderId: o.id, isSales: isSales });
        clearOrderChanged(o.id);
        portalState.ordersById[o.id] = o;
        portalState.updatesByOrderId[o.id] = updates;
        portalState.messagesByOrderId[o.id] = messages;
        portalState.mediaByOrderId[o.id] = media;
        portalState.pendingStage = null;
        portalState.pendingStageLabel = null;

        main.innerHTML =
            renderRoleHeader('Order Detail', userDisplayName(user()), '') +
            '<div id="order-header" class="portal-panel portal-panel-spaced"></div>' +
            (isSales ? '<div id="order-sales-actions">' + renderSalesActions(o.id, o.current_stage) + '</div>' : '') +
            '<div id="order-stepper"></div>' +
            '<div class="portal-detail-grid">' +
            '<div>' +
            '<div class="portal-section-title">Progress Timeline</div>' +
            '<div id="order-timeline" class="portal-timeline"></div>' +
            '<div id="order-messages"></div>' +
            '</div>' +
            '<div>' +
            '<div class="portal-section-title">Attachments</div>' +
            '<div class="portal-media-grid" id="order-media"></div>' +
            (isSales ? '<div class="portal-section-title">Actions</div><div class="portal-action-rail">' +
                '<button class="portal-btn portal-btn-secondary" onclick="focusSalesUpdate()">Go to Progress Form</button>' +
                '<button class="portal-btn portal-btn-secondary" onclick="focusSalesUpload()">Go to Attachment Upload</button></div>' : '') +
            '</div></div>';

        patchOrderHeader(o, isSales);
        patchStageStepper(o.current_stage);
        patchTimeline(o.id, updates);
        patchMessages(o.id, messages, isSales);
        patchMedia(o.id, media);

        if (detailErrors.updates) { var elU = document.getElementById('order-timeline'); if (elU) elU.innerHTML += '<div class="portal-note-card" style="cursor:pointer">Updates unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderUpdates(' + o.id + ')">Retry</a></div>'; }
        if (detailErrors.messages) { var elM = document.getElementById('order-messages'); if (elM) elM.innerHTML = '<div class="portal-note-card" style="cursor:pointer">Messages unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderMessages(' + o.id + ')">Retry</a></div>'; }
        if (detailErrors.media) { var elD = document.getElementById('order-media'); if (elD) elD.innerHTML = '<div class="portal-note-card" style="cursor:pointer">Attachments unavailable - <a href="javascript:void(0)" onclick="refreshCurrentOrderMedia(' + o.id + ')">Retry</a></div>'; }
    }

    function patchOrderHeader(o, isSalesView) {
        if (typeof isSalesView === 'undefined') isSalesView = !!portalState.currentIsSales;
        var el = document.getElementById('order-header');
        if (!el) return;
        el.innerHTML =
            '<h3 class="portal-order-title">' + esc(o.title) + ' <small>#' + esc(o.order_no) + '</small></h3>' +
            '<div class="portal-order-meta portal-order-meta-spaced">' +
            '<span>Status: <span class="portal-badge portal-status-' + esc(o.display_status || o.status) + '">' + esc(o.display_status || o.status) + '</span></span>' +
            '<span>Delivery: ' + renderDeliveryInfo(o) + '</span></div>' +
            (o.customer_visible_note ? '<div class="portal-note-card">' + esc(o.customer_visible_note) + '</div>' : '') + (!isSalesView && o.current_stage === 'received' && o.manual_status !== 'complaint' ? '<button class="portal-btn portal-btn-danger portal-btn-sm portal-btn-auto portal-complaint-btn" onclick="submitComplaint(' + o.id + ')">Report an issue with this order</button>' : '');
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

    function patchMessages(orderId, messages, isSales, opts) {
        var el = document.getElementById('order-messages');
        if (!el) return;
        opts = opts || {};
        var mainActive = document.activeElement && document.activeElement.id === 'msg-text';
        var replyActive = document.activeElement && document.activeElement.id === 'reply-text';
        var mainInput = document.getElementById('msg-text');
        var replyInput = document.getElementById('reply-text');
        var mainDraft = mainInput ? mainInput.value : '';
        var replyDraft = replyInput ? replyInput.value : '';
        var mainWasFocused = document.activeElement === mainInput;
        var replyWasFocused = document.activeElement === replyInput;
        portalState.messagesByOrderId[orderId] = messages || [];
        if ((mainActive || replyActive) && !opts.force) {
            var banner = document.getElementById('order-messages-banner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'order-messages-banner';
                banner.className = 'portal-note-card portal-message-refresh-banner';
                banner.textContent = 'New messages available / click to refresh';
                banner.onclick = function () { banner.remove(); patchMessages(orderId, portalState.messagesByOrderId[orderId], isSales); };
                el.insertBefore(banner, el.firstChild);
            }
            return;
        }
        var banner = document.getElementById('order-messages-banner');
        if (banner) banner.remove();
        el.innerHTML = renderMessages(messages, isSales, orderId);
        var newInput = document.getElementById('msg-text');
        if (newInput && typeof mainDraft === 'string') newInput.value = mainDraft;
        if (newInput && mainWasFocused) newInput.focus();
        var newReplyInput = document.getElementById('reply-text');
        if (newReplyInput && typeof replyDraft === 'string') newReplyInput.value = replyDraft;
        if (newReplyInput && replyWasFocused) newReplyInput.focus();
        bindMessageRetryLinks(el, orderId);
    }

    function patchMedia(orderId, media) {
        var el = document.getElementById('order-media');
        if (!el) return;
        clearMediaUrls();
        portalState.mediaByOrderId[orderId] = media || [];
        el.innerHTML = media && media.length
            ? renderMediaSkeleton(Math.min(media.length, 6))
            : '<div class="portal-empty">No attachments yet.</div>';
        if (media && media.length) loadAuthorizedImages(orderId, media, 'order-media');
    }

    function renderSalesActions(orderId, currentStage) {
        var currentIdx = stageOrder.indexOf(currentStage);
        var actionStages = stageOrder;
        return '<div class="portal-sales-actions" id="sales-actions">' +
            '<section class="portal-action-card"><h4>Stage Control</h4>' +
            '<div class="portal-stage-meta"><span>Current</span><strong id="stage-current-label">' + esc(stageLabels[currentStage] || currentStage || 'N/A') + '</strong></div>' +
            '<div class="portal-stage-control" id="stage-control">' +
            actionStages.map(function (k, i) {
                var cls = k === currentStage ? ' portal-stage-current' : (currentIdx >= 0 && i < currentIdx ? ' portal-stage-done' : ' portal-stage-future');
                return '<button type="button" class="portal-stage-option' + cls + '" data-stage="' + k + '" onclick="selectStageOption(\'' + k + '\', \'' + stageLabels[k] + '\')">' + stageLabels[k] + '</button>';
            }).join('') + '</div>' +
            '<div id="stage-confirm" class="portal-stage-confirm" hidden>' +
            '<p><span>Current</span><strong id="stage-confirm-current">' + esc(stageLabels[currentStage] || currentStage || 'N/A') + '</strong></p>' +
            '<p><span>Switch to</span><strong id="stage-confirm-label"></strong></p>' +
            '<button class="portal-btn portal-btn-primary portal-btn-sm" onclick="updateOrderStage(' + orderId + ')">Update Stage</button>' +
            '<button class="portal-btn portal-btn-ghost portal-btn-sm" onclick="cancelStageSelect()">Cancel</button>' +
            '<div id="stage-shipping-fields" class="portal-stage-shipping" hidden>' +
            '<p style="margin-top:.5rem"><select id="stage-shipping-method" style="width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit"><option value="">Method</option><option>DHL</option><option>FedEx</option><option>Sea</option><option>Other</option></select></p>' +
            '<p><input id="stage-shipping-tracking" placeholder="Tracking number" style="width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit"></p></div>' +
            '</div></section>' +
            '<section class="portal-action-card"><h4>Add Progress Update</h4>' +
            '<div class="portal-field"><input id="update-title" type="text" placeholder="Title" class="portal-input-full"></div>' +
            '<div class="portal-field"><input id="update-msg" type="text" placeholder="Message (optional)" class="portal-input-full"></div>' +
            '<div class="portal-form-inline">' +
            '<input id="update-pct" class="portal-input-mini" type="number" min="0" max="100" placeholder="Progress %">' +
            '<label class="portal-check"><input type="checkbox" id="update-public" checked> Visible to customer</label>' +
            '<button class="portal-btn portal-btn-primary portal-btn-sm portal-btn-auto" onclick="addProgressUpdate(' + orderId + ')">Add Update</button></div></section>' +
            '<section class="portal-action-card"><h4>Upload Attachment</h4>' +
            '<div class="portal-field"><select id="upload-stage-key" style="width:100%;padding:.35rem;border:1px solid var(--line);border-radius:4px;font:inherit">' + stageOrder.map(function (k) { return '<option value="' + k + '">' + (stageLabels[k] || k) + '</option>'; }).join('') + '</select></div>' +
            '<div class="portal-field"><input type="file" id="upload-file" accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime"></div>' +
            '<div class="portal-field"><input id="upload-caption" type="text" placeholder="Caption (optional)" class="portal-input-full"></div>' +
            '<div class="portal-form-inline">' +
            '<label class="portal-check"><input type="checkbox" id="upload-public" checked> Visible to customer</label>' +
            '<button class="portal-btn portal-btn-primary portal-btn-sm portal-btn-auto" id="upload-btn" onclick="uploadPhoto(' + orderId + ')">Upload</button></div></section>' +
            '</div>';
    }

    window.selectStageOption = function (stage, label) {
        portalState.pendingStage = stage;
        portalState.pendingStageLabel = label;
        document.getElementById('stage-confirm-label').textContent = label;
        document.getElementById('stage-confirm').hidden = false;
        var shippingFields = document.getElementById('stage-shipping-fields');
        if (shippingFields) shippingFields.hidden = stage !== 'shipped';
        var opts = document.querySelectorAll('.portal-stage-option');
        opts.forEach(function (el) { el.classList.remove('active'); });
        document.querySelector('.portal-stage-option[data-stage="' + stage + '"]').classList.add('active');
    };

    window.cancelStageSelect = function () {
        portalState.pendingStage = null;
        portalState.pendingStageLabel = null;
        document.getElementById('stage-confirm').hidden = true;
        document.querySelectorAll('.portal-stage-option').forEach(function (el) { el.classList.remove('active'); });
    };

    window.updateOrderStage = async function (orderId) {
        var stage = portalState.pendingStage;
        if (!stage) { alert('Please select a new stage first.'); return; }
        var body = { current_stage: stage };
        if (stage === 'shipped') {
            body.shipping_method = document.getElementById('stage-shipping-method').value;
            body.shipping_tracking_no = document.getElementById('stage-shipping-tracking').value;
        }
        try {
            await api('/api/portal/sales/orders/' + orderId, { method: 'PATCH', body: JSON.stringify(body) });
            portalState.pendingStage = null;
            portalState.pendingStageLabel = null;
            refreshCurrentOrderSummary(orderId).catch(function(){});
            refreshCurrentOrderUpdates(orderId).catch(function(){});
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
            refreshCurrentOrderUpdates(orderId).catch(function(){});
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

    window.uploadPhoto = function (orderId) {
        if (portalState.uploadInFlight) return;
        var fileEl = document.getElementById('upload-file');
        var file = fileEl.files[0];
        if (!file) { alert('Select a file first.'); return; }

        var maxSizes = { 'image/jpeg': 10 * 1024 * 1024, 'image/png': 10 * 1024 * 1024, 'image/webp': 10 * 1024 * 1024, 'application/pdf': 30 * 1024 * 1024, 'video/mp4': 100 * 1024 * 1024, 'video/webm': 100 * 1024 * 1024, 'video/quicktime': 100 * 1024 * 1024 };
        var maxSize = 10 * 1024 * 1024;
        for (var k in maxSizes) { if (file.type === k || (k === 'application/pdf' && file.name.toLowerCase().endsWith('.pdf')) || (k.indexOf('video/') === 0 && file.name.toLowerCase().match(/\.(mp4|webm|mov)$/))) { maxSize = maxSizes[k]; break; } }
        if (file.size > maxSize) { alert('File too large. Max ' + (maxSize / (1024 * 1024)) + 'MB for this type.'); return; }

        portalState.uploadInFlight = true;

        var caption = document.getElementById('upload-caption').value.trim();
        var pub = document.getElementById('upload-public').checked;
        var fd = new FormData();
        fd.append('file', file);
        if (caption) fd.append('caption', caption);
        fd.append('visible_to_customer', pub ? '1' : '0');
        var stageKey = document.getElementById('upload-stage-key');
        if (stageKey && stageKey.value) fd.append('stage_key', stageKey.value);

        var statusEl = document.getElementById('upload-status');
        if (!statusEl) { statusEl = document.createElement('div'); statusEl.id = 'upload-status'; statusEl.className = 'portal-upload-status'; document.getElementById('upload-file').parentNode.appendChild(statusEl); }
        statusEl.innerHTML = '<span>Uploading: ' + esc(file.name) + ' (' + (file.size / 1024 / 1024).toFixed(1) + 'MB)</span><div class="portal-upload-bar"><div class="portal-upload-fill" id="upload-fill"></div></div><span id="upload-pct">0%</span>';

        var controls = ['upload-btn', 'upload-file', 'upload-caption', 'upload-public', 'upload-stage-key'];
        controls.forEach(function (id) { var el = document.getElementById(id); if (el) el.disabled = true; });

        function unlockUpload() {
            portalState.uploadInFlight = false;
            controls.forEach(function (id) { var el = document.getElementById(id); if (el) el.disabled = false; });
        }

        var xhr = new XMLHttpRequest();
        xhr.open('POST', window.DaiyujinAPI.config.baseUrl + '/api/portal/sales/orders/' + orderId + '/media');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token());
        xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
                var pct = Math.round(e.loaded / e.total * 100);
                var fill = document.getElementById('upload-fill');
                if (fill) fill.style.width = pct + '%';
                var pctEl = document.getElementById('upload-pct');
                if (pctEl) { pctEl.textContent = pct >= 100 ? '100% - Finalizing upload on server...' : pct + '%'; }
            }
        };
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                document.getElementById('upload-pct').textContent = 'Done';
                fileEl.value = '';
                document.getElementById('upload-caption').value = '';
                unlockUpload();
                setTimeout(function () { if (statusEl) statusEl.innerHTML = ''; }, 2000);
                refreshCurrentOrderMedia(orderId);
            } else {
                var msg = 'Upload failed with HTTP ' + xhr.status;
                try { var r = JSON.parse(xhr.responseText); msg = r.message || msg; } catch (e) { }
                document.getElementById('upload-pct').textContent = msg;
                unlockUpload();
            }
        };
        xhr.onerror = function () { document.getElementById('upload-pct').textContent = 'Network/CORS error. The API did not return a response. Check DevTools Network and server logs.'; unlockUpload(); };
        xhr.ontimeout = function () { document.getElementById('upload-pct').textContent = 'Upload timed out after reaching the server. Please try again or use a smaller file.'; unlockUpload(); };
        xhr.timeout = 180000;
        xhr.send(fd);
    };

    /* =========================================
       Media loading
       ========================================= */

    function absoluteApiUrl(pathOrUrl) {
        if (!pathOrUrl) return '';
        if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
        var base = window.DaiyujinAPI && window.DaiyujinAPI.config && window.DaiyujinAPI.config.baseUrl ? window.DaiyujinAPI.config.baseUrl : '';
        return base ? base + pathOrUrl : pathOrUrl;
    }

    async function getMediaTicket(orderId, mediaId) {
        var resp = await api('/api/portal/orders/' + orderId + '/media/' + mediaId + '/ticket', { method: 'POST', body: JSON.stringify({ purpose: 'preview' }) });
        return absoluteApiUrl(resp.url_path || resp.url);
    }

    function groupMediaByStage(media) {
        var groups = {};
        (media || []).forEach(function (m) {
            var key = m.stage_key || 'unassigned';
            if (!groups[key]) groups[key] = [];
            groups[key].push(m);
        });
        var ordered = [];
        stageOrder.forEach(function (stage) {
            if (groups[stage] && groups[stage].length) ordered.push({ stage: stage, items: groups[stage] });
        });
        Object.keys(groups).forEach(function (stage) {
            if (stageOrder.indexOf(stage) < 0) ordered.push({ stage: stage, items: groups[stage] });
        });
        return ordered;
    }

        async function renderAttachmentItem(orderId, m) {
        var item = document.createElement('div');
        item.className = 'portal-media-item';
        var label = m.caption || m.original_filename || m.filename || 'Attachment';
        try {
            var ticketUrl = await getMediaTicket(orderId, m.id);
            var preview = document.createElement('div');
            preview.className = 'portal-media-preview';
            if (m.file_kind === 'video') {
                var video = document.createElement('video');
                video.controls = true;
                video.preload = 'metadata';
                video.src = ticketUrl;
                video.className = 'portal-video-preview';
                video.addEventListener('error', function () {
                    preview.innerHTML = '<div class="portal-media-error">Preview unavailable</div>';
                });
                preview.appendChild(video);
            } else if (m.file_kind === 'pdf') {
                var pdfLink = document.createElement('a');
                pdfLink.href = ticketUrl + '?download=1';
                pdfLink.className = 'portal-attachment-link';
                pdfLink.target = '_blank';
                pdfLink.textContent = label;
                preview.appendChild(pdfLink);
            } else {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'portal-media-open';
                button.setAttribute('aria-label', 'View full size: ' + label);
                var img = document.createElement('img');
                img.src = ticketUrl;
                img.alt = label;
                img.onerror = function () {
                    preview.innerHTML = '<div class="portal-media-error">Preview unavailable</div>';
                };
                preview.appendChild(img);
                button.appendChild(preview);
                button.addEventListener('click', function () { openPortalLightbox(ticketUrl, label); });
                item.appendChild(button);
            }
            var meta = document.createElement('small');
            meta.textContent = [m.file_kind || 'file', stageLabels[m.stage_key] || m.stage_key || 'Unassigned', m.caption || m.original_filename || ''].filter(Boolean).join(' / ');
            if (m.file_kind === 'video' || m.file_kind === 'pdf') {
                item.appendChild(preview);
            }
            item.appendChild(meta);
        } catch (e) {
            item.innerHTML = '<div class="portal-media-error">Attachment unavailable</div><small>' + esc(label) + '</small>';
        }
        return item;
    }
async function loadAuthorizedImages(orderId, media, gridId) {
        var grid = document.getElementById(gridId || 'media-grid');
        if (!grid) return;
        grid.innerHTML = '';
        if (!media || !media.length) {
            grid.innerHTML = '<div class="portal-empty">No attachments available.</div>';
            return;
        }
        var groups = groupMediaByStage(media);
        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            var section = document.createElement('section');
            section.className = 'portal-attachment-group';
            var title = document.createElement('div');
            title.className = 'portal-attachment-group-title';
            title.textContent = (stageLabels[group.stage] || group.stage || 'Unassigned') + ' / ' + group.items.length + ' file(s)';
            section.appendChild(title);
            var groupGrid = document.createElement('div');
            groupGrid.className = 'portal-media-grid';
            var items = await Promise.all(group.items.map(function (m) { return renderAttachmentItem(orderId, m); }));
            items.forEach(function (item) { groupGrid.appendChild(item); });
            section.appendChild(groupGrid);
            grid.appendChild(section);
        }
    }

    window.addEventListener('beforeunload', function () { mediaObjectUrls.forEach(function (u) { URL.revokeObjectURL(u); }); });

    function clearMediaUrls() { mediaObjectUrls.forEach(function (u) { URL.revokeObjectURL(u); }); mediaObjectUrls = []; }

    /* Messages UI */
    function renderMessages(messages, isSales, orderId) {
        var h = "<h3 class=\"portal-section-title portal-section-title-spaced\">Messages</h3>";
        if (messages && messages.length) {
            h += "<div class=\"portal-messages\">" + messages.map(function (m) {
                var rep = !!m.parent_message_id;
                var statusBadge = "";
                if (m._pending) {
                    statusBadge = (m.status === 'failed')
                        ? '<div class="portal-msg-meta portal-msg-meta-error">Failed to send / <a href="javascript:void(0)" class="portal-msg-retry-link" data-local-id="' + encodeURIComponent(String(m.id)) + '">Retry</a></div>'
                        : '<div class="portal-msg-meta portal-msg-meta-sending">Sending...</div>';
                }
                  return "<div class=\"portal-msg" + (rep ? " portal-msg-reply" : "") + "\">" +
                      "<div class=\"portal-msg-head\"><strong>" + esc(m.sender_name) + "</strong><small>" + (formatPortalDateTime(m.created_at)) + "</small></div>" +
                      "<p>" + esc(m.message) + "</p>" +
                      statusBadge +
                      (isSales && !rep && !m._pending ? "<button class=\"portal-btn portal-btn-secondary portal-btn-sm portal-btn-auto\" onclick=\"window.showReplyForm(" + orderId + "," + m.id + ",event)\">Reply</button>" : "") +
                      "</div>";
              }).join("") + "</div>";
          } else {
              h += "<div class=\"portal-empty\">No messages yet.</div>";
          }
        h += "<div class=\"portal-msg-form\"><textarea id=\"msg-text\" class=\"portal-input-full\" placeholder=\"Write a message...\" rows=\"2\"></textarea>" +
            "<button class=\"portal-btn portal-btn-primary portal-btn-sm portal-btn-auto portal-msg-send\" onclick=\"window.sendMessage(" + orderId + ")\">Send</button></div>";
        return h;
    }

    function localMessage(orderId, text, parentId) {
        return {
            id: 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            sender_user_id: user().id,
            sender_name: userDisplayName(user()),
            message: text,
            status: 'sending',
            parent_message_id: parentId || null,
            created_at: new Date().toISOString(),
            _pending: true
        };
    }

    function appendPendingMessage(orderId, text, parentId) {
        var msg = localMessage(orderId, text, parentId);
        var next = (portalState.messagesByOrderId[orderId] || []).slice();
        next.push(msg);
        portalState.messagesByOrderId[orderId] = next;
        return msg;
    }

    function replacePendingMessage(orderId, localId, serverMessage) {
        var next = (portalState.messagesByOrderId[orderId] || []).slice();
        var replaced = false;
        for (var i = 0; i < next.length; i++) {
            if (next[i] && next[i]._pending && String(next[i].id) === String(localId)) {
                next[i] = serverMessage;
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            next.push(serverMessage);
        }
        portalState.messagesByOrderId[orderId] = next;
        return next;
    }

    function setPendingMessageStatus(orderId, localId, status) {
        var next = (portalState.messagesByOrderId[orderId] || []).slice();
        var updated = false;
        for (var i = 0; i < next.length; i++) {
            if (next[i] && next[i]._pending && String(next[i].id) === String(localId)) {
                next[i].status = status;
                updated = true;
                break;
            }
        }
        if (updated) portalState.messagesByOrderId[orderId] = next;
        return updated ? next : null;
    }

    function getPendingMessage(orderId, localId) {
        var items = portalState.messagesByOrderId[orderId] || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i] && items[i]._pending && String(items[i].id) === String(localId)) return items[i];
        }
        return null;
    }

    function bindMessageRetryLinks(el, orderId) {
        if (!el) return;
        var links = el.querySelectorAll('.portal-msg-retry-link');
        for (var i = 0; i < links.length; i++) {
            links[i].onclick = function (evt) {
                evt.preventDefault();
                var localId = evt.currentTarget.getAttribute('data-local-id');
                if (!localId) return;
                window.retryPendingMessage(orderId, decodeURIComponent(localId));
            };
        }
    }

    async function submitLocalMessage(orderId, pendingMessage) {
        setPendingMessageStatus(orderId, pendingMessage.id, 'sending');
        patchMessages(orderId, portalState.messagesByOrderId[orderId], portalState.currentIsSales, { force: true });
        try {
            var endpoint = pendingMessage.parent_message_id
                ? '/api/portal/sales/orders/' + orderId + '/messages/' + pendingMessage.parent_message_id + '/reply'
                : '/api/portal/orders/' + orderId + '/messages';
            var resp = await api(endpoint, { method: 'POST', body: JSON.stringify({ message: pendingMessage.message }) });
            if (resp && !resp.error && resp.message) {
                replacePendingMessage(orderId, pendingMessage.id, resp.message);
                patchMessages(orderId, portalState.messagesByOrderId[orderId], portalState.currentIsSales, { force: true });
                return;
            }
            throw new Error((resp && resp.message) || 'Message send failed');
        } catch (e) {
            var failed = setPendingMessageStatus(orderId, pendingMessage.id, 'failed');
            if (failed) patchMessages(orderId, failed, portalState.currentIsSales, { force: true });
            throw e;
        }
    }

    window.retryPendingMessage = async function (orderId, localId) {
        var pending = getPendingMessage(orderId, localId);
        if (!pending) return;
        if (pending.status === 'sending') return;
        try {
            await submitLocalMessage(orderId, pending);
        } catch (e) {
            console.warn('[portal:message:retry:failed]', e);
        }
    };

    window.sendMessage = async function (orderId) {
        var input = document.getElementById('msg-text');
        if (!input) return;
        var text = input.value.trim();
        if (!text) { alert('Message cannot be empty.'); return; }

        var pending = appendPendingMessage(orderId, text, null);
        input.value = '';
        patchMessages(orderId, portalState.messagesByOrderId[orderId], portalState.currentIsSales, { force: true });

        try {
            await submitLocalMessage(orderId, pending);
        } catch (e) { alert('Failed to send message.'); }
        finally {
            var currentInput = document.getElementById('msg-text');
            if (currentInput) currentInput.focus();
        }
    };

    window.showReplyForm = function (orderId, msgId, evt) {
        var old = document.getElementById("reply-form");
        if (old) old.remove();
        var row = evt.target.closest(".portal-msg");
        var div = document.createElement("div");
        div.id = "reply-form"; div.className = "portal-msg-form portal-msg-reply";
        div.innerHTML = "<textarea id=\"reply-text\" class=\"portal-input-full\" placeholder=\"Reply...\" rows=\"2\"></textarea>" +
            "<button class=\"portal-btn portal-btn-primary portal-btn-sm portal-btn-auto portal-msg-send\" onclick=\"window.sendReply(" + orderId + "," + msgId + ")\">Reply</button>";
        row.parentNode.insertBefore(div, row.nextSibling);
    };

    window.sendReply = async function (orderId, msgId) {
        var input = document.getElementById('reply-text');
        if (!input) return;
        var text = input.value.trim();
        if (!text) { alert('Reply cannot be empty.'); return; }
        var form = document.getElementById('reply-form');
        try {
            if (input) input.disabled = true;
            if (form) form.remove();
            var pending = appendPendingMessage(orderId, text, msgId);
            patchMessages(orderId, portalState.messagesByOrderId[orderId], portalState.currentIsSales, { force: true });
            await submitLocalMessage(orderId, pending);
        } catch (e) { alert('Failed to send reply.'); }
        finally {
            if (input) {
                input.disabled = false;
            }
        }
    };


    window.submitComplaint = async function (orderId) {
        var reason = prompt('Please describe the issue with your order:');
        if (!reason || !reason.trim()) return;
        try {
            await api('/api/portal/orders/' + orderId + '/complaints', { method: 'POST', body: JSON.stringify({ message: reason.trim() }) });
            alert('Your complaint has been submitted. Our team will review it shortly.');
            refreshCurrentOrderSummary(orderId);
            refreshCurrentOrderMessages(orderId);
        } catch (e) { alert('Failed to submit complaint. Please try again or contact your sales representative.'); }
    };
    /* Helpers */

    function renderTimelineItem(u) {
        var label = stageLabels[u.stage_key] || u.stage_key || 'Update';
        return '<div class="portal-timeline-item"><div class="portal-timeline-dot"></div><div class="portal-timeline-content"><strong>' + esc(u.title || label) + '</strong>' + (u.progress_percent ? ' (' + u.progress_percent + '%)' : '') + (u.message ? '<p class="portal-timeline-message">' + esc(u.message) + '</p>' : '') + '<small>' + formatPortalDateTime(u.created_at) + '</small></div></div>';
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
            if (me.user.must_change_password) {
                stopPortalRealtime();
                showChangePassword(true);
            } else {
                startPortalRealtime();
                updatePortalWatermark();
                routeByRole(me.user.role);
            }
        } catch (e) {
            clearSession();
            leaveAppMode();
        }
    }

    var stageOrder = ["order_confirmed", "material_ready", "machining", "surface_treatment", "quality_inspection", "packing", "shipped", "received"];


    function selectedAttr(value, expected) {
        return String(value || '') === String(expected || '') ? ' selected' : '';
    }

    window.applySearch = function (fnName) {
        var qEl = document.getElementById('search-q');
        var stageEl = document.getElementById('search-stage');
        var statusEl = document.getElementById('search-status');
        var q = qEl ? qEl.value.trim() : '';
        var stage = stageEl ? stageEl.value : '';
        var status = statusEl ? statusEl.value : '';
        _searchState.q = q;
        _searchState.stage = stage;
        _searchState.status = status;
        var params = [];
        if (q) params.push('q=' + encodeURIComponent(q));
        if (stage) params.push('stage=' + encodeURIComponent(stage));
        if (status) params.push('display_status=' + encodeURIComponent(status));
        _searchQuery = params.length ? '?' + params.join('&') : '';
        if (fnName === 'showCustomerDashboard') showCustomerDashboard();
        else if (fnName === 'showSalesOrders') showSalesOrders();
        else if (fnName === 'showAdminTab') showAdminTab('orders');
    };

    window.clearSearch = function (fnName) {
        _searchState = { q: '', stage: '', status: '' };
        _searchQuery = '';
        if (fnName === 'showCustomerDashboard') showCustomerDashboard();
        else if (fnName === 'showSalesOrders') showSalesOrders();
        else if (fnName === 'showAdminTab') showAdminTab('orders');
    };

    function renderStageStepper(currentStage) {
        var currentIdx = stageOrder.indexOf(currentStage);
        if (currentIdx < 0) currentIdx = 0;
        return '<div class="portal-stepper">' + stageOrder.map(function (s, i) {
            var cls = i < currentIdx ? 'done' : i === currentIdx ? 'active' : '';
            return '<div class="portal-stepper-step ' + cls + '"><div class="portal-stepper-dot"></div><small>' + (stageLabels[s] || s) + '</small></div>';
        }).join('') + '</div>';
    }

    applyPortalBranding();
    bootstrapPortal();
})();
