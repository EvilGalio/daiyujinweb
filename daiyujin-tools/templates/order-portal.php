<?php
/**
 * Template: Order Portal
 * Shortcode: [dyj_order_portal theme="mfg"]
 */
?><div class="dyj-tool-embed dyj-order-portal-embed"
     data-dyj-theme="<?php echo esc_attr($theme); ?>"
     data-portal-site="<?php echo esc_attr($theme); ?>">
    <div class="portal-shell" data-portal-shell>
        <header class="portal-header">
            <div>
                <h1 data-portal-title>Order Portal</h1>
            </div>
            <div class="portal-header-status">
                <span class="portal-sync-dot" id="sync-dot" title="Connecting..."></span>
                <span class="portal-api-status" data-api-status>checking</span>
            </div>
        </header>

        <main class="portal-main" data-portal-main>
            <div class="portal-sync-strip" id="sync-strip" hidden></div>
            <div class="portal-login-layout" data-login-layout>
            <div class="portal-login-intro">
                <h2>Sign in</h2>
                <p class="portal-hint">Secure production progress access for Daiyujin Precision customers, sales representatives, and administrators.</p>
                <ul class="portal-login-features">
                    <li>Track production progress</li>
                    <li>View inspection and shipment photos</li>
                    <li>Message your sales representative</li>
                </ul>
            </div>
            <form class="portal-login-card" data-login-form>
                <h3>Sign in to your orders</h3>
                <p class="portal-hint">Access your active orders and production progress.</p>
                <div class="portal-field">
                    <label for="login-email">Email</label>
                    <input id="login-email" type="email" placeholder="your@email.com" autocomplete="email" required>
                </div>
                <div class="portal-field">
                    <label for="login-password">Password</label>
                    <input id="login-password" type="password" placeholder="Password" required>
                </div>
                <div class="portal-error" data-login-error hidden></div>
                <button class="portal-btn" type="submit" data-login-btn>Sign In</button>
                <p class="portal-footnote">Don't have an account? Contact your sales representative.</p>
            </form>
            </div>
        </main>
    </div>
    <div class="portal-toast-region" id="toast-region" aria-live="polite"></div>
</div>
