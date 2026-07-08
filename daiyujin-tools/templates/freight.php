<div class="dyj-tool-embed" data-dyj-theme="<?php echo esc_attr($theme); ?>">
    <div class="tool-shell">
        <main>
            <section class="tool-hero">
                <div>
                    <h1>Freight Estimate</h1>
                    <p>DHL rates from China to over 230 destinations worldwide.</p>
                </div>
                <div class="tool-status" data-api-status>checking</div>
            </section>

            <section class="tool-grid">
                <form class="tool-panel tool-form" data-freight-form autocomplete="off">
                    <h2>Shipment</h2>
                    <div class="tool-field country-search" data-country-search>
                        <label for="country">Destination</label>
                        <input id="country" name="country" type="text" placeholder="Search country&hellip;" autocomplete="off" required>
                        <div class="country-dropdown" data-country-dropdown></div>
                    </div>
                    <div class="tool-field">
                        <label for="weight">Cargo Weight (kg)</label>
                        <input id="weight" name="weight" type="number" min="0.5" step="0.5" value="5" required>
                    </div>
                    <div class="tool-field">
                        <label for="currency">Display Currency</label>
                        <div class="tool-checks" data-currency-segment aria-label="Display Currency">
                            <label class="active">
                                <input type="radio" id="currency-usd" name="currency" value="USD" checked> USD
                            </label>
                            <label>
                                <input type="radio" id="currency-eur" name="currency" value="EUR"> EUR
                            </label>
                        </div>
                    </div>
                    <button class="tool-button" type="submit">Get Estimate</button>
                </form>

                <aside class="tool-panel" data-result-panel>
                    <h2>DHL Freight</h2>
                    <section class="tool-result dhl-result" data-freight-result data-state="idle" aria-live="polite">
                        <div class="carrier-card">
                            <div class="freight-receipt-title">DHL Freight</div>
                            <div class="metric-row">
                                <span>Freight total</span>
                                <strong>USD 0.00</strong>
                            </div>
                            <div class="metric-row">
                                <span>Status</span>
                                <strong>Ready for shipment estimate</strong>
                            </div>
                            <div class="tool-note">Select destination and weight, then request DHL freight estimate.</div>
                        </div>
                    </section>
                </aside>
            </section>
        </main>
    </div>
</div>
