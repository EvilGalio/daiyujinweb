<div class="dyj-tool-embed">
    <div class="tool-shell">
        <main>
            <section class="tool-hero">
                <div>
                    <h1>ISO Tolerance</h1>
                    <p>ISO 286 limit deviations and fit types. Enter a basic size and tolerance combination.</p>
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
                        <input id="fit-combination" name="fit_combination" type="text" value="H6/k5" list="fit-presets" placeholder="e.g. H7/g6">
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

            <div class="tolerance-results" data-tolerance-result>
                <div class="tolerance-empty">
                    <div class="tolerance-placeholder-icon">&Oslash;</div>
                    <p>Enter basic size and fit combination above to see ISO 286 deviations.</p>
                </div>
            </div>
        </main>
    </div>
</div>
