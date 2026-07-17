<?php
$source = isset($args['source']) ? sanitize_key($args['source']) : 'contact_router';
$general_url = isset($args['general_url']) ? $args['general_url'] : '#contact-form';
$start_project_url = dyj_tools_portal_route('/sign-up', $theme, $source);
$sign_in_url = dyj_tools_portal_route('/sign-in', $theme, $source);
?>
<section class="dyj-contact-router" data-dyj-theme="<?php echo esc_attr($theme); ?>" aria-labelledby="dyj-contact-router-title">
    <header class="dyj-contact-router__header">
        <p class="dyj-portal-entry__eyebrow">Contact route</p>
        <h2 id="dyj-contact-router-title">What would you like to do?</h2>
        <p>Select one route so your request reaches the right team and workspace.</p>
    </header>
    <div class="dyj-contact-router__options">
        <a href="<?php echo esc_url($start_project_url); ?>"><strong>Start a manufacturing project</strong><span>Open a structured RFQ and upload project files.</span></a>
        <a href="<?php echo esc_url($sign_in_url); ?>"><strong>Continue an existing project</strong><span>Sign in to your customer workspace.</span></a>
        <a href="<?php echo esc_url($general_url); ?>"><strong>Ask a general question</strong><span>Contact the team without creating a project.</span></a>
    </div>
</section>
