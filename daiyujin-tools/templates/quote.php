<div class="dyj-tool-embed">
    <div class="tool-shell">
        <main>
            <section class="tool-hero">
                <div>
                    <h1>Instant Quoting</h1>
                    <p>Upload a STEP file and receive a reference manufacturing estimate. Final pricing is confirmed after engineering review.</p>
                </div>
                <div class="tool-status" data-api-status>checking</div>
            </section>

            <section class="tool-grid">
                <form class="tool-panel tool-form" data-quote-form>
                    <h2>Part &amp; Process</h2>
                    <label class="tool-upload" data-upload-label>
                        <input name="file" type="file" accept=".stp,.step">
                        <span>Choose STEP file</span>
                        <small>.stp / .step &middot; max 50 MB</small>
                    </label>
                    <div class="tool-field">
                        <label for="material">Material</label>
                        <select id="material" name="material_id" data-material-select>
                            <option value="">Loading&hellip;</option>
                        </select>
                    </div>
                    <div class="tool-field">
                        <label for="process">Process</label>
                        <select id="process" name="process" data-process-select>
                            <option value="">Loading&hellip;</option>
                        </select>
                    </div>
                    <div class="tool-field">
                        <label for="tolerance">General Tolerance</label>
                        <select id="tolerance" name="tolerance_grade" data-tolerance-select>
                            <option value="">Loading&hellip;</option>
                        </select>
                    </div>
                    <div class="tool-field">
                        <label for="postprocess">Postprocess</label>
                        <select id="postprocess" name="postprocess_group" data-postprocess-select>
                            <option value="">Loading&hellip;</option>
                        </select>
                    </div>
                    <div class="tool-field">
                        <label for="quantity">Quantity</label>
                        <input id="quantity" name="quantity" type="number" min="1" step="1" value="100">
                    </div>
                    <div class="tool-field">
                        <label for="currency">Currency</label>
                        <select id="currency" name="currency" data-currency-select>
                            <option value="USD">USD</option>
                        </select>
                    </div>
                    <button class="tool-button" type="submit">Calculate Estimate</button>
                </form>

                <aside class="quote-stack" data-quote-result>
                    <section class="tool-panel">
                        <h2>Part</h2>
                        <div class="tool-note">Awaiting STEP analysis.</div>
                    </section>
                    <section class="tool-panel">
                        <h2>Estimate</h2>
                        <div class="tool-note">Select parameters and calculate after upload.</div>
                    </section>
                </aside>
            </section>
        </main>
    </div>
</div>
