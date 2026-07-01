<?php
/**
 * Plugin Name: Daiyujin Precision Tools
 * Description: Embeds instant quoting, freight calculator, ISO tolerance lookup, material standards, and weight calculator into WordPress pages via shortcodes.
 * Version: 1.3.2
 * Author: Daiyujin
 * License: Proprietary
 */

if (!defined('ABSPATH')) {
    exit;
}

define('DYJ_TOOLS_VERSION', '1.3.2');
define('DYJ_TOOLS_DIR', plugin_dir_path(__FILE__));
define('DYJ_TOOLS_URL', plugin_dir_url(__FILE__));

/* ── Configurable API base ─────────────────── */

function dyj_tools_api_base() {
    return defined('DYJ_TOOLS_API_BASE')
        ? DYJ_TOOLS_API_BASE
        : 'https://api.daiyujin.dpdns.org';
}

/* ── Theme detection ────────────────────────── */

function dyj_tools_available_themes() {
    return array('default', 'mfg', 'gcindus', 'gcnov');
}

function dyj_tools_detect_theme() {
    if (defined('DYJ_TOOLS_THEME')) {
        return DYJ_TOOLS_THEME;
    }
    $host = isset($_SERVER['HTTP_HOST']) ? strtolower($_SERVER['HTTP_HOST']) : '';
    if (strpos($host, 'mfg-solution.com') !== false) return 'mfg';
    if (strpos($host, 'gcindus.com') !== false) return 'gcindus';
    if (strpos($host, 'gcnov') !== false) return 'gcnov';
    return 'default';
}

function dyj_tools_normalize_theme($theme) {
    $theme = sanitize_key($theme ?: dyj_tools_detect_theme());
    return in_array($theme, dyj_tools_available_themes(), true) ? $theme : 'default';
}

function dyj_tools_formal_quote_url($theme = null) {
    $theme = dyj_tools_normalize_theme($theme);
    $urls = array(
        'mfg'     => 'https://mfg-solution.com/request-quote/',
        'gcindus' => 'https://gcindus.com/get-a-quotation/',
        'gcnov'   => 'https://gcnov.com/contact/',
        'default' => 'https://mfg-solution.com/request-quote/',
    );
    return isset($urls[$theme]) ? $urls[$theme] : $urls['default'];
}

function dyj_tools_formal_quote_label($theme = null) {
    $theme = dyj_tools_normalize_theme($theme);
    $labels = array(
        'mfg'     => 'Request Formal Quote',
        'gcindus' => 'Request a Quote',
        'gcnov'   => 'Request a Quote',
        'default' => 'Request Formal Quote',
    );
    return isset($labels[$theme]) ? $labels[$theme] : $labels['default'];
}

function dyj_tools_brand_label($theme = null) {
    $theme = dyj_tools_normalize_theme($theme);
    $labels = array(
        'mfg'     => 'MFG Solution',
        'gcindus' => 'GC INDUS',
        'gcnov'   => 'GCNOV',
        'default' => 'Daiyujin',
    );
    return isset($labels[$theme]) ? $labels[$theme] : $labels['default'];
}

/* ── Asset loading ─────────────────────────── */

function dyj_tools_enqueue_common($theme_override = null) {
    $theme = dyj_tools_normalize_theme($theme_override);

    wp_enqueue_style(
        'dyj-tools-style',
        DYJ_TOOLS_URL . 'assets/css/plugins.css',
        array(),
        DYJ_TOOLS_VERSION
    );

    $theme_css = DYJ_TOOLS_DIR . 'assets/css/themes/' . $theme . '.css';
    if (file_exists($theme_css) && $theme !== 'default') {
        wp_enqueue_style(
            'dyj-tools-theme-' . $theme,
            DYJ_TOOLS_URL . 'assets/css/themes/' . $theme . '.css',
            array('dyj-tools-style'),
            DYJ_TOOLS_VERSION
        );
    }

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

    wp_add_inline_script(
        'dyj-tools-config',
        'window.DAIYUJIN_TOOLS_CONFIG = ' . wp_json_encode(array(
            'theme' => $theme,
            'brandLabel' => dyj_tools_brand_label($theme),
            'formalQuoteUrl' => dyj_tools_formal_quote_url($theme),
            'formalQuoteLabel' => dyj_tools_formal_quote_label($theme),
            'engineerContactUrl' => dyj_tools_formal_quote_url($theme),
            'engineerContactLabel' => 'Contact our engineers',
        )) . ';',
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

/* ── Template renderer ─────────────────────── */

function dyj_tools_render_template($template, $args = array()) {
    $path = DYJ_TOOLS_DIR . 'templates/' . $template . '.php';
    if (!file_exists($path)) {
        return '<p>Tool template not found.</p>';
    }
    $theme = isset($args['theme']) ? dyj_tools_normalize_theme($args['theme']) : dyj_tools_normalize_theme(null);
    $formal_quote_url = dyj_tools_formal_quote_url($theme);
    ob_start();
    include $path;
    return ob_get_clean();
}

/* ── Shortcodes ────────────────────────────── */

function dyj_quote_tool_shortcode($atts = array()) {
    $atts = shortcode_atts(array('theme' => ''), $atts);
    dyj_tools_enqueue_common($atts['theme']);
    wp_enqueue_script(
        'dyj-tools-quote',
        DYJ_TOOLS_URL . 'assets/js/quote.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    wp_add_inline_script(
        'dyj-tools-quote',
        'window.DAIYUJIN_QUOTE_3D_MODULE_URL = ' . wp_json_encode(DYJ_TOOLS_URL . 'assets/js/quote-3d-viewer.js?ver=' . DYJ_TOOLS_VERSION) . ';',
        'before'
    );
    return dyj_tools_render_template('quote', array('theme' => $atts['theme']));
}
add_shortcode('dyj_quote_tool', 'dyj_quote_tool_shortcode');

function dyj_freight_tool_shortcode($atts = array()) {
    $atts = shortcode_atts(array('theme' => ''), $atts);
    dyj_tools_enqueue_common($atts['theme']);
    wp_enqueue_script(
        'dyj-tools-freight',
        DYJ_TOOLS_URL . 'assets/js/freight.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('freight', array('theme' => $atts['theme']));
}
add_shortcode('dyj_freight_tool', 'dyj_freight_tool_shortcode');

function dyj_tolerance_tool_shortcode($atts = array()) {
    $atts = shortcode_atts(array('theme' => ''), $atts);
    dyj_tools_enqueue_common($atts['theme']);
    wp_enqueue_script(
        'dyj-tools-tolerance',
        DYJ_TOOLS_URL . 'assets/js/tolerance.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('tolerance', array('theme' => $atts['theme']));
}
add_shortcode('dyj_tolerance_tool', 'dyj_tolerance_tool_shortcode');

function dyj_material_standards_shortcode($atts = array()) {
    $atts = shortcode_atts(array('theme' => ''), $atts);
    dyj_tools_enqueue_common($atts['theme']);
    wp_enqueue_script(
        'dyj-tools-material-standards',
        DYJ_TOOLS_URL . 'assets/js/material-standards.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('material-standards', array('theme' => $atts['theme']));
}
add_shortcode('dyj_material_standards', 'dyj_material_standards_shortcode');

function dyj_weight_calculator_shortcode($atts = array()) {
    $atts = shortcode_atts(array('theme' => ''), $atts);
    dyj_tools_enqueue_common($atts['theme']);
    wp_enqueue_script(
        'dyj-tools-material-weight-shapes',
        DYJ_TOOLS_URL . 'assets/js/material-weight-shapes.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    wp_enqueue_script(
        'dyj-tools-material-weight',
        DYJ_TOOLS_URL . 'assets/js/material-weight.js',
        array('dyj-tools-material-weight-shapes'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('material-weight', array('theme' => $atts['theme']));
}
add_shortcode('dyj_weight_calculator', 'dyj_weight_calculator_shortcode');
