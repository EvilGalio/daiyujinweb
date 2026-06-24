# PRD: ISO Tolerance Calculator Frontend Optimization

Version: v1.0
Date: 2026-06-24
Owner: Daiyujin Precision Tools
Scope: `tolerance.html`, `js/tolerance.js`, `css/plugins.css`, and WordPress plugin mirrored files under `daiyujin-tools/`

## 1. Background

The current ISO tolerance calculator can complete the basic workflow:

1. User enters a basic size in mm.
2. User enters or selects a fit combination such as `H7/g6`.
3. Frontend calls `/api/public/tolerance/calculate`.
4. Page renders Shaft, Bore, and Fit results with SVG tolerance bars.

This is directionally correct. The page already has the right product idea: it is a compact engineering lookup tool rather than a marketing page.

However, the current frontend still feels like an MVP demo. For a precision machining company, the interface must feel closer to an instrument panel: stable, legible, numerically trustworthy, and visually tied to the physical idea of hole/shaft fit.

## 2. External Basis

The design should follow the mental model implied by ISO limits and fits:

- ISO 286-1:2010 is still current according to ISO, last reviewed and confirmed in 2026. It establishes the ISO code system for tolerances on linear sizes, including concepts of tolerance classes, deviations, fits, basic hole, and basic shaft.
- Engineering fits are generally understood through a hole and shaft pairing. Uppercase codes represent holes, lowercase codes represent shafts, such as `H7/h6`.
- Fit classification depends on the clearance range between the smallest/largest hole and largest/smallest shaft. The user needs to see both the numeric result and the tolerance-zone geometry.

References:

- ISO official page: https://www.iso.org/standard/45975.html
- Engineering fit overview: https://en.wikipedia.org/wiki/Engineering_fit
- IT grade overview: https://en.wikipedia.org/wiki/IT_Grade

Copyright note: the frontend and PRD should not reproduce full ISO tables. The UI should show computed values and brief explanatory labels only.

## 3. Current Frontend Review

### 3.1 Strengths

1. The current information architecture is sound: Basic Size, Fit Combination, Quick Select, then Shaft/Bore/Fit result.
2. The three result blocks already match the user's expected conceptual split: Shaft, Bore, Fit.
3. The datalist plus preset select reduces typing friction without adding dependencies.
4. The backend response already contains enough numeric fields for a better frontend, including `min_clearance_um`, `max_clearance_um`, and `max_interference_um`.
5. Existing Phase 1C smoke tests already cover clearance, transition, interference, invalid fit, and boundary size ranges.

### 3.2 Problems

#### P0: Encoding and unit display damage credibility

Observed strings include:

- `ISO Tolerance 鈥?Daiyujin Precision`
- `渭m`
- `鈥?`
- mojibake comments in `js/tolerance.js` and `css/plugins.css`

This is not merely cosmetic. A tolerance calculator lives or dies by trust. If the page shows broken unit symbols, users will assume the numerical logic may also be careless.

#### P0: Initial result state feels unfinished

Before the first calculation, the three SVG panels only show "Enter values above". The result area exists, but it does not look like a professional measurement tool waiting for input. A high-trust engineering calculator should show a stable zero axis, empty tolerance bands, and `$0.00`-style placeholder equivalents for metrics, not a blank instructional state.

#### P1: The current result hierarchy is inverted

The most important answer is the fit classification and clearance/interference range. Currently, the user must visually scan three separate panels and then the summary appears at the bottom.

Recommended hierarchy:

1. Fit summary.
2. Shared visual tolerance map.
3. Shaft and Bore detail values.

#### P1: The visualization lacks one strong shared axis

The three-column visualization is useful, but it fragments the comparison. Fit is relational. A good visual should first show both Bore and Shaft on the same micron axis, then provide separate details.

Current state:

- Shaft has one SVG.
- Bore has one SVG.
- Fit has another SVG.

Proposed state:

- One master fit map with a shared `µm` axis, zero line, Bore band, Shaft band, and highlighted clearance/overlap.
- Detail cards below or beside the chart for Shaft and Bore.

#### P1: Mechanical labels are under-specified

Current labels:

- `Deviations`
- `Limits`
- `Bore`

Better labels:

- `Bore (Hole)` on first display, then `Bore` afterward if the brand prefers that term.
- `ES / EI` for Bore upper/lower deviations.
- `es / ei` for Shaft upper/lower deviations.
- `Max size / Min size` instead of a bare range.
- `IT grade` and `Tolerance width`.

For an engineering user, these labels reduce ambiguity. The interface should not make the user infer whether `lower / upper` means EI/ES or min/max size.

#### P1: Fit shading should be numeric-driven

Current `fitSvg()` uses visual y-position comparisons such as:

```js
if (f.type === "clearance" && holeBot < shaftTop) { ... }
```

The backend already computes clearance/interference values. The frontend should use those semantic values to decide what to shade, then use SVG coordinates only for drawing. Otherwise a future chart scale change can quietly break the visual meaning.

#### P2: Controls compete with each other

`Fit Combination` and `Quick Select` are both useful, but the current layout gives them equal weight without explaining their relationship. The user may wonder whether selecting a preset should calculate immediately, or whether manual input overrides the preset.

The UI should make the mode explicit:

- Common Fits
- Custom

#### P2: Mobile comparison degrades

At mobile width, the three columns stack. That is responsive, but the relation between Bore and Shaft becomes harder to compare. Mobile should prioritize:

1. Summary.
2. Shared fit map.
3. Numeric details.
4. Controls remain reachable.

#### P2: Missing utility actions

A practical calculator should support:

- Copy result.
- Reset to default example.
- Possibly copy a short engineering note: `25 mm H7/g6: clearance fit, clearance range 20 to 41 µm`.

These actions turn the page from a demo into a daily-use tool.

#### P3: Dead or duplicated CSS should be cleaned

Current CSS contains likely unused or duplicated blocks:

- `.fit-cards`
- `.tolerance-empty`
- `.tolerance-loading`
- duplicate `.tz-data-meta`
- `.tolerance-card.fit-*`

These should be removed or reattached intentionally during implementation.

## 4. Product Goal

Upgrade the ISO tolerance page from a functional MVP into a credible engineering calculator that can be embedded in the company WordPress site.

The experience should communicate:

1. This is a real precision tool.
2. The numbers are traceable to the same backend calculation.
3. The fit relationship is visually obvious.
4. The page remains compact and professional on both desktop and mobile.

## 5. Non-Goals

1. Do not rewrite the backend tolerance algorithm in this phase.
2. Do not add unsupported tolerance zones to the UI.
3. Do not reproduce full ISO 286 tables in the page or PRD.
4. Do not add heavy charting libraries. Native SVG is enough.
5. Do not turn the page into a landing page.

## 6. Proposed Design

### 6.1 Page Personality

Design direction: precision instrument panel.

Visual principles:

- Dense but readable.
- Quiet color palette with clear semantic accents.
- Typography should favor mono numerals for measured values.
- Cards should be used only for actual result modules, not nested decoration.
- The first viewport should show the tool itself, not explanatory marketing copy.

### 6.2 Top Control Area

Replace the current loose control bar with a compact control strip:

1. Basic Size
   - Number input.
   - Fixed `mm` suffix inside the input group.
   - Range hint: `1 to 3150 mm`.

2. Fit Mode
   - Segmented control: `Common Fits` and `Custom`.
   - `Common Fits` shows preset chips or a dropdown.
   - `Custom` shows the text input with datalist.

3. Fit Combination
   - Keep `input list="fit-presets"`.
   - Preserve free typing.
   - Normalize user input on blur, for example `h7/g6` -> `H7/g6` if the backend accepts it.

4. Calculate
   - Primary button.
   - Disable during loading.
   - Optional auto-calculate on preset click after Phase T3.

### 6.3 Result Summary

The summary should be visible from the first page load with neutral placeholder values.

Initial state example:

| Field | Placeholder |
|---|---|
| Fit Type | Ready |
| Combination | H7/g6 |
| Basic Size | 25.000 mm |
| Clearance Range | 0 to 0 µm |
| Interference Range | 0 to 0 µm |

After calculation:

| Field | Example |
|---|---|
| Fit Type | Clearance fit |
| Combination | H7/g6 |
| Basic Size | 25.000 mm |
| Clearance Range | 20 to 41 µm |
| Interference Range | 0 µm |
| ISO Size Range | 18 to 30 mm |

The page should emphasize ranges, not only maximum values. A fit is experienced as a min/max condition in assembly.

### 6.4 Master Fit Map

Add one main SVG visualization called `Fit Map`.

Required elements:

1. Shared vertical `µm` axis.
2. Zero line labeled `Basic size`.
3. Bore tolerance band in blue.
4. Shaft tolerance band in orange.
5. Band labels, such as `Bore H7` and `Shaft g6`.
6. Top and bottom deviation labels.
7. Highlighted clearance/interference/transition area.
8. Legend with three semantic states:
   - Clearance: green.
   - Transition: amber.
   - Interference: red.

Layout concept:

```text
Fit Map

 +40 µm  ─────────────────────────
          [ Bore H7      ]
   0 µm  ━━━━━ Basic size ━━━━━━━━
          [ Shaft g6     ]
 -20 µm  ─────────────────────────

 Clearance range: 20 to 41 µm
```

The visual must be derived from backend numeric values. SVG coordinates should never decide the fit type.

### 6.5 Detail Panels

Keep Shaft and Bore details, but make them secondary to the master map.

Recommended fields:

#### Bore

- Code: `H7`
- Upper deviation `ES`: `+21 µm`
- Lower deviation `EI`: `0 µm`
- Max size: `25.021 mm`
- Min size: `25.000 mm`
- IT grade: `IT7`
- Tolerance width: `21 µm`

#### Shaft

- Code: `g6`
- Upper deviation `es`: `-7 µm`
- Lower deviation `ei`: `-20 µm`
- Max size: `24.993 mm`
- Min size: `24.980 mm`
- IT grade: `IT6`
- Tolerance width: `13 µm`

#### Fit

- Type.
- Minimum clearance.
- Maximum clearance.
- Maximum interference.
- Raw clearance range if available.

### 6.6 Copy and Reset Actions

Add a compact action row:

1. Copy Result
2. Reset

Copy output example:

```text
25.000 mm H7/g6: Clearance fit. Bore H7 = 25.000-25.021 mm, shaft g6 = 24.980-24.993 mm, clearance range = 7-41 µm.
```

The exact values should come from the current API response.

### 6.7 Error and Loading States

Loading:

- Keep layout stable.
- Show animated skeleton bands in the master fit map.
- Button text can change to `Calculating`.

Error:

- Show a compact inline error below the fit input.
- Keep previous successful result visible if available.
- If no previous result exists, keep neutral placeholder chart.

Examples:

- `Unsupported tolerance zone: z6`
- `Fit combination must look like H7/g6`
- `Basic size must be between 1 and 3150 mm`

## 7. Data Contract

The current backend response is mostly sufficient.

Frontend should use:

```json
{
  "fit_combination": "H7/g6",
  "size_range": "18-30",
  "hole": {
    "tolerance": "H7",
    "grade": "IT7",
    "lower_deviation_um": 0,
    "upper_deviation_um": 21,
    "min_size_mm": 25.0,
    "max_size_mm": 25.021,
    "it_um": 21
  },
  "shaft": {
    "tolerance": "g6",
    "grade": "IT6",
    "lower_deviation_um": -20,
    "upper_deviation_um": -7,
    "min_size_mm": 24.98,
    "max_size_mm": 24.993,
    "it_um": 13
  },
  "fit": {
    "type": "clearance",
    "label": "Clearance fit",
    "max_clearance_um": 41,
    "min_clearance_um": 7,
    "max_interference_um": 0
  }
}
```

If `min_clearance_um` is negative for transition or interference, frontend should preserve the sign in a raw range while displaying user-friendly labels:

- Clearance fit: show `min to max clearance`.
- Transition fit: show `clearance/interference range`.
- Interference fit: show `min to max interference`.

## 8. Implementation Plan

### Phase T0: Encoding and Text Hygiene

Files:

- `tolerance.html`
- `js/tolerance.js`
- `css/plugins.css`
- `daiyujin-tools/templates/tolerance.php`
- `daiyujin-tools/assets/js/tolerance.js`
- `daiyujin-tools/assets/css/plugins.css`

Tasks:

1. Fix visible mojibake in title and unit strings.
2. Use `um` in source strings if encoding reliability is uncertain, or use `\u00b5m` for `µm`.
3. Replace broken range separators with ASCII hyphen or `to`.
4. Remove mojibake comments or convert them to plain ASCII comments.
5. Check that no user-visible `鈥`, `渭`, or replacement artifacts remain.

Acceptance:

- `rg "鈥|渭|�" tolerance.html js/tolerance.js css/plugins.css daiyujin-tools` returns no user-visible tolerance strings.
- Browser title reads `ISO Tolerance - Daiyujin Precision`.
- Units render consistently as `µm` or `um`.

### Phase T1: Stable First-Load Result State

Tasks:

1. Summary bar is visible on first load.
2. Summary uses neutral placeholder values.
3. Three old placeholder SVGs are replaced or supplemented by one professional neutral fit map.
4. Layout height remains stable during idle, loading, success, and error states.

Acceptance:

- Opening `tolerance.html` shows a complete calculator surface before calculation.
- No card jumps when pressing Calculate.
- Empty state does not use instructional filler text inside the chart.

### Phase T2: Master Fit Map

Tasks:

1. Add a new shared-axis SVG.
2. Draw Bore and Shaft bands on the same coordinate system.
3. Label zero line, upper/lower deviations, and tolerance codes.
4. Shade fit condition using backend semantic values.
5. Keep color semantics consistent:
   - Bore: blue.
   - Shaft: orange.
   - Clearance: green.
   - Transition: amber.
   - Interference: red.

Acceptance:

- `25 mm H7/g6` clearly shows a clearance fit.
- `25 mm H6/k5` clearly shows a transition fit.
- `25 mm H7/p6` clearly shows an interference fit.
- Chart remains readable at desktop and 390px mobile width.

### Phase T3: Result Details and Terminology

Tasks:

1. Rename detail rows from generic `Deviations` to `ES/EI` and `es/ei`.
2. Show min/max size as separate rows or a clearly labeled range.
3. Show tolerance width.
4. Show clearance/interference range instead of only max values.
5. Add one concise engineering disclaimer below results:
   - `Reference calculation. Verify against the applicable drawing and standard before manufacturing.`

Acceptance:

- A mechanical user can identify hole limits, shaft limits, and fit range without guessing label meaning.
- No result field depends on color alone.

### Phase T4: Control Model and Presets

Tasks:

1. Add `Common Fits` and `Custom` segmented control.
2. Show presets from `/api/public/tolerance/presets`.
3. Preset click updates `fit_combination`.
4. Optional: preset click auto-runs calculation if basic size is valid.
5. Add inline validation for invalid format before API call.

Acceptance:

- `H7/g6`, `H7/h6`, `H7/p6`, `H6/k5`, and `H8/f7` are discoverable if backend returns them.
- Manual typing remains possible.
- Invalid input gives a local explanation before or alongside API error.

### Phase T5: Copy, Reset, Mobile, and Accessibility

Tasks:

1. Add Copy Result button.
2. Add Reset button.
3. Add `aria-live="polite"` to result summary.
4. Ensure all inputs have labels and errors are connected with `aria-describedby`.
5. Tune mobile order:
   - Controls.
   - Summary.
   - Fit map.
   - Details.
6. Verify text does not overflow buttons, cards, or chart labels.

Acceptance:

- Keyboard-only user can operate the calculator.
- Mobile viewport around 390px has no incoherent overlap.
- Copy Result writes a useful one-line summary to clipboard.

## 9. Test Plan

### 9.1 Static Checks

Run:

```powershell
rg "鈥|渭|�" tolerance.html js/tolerance.js css/plugins.css daiyujin-tools
python -B -m py_compile backend\services\tolerance.py backend\app.py
python backend\scripts\test_phase1c.py
```

### 9.2 API Cases

| Case | Input | Expected |
|---|---|---|
| Clearance | `25`, `H7/g6` | Type = clearance, no interference |
| Transition | `25`, `H6/k5` | Type = transition, both clearance and interference possible |
| Interference | `25`, `H7/p6` | Type = interference, no positive clearance |
| Boundary low | `1`, `H7/h6` | Valid response or clear supported-range message |
| Boundary high | `3150`, `H7/h6` | Valid response or clear supported-range message |
| Invalid code | `25`, `H7/z6` | Friendly validation/API error |
| Invalid format | `25`, `H7g6` | Friendly format error |

### 9.3 Visual Checks

Use browser verification after implementation:

1. Desktop viewport: 1440 x 900.
2. Tablet viewport: 768 x 1024.
3. Mobile viewport: 390 x 844.

Checklist:

- First-load result module is visible and complete.
- Summary appears above detailed values.
- Fit map zero line is visible.
- Bore and Shaft bands do not overlap labels incoherently.
- Color is helpful but not the only signal.
- Loading state does not collapse chart height.
- Error state does not erase the whole layout.

## 10. WordPress Plugin Sync Requirement

Because the tools are also packaged as `daiyujin-tools`, every accepted frontend change must be mirrored into:

- `daiyujin-tools/templates/tolerance.php`
- `daiyujin-tools/assets/js/tolerance.js`
- `daiyujin-tools/assets/css/plugins.css`

Acceptance:

- Standalone `tolerance.html` and WordPress shortcode `[dyj_tolerance_tool]` render the same tolerance experience.
- No logic divergence between root assets and plugin assets.

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| UI implies full ISO coverage while backend supports MVP zones only | High | Show only backend-returned presets and supported zones |
| Copyright issue from reproducing ISO tables | High | Show computed results only; link ISO source, do not embed full tables |
| Visual chart misrepresents fit type | High | Drive state from backend numeric fields |
| Mojibake returns after copy to plugin files | Medium | Add `rg` acceptance check across both root and plugin assets |
| Mobile SVG labels overlap | Medium | Use shorter labels and responsive chart dimensions |
| Preset UI conflicts with manual input | Medium | Explicit `Common Fits` / `Custom` mode |

## 12. Recommended Execution Order

Start with Phase T0 and T1. They are low-risk and immediately improve credibility.

Then implement Phase T2. The master fit map is the highest-value UX change because it turns abstract tolerance numbers into a physical relationship.

After that, finish Phase T3 to T5. These phases make the tool useful in real sales and engineering conversations, especially when the result needs to be copied into an email or RFQ discussion.

## 13. Definition of Done

The tolerance calculator optimization is done when:

1. No visible encoding errors remain.
2. The first-load page already looks like a complete engineering tool.
3. Fit classification and fit range are visible above detailed values.
4. A shared-axis fit map clearly shows Bore and Shaft tolerance zones.
5. Result terminology is mechanically precise.
6. Copy and reset actions work.
7. Standalone and WordPress plugin versions are synchronized.
8. Phase 1C backend smoke tests still pass.
9. Desktop and mobile browser checks pass without overlap or layout collapse.
