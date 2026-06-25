# PRD: ISO Tolerance Backend Expansion

Version: v1.0
Date: 2026-06-24
Owner: Daiyujin Precision Tools
Primary audience: backend implementer, frontend implementer, company website maintainer
Status: Draft for implementation

## 1. Executive Summary

当前 ISO tolerance calculator 的前端已经接近可用，但后端覆盖面太窄。现有 `backend/services/tolerance.py` 只支持少量公差带：

- Hole zones: `H`, `JS`
- Shaft zones: `f`, `g`, `h`, `k`, `p`
- IT grades: `IT5` 到 `IT18`
- Presets: `H6/k5`, `H7/g6`, `H7/h6`, `H7/p6`, `H8/f7`

这套实现适合 MVP，但不适合作为公司官网上的长期工程工具。用户在参考 MachiningDoctor 这类成熟工具时，会期待数十种 hole/shaft tolerance classes、单个公差查询、fit combination 查询、动态可选项和更完整的尺寸段支持。

本 PRD 的目标是把当前后端升级成一个数据驱动、可扩展、可验证的 ISO 286 tolerance engine。

核心方向：

1. 保持现有 API 兼容，让前端和 WordPress 插件不被立即打断。
2. 将硬编码分支迁移成数据驱动计算层。
3. 支持 single hole、single shaft、hole/shaft fit 三类查询。
4. 支持更多 IT grades 和更多 hole/shaft zones。
5. 引入 capabilities API，让前端从后端动态获取可支持范围。
6. 建立 golden test 和 property test，保证扩展不是“看起来完整，实际不可信”。
7. 明确 ISO 数据版权边界，不把未授权整表直接提交到公开仓库。

## 2. Background

### 2.1 Current User Problem

用户进入 tolerance calculator 时，期望像成熟工具一样：

1. 输入 basic size。
2. 选择 hole tolerance，比如 `H7`, `G7`, `JS7`, `K7`, `N7`, `P7`。
3. 选择 shaft tolerance，比如 `g6`, `h6`, `js6`, `k6`, `n6`, `p6`。
4. 立即得到 hole limits、shaft limits、clearance/interference range 和 fit type。
5. 可以从几十种常见公差带中选择，而不是只能用少数几种示例。

当前后端的问题是支持范围太窄，而且代码结构不适合继续横向扩展。继续在 `_build_hole()` 和 `_build_shaft()` 里追加 `elif spec.zone == ...` 会让实现变成一个越来越脆弱的大分支表。

### 2.2 External Reference

参考页面：

- MachiningDoctor tolerance calculator and charts: https://www.machiningdoctor.com/calculators/tolerances/
- ISO 286-1:2010 official page: https://www.iso.org/standard/45975.html

已确认的公开信息：

1. ISO 286-1:2010 在 ISO 官网显示为 current，并在 2026 年被 reviewed and confirmed。
2. ISO 286-1:2010 定义 linear sizes 的 code system、tolerance classes、deviations、fits、basic hole、basic shaft 等概念。
3. MachiningDoctor 的页面覆盖 standard tolerance grades、fundamental deviation、tolerance class、hole/shaft pairing、fit classification 和 tolerance charts。
4. 成熟 tolerance calculator 的产品形态一般包含 single tolerance calculation 和 fit calculation 两条路径。

### 2.3 Copyright Boundary

ISO 官网明确声明 ISO publications and materials are protected by copyright。MachiningDoctor 的表格和页面内容也不能直接复制为我们的数据源。

因此，本项目必须遵守以下原则：

1. 不直接抓取 MachiningDoctor 表格作为生产数据。
2. 不把完整 ISO 286-2 表格直接提交到公开 GitHub 仓库。
3. 如果公司拥有 ISO 286-1/286-2 授权，可以将必要数据整理到私有后端或私有配置，不随公开插件包分发。
4. 公开仓库中可以保留数据结构、示例数据、测试框架、少量公开验证样例和公式化计算逻辑。
5. 页面文案必须声明结果是 reference calculation，制造前仍需以图纸和适用标准为准。

这条边界很重要。一个工程工具的可信度来自数字，也来自数字的来源干净。

## 3. Goals

### 3.1 Product Goals

1. 用户可以查询更多常见 ISO tolerance classes。
2. 用户可以分别查询 single hole tolerance 和 single shaft tolerance。
3. 用户可以查询 fit combination，例如 `H7/g6`。
4. 前端的可选项由后端返回，避免前后端支持范围不一致。
5. API 返回足够丰富的数据，支持前端的共享轴可视化。
6. 结果字段明确区分 `EI/ES` 和 `ei/es`。
7. 所有已声明支持的 zone 和 grade 都有测试覆盖。

### 3.2 Engineering Goals

1. 用数据驱动替代大分支硬编码。
2. 拆分 parser、data loader、IT grade、fundamental deviation、fit classification。
3. 保留现有 `/api/public/tolerance/calculate` 的兼容行为。
4. 移除或显式标记 silent extrapolation。
5. 所有数据源都带 metadata。
6. 后端返回 warnings，使前端能提示 unsupported、unverified、reference-only 等状态。

### 3.3 Business Goals

1. 让公司官网工具看起来接近行业成熟水平。
2. 提升用户在询价前的自助判断能力。
3. 增加用户停留和信任感。
4. 为后续 quote tool 读取 tolerance 风险铺路。

## 4. Non-Goals

1. 本阶段不做 ANSI fits。
2. 本阶段不做 inch 输入，先只做 metric mm。
3. 本阶段不做 GD&T 形位公差。
4. 本阶段不把 tolerance calculator 变成完整设计规范教学页面。
5. 本阶段不承诺完全替代工程图纸审核。
6. 本阶段不在公开仓库内提交未授权的完整 ISO 表格。

## 5. Current Backend Assessment

### 5.1 Existing Files

Relevant files:

- `backend/services/tolerance.py`
- `backend/app.py`
- `backend/scripts/test_phase1c.py`
- `backend/README.md`
- `js/tolerance.js`
- `daiyujin-tools/assets/js/tolerance.js`

### 5.2 Current API

Existing routes:

- `GET /api/public/tolerance/tolerance-zones`
- `GET /api/public/tolerance/presets`
- `POST /api/public/tolerance/calculate`

Existing request shape:

```json
{
  "basic_size_mm": 25,
  "fit_combination": "H7/g6"
}
```

Alternative existing request:

```json
{
  "basic_size_mm": 25,
  "hole_tolerance": "H7",
  "shaft_tolerance": "g6"
}
```

Existing response includes:

- `basic_size_mm`
- `size_range`
- `fit_combination`
- `hole`
- `shaft`
- `fit`

This response is a good base. It should be extended, not discarded.

### 5.3 Current Algorithm

Current core flow:

1. Validate size.
2. Parse `H7/g6`.
3. Parse hole tolerance and shaft tolerance.
4. Find size range.
5. Compute IT width from formula.
6. Compute hole deviations using limited rules.
7. Compute shaft deviations using limited rules and small lookup tables.
8. Calculate clearance/interference.

Current strength:

- Simple.
- Easy to understand.
- Existing tests verify a few important cases.

Current limitations:

1. `HOLE_ZONES` and `SHAFT_ZONES` are fixed tuples with very small coverage.
2. `IT_FACTORS` starts at IT5, missing IT01, IT0, IT1 to IT4.
3. Some zones rely on `_lookup_or_extrapolate()`, which may create false confidence outside verified ranges.
4. Size range logic is embedded in one file.
5. Data source metadata is absent.
6. There is no capabilities API for frontend-driven selection.
7. No distinction between verified data, formula-derived data, and legacy fallback data.

## 6. Proposed Architecture

### 6.1 New Module Layout

Create a package:

```text
backend/
  services/
    tolerance_engine/
      __init__.py
      models.py
      parser.py
      data_loader.py
      capabilities.py
      it_grade.py
      deviation.py
      dimension.py
      fit.py
      errors.py
      legacy_adapter.py
      data/
        README.md
        metadata.example.json
        public_rules.json
        preferred_classes.json
        preferred_fits.json
        validation_vectors.example.json
```

Keep `backend/services/tolerance.py` initially as a facade:

```python
from services.tolerance_engine import (
    calculate_fit,
    calculate_tolerance_class,
    get_tolerance_capabilities,
    get_tolerance_presets,
    get_tolerance_zones,
)
```

This preserves imports in `backend/app.py` and reduces migration risk.

### 6.2 Architectural Layers

#### Layer 1: Parser

Responsibility:

- Parse tolerance class strings.
- Normalize casing.
- Reject invalid format early.

Examples:

- `H7` -> hole candidate, zone `H`, grade `7`
- `g6` -> shaft candidate, zone `g`, grade `6`
- `JS7` -> zone `JS`, grade `7`
- `js6` -> zone `js`, grade `6`

Rules:

1. Uppercase zone means hole.
2. Lowercase zone means shaft.
3. API may also accept explicit `kind`.
4. Mixed case should be normalized only when unambiguous.
5. Ambiguous input should return a clear error.

#### Layer 2: Data Loader

Responsibility:

- Load public rule data.
- Load preferred classes and fits.
- Optionally load licensed/private data from a local path or environment variable.
- Validate schema at startup.

Environment variable:

```powershell
TOLERANCE_PRIVATE_DATA_DIR=D:\company-private-data\iso286
```

If private data is not present:

- Engine still runs with public/minimal supported set.
- Capabilities return only verified public/minimal coverage.
- API does not pretend full ISO coverage.

#### Layer 3: IT Grade Calculator

Responsibility:

- Return tolerance width in microns for a given basic size and IT grade.

Inputs:

- `basic_size_mm`
- `grade`

Outputs:

- `tolerance_width_um`
- `size_range`
- `source`
- `rounding_method`

Data strategy:

1. Prefer verified table values when available.
2. Use formula-derived values only for grades and ranges where formula coverage is explicitly approved.
3. Return warning if a value is formula-derived rather than table-verified.

#### Layer 4: Fundamental Deviation Resolver

Responsibility:

- Determine the location of the tolerance zone relative to the zero line.

Inputs:

- `kind`: `hole` or `shaft`
- `zone`: for example `H`, `JS`, `g`, `p`
- `grade`
- `basic_size_mm`
- `size_range`
- `tolerance_width_um`

Outputs:

- `lower_deviation_um`
- `upper_deviation_um`
- `fundamental_deviation_symbol`: `EI`, `ES`, `ei`, or `es`
- `fundamental_deviation_um`
- `source`

Important examples:

- Hole `H`: `EI = 0`, `ES = IT`
- Shaft `h`: `es = 0`, `ei = -IT`
- `JS/js`: centered around zero, with explicit rounding rule
- Other zones: must be resolved from verified rule/table data

Do not infer unsupported zones by visual symmetry unless a verified standard rule is implemented and tested.

#### Layer 5: Dimension Builder

Responsibility:

- Convert deviations into actual min/max sizes.

For hole:

- `min_size_mm = basic_size_mm + EI / 1000`
- `max_size_mm = basic_size_mm + ES / 1000`

For shaft:

- `min_size_mm = basic_size_mm + ei / 1000`
- `max_size_mm = basic_size_mm + es / 1000`

#### Layer 6: Fit Calculator

Responsibility:

- Combine a hole dimension and shaft dimension.
- Calculate clearance window.
- Classify fit.

Formula:

```text
max_clearance_um = hole_max_um - shaft_min_um
min_clearance_um = hole_min_um - shaft_max_um
```

Classification:

- `clearance`: `min_clearance_um >= 0`
- `interference`: `max_clearance_um <= 0`
- `transition`: otherwise

Output should preserve raw signed clearance window.

## 7. Data Model

### 7.1 Tolerance Class Model

```python
@dataclass(frozen=True)
class ToleranceClass:
    raw: str
    kind: Literal["hole", "shaft"]
    zone: str
    grade: int
    normalized_code: str
```

### 7.2 Size Range Model

```python
@dataclass(frozen=True)
class SizeRange:
    lower_mm: float
    upper_mm: float
    label: str
    includes_lower: bool
    includes_upper: bool
```

### 7.3 Calculation Source Model

```python
@dataclass(frozen=True)
class CalculationSource:
    source_id: str
    source_type: Literal["public_rule", "licensed_table", "legacy", "manual_verified_sample"]
    version: str
    verified: bool
    note: str | None = None
```

### 7.4 Dimension Result Model

```python
@dataclass(frozen=True)
class DimensionResult:
    kind: Literal["hole", "shaft"]
    tolerance: str
    zone: str
    grade: str
    basic_size_mm: float
    size_range: str
    tolerance_width_um: int
    lower_deviation_um: int
    upper_deviation_um: int
    lower_symbol: str
    upper_symbol: str
    min_size_mm: float
    max_size_mm: float
    source: CalculationSource
    warnings: tuple[str, ...]
```

### 7.5 Fit Result Model

```python
@dataclass(frozen=True)
class FitResult:
    type: Literal["clearance", "transition", "interference"]
    label: str
    min_clearance_um: int
    max_clearance_um: int
    max_interference_um: int
    clearance_window_um: dict[str, int]
    allowance_um: int
```

`allowance_um` should equal the tightest signed clearance:

- clearance fit: positive minimum clearance
- transition fit: usually negative minimum clearance
- interference fit: negative maximum interference condition

## 8. Data Files

### 8.1 `metadata.example.json`

```json
{
  "engine_version": "iso286-reference-v2",
  "public_repo_safe": true,
  "notes": [
    "This example file documents schema only.",
    "Do not commit licensed ISO tables to a public repository."
  ]
}
```

### 8.2 `public_rules.json`

Purpose:

- Store rules safe to keep in repo.
- Include basic deterministic rules such as `H`, `h`, `JS/js`.
- Include legacy supported formulas only when reviewed.

Example:

```json
{
  "rules": [
    {
      "kind": "hole",
      "zone": "H",
      "method": "lower_zero",
      "lower_symbol": "EI",
      "upper_symbol": "ES",
      "source_type": "public_rule",
      "verified": true
    },
    {
      "kind": "shaft",
      "zone": "h",
      "method": "upper_zero",
      "lower_symbol": "ei",
      "upper_symbol": "es",
      "source_type": "public_rule",
      "verified": true
    },
    {
      "kind": "hole",
      "zone": "JS",
      "method": "centered_on_zero",
      "lower_symbol": "EI",
      "upper_symbol": "ES",
      "source_type": "public_rule",
      "verified": true
    },
    {
      "kind": "shaft",
      "zone": "js",
      "method": "centered_on_zero",
      "lower_symbol": "ei",
      "upper_symbol": "es",
      "source_type": "public_rule",
      "verified": true
    }
  ]
}
```

### 8.3 `preferred_classes.json`

Purpose:

- Tell frontend which classes are useful to show first.
- Keep this list separate from raw supported zones.

Example:

```json
{
  "hole": [
    {"code": "G7", "category": "preferred"},
    {"code": "H7", "category": "preferred"},
    {"code": "JS7", "category": "preferred"},
    {"code": "K7", "category": "preferred"},
    {"code": "N7", "category": "preferred"},
    {"code": "P7", "category": "preferred"},
    {"code": "H8", "category": "preferred"},
    {"code": "H9", "category": "preferred"},
    {"code": "H11", "category": "preferred"}
  ],
  "shaft": [
    {"code": "g6", "category": "preferred"},
    {"code": "h6", "category": "preferred"},
    {"code": "js6", "category": "preferred"},
    {"code": "k6", "category": "preferred"},
    {"code": "n6", "category": "preferred"},
    {"code": "p6", "category": "preferred"},
    {"code": "h7", "category": "preferred"},
    {"code": "h9", "category": "preferred"},
    {"code": "h11", "category": "preferred"}
  ]
}
```

Important: A preferred class must not be exposed as selectable unless the engine can calculate it.

### 8.4 `preferred_fits.json`

Purpose:

- Provide grouped fit combinations.
- Support frontend preset sections.

Example:

```json
{
  "hole_basis": {
    "clearance": ["H7/g6", "H7/h6", "H8/f7", "H8/h7", "H9/e8", "H11/b11", "H11/c11"],
    "transition": ["H7/js6", "H7/k6", "H7/n6"],
    "interference": ["H7/p6", "H7/r6", "H7/s6"]
  },
  "shaft_basis": {
    "clearance": [],
    "transition": [],
    "interference": []
  }
}
```

Again, these are UI presets. They do not prove calculation support. The capabilities builder must filter presets against actual support.

### 8.5 Private Licensed Data

If company decides to support full ISO 286-2 range:

```text
D:\company-private-data\iso286\
  metadata.json
  it_grade_table.json
  fundamental_deviation_table.json
  validation_vectors.json
```

Rules:

1. This folder is not committed to GitHub.
2. Deployment server loads it through `TOLERANCE_PRIVATE_DATA_DIR`.
3. If missing, engine downgrades to public/minimal support.
4. API capabilities report `coverage_mode: "public_minimal"` or `coverage_mode: "licensed_full"`.

## 9. API Design

### 9.1 Backward Compatible Endpoint

Keep:

```text
POST /api/public/tolerance/calculate
```

Request:

```json
{
  "basic_size_mm": 25,
  "fit_combination": "H7/g6"
}
```

Response:

```json
{
  "basic_size_mm": 25.0,
  "size_range": "18-30",
  "fit_combination": "H7/g6",
  "hole": {},
  "shaft": {},
  "fit": {},
  "engine": {
    "version": "iso286-reference-v2",
    "coverage_mode": "public_minimal",
    "data_version": "2026-06-24",
    "warnings": []
  }
}
```

### 9.2 New Capabilities Endpoint

Add:

```text
GET /api/public/tolerance/capabilities
```

Response:

```json
{
  "engine": {
    "version": "iso286-reference-v2",
    "coverage_mode": "public_minimal",
    "supports_private_data": true
  },
  "size_range_mm": {
    "min": 1,
    "max": 3150
  },
  "grades": ["IT01", "IT0", "IT1", "IT2", "IT3", "IT4", "IT5", "IT6", "IT7", "IT8", "IT9", "IT10", "IT11", "IT12", "IT13", "IT14", "IT15", "IT16", "IT17", "IT18"],
  "hole": {
    "zones": ["H", "JS"],
    "classes": ["H6", "H7", "H8", "H9", "H11", "JS6", "JS7"]
  },
  "shaft": {
    "zones": ["f", "g", "h", "js", "k", "p"],
    "classes": ["f7", "g6", "h6", "h7", "js6", "k6", "p6"]
  },
  "presets": {
    "hole_basis": {
      "clearance": ["H7/g6", "H7/h6", "H8/f7"],
      "transition": ["H6/k5"],
      "interference": ["H7/p6"]
    }
  },
  "warnings": [
    "Full ISO 286-2 table data is not loaded."
  ]
}
```

Frontend must use this endpoint to render available choices.

### 9.3 Single Tolerance Endpoint

Add:

```text
POST /api/public/tolerance/calculate-class
```

Request:

```json
{
  "basic_size_mm": 25,
  "kind": "hole",
  "tolerance": "H7"
}
```

Response:

```json
{
  "basic_size_mm": 25.0,
  "size_range": "18-30",
  "dimension": {
    "kind": "hole",
    "tolerance": "H7",
    "zone": "H",
    "grade": "IT7",
    "tolerance_width_um": 21,
    "lower_symbol": "EI",
    "upper_symbol": "ES",
    "lower_deviation_um": 0,
    "upper_deviation_um": 21,
    "min_size_mm": 25.0,
    "max_size_mm": 25.021,
    "source": {
      "source_type": "public_rule",
      "verified": true
    },
    "warnings": []
  }
}
```

### 9.4 Fit Endpoint

Add:

```text
POST /api/public/tolerance/calculate-fit
```

Request:

```json
{
  "basic_size_mm": 25,
  "hole_tolerance": "H7",
  "shaft_tolerance": "g6"
}
```

Response:

```json
{
  "basic_size_mm": 25.0,
  "size_range": "18-30",
  "fit_combination": "H7/g6",
  "hole": {
    "kind": "hole",
    "tolerance": "H7",
    "grade": "IT7",
    "lower_symbol": "EI",
    "upper_symbol": "ES",
    "lower_deviation_um": 0,
    "upper_deviation_um": 21,
    "min_size_mm": 25.0,
    "max_size_mm": 25.021
  },
  "shaft": {
    "kind": "shaft",
    "tolerance": "g6",
    "grade": "IT6",
    "lower_symbol": "ei",
    "upper_symbol": "es",
    "lower_deviation_um": -20,
    "upper_deviation_um": -7,
    "min_size_mm": 24.98,
    "max_size_mm": 24.993
  },
  "fit": {
    "type": "clearance",
    "label": "Clearance fit",
    "min_clearance_um": 7,
    "max_clearance_um": 41,
    "max_interference_um": 0,
    "clearance_window_um": {
      "minimum": 7,
      "maximum": 41
    },
    "allowance_um": 7
  },
  "engine": {
    "version": "iso286-reference-v2",
    "coverage_mode": "public_minimal",
    "warnings": []
  }
}
```

## 10. Error Model

All tolerance errors should return HTTP 400 with stable error codes.

Examples:

```json
{
  "code": "unsupported_tolerance_zone",
  "message": "Unsupported shaft zone z",
  "details": {
    "kind": "shaft",
    "zone": "z",
    "supported_zones": ["f", "g", "h", "js", "k", "p"]
  }
}
```

Recommended error codes:

- `invalid_basic_size`
- `invalid_tolerance_format`
- `invalid_fit_combination`
- `unsupported_tolerance_grade`
- `unsupported_tolerance_zone`
- `unsupported_tolerance_class`
- `missing_private_tolerance_data`
- `tolerance_data_schema_error`

Do not return a generic `ValueError` message directly when structured context is available.

## 11. Coverage Strategy

### 11.1 Coverage Modes

The engine should explicitly expose a coverage mode:

| Mode | Meaning | Intended Use |
|---|---|---|
| `legacy_mvp` | Current compatibility subset | Temporary migration only |
| `public_minimal` | Public-safe rules and verified examples | Public GitHub and plugin demo |
| `preferred_verified` | Common preferred classes with authorized data | Company website recommended |
| `licensed_full` | Full or near-full ISO 286-2 data loaded privately | Long-term production |

### 11.2 Recommended First Production Target

For the next working version, target `preferred_verified` rather than claiming full ISO coverage.

Minimum useful set:

Hole classes:

- `H6`, `H7`, `H8`, `H9`, `H11`
- `JS6`, `JS7`, `JS9`
- `G7`
- `K7`
- `N7`
- `P7`

Shaft classes:

- `f7`
- `g6`
- `h6`, `h7`, `h9`, `h11`
- `js6`, `js7`
- `k5`, `k6`
- `n6`
- `p6`
- optionally `r6`, `s6`

Fit presets:

- Clearance: `H7/g6`, `H7/h6`, `H8/f7`, `H8/h7`, `H9/e8`, `H11/b11`, `H11/c11`
- Transition: `H6/k5`, `H7/js6`, `H7/k6`, `H7/n6`
- Interference: `H7/p6`, `H7/r6`, `H7/s6`

If authorized data for a class is unavailable, do not show that class in capabilities.

## 12. Implementation Phases

### Phase B0: Data and Licensing Decision

Goal:

Decide how much ISO 286 data can legally and safely be used.

Tasks:

1. Confirm whether the company owns ISO 286-1 and ISO 286-2 documents.
2. Confirm whether this GitHub repository is public.
3. Decide whether production backend can load private data outside the repo.
4. Decide first target coverage mode:
   - `public_minimal`
   - `preferred_verified`
   - `licensed_full`
5. Create `backend/services/tolerance_engine/data/README.md` explaining data policy.

Acceptance:

- PRD owner signs off on coverage mode.
- No developer is asked to scrape MachiningDoctor or copy full ISO tables into public repo.

### Phase B1: Engine Refactor With No Coverage Expansion

Goal:

Move current behavior into the new engine package without changing outputs.

Tasks:

1. Create `tolerance_engine/` package.
2. Move parsing into `parser.py`.
3. Move size range logic into `it_grade.py`.
4. Move existing H/JS/f/g/h/k/p calculations into `deviation.py`.
5. Move dimension payload building into `dimension.py`.
6. Move fit classification into `fit.py`.
7. Keep `backend/services/tolerance.py` as compatibility facade.
8. Run existing `backend/scripts/test_phase1c.py`.

Acceptance:

- Existing tests pass.
- Existing API response shape remains compatible.
- `25 H7/g6`, `25 H6/k5`, `25 H7/p6` produce exactly the same values as before.
- No frontend change is required.

### Phase B2: Add Capabilities API

Goal:

Make frontend selection dynamic.

Tasks:

1. Implement `get_tolerance_capabilities()`.
2. Add `GET /api/public/tolerance/capabilities`.
3. Keep `GET /api/public/tolerance/tolerance-zones` as legacy endpoint.
4. Add tests for capabilities response.
5. Ensure presets are filtered by actual engine support.

Acceptance:

- Capabilities endpoint returns only calculable zones/classes.
- Frontend can use capabilities without hardcoding supported zones.
- Legacy endpoints still work.

### Phase B3: Add Single Tolerance Calculation

Goal:

Support single hole and single shaft tolerance lookup.

Tasks:

1. Implement `calculate_tolerance_class()`.
2. Add `POST /api/public/tolerance/calculate-class`.
3. Support explicit `kind` and inferred kind from casing.
4. Return `EI/ES` or `ei/es` symbols.
5. Add tests for `H7`, `h6`, `JS7`, `js6`.

Acceptance:

- User can calculate one hole tolerance without choosing shaft.
- User can calculate one shaft tolerance without choosing hole.
- Response can drive a single tolerance visualization.

### Phase B4: Expand IT Grade Support

Goal:

Support IT01, IT0, IT1 to IT18 where data is verified.

Tasks:

1. Replace `IT_FACTORS` naming with a real grade resolver.
2. Add grade parser for `IT01`, `IT0`, `IT1` to `IT18`.
3. Support tolerance class syntax such as `H7`, where grade is `7`.
4. Add table-first lookup where authorized table data exists.
5. Add formula fallback only when explicitly approved.
6. Add tests for boundary ranges.

Acceptance:

- Capabilities returns grade coverage accurately.
- Unsupported grade returns structured error.
- No grade appears as supported unless it can be calculated.

### Phase B5: Expand Preferred Classes

Goal:

Add a practical set of common classes used in fits.

Tasks:

1. Add preferred hole/shaft classes based on authorized data availability.
2. Implement deviation resolver for each added class.
3. Add golden tests for every class.
4. Add preset grouping.
5. Update capabilities.

Acceptance:

- At least 20 practical classes are available if data is authorized.
- Every exposed class has at least one golden test.
- Fit presets are grouped into clearance, transition, interference.

### Phase B6: Optional Full Licensed Data Loader

Goal:

Support broader ISO 286-2 coverage without committing licensed tables to public repo.

Tasks:

1. Define private data schema.
2. Implement loader from `TOLERANCE_PRIVATE_DATA_DIR`.
3. Validate schema at startup or first use.
4. Add admin/deployment docs.
5. Add tests with tiny synthetic private data fixture.

Acceptance:

- Production backend can load private data.
- Public repo remains clean.
- Missing private data causes graceful downgrade, not crash.

### Phase B7: Frontend and WordPress Sync

Goal:

Connect frontend choices to backend capabilities.

Tasks:

1. Root frontend calls `/api/public/tolerance/capabilities`.
2. WordPress plugin frontend calls same endpoint.
3. Presets are grouped by category.
4. Unsupported classes cannot be selected.
5. Existing manual input still works and returns structured errors.

Acceptance:

- Standalone page and WordPress shortcode show same supported options.
- Frontend no longer hardcodes the old five presets.

### Phase B8: Documentation and Deployment

Goal:

Make future maintenance safe.

Tasks:

1. Update `backend/README.md`.
2. Add `backend/services/tolerance_engine/data/README.md`.
3. Add `Used_PRD` note after implementation if the project follows that convention.
4. Document environment variable for private data.
5. Document how to run tests.

Acceptance:

- A new developer can understand where tolerance data comes from.
- Deployment operator knows how to enable private data.

## 13. Testing Plan

### 13.1 Existing Smoke Tests

Keep and expand:

```powershell
& 'D:\anaconda\python.exe' backend\scripts\test_phase1c.py
```

Current must-pass examples:

- `25 H6/k5`
- `25 H7/g6`
- `25 H7/p6`
- `18 H7/h6`
- `1500 H7/h6`
- invalid `H7/z6`

### 13.2 New Unit Tests

Create:

```text
backend/scripts/test_tolerance_engine_parser.py
backend/scripts/test_tolerance_engine_it.py
backend/scripts/test_tolerance_engine_deviation.py
backend/scripts/test_tolerance_engine_fit.py
backend/scripts/test_tolerance_engine_api.py
```

Parser tests:

- `H7` parses as hole.
- `g6` parses as shaft.
- `JS7` parses as hole.
- `js6` parses as shaft.
- `H07` normalizes or rejects based on chosen rule.
- `H7/g6` parses as fit combination.
- `H7g6` returns format error.

IT tests:

- Size boundary inclusivity.
- Grade support.
- Unsupported grade.
- Formula/table source metadata.

Deviation tests:

- `H`: lower deviation equals zero.
- `h`: upper deviation equals zero.
- `JS/js`: centered behavior and rounding.
- Each preferred class has golden vectors.

Fit tests:

- Clearance classification.
- Transition classification.
- Interference classification.
- Raw clearance window preserved.

API tests:

- Capabilities endpoint.
- Calculate class endpoint.
- Calculate fit endpoint.
- Legacy calculate endpoint.
- Error schema.

### 13.3 Golden Vector Tests

Create:

```text
backend/services/tolerance_engine/data/validation_vectors.example.json
backend/tests/fixtures/tolerance_validation_vectors.json
```

Vector shape:

```json
[
  {
    "basic_size_mm": 25,
    "kind": "hole",
    "tolerance": "H7",
    "expected": {
      "lower_deviation_um": 0,
      "upper_deviation_um": 21,
      "min_size_mm": 25.0,
      "max_size_mm": 25.021
    },
    "source": "legacy_phase1c"
  }
]
```

Golden vector policy:

1. Every exposed class needs at least one golden vector.
2. Every preferred fit needs at least one golden vector.
3. Boundary ranges need explicit vectors.
4. If a vector comes from licensed data, do not commit it publicly unless permitted.

### 13.4 Property Tests

Even without external reference tables, these invariants must always hold:

1. `min_size_mm <= max_size_mm`
2. `upper_deviation_um - lower_deviation_um == tolerance_width_um`
3. For fit:
   - `max_clearance_um == hole.upper_deviation_um - shaft.lower_deviation_um`
   - `min_clearance_um == hole.lower_deviation_um - shaft.upper_deviation_um`
4. Clearance fit means `min_clearance_um >= 0`.
5. Interference fit means `max_clearance_um <= 0`.
6. Transition fit means `min_clearance_um < 0 < max_clearance_um`.
7. Capabilities must not expose uncalculable classes.

### 13.5 Manual Cross-Check

Use MachiningDoctor as a human cross-check reference, not as copied source data.

Manual process:

1. Pick 5 supported hole classes.
2. Pick 5 supported shaft classes.
3. Pick 5 supported fits.
4. Compare output values manually.
5. Record discrepancies in a local verification note.
6. If discrepancies are due to rounding rules, document the chosen rounding policy.

## 14. Rounding Policy

The engine must have one visible rounding policy.

Recommended:

1. Deviations are integers in microns.
2. Min/max sizes are rounded to 6 decimal places in mm.
3. Frontend may display 3 decimals or 6 decimals depending on context, but API preserves precision.
4. JS/js half-IT cases must define how odd micron widths split around zero.
5. Fit calculations should use micron integer deviations as primary source, not rounded mm strings.

Avoid this:

```python
raw_max_clearance_um = int(round((hole["max_size_mm"] - shaft["min_size_mm"]) * 1000))
```

Prefer:

```python
raw_max_clearance_um = hole["upper_deviation_um"] - shaft["lower_deviation_um"]
raw_min_clearance_um = hole["lower_deviation_um"] - shaft["upper_deviation_um"]
```

This removes floating-point rounding noise from fit classification.

## 15. Frontend Contract

Frontend should no longer assume:

- supported hole zones are fixed,
- supported shaft zones are fixed,
- presets are fixed,
- all unsupported input errors are generic.

Frontend should:

1. Load `/api/public/tolerance/capabilities` on page load.
2. Render preset groups from response.
3. Use `calculate-fit` for fit combination.
4. Use `calculate-class` if the UI adds single tolerance mode.
5. Preserve manual input for expert users.
6. Display warnings from `engine.warnings`.
7. Show coverage mode somewhere unobtrusive, for example `Reference ISO calculator - preferred classes`.

## 16. WordPress Plugin Contract

Because this site also has `daiyujin-tools`, backend API changes must remain compatible with:

- `daiyujin-tools/templates/tolerance.php`
- `daiyujin-tools/assets/js/tolerance.js`
- `daiyujin-tools/assets/css/plugins.css`

Rules:

1. Do not break existing shortcode `[dyj_tolerance_tool]`.
2. Plugin frontend should read capabilities from the public backend.
3. If company website uses Cloudflare Tunnel, the API base URL must be configurable.
4. Plugin assets must not contain ISO private data.

## 17. Deployment Notes

### 17.1 Public Minimal Deployment

Works with current repo only.

Required:

- Flask backend.
- Public-safe rule data.
- Existing SQLite inquiry logging if desired.

No private data required.

### 17.2 Preferred Verified Deployment

Recommended for company website.

Required:

- Flask backend.
- Private or internally verified data for preferred classes.
- `TOLERANCE_PRIVATE_DATA_DIR` configured on the always-on PC or server.
- Cloudflare Tunnel points public API domain to local backend.

### 17.3 Licensed Full Deployment

Long-term option.

Required:

- Licensed ISO data available to company.
- Private data directory.
- Backend not exposing raw table downloads.
- API only returns calculation results and capability lists.

## 18. Security and Abuse Considerations

The tolerance calculator is low-risk compared with file upload, but still needs limits.

Requirements:

1. Reject non-finite sizes.
2. Reject size outside supported range.
3. Limit string length for tolerance input.
4. Use strict regex for tolerance class.
5. Do not echo raw input without escaping in frontend.
6. Avoid debug traces in API errors.
7. Rate limiting can be added later at Cloudflare level if abused.

## 19. Observability

Log or record:

- basic size,
- fit combination,
- success/error,
- unsupported zone requests,
- coverage mode,
- user agent and IP if current inquiry logging remains enabled.

Useful future insight:

- Which unsupported zones do users try most?
- Which presets are clicked most?
- Which size ranges are common?

This can guide which classes to verify next.

## 20. Acceptance Criteria

### 20.1 Must Pass Before Merge

1. Existing Phase 1C tests pass.
2. New engine package is covered by unit tests.
3. Legacy API response remains compatible.
4. Capabilities endpoint exists.
5. Capabilities endpoint does not expose unsupported classes.
6. Fit classification uses integer micron deviations, not rounded mm difference.
7. No silent extrapolation remains in production path.
8. No complete ISO 286-2 table is committed to public repo.
9. WordPress plugin still renders tolerance calculator.

### 20.2 Must Pass Before Production

1. Target coverage mode is explicitly chosen.
2. Every exposed class has golden vector coverage.
3. Every exposed fit preset has golden vector coverage.
4. Frontend options are driven by capabilities API.
5. Unsupported manual input shows clear error.
6. API has stable structured error codes.
7. Documentation explains data source and limitations.

## 21. Suggested Implementation Order

Recommended order:

1. B0: settle data/licensing boundary.
2. B1: refactor current behavior into package.
3. B2: add capabilities endpoint.
4. B3: add single tolerance endpoint.
5. B4: expand IT grades where verified.
6. B5: add preferred classes.
7. B7: update frontend and WordPress plugin.
8. B8: update docs.
9. B6 can run in parallel if private licensed data is ready.

Reasoning:

The current calculator already works for a narrow set. The safest path is to preserve those outputs first, then widen the supported domain. A tolerance engine is like a measuring instrument: a small verified range is better than a large unverified range.

## 22. Open Questions

1. Is `D:\myfirstgithubcode\daiyujinweb` pushed to a public GitHub repository?
2. Does the company own ISO 286-1 and ISO 286-2 documents?
3. Is the production backend allowed to load private data outside the public repo?
4. Should first production target be `preferred_verified` rather than `licensed_full`?
5. Does the frontend need inch display, or is metric-only acceptable for v2?
6. Should inquiry logging store tolerance calculations, or should it be disabled for privacy?

## 23. Definition of Done

The backend expansion is complete when:

1. The old MVP calculator outputs are preserved.
2. The new engine supports dynamic capabilities.
3. The frontend can offer more classes without hardcoding them.
4. Single tolerance and fit calculation both work.
5. The selected coverage mode is honest and visible.
6. All exposed classes and presets are tested.
7. Private licensed data, if used, stays outside the public plugin and public repo.
8. Backend README tells a future maintainer how to add or verify a tolerance class.
9. Company website users experience the tool as a credible engineering calculator rather than a limited demo.
