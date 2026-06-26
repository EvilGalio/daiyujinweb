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
                        <span class="tool-label">Material Category</span>
                        <div class="material-card-grid" data-material-category-list>
                            <label class="material-card active">
                                <input type="radio" name="material_category" value="aluminum_alloy" checked>
                                <span class="material-card-title">Aluminum Alloy</span>
                                <span class="material-card-desc">Loading&hellip;</span>
                            </label>
                        </div>
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
                        <label for="customer_email">Email Address</label>
                        <input id="customer_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email" required>
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
                    <p class="quote-privacy-note">By submitting this form, you confirm that you are authorized to share the uploaded file and contact details. We use this information only to generate and follow up on your manufacturing estimate, and we treat uploaded drawings and quote data as confidential business information.</p>
                </form>

                <aside class="quote-stack" data-quote-result>
                    <section class="tool-panel">
                        <h2>Part</h2>
                        <div class="tool-note">Awaiting STEP analysis.</div>
                    </section>
                    <section class="tool-panel">
                        <h2>Reference Estimate</h2>
                        <div class="tool-note">Select parameters and calculate after upload.</div>
                    </section>
                </aside>
            </section>
        </main>
    </div>
</div>
