# PRD-task2: Material Standards Lookup and Material Weight Calculator

Status: Draft for implementation  
Source request: `task 2 from Johnson.md`  
Scope: Two independent public pages for Daiyujin tools

## 1. Background

Task 2 contains two independent tool requirements:

1. A material standards lookup page. Users enter a material designation such as `EN AW7075`, `7075`, `AW7075`, `AISI 304`, or `S30400`, then receive a row of equivalent designations across common international standards.
2. A material weight calculator similar in interaction pattern to the Online Metals weight calculator. Users choose material, alloy, shape, unit, quantity, enter dimensions, and calculate piece weight and total weight.

These tools should be useful as standalone public pages and later embeddable into the WordPress plugin package.

Reference behavior:

- Online Metals weight calculator asks users to select material, shape, alloy, quantity, units, dimensions, then returns piece weight and total weight. It also documents the simple physical formula: `weight = volume × density`. Source: <https://www.onlinemetals.com/en/weight-calculator>
- Online Metals organizes calculator inputs by material, shape, alloy, number of pieces, unit of measure, and shape-specific dimensions.
- MatWeb provides material-property search and UNS lookup pages, showing that material data lookup normally depends on structured material identifiers and data sheets. Source: <https://www.matweb.com/search/SearchUNS.aspx>

## 2. Product Goals

### 2.1 Material Standards Lookup

Help customers, sales, and engineers quickly translate a material designation into equivalent or near-equivalent designations across major standards.

Example:

```text
Input: 7075

Material family: Aluminum alloy
Common name: Aluminum 7075
ISO: Al-Zn6MgCu
EN: EN AW-7075
DIN: 3.4365
ANSI/AA: 7075
UNS: A97075
JIS: A7075
...
```

### 2.2 Material Weight Calculator

Help users estimate stock weight for common shapes before quoting, shipping, or material planning.

Example:

```text
Material: Aluminum Alloy
Alloy: 6061
Shape: Round Bar
Diameter: 20 mm
Length: 100 mm
Quantity: 10

Piece weight: 0.085 kg
Total weight: 0.85 kg
```

## 3. Non-Goals

1. This phase does not certify material equivalency for regulated use.
2. This phase does not replace engineering review or material certificates.
3. This phase does not generate legally binding substitution advice.
4. This phase does not need user accounts.
5. This phase does not need admin UI.
6. This phase does not need paid database integration.
7. This phase does not merge the two pages into one combined material portal.

## 4. Page 1: Material Standards Lookup

### 4.1 Page Name

Recommended file:

```text
material-standards.html
```

Recommended title:

```text
Material Standards Lookup
```

WordPress template:

```text
daiyujin-tools/templates/material-standards.php
```

JavaScript:

```text
js/material-standards.js
daiyujin-tools/assets/js/material-standards.js
```

### 4.2 User Story

As a customer or engineer, I want to enter a material grade or partial designation, so that I can quickly see likely equivalent designations across ISO, EN, DIN, ANSI/AA, BS, AFNOR, UNE, UNS, JIS, CSA, and SIS.

### 4.3 Supported Standard Columns

The result table should include these columns:

| Column | Meaning |
|---|---|
| `material_family` | Aluminum alloy, stainless steel, engineering plastic, etc. |
| `common_name` | Human-readable material name |
| `ISO` | ISO designation |
| `EN` | European standard designation |
| `DIN` | Germany |
| `ANSI_AA_USA` | USA aluminum or related designation |
| `BS_GB` | Great Britain |
| `AFNOR_FR` | France |
| `UNE_ES` | Spain |
| `UNS` | Unified Numbering System |
| `JIS_JP` | Japan |
| `CSA_CA` | Canada |
| `SIS_SE` | Sweden |
| `notes` | Caution notes, partial equivalency, composition caveats |

The UI label can be cleaner:

```text
ISO | EN | DIN | ANSI/AA | BS | AFNOR | UNE | UNS | JIS | CSA | SIS
```

### 4.4 Search Behavior

Search must support:

1. Exact designation:
   - `EN AW-7075`
   - `UNS A97075`
   - `AISI 304`
2. Partial designation:
   - `7075`
   - `AW7075`
   - `304`
   - `S30400`
3. Normalized punctuation:
   - Ignore spaces.
   - Ignore hyphens.
   - Ignore case.
   - Treat `ENAW7075`, `EN AW 7075`, `EN AW-7075` as the same searchable alias.
4. Alias search:
   - `Delrin` should match `POM`.
   - `Teflon` should match `PTFE`.
   - `Polyamide` should match `Nylon / PA`.

### 4.5 Result Behavior

The first result should display as a compact standards row.

Recommended layout:

```text
Search: 7075

Aluminum 7075
Aluminum alloy · High-strength Al-Zn-Mg-Cu alloy

ISO       Al-Zn6MgCu
EN        EN AW-7075
DIN       3.4365
ANSI/AA   7075
UNS       A97075
JIS       A7075
...

Note: Equivalent designations are reference mappings. Confirm final material requirements with engineering review or supplier certificate.
```

If multiple candidates match:

```text
3 possible matches
7075 Aluminum
7075-T6 Aluminum
AlZn5.5MgCu
```

Selecting one expands the full standards row.

### 4.6 Empty State

If no match:

```text
No material match found.
Try another designation or contact us with your drawing and material requirement.
```

Do not add a new inquiry flow. The existing site email/contact behavior can handle these cases.

### 4.7 Data Requirements

Create a structured data file first, then later move to SQLite if needed.

Recommended path:

```text
backend/data/material_standards/material_equivalents.csv
backend/data/material_standards/material_aliases.csv
backend/data/material_standards/sources.csv
```

#### `material_equivalents.csv`

Recommended columns:

```text
material_id
material_family
common_name
ISO
EN
DIN
ANSI_AA_USA
BS_GB
AFNOR_FR
UNE_ES
UNS
JIS_JP
CSA_CA
SIS_SE
notes
confidence
review_status
source_ids
updated_at
```

#### `material_aliases.csv`

Recommended columns:

```text
alias
normalized_alias
material_id
alias_type
confidence
```

#### `sources.csv`

Recommended columns:

```text
source_id
title
url
publisher
accessed_at
source_type
reliability
notes
```

### 4.8 Data Collection Workflow

The material lookup depends on careful research. Do not fill a large table with unsourced AI guesses.

Recommended workflow:

1. Build initial seed list from `task 2 from Johnson.md`.
2. Split materials by family:
   - Aluminum alloys
   - Stainless steel
   - Carbon steel
   - Alloy steel
   - Titanium
   - Brass and copper
   - Engineering plastics
   - Die casting materials
   - Sheet metal materials
   - Specialized materials
3. Use research agents or scripts to collect standard mappings.
4. Require at least one source URL per material row.
5. Mark every row as one of:
   - `draft`
   - `verified`
   - `needs_review`
6. Public UI can show `verified` and `needs_review`, but must label caution notes for `needs_review`.
7. Keep uncertain equivalence as notes rather than pretending exact substitution.

### 4.9 Initial Material Families

Start with the materials explicitly listed in Task 2:

| Family | Initial scope |
|---|---|
| Aluminum alloys | 6061, 7075, common EN/DIN/ISO variants mentioned in the task |
| Stainless steel | 303, 304, 316 |
| Carbon steel | Common machining and sheet grades |
| Alloy steel | Common machining grades |
| Titanium | Commercial pure and Gr5 style references |
| Brass | Common free-machining brass |
| Copper | Common copper grades |
| Engineering plastics | POM, Nylon/PA, PTFE, PEEK, ABS, PC |
| Plastic materials | ABS, PP, PC, Nylon/PA, PBT, TPU, PEEK |
| Die casting materials | Aluminum, zinc, magnesium alloys |
| Sheet metal materials | Stainless steel, aluminum, galvanized steel, carbon steel |
| Specialized materials | High-temperature alloys, wear-resistant materials, corrosion-resistant alloys |

### 4.10 API Design

#### `GET /api/public/material-standards/search`

Query:

```text
q=7075
limit=10
```

Response:

```json
{
  "query": "7075",
  "normalized_query": "7075",
  "results": [
    {
      "material_id": "aluminum_7075",
      "material_family": "Aluminum alloy",
      "common_name": "Aluminum 7075",
      "matched_alias": "7075",
      "confidence": 0.95,
      "review_status": "verified",
      "standards": {
        "ISO": "Al-Zn6MgCu",
        "EN": "EN AW-7075",
        "DIN": "3.4365",
        "ANSI_AA_USA": "7075",
        "UNS": "A97075",
        "JIS_JP": "A7075"
      },
      "notes": "Reference mapping. Confirm final specification before substitution."
    }
  ]
}
```

#### `GET /api/public/material-standards/families`

Return family filters and counts.

### 4.11 Frontend Design

The page should feel like a fast lookup console, not a blog article.

Recommended structure:

1. Compact hero:
   - `Material Standards Lookup`
   - `Search international material designations across common engineering standards.`
2. Search input as first-viewport focus.
3. Optional family filter chips.
4. Result table or result cards.
5. Caution note at bottom.

Visual style:

1. Dense but clean.
2. Search input large enough to invite use.
3. Result row uses monospace for designations.
4. Use restrained badges for `verified` / `needs review`.
5. No decorative cards inside cards.

## 5. Page 2: Material Weight Calculator

### 5.1 Page Name

Recommended file:

```text
material-weight.html
```

Recommended title:

```text
Material Weight Calculator
```

WordPress template:

```text
daiyujin-tools/templates/material-weight.php
```

JavaScript:

```text
js/material-weight.js
daiyujin-tools/assets/js/material-weight.js
```

### 5.2 User Story

As a customer or engineer, I want to choose material, alloy, shape, unit, and dimensions, so that I can estimate piece weight and total weight for stock planning or shipping discussions.

### 5.3 Calculation Principle

The base physical formula is:

```text
weight = volume × density × quantity
```

Online Metals states this same principle in its public calculator explanation. Source: <https://www.onlinemetals.com/en/weight-calculator>

### 5.4 Input Fields

Required fields:

| Field | Type | Notes |
|---|---|---|
| Material family | select | Aluminum, stainless steel, plastic, brass, copper, etc. |
| Alloy / material | select | Depends on selected family |
| Shape | select or shape card | Shape controls required dimensions |
| Unit | select | `mm`, `cm`, `m`, `inch`, `ft` |
| Quantity | number | Integer, min 1 |
| Shape dimensions | number inputs | Dynamic by shape |

Optional output units:

```text
kg
g
lb
```

Default:

```text
metric input, kg output
```

### 5.5 Supported Materials

Use a density table separate from the standards lookup table, though both can share aliases later.

Recommended path:

```text
backend/data/material_weight/material_density.csv
```

Columns:

```text
material_id
family
label
density_g_cm3
density_lb_in3
source
notes
is_active
```

Initial materials:

| Family | Materials |
|---|---|
| Aluminum | 6061, 7075 |
| Stainless Steel | 303, 304, 316 |
| Carbon Steel | Generic carbon steel |
| Alloy Steel | Generic alloy steel |
| Titanium | Titanium Gr5 |
| Brass | Generic brass |
| Copper | Copper |
| Engineering Plastic | POM, Nylon/PA, PTFE, PEEK, ABS, Polycarbonate |
| Plastic Materials | ABS, PP, PC, Nylon/PA, PBT, TPU, PEEK |
| Die Casting | Aluminum alloy, zinc alloy, magnesium alloy |
| Sheet Metal | Stainless steel, aluminum, galvanized steel, carbon steel |

### 5.6 Supported Shapes

Start with the most useful shapes from Online Metals-style stock calculators:

| Shape | Required dimensions |
|---|---|
| Round Bar | diameter, length |
| Square Bar | side, length |
| Rectangular Bar / Plate | width, thickness, length |
| Sheet / Plate | length, width, thickness |
| Round Tube / Pipe | outer diameter, wall thickness, length |
| Square Tube | outer side, wall thickness, length |
| Rectangular Tube | outer width, outer height, wall thickness, length |
| Hex Bar | across flats, length |
| Ring | outer diameter, inner diameter, thickness |
| Disc / Circle | diameter, thickness |

Nice-to-have later:

```text
Angle
Channel
I-Beam
Coil
Wire
```

### 5.7 SVG Shape Diagrams

Each shape should show a simple SVG diagram with labeled dimensions.

Requirements:

1. SVGs must be inline or local assets.
2. Diagrams should update when shape changes.
3. Labels must match input names exactly:
   - `Diameter`
   - `Length`
   - `Wall Thickness`
   - `Width`
   - `Height`
4. Keep diagrams technical and minimal.
5. Do not use decorative illustration.

### 5.8 Shape Volume Formulas

All calculations should convert input dimensions to centimeters internally, then:

```text
volume_cm3 × density_g_cm3 = weight_g
```

Formulas:

| Shape | Formula |
|---|---|
| Round Bar | `π × (d / 2)^2 × length` |
| Square Bar | `side × side × length` |
| Rectangular Bar / Plate | `width × thickness × length` |
| Sheet / Plate | `length × width × thickness` |
| Round Tube / Pipe | `π × (od/2)^2 × length - π × ((od - 2t)/2)^2 × length` |
| Square Tube | `outer_side^2 × length - (outer_side - 2t)^2 × length` |
| Rectangular Tube | `outer_width × outer_height × length - (outer_width - 2t) × (outer_height - 2t) × length` |
| Hex Bar | `(sqrt(3) / 2) × across_flats^2 × length` |
| Ring | `π × (od/2)^2 × thickness - π × (id/2)^2 × thickness` |
| Disc / Circle | `π × (d / 2)^2 × thickness` |

Validation:

1. All dimensions must be positive.
2. Tube wall thickness must be less than half of outer diameter or side.
3. Ring inner diameter must be less than outer diameter.
4. Quantity must be integer >= 1.

### 5.9 API Design

#### `GET /api/public/material-weight/options`

Response:

```json
{
  "materials": [
    {
      "id": "aluminum_6061",
      "family": "Aluminum",
      "label": "Aluminum 6061"
    }
  ],
  "shapes": [
    {
      "id": "round_bar",
      "label": "Round Bar",
      "dimensions": [
        { "key": "diameter", "label": "Diameter" },
        { "key": "length", "label": "Length" }
      ]
    }
  ],
  "units": ["mm", "cm", "m", "inch", "ft"],
  "output_units": ["kg", "g", "lb"]
}
```

Do not expose density by default unless needed for transparency. If exposed, mark it as reference data rather than commercial data.

#### `POST /api/public/material-weight/calculate`

Request:

```json
{
  "material_id": "aluminum_6061",
  "shape": "round_bar",
  "unit": "mm",
  "output_unit": "kg",
  "quantity": 10,
  "dimensions": {
    "diameter": 20,
    "length": 100
  }
}
```

Response:

```json
{
  "material": {
    "id": "aluminum_6061",
    "label": "Aluminum 6061"
  },
  "shape": {
    "id": "round_bar",
    "label": "Round Bar"
  },
  "piece_weight": {
    "value": 0.085,
    "unit": "kg",
    "display": "0.085 kg"
  },
  "total_weight": {
    "value": 0.85,
    "unit": "kg",
    "display": "0.85 kg"
  },
  "volume": {
    "value_cm3": 31.416
  },
  "note": "Calculated from reference density. Actual weight may vary by tolerance, material condition, and supplier."
}
```

### 5.10 Frontend Design

The calculator should be an actual working tool on first screen.

Recommended structure:

1. Left panel: inputs.
2. Right panel: shape diagram and result.
3. Shape selector as icon/card grid or clean select.
4. Dimension inputs update instantly when shape changes.
5. Result card always visible with `0.00 kg` empty state.

Do not create a marketing landing page.

## 6. Shared Technical Architecture

### 6.1 Backend Files

Recommended:

```text
backend/services/material_standards.py
backend/services/material_weight.py
backend/data/material_standards/material_equivalents.csv
backend/data/material_standards/material_aliases.csv
backend/data/material_standards/sources.csv
backend/data/material_weight/material_density.csv
backend/data/material_weight/shapes.json
```

### 6.2 Frontend Files

Recommended:

```text
material-standards.html
material-weight.html
js/material-standards.js
js/material-weight.js
```

WordPress:

```text
daiyujin-tools/templates/material-standards.php
daiyujin-tools/templates/material-weight.php
daiyujin-tools/assets/js/material-standards.js
daiyujin-tools/assets/js/material-weight.js
```

### 6.3 Navigation

Add links to:

```text
index.html
tool nav
WordPress plugin shortcode or page routing
```

Suggested nav labels:

```text
Materials
Weight
```

If nav becomes crowded, group these under `Materials`.

## 7. Implementation Phases

### Phase T2-0: Data Contract

1. Create data directories.
2. Add seed CSVs with 5 verified rows for standards lookup.
3. Add density seed data for calculator.
4. Add shapes config.
5. Write data validation script.

Acceptance:

```text
CSV headers match PRD.
No row without material_id.
No standards lookup row without source_ids.
No density row without density_g_cm3.
```

### Phase T2-1: Material Standards Backend

1. Implement normalization.
2. Implement alias search.
3. Implement ranked result matching.
4. Implement `/api/public/material-standards/search`.
5. Implement `/api/public/material-standards/families`.

Acceptance:

```text
7075, AW7075, EN AW-7075 return same material_id.
AISI 304 and S30400 can resolve if seed data exists.
No match returns 200 with empty results, not 500.
```

### Phase T2-2: Material Standards Frontend

1. Build independent page.
2. Add search input.
3. Add family filter chips.
4. Add result row/table.
5. Add empty state.
6. Add caution note.
7. Sync WordPress template and JS.

Acceptance:

```text
User can search 7075 and see standards columns.
Partial input works.
Empty state is clear.
Page is usable on mobile.
```

### Phase T2-3: Weight Calculator Backend

1. Implement density loading.
2. Implement unit conversion.
3. Implement shape formulas.
4. Implement validation.
5. Implement `/api/public/material-weight/options`.
6. Implement `/api/public/material-weight/calculate`.

Acceptance:

```text
Round bar, plate, round tube, square tube, hex bar all calculate correctly.
Invalid tube dimensions return 400.
Quantity multiplies total weight.
```

### Phase T2-4: Weight Calculator Frontend

1. Build independent page.
2. Add material/alloy select.
3. Add shape select or cards.
4. Add SVG shape diagram.
5. Add dynamic dimension inputs.
6. Add result card.
7. Sync WordPress template and JS.

Acceptance:

```text
Changing shape changes dimension fields and diagram.
Result updates after calculate.
Mobile layout has no overlap.
```

### Phase T2-5: Tests and Release

1. Add backend smoke tests.
2. Add JS syntax checks.
3. Add sensitive data and broken-link scans.
4. Manual browser QA.
5. Plugin zip rebuild after approval.

## 8. Testing Plan

### 8.1 Backend Tests

Recommended files:

```text
backend/scripts/test_material_standards.py
backend/scripts/test_material_weight.py
```

Test cases:

1. `normalize_designation("EN AW-7075") == normalize_designation("enaw7075")`.
2. Search `7075` returns one or more results if seed exists.
3. Search unknown material returns empty result.
4. Round bar volume and weight are correct.
5. Round tube rejects invalid wall thickness.
6. Ring rejects inner diameter >= outer diameter.
7. API routes return 400 for invalid input, not 500.

### 8.2 Frontend Tests

Commands:

```powershell
& 'C:\Users\14539\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\material-standards.js
& 'C:\Users\14539\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\material-weight.js
```

WordPress sync:

```powershell
Compare-Object (Get-Content js\material-standards.js) (Get-Content daiyujin-tools\assets\js\material-standards.js)
Compare-Object (Get-Content js\material-weight.js) (Get-Content daiyujin-tools\assets\js\material-weight.js)
```

### 8.3 Manual QA

Material Standards Lookup:

1. Search `7075`.
2. Search `AW7075`.
3. Search `EN AW-7075`.
4. Search `304`.
5. Search unknown value.
6. Check mobile layout.

Material Weight Calculator:

1. Aluminum 6061 round bar in mm.
2. Stainless 304 plate in mm.
3. Copper round tube in inch.
4. POM rectangular bar in cm.
5. Invalid tube wall thickness.
6. Quantity 10 vs quantity 1.

## 9. UX Copy

### Material Standards Lookup

Hero:

```text
Material Standards Lookup
Search international material designations across common engineering standards.
```

Search placeholder:

```text
Search by grade, alias, or standard, e.g. 7075, EN AW-7075, AISI 304, S30400
```

Caution:

```text
Equivalent designations are for reference. Final material substitution should be confirmed by engineering review or supplier certificate.
```

### Material Weight Calculator

Hero:

```text
Material Weight Calculator
Estimate piece and total stock weight from material, shape, and dimensions.
```

Result note:

```text
Calculated from reference density. Actual weight may vary by tolerance, material condition, and supplier.
```

## 10. Risks and Controls

| Risk | Impact | Control |
|---|---|---|
| Incorrect material equivalence | Customer may assume wrong substitution | Source IDs, confidence, review status, caution copy |
| Standards differ by product form or temper | Equivalence may be incomplete | Notes field and engineering-review copy |
| AI-generated data is inaccurate | Table becomes unreliable | No unsourced row; require evidence URL |
| Weight calculator unit errors | Wrong weight output | Central unit conversion tests |
| Tube formula invalid dimensions | Negative volume | Strict validation |
| Too many materials at launch | Data QA slows delivery | Start with seed set and expand iteratively |

## 11. Definition of Done

Task 2 is ready when:

1. `material-standards.html` works as an independent page.
2. `material-weight.html` works as an independent page.
3. Backend has public APIs for both pages.
4. Standards lookup supports partial designation search.
5. Standards lookup data rows include source and review status.
6. Weight calculator supports at least 8 core shapes.
7. Weight calculator supports metric and imperial input units.
8. Both pages have WordPress plugin templates and synced JS.
9. Backend tests pass.
10. JS syntax checks pass.
11. Mobile layout has no overlap.
12. Public copy clearly says results are reference data.
