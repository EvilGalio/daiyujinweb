# PRD: Daiyujin Precision Tools WordPress Migration

> Project: Move Daiyujin precision tool pages from personal blog/static pages into the company WordPress website  
> Version: v1.0  
> Date: 2026-06-24  
> Owner: Daiyujin / Company website team  
> Recommended approach: WordPress plugin + shortcodes + independent Flask API

---

## 1. Background

The current project already has three working web tools:

| Tool | Current static page | Frontend JS | Backend API dependency |
|---|---|---|---|
| Instant Quote | `quote.html` | `js/quote.js` | Flask quote upload, STEP analysis, pricing |
| Freight Estimate | `freight.html` | `js/freight.js` | Flask freight rates API |
| ISO Tolerance | `tolerance.html` | `js/tolerance.js` | Flask tolerance API |

These pages currently live as standalone static HTML files. The company website is being developed on WordPress, so the goal is to move the user-facing tools into WordPress while preserving the existing Flask backend.

The most stable architecture is:

```text
Company WordPress website
  -> renders tool UI through shortcodes
  -> loads CSS/JS assets from a custom WordPress plugin
  -> calls independent Flask API over HTTPS

Flask API server
  -> keeps existing quote/freight/tolerance logic
  -> handles STEP upload and OCC analysis
  -> stores records in database
```

This avoids forcing WordPress/PHP to handle `pythonocc-core`, STEP parsing, file analysis, and pricing logic.

---

## 2. Goals

1. Move the three precision tools into the company WordPress site.
2. Preserve existing backend calculation logic and API routes.
3. Make the WordPress integration maintainable by packaging it as a plugin.
4. Allow content editors to place tools on pages using shortcodes.
5. Keep assets scoped and versioned so future UI updates are manageable.
6. Support production API domain configuration.
7. Keep the rollout reversible.

---

## 3. Non-Goals

1. Do not rewrite the Flask backend in PHP.
2. Do not run OCC or STEP parsing inside WordPress.
3. Do not store quote/freight/tolerance business tables in WordPress initially.
4. Do not build a Gutenberg custom block in v1.0.
5. Do not depend on iframe embedding for the final production integration.

Iframe can be used only as an emergency preview method.

---

## 4. Required Access And Preconditions

Before implementation, confirm the company WordPress environment:

| Item | Required? | Notes |
|---|---:|---|
| Self-hosted WordPress or plugin upload access | Yes | Needed to install custom plugin |
| Theme editing access | Optional | Plugin approach does not require theme edits |
| FTP/SFTP/hosting file manager access | Recommended | Useful for debugging plugin files |
| Admin access in WordPress dashboard | Yes | Needed to activate plugin and create pages |
| API subdomain access | Yes | Example: `https://api.company-domain.com` |
| Cloudflare/DNS access | Recommended | Needed for API routing and HTTPS |
| Flask backend host | Yes | Current Windows + Cloudflare Tunnel is acceptable for staging |

If the site is WordPress.com with no plugin upload permission, this PRD must switch to either iframe embedding or a paid plan that allows custom plugins.

---

## 5. Target User Experience

The WordPress site should expose three normal website pages:

```text
/quote
/freight
/tolerance
```

Each page should look like part of the company website. The WordPress theme should own:

1. Header
2. Footer
3. Main navigation
4. Global typography and page frame

The tool plugin should own:

1. Tool form
2. Tool result cards
3. Tool-specific CSS
4. API calls
5. Loading states
6. Error states

The old standalone internal navigation in the blog pages should be removed inside WordPress.

---

## 6. Recommended Plugin Structure

Create a local plugin folder:

```text
daiyujin-tools/
  daiyujin-tools.php
  assets/
    css/
      plugins.css
    js/
      config.js
      api.js
      quote.js
      freight.js
      tolerance.js
  templates/
    quote.php
    freight.php
    tolerance.php
  README.md
```

Later, zip the folder:

```text
daiyujin-tools.zip
```

Upload this zip to WordPress:

```text
WordPress Admin
-> Plugins
-> Add New Plugin
-> Upload Plugin
-> Choose daiyujin-tools.zip
-> Install Now
-> Activate
```

---

## 7. Plugin Main File Requirements

File:

```text
daiyujin-tools/daiyujin-tools.php
```

Responsibilities:

1. Define plugin metadata header.
2. Register shortcodes:
   - `[dyj_quote_tool]`
   - `[dyj_freight_tool]`
   - `[dyj_tolerance_tool]`
3. Load shared CSS only when a tool shortcode is present.
4. Load shared JS only when a tool shortcode is present.
5. Load the correct page-specific JS only for that tool.
6. Render templates from the `templates/` directory.
7. Inject API base URL into frontend config.

Recommended shortcode behavior:

| Shortcode | Template | Extra JS |
|---|---|---|
| `[dyj_quote_tool]` | `templates/quote.php` | `assets/js/quote.js` |
| `[dyj_freight_tool]` | `templates/freight.php` | `assets/js/freight.js` |
| `[dyj_tolerance_tool]` | `templates/tolerance.php` | `assets/js/tolerance.js` |

The shortcode callback must return HTML, not echo directly. This follows WordPress shortcode best practice.

---

## 8. Suggested Plugin Skeleton

This is the intended shape of `daiyujin-tools.php`:

```php
<?php
/**
 * Plugin Name: Daiyujin Precision Tools
 * Description: Embeds Daiyujin quote, freight, and tolerance tools into WordPress pages.
 * Version: 1.0.0
 * Author: Daiyujin
 */

if (!defined('ABSPATH')) {
    exit;
}

define('DYJ_TOOLS_VERSION', '1.0.0');
define('DYJ_TOOLS_DIR', plugin_dir_path(__FILE__));
define('DYJ_TOOLS_URL', plugin_dir_url(__FILE__));

function dyj_tools_api_base() {
    return defined('DYJ_TOOLS_API_BASE')
        ? DYJ_TOOLS_API_BASE
        : 'https://api.daiyujin.dpdns.org';
}

function dyj_tools_enqueue_common() {
    wp_enqueue_style(
        'dyj-tools-style',
        DYJ_TOOLS_URL . 'assets/css/plugins.css',
        array(),
        DYJ_TOOLS_VERSION
    );

    wp_enqueue_script(
        'dyj-tools-config',
        DYJ_TOOLS_URL . 'assets/js/config.js',
        array(),
        DYJ_TOOLS_VERSION,
        true
    );

    wp_add_inline_script(
        'dyj-tools-config',
        'window.DAIYUJIN_API_BASE = ' . wp_json_encode(dyj_tools_api_base()) . ';',
        'before'
    );

    wp_enqueue_script(
        'dyj-tools-api',
        DYJ_TOOLS_URL . 'assets/js/api.js',
        array('dyj-tools-config'),
        DYJ_TOOLS_VERSION,
        true
    );
}

function dyj_tools_render_template($template) {
    $path = DYJ_TOOLS_DIR . 'templates/' . $template . '.php';

    if (!file_exists($path)) {
        return '<p>Tool template not found.</p>';
    }

    ob_start();
    include $path;
    return ob_get_clean();
}

function dyj_quote_tool_shortcode() {
    dyj_tools_enqueue_common();
    wp_enqueue_script(
        'dyj-tools-quote',
        DYJ_TOOLS_URL . 'assets/js/quote.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('quote');
}
add_shortcode('dyj_quote_tool', 'dyj_quote_tool_shortcode');

function dyj_freight_tool_shortcode() {
    dyj_tools_enqueue_common();
    wp_enqueue_script(
        'dyj-tools-freight',
        DYJ_TOOLS_URL . 'assets/js/freight.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('freight');
}
add_shortcode('dyj_freight_tool', 'dyj_freight_tool_shortcode');

function dyj_tolerance_tool_shortcode() {
    dyj_tools_enqueue_common();
    wp_enqueue_script(
        'dyj-tools-tolerance',
        DYJ_TOOLS_URL . 'assets/js/tolerance.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('tolerance');
}
add_shortcode('dyj_tolerance_tool', 'dyj_tolerance_tool_shortcode');
```

---

## 9. Template Extraction Rules

When moving current standalone HTML files into WordPress templates:

Remove:

1. `<!DOCTYPE html>`
2. `<html>`
3. `<head>`
4. `<body>`
5. `<link rel="stylesheet">`
6. `<script>`
7. Site-level `<nav>`
8. Site-level `<footer>`

Keep:

1. Tool shell
2. Tool hero
3. Tool form
4. Tool result area
5. `data-*` attributes used by JS
6. Input names and IDs expected by JS

Example template shape:

```php
<div class="dyj-tool-embed">
    <div class="tool-shell">
        <main>
            <!-- Tool content copied from current standalone page -->
        </main>
    </div>
</div>
```

The wrapper `dyj-tool-embed` gives the plugin a safe CSS scope in WordPress.

---

## 10. Template Mapping

### 10.1 Quote Template

Source:

```text
quote.html
```

Destination:

```text
daiyujin-tools/templates/quote.php
```

Must preserve:

1. `data-quote-form`
2. `data-upload-label`
3. `data-material-select`
4. `data-tolerance-select`
5. `data-treatment-options`
6. `data-currency-select`
7. `data-quote-result`

Special risks:

1. File upload CORS.
2. STEP upload size.
3. Thumbnail URL accessibility.
4. API timeout.
5. WordPress security plugins blocking `.stp` or `.step` upload requests.

### 10.2 Freight Template

Source:

```text
freight.html
```

Destination:

```text
daiyujin-tools/templates/freight.php
```

Must preserve:

1. `data-freight-form`
2. `data-country-search`
3. `data-country-dropdown`
4. `data-freight-result`

Special risks:

1. Country search dropdown z-index inside WordPress theme containers.
2. Theme CSS overriding input styles.
3. CORS for JSON API calls.

### 10.3 Tolerance Template

Source:

```text
tolerance.html
```

Destination:

```text
daiyujin-tools/templates/tolerance.php
```

Must preserve:

1. `data-tolerance-form`
2. `fit-presets`
3. `data-tolerance-result`

Special risks:

1. SVG or visualization styles conflicting with theme CSS.
2. Mobile layout width.
3. Numeric labels overlapping in small containers.

---

## 11. Asset Migration

Copy current files:

```text
css/plugins.css
js/config.js
js/api.js
js/quote.js
js/freight.js
js/tolerance.js
```

To:

```text
daiyujin-tools/assets/css/plugins.css
daiyujin-tools/assets/js/config.js
daiyujin-tools/assets/js/api.js
daiyujin-tools/assets/js/quote.js
daiyujin-tools/assets/js/freight.js
daiyujin-tools/assets/js/tolerance.js
```

After migration, review CSS selectors. If company WordPress theme conflicts with generic selectors, scope them under:

```css
.dyj-tool-embed { ... }
```

Avoid styling global tags broadly inside the plugin, such as:

```css
body { ... }
button { ... }
input { ... }
```

Prefer scoped selectors:

```css
.dyj-tool-embed .tool-button { ... }
.dyj-tool-embed .tool-field input { ... }
```

---

## 12. API Domain And CORS

Recommended production API domain:

```text
https://api.company-domain.com
```

Temporary staging API domain:

```text
https://api.daiyujin.dpdns.org
```

The plugin should set:

```js
window.DAIYUJIN_API_BASE = "https://api.company-domain.com";
```

The Flask backend must allow the company WordPress origins:

```powershell
$env:ALLOWED_ORIGINS = "https://company-domain.com,https://www.company-domain.com,https://staging.company-domain.com"
```

For the current backend, this is handled by `_cors_origins()` in `backend/app.py`.

Do not use wildcard CORS in production unless this is still a private staging test.

---

## 13. Backend Deployment Requirement

The WordPress plugin does not replace the backend. The backend still needs to run.

Current local/staging command:

```powershell
powershell -ExecutionPolicy Bypass -File D:\myfirstgithubcode\daiyujinweb\run-api.ps1
```

For public access through Cloudflare Tunnel:

1. `cloudflared` connector must be healthy.
2. Public hostname must point to `http://127.0.0.1:5000`.
3. API domain must pass:

```powershell
Invoke-WebRequest https://api.company-domain.com/api/health
```

Expected response:

```json
{
  "error": false,
  "ok": true,
  "phase": "phase-1a",
  "service": "daiyujin-precision-tools"
}
```

---

## 14. WordPress Admin Operations

### 14.1 Upload Plugin

1. Open WordPress Admin.
2. Go to `Plugins`.
3. Click `Add New Plugin`.
4. Click `Upload Plugin`.
5. Upload `daiyujin-tools.zip`.
6. Click `Install Now`.
7. Click `Activate`.

### 14.2 Create Tool Pages

Create page:

```text
Title: Instant Quote
Slug: quote
Content: [dyj_quote_tool]
```

Create page:

```text
Title: Freight Estimate
Slug: freight
Content: [dyj_freight_tool]
```

Create page:

```text
Title: ISO Tolerance
Slug: tolerance
Content: [dyj_tolerance_tool]
```

### 14.3 Add Navigation Links

In WordPress Admin:

```text
Appearance
-> Menus
```

Add the three pages to the company website navigation if desired.

Suggested labels:

```text
Quote
Freight
Tolerance
```

### 14.4 Set Page Layout

For each tool page, use the widest available layout:

```text
Full width
No sidebar
No page builder padding if possible
```

If the theme supports page templates, choose:

```text
Full Width
Canvas
Blank
```

Exact naming depends on the WordPress theme.

---

## 15. Testing Plan

### 15.1 Backend Health

Open:

```text
https://api.company-domain.com/api/health
```

Pass condition:

1. HTTP 200.
2. JSON contains `"error": false`.
3. JSON contains `"service": "daiyujin-precision-tools"`.

### 15.2 Quote Tool

Test steps:

1. Open `/quote`.
2. Confirm API status shows ready.
3. Upload a known `.STEP` file.
4. Confirm part dimensions appear.
5. Confirm thumbnail appears.
6. Select material.
7. Select tolerance grade.
8. Select optional surface treatment.
9. Click `Calculate Estimate`.
10. Confirm estimate appears.
11. Click `Request Formal Quote`.
12. Confirm inquiry received message appears.

Pass condition:

1. No browser console errors.
2. No CORS errors.
3. No upload errors.
4. Quote record is stored in backend database.

### 15.3 Freight Tool

Test steps:

1. Open `/freight`.
2. Search country.
3. Select destination.
4. Enter weight.
5. Select DHL and FedEx.
6. Click `Get Rates`.

Pass condition:

1. DHL and FedEx cards render.
2. Currency conversion works.
3. Unknown country returns friendly error.

### 15.4 Tolerance Tool

Test steps:

1. Open `/tolerance`.
2. Run `25` and `H7/g6`.
3. Run `25` and `H6/k5`.
4. Run `25` and `H7/p6`.

Pass condition:

1. Clearance fit renders correctly for `H7/g6`.
2. Transition fit renders correctly for `H6/k5`.
3. Interference fit renders correctly for `H7/p6`.
4. Visualization, if enabled, does not overflow on mobile.

### 15.5 Mobile Layout

Test viewport widths:

```text
390px
768px
1280px
```

Pass condition:

1. No horizontal overflow.
2. Buttons remain clickable.
3. Form labels do not overlap.
4. Result cards remain readable.

---

## 16. Rollout Plan

### Phase 1: Local Plugin Build

1. Create `daiyujin-tools/` folder locally.
2. Add plugin main PHP file.
3. Copy CSS/JS assets.
4. Extract templates from current HTML pages.
5. Zip plugin.

Deliverable:

```text
daiyujin-tools.zip
```

### Phase 2: Staging WordPress Install

1. Upload plugin to staging.
2. Create three staging pages.
3. Configure API base to staging API.
4. Run full test plan.

Deliverable:

```text
Working staging pages for quote/freight/tolerance
```

### Phase 3: Production API Preparation

1. Prepare official API domain.
2. Configure Cloudflare Tunnel or VPS.
3. Set backend `ALLOWED_ORIGINS`.
4. Verify `/api/health`.

Deliverable:

```text
Stable production API endpoint
```

### Phase 4: Production WordPress Release

1. Upload plugin to production WordPress.
2. Create production pages.
3. Add navigation links.
4. Test all tools.
5. Monitor backend logs for upload/API errors.

Deliverable:

```text
Tools live on company WordPress website
```

---

## 17. Rollback Plan

If plugin causes issues:

1. Deactivate `Daiyujin Precision Tools` plugin in WordPress.
2. Remove tool pages from navigation.
3. Keep backend API running for debugging.
4. Restore previous WordPress pages if needed.

If API causes issues:

1. Keep plugin active.
2. Temporarily hide the affected page.
3. Fix backend.
4. Re-enable page after API passes health checks.

If quote upload fails in production:

1. Leave freight and tolerance online.
2. Hide quote page from navigation.
3. Debug CORS, upload size, Cloudflare Tunnel, and OCC environment.

---

## 18. Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WordPress theme CSS overrides tool UI | Medium | Scope all CSS under `.dyj-tool-embed` |
| CORS blocks API calls | High | Set `ALLOWED_ORIGINS` correctly |
| STEP upload blocked by security plugin | High | Whitelist API domain and upload route |
| Cloudflare Tunnel machine sleeps | High | Use always-on machine or migrate API to VPS |
| Quote thumbnail URL inaccessible | Medium | Ensure `/static/thumbnails/*` is served by Flask/API domain |
| WordPress plugin update overwrites edits | Medium | Version plugin and keep source in Git |
| API key/token leaked in logs | High | Never log tunnel tokens or secrets |
| Page builder strips shortcode or markup | Low | Use native shortcode block or shortcode widget |

---

## 19. Acceptance Criteria

The migration is complete when:

1. The WordPress plugin can be uploaded and activated.
2. `[dyj_quote_tool]` renders the quote tool.
3. `[dyj_freight_tool]` renders the freight tool.
4. `[dyj_tolerance_tool]` renders the tolerance tool.
5. All tools call the production API domain.
6. Quote STEP upload works.
7. Freight rates return carrier results.
8. Tolerance calculations return expected fit types.
9. Mobile layout has no horizontal overflow.
10. Browser console has no CORS or JavaScript errors.
11. Backend database records quote/freight/tolerance inquiries.

---

## 20. References

1. WordPress Plugin Handbook: https://developer.wordpress.org/plugins/plugin-basics/
2. WordPress Shortcodes: https://developer.wordpress.org/plugins/shortcodes/
3. `wp_enqueue_script()`: https://developer.wordpress.org/reference/functions/wp_enqueue_script/
4. `wp_enqueue_style()`: https://developer.wordpress.org/reference/functions/wp_enqueue_style/
5. Current Daiyujin frontend files:
   - `quote.html`
   - `freight.html`
   - `tolerance.html`
   - `css/plugins.css`
   - `js/api.js`
   - `js/config.js`
   - `js/quote.js`
   - `js/freight.js`
   - `js/tolerance.js`
6. Current backend entry:
   - `backend/app.py`

