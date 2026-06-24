<div class="dyj-tool-embed">
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
                        <select id="currency" name="currency">
                            <option value="CNY">CNY</option>
                            <option value="USD" selected>USD</option>
                            <option value="EUR">EUR</option>
                        </select>
                    </div>
                    <button class="tool-button" type="submit">Get Estimate</button>
                </form>

                <aside class="tool-panel" data-result-panel>
                    <h2>DHL Freight</h2>
                    <div class="dhl-result" data-freight-result>
                        <div class="dhl-result-amount">USD $0.00</div>
                        <div class="dhl-result-meta">Ready for estimate</div>
                    </div>
                </aside>
            </section>
        </main>
    </div>
</div>
