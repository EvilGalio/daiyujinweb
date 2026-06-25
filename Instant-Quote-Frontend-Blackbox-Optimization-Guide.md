# Instant Quote Frontend Blackbox Optimization Guide

Status: Draft for implementation  
Scope: `quote.html`, `js/quote.js`, `css/plugins.css`, WordPress plugin quote template and quote script  
Principle: customer-facing quote UI should feel like a professional commercial estimator. It should show the customer's selections and final estimate, while keeping pricing model, coefficients, sample counts, line-item economics, and internal currency basis out of the public surface.

## 1. Why This Change Is Needed

The current Instant Quote v2.1 calculation is usable, but the customer-facing interface exposes internal mechanics:

1. Postprocess options are displayed in Chinese.
2. Postprocess options include internal RMB fees.
3. The result card displays `Model v2.1_additive`.
4. The result card exposes backend pricing line items:
   - Material term
   - Setup allocation
   - Machining base
   - Postprocess
   - RMB per-piece values
5. The public result reads like a debug panel rather than a commercial quote experience.

This weakens the product in two ways:

1. It leaks business-sensitive pricing parameters.
2. It makes the customer feel they are looking at a formula demo instead of a managed manufacturing quotation system.

## 2. Reference Direction

Observed public positioning from established manufacturing quote platforms:

1. Protolabs emphasizes a direct quote entry point, manufacturing capability, certifications, and a clear path to start a project.
2. Protolabs Network / Hubs describes the flow as upload CAD, confirm specifications, receive instant quote, then manufacturing, quality control, and delivery. It also foregrounds secure and confidential uploads.
3. These public pages explain process confidence and service coverage, but do not expose the actual pricing decomposition or model coefficients.

Sources:

- Protolabs CNC machining page: <https://www.protolabs.com/services/cnc-machining/>
- Protolabs Network CNC machining page: <https://www.hubs.com/cnc-machining/>

## 3. Product Positioning

The intended feeling is:

```text
Secure manufacturing estimate
Powered by internal engineering and cost analysis
Final quote confirmed by Daiyujin engineering review
```

The customer should see enough to trust the output:

1. Uploaded part was analyzed.
2. Their selected material, process, finish, tolerance, quantity, and currency were recognized.
3. A clean estimate was generated.
4. A formal review path exists.

The customer should not see:

1. Formula version.
2. Internal model names.
3. Material multiplier.
4. Setup allocation.
5. Machining base.
6. Postprocess internal fee.
7. RMB basis.
8. Sample counts.
9. Raw warnings such as low sample counts.
10. Debug breakdowns.

## 4. Design Direction

### 4.1 Aesthetic

Use a refined industrial procurement interface:

1. Quiet, dense, and trustworthy.
2. More like a supplier portal than a landing page.
3. No decorative hero art, no exaggerated gradients, no playful pricing explanation.
4. Retain the existing white / light gray / precision blue base, but add small supporting signals:
   - Green for ready / completed states.
   - Amber for engineering review hints.
   - Neutral gray for confidential / secure copy.

### 4.2 Interaction Feeling

The quote flow should feel like a controlled instrument:

1. Upload STEP.
2. Configure manufacturing specs.
3. Run secure assessment.
4. Receive estimate.
5. Request formal quote.

Progress animation can stay, but its language should sound professional:

```text
Secure file intake
Geometry assessment
Manufacturing review
Cost assessment
Estimate preparation
```

Avoid phrases that imply the final number is random or magical:

```text
Dynamic quotation generating
AI price matrix exposed
Model v2.1 calculation
```

## 5. Public API Contract Changes

The public quote options endpoint should avoid sending fields that the frontend must never display.

### 5.1 Current Risk

`GET /api/public/quote/options` currently returns postprocess entries similar to:

```json
{
  "id": "电解抛光",
  "name": "电解抛光",
  "fee_rmb": 7.2113,
  "sample_count": 32
}
```

This creates two problems:

1. Chinese labels appear in the public UI.
2. Sensitive internal fees are present in browser-visible JSON.

### 5.2 Required Public Shape

Return public labels only:

```json
{
  "postprocess_groups": [
    { "id": "去毛刺", "label": "Deburring" },
    { "id": "钝化", "label": "Passivation" },
    { "id": "电解抛光", "label": "Electropolishing" },
    { "id": "喷砂抛光", "label": "Bead Blasting / Polishing" },
    { "id": "阳极氧化", "label": "Anodizing" },
    { "id": "镭雕", "label": "Laser Marking" },
    { "id": "热处理", "label": "Heat Treatment" },
    { "id": "电镀涂层", "label": "Plating / Coating" }
  ]
}
```

Rules:

1. Keep internal Chinese `id` because the calculator uses it.
2. Display only English `label`.
3. Remove `fee_rmb` from public response.
4. Remove `sample_count` from public response.
5. Remove internal low-sample comments from public response.
6. If an internal admin view is needed later, create a separate protected endpoint.

### 5.3 Result Response

`POST /api/public/quote/calculate` may keep internal formula fields for backend logging, but the browser response should be public-safe.

Recommended public result:

```json
{
  "quote_status": "estimated",
  "valid_until": "2026-07-02",
  "currency": "USD",
  "part": {
    "name": "bracket",
    "stp_filename": "bracket.step",
    "obb_dimensions_mm": "100 x 50 x 20"
  },
  "selections": {
    "material": { "id": "AISI 304", "name": "AISI 304" },
    "process": "CNC Machining",
    "postprocess_group": "Deburring",
    "quantity": 100,
    "tolerance_grade": "General Tolerance"
  },
  "unit_price": {
    "display": "USD 12.34"
  },
  "total": {
    "display": "USD 1,234.00"
  },
  "review_note": "Estimated pricing is subject to engineering review before order confirmation."
}
```

Do not send these to browser:

```text
formula
breakdown
pricing_model_version
pricing_mode
exchange_rate_basis
material_term_rmb
setup_term_rmb
machining_term_rmb
postprocess_fee_rmb
quantity_delta
safety_multiplier
sample_count
```

If keeping them temporarily for debugging, hide behind an environment flag:

```text
QUOTE_DEBUG_PUBLIC=false
```

Default must be false in production and WordPress deployment.

## 6. Frontend Form Changes

### 6.1 Postprocess Select

Current code:

```js
`${item.name} (${item.fee_rmb > 0 ? '+' + item.fee_rmb + ' RMB' : 'included'})`
```

Replace with:

```js
`${item.label || item.name}`
```

Acceptance:

1. No Chinese visible in Postprocess dropdown.
2. No `RMB`, `CNY`, `¥`, `fee`, `included`, or numeric add-on visible in the dropdown.
3. The selected value can remain the internal id.

### 6.2 Suggested English Labels

Use these labels unless the sales team prefers different wording:

| Internal id | Public label |
|---|---|
| `去毛刺` | Deburring |
| `钝化` | Passivation |
| `电解抛光` | Electropolishing |
| `喷砂抛光` | Bead Blasting / Polishing |
| `阳极氧化` | Anodizing |
| `镭雕` | Laser Marking |
| `热处理` | Heat Treatment |
| `电镀涂层` | Plating / Coating |

Hidden internal groups:

| Internal id | Public behavior |
|---|---|
| `未标注后处理` | Do not show |
| `其他后处理` | Do not show; route to formal quote if needed |

## 7. Result Card Redesign

### 7.1 Before Calculation

The right-side estimate card should always exist and show a professional empty state:

```text
Estimated Total
USD 0.00

Upload a STEP file and complete the manufacturing details to generate an estimate.
```

Visible rows:

```text
Unit Price       USD 0.00 / pc
Status           Waiting for STEP file
Review           Engineering confirmation required
```

This makes the page feel complete before the first calculation.

### 7.2 During Calculation

Show a single progress panel:

```text
Secure Assessment
[progress bar]
Geometry assessment  42%
```

Allowed phase labels:

```text
Secure file intake
Geometry assessment
Manufacturing review
Cost assessment
Estimate preparation
```

Do not show formula words such as model, multiplier, setup, machining base, delta, RMB basis.

### 7.3 After Calculation

Result card should show:

```text
Estimated Total
USD 1,234.00

Unit Price        USD 12.34 / pc
Quantity          100 pcs
Valid Until       2026-07-02
Status            Reference estimate
```

Then a compact selected-spec summary:

```text
Material          AISI 304
Process           CNC Machining
Postprocess       Deburring
Tolerance         General Tolerance
```

Then CTA:

```text
Request Formal Quote
```

Do not show:

```text
Model
v2.1_additive
Material term
Setup allocation
Machining base
Postprocess fee
RMB values
quote-breakdown
```

### 7.4 Public Disclaimer

Change the wording back to a calm commercial note:

```text
This estimate is for reference only. Final pricing and lead time will be confirmed after engineering review.
```

Alternative shorter version:

```text
Reference estimate. Final quote requires engineering review.
```

Avoid:

```text
deterministic reference estimate based on v2.1 historical quote coefficients
```

That sentence is true internally, but it belongs in logs or docs, not in the customer interface.

## 8. Part Card Redesign

The part card may show geometry confirmation, but should avoid feeling like a debug report.

Recommended:

```text
Part Analyzed
filename.step

Geometry          Verified
Bounding Size     100 x 50 x 20 mm
```

Optional:

```text
Volume            12,345 mm³
```

If the layout feels too technical, hide volume in a collapsed "Part details" row.

## 9. Warning Messages

Internal warning:

```text
Process '板金' has low sample count (40).
```

Customer-safe warning:

```text
This configuration may require manual engineering review.
```

Rules:

1. Never show sample count.
2. Never show internal group names if they are Chinese.
3. Never show formula causes.
4. Keep warnings as soft review hints, not system errors.

## 10. Visual Layout Instructions

### 10.1 Layout

Keep the two-column layout:

1. Left: upload and selections.
2. Right: sticky quote summary on desktop.
3. Mobile: quote summary appears below form.

Recommended CSS:

```css
.quote-stack {
  position: sticky;
  top: 1rem;
}

@media (max-width: 780px) {
  .quote-stack {
    position: static;
  }
}
```

### 10.2 Result Hierarchy

Use a stronger hierarchy:

1. `Estimated Total` label.
2. Large price.
3. Unit price and quantity.
4. Selected specs.
5. CTA.
6. Disclaimer.

The total should be the only large number.

### 10.3 Confidentiality Signal

Add a small badge near the upload or result area:

```text
Secure CAD intake
```

or:

```text
Confidential assessment
```

This gives the black-box feeling a legitimate business reason: confidentiality and engineering review.

### 10.4 Colors

Keep current tokens but tune usage:

1. Main action: `--accent`.
2. Finished state: `--success`.
3. Review note: amber from `--warn`.
4. Confidential badge: neutral gray border, no bright color.

Avoid making the page all blue. Industrial tools feel better when color is sparse and functional.

## 11. Implementation Plan

### Phase F0: Sensitive Field Audit

Search:

```powershell
Select-String -Path js\quote.js,daiyujin-tools\assets\js\quote.js -Pattern 'fee_rmb|breakdown|pricing_model_version|formula|Material term|Setup allocation|Machining base|Postprocess'
```

Expected after cleanup:

```text
No public render usage.
```

Backend search:

```powershell
Select-String -Path backend\services\quote_calculator_v2.py -Pattern 'fee_rmb|sample_count|formula|breakdown|pricing_model_version'
```

Some backend internals can remain, but public response should be sanitized.

### Phase F1: Backend Public Labels

Modify `get_quote_options_v2()`:

1. Add English `label` for each postprocess group.
2. Return `id` and `label` only for public dropdowns.
3. Remove `fee_rmb` and `sample_count` from public response.
4. Use English labels for process if needed:
   - `CNC` -> `CNC Machining`
   - `车床` -> `Turning`
   - `车铣复合` -> `Mill-Turn Machining`
   - `板金` -> `Sheet Metal Fabrication`

### Phase F2: Backend Public Result Sanitization

Create a helper:

```python
def public_quote_response(result: dict) -> dict:
    ...
```

It should strip:

```text
formula
breakdown
pricing_model_version
pricing_mode
exchange_rate_basis
internal warnings
```

Keep full result for Inquiry logging.

Implementation pattern:

```python
result = calculate_quote_v2(payload)
_record_inquiry(payload, result, client_ip, user_agent)
return public_quote_response(result)
```

### Phase F3: Frontend Dropdown Cleanup

Modify `hydrateOptions()`:

```js
postprocessSelect.innerHTML = (options.postprocess_groups || [])
  .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.name)}</option>`)
  .join("");
```

Do the same in:

```text
js/quote.js
daiyujin-tools/assets/js/quote.js
```

### Phase F4: Result Card Cleanup

Remove:

```text
Model row
quote-breakdown block
formula-driven labels
internal disclaimer
```

Add:

```text
Status row
Review row
Request Formal Quote CTA
customer-safe disclaimer
```

### Phase F5: Empty State

Change `estimateCard()` empty state from plain text to price scaffold:

```text
Estimated Total
USD 0.00
Unit Price USD 0.00 / pc
Status Waiting for STEP file
```

### Phase F6: WordPress Sync

After main files pass tests, copy changes to:

```text
daiyujin-tools/templates/quote.php
daiyujin-tools/assets/js/quote.js
daiyujin-tools/assets/css/plugins.css
```

Then rebuild plugin zip if needed.

## 12. Acceptance Criteria

### 12.1 UI Acceptance

1. Postprocess dropdown is English only.
2. Postprocess dropdown shows no price.
3. Result card shows no `Model`.
4. Result card shows no `v2.1_additive`.
5. Result card shows no `Material term`.
6. Result card shows no `Setup allocation`.
7. Result card shows no `Machining base`.
8. Result card shows no RMB line items.
9. Result card shows one customer-safe disclaimer.
10. Empty state shows `USD 0.00`.
11. CTA says `Request Formal Quote`.

### 12.2 API Acceptance

Public quote options response should not contain:

```text
fee_rmb
sample_count
```

Public calculate response should not contain:

```text
formula
breakdown
pricing_model_version
pricing_mode
exchange_rate_basis
material_term_rmb
setup_term_rmb
machining_term_rmb
postprocess_fee_rmb
quantity_delta
safety_multiplier
```

### 12.3 Test Commands

Static JS syntax:

```powershell
& 'C:\Users\14539\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\quote.js
& 'C:\Users\14539\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check daiyujin-tools\assets\js\quote.js
```

Sensitive string scan:

```powershell
Select-String -Path js\quote.js,daiyujin-tools\assets\js\quote.js -Pattern 'fee_rmb|v2.1|pricing_model_version|Material term|Setup allocation|Machining base|quantity_delta|safety_multiplier'
```

Expected:

```text
No matches in customer render code.
```

WordPress sync:

```powershell
Compare-Object (Get-Content js\quote.js) (Get-Content daiyujin-tools\assets\js\quote.js)
```

Expected:

```text
No output.
```

## 13. Copy Deck

Use these public-facing labels:

| Area | Copy |
|---|---|
| Hero subtitle | Upload a STEP file and receive a reference manufacturing estimate. Final pricing is confirmed after engineering review. |
| Upload badge | Secure CAD intake |
| Progress title | Secure Assessment |
| Empty estimate status | Waiting for STEP file |
| Result status | Reference estimate |
| Review note | Engineering review required |
| Disclaimer | This estimate is for reference only. Final pricing and lead time will be confirmed after engineering review. |
| CTA | Request Formal Quote |

Avoid these terms in public UI:

```text
v2.1
deterministic
historical quote coefficients
material term
setup allocation
machining base
postprocess fee
RMB basis
sample count
dynamic factor
```

## 14. Release Gate

Do not deploy until all are true:

1. Main website and WordPress plugin show the same quote UI.
2. Public UI has no Chinese postprocess labels.
3. Browser-visible JSON has no fee or sample-count fields.
4. Public calculate response has no formula or breakdown.
5. Existing calculation tests still pass.
6. A manual browser check confirms no sensitive text is visible before upload, during progress, or after quote generation.
