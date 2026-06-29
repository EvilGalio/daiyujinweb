# Instant Quote v2.2-A.1 前后端更新指导书

适用项目：`D:\myfirstgithubcode\daiyujinweb`

数据依据：`D:\报价系统\报价系统项目总结-v2.2.md`

目标版本：`v2.2-A.1_material_price_bridge`

---

## 1. 更新结论

这次更新不是重新设计报价公式，而是把报价系统从“内部经验材料价 + 安全系数兜底”推进到“真实采购材料价 + 材料桥接 + 更细后处理分组”的版本。

前后端要围绕三个核心目标修改：

1. 后端报价引擎使用 v2.2-A.1 参数与材料价格知识表。
2. 前端材料选择继续保持二级菜单，但选项来自新的材料价格表，并且去重、英文化、隐藏内部成本信息。
3. 报价结果继续作为商业黑盒展示，只给客户估价，不展示模型版本、材料成本、调机费、加工费、后处理单价、数据源等内部信息。

v2.2-A.1 的关键变化如下：

| 项目 | v2.1 / 旧版 | v2.2-A.1 |
|---|---:|---:|
| 材料价格来源 | 内部估算价 | `材料价格.xlsx` 真实采购价优先 |
| 安全系数 | `1.25` | `1.00` |
| 材料匹配 | 几乎全部 legacy fallback | direct + bridge 为主，legacy fallback 降至约 7.7% |
| 后处理分组 | 10 组 | 12 组 |
| 车床材料倍率 | 旧版触顶 `5.0` | 约 `4.0` |
| 公式结构 | 加法模型 | 不变 |

需要注意：总结文档中车床材料倍率同时出现了 `3.990` 和 `4.063` 两个数。实现时不要手抄文档里的单个数字，必须以 `D:\报价系统\models\coefficients_v2_2_A.json` 为唯一代码来源，并在同步脚本里输出一次参数摘要，避免“文档数字”和“模型文件数字”不一致。

---

## 2. 当前实现应如何定位

现有 `quote` 页面已经经历过多轮迭代，大概率已经具备这些基础能力：

- `quote_calculator_v2.py` 作为核心计算器。
- `pricing.py` 作为 facade，负责接口、Inquiry 记录和公开响应。
- 前端已有材料大类 + 细分材料的二级选择。
- 前端结果已经倾向于黑盒估价，不再展示完整内部明细。
- WordPress 插件版本需要同步 `quote.js`、`quote.css`、`templates/quote.php`。

因此这次不要从零重写，而要先做一次差异审计：

```powershell
cd D:\myfirstgithubcode\daiyujinweb
rg -n "v2\.1|v2\.2|1\.25|SAFETY_MULTIPLIER|material_prices|material_public_options|postprocess|Material term|Setup allocation|Machining base|price_rmb|density" backend js templates daiyujin-tools
```

审计目标：

1. 确认后端是否仍残留 `1.25` 安全系数。
2. 确认公开接口是否泄露 `price_rmb_per_kg`、`density_g_cm3`、`material_price_source` 等字段。
3. 确认前端是否仍渲染模型版本、材料项、调机费、加工费等内部明细。
4. 确认 WordPress 插件和本地页面的 JS 是否一致。
5. 确认后处理选项是否已经拆分到 v2.2-A.1 需要的颗粒度。

---

## 3. 数据文件同步方案

### 3.1 推荐目录

建议继续使用：

```text
backend/data/quote_model_v2_2/
```

该目录应包含从 `D:\报价系统` 同步过来的模型与配置文件：

```text
backend/data/quote_model_v2_2/
  coefficients_v2_2_A.json
  material_prices.csv
  material_aliases_from_prices.csv
  material_price_bridge.csv
  material_price_conflicts.csv
  material_price_manual.csv
  materials.csv
  process_groups.csv
  process_aliases.csv
  postprocess_groups.csv
  postprocess_aliases.csv
  quantity_tiers.csv
  material_public_options.json
  material_quality_report.md
```

其中：

- `coefficients_v2_2_A.json` 是后端计算参数的唯一真源。
- `material_prices.csv` 是真实采购材料价格表。
- `material_price_bridge.csv` 负责把报价历史里的材料名桥接到标准材料。
- `material_price_manual.csv` 负责补齐真实表里暂缺但业务需要覆盖的材料。
- `material_public_options.json` 是前端唯一应该读取的材料选项文件。
- `material_quality_report.md` 用于内部审查，不给客户看。

### 3.2 建议新增同步脚本

建议新增：

```text
backend/scripts/sync_quote_model_v2_2.py
```

职责：

1. 从 `D:\报价系统\config` 和 `D:\报价系统\models` 复制必要文件。
2. 校验必要文件是否存在。
3. 校验 `coefficients_v2_2_A.json` 中 `safety_multiplier` 是否为 `1.00`。
4. 输出 process 参数摘要，尤其是 CNC、车床、车铣复合、板金、其他工艺。
5. 输出 legacy fallback 覆盖率摘要，如果无法自动计算，也至少写入同步时间和来源文件 hash。

伪代码：

```python
SOURCE_ROOT = Path(r"D:\报价系统")
TARGET = Path(__file__).resolve().parents[1] / "data" / "quote_model_v2_2"

FILES = {
    "models/coefficients_v2_2_A.json": "coefficients_v2_2_A.json",
    "config/material_prices.csv": "material_prices.csv",
    "config/material_aliases_from_prices.csv": "material_aliases_from_prices.csv",
    "config/material_price_bridge.csv": "material_price_bridge.csv",
    "config/material_price_conflicts.csv": "material_price_conflicts.csv",
    "config/material_price_manual.csv": "material_price_manual.csv",
    "config/materials.csv": "materials.csv",
    "config/process_groups.csv": "process_groups.csv",
    "config/process_aliases.csv": "process_aliases.csv",
    "config/postprocess_groups.csv": "postprocess_groups.csv",
    "config/postprocess_aliases.csv": "postprocess_aliases.csv",
    "config/quantity_tiers.csv": "quantity_tiers.csv",
}
```

不建议长期手动复制，因为材料价格表未来会更新。同步脚本可以保证 WordPress 打包前、本地 API 重启前都使用同一批参数。

---

## 4. 后端计算器修改指导

### 4.1 模型版本

在 `backend/services/quote_calculator_v2.py` 中设置清晰的版本常量：

```python
MODEL_VERSION = "v2.2-A.1_material_price_bridge"
DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "quote_model_v2_2"
COEFFICIENTS_FILE = DATA_DIR / "coefficients_v2_2_A.json"
```

公开响应不展示该版本号，但数据库和日志要保存，方便以后追溯报价来源。

### 4.2 公式保持不变

后端公式仍然是：

```text
预测单价 = (
    材料成本 × 工艺材料倍率
  + 工艺调机费 ÷ 数量
  + 工艺加工基准费 × 难度系数
  + 后处理费用
) × 数量折扣
```

这次不要把模型改成新的乘法模型，也不要重新引入随机扰动。当前需求是使用更可靠的材料成本数据，让同一输入得到稳定、可解释、可追溯的估算结果。

### 4.3 安全系数

需要移除或锁定旧版安全系数：

```python
SAFETY_MULTIPLIER = 1.00
```

更稳妥的方式是从 `coefficients_v2_2_A.json` 读取：

```python
safety_multiplier = float(coefficients.get("safety_multiplier", 1.00))
if abs(safety_multiplier - 1.00) > 1e-9:
    raise ValueError("v2.2-A.1 requires safety_multiplier=1.00")
```

验收时必须搜索：

```powershell
rg -n "1\.25|SAFETY_MULTIPLIER" backend
```

如果 `1.25` 还存在，必须确认它不是报价公式路径里的有效代码。

### 4.4 材料查找逻辑

材料成本查找优先级建议为：

```text
1. material_id 直接命中 material_prices.csv
2. material_id / material_name 通过 material_price_bridge.csv 桥接
3. material_price_manual.csv 手动补齐
4. materials.csv legacy fallback
```

内部结果中建议保留：

```python
material_price_source = "direct" | "bridge" | "manual" | "legacy_fallback"
material_confidence = "high" | "medium" | "low"
```

但这些字段不进入公开响应。它们只用于：

- 数据库记录。
- 后台排查。
- 未来做“材料库覆盖率报告”。
- 判断是否需要给内部销售或工程师标记“该报价建议复核”。

### 4.5 legacy fallback 的业务策略

v2.2-A.1 仍有约 102 条历史样本依赖 legacy fallback，主要集中在黄铜、钛合金、S355J2 等材料。对公开报价页面有两种策略：

推荐策略：

```text
前端公开材料列表只展示 direct / bridge / manual 中质量可靠的材料。
legacy_fallback 材料默认不出现在公开选择器里。
```

原因是客户看不到内部数据源，一旦 fallback 材料价格偏差较大，前端又给了明确估价，会显得系统很有把握，实际风险反而更高。

如果业务上必须展示某些 fallback 材料，则建议：

1. 内部记录 `material_confidence = low`。
2. 公开结果仍然不解释数据源。
3. 估价文案更偏向“engineering estimate”。
4. 邮件引导强调可联系工程师获取正式报价。

---

## 5. 后处理分组修改指导

### 5.1 内部模型分组

v2.2-A.1 后处理费用建议以模型文件为准，文档中给出的参考值如下：

| 内部分组 | 参考费用 RMB/pc | 说明 |
|---|---:|---|
| 去毛刺 | 0.0 | 基准项 |
| 钝化 | 0.0 | frozen |
| 镀锌 | 0.0 | 当前数据下估计为 0 |
| 发黑 | 2.4 | 已单独拆分 |
| 阳极氧化 | 6.1 | 常见表面处理 |
| 镭雕 | 12.2 | mapping 已修复 |
| 喷砂抛光 | 16.9 | 模型中仍可作为合并组 |
| 电解抛光 | 24.3 | 较旧版显著提高 |
| 热处理 | 88.9 | 较旧版显著提高 |
| 镀镍 | 0.0 | frozen |
| 其他电镀 | 0.0 | frozen |
| 其他后处理 | 0.0 | frozen |

### 5.2 公开选项英文化

前端不得显示中文内部分组，也不得显示 RMB 价格。公开选项建议为：

| public id | 前端显示 | 内部映射 |
|---|---|---|
| `none` | No Finish / As Machined | 去毛刺 或 未标注 |
| `deburring` | Deburring | 去毛刺 |
| `anodizing` | Anodizing | 阳极氧化 |
| `black_oxide` | Black Oxide | 发黑 |
| `zinc_plating` | Zinc Plating | 镀锌 |
| `nickel_plating` | Nickel Plating | 镀镍 |
| `other_plating` | Other Plating / Coating | 其他电镀 |
| `passivation` | Passivation | 钝化 |
| `laser_marking` | Laser Marking | 镭雕 |
| `bead_blasting` | Bead Blasting | 喷砂抛光 |
| `polishing` | Polishing | 喷砂抛光 |
| `electropolishing` | Electropolishing | 电解抛光 |
| `heat_treatment` | Heat Treatment | 热处理 |
| `other` | Other Finish | 其他后处理 |

这里有一个细节：你之前已经提出 Bead Blasting 和 Polishing 要分开，这是正确的前端体验。但 v2.2-A.1 的训练分组中仍然是 `喷砂抛光` 合并组，所以短期内可以“前端分开，后端映射到同一模型组”。这比前端继续合并更自然，也不会伪造不存在的独立参数。

---

## 6. 材料选择器修改指导

### 6.1 数据源

前端材料选择器只读取：

```text
material_public_options.json
```

不要让前端直接读取：

- `material_prices.csv`
- `material_price_bridge.csv`
- `material_price_manual.csv`
- `materials.csv`
- 任何包含采购价格、密度、成本来源的文件

### 6.2 推荐数据结构

```json
{
  "version": "v2.2-A.1",
  "categories": [
    {
      "id": "aluminum",
      "label": "Aluminum Alloys",
      "materials": [
        {
          "id": "al7075",
          "label": "Aluminum 7075",
          "aliases": ["7075", "Al 7075"],
          "confidence": "high"
        }
      ]
    }
  ]
}
```

公开 JSON 可以有 `confidence`，但不要在 UI 上直接显示“direct/bridge/manual/legacy”。`confidence` 主要给前端决定排序和是否隐藏低可信材料。

### 6.3 分类建议

初始分类建议：

```text
Aluminum Alloys
Stainless Steels
Carbon & Alloy Steels
Copper & Brass
Plastics
High-Performance Plastics
Titanium Alloys
Other Materials
```

如果某一类内部材料很多，排序建议：

1. 常用材料优先。
2. 真实价格 direct/bridge 材料优先。
3. manual 材料其次。
4. legacy fallback 默认隐藏。

### 6.4 去重规则

之前出现过 `High-Performance Plastic` 里多个一模一样的 `PEEK alloy`。这类问题在 v2.2-A.1 生成公开材料表时必须处理。

去重规则：

1. 前端显示名完全相同，且价格源/密度无可公开区分时，只保留一个。
2. 如果确实是不同牌号，显示名必须有可理解差异，例如：
   - `PEEK`
   - `PEEK GF30`
   - `PEEK CA30`
3. 如果内部有区别但不适合公开解释，则合并为一个公开材料，后端映射到默认代表材料。

不要把内部“采购行差异”直接暴露成多个前端选项。客户只关心能不能估价，不关心材料表里有几条采购记录。

---

## 7. 前端 UI/UX 修改指导

这里按商业报价工具的体验来设计：用户需要快速建立“我选中了什么、系统能估算、结果可信但不是正式报价”的感受。

### 7.1 页面结构

左侧表单建议分成两个视觉模块：

```text
Part Requirements
  STEP upload
  Material category + grade
  Process
  General tolerance
  Surface finish
  Quantity

Contact
  Your name optional
  Email optional
```

邮箱和昵称放在底部，避免“产品信息、个人信息、产品信息”来回跳。客户填写时会更顺。

### 7.2 材料二级菜单

左侧大类和右侧材料建议使用清晰的 selected 状态，但不要叠加太多视觉效果。

推荐：

- 大类选中：左侧使用浅底色 + 左边 3px accent bar。
- 材料选中：右侧使用蓝色边框 + 轻微背景色。
- 不再额外显示单独的 `Selected` badge，除非当前视觉反馈仍然不够明显。
- 如果左侧分类数量不多，不要固定高度制造滚动条。
- 搜索框必须受控稳定，输入每个字符不能失焦。

搜索失焦通常由这几类原因造成：

1. 每次输入都重建整个 picker DOM。
2. 搜索框所在组件的 `key` 随搜索值变化。
3. render 函数里重新绑定外层 `innerHTML`，导致 input 节点被替换。

修复原则：

```text
搜索框节点保持不变，只更新材料列表区域。
```

如果当前是原生 JS，建议把 `renderMaterialOptions()` 拆成：

```text
renderMaterialShellOnce()
updateMaterialCategoryList()
updateMaterialGradeList()
```

不要在 `input` 事件里重绘包含搜索框本身的父容器。

### 7.3 后处理选项

前端显示英文，不显示内部价格：

```text
No Finish / As Machined
Anodizing
Black Oxide
Zinc Plating
Nickel Plating
Passivation
Bead Blasting
Polishing
Electropolishing
Heat Treatment
Laser Marking
Other Finish
```

选项顺序建议按客户认知频率排序，不按内部费用高低排序。

### 7.4 结果展示

结果区域继续保持第一次计算前也有占位，例如：

```text
Estimated Unit Price
$0.00

Estimated Total
$0.00
```

计算后展示一个收窄后的估价，而不是过宽区间。如果当前需求是“收窄区间后取一个随机估价”，建议后端保存稳定随机种子，避免同一个文件刷新一次价格大幅变化。

推荐策略：

```text
estimate_center = deterministic_model_price
display_price = center * deterministic_jitter(file_hash + material + qty)
jitter_range = +/- 1.5% 到 3%
```

这样客户感觉报价不是死板模板，但同一个上传文件和同一套输入在短期内不会乱跳。

公开结果不要展示：

- `Model v2.2`
- `Material term`
- `Setup allocation`
- `Machining base`
- `Postprocess`
- `Data source`
- `price_rmb_per_kg`
- `density`
- `safety_multiplier`

建议文案：

```text
This estimate is for early cost evaluation. Final pricing may vary based on material grade, tolerances, finishing requirements, inspection needs, and lead time. For an exact quote, contact our engineers for a fast formal review.
```

---

## 8. API 契约建议

### 8.1 Options 接口

`GET /api/quote/options` 推荐返回：

```json
{
  "ok": true,
  "model": "instant_quote",
  "materials": {
    "version": "v2.2-A.1",
    "categories": []
  },
  "processes": [],
  "postprocesses": [],
  "tolerances": []
}
```

不要返回采购价、密度、材料来源、内部中文分组名。

### 8.2 Calculate 接口请求

```json
{
  "file_id": "uploaded-step-id",
  "material_id": "al7075",
  "process": "cnc_machining",
  "general_tolerance": "iso_2768_m",
  "postprocess": "anodizing",
  "quantity": 100,
  "customer_name": "optional",
  "customer_email": "optional",
  "currency": "USD"
}
```

### 8.3 Calculate 接口公开响应

```json
{
  "ok": true,
  "currency": "USD",
  "unit_estimate": 12.35,
  "total_estimate": 1235.00,
  "display": {
    "material": "Aluminum 7075",
    "process": "CNC Machining",
    "finish": "Anodizing",
    "quantity": 100
  },
  "message": "This estimate is for early cost evaluation..."
}
```

公开响应不要包含：

```text
model_version
material_price_source
material_cost
setup_allocation
machining_base
postprocess_fee
formula_terms
source_file
```

这些可以进入数据库的内部字段，但不能进入浏览器。

---

## 9. 数据库记录建议

报价记录需要兼顾商业黑盒和内部追溯。

公开给客户的字段：

- 上传文件名
- 材料显示名
- 工艺显示名
- 公差等级
- 后处理显示名
- 数量
- 币种
- 单价估算
- 总价估算

内部记录建议放入 `input_params` 或 `result_json`：

```json
{
  "pricing_model_version": "v2.2-A.1_material_price_bridge",
  "material_id": "al7075",
  "material_public_label": "Aluminum 7075",
  "material_price_source": "bridge",
  "material_confidence": "high",
  "process_group": "CNC",
  "postprocess_group": "阳极氧化",
  "safety_multiplier": 1.0
}
```

用户填写的昵称和邮箱：

- `customer_name` 可选。
- `customer_email` 可选。
- 如果为空，不阻塞计算。
- 如果填写，应随报价记录保存。
- 后续批量上传时，同一次 batch 可共用联系人信息。

---

## 10. WordPress 插件同步

本地页面改完后，同步到插件：

```text
daiyujin-tools/
  templates/quote.php
  assets/js/quote.js
  assets/css/quote.css
```

同步重点：

1. `quote.php` 的 DOM 结构与本地 `quote.html` 保持一致。
2. `quote.js` 的 API base、options hydrate、calculate payload 保持一致。
3. `quote.css` 的 material picker、selected 状态、contact section 保持一致。
4. 插件 zip 里不要打包上传文件、缓存文件、数据库文件、UsedPrd、static/uploads。

打包前检查：

```powershell
rg -n "Material term|Setup allocation|Machining base|price_rmb|density|v2\.1|1\.25" daiyujin-tools
```

---

## 11. 验收用例

### 11.1 静态检查

```powershell
cd D:\myfirstgithubcode\daiyujinweb
python -B -m py_compile backend\services\quote_calculator_v2.py backend\services\pricing.py backend\app.py
rg -n "1\.25|v2\.1_additive|Material term|Setup allocation|Machining base|price_rmb_per_kg|density_g_cm3" backend js templates daiyujin-tools
```

预期：

- Python 编译通过。
- 旧模型标识不应出现在有效公开路径。
- 内部价格字段不应出现在前端和公开模板。

### 11.2 Options 接口检查

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/quote/options | ConvertTo-Json -Depth 8
```

预期：

- 有材料分类和细分材料。
- High-Performance Plastics 中没有多个完全相同的 `PEEK alloy`。
- 后处理显示英文。
- 不包含 RMB 单价、密度、采购价来源。

### 11.3 计算接口检查

至少覆盖这些材料路径：

| 用例 | 目的 |
|---|---|
| AISI304 / SUS304 | 验证 bridge |
| Aluminum 7075 | 验证铝合金主路径 |
| PEEK | 验证高性能塑料 |
| Heat Treatment | 验证高费用后处理生效 |
| Black Oxide | 验证新增后处理分组 |
| Zinc Plating / Nickel Plating | 验证电镀拆分 |

每个用例检查：

1. 接口返回 `ok: true`。
2. 单价和总价为正数。
3. 前端展示不含内部明细。
4. 数据库中有对应记录。
5. 数据库记录里的 `pricing_model_version` 为 v2.2-A.1。

### 11.4 数据库检查

如果使用 SQLite：

```powershell
python - <<'PY'
import sqlite3, json
conn = sqlite3.connect("backend/app.db")
conn.row_factory = sqlite3.Row
rows = conn.execute("""
select id, customer_name, customer_email, input_params, result_json, created_at
from inquiries
order by id desc
limit 5
""").fetchall()
for r in rows:
    print(dict(r))
PY
```

检查点：

- 昵称、邮箱如果填写，应保存。
- `material_id` 与前端选择一致。
- `unit_estimate`、`total_estimate` 与前端显示一致。
- 内部字段可保存，但不应被公开响应展示。

---

## 12. 推荐推进阶段

### Phase A：差异审计

目标：确认当前代码和 v2.2-A.1 差在哪里。

动作：

1. 搜索旧模型、旧安全系数、内部明细泄露。
2. 核对 `backend/data/quote_model_v2_2/` 是否已有最新文件。
3. 核对 `quote_calculator_v2.py` 是否读取 `coefficients_v2_2_A.json`。
4. 核对 WordPress 插件是否与本地页面一致。

交付：

```text
AUDIT-Quote-v2.2-A1-Gaps.md
```

### Phase B：数据同步与公开材料表生成

目标：把 `D:\报价系统` 的 v2.2-A.1 数据稳定同步到项目。

动作：

1. 新增或更新 `sync_quote_model_v2_2.py`。
2. 新增或更新 `build_quote_material_public_options.py`。
3. 生成 `material_public_options.json`。
4. 生成 `material_quality_report.md`。

验收：

- 文件完整。
- safety multiplier 为 1.00。
- 公开材料无重复显示名。
- 不公开 legacy fallback 低可信材料，或明确内部标记。

### Phase C：后端报价引擎更新

目标：让 API 计算路径真正使用 v2.2-A.1。

动作：

1. 更新模型版本。
2. 统一读取 coefficients 文件。
3. 使用 material direct / bridge / manual / legacy fallback 查找顺序。
4. 更新 postprocess public id 到内部组的映射。
5. 保存内部追溯字段到 DB。
6. 公开响应剥离所有内部明细。

验收：

- 典型材料计算成功。
- 后处理变化能影响价格。
- DB 记录可追溯。
- API 响应仍是商业黑盒。

### Phase D：前端材料与后处理 UI 更新

目标：让客户选择更自然，且不暴露内部参数。

动作：

1. 材料二级菜单读取新 public options。
2. 修复搜索框输入失焦。
3. 去掉多余 selected badge。
4. 移除左侧不必要滚动条。
5. 后处理英文化并拆分电镀项。
6. Contact 模块放到底部，昵称和邮箱均可选。

验收：

- 搜索连续输入不卡、不失焦。
- 材料选择反馈明确。
- 后处理无中文、无价格。
- 结果区无内部明细。

### Phase E：WordPress 同步与线上验证

目标：确保公司官网插件与本地版本一致。

动作：

1. 同步 `quote.js`、`quote.css`、`quote.php`。
2. 重新打包插件 zip。
3. 上传 WordPress 后清缓存。
4. 重启本地 API。
5. 通过 Cloudflare Tunnel 访问线上页面测试。

验收：

- 线上 Quote 页面 API Ready。
- 上传 STEP 后能计算。
- 材料和后处理选项正确。
- 结果无内部明细。
- DB 有记录。

---

## 13. 风险与取舍

### 13.1 MAPE 轻微变差不是失败

v2.2-A.1 的 MAPE 从旧版约 46.0% 到约 49.1%，表面上略差。但它的结构更真实：

- log Pearson r 从 0.933 提升到 0.945。
- 系统性低估从 -15.4% 缩小到 -7.4%。
- 安全系数从 1.25 移除。
- 材料成本不再依赖内部估算。

这意味着系统从“靠安全垫兜住”变成“材料项更贴近真实采购”。短期内对商业报价更健康。

### 13.2 不要把内部可信度直接展示给客户

客户看到 `legacy_fallback`、`bridge`、`manual` 之类字段不会更信任系统，反而会觉得系统不稳定。内部要记录，前端要隐藏。

### 13.3 不要为了显得精确而输出过多小数

即使后端计算到很多小数，前端也建议：

- 单价：保留 2 位小数。
- 总价：保留 2 位小数或按金额大小适当取整。
- 文案强调这是 early cost evaluation。

### 13.4 真实材料价格需要版本化

`材料价格.xlsx` 未来会变化。建议在同步时记录：

```text
material_price_version
material_price_updated_at
source_file_hash
```

这样以后客户拿历史报价来问时，可以知道当时使用的是哪一版材料价格。

---

## 14. 最小完成标准

做到以下几点，就可以认为 v2.2-A.1 前后端更新完成：

1. 后端使用 `coefficients_v2_2_A.json` 和 `material_prices.csv`。
2. 报价公式仍是 v2.2 加法模型，安全系数为 `1.00`。
3. 材料选择器来自 `material_public_options.json`，无重复、无价格泄露。
4. 后处理选项英文化，并包含 Black Oxide、Zinc Plating、Nickel Plating、Other Plating / Coating。
5. Bead Blasting 和 Polishing 前端分开，后端短期可映射到同一 `喷砂抛光` 模型组。
6. 公开结果不展示模型、明细、数据源、RMB 成本。
7. 昵称和邮箱可选，填写后写入数据库。
8. 本地页面和 WordPress 插件表现一致。
9. 至少 6 个典型报价用例通过。
10. 线上 Cloudflare Tunnel 页面可正常完成上传、预览、计算、保存记录。

