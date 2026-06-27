# PRD: Instant Quote v2.2 材料细分选择与真实采购价接入

版本: v1.0
日期: 2026-06-27
适用项目: `D:\myfirstgithubcode\daiyujinweb`
离线模型来源: `D:\报价系统\报价系统项目总结-v2.2.md`、`D:\报价系统\config`、`D:\报价系统\models`、`D:\报价系统\output\v2_2`
目标页面: `quote.html` / WordPress 插件 `dyj_quote_tool`

## 1. 背景与判断

当前 quote 页面已经完成了 v2.1 公式型报价的产品化，但材料选择仍然停留在“材料大类”层面。大类选择对用户友好，却会把同一大类里的真实材料价格差异压平。例如铝合金中 6061、6061-T6、6082、7075 国产、7075 进口的采购价格不同，塑料中 POM、PEEK、PTFE、TORLON 的价格差异更大。如果只让用户选择 Aluminum Alloy 或 Engineering Plastic，报价结果会显得简洁，但材料成本项容易失真。

v2.2 离线报价系统的核心变化是: 不改变 v2.1 的加法公式结构，只把材料成本的数据源从内部估算价升级为真实采购价知识表。这个方向适合现在的线上 quote 页面，因为它提高了输入信息的精度，同时不会引入过重的 AI 或复杂几何建模。

v2.2 的关键结论如下:

| 项目                      |                         v2.1 |                       v2.2-A.1 |
| ------------------------- | ---------------------------: | -----------------------------: |
| 材料价格来源              | `materials.csv` 内部估算价 | `材料价格.xlsx` 标准化采购价 |
| 标准材料价格条目          |                           42 |                            155 |
| 覆盖材料牌号              |                        约 42 |                            163 |
| safety_multiplier         |                         1.25 |                           1.00 |
| 车床 markup               |                        5.000 |                          3.990 |
| clean_core MAPE           |                   46.0% 左右 |                          49.1% |
| Median APE                |                        37.7% |                          39.4% |
| 中位符号误差              |                       -15.4% |                          -7.4% |
| Group validation MAPE gap |                     约 8.2pp |                       约 2.1pp |

解释: v2.2 表面 MAPE 略涨，但它去掉了 v2.1 中由材料估算偏差和 safety 叠加形成的“水分”。中位低估从 -15.4% 收窄到 -7.4%，说明模型更接近真实成本结构。对一个商业报价工具来说，这比单纯追求一个更漂亮的 MAPE 更重要。

## 2. 当前线上实现状态

当前 `daiyujinweb` 的 quote 后端主要文件:

| 文件                                        | 当前职责                                                           |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `backend/services/quote_calculator_v2.py` | 读取 v2.1 数据并计算 quote                                         |
| `backend/services/pricing.py`             | façade，调用 quote calculator 并记录 inquiry                      |
| `backend/app.py`                          | 暴露`/api/public/quote/options`、`/api/public/quote/calculate` |
| `backend/data/quote_model_v2_1/`          | 当前线上报价参数目录                                               |
| `js/quote.js`                             | quote 页面选项 hydrate、上传、计算、结果渲染                       |
| `quote.html`                              | 静态 quote 页面                                                    |
| `daiyujin-tools/assets/js/quote.js`       | WordPress 插件 quote JS                                            |
| `daiyujin-tools/templates/quote.php`      | WordPress quote 模板                                               |

当前材料选择方式:

1. `/api/public/quote/options` 返回 `material_categories`。
2. 前端把材料大类渲染成 card radio。
3. 用户只提交 `material_category`。
4. 后端用 `material_categories.json` 中的 `representative_material_id` 作为代表材料计算。
5. 结果只展示大类，不展示具体材料。

当前主要问题:

| 问题                                     | 影响                                     |
| ---------------------------------------- | ---------------------------------------- |
| 大类只映射代表材料                       | 同一大类内高低价材料被压平               |
| 线上数据仍是`quote_model_v2_1`         | v2.2 采购价和新系数没有真正进入线上      |
| `SAFETY_MULTIPLIER = 1.25`             | 与 v2.2-A.1 冻结结论冲突                 |
| `public_quote_response` 不返回细分材料 | 前端不能展示用户选了什么牌号             |
| 前端只有一级 material category           | 用户无法选择表中真实材料                 |
| 内部价格字段不能泄露                     | 新材料表包含采购价，API 设计必须强制脱敏 |

## 3. 产品目标

### 3.1 用户目标

用户在 quote 页面选择材料时，应看到清晰的两级选择:

1. 左侧选择材料大类，例如 Aluminum Alloy、Stainless Steel、Engineering Plastic。
2. 右侧选择该大类下的具体材料，例如 6061、6061-T6、6082、7075 Domestic、7075 Imported。
3. 如果用户不确定材料细分，可以选择该大类的 Recommended / Common grade。
4. 页面不显示材料价格、密度、markup、公式细节、CNY 成本。
5. 结果区域展示用户选择的材料大类和材料牌号，但仍保持黑盒商业系统的专业感。

### 3.2 业务目标

1. 让报价结果受真实材料细分影响。
2. 减少大类代表材料造成的误差。
3. 继续保持 quote 页面“快速粗报价”的体验。
4. 不向客户暴露内部采购价、系数、模型版本细节。
5. 为后续材料报价表维护和供应商价格版本化留接口。

### 3.3 工程目标

1. 新增 `backend/data/quote_model_v2_2/`，不覆盖 v2.1。
2. 后端 quote calculator 切换到 v2.2-A.1 数据。
3. `/api/public/quote/options` 返回二级材料菜单数据。
4. `/api/public/quote/calculate` 接受 `material_id`，优先按细分材料计算。
5. 前端材料选择从一级 cards 升级为二级 selector。
6. 静态站和 WordPress 插件保持同步。

## 4. 非目标

本阶段不做:

1. 不接实时行情 API。
2. 不让客户自由输入材料价格。
3. 不展示采购价、密度、材料成本、markup、safety、后处理内部费用。
4. 不引入 LLM 或 AI 自动判断材料。
5. 不解决 STP 几何体积和 OBB 体积的根本误差。
6. 不新增材料残差因子 v2.2-B。
7. 不做供应商价格有效期自动切换。

## 5. 数据基线与源文件

### 5.1 离线 v2.2 数据源

从 `D:\报价系统` 复制或转换以下文件:

| 源文件                                      | 目标文件                                                           | 用途                     |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------ |
| `models/coefficients_v2_2_A.json`         | `backend/data/quote_model_v2_2/coefficients_v2_2_A.json`         | v2.2-A.1 冻结参数        |
| `config/material_prices.csv`              | `backend/data/quote_model_v2_2/material_prices.csv`              | 真实采购价知识表         |
| `config/material_price_bridge.csv`        | `backend/data/quote_model_v2_2/material_price_bridge.csv`        | 价格表名和历史系统名桥接 |
| `config/material_aliases_from_prices.csv` | `backend/data/quote_model_v2_2/material_aliases_from_prices.csv` | 自动别名                 |
| `config/material_price_conflicts.csv`     | `backend/data/quote_model_v2_2/material_price_conflicts.csv`     | 冲突复核                 |
| `config/materials.csv`                    | `backend/data/quote_model_v2_2/materials_legacy.csv`             | legacy fallback          |
| `config/process_groups.csv`               | `backend/data/quote_model_v2_2/process_groups.csv`               | 工艺配置                 |
| `config/process_aliases.csv`              | `backend/data/quote_model_v2_2/process_aliases.csv`              | 工艺别名                 |
| `config/postprocess_groups.csv`           | `backend/data/quote_model_v2_2/postprocess_groups.csv`           | 后处理配置               |
| `config/postprocess_aliases.csv`          | `backend/data/quote_model_v2_2/postprocess_aliases.csv`          | 后处理别名               |
| `config/quantity_tiers.csv`               | `backend/data/quote_model_v2_2/quantity_tiers.csv`               | 数量档参考               |

### 5.2 新增前端公开材料选项文件

建议新增:

```text
backend/data/quote_model_v2_2/material_public_options.json
```

该文件从 `material_prices.csv` 生成，只保留可以展示给客户的字段:

```json
{
  "categories": [
    {
      "id": "aluminum_alloy",
      "label": "Aluminum Alloy",
      "description": "Lightweight CNC materials for prototypes and production parts.",
      "default_material_id": "mp_a_6061",
      "materials": [
        {
          "id": "mp_a_6061",
          "label": "6061",
          "subtitle": "General-purpose aluminum alloy",
          "badges": ["Common"],
          "review_recommended": false
        }
      ]
    }
  ]
}
```

禁止进入公开 API 的字段:

| 禁止字段              | 原因                           |
| --------------------- | ------------------------------ |
| `price_rmb_per_kg`  | 采购价格，商业机密             |
| `density_g_cm3`     | 虽不一定机密，但会帮助反推成本 |
| `source_row`        | 内部数据源细节                 |
| `confidence`        | 内部数据质量信号               |
| `review_reason`     | 暴露系统弱点                   |
| `source_file`       | 内部文件结构                   |
| `material_markup`   | 模型参数                       |
| `safety_multiplier` | 模型参数                       |

## 6. 材料分类设计

### 6.1 推荐公开大类

从 `material_prices.csv` 的 `material_family` 和材料名称生成更适合客户理解的大类。建议公开为 8 类:

| category_id                  | 前端显示                   | 来源材料                                             |
| ---------------------------- | -------------------------- | ---------------------------------------------------- |
| `aluminum_alloy`           | Aluminum Alloy             | 6060、6061、6082、7075、5052、5083 等                |
| `stainless_steel`          | Stainless Steel            | SUS303、SUS304、SUS316、SUS316L、SUS420J2、SUS430 等 |
| `carbon_alloy_steel`       | Carbon / Alloy Steel       | 45#、40Cr、4140、4142、Q235、16MnCr5、20CrMo 等      |
| `tool_steel`               | Tool Steel                 | Cr12、Cr12MoV、D2、SKD11、SKD61、P20、O1 等          |
| `engineering_plastic`      | Engineering Plastic        | ABS、POM、PC、PA、PET、PBT、PVC、PMMA 等             |
| `high_performance_plastic` | High-Performance Plastic   | PEEK、PEI、PPS、PI、PBI、PAI、PFA、PTFE、TORLON 等   |
| `brass_copper`             | Brass / Copper             | 当前 v2.2 价格表覆盖不足，优先从 legacy 受控展示     |
| `titanium_specialty`       | Titanium / Specialty Metal | Ti-6Al-4V、钨钢、镍基材料等                          |

注意: 当前 v2.2 `material_prices.csv` 的 family 只有 `steel`、`aluminum`、`plastic` 三类。公开大类需要在生成 `material_public_options.json` 时二次归类。例如 `SUS` 进入 Stainless Steel，`Cr12`、`D2`、`SKD11` 进入 Tool Steel，`PEEK`、`PEI`、`PPS` 进入 High-Performance Plastic。

### 6.2 材料公开规则

并非 `material_prices.csv` 中所有 active 行都可以直接展示。公开材料必须满足:

1. `is_active == TRUE`
2. `review_required != TRUE`
3. 有可用价格
4. 有可用密度
5. 密度在合理范围
6. 价格在合理范围
7. 不是明显列错位数据
8. 名称适合客户理解

当前发现的异常样本必须进入内部复核，不建议进入前端:

| 材料                 | 异常                                |
| -------------------- | ----------------------------------- |
| `SKS3`             | 价格 7.85、密度 1.251，疑似列错位   |
| `65MU`             | 密度缺失                            |
| `H1`               | 密度缺失                            |
| `P20` 其中一条     | 密度缺失                            |
| `TORLON 4275 黑色` | 价格 3800，可能真实但需高价材料复核 |

### 6.3 大类默认材料

每个大类必须有默认材料，用于用户只选大类或进入页面默认状态:

| 大类                       | 默认材料建议      | 理由               |
| -------------------------- | ----------------- | ------------------ |
| Aluminum Alloy             | 6061              | 常见、用户认知强   |
| Stainless Steel            | SUS304 / AISI 304 | 样本多，通用       |
| Carbon / Alloy Steel       | 45# / C45         | 样本多，成本稳定   |
| Tool Steel                 | D2 或 Cr12MoV     | 需复核冲突后启用   |
| Engineering Plastic        | POM               | 常见 CNC 塑料      |
| High-Performance Plastic   | PEEK              | 高性能塑料代表     |
| Brass / Copper             | Brass MS58        | 当前从 legacy 过渡 |
| Titanium / Specialty Metal | Ti-6Al-4V         | 常见钛合金代表     |

默认材料不应在前端显示为“系统默认价格”。建议文案为 `Recommended` 或 `Common`.

## 7. 后端改造方案

### 7.1 新增数据目录

新增:

```text
backend/data/quote_model_v2_2/
```

建议包含:

```text
quote_model_v2_2/
├── README.md
├── coefficients_v2_2_A.json
├── material_prices.csv
├── material_public_options.json
├── material_price_bridge.csv
├── material_aliases_from_prices.csv
├── material_price_conflicts.csv
├── materials_legacy.csv
├── process_aliases.csv
├── process_groups.csv
├── postprocess_aliases.csv
├── postprocess_groups.csv
└── quantity_tiers.csv
```

`README.md` 必须说明:

1. 数据来源是 `D:\报价系统` 的 v2.2-A.1 冻结结果。
2. `material_prices.csv` 含内部采购价，不得公开暴露。
3. `material_public_options.json` 是脱敏后的前端选项源。
4. v2.2-A.1 使用 safety 1.00。
5. v2.1 目录保留用于回滚。

### 7.2 Calculator 命名建议

当前文件名 `quote_calculator_v2.py` 可以继续用，但建议内部常量明确:

```python
MODEL_VERSION = "v2.2_A1_material_price"
DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "quote_model_v2_2"
SAFETY_MULTIPLIER = 1.00
DIFFICULTY_FACTOR = 1.0
```

如果想保留回滚能力，更稳的结构是:

```text
backend/services/quote_calculator_v2_1.py
backend/services/quote_calculator_v2_2.py
backend/services/pricing.py
```

`pricing.py` 只负责选择当前版本:

```python
from services.quote_calculator_v2_2 import (
    calculate_quote_v2,
    get_quote_options_v2,
    public_quote_response,
)
```

### 7.3 新材料查找逻辑

新增内部 loader:

```python
def material_prices() -> list[dict]:
    return _load_csv("material_prices.csv")

def material_public_options() -> dict:
    return _load_json("material_public_options.json")
```

新增查找函数:

```python
def _find_material_price(material_id: str) -> dict:
    # 1. price_id exact
    # 2. material_grade_norm exact
    # 3. material_base_norm exact
    # 4. bridge legacy name
    # 5. legacy fallback, only if configured
```

推荐前端提交 `price_id`，后端按 `price_id` 查找。这样可以避免 `7075(国产)`、`7075(进口)` 都桥接到 `Al 7075` 后丢失差异。

返回内部材料对象:

```python
{
    "id": "mp_a0017",
    "public_label": "7075 Imported",
    "material_family": "aluminum",
    "material_category": "aluminum_alloy",
    "material_grade_norm": "7075(进口)",
    "density_g_cm3": 2.85,
    "price_rmb_per_kg": 80.0,
    "price_source": "material_prices.csv",
}
```

### 7.4 calculate payload 更新

当前 payload:

```json
{
  "material_category": "aluminum_alloy",
  "process": "CNC",
  "postprocess_group": "bead_blasting",
  "tolerance_grade": "ISO2768-M",
  "quantity": 100,
  "currency": "USD"
}
```

目标 payload:

```json
{
  "material_category": "aluminum_alloy",
  "material_id": "mp_a_6061_t6",
  "process": "CNC",
  "postprocess_group": "bead_blasting",
  "tolerance_grade": "ISO2768-M",
  "quantity": 100,
  "currency": "USD"
}
```

后端规则:

1. 如果 `material_id` 存在，必须优先使用细分材料。
2. 如果 `material_id` 缺失但 `material_category` 存在，使用该大类 `default_material_id`。
3. 如果两者都缺失，返回 400。
4. 如果 `material_id` 不属于该 category，返回 400，避免前端或恶意请求错配。
5. 如果材料被标记 `review_recommended`，计算仍可进行，但 public warning 只说需要工程确认，不暴露原因。

### 7.5 v2.2 计算公式

保持 v2.1 公式:

```text
unit_rmb = (
    material_cost_rmb * material_markup_by_process[process]
  + setup_fee_by_process[process] / quantity
  + machining_base_by_process[process] * difficulty_factor * tolerance_factor
  + postprocess_fee_by_group[postprocess]
) * quantity_delta

suggested_unit_rmb = unit_rmb * safety_multiplier
```

v2.2-A.1 固定:

```python
SAFETY_MULTIPLIER = 1.00
```

材料成本:

```python
stock_volume_mm3 = l * w * h
stock_weight_kg = stock_volume_mm3 * density_g_cm3 / 1_000_000
material_cost_rmb = stock_weight_kg * price_rmb_per_kg
```

使用 v2.2-A.1 系数:

| 参数            |     值 |
| --------------- | -----: |
| CNC markup      |  5.000 |
| 车床 markup     |  3.990 |
| 车铣复合 markup |  4.161 |
| 板金 markup     |  5.000 |
| CNC setup       |  942.4 |
| 车床 setup      | 1192.1 |
| 车铣复合 setup  |  918.8 |
| 板金 setup      |  563.8 |
| 热处理 fee      |   40.7 |
| 电解抛光 fee    |   23.4 |
| 喷砂抛光 fee    |   17.0 |
| 阳极氧化 fee    |    5.8 |
| 镭雕 fee        |   11.9 |

### 7.6 价格随机点与展示策略

当前 quote 页面已经从宽区间改为区间内取稳定随机点。v2.2 仍建议保留该策略，但随机范围要比之前更克制:

| 风险等级 | 条件                                         | 取点区间    |
| -------- | -------------------------------------------- | ----------- |
| low      | 常见材料、CNC、去毛刺/阳极氧化、数量小于 500 | -3% 到 +5%  |
| medium   | 车床、车铣复合、热处理、数量大于等于 500     | -4% 到 +7%  |
| high     | 高性能塑料、钛合金、特殊金属、材料 review    | -5% 到 +10% |

随机种子建议包含:

```python
seed_parts = [
    file_id,
    material_id,
    process_group,
    postprocess_group,
    tolerance_grade,
    quantity,
    currency,
    current_date,
]
```

这样同一天同一配置稳定，次日可轻微变化，符合“动态评估”但不会显得随意。

### 7.7 Public API 返回结构

`/api/public/quote/options` 目标返回:

```json
{
  "material_categories": [
    {
      "id": "aluminum_alloy",
      "label": "Aluminum Alloy",
      "description": "Lightweight CNC materials",
      "default_material_id": "mp_a_6061",
      "materials": [
        {
          "id": "mp_a_6061",
          "label": "6061",
          "subtitle": "General-purpose aluminum",
          "badges": ["Common"]
        },
        {
          "id": "mp_a_6061_t6",
          "label": "6061-T6",
          "subtitle": "Heat-treated aluminum",
          "badges": []
        }
      ]
    }
  ],
  "processes": [],
  "postprocess_groups": [],
  "tolerance_grades": [],
  "currencies": ["USD", "EUR"],
  "default_currency": "USD"
}
```

禁止返回:

```json
{
  "price_rmb_per_kg": 40,
  "density_g_cm3": 7.85,
  "source_row": 3,
  "confidence": 0.95
}
```

`/api/public/quote/calculate` 目标 public response:

```json
{
  "quote_status": "estimated",
  "currency": "USD",
  "selections": {
    "material_category": {
      "id": "aluminum_alloy",
      "label": "Aluminum Alloy"
    },
    "material": {
      "id": "mp_a_6061_t6",
      "label": "6061-T6"
    },
    "process": "CNC Machining",
    "postprocess_group": "Bead Blasting",
    "quantity": 100,
    "tolerance_grade": "ISO 2768-m (Medium)"
  },
  "unit_estimate": {},
  "total_estimate": {},
  "warnings": [],
  "review_note": "...",
  "disclaimer": "..."
}
```

仍然禁止 public response 返回:

1. `formula`
2. `breakdown`
3. `material_cost_rmb`
4. `stock_weight_kg`，可留在 part 但 public 建议不显示
5. `price_rmb_per_kg`
6. `density_g_cm3`
7. `pricing_model_version`
8. `random_seed`

## 8. 前端改造方案

### 8.1 页面结构

把当前 Material Category card grid 替换成二级材料选择器。

当前结构:

```html
<div class="tool-field">
  <span class="tool-label">Material Category</span>
  <div class="material-card-grid" data-material-category-list></div>
</div>
```

目标结构:

```html
<div class="tool-field quote-material-picker" data-material-picker>
  <span class="tool-label">Material</span>
  <div class="quote-material-layout">
    <div class="quote-material-categories" data-material-category-list></div>
    <div class="quote-material-grades">
      <div class="quote-material-grade-head">
        <strong data-material-category-title>Aluminum Alloy</strong>
        <input type="search" data-material-search placeholder="Search material grade">
      </div>
      <div class="quote-material-grade-list" data-material-grade-list></div>
    </div>
  </div>
  <input type="hidden" name="material_category" data-material-category-input>
  <input type="hidden" name="material_id" data-material-id-input>
</div>
```

### 8.2 桌面布局

桌面端:

1. 左侧 34% 宽度显示大类。
2. 右侧 66% 宽度显示细分材料。
3. 右侧材料建议用 compact list，不用大卡片堆满页面。
4. 每一行展示材料名、简短说明、标签。
5. 选中项要有清晰边框和轻微背景，但不要使用过重色块。

视觉目标:

```text
Material
┌───────────────────────────────┬────────────────────────────────────────┐
│ Aluminum Alloy                 │ Aluminum Alloy                         │
│ Stainless Steel                │ [Search material grade]                │
│ Carbon / Alloy Steel           │                                        │
│ Engineering Plastic            │ ○ 6061        Common                   │
│ High-Performance Plastic       │ ● 6061-T6     Heat-treated             │
│ Titanium / Specialty Metal     │ ○ 6082        Machining aluminum       │
└───────────────────────────────┴────────────────────────────────────────┘
```

### 8.3 移动端布局

移动端:

1. 大类使用横向滚动 segmented list。
2. 细分材料列表在下方。
3. 搜索框宽度 100%。
4. 每个材料项最小高度 44px，便于点击。
5. 不要让 material picker 高度无限增长，建议 `max-height: 280px; overflow: auto;`。

### 8.4 JS 状态设计

`js/quote.js` 新增状态:

```js
const state = {
  fileName: "",
  fileKey: "",
  analysis: null,
  estimate: null,
  options: null,
  selectedMaterialCategory: "",
  selectedMaterialId: "",
  materialSearch: "",
};
```

hydrate options 后:

```js
const cats = options.material_categories || [];
const first = cats[0];
state.selectedMaterialCategory = first?.id || "";
state.selectedMaterialId = first?.default_material_id || first?.materials?.[0]?.id || "";
renderMaterialPicker();
```

新增函数:

```js
function renderMaterialPicker() {}
function selectMaterialCategory(categoryId) {}
function selectMaterial(materialId) {}
function currentMaterialCategory() {}
function currentMaterial() {}
```

payload 改为:

```js
const payload = {
  file_id: state.analysis.file_id,
  part_name: state.analysis.name,
  stp_filename: state.fileName,
  volume_mm3: state.analysis.volume_mm3,
  obb_dimensions_mm: state.analysis.obb_dimensions_mm,
  material_category: state.selectedMaterialCategory,
  material_id: state.selectedMaterialId,
  process: String(formData.get("process") || "CNC"),
  postprocess_group: String(formData.get("postprocess_group") || "bead_blasting"),
  tolerance_grade: String(formData.get("tolerance_grade") || "ISO2768-M"),
  quantity: Number(formData.get("quantity")),
  currency: String(formData.get("currency") || "USD"),
  customer_email: String(formData.get("customer_email") || "").trim(),
};
```

### 8.5 前端文案

材料选择区域不要解释“价格表”“采购价”“模型”。推荐文案:

| 位置               | 文案                                           |
| ------------------ | ---------------------------------------------- |
| label              | Material                                       |
| search placeholder | Search material grade                          |
| 未找到材料         | Need another material? Request a formal quote. |
| 高风险材料 badge   | Engineering review                             |
| 常见材料 badge     | Common                                         |
| 默认推荐 badge     | Recommended                                    |

结果区 Material 显示:

```text
Material
Aluminum Alloy · 6061-T6
```

mailto 内容也要从:

```text
Material Category: Aluminum Alloy
```

升级为:

```text
Material: Aluminum Alloy / 6061-T6
```

## 9. WordPress 插件同步

所有静态页面修改都要同步到插件:

| 静态站文件                | WordPress 插件文件                              |
| ------------------------- | ----------------------------------------------- |
| `quote.html`            | `daiyujin-tools/templates/quote.php`          |
| `js/quote.js`           | `daiyujin-tools/assets/js/quote.js`           |
| `css/plugins.css`       | `daiyujin-tools/assets/css/plugins.css`       |
| `js/quote-3d-viewer.js` | `daiyujin-tools/assets/js/quote-3d-viewer.js` |

插件版本建议从 `1.2.2` 提升到 `1.2.3` 或下一个实际版本号，避免浏览器缓存旧 JS/CSS。

`daiyujin-tools.php` 中动态模块 URL 已经建议带 `?ver=`，本次也要确保 quote.js、CSS 版本号随插件版本更新。

## 10. 实施阶段

### Phase Q22-0: 数据接入准备

任务:

1. 新建 `backend/data/quote_model_v2_2/`。
2. 从 `D:\报价系统` 复制 v2.2-A.1 数据文件。
3. 新增 `README.md` 说明数据来源与保密边界。
4. 生成或手写第一版 `material_public_options.json`。

验收:

```powershell
Test-Path D:\myfirstgithubcode\daiyujinweb\backend\data\quote_model_v2_2\coefficients_v2_2_A.json
Test-Path D:\myfirstgithubcode\daiyujinweb\backend\data\quote_model_v2_2\material_prices.csv
Test-Path D:\myfirstgithubcode\daiyujinweb\backend\data\quote_model_v2_2\material_public_options.json
```

质量闸门:

1. `material_public_options.json` 不包含 `price_rmb_per_kg`。
2. 不包含 `density_g_cm3`。
3. 不包含异常材料 `SKS3`、密度缺失材料。
4. 每个公开 category 至少有 1 个 default material。

### Phase Q22-1: 后端 calculator 升级

任务:

1. 将 `DATA_DIR` 指向 `quote_model_v2_2`。
2. `coefficients()` 读取 `coefficients_v2_2_A.json`。
3. `SAFETY_MULTIPLIER` 改为 `1.00`。
4. 新增 `material_prices()` loader。
5. 新增 `material_public_options()` loader。
6. `_find_material()` 升级为 `_find_material_price()`。
7. `calculate_quote_v2()` 优先使用 `material_id`。
8. `public_quote_response()` 返回 `material` 和 `material_category`，但不返回内部成本。

验收:

```powershell
python -B -m py_compile backend\services\quote_calculator_v2.py backend\services\pricing.py backend\app.py
```

Flask test client 验收:

1. `GET /api/public/quote/options` 返回材料大类和细分材料。
2. options JSON 中没有 `price_rmb_per_kg`。
3. 使用公开材料 id 计算成功，例如 label 为 `6061-T6` 的材料对应的 `id`。
4. 使用 label 为 `7075 Domestic` 和 `7075 Imported` 的两个公开材料 id，结果应不同。
5. 只传 `material_category=aluminum_alloy` 时使用默认材料。
6. 传入不属于该 category 的 material_id 返回 400。

注意: `material_id` 的值应是公开 API 返回的稳定 id，建议来自内部 `price_id`。不要把 `6061-T6`、`7075(进口)` 这类展示名直接当作唯一 ID。

### Phase Q22-2: 前端二级材料选择器

任务:

1. 改造 `quote.html` material 区域。
2. 改造 `js/quote.js` hydrate options。
3. 新增 material picker 渲染与选择状态。
4. calculate payload 加 `material_id`。
5. 结果区显示大类和细分材料。
6. mailto 内容加入细分材料。
7. 同步 WordPress 模板与 JS。

验收:

1. 初次加载默认选中第一个大类和默认材料。
2. 点击左侧大类，右侧材料列表刷新。
3. 点击右侧材料，选中状态清晰。
4. 搜索材料可以过滤当前大类材料。
5. 计算请求 payload 包含 `material_category` 和 `material_id`。
6. 结果区显示 `Material: Aluminum Alloy · 6061-T6`。
7. 未显示材料价格、CNY、公式、breakdown。

### Phase Q22-3: CSS 与响应式

任务:

1. 新增 `.quote-material-layout`。
2. 新增 `.quote-material-categories`。
3. 新增 `.quote-material-grade-list`。
4. 新增 `.quote-material-grade-option`。
5. 移动端改为上下布局。
6. 保持整体 quiet commercial tool 风格。

验收:

| 视口     | 验收项                             |
| -------- | ---------------------------------- |
| 1440px   | 左右两栏清晰，材料列表不挤压表单   |
| 1024px   | 不溢出 quote panel                 |
| 390px    | 大类可横向滚动或堆叠，材料项可点击 |
| 所有视口 | 文本不重叠，按钮和选项高度稳定     |

### Phase Q22-4: API 脱敏与黑盒检查

任务:

1. 检查 `/quote/options`。
2. 检查 `/quote/calculate`。
3. 检查浏览器 Network response。
4. 检查 inquiry 记录仍保留内部字段。
5. 检查 public response 不泄露内部字段。

禁止出现在 public response 的关键词:

```text
price_rmb_per_kg
density_g_cm3
material_cost_rmb
material_markup
setup_fee
machining_base
postprocess_fee
safety_multiplier
formula
breakdown
random_seed
coefficients
v2.2_A1_material_price_bridge
```

注意: `pricing_model_version` 对客户没有意义，也不应公开。

### Phase Q22-5: WordPress 打包与部署验收

任务:

1. 同步插件文件。
2. 提升插件版本。
3. 重新打包 zip。
4. 上传 WordPress。
5. 清缓存。
6. 在公网页面跑一轮真实上传与计算。

验收:

1. API Ready。
2. 上传 STEP 后 PNG 正常。
3. 3D View 不影响 quote 计算。
4. 材料二级选择器可用。
5. 计算结果不泄露价格表。
6. Request Formal Quote 的邮件正文包含细分材料。

## 11. 建议测试清单

### 11.1 后端单元测试

新增或扩展:

```text
backend/tests/test_quote_v2_2_materials.py
```

测试项:

1. `get_quote_options_v2()` 返回 `material_categories[*].materials`。
2. options 不包含任何内部价格字段。
3. `_find_material_price(price_id)` 能找到材料。
4. `calculate_quote_v2()` 使用细分材料价格。
5. `SAFETY_MULTIPLIER == 1.00`。
6. `7075 domestic` 与 `7075 imported` 价格结果不同。
7. `PEEK` 明显高于 `POM`。
8. `material_id/category` 错配报错。
9. public response 不包含 `formula` 和 `breakdown`。

### 11.2 前端静态测试

命令:

```powershell
node --check js\quote.js
node --check daiyujin-tools\assets\js\quote.js
```

手工浏览器检查:

1. 控制台无 JS error。
2. Network 中 `/quote/options` 正常。
3. 材料选择器首次 hydrate 后不是空白。
4. 搜索 `6061` 可过滤。
5. 选择 `PEEK` 后 calculate payload 的 material_id 变化。

### 11.3 端到端测试样例

用同一个 STEP 文件测试以下材料:

| 材料          | 期望                   |
| ------------- | ---------------------- |
| 6061          | 基准铝价               |
| 6061-T6       | 与 6061 接近但可不同   |
| 7075 Domestic | 高于普通铝或接近       |
| 7075 Imported | 明显高于 7075 Domestic |
| SUS304        | 高于碳钢               |
| SUS316L       | 高于或接近 SUS316      |
| POM           | 工程塑料基准           |
| PEEK          | 明显高于 POM           |

只检查相对关系，不要求绝对价格完全符合直觉。因为 OBB 体积和工艺项仍会影响结果。

## 12. 风险与应对

| 风险                            | 表现                        | 应对                                                 |
| ------------------------------- | --------------------------- | ---------------------------------------------------- |
| 材料价格表有脏数据              | 密度/价格列错位             | 公开材料生成脚本加校验，异常材料不进前端             |
| 客户不懂细分牌号                | 选择困难                    | 每类默认 Recommended，并保留“Request formal quote” |
| 材料列表过长                    | 表单压迫感增强              | 右侧搜索、max-height、常见材料排序靠前               |
| 价格泄露                        | Network response 包含采购价 | Public options 从脱敏 JSON 读取                      |
| WordPress 缓存旧 JS             | 前端仍只有一级选择          | 插件版本号升级，必要时 URL 加`?ver=`               |
| v2.2 safety 降到 1.0 后报价偏低 | 低估比例仍 54.4%            | 保留稳定随机上偏区间，高风险材料提示工程确认         |
| 7075 国产/进口桥接丢失          | 两者都变成 Al 7075          | 前端和后端用`price_id` 作为材料 ID                 |
| legacy fallback 材料仍存在      | 黄铜、钛等材料数据不完整    | 先标记 Engineering review，后续补材料价              |

## 13. 文件级修改清单

### 必改

```text
backend/data/quote_model_v2_2/*
backend/services/quote_calculator_v2.py
backend/services/pricing.py
js/quote.js
quote.html
css/plugins.css
daiyujin-tools/assets/js/quote.js
daiyujin-tools/assets/css/plugins.css
daiyujin-tools/templates/quote.php
daiyujin-tools/daiyujin-tools.php
```

### 建议新增

```text
backend/scripts/build_quote_material_public_options.py
backend/tests/test_quote_v2_2_materials.py
```

### 可选新增

```text
backend/services/quote_calculator_v2_1.py
backend/services/quote_calculator_v2_2.py
backend/data/quote_model_v2_2/material_quality_report.md
```

## 14. 交付验收标准

功能验收:

1. 用户可以二级选择材料。
2. 计算使用细分材料，而不是只用大类代表材料。
3. 6061、6061-T6、7075 国产、7075 进口可以产生不同估价。
4. PEEK 与 POM 估价有明显差异。
5. 未选择细分材料时，有合理默认材料。
6. Request Formal Quote 邮件正文包含细分材料。

安全验收:

1. Public API 不泄露采购价。
2. Public API 不泄露密度。
3. Public API 不泄露公式明细。
4. 页面不展示 CNY 内部成本。
5. Network response 中不出现 `formula`、`breakdown`。

模型验收:

1. `SAFETY_MULTIPLIER = 1.00`。
2. `pricing_model_version` 内部记录为 v2.2-A.1，但不公开。
3. v2.2-A.1 系数来自 `coefficients_v2_2_A.json`。
4. 低样本或高风险材料 public warning 只说需要工程确认。

前端验收:

1. 1440px、1024px、390px 下布局不破。
2. 材料列表不遮挡上传、进度条、结果区。
3. 搜索框输入时不卡顿。
4. 长材料名不溢出。
5. 无 console error。

WordPress 验收:

1. 插件版本更新。
2. 上传新版 zip 后页面加载新版 JS/CSS。
3. 公网页面 quote 计算正常。
4. 静态站和 WP 插件行为一致。

## 15. 推荐推进顺序

建议一个阶段一个阶段来:

1. Phase Q22-0: 只接数据目录和脱敏 material options，不动前端。
2. Phase Q22-1: 后端 calculate 支持 `material_id`，先用 API 测通。
3. Phase Q22-2: 前端二级菜单，先静态站跑通。
4. Phase Q22-3: CSS 和移动端打磨。
5. Phase Q22-4: 黑盒 API 脱敏审查。
6. Phase Q22-5: 同步 WordPress 插件。

不要一口气同时改算法、前端、插件和 3D view。这个阶段最核心的风险是数据泄露和材料 ID 映射错误，先把后端数据边界打稳，再做 UI 会更稳。
