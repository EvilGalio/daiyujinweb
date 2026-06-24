# Daiyujin Precision Tools — WordPress Plugin

Embeds instant quoting, freight calculator, and ISO tolerance lookup into WordPress pages via shortcodes.

## Installation

1. Zip the `daiyujin-tools/` folder.
2. WordPress Admin → Plugins → Add New → Upload Plugin.
3. Upload `daiyujin-tools.zip` → Install Now → Activate.

## Usage

Create WordPress pages with these shortcodes:

| Shortcode | Page |
|---|---|
| `[dyj_quote_tool]` | Quote calculator |
| `[dyj_freight_tool]` | Freight estimate |
| `[dyj_tolerance_tool]` | ISO tolerance lookup |

Use a full-width page template for best results.

## API Configuration

The plugin reads the API base URL from a PHP constant. To override the default:

```php
// wp-config.php
define('DYJ_TOOLS_API_BASE', 'https://api.your-domain.com');
```

Default: `https://api.daiyujin.dpdns.org`

## Backend Requirements

This plugin is a frontend only. The Flask backend (`backend/app.py`) must be running separately with:

- `/api/public/quote/upload`
- `/api/public/quote/calculate`
- `/api/public/quote/options`
- `/api/public/freight/countries`
- `/api/public/freight/calculate`
- `/api/public/tolerance/calculate`
- `/api/public/tolerance/presets`
- `/api/health`

CORS must allow the WordPress site origin (`ALLOWED_ORIGINS`).

## Version

1.0.0
