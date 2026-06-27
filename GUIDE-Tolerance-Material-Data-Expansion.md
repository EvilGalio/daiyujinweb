# ISO Tolerance Common Fits 与 Material 数据扩充指导书

日期：2026-06-27  
范围：ISO Tolerance 页面、Material Standards 页面、Material Weight 数据、WordPress 插件同步  
目标：让 tolerance 和 material 两个页面的数据覆盖更广、来源更可信、更新流程更可控，避免继续靠少量手工样例支撑“科学严谨”的观感。

## 1. 当前结论

当前系统的核心问题不是前端样式，而是数据覆盖面偏窄：

1. ISO Tolerance 页面现在只有少量 common fits。后端虽然已经是 `tolerance_engine`，但 `preferred_fits.json` 只收了 12 个左右的 hole-basis fit，远少于工程上常见的 fits。
2. 当前 engine 的 `public_rules.json` 和 `fundamental_deviations.json` 只覆盖部分 tolerance zones。单纯往 `preferred_fits.json` 加几十个 fit 会导致计算失败，因为很多 zone 还没有 deviation rule。
3. Material Standards 页面当前 `material_equivalents.csv` 只有十几条，展示上像一个 demo。若想显得可信，需要扩充到常见 CNC 材料族，并且给每条数据记录来源、置信度、审查状态。
4. Material Weight 页面当前 `material_density.csv` 也偏少，需要和材料标准页共享 material id、family、source_id，避免两个页面各维护一套材料命名。

建议把这次工作定义成一个“数据工程小版本”，而不是只改几个下拉选项。

## 2. 已核查的可信数据源

### 2.1 Tolerance / Fits 数据源

#### ISO 286-1:2010，官方标准依据

URL: https://www.iso.org/standard/45975.html  
用途：作为 tolerance system 的最高层标准依据。ISO 官方页面说明 `ISO 286-1:2010` 是 GPS 线性尺寸公差代码系统的基础，包含 tolerance、deviation、fits、basic hole、basic shaft 等概念。页面还显示该标准在 2026 年完成系统复审并确认仍为 current。

使用建议：

- 作为标准引用源。
- 不要直接复制 ISO 原文和表格到公开仓库。
- 如果需要完整表格，应购买或使用公司授权的 ISO 标准，再把内部校验结果转成我们自己的结构化数据。

#### ISO 286-2:2010，表格依据

公开检索信息显示 `ISO 286-2:2010` 是 `Tables of standard tolerance classes and limit deviations for holes and shafts`。  
用途：作为 hole/shaft limit deviation 表格的正式来源。

使用建议：

- 把它作为验证源，而不是网页爬取源。
- 由于 ISO 标准内容有版权，工程实现应记录 `source_id=iso_286_2_licensed`，数据入库来源应来自公司合法授权或人工校验。

#### MachiningDoctor Engineering Fits & Tolerances

URL: https://www.machiningdoctor.com/calculators/tolerances/  
用途：公开可访问的工程 fits 参考和交叉验证源。该页面说明 ISO 286-1/286-2 是 shafts/holes 常用 tolerancing system，并列出了 hole-basis、shaft-basis、ANSI B4.1/B4.2 等 fit combinations。

使用建议：

- 用于确定 common fits 的覆盖范围和分类。
- 用于浏览器人工校验，不建议把网页内容机械抓取进项目。
- 对关键 fit，在多个 basic size 上用我们计算结果与该网站结果对比，形成测试样本。

### 2.2 Material 数据源

#### MatWeb

URL: https://www.matweb.com/  
用途：材料属性、密度、牌号、制造商 datasheet 的综合参考。页面自述包含超过 185,000 个 metals、plastics、ceramics、composites data sheets。

使用建议：

- 适合人工查证常见材料的 density、designation、属性范围。
- MatWeb 页面明确提示其数据内容不可未经许可复制或实质性重现，因此不要写爬虫批量搬运。
- 如果公司希望大规模导入，优先联系 MatWeb database licensing。

#### Total Materia

URL: https://www.totalmateria.com/  
用途：最适合做企业级材料 cross-reference 的商业数据源。其官网说明 Horizon 覆盖 570,000+ materials、25 million property records、80 global standards and equivalencies。

使用建议：

- 这是长期最优数据源，但应按商业授权使用。
- 如果公司愿意购买，建议把 Total Materia 作为 material standards 的主数据源。
- 可把本项目的数据结构设计成未来能接 Total Materia export 或 API。

#### SteelNumber

URL: https://www.steelnumber.com/en/number_en10027_eu.php  
用途：欧洲钢号、EN 10027 编号体系、钢类分类的公开参考。页面按 EN 10027-2 展示 steel number classification。

使用建议：

- 适合人工校核 EN/DIN/W.Nr. 钢号归类。
- 页面也提示内容不可复制，因此只作为人工校验和 source reference，不批量复制。

#### MachiningDoctor Materials

URL: https://www.machiningdoctor.com/calculators/tolerances/  
该站页面导航中列出 `Machining Data-Sheets 700+ Materials` 和 `Standards Conversion 700+ Materials`，包含 machinability、equivalent standards、chemical composition、cutting speed recommendations 等信息。

使用建议：

- 适合补充 CNC 语境下的材料可加工性和 standards conversion。
- 适合作为 secondary reference，与 MatWeb、Total Materia、SteelNumber 交叉验证。

#### The Aluminum Association

URL: https://www.aluminum.org/  
用途：铝协会是铝行业标准、统计和出版物的重要来源。其官网有 Standards、Resource Library、Bookstore 等入口。

使用建议：

- 铝合金牌号和 temper 体系应优先参考 Aluminum Association、ASTM、EN 标准或材料供应商 datasheet。
- 对 6061、6063、6082、7075 等常见 CNC 铝材，至少记录 temper，例如 T6、T651、O。

## 3. 数据源使用原则

### 3.1 不要把“网页能看见”当作“可以复制”

ISO、MatWeb、SteelNumber 都有版权或使用限制。我们的做法应该是：

1. 公开页面用于判断方向、核对字段、确认资料存在。
2. 入库数据来自合法授权、公司内部资料、供应商 datasheet、人工整理。
3. 每条数据写 `source_id`、`confidence`、`review_status`。
4. 不把大段表格原样复制进仓库。

### 3.2 数据可信度分层

建议建立 source reliability 分级：

- `A_licensed_standard`: ISO、ANSI、ASTM、EN、JIS、SAE 等正式标准或授权数据库。
- `A_manufacturer_datasheet`: Ensinger、Roechling、thyssenkrupp、Alcoa、Kaiser、Sandvik 等厂商 datasheet。
- `B_engineering_reference`: MachiningDoctor、SteelNumber、MatWeb 手工查证记录。
- `C_secondary_reference`: Wikipedia、EngineeringToolBox 等，只能用于初筛或 sanity check。

UI 上只展示 `Verified` 或 `Reference`，不要把 source reliability 暴露得太学术。

## 4. Phase T1: Common Fits 扩充策略

### 4.1 当前文件

当前 tolerance engine 相关文件：

- `backend/services/tolerance_engine/data/preferred_fits.json`
- `backend/services/tolerance_engine/data/preferred_classes.json`
- `backend/services/tolerance_engine/data/public_rules.json`
- `backend/services/tolerance_engine/data/fundamental_deviations.json`
- `backend/services/tolerance_engine/capabilities.py`
- `backend/services/tolerance_engine/deviation.py`
- `backend/services/tolerance_engine/fit_calc.py`
- `js/tolerance.js`
- `daiyujin-tools/assets/js/tolerance.js`

当前 `preferred_fits.json` 大致只有：

```json
{
  "hole_basis": {
    "clearance": ["H7/g6", "H7/h6", "H8/f7", "H8/h7", "H9/e8"],
    "transition": ["H6/k5", "H7/js6", "H7/k6", "H7/n6"],
    "interference": ["H7/p6", "H7/r6", "H7/s6"]
  }
}
```

这对于 demo 足够，但对专业页面不够。

### 4.2 第一批建议扩充 fits

先扩充 hole-basis fits。hole-basis 是通用首选，因为固定 H 孔可减少刀具和量规复杂度。

建议新 `preferred_fits.json` 先升级成对象结构：

```json
{
  "hole_basis": {
    "clearance": [
      {"code": "H11/b11", "label": "Loose running", "preferred": true, "level": "very_loose"},
      {"code": "H11/c11", "label": "Loose running", "preferred": true, "level": "loose"},
      {"code": "H9/d8", "label": "Free running", "preferred": false, "level": "free"},
      {"code": "H10/d9", "label": "Free running", "preferred": true, "level": "free"},
      {"code": "H9/e8", "label": "Easy running", "preferred": true, "level": "easy"},
      {"code": "H8/e8", "label": "Easy running", "preferred": true, "level": "easy"},
      {"code": "H7/f6", "label": "Close running", "preferred": false, "level": "close"},
      {"code": "H8/f7", "label": "Close running", "preferred": true, "level": "close"},
      {"code": "H7/g6", "label": "Sliding", "preferred": true, "level": "sliding"},
      {"code": "H10/h9", "label": "Locational clearance", "preferred": true, "level": "locational"},
      {"code": "H7/h6", "label": "Locational clearance", "preferred": true, "level": "locational"},
      {"code": "H8/h7", "label": "Locational clearance", "preferred": true, "level": "locational"}
    ],
    "transition": [
      {"code": "H6/js5", "label": "Light transition", "preferred": false, "level": "light"},
      {"code": "H7/js6", "label": "Light transition", "preferred": true, "level": "light"},
      {"code": "H8/k7", "label": "Medium transition", "preferred": false, "level": "medium"},
      {"code": "H6/k5", "label": "Medium transition", "preferred": false, "level": "medium"},
      {"code": "H7/k6", "label": "Medium transition", "preferred": true, "level": "medium"},
      {"code": "H7/m6", "label": "Tight transition", "preferred": false, "level": "tight"},
      {"code": "H8/m7", "label": "Tight transition", "preferred": false, "level": "tight"},
      {"code": "H7/n6", "label": "Tight transition", "preferred": true, "level": "tight"}
    ],
    "interference": [
      {"code": "H6/n5", "label": "Light press", "preferred": false, "level": "light_press"},
      {"code": "H7/p6", "label": "Light press", "preferred": true, "level": "light_press"},
      {"code": "H6/p5", "label": "Light press", "preferred": false, "level": "light_press"},
      {"code": "H7/r6", "label": "Medium press", "preferred": true, "level": "medium_press"},
      {"code": "H7/s6", "label": "Medium drive", "preferred": true, "level": "medium_drive"},
      {"code": "H8/s7", "label": "Medium drive", "preferred": false, "level": "medium_drive"},
      {"code": "H7/t6", "label": "Heavy press", "preferred": false, "level": "heavy_press"},
      {"code": "H7/u6", "label": "Force fit", "preferred": false, "level": "force"},
      {"code": "H8/u7", "label": "Force fit", "preferred": false, "level": "force"},
      {"code": "H7/x6", "label": "Heavy force fit", "preferred": false, "level": "heavy_force"}
    ]
  }
}
```

注意：这只是 presets 的目标清单，不代表当前 engine 已经能算。必须先让 deviation engine 支持相应 zones。

### 4.3 第二批建议增加 shaft-basis fits

shaft-basis 不是第一优先级，但页面如果要显得更完整，可以做成 Advanced tab。

建议分类：

```json
{
  "shaft_basis": {
    "clearance": [
      {"code": "B11/h9", "preferred": true},
      {"code": "D10/h9", "preferred": true},
      {"code": "E9/h8", "preferred": true},
      {"code": "E9/h9", "preferred": true},
      {"code": "F8/h7", "preferred": true},
      {"code": "F8/h9", "preferred": true},
      {"code": "G7/h6", "preferred": true},
      {"code": "H8/h9", "preferred": true},
      {"code": "H9/h9", "preferred": true},
      {"code": "H8/h7", "preferred": true},
      {"code": "H7/h6", "preferred": true}
    ],
    "transition": [
      {"code": "JS7/h6", "preferred": true},
      {"code": "K7/h6", "preferred": true},
      {"code": "N7/h6", "preferred": true}
    ],
    "interference": [
      {"code": "P7/h6", "preferred": true},
      {"code": "R7/h6", "preferred": true},
      {"code": "S7/h6", "preferred": true},
      {"code": "T7/h6", "preferred": false},
      {"code": "U7/h6", "preferred": false},
      {"code": "X7/h6", "preferred": false}
    ]
  }
}
```

### 4.4 必须同步扩充 supported zones

如果加入上面的 presets，engine 至少要支持：

Hole zones:

```text
B, C, D, E, F, G, H, JS, K, M, N, P, R, S, T, U, X
```

Shaft zones:

```text
b, c, d, e, f, g, h, js, k, m, n, p, r, s, t, u, x
```

当前支持远少于这些。执行时要同步扩：

- `public_rules.json`
- `fundamental_deviations.json`
- `preferred_classes.json`
- parser normalization，如 `JS/js`、大小写。
- tests。

### 4.5 版权安全实现方式

ISO 286 的完整 limit deviation 表格不建议直接搬进仓库。推荐做法：

1. 用 ISO 286-1 的公开公式、项目已有公式和公司授权标准进行计算。
2. 对需要 table lookup 的 zone，保存最小必要的结构化参数，而不是复制整张原表。
3. 对每个 zone 写 `source_id` 和 `verified_against`。
4. 在 doc 中记录“derived / manually verified / licensed table”，不要写成“copied from ISO”。

建议新增：

```json
{
  "source_id": "iso_286_licensed_manual_check",
  "license_scope": "internal implementation validation",
  "verified_by": "engineering",
  "verified_at": "2026-xx-xx"
}
```

## 5. Phase T2: Tolerance 前端交互扩展

### 5.1 不要让 datalist 承载几十个选项

当前 tolerance 页面使用：

```html
<input id="fit-combination" name="fit_combination" type="text" value="H7/g6" list="fit-presets">
<datalist id="fit-presets"></datalist>
```

当 fits 扩到 50+ 后，单个 datalist 会显得混乱。建议改成：

1. 保留 custom input。
2. Common 模式下增加 grouped select 或 segmented groups：
   - Hole Basis
   - Shaft Basis
   - ANSI Reference，可选后期。
3. 每组再分：
   - Clearance
   - Transition
   - Interference
4. 列表行展示：
   - `H7/g6`
   - `Sliding fit`
   - `Preferred`

### 5.2 API 返回结构升级

当前 `/api/public/tolerance/presets` 返回字符串数组。建议升级为：

```json
{
  "hole_basis": {
    "clearance": [
      {
        "code": "H7/g6",
        "label": "Sliding fit",
        "preferred": true,
        "support_status": "supported"
      }
    ]
  },
  "shaft_basis": {},
  "legacy": ["H7/g6", "H7/h6"]
}
```

前端兼容策略：

- 如果返回数组，按旧逻辑渲染。
- 如果返回对象，渲染 grouped UI。

### 5.3 UI 文案

建议页面文案从：

```text
ISO 286 limit deviations and fit types for bore and shaft.
```

调整为：

```text
Explore ISO-style hole and shaft fits, including common clearance, transition, and interference combinations.
```

避免承诺“所有 ISO 286 表格都完整覆盖”，直到 engine 验证完成。

## 6. Phase M1: Material Standards 数据扩充

### 6.1 当前文件

当前 material standards 数据：

- `backend/data/material_standards/sources.csv`
- `backend/data/material_standards/material_equivalents.csv`
- `backend/data/material_standards/material_aliases.csv`
- `backend/services/material_standards.py`
- `js/material-standards.js`
- `material-standards.html`
- `daiyujin-tools/templates/material-standards.php`
- `daiyujin-tools/assets/js/material-standards.js`

当前数据只有十几条，不足以支撑“国际材料标准查询”的专业感。

### 6.2 建议新增数据结构

#### sources.csv

扩成：

```csv
source_id,title,url,publisher,accessed_at,source_type,reliability,license_note,allowed_use,notes
```

示例：

```csv
matweb_manual,MatWeb Material Property Data,https://www.matweb.com,MatWeb,2026-06-27,public_database,B_engineering_reference,manual lookup only,no_bulk_copy,"Use for spot checks unless licensed"
total_materia,Total Materia Horizon,https://www.totalmateria.com,Total Materia,2026-06-27,commercial_database,A_licensed_standard,license required,licensed_export_only,"Best long-term source if company purchases access"
steelnumber,SteelNumber EN 10027,https://www.steelnumber.com/en/number_en10027_eu.php,SteelNumber,2026-06-27,public_reference,B_engineering_reference,no reproduction,manual_check,"Use for EN steel classification checks"
machiningdoctor_materials,MachiningDoctor Materials,https://www.machiningdoctor.com/calculators/tolerances/,MachiningDoctor,2026-06-27,engineering_reference,B_engineering_reference,manual lookup,manual_check,"Use for CNC context and equivalent standards"
aluminum_association,The Aluminum Association,https://www.aluminum.org/,The Aluminum Association,2026-06-27,industry_association,A_reference,standards may be paid,manual_check,"Use for aluminum designation and temper references"
```

#### material_equivalents.csv

建议增加字段：

```csv
material_id,material_family,common_name,sub_family,ISO,EN,DIN,WNr,ANSI_AA_USA,SAE_AISI,UNS,JIS_JP,GB_CN,BS_GB,AFNOR_FR,UNE_ES,UNI_IT,notes,confidence,review_status,source_ids
```

比当前多：

- `sub_family`
- `WNr`
- `SAE_AISI`
- `GB_CN`
- `UNI_IT`

这些字段对中国客户、欧洲客户、美国客户都更实用。

#### material_properties.csv

新增：

```csv
material_id,density_g_cm3_min,density_g_cm3_nominal,density_g_cm3_max,machinability_rating,cost_tier,corrosion_resistance,temperature_resistance,source_ids,confidence,review_status
```

注意：Material Standards 页面可以展示 density 和 common properties，但不要展示用于 quote 的内部价格。

#### material_aliases.csv

扩展别名：

```csv
alias,normalized_alias,material_id,alias_type,confidence,source_ids
```

`alias_type` 建议：

- `standard`
- `trade_name`
- `common_name`
- `legacy`
- `localized`

### 6.3 第一批材料扩充清单

建议先扩到 80 到 120 条，而不是一口气追求几百条。第一批应覆盖 CNC 客户最常查的材料。

#### Aluminum

建议优先：

```text
1050, 1060, 2011, 2017, 2024, 3003, 5052, 5083, 5754, 6061, 6063, 6082, 7075
```

每条记录尽量包含：

- EN AW designation
- AA designation
- UNS
- JIS
- density
- common temper note，如 T6/T651/O。

#### Stainless Steel

建议优先：

```text
303, 304, 304L, 316, 316L, 410, 420, 430, 440C, 17-4PH / 630
```

#### Carbon / Alloy Steel

建议优先：

```text
1018, 1020, 1045, 12L14, 4140, 4340, 8620, 40Cr, 42CrMo4, 20MnCr5
```

#### Tool Steel

建议优先：

```text
O1, A2, D2 / SKD11, H13 / SKD61, P20 / 1.2311, M2, S7
```

#### Brass / Copper

建议优先：

```text
C110 / ETP Copper, C101 / OF Copper, C360 / free-cutting brass, C260 cartridge brass, C17200 beryllium copper, CW614N
```

#### Titanium

建议优先：

```text
Grade 2, Grade 5 / Ti-6Al-4V, Grade 7, Grade 9
```

#### Engineering Plastics

建议优先：

```text
ABS, PC, PMMA, POM / Acetal / Delrin, PA6, PA66, PP, PE-HD, PVC, PTFE, PEEK, PEI / ULTEM, PPS, PI, FR4 / G10
```

### 6.4 搜索逻辑升级

当前 `material_standards.search()` 主要做 exact alias 和 common_name partial。扩库后应增加：

1. 多字段 fuzzy search。
2. 标准列 exact match 权重最高。
3. alias exact match 次高。
4. common_name partial match 较低。
5. family filter。
6. limit 默认 10，但返回 `total_matches`。

推荐 result 增加：

```json
{
  "match_type": "standard_exact",
  "matched_field": "UNS",
  "matched_value": "S30400",
  "score": 100
}
```

这样 UI 能解释为什么找到这个材料。

### 6.5 Material Standards 前端升级

建议 UI 不要只是一条搜索框加结果卡。扩库后可以做：

- Search input。
- Family filter tabs: All / Aluminum / Stainless / Steel / Copper / Titanium / Plastics。
- Result card 展示：
  - Common Name
  - Family
  - Verified / Reference
  - Standards grid
  - Density
  - Notes
  - Source badge，如 `Sources: MatWeb manual, SteelNumber`

不要展示：

- 内部报价材料 ID。
- 材料价格。
- source row。
- confidence 原始数值。

## 7. Phase M2: Material Weight 数据扩充

### 7.1 当前文件

- `backend/data/material_weight/material_density.csv`
- `backend/services/material_weight.py`
- `js/material-weight.js`
- `daiyujin-tools/assets/js/material-weight.js`

当前 density 是独立维护。建议逐步改为从 `material_properties.csv` 读取，或者至少保持同一个 `material_id`。

### 7.2 density 字段建议

原来：

```csv
material_id,family,label,density_g_cm3,density_lb_in3,source,is_active
```

建议改为：

```csv
material_id,family,label,density_g_cm3_nominal,density_g_cm3_min,density_g_cm3_max,density_lb_in3_nominal,source_ids,confidence,is_active,notes
```

原因：

- 铝合金、钢、塑料很多密度是范围，不是绝对值。
- Nominal 用于计算。
- Min/max 用于备注或未来误差提示。

### 7.3 第一批 density 扩充

和 Material Standards 第一批保持一致。至少扩到：

- Aluminum: 1050, 2024, 5052, 6061, 6063, 6082, 7075
- Stainless: 303, 304, 316, 316L, 410, 420, 430, 17-4PH
- Steel: 1018, 1045, 4140, 4340, D2, H13, P20
- Copper/Brass: C110, C101, C360, C260, C17200
- Titanium: Grade 2, Grade 5
- Plastics: ABS, PC, PMMA, POM, PA6, PA66, PP, HDPE, PVC, PTFE, PEEK, PEI, PPS, PI, FR4

## 8. Phase D1: 数据导入与审查流程

### 8.1 建议新增脚本

新增：

```text
backend/scripts/validate_material_data.py
backend/scripts/validate_tolerance_presets.py
backend/scripts/build_material_search_index.py
```

### 8.2 material validation 规则

`validate_material_data.py` 应检查：

1. 每个 `material_id` 唯一。
2. 每个 `source_id` 在 `sources.csv` 存在。
3. density 在合理范围内。
4. verified 条目至少两个 source_id。
5. alias 不能指向不存在的 material_id。
6. 同一 material_id 不允许 standards 全空。
7. common_name 不允许重复到无法区分，重复时必须有 sub_family 或 temper。

### 8.3 tolerance validation 规则

`validate_tolerance_presets.py` 应检查：

1. 每个 preset 都能 parse。
2. 每个 hole/shaft zone 都在 capabilities 里声明。
3. 每个 preset 在代表尺寸上可计算。
4. classification 与 preset category 一致。
5. 对每个新 zone 至少有 3 个 basic size 的人工校验记录。

代表尺寸建议：

```text
3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 500
```

## 9. Phase UI: 页面观感与专业性

### 9.1 Tolerance 页面

建议从“单一输入框”升级为：

```text
Common Fits
  Hole Basis
    Clearance / Transition / Interference
  Shaft Basis
    Clearance / Transition / Interference
Custom
  Manual input
```

每个 fit option 显示：

```text
H7/g6
Sliding fit
Preferred
```

默认仍然用 `H7/g6`。

### 9.2 Material Standards 页面

建议增加：

1. 结果来源 badge。
2. Verified / Reference 状态。
3. Family tabs。
4. No result 时引导询盘：

```text
Can’t find the material designation? Contact our engineers with your drawing and material requirement.
```

`Contact our engineers` 用 mailto。

### 9.3 Material Weight 页面

建议增加：

1. Material family 分组。
2. 搜索材料。
3. Density source note：

```text
Density values are nominal references. Actual stock may vary by grade, temper, filler, and supplier.
```

这能显得专业，也能降低客户把结果当作绝对值的风险。

## 10. 验收标准

### 10.1 Tolerance

必须满足：

1. Common fits 数量至少达到 40 个。
2. 同时支持 hole-basis 和 shaft-basis，shaft-basis 可先放 Advanced。
3. 每个 common fit 都能成功计算。
4. 每个 fit 有 category: clearance / transition / interference。
5. 前端能按 category 分组展示。
6. 新增 zones 的计算结果通过人工抽样校验。
7. WordPress 插件 tolerance JS/PHP 同步。

### 10.2 Material Standards

必须满足：

1. Material equivalents 至少 80 条。
2. 常见 CNC 材料族全部覆盖。
3. 每条 material 至少有一个 source_id。
4. Verified 条目至少两个来源。
5. 搜索 6061、7075、304、316、4140、D2、H13、C360、PEEK、POM 都有结果。
6. 页面不展示内部价格和报价参数。

### 10.3 Material Weight

必须满足：

1. density 数据至少 50 条。
2. material_id 与 Material Standards 尽量一致。
3. density 有 source_id 和 confidence。
4. 页面显示 nominal reference note。
5. 旧计算逻辑不被破坏。

## 11. 建议执行顺序

1. 新增 source registry，扩充 `sources.csv`。
2. 先做 tolerance common fits 的数据结构升级，但只打开当前 engine 支持的 fits。
3. 扩充 deviation engine 支持 zones。
4. 批量打开 hole-basis common fits。
5. 增加 validation script。
6. 升级 tolerance 前端 grouped UI。
7. 扩充 material_equivalents.csv 到 80+。
8. 扩充 material_aliases.csv。
9. 扩充 material_density.csv 或新增 material_properties.csv。
10. 升级 Material Standards 搜索与结果卡。
11. 升级 Material Weight 材料选择体验。
12. 同步 WordPress 插件。
13. 做浏览器验收和 API 验收。

## 12. 建议验证命令

语法检查：

```powershell
python -B -m py_compile backend\services\tolerance.py backend\services\tolerance_engine\*.py backend\services\material_standards.py backend\services\material_weight.py
node --check js\tolerance.js
node --check js\material-standards.js
node --check js\material-weight.js
```

数据检查：

```powershell
python backend\scripts\validate_tolerance_presets.py
python backend\scripts\validate_material_data.py
```

API smoke test：

```powershell
python -B -c "from backend.services.tolerance import calculate_tolerance; print(calculate_tolerance({'basic_size_mm':25,'fit_combination':'H7/g6'})['fit']['type'])"
```

搜索抽样：

```powershell
python -B -c "from backend.services.material_standards import search; [print(q, search(q, 3)['results'][0]['common_name'] if search(q,3)['results'] else 'MISS') for q in ['6061','7075','304','316','4140','D2','H13','C360','PEEK','POM']]"
```

## 13. 风险

1. 版权风险：ISO、MatWeb、SteelNumber 等内容不能无脑复制。
2. 精度风险：不同网站对 rounding、单位、尺寸段边界可能处理不同。
3. 工程风险：新增 fits 但 engine 不支持 zones，会造成前端可选但后端报错。
4. 体验风险：fits 太多会淹没用户，需要分组、搜索、Preferred 标识。
5. 业务风险：材料等效不等于完全可替代。UI 必须保留工程 review 提示。

## 14. 最终完成定义

完成后，两个页面应达到：

- ISO Tolerance: common fits 不再稀疏，能覆盖常见 clearance、transition、interference，以及 hole-basis 和 shaft-basis。
- Material Standards: 从 demo 变成可用的工程材料标准查询工具，能查常见 CNC 材料。
- Material Weight: 材料选择更广，density 有来源和参考说明。
- 数据治理: 每条关键数据都有 source_id、confidence、review_status。
- 合规: 不把未经授权的大段标准表格或数据库内容复制进公开仓库。
