# Daiyujin Precision Tools — WordPress Plugin

Embeds the Daiyujin quoting and engineering-entry tools into WordPress.

## Installation

1. From the repository root, build the reviewed MFG artifact:

   ```powershell
   .\Build-DyjToolsZip.ps1 -Theme mfg
   ```

2. WordPress Admin → Plugins → Add New → Upload Plugin.
3. Upload the ZIP reported by the builder → Install Now → Activate.

Do not zip the source folder manually. The builder enforces the reviewed file
allowlist, scans for credential-like content, and verifies the final archive.

## Usage

Primary MFG pages use:

| Shortcode | Page |
|---|---|
| `[dyj_quote_tool theme="mfg"]` | Online Quote |
| `[dyj_portal_entry theme="mfg"]` | NextGen customer sign-up/sign-in entry |

Additional tools remain available:

| Shortcode | Page |
|---|---|
| `[dyj_freight_tool theme="mfg"]` | Freight estimate |
| `[dyj_tolerance_tool theme="mfg"]` | ISO tolerance lookup |
| `[dyj_material_standards theme="mfg"]` | Material standards |
| `[dyj_weight_calculator theme="mfg"]` | Material weight |
| `[dyj_contact_router theme="mfg"]` | Contact routing |

`[dyj_order_portal]` is retained only for explicitly labelled legacy order
tracking. It is not the primary customer login.

Use a full-width page template for best results.

## API Configuration

The public-pilot plugin has a fixed API and Customer Portal boundary. Only the
presentation theme is configurable:

```php
// wp-config.php
define('DYJ_TOOLS_THEME', 'mfg');
```

Production contract:

- API: `https://api.daiyujin.dpdns.org` (fixed; no WordPress override)
- Customer Portal: `https://portal.daiyujin.dpdns.org` (fixed)
- NextGen company: `daiyujin` (server-bound; never sent in a browser query)

The WordPress theme/site value (`mfg`) is source presentation metadata. It
must never be used as the target NextGen company code or handoff input.

## Backend Requirements

This plugin is a frontend only. The Flask backend (`backend/app.py`) must be running separately with:

- `/api/public/quote/upload`
- `/api/public/quote/calculate`
- `/api/public/quote/handoff`
- `/api/public/quote/options`
- `/api/public/freight/countries`
- `/api/public/freight/calculate`
- `/api/public/tolerance/calculate`
- `/api/public/tolerance/presets`
- `/api/health`

CORS must allow the WordPress site origin (`ALLOWED_ORIGINS`).

## Version

1.6.2
