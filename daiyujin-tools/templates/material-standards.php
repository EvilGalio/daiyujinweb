<div class="dyj-tool-embed" data-dyj-theme="<?php echo esc_attr($theme); ?>">
<div class="tool-shell">
<main>
    <section class="tool-hero">
        <div><h1>Material Standards Lookup</h1>
        <p>Search international material designations across common engineering standards.</p></div>
        <div class="tool-status" data-api-status>checking</div>
    </section>
    <div class="mat-search-bar" data-search-area>
        <input type="text" class="mat-search-input" placeholder="e.g. 7075, AISI 304, EN AW-6061, POM, Delrin..." data-search-input autofocus>
        <button class="tool-button" data-search-btn>Search</button>
    </div>
    <div class="mat-search-filters">
        <select class="mat-search-filter" data-filter-family>
            <option value="">All Families</option>
        </select>
        <select class="mat-search-filter" data-filter-standard>
            <option value="">All Standards</option>
        </select>
        <select class="mat-search-filter" data-filter-confidence>
            <option value="">Any confidence</option>
            <option value="high">High (0.90+)</option>
            <option value="medium">Medium (0.75+)</option>
            <option value="low">Low</option>
        </select>
    </div>
    <div class="mat-results" data-results-area>
        <div class="tool-note">Enter a material designation above to find equivalent standards.</div>
    </div>
</main></div></div>
