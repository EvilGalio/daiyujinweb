<div class="dyj-tool-embed">
<div class="tool-shell">
<main>
    <section class="tool-hero">
        <div>
            <h1>ISO Tolerance</h1>
            <p>ISO 286 limit deviations and fit types for bore and shaft.</p>
        </div>
        <div class="tool-status" data-api-status>checking</div>
    </section>

    <form class="tol-controls" data-tolerance-form autocomplete="off">
        <div class="tol-control-strip">
            <div class="tol-control-field">
                <label for="basic-size">Basic Size <span class="tol-unit">mm</span></label>
                <input id="basic-size" name="basic_size" type="number" min="1" max="3150" step="0.001" value="25">
            </div>
            <div class="tol-control-field">
                <span class="tol-seg-label">Fit Mode</span>
                <div class="tol-segmented" data-fit-mode>
                    <label class="active"><input type="radio" name="fit_mode" value="common" checked>Common</label>
                    <label><input type="radio" name="fit_mode" value="custom">Custom</label>
                </div>
            </div>
            <div class="tol-control-field" data-custom-group>
                <label for="fit-combination">Fit Combination</label>
                <input id="fit-combination" name="fit_combination" type="text" value="H7/g6" list="fit-presets" placeholder="e.g. H7/g6">
                <datalist id="fit-presets"></datalist>
            </div>
            <div class="tol-control-field" data-preset-group>
                <label for="preset">Common Fits</label>
                <select id="preset" name="preset"></select>
            </div>
            <button class="tool-button" type="submit" data-calc-btn>Calculate</button>
        </div>
        <div class="tol-validation" data-validation hidden></div>
    </form>

    <div class="tolerance-results" data-tolerance-result data-state="idle">
        <div class="tol-summary" data-tol-summary aria-live="polite">
            <div class="tol-summary-item">
                <span class="tol-summary-label">Fit Type</span>
                <span class="tol-summary-value" data-summary-type>Ready</span>
            </div>
            <div class="tol-summary-item">
                <span class="tol-summary-label">Combination</span>
                <span class="tol-summary-value" data-summary-combo>H7/g6</span>
            </div>
            <div class="tol-summary-item">
                <span class="tol-summary-label">Clearance</span>
                <span class="tol-summary-value" data-summary-clearance>0 &ndash; 0 &micro;m</span>
            </div>
            <div class="tol-summary-item">
                <span class="tol-summary-label">Interference</span>
                <span class="tol-summary-value" data-summary-interference>0 &micro;m</span>
            </div>
        </div>

        <div class="tol-fitmap" data-fitmap>
            <div class="tol-fitmap-svg" data-fitmap-svg></div>
            <div class="tol-fitmap-legend">
                <span class="tol-legend-item"><span class="tol-legend-swatch" style="background:#0066cc"></span>Bore</span>
                <span class="tol-legend-item"><span class="tol-legend-swatch" style="background:#dc5c26"></span>Shaft</span>
                <span class="tol-legend-item"><span class="tol-legend-swatch tol-legend-clearance"></span>Clearance</span>
                <span class="tol-legend-item"><span class="tol-legend-swatch tol-legend-interference"></span>Interference</span>
            </div>
        </div>

        <div class="tol-detail-cards">
            <div class="tol-detail-card" data-bore-card>
                <div class="tol-detail-head">
                    <span>Bore (Hole)</span>
                    <span class="tol-detail-code" data-bore-code>&mdash;</span>
                </div>
                <div class="tol-detail-body" data-bore-body></div>
            </div>
            <div class="tol-detail-card" data-shaft-card>
                <div class="tol-detail-head">
                    <span>Shaft</span>
                    <span class="tol-detail-code" data-shaft-code>&mdash;</span>
                </div>
                <div class="tol-detail-body" data-shaft-body></div>
            </div>
        </div>

        <div class="tol-actions">
            <button class="tool-button secondary" data-copy-btn>Copy Result</button>
            <button class="tool-button secondary" data-reset-btn type="button">Reset</button>
        </div>

        <div class="tol-disclaimer">Reference calculation. Verify against the applicable drawing and standard before manufacturing.</div>
    </div>
</main></div></div>
