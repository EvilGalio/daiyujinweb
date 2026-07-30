# Daiyujin Precision Tools — WordPress Plugin

Embeds the Daiyujin quoting and engineering-entry tools into WordPress.

## Installation

1. Zip the `daiyujin-tools/` folder.
2. WordPress Admin → Plugins → Add New → Upload Plugin.
3. Upload `daiyujin-tools.zip` → Install Now → Activate.

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

The plugin reads the API base URL from a PHP constant. To override the default:

```php
// wp-config.php
define('DYJ_TOOLS_API_BASE', 'https://api.your-domain.com');
define('DYJ_TOOLS_CUSTOMER_PORTAL_URL', 'https://portal.daiyujin.dpdns.org');
define('DYJ_TOOLS_CUSTOMER_COMPANY_CODE', 'daiyujin');
define('DYJ_TOOLS_THEME', 'mfg');
```

Production defaults:

- API: `https://api.daiyujin.dpdns.org`
- Customer Portal: `https://portal.daiyujin.dpdns.org`
- NextGen company: `daiyujin`

The WordPress theme/site value (`mfg`) is source presentation metadata. It
must never be used as the target NextGen company code.

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

1.6.1
