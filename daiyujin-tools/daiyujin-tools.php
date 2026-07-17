<?php
/**
 * Plugin Name: Daiyujin Precision Tools
 * Description: Embeds instant quoting, freight calculator, ISO tolerance lookup, material standards, and weight calculator into WordPress pages via shortcodes.
 * Version: 1.6.0
 * Author: Daiyujin
 * License: Proprietary
 */

if (!defined('ABSPATH')) {
    exit;
}

define('DYJ_TOOLS_VERSION', '1.6.0');
define('DYJ_TOOLS_DIR', plugin_dir_path(__FILE__));
define('DYJ_TOOLS_URL', plugin_dir_url(__FILE__));

/* Configurable API base */

function dyj_tools_api_base() {
    return defined('DYJ_TOOLS_API_BASE')
        ? DYJ_TOOLS_API_BASE
        : 'https://api.daiyujin.dpdns.org';
}

/* Theme detection */

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

function dyj_tools_order_prefix($theme = null) {
    $theme = dyj_tools_normalize_theme($theme);
    $prefixes = array(
        'mfg'     => 'MFG',
        'gcindus' => 'GCINDUS',
        'gcnov'   => 'GCNOV',
        'default' => 'DYJ',
    );
    return isset($prefixes[$theme]) ? $prefixes[$theme] : $prefixes['default'];
}

function dyj_tools_brand_code($theme = null) {
    $theme = dyj_tools_normalize_theme($theme);
    return $theme === 'default' ? 'mfg' : $theme;
}

function dyj_tools_customer_portal_url($theme = null) {
    $theme = dyj_tools_normalize_theme($theme);
    $url = defined('DYJ_TOOLS_CUSTOMER_PORTAL_URL')
        ? DYJ_TOOLS_CUSTOMER_PORTAL_URL
        : 'https://portal.mfg-solution.com';
    return apply_filters('dyj_tools_customer_portal_url', rtrim($url, '/'), $theme);
}

function dyj_tools_portal_route($path, $theme = null, $source = '') {
    $theme = dyj_tools_normalize_theme($theme);
    $url = dyj_tools_customer_portal_url($theme) . '/' . ltrim($path, '/');
    $args = array('brand' => dyj_tools_brand_code($theme));
    if ($source) {
        $args['source'] = sanitize_key($source);
    }
    return add_query_arg($args, $url);
}

function dyj_tools_instant_quote_url($theme = null) {
    $theme = dyj_tools_normalize_theme($theme);
    $urls = array(
        'mfg' => 'https://mfg-solution.com/online-quote/',
        'gcindus' => 'https://gcindus.com/online-quote/',
        'gcnov' => 'https://gcnov.com/online-quote/',
        'default' => 'https://mfg-solution.com/online-quote/',
    );
    return apply_filters('dyj_tools_instant_quote_url', $urls[$theme], $theme);
}

/* Asset loading */

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
            'site' => $theme,
            'orderPrefix' => dyj_tools_order_prefix($theme),
            'brandLabel' => dyj_tools_brand_label($theme),
            'customerPortalUrl' => dyj_tools_customer_portal_url($theme),
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

/* Template renderer */

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

/* Shortcodes */

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

function dyj_order_portal_shortcode($atts = array()) {
    $atts = shortcode_atts(array('theme' => ''), $atts);
    dyj_tools_enqueue_common($atts['theme']);

    wp_enqueue_style(
        'dyj-tools-order-portal',
        DYJ_TOOLS_URL . 'assets/css/order-portal.css',
        array('dyj-tools-style'),
        DYJ_TOOLS_VERSION
    );

    wp_enqueue_script(
        'dyj-tools-order-portal',
        DYJ_TOOLS_URL . 'assets/js/order-portal.js',
        array('dyj-tools-api'),
        DYJ_TOOLS_VERSION,
        true
    );

    return dyj_tools_render_template('order-portal', array('theme' => $atts['theme']));
}
add_shortcode('dyj_order_portal', 'dyj_order_portal_shortcode');

function dyj_portal_entry_shortcode($atts = array()) {
    $atts = shortcode_atts(array(
        'theme' => '',
        'variant' => 'standard',
        'source' => 'website_entry',
    ), $atts);
    dyj_tools_enqueue_common($atts['theme']);
    return dyj_tools_render_template('portal-entry', array(
        'theme' => $atts['theme'],
        'variant' => $atts['variant'],
        'source' => $atts['source'],
    ));
}
add_shortcode('dyj_portal_entry', 'dyj_portal_entry_shortcode');

function dyj_contact_router_shortcode($atts = array()) {
    $atts = shortcode_atts(array(
        'theme' => '',
        'general_url' => '#contact-form',
        'source' => 'contact_router',
    ), $atts);
    dyj_tools_enqueue_common($atts['theme']);
    return dyj_tools_render_template('contact-router', array(
        'theme' => $atts['theme'],
        'general_url' => $atts['general_url'],
        'source' => $atts['source'],
    ));
}
add_shortcode('dyj_contact_router', 'dyj_contact_router_shortcode');
