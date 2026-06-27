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
                        <span class="tool-label">Material</span>
                        <div class="quote-material-layout" data-material-picker></div>
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
                    <p class="quote-inquiry-note">
                        Looking for more material grades, custom materials, machining processes, or finishing options?
                        <a href="mailto:?subject=Custom%20Manufacturing%20Request">Contact our engineers</a>
                        for a fast formal review.
                    </p>

                    <section class="quote-form-section quote-form-section-contact" aria-labelledby="quote-contact-title">
                        <h3 id="quote-contact-title">Contact Details <span class="field-optional">(optional)</span></h3>
                        <div class="tool-field">
                            <label for="customer_name">How should we address you? <span class="field-optional">(optional)</span></label>
                            <input id="customer_name" name="customer_name" type="text" placeholder="Name or nickname" autocomplete="name" maxlength="80">
                        </div>
                        <div class="tool-field">
                            <label for="customer_email">Email Address <span class="field-optional">(optional)</span></label>
                            <input id="customer_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email">
                            <small class="field-hint">Add your email if you want our engineers to follow up with a formal quote.</small>
                        </div>
                    </section>

                    <button class="tool-button" type="submit">Calculate Estimate</button>
                    <p class="quote-privacy-note">By submitting this form, you confirm that you are authorized to share the uploaded file. If you provide contact details, we use them only to generate and follow up on your manufacturing estimate. We treat uploaded drawings and quote data as confidential business information.</p>
                </form>

                <aside class="quote-stack" data-quote-result>
                    <section class="tool-panel quote-preview-panel">
                        <h2>Part Preview</h2>
                        <div class="tool-note" data-part-placeholder>Awaiting STEP analysis.</div>
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
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }
}
</script>
