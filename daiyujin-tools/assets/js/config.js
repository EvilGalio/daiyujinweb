/*  This file is loaded by the WordPress plugin.
    The actual API base URL is injected via wp_add_inline_script
    before this file runs.  The line below is a safe fallback.  */
(function () {
    if (!window.DAIYUJIN_API_BASE) {
        window.DAIYUJIN_API_BASE = "https://api.daiyujin.dpdns.org";
    }
})();
