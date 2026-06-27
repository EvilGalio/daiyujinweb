<?php
/**
 * Plugin Name: Daiyujin Precision Tools
 * Description: Embeds instant quoting, freight calculator, ISO tolerance lookup, material standards, and weight calculator into WordPress pages via shortcodes.
 * Version: 1.2.2
 * Author: Daiyujin
 * License: Proprietary
 */

if (!defined('ABSPATH')) {
    exit;
}

define('DYJ_TOOLS_VERSION', '1.2.2');
define('DYJ_TOOLS_DIR', plugin_dir_path(__FILE__));
define('DYJ_TOOLS_URL', plugin_dir_url(__FILE__));

/* ── Configurable API base ─────────────────── */

function dyj_tools_api_base() {
    return defined('DYJ_TOOLS_API_BASE')
        ? DYJ_TOOLS_API_BASE
        : 'https://api.daiyujin.dpdns.org';
}

/* ── Asset loading ─────────────────────────── */

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

/* ── Template renderer ─────────────────────── */

function dyj_tools_render_template($template) {
    $path = DYJ_TOOLS_DIR . 'templates/' . $template . '.php';

    if (!file_exists($path)) {
        return '<p>Tool template not found.</p>';
    }

    ob_start();
    include $path;
    return ob_get_clean();
}

/* ── Shortcodes ────────────────────────────── */

function dyj_quote_tool_shortcode() {
    dyj_tools_enqueue_common();
    wp_enqueue_script(
        'dyj-tools-quote',
        DYJ_TOOLS_URL . 'assets/js/quote.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    wp_add_inline_script(
        'dyj-tools-quote',
        'window.DAIYUJIN_QUOTE_3D_MODULE_URL = ' . wp_json_encode(DYJ_TOOLS_URL . 'assets/js/quote-3d-viewer.js') . ';',
        'before'
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

function dyj_material_standards_shortcode() {
    dyj_tools_enqueue_common();
    wp_enqueue_script(
        'dyj-tools-material-standards',
        DYJ_TOOLS_URL . 'assets/js/material-standards.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );
    return dyj_tools_render_template('material-standards');
}
add_shortcode('dyj_material_standards', 'dyj_material_standards_shortcode');

function dyj_weight_calculator_shortcode() {
    dyj_tools_enqueue_common();
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
    return dyj_tools_render_template('material-weight');
}
add_shortcode('dyj_weight_calculator', 'dyj_weight_calculator_shortcode');
