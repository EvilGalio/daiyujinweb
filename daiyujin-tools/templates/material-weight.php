<div class="dyj-tool-embed" data-dyj-theme="<?php echo esc_attr($theme); ?>">
<div class="tool-shell">
<main>
    <section class="tool-hero">
        <div><h1>Weight Calculator</h1>
        <p>Estimate stock weight for common shapes before quoting or shipping.</p></div>
        <div class="tool-status" data-api-status>checking</div>
    </section>
    <section class="tool-grid">
        <form class="tool-panel tool-form" data-weight-form autocomplete="off">
            <h2>Material &amp; Shape</h2>
            <div class="tool-field">
                <label for="material">Material</label>
                <select id="material" name="material_id" data-material-select></select>
            </div>
            <div class="tool-field">
                <label for="shape">Shape</label>
                <select id="shape" name="shape" data-shape-select></select>
            </div>
            <div class="tool-field-row" data-dimensions-area></div>
            <div class="tool-field">
                <label for="unit">Input Unit</label>
                <select id="unit" name="unit" data-unit-select></select>
            </div>
            <div class="tool-field">
                <label for="output-unit">Output Unit</label>
                <select id="output-unit" name="output_unit" data-output-unit-select></select>
            </div>
            <div class="tool-field">
                <label for="quantity">Quantity</label>
                <input id="quantity" name="quantity" type="number" min="1" step="1" value="1">
            </div>
            <button class="tool-button" type="submit">Calculate Weight</button>
        </form>
        <aside class="tool-panel" data-result-panel>
            <h2>Diagram</h2>
            <div class="shape-diagram-wrap" data-shape-diagram></div>
            <h2 style="margin-top:1.5rem;">Result</h2>
            <div data-weight-result>
                <div class="dhl-result-amount">0.00 kg</div>
                <div class="dhl-result-meta">Select material and dimensions</div>
            </div>
        </aside>
    </section>
</main></div></div>
