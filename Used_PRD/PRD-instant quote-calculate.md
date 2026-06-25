# PRD: Instant Quote 短期纯计算版实现

Version: v1.0
Date: 2026-06-25
Target page: `quote.html`
Target backend: `backend/services/pricing.py`, `backend/services/step_analyzer.py`, `backend/models.py`, `backend/scripts/seed_data.py`
Reference project: `D:\报价系统`
Reference baseline: `D:\报价系统\报价系统项目总结-v2.1.md`

## 1. 背景

短期内 Instant Quote 不进入复杂的工艺时间模型、风险分级、历史回填和 ML 校准路线。当前目标是把 `D:\报价系统` 已经完成的 v2.1 冻结公式接入现有网站，让 `quote.html` 成为一个稳定、可解释、可复现的本地计算型报价工具。

这意味着：

1. 不使用 LLM。
2. 不实时拟合参数。
3. 不接入外部服务。
4. 不使用随机扰动改变价格。
5. 只使用固定参数表和四则运算。

短期系统的基本形态：

```text
STEP 上传
  -> OpenCascade 提取 OBB 尺寸
  -> 用户选择材料、工艺、后处理、数量、币种
  -> 后端按 v2.1 冻结公式计算
  -> 前端展示参考估价
```

## 2. 资料来源

### 2.1 本地报价系统总结

`D:\报价系统\报价系统项目总结-v2.1.md` 给出的关键结论：

1. 数据来自 `Resource/` 下 497 个 `.xlsx` 历史报价单。
2. 抽取后得到 1361 条 eligible 样本。
3. v2.1 使用加法混合公式，而非纯乘法模型。
4. 公式参数冻结在 `models/coefficients_v2_1.json`。
5. 公式是查表加四则运算，Excel 可直接使用，零外部依赖。
6. 安全校准系数为 `1.25`。
7. 难度系数当前冻结为 `1.0`。
8. 数量折扣主要在 `501+` 件时生效。

### 2.2 本地报价系统文件

主要文件：

```text
D:\报价系统\
├── 报价系统项目总结-v2.1.md
├── 报价拟合迭代指导书-v2.1.md
├── config/
│   ├── materials.csv
│   ├── material_aliases.csv
│   ├── process_groups.csv
│   ├── process_aliases.csv
│   ├── postprocess_groups.csv
│   ├── postprocess_aliases.csv
│   ├── quantity_tiers.csv
│   └── manual_overrides.csv
├── models/
│   └── coefficients_v2_1.json
└── output/v2_1/
    ├── evaluation_report.md
    ├── parameter_diagnostics.md
    ├── predictions_clean_core.csv
    ├── review_queue.csv
    └── visualization.png
```

短期实现必须以 v2.1 总结文档和 `coefficients_v2_1.json` 为准。`README.md` 中仍可见旧版乘法公式，只能作为项目历史背景，不作为本轮实现依据。

参数读取口径：

| 数据 | 权威来源 | 说明 |
|---|---|---|
| 公式版本 | `coefficients_v2_1.json.formula_version` | 应为 `v2.1_additive` |
| 材料倍率 | `material_markup_by_process` | 按工艺 group 查表 |
| 调机费 | `setup_fee_by_process` | 按工艺 group 查表，计算时除以数量 |
| 加工基准费 | `machining_base_by_process` | 按工艺 group 查表 |
| 后处理费用 | `postprocess_fee_by_group` | 按后处理 group 查表 |
| 数量折扣 | `deltas` | 按数量档位 key 查表 |
| 安全倍率 | `报价系统项目总结-v2.1.md` | `1.25`，当前 JSON 未单独提供该 key |
| 材料密度和单价 | `materials.csv` | 字段为 `density_g_cm3` 和 `price_rmb_per_kg` |
| 工艺归一化 | `process_groups.csv` / `process_aliases.csv` | 原始名称到 group 的映射 |
| 后处理归一化 | `postprocess_groups.csv` / `postprocess_aliases.csv` | 原始名称到 group 的映射，不提供费用 |
| 人工覆盖 | `manual_overrides.csv` | 当前为空，短期只保留文件，不参与计算 |

### 2.3 当前网站报价系统

当前网站已有：

| 文件 | 当前作用 |
|---|---|
| `quote.html` | STEP 上传、材料、公差、后处理、数量、币种表单 |
| `js/quote.js` | 上传 STEP、调用报价 API、展示进度条和结果卡 |
| `backend/services/step_analyzer.py` | 用 OpenCascade 读取 STEP，返回 volume、OBB、AABB、thumbnail |
| `backend/services/pricing.py` | 当前旧报价模型 |
| `backend/models.py` | 材料、公差、后处理、数量阶梯、询盘表 |
| `backend/scripts/seed_data.py` | 当前示例材料和旧报价参数种子 |

当前旧报价模型的问题：

1. 用净体积 `volume_mm3` 计算材料重量，和 v2.1 的包围盒材料成本逻辑不同。
2. 用 `SizeCost + tolerance.factor + quantity.factor` 的旧系数逻辑，不对应 v2.1 冻结公式。
3. 有 deterministic random `dynamic_factor`，价格会被 ±1.5% 左右扰动。
4. 后处理是多选 checkbox，但 v2.1 公式是单一后处理组加法。
5. 没有工艺选择字段，无法区分 CNC、车床、车铣复合、板金。

## 3. 产品目标

### 3.1 短期目标

把 Instant Quote 改造成 v2.1 本地计算报价器：

```text
预测单价 = (
    材料成本 × 工艺材料倍率
  + 工艺调机费 ÷ 数量
  + 工艺加工基准费 × 难度系数
  + 后处理费用
) × 数量折扣

建议单价 = 预测单价 × 1.25

建议总价 = 建议单价 × 数量
```

### 3.2 非目标

本阶段不做：

1. 不做 AI/LLM 报价。
2. 不做历史报价实时学习。
3. 不做复杂几何特征加工时间模型。
4. 不做 ML 残差校准。
5. 不做自动 DFM 结论。
6. 不做多后处理组合的精确成本叠加。
7. 不把结果包装成 binding quote。

### 3.3 成功标准

1. 相同输入每次返回同一报价。
2. 后端公式和 `D:\报价系统` v2.1 总结一致。
3. 当前 STEP 上传流程保留。
4. 前端能选择材料、工艺、后处理、数量、币种。
5. API 返回公式拆分，方便自检。
6. 客户侧展示简洁估价，不暴露全部拟合细节。
7. 测试覆盖本 PRD 中两个可复算验收样例。

## 4. v2.1 冻结公式

### 4.1 主公式

```text
material_cost_rmb =
  length_mm * width_mm * height_mm
  * density_g_cm3
  / 1_000_000
  * price_rmb_per_kg

raw_unit_price_rmb =
  (
      material_cost_rmb * material_markup
    + setup_fee_rmb / quantity
    + machining_base_fee_rmb * difficulty_factor
    + postprocess_fee_rmb
  )
  * quantity_delta

suggested_unit_price_rmb =
  raw_unit_price_rmb * safety_multiplier

suggested_total_rmb =
  suggested_unit_price_rmb * quantity
```

### 4.2 固定参数

| 参数 | v2.1 值 | 说明 |
|---|---:|---|
| `difficulty_factor` | `1.0` | 当前冻结，不启用难度拟合 |
| `safety_multiplier` | `1.25` | 建议报价安全校准，来自 v2.1 总结文档 |
| `q_001_001` | `1.0` | 1 件 |
| `q_002_005` | `1.0` | 2-5 件 |
| `q_006_010` | `1.0` | 6-10 件 |
| `q_011_050` | `1.0` | 11-50 件 |
| `q_051_100` | `1.0` | 51-100 件 |
| `q_101_500` | `1.0` | 101-500 件 |
| `q_501_plus` | `0.6972540803` | 501+ 件 |

### 4.3 工艺参数

来自 `models/coefficients_v2_1.json`：

```text
material_markup_by_process[process_group]
setup_fee_by_process[process_group]
machining_base_by_process[process_group]
process_group_counts[process_group]
```

| 工艺 | 材料倍率 | 调机费 RMB | 加工基准费 RMB | 样本数 | 上线建议 |
|---|---:|---:|---:|---:|---|
| CNC | 5.0000 | 929.5 | 11.6 | 626 | 可上线 |
| 车床 | 5.0000 | 901.3 | 2.1 | 308 | 可上线 |
| 车铣复合 | 4.1978 | 904.1 | 8.9 | 325 | 可上线 |
| 板金 | 5.0000 | 494.7 | 13.4 | 40 | 可上线但提示样本少 |
| 其他工艺 | 0.5000 | 1166.2 | 6.8 | 3 | 不建议公开选，走人工复核 |

短期前端默认：

```text
process = CNC
```

### 4.4 后处理参数

后处理费用来自 `coefficients_v2_1.json.postprocess_fee_by_group`，样本数来自 `postprocess_group_counts`。`config/postprocess_groups.csv` 和 `config/postprocess_aliases.csv` 只做名称归一化，例如把 `Deburr`、`本色去毛刺` 映射到 `去毛刺`。

| 后处理组 | 加价 RMB/件 | 样本数 | 上线建议 |
|---|---:|---:|---|
| 去毛刺 | 0.0 | 824 | 默认 |
| 钝化 | 0.0 | 18 | 可选，但提示低样本冻结 |
| 电镀涂层 | 0.0 | 99 | 可选 |
| 未标注后处理 | 0.7 | 72 | 不建议前端主动展示 |
| 电解抛光 | 7.2 | 32 | 可选 |
| 阳极氧化 | 8.8 | 97 | 可选 |
| 镭雕 | 11.8 | 48 | 可选 |
| 喷砂抛光 | 17.8 | 77 | 可选 |
| 热处理 | 19.4 | 31 | 可选，但建议提示复核 |
| 其他后处理 | 0.0 | 4 | 不建议公开选，走人工复核 |

短期前端从多选 checkbox 改为单选 select。原因是 v2.1 公式只有一个 `postprocess_group`。

### 4.5 材料参数

材料来自：

```text
D:\报价系统\config\materials.csv
```

字段：

| 字段 | 说明 |
|---|---|
| `material_norm` | 标准材料名 |
| `density_g_cm3` | 密度 |
| `price_rmb_per_kg` | RMB/kg |
| `price_effective_date` | 价格日期 |
| `source` | 来源 |
| `is_active` | 是否启用 |

短期实现应使用 RMB 材料价格作为公式基准，不再使用当前 seed 中的 USD/kg 示例价作为主计算数据。

## 5. 当前页面改造范围

### 5.1 保留

1. STEP 上传。
2. 进度条体验。
3. Part 卡片。
4. Estimate 卡片。
5. Formal quote 邮件 CTA。
6. API health check。
7. Inquiry 记录。

### 5.2 修改

| 模块 | 当前 | 改为 |
|---|---|---|
| 材料 | 数据库 seed 的示例材料 | v2.1 `materials.csv` 材料 |
| 工艺 | 无字段 | 新增 process select |
| 公差 | 影响旧价格系数 | 短期仅作为备注或 review hint，不参与 v2.1 公式 |
| 后处理 | 多选 checkbox | 单选 postprocess group |
| 数量 | 旧 quantity tier factor | v2.1 quantity delta |
| 材料成本 | STEP 净体积 | OBB 包围盒体积 |
| 价格扰动 | `dynamic_factor` | 删除，纯计算确定输出 |
| 输出 | 单个 total | 建议单价、建议总价、公式单价、公式拆分 |

### 5.3 新增前端字段

在 `quote.html` 的表单中新增：

```html
<div class="tool-field">
  <label for="process">Process</label>
  <select id="process" name="process" data-process-select></select>
</div>
```

后处理改为：

```html
<div class="tool-field">
  <label for="postprocess">Postprocess</label>
  <select id="postprocess" name="postprocess_group" data-postprocess-select></select>
</div>
```

公差字段短期保留，但标签改为：

```text
General Tolerance
```

并在 API 中只记录，不参与 v2.1 价格公式。

## 6. 后端数据落地方案

### 6.1 推荐目录

新增：

```text
backend/data/quote_model_v2_1/
├── coefficients_v2_1.json
├── materials.csv
├── process_groups.csv
├── process_aliases.csv
├── postprocess_groups.csv
├── postprocess_aliases.csv
├── quantity_tiers.csv
├── manual_overrides.csv
└── README.md
```

文件来源：

```text
D:\报价系统\models\coefficients_v2_1.json
D:\报价系统\config\materials.csv
D:\报价系统\config\process_groups.csv
D:\报价系统\config\process_aliases.csv
D:\报价系统\config\postprocess_groups.csv
D:\报价系统\config\postprocess_aliases.csv
D:\报价系统\config\quantity_tiers.csv
D:\报价系统\config\manual_overrides.csv
```

`manual_overrides.csv` 当前为空。短期复制它只是为了保留参数包完整性，不把它接入计算链路。

### 6.2 为什么先用文件数据

短期推荐直接从 `backend/data/quote_model_v2_1/` 读取，不急着重构数据库。

理由：

1. v2.1 是冻结参数包，用文件天然可版本化。
2. 可以避免改动现有 `materials`、`surface_treatments` 表导致旧功能受影响。
3. 后续 upgrade 时仍可把文件导入数据库。
4. 测试时可以用 fixture 数据包替换。

### 6.3 新增服务模块

新增：

```text
backend/services/quote_calculator_v2.py
```

职责：

1. 加载 v2.1 参数包。
2. 提供 quote options。
3. 解析 OBB 尺寸。
4. 执行 v2.1 公式。
5. 返回公式拆分和客户展示结果。

推荐函数：

```python
def get_calculate_quote_options_v2() -> dict:
    ...

def calculate_quote_v2(payload: dict) -> dict:
    ...

def parse_obb_dimensions(value: str) -> tuple[float, float, float]:
    ...

def get_quantity_delta(quantity: int, coefficients: dict) -> tuple[str, float]:
    ...
```

`coefficients_v2_1.json` 的实际结构为顶层分组字典，实现时应直接读取这些 key：

```python
coefficients["material_markup_by_process"][process_group]
coefficients["setup_fee_by_process"][process_group]
coefficients["machining_base_by_process"][process_group]
coefficients["postprocess_fee_by_group"][postprocess_group]
coefficients["deltas"][tier_id]
```

`safety_multiplier=1.25` 需要在 `quote_calculator_v2.py` 内作为 v2.1 常量定义，或写入 `backend/data/quote_model_v2_1/README.md` 的 metadata。不要假设冻结 JSON 一定包含该字段。

`backend/services/pricing.py` 短期改为 facade：

```python
from services.quote_calculator_v2 import (
    calculate_quote_v2,
    get_calculate_quote_options_v2,
)

def get_quote_options():
    return get_calculate_quote_options_v2()

def calculate_quote(payload, *, client_ip=None, user_agent=None):
    result = calculate_quote_v2(payload)
    _record_quote_inquiry(...)
    return result
```

这样可以保持 `backend/app.py` 路由不变。

## 7. API 设计

### 7.1 `GET /api/public/quote/options`

返回 v2.1 计算所需选项。

Response:

```json
{
  "model": {
    "version": "v2.1_additive",
    "pricing_mode": "deterministic_calculation",
    "currency_basis": "RMB",
    "safety_multiplier": 1.25
  },
  "materials": [
    {
      "id": "Al 6061",
      "name": "Al 6061",
      "density_g_cm3": 2.7,
      "price_rmb_per_kg": 28,
      "price_effective_date": "2026-01-01"
    }
  ],
  "processes": [
    {
      "id": "CNC",
      "name": "CNC",
      "sample_count": 626,
      "public": true
    }
  ],
  "postprocess_groups": [
    {
      "id": "去毛刺",
      "name": "Deburr",
      "fee_rmb": 0,
      "sample_count": 824
    }
  ],
  "tolerance_grades": [
    {
      "grade": "GENERAL",
      "label": "General tolerance"
    }
  ],
  "currencies": ["USD", "CNY", "EUR"],
  "default_currency": "USD"
}
```

兼容要求：

1. `materials` 仍可被 `js/quote.js` 填入 material select。
2. `tolerance_grades` 保留，避免前端旧代码立即崩。
3. 新增 `processes` 和 `postprocess_groups`。

### 7.2 `POST /api/public/quote/calculate`

Request:

```json
{
  "file_id": "uuid",
  "part_name": "bracket",
  "stp_filename": "bracket.step",
  "volume_mm3": 12500,
  "obb_dimensions_mm": "100.00 x 50.00 x 20.00",
  "material_id": "AISI 304",
  "process": "CNC",
  "postprocess_group": "去毛刺",
  "tolerance_grade": "GENERAL",
  "quantity": 10,
  "currency": "USD"
}
```

兼容层：

如果前端暂时仍传 `surface_treatment_ids`，后端可以在过渡期把空数组映射为 `去毛刺`。正式改造后应使用 `postprocess_group`。

Response:

```json
{
  "quote_status": "estimated",
  "pricing_mode": "deterministic_calculation",
  "pricing_model_version": "v2.1_additive",
  "valid_until": "2026-07-02",
  "currency": "USD",
  "exchange_rate_basis": "RMB",
  "part": {
    "file_id": "uuid",
    "name": "bracket",
    "stp_filename": "bracket.step",
    "volume_mm3": 12500,
    "obb_dimensions_mm": "100.00 x 50.00 x 20.00",
    "obb_lwh_mm": [100, 50, 20],
    "stock_volume_mm3": 100000,
    "stock_weight_kg": 0.793
  },
  "selections": {
    "material": {
      "id": "AISI 304",
      "name": "AISI 304",
      "density_g_cm3": 7.93,
      "price_rmb_per_kg": 22
    },
    "process": "CNC",
    "postprocess_group": "去毛刺",
    "quantity": 10,
    "quantity_tier": "q_011_050",
    "tolerance_grade": "GENERAL"
  },
  "formula": {
    "material_cost_rmb": 17.45,
    "material_markup": 5.0,
    "material_term_rmb": 87.23,
    "setup_fee_rmb": 929.51,
    "setup_term_rmb": 92.95,
    "machining_base_rmb": 11.62,
    "difficulty_factor": 1.0,
    "machining_term_rmb": 11.62,
    "postprocess_fee_rmb": 0,
    "quantity_delta": 1.0,
    "raw_unit_price_rmb": 191.8,
    "safety_multiplier": 1.25,
    "suggested_unit_price_rmb": 239.75,
    "suggested_total_rmb": 2397.5
  },
  "unit_price": {
    "amount": 33.3,
    "amount_rmb": 239.75,
    "currency": "USD",
    "display": "$33.30"
  },
  "total": {
    "amount": 333.0,
    "amount_rmb": 2397.5,
    "currency": "USD",
    "display": "$333.00"
  },
  "breakdown": [
    {"label": "Material term", "display": "¥87.23 / pc"},
    {"label": "Setup allocation", "display": "¥92.95 / pc"},
    {"label": "Machining base", "display": "¥11.62 / pc"},
    {"label": "Postprocess", "display": "¥0.00 / pc"}
  ],
  "warnings": [],
  "disclaimer": "This is a deterministic reference estimate based on v2.1 historical quote coefficients. Final pricing is confirmed after engineering review."
}
```

### 7.3 货币转换

v2.1 公式以 RMB 为基准。

短期转换规则：

```text
if currency == "CNY":
    display_amount = amount_rmb
elif currency == "USD":
    display_amount = amount_rmb / usd_to_cny_rate
elif currency == "EUR":
    display_amount = amount_rmb / usd_to_cny_rate * usd_to_eur_rate
```

当前 `exchange_rates` 表已有：

```text
USD -> USD = 1.0
USD -> CNY = 7.20
USD -> EUR = 0.92
```

因此 USD 展示可用：

```text
amount_usd = amount_rmb / 7.20
```

EUR 展示可用：

```text
amount_eur = amount_usd * 0.92
```

## 8. 前端设计细则

### 8.1 表单调整

当前字段：

| 字段 | 处理 |
|---|---|
| STEP file | 保留 |
| Material | 改用 v2.1 materials |
| Tolerance Grade | 保留但改名为 General Tolerance |
| Surface Treatment | 改为 Postprocess 单选 |
| Quantity | 保留 |
| Currency | 保留 |

新增字段：

| 字段 | 默认 | 来源 |
|---|---|---|
| Process | `CNC` | `/api/public/quote/options.processes` |

### 8.2 `js/quote.js` 修改点

状态新增：

```js
const state = {
  fileKey: "",
  fileName: "",
  analysis: null,
  estimate: null,
  options: null,
};
```

保留即可。

新增 DOM refs：

```js
const processSelect = document.querySelector("[data-process-select]");
const postprocessSelect = document.querySelector("[data-postprocess-select]");
```

`hydrateOptions()` 改为：

1. 填充 materials。
2. 填充 processes。
3. 填充 postprocess groups。
4. 保留 tolerance grades。
5. 填充 currencies。

`calculateEstimate()` payload 改为：

```js
const payload = {
  file_id: state.analysis.file_id,
  part_name: state.analysis.name,
  stp_filename: state.fileName,
  volume_mm3: state.analysis.volume_mm3,
  obb_dimensions_mm: state.analysis.obb_dimensions_mm,
  material_id: String(formData.get("material_id") || ""),
  process: String(formData.get("process") || "CNC"),
  postprocess_group: String(formData.get("postprocess_group") || "去毛刺"),
  tolerance_grade: String(formData.get("tolerance_grade") || "GENERAL"),
  quantity: Number(formData.get("quantity")),
  currency: String(formData.get("currency") || "USD"),
};
```

删除或停用：

```js
surface_treatment_ids: formData.getAll("surface_treatment_ids").map(Number)
```

### 8.3 结果卡显示

结果卡主展示：

```text
Estimated Total
$333.00

Unit Price
$33.30 / pc

Model
v2.1 calculation
```

次级展示：

```text
Process: CNC
Material: AISI 304
Postprocess: Deburr
Quantity: 10 pcs
OBB: 100 x 50 x 20 mm
```

折叠或小字展示：

```text
Formula basis: deterministic v2.1 historical quote coefficients.
```

不建议客户侧突出展示：

1. `material_markup`
2. `setup_fee`
3. `safety_multiplier`
4. 训练样本误差指标

这些可以留在 API response 或 internal debug，但前端主界面不要铺开。

### 8.4 进度条保留

保留现有智能扫描进度条体验，但只作为 UI 动效。不要让进度条或随机数改变价格。

当前 `quote.js` 里的 progress phases 可以保留：

```text
Intelligent system compiling
Geometric model parsing
Manufacturing feature analysis
Cost matrix evaluating
Dynamic quotation generating
```

价格必须确定：

```text
same input -> same output
```

## 9. 后端实现细则

### 9.1 移除随机价格扰动

当前 `pricing.py` 有：

```python
dynamic_factor = round(0.985 + rng.random() * 0.03, 4)
display_total_usd = round(base_total_usd * dynamic_factor, 2)
```

短期纯计算版必须移除价格随机扰动。

可以保留字段：

```json
"pricing_mode": "deterministic_calculation"
```

不要返回：

```json
"dynamic_factor": 1.013
```

### 9.2 OBB 尺寸解析

当前 `step_analyzer.py` 返回：

```json
"obb_dimensions_mm": "100.00 x 50.00 x 20.00"
```

后端需要解析：

```python
def parse_obb_dimensions(value: str) -> tuple[float, float, float]:
    parts = (
        str(value or "")
        .replace("×", "x")
        .lower()
        .split("x")
    )
    numbers = [float(part.strip()) for part in parts if part.strip()]
    if len(numbers) != 3 or any(n <= 0 for n in numbers):
        raise ValueError("obb_dimensions_mm must contain three positive dimensions")
    return tuple(numbers)
```

### 9.3 公式计算函数

伪代码：

```python
def calculate_quote_v2(payload):
    quantity = validate_quantity(payload["quantity"])
    dims = parse_obb_dimensions(payload["obb_dimensions_mm"])
    material = get_material(payload["material_id"])
    process = get_process(payload.get("process", "CNC"))
    postprocess = get_postprocess(payload.get("postprocess_group", "去毛刺"))

    l, w, h = dims
    stock_volume_mm3 = l * w * h
    stock_weight_kg = stock_volume_mm3 * material.density_g_cm3 / 1_000_000
    material_cost_rmb = stock_weight_kg * material.price_rmb_per_kg

    material_markup = coefficients["material_markup_by_process"][process]
    setup_fee = coefficients["setup_fee_by_process"][process]
    machining_base = coefficients["machining_base_by_process"][process]
    postprocess_fee = coefficients["postprocess_fee_by_group"][postprocess]
    tier, delta = get_quantity_delta(quantity)

    raw_unit = (
        material_cost_rmb * material_markup
        + setup_fee / quantity
        + machining_base * 1.0
        + postprocess_fee
    ) * delta

    suggested_unit = raw_unit * SAFETY_MULTIPLIER
    suggested_total = suggested_unit * quantity
```

### 9.4 Review 和 warning

短期纯计算版仍要保留 warnings。

推荐规则：

| 场景 | 处理 |
|---|---|
| 工艺为 `其他工艺` | warning，建议 formal quote |
| 工艺样本数 < 20 | warning |
| 后处理样本数 < 20 | warning |
| postprocess_group 不在系数表 | fallback 到 `其他后处理` 并 warning，或直接 400 |
| OBB 任一尺寸 <= 0 | 400 |
| quantity > 100000 | 400 |
| material missing | 400 |
| price_rmb_per_kg <= 0 | 400 |

短期不强行隐藏价格，但 warning 应展示在结果卡底部。

### 9.5 Inquiry 记录

继续使用 `Inquiry` 表。

`result` JSON 中必须保存：

1. `pricing_model_version`
2. `pricing_mode`
3. `formula`
4. `selections`
5. `warnings`
6. `total`
7. `unit_price`

`Inquiry.total_usd` 应保存最终展示币种如果是 USD，则保存 USD 金额；同时 `result.total.amount_rmb` 保存 RMB 基准。

## 10. 数据迁移与配置

### 10.1 短期不改数据库表

优先用文件数据包，不新建表。

必须改的只有：

1. `backend/services/pricing.py`
2. 新增 `backend/services/quote_calculator_v2.py`
3. 新增 `backend/data/quote_model_v2_1/`
4. `quote.html`
5. `js/quote.js`
6. WordPress plugin 同步文件

### 10.2 可选 seed 同步

如果希望后台 options 继续从数据库读取，可以写导入脚本：

```text
backend/scripts/import_quote_model_v2_1.py
```

但短期不推荐，因为当前 `Material` 表用的是 USD/kg，v2.1 用 RMB/kg。混用会增加误读风险。

### 10.3 WordPress 插件同步

改完根目录页面后，同步：

```text
daiyujin-tools/templates/quote.php
daiyujin-tools/assets/js/quote.js
daiyujin-tools/assets/css/plugins.css
```

WordPress 插件不得包含 `D:\报价系统\Resource` 原始报价单，只能包含参数包或调用后端 API。

## 11. 实施阶段

### Phase C0: 参数包落地

任务：

1. 新建 `backend/data/quote_model_v2_1/`。
2. 复制 `coefficients_v2_1.json`。
3. 复制 materials/process/postprocess 配置。
4. 写 `README.md` 说明来源和版本。

验收：

```text
参数包存在。
不包含 497 个原始 xlsx。
coefficients 中 formula_version = v2.1_additive。
```

### Phase C1: 后端计算器模块

任务：

1. 新建 `quote_calculator_v2.py`。
2. 实现参数加载。
3. 实现 OBB 解析。
4. 实现材料/工艺/后处理 lookup。
5. 实现 v2.1 公式。
6. 实现 RMB -> display currency。
7. 增加 warnings。

验收：

```text
304 CNC 示例可计算。
6061 车床 1000 件阳极氧化示例可计算。
同一 payload 连续计算结果完全一致。
```

### Phase C2: API 兼容改造

任务：

1. `get_quote_options()` 返回 v2.1 options。
2. `calculate_quote()` 调用 v2 计算器。
3. 保留 `request_formal_quote()`。
4. 保留 inquiry logging。
5. 删除价格随机扰动。

验收：

```text
GET /api/public/quote/options 返回 materials/processes/postprocess_groups。
POST /api/public/quote/calculate 返回 unit_price/total/formula。
旧测试更新后通过。
响应不包含 dynamic_factor。
```

### Phase C3: 前端表单改造

任务：

1. `quote.html` 增加 Process select。
2. Surface Treatment 改为 Postprocess select。
3. Tolerance Grade 文案改为 General Tolerance。
4. `js/quote.js` hydrate 新 options。
5. payload 使用 `process` 和 `postprocess_group`。
6. 结果卡展示 unit price、total、model version。
7. warning 展示在结果卡底部。

验收：

```text
用户上传 STEP 后能选择材料、工艺、后处理、数量、币种。
计算成功后显示建议单价和建议总价。
进度条保留。
价格不随机波动。
```

### Phase C4: WordPress 插件同步

任务：

1. 同步 `templates/quote.php`。
2. 同步 `assets/js/quote.js`。
3. 如有 CSS 改动，同步 `assets/css/plugins.css`。
4. 保持 shortcode `[dyj_quote_tool]` 可用。

验收：

```text
Standalone quote.html 和 WordPress shortcode 行为一致。
插件包不包含原始报价 xlsx。
```

### Phase C5: 测试与验收

任务：

1. 更新 `backend/scripts/test_phase1a.py`。
2. 新增 `backend/scripts/test_quote_calculator_v2.py`。
3. 测试公式示例。
4. 测试 API。
5. 浏览器手测前端。

验收：

```text
所有 quote 测试通过。
同一输入重复请求返回同一价格。
USD/CNY 显示正确。
无内部费率泄露到前端主界面。
```

## 12. 测试案例

### 12.1 不锈钢 304 CNC 示例

输入：

```json
{
  "obb_dimensions_mm": "100 x 50 x 20",
  "material_id": "AISI 304",
  "process": "CNC",
  "postprocess_group": "去毛刺",
  "quantity": 10,
  "currency": "CNY"
}
```

预期：

```text
material_cost_rmb ≈ 17.45
raw_unit_price_rmb ≈ 191.78
suggested_unit_price_rmb ≈ 239.73
```

允许误差：

```text
±0.5 RMB
```

### 12.2 Al 6061 车床大批量阳极氧化

输入：

```json
{
  "obb_dimensions_mm": "50 x 30 x 10",
  "material_id": "Al 6061",
  "process": "车床",
  "postprocess_group": "阳极氧化",
  "quantity": 1000,
  "currency": "CNY"
}
```

预期：

```text
material_cost_rmb ≈ 1.13
raw_unit_price_rmb ≈ 12.19
suggested_unit_price_rmb ≈ 15.24
quantity_tier = q_501_plus
```

允许误差：

```text
±0.5 RMB
```

### 12.3 确定性测试

同一 payload 连续调用 3 次：

```text
total.amount_rmb 完全一致
unit_price.amount_rmb 完全一致
```

### 12.4 错误输入

| Case | 预期 |
|---|---|
| quantity = 0 | 400 |
| material_id 不存在 | 400 |
| process 不存在 | 400 |
| obb_dimensions_mm 缺失 | 400 |
| OBB 只有两个数 | 400 |
| currency 不支持 | 400 |

## 13. 风险与处理

| 风险 | 影响 | 处理 |
|---|---|---|
| 当前网站材料名和 v2.1 材料名不一致 | 计算查不到材料 | 短期 options 直接来自 v2.1 materials |
| 后处理从多选改单选 | 用户不能表达多个处理 | 短期保持公式一致，多个后处理走 formal quote |
| 工艺参数部分命中边界 | 可能低估高附加值工艺 | 前端先公开稳定工艺，其他工艺提示复核 |
| 板金样本少 | 泛化不足 | 可选但 warning |
| 原公式 MAPE 仍较高 | 价格不能当正式报价 | 文案强调 reference estimate |
| STEP 体积和 OBB 可能异常 | 材料成本偏离 | 使用 OBB，异常时提示 formal quote |
| 原始 xlsx 数据敏感 | 不应进入网站仓库 | 只复制参数包，不复制 Resource |

## 14. 与未来 Upgrade 的关系

这份 PRD 是短期落地版，不取代后续 `PRD-Instant-Quote-Engine-Upgrade.md`。

关系如下：

| 阶段 | 当前 PRD | 未来 Upgrade PRD |
|---|---|---|
| 目标 | 快速上线纯计算报价 | 建立更科学的工程估算系统 |
| 算法 | v2.1 冻结公式 | 工艺时间模型 + 风险 + 历史校准 |
| 数据 | 固定参数包 | 数据回填和模型版本 |
| 前端 | 简洁参考估价 | 区间价、confidence、review gate |
| AI | 不使用 | 后续可作为解释和辅助 |

短期上线后，所有 inquiry 的 input/result 仍应保存。未来升级时可以作为新模型校准数据的一部分。

## 15. Definition of Done

短期纯计算版完成时，必须满足：

1. `quote.html` 可以完成 STEP 上传和 v2.1 公式报价。
2. 后端使用 `coefficients_v2_1.json` 和 config 文件，不再使用旧 SizeCost 模型。
3. 价格无随机扰动。
4. 工艺字段已加入。
5. 后处理为单选 group。
6. 材料来自 v2.1 materials。
7. 公式以 RMB 计算，前端默认 USD 展示。
8. API 返回 unit price 和 total。
9. 两个文档示例测试通过。
10. WordPress 插件同步。
11. 不提交 `D:\报价系统\Resource` 原始报价单。
12. 文案明确这是参考估价，正式报价仍需工程确认。
