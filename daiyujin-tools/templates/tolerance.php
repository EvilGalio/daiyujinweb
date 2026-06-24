<div class="dyj-tool-embed">
    <div class="tool-shell">
        <main>
            <section class="tool-hero">
                <div>
                    <h1>ISO Tolerance</h1>
                    <p>ISO 286 limit deviations and fit types.</p>
                </div>
                <div class="tool-status" data-api-status>checking</div>
            </section>

            <form class="tolerance-bar" data-tolerance-form autocomplete="off">
                <div class="tolerance-inputs">
                    <div class="tolerance-field">
                        <label for="basic-size">Basic Size</label>
                        <input id="basic-size" name="basic_size" type="number" min="1" max="3150" step="0.001" value="25">
                        <span class="tolerance-unit">mm</span>
                    </div>
                    <div class="tolerance-field">
                        <label for="fit-combination">Fit Combination</label>
                        <input id="fit-combination" name="fit_combination" type="text" value="H7/g6" list="fit-presets" placeholder="e.g. H7/g6">
                        <datalist id="fit-presets"></datalist>
                    </div>
                    <div class="tolerance-field">
                        <label for="preset">Quick Select</label>
                        <select id="preset" name="preset">
                            <option value="">Custom</option>
                        </select>
                    </div>
                </div>
                <button class="tool-button" type="submit">Calculate</button>
            </form>

            <div class="tolerance-results" data-tolerance-result data-state="idle">
                <div class="tolerance-columns">
                    <div class="tz-col" data-col="shaft">
                        <div class="tz-col-head"><span>Shaft</span><span class="tz-col-code" data-shaft-code></span></div>
                        <div class="tz-svg-wrap" data-shaft-svg></div>
                        <div class="tz-col-data" data-shaft-data></div>
                    </div>
                    <div class="tz-col" data-col="bore">
                        <div class="tz-col-head"><span>Bore</span><span class="tz-col-code" data-bore-code></span></div>
                        <div class="tz-svg-wrap" data-bore-svg></div>
                        <div class="tz-col-data" data-bore-data></div>
                    </div>
                    <div class="tz-col" data-col="fit">
                        <div class="tz-col-head"><span>Fit</span><span class="tz-col-code" data-fit-code></span></div>
                        <div class="tz-svg-wrap" data-fit-svg></div>
                        <div class="tz-col-data" data-fit-data></div>
                    </div>
                </div>
                <div class="tolerance-summary" data-tolerance-summary hidden>
                    <div class="fit-summary-type">
                        <span class="fit-dot" data-fit-dot></span>
                        <span data-fit-label></span>
                    </div>
                    <div class="fit-summary-metrics">
                        <span class="fit-metric">Max Clearance <strong data-clearance></strong></span>
                        <span class="fit-metric">Max Interference <strong data-interference></strong></span>
                        <span class="fit-metric">Size Range <strong data-size-range></strong></span>
                    </div>
                </div>
            </div>
        </main>
    </div>
</div>
