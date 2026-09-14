const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const scriptPath = path.join(__dirname, '../static/admin/admin.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function element(site) {
    const listeners = {};
    const classes = new Set();
    return {
        dataset: { site },
        innerHTML: '',
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
        },
        addEventListener: (name, callback) => { listeners[name] = callback; },
        click: () => listeners.click({ preventDefault() {} }),
    };
}

function loadAdmin() {
    const navigation = element();
    const content = element();
    const pending = [];
    let tabs = [];
    const main = {
        set innerHTML(html) {
            tabs = Array.from(html.matchAll(/<button data-site="([^"]+)"([^>]*)>/g), match => {
                const button = element(match[1]);
                if (match[2].includes('class="active"')) button.classList.add('active');
                return button;
            });
        },
    };
    const document = {
        addEventListener() {},
        getElementById: id => id === 'settings-content' ? content : null,
        querySelector: selector => {
            if (selector === '[data-nav="settings"]') return navigation;
            if (selector === '.admin-main') return main;
            return null;
        },
        querySelectorAll: selector => selector === '#site-tabs button' ? tabs : [],
    };
    const fetch = url => new Promise((resolve, reject) => {
        const scope = new URL(url, 'https://admin.example.invalid').searchParams.get('scope');
        pending.push({
            scope,
            reject,
            resolve: () => resolve({ json: () => Promise.resolve({ settings: [{
                scope,
                key: 'quote_email_recipients',
                value: scope.slice('quote:'.length) + '@example.invalid',
                value_type: 'string',
            }] }) }),
        });
    });
    vm.runInNewContext(script, { document, fetch, setTimeout, clearTimeout }, { filename: scriptPath });
    navigation.click();
    return {
        content,
        pending,
        select(site) {
            const tab = tabs.find(button => button.dataset.site === site);
            assert.ok(tab, 'Missing site tab: ' + site);
            tab.click();
            assert.ok(tab.classList.contains('active'));
        },
    };
}

function assertSiteContent(admin, site) {
    const scopes = Array.from(admin.content.innerHTML.matchAll(/data-admin-save-scope="([^"]+)"/g), match => match[1]);
    assert.deepEqual(scopes, ['quote:' + site]);
    assert.ok(admin.content.innerHTML.includes('data-admin-input="quote:' + site + '/quote_email_recipients"'));
    assert.ok(admin.content.innerHTML.includes(site + '@example.invalid'));
}

for (const [older, current] of [['4u', 'xindus'], ['xindus', '4u']]) {
    test('late ' + older + ' response preserves selected ' + current + ' scope', async () => {
        const admin = loadAdmin();
        admin.select(older);
        admin.select(current);
        assert.deepEqual(admin.pending.map(request => request.scope), ['quote:default', 'quote:' + older, 'quote:' + current]);
        admin.pending[2].resolve();
        await flush();
        assertSiteContent(admin, current);
        admin.pending[1].resolve();
        admin.pending[0].resolve();
        await flush();
        assertSiteContent(admin, current);
    });

    test('late ' + older + ' failure preserves selected ' + current + ' scope', async () => {
        const admin = loadAdmin();
        admin.select(older);
        admin.select(current);
        admin.pending[2].resolve();
        await flush();
        assertSiteContent(admin, current);
        admin.pending[1].reject(new Error('Older request failed'));
        admin.pending[0].reject(new Error('Initial request failed'));
        await flush();
        assertSiteContent(admin, current);
    });
}

test('selected site request failure still displays an error', async () => {
    const admin = loadAdmin();
    admin.select('4u');
    const loadingContent = admin.content.innerHTML;
    admin.pending[1].reject(new Error('Current request failed'));
    await flush();
    const errorContent = admin.content.innerHTML;
    assert.notEqual(errorContent, loadingContent);
    assert.match(errorContent, /^<p>[^<]+<\/p>$/);
    admin.pending[0].resolve();
    await flush();
    assert.equal(admin.content.innerHTML, errorContent);
});
