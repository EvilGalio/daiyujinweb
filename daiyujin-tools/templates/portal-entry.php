<?php
$variant = isset($args['variant']) ? sanitize_key($args['variant']) : 'standard';
$variant = in_array($variant, array('standard', 'compact'), true) ? $variant : 'standard';
$source = isset($args['source']) ? sanitize_key($args['source']) : 'website_entry';
$instant_quote_url = dyj_tools_instant_quote_url($theme);
$start_project_url = dyj_tools_portal_route('/sign-up', $theme, $source);
$sign_in_url = dyj_tools_portal_route('/sign-in', $theme, $source);
?>
<section class="dyj-portal-entry dyj-portal-entry--<?php echo esc_attr($variant); ?>" data-dyj-theme="<?php echo esc_attr($theme); ?>" aria-labelledby="dyj-portal-entry-title">
    <header class="dyj-portal-entry__header">
        <p class="dyj-portal-entry__eyebrow">Manufacturing project desk</p>
        <h2 id="dyj-portal-entry-title">Choose the right starting point.</h2>
        <p>Get an early estimate, open a formal manufacturing project, or return to an existing workspace.</p>
    </header>
    <nav class="dyj-portal-routes" aria-label="Manufacturing project routes">
        <a class="dyj-portal-route" href="<?php echo esc_url($instant_quote_url); ?>">
            <span class="dyj-portal-route__index">01</span>
            <span class="dyj-portal-route__copy"><strong>Instant Quote</strong><small>Upload CAD and receive an early cost estimate.</small></span>
            <span class="dyj-portal-route__action">Estimate</span>
        </a>
        <a class="dyj-portal-route dyj-portal-route--primary" href="<?php echo esc_url($start_project_url); ?>">
            <span class="dyj-portal-route__index">02</span>
            <span class="dyj-portal-route__copy"><strong>Start a Project</strong><small>Create a formal RFQ with engineering review.</small></span>
            <span class="dyj-portal-route__action">Start</span>
        </a>
        <a class="dyj-portal-route" href="<?php echo esc_url($sign_in_url); ?>">
            <span class="dyj-portal-route__index">03</span>
            <span class="dyj-portal-route__copy"><strong>Customer Portal</strong><small>Continue an RFQ, Quote, purchase document, or order.</small></span>
            <span class="dyj-portal-route__action">Sign in</span>
        </a>
    </nav>
</section>
