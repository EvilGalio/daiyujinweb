# Instant Quote 材料大类与区间报价优化指导书

状态：Draft for implementation  
适用范围：`quote.html`、`js/quote.js`、`css/plugins.css`、`backend/services/quote_calculator_v2.py`、`backend/services/pricing.py`、WordPress 插件内 `templates/quote.php` 和 `assets/js/quote.js`  
核心目标：把 Instant Quote 从“精确计算器”进一步调整为“低摩擦询盘入口”。客户看到材料大类和报价区间，后台保留精确计算与询盘记录。

## 1. 背景与判断

当前材料下拉框直接展示 v2.1 参数包中的 42 个材料牌号。它对工程师友好，对首次访问客户偏重。

粗报价场景中，客户主要想判断：

1. 这个零件大概多少钱。
2. 这家公司能否加工。
3. 是否值得继续发邮件获取正式报价。

客户第一次进入页面时，大多没有必要在 `Al 6061`、`Al 6082`、`AlMgSi1`、`Al 7075` 之间做选择。材料细分更适合工程师复核阶段处理。

同行参考：

1. Protolabs Network / Hubs 在 CNC 页面把材料先组织成 `Metals` / `Plastics`，再列出 Aluminum、Stainless steel、Mild steel、Brass、Copper、Titanium 等材料类别，并强调上传 CAD、确认规格、获得报价的流程。
2. Xometry CNC 页面也按 Aluminum alloys、Copper alloys、Bronze alloys、Brass alloys、Stainless Steel alloys 等方式组织材料信息。
3. Protolabs 的公开 FAQ 说明 CNC 价格受材料、复杂度、数量、交期影响，精确价格应提交 3D CAD 并获得交互报价与 DFM 反馈。

参考来源：

- Protolabs Network CNC machining: <https://www.hubs.com/cnc-machining/>
- Xometry CNC machining service: <https://www.xometry.com/capabilities/cnc-machining-service/>
- Protolabs CNC machining: <https://www.protolabs.com/services/cnc-machining/>

## 2. 本轮范围

本轮要做：

1. 材料选择从 42 个具体牌号改为少量材料大类。
2. 每个材料大类映射到一个内部代表材料，用 v2.1 公式继续计算。
3. 客户侧价格从精确值改为区间值。
4. 单价和总价都展示区间。
5. 文案提示客户可通过现有 `Request Formal Quote` mailto 获取精确快速报价。
6. public API 避免向浏览器返回精确底价和内部代表材料细节。
7. WordPress 插件同步同样体验。

本轮暂不做：

1. 不新增新的询盘流程。
2. 不新增“找不到材料”单独入口。
3. 不改变现有 `Request Formal Quote` mailto 机制。
4. 不让客户选择具体材料牌号。
5. 不展示材料大类背后的代表材料。
6. 不展示报价模型版本、公式、RMB 明细、内部倍率、样本数。

## 3. 产品原则

### 3.1 客户看到的是范围

客户侧应看到：

```text
Estimated Range
USD 240 - 360

Unit Range
USD 24 - 36 / pc
```

客户侧不显示：

```text
USD 237.42
USD 356.13
Exact model output
v2.1_additive
RMB basis
```

报价区间给客户一个心理缓冲。精确数字很容易被客户理解成正式承诺，区间更接近“参考估价”的真实语义。

### 3.2 后台保留精确值

内部仍然可以计算精确值，用于：

1. 生成区间。
2. Inquiry 记录。
3. 后续模型校准。
4. 销售和工程师复盘。

但 public response 默认只返回区间，不返回 exact price。

### 3.3 材料大类承担“选择入口”

材料大类不是材料学定义的完整分类表，而是报价入口。它要降低客户选择压力，让客户能继续走完整个上传和询盘流程。

## 4. 材料大类设计

当前 v2.1 `materials.csv` 中有 42 个材料。建议前端只展示 7 个大类。

| Public label | Internal key | Representative material | 当前数据覆盖 | 前端说明 |
|---|---|---|---|---|
| Aluminum Alloy | `aluminum_alloy` | `Al 6061` | Al 6061, Al 6082, AlMgSi1, Al 7075, AlMg4_5Mn, Al 6060 | Lightweight, common for CNC prototypes |
| Stainless Steel | `stainless_steel` | `AISI 304` | AISI 303, 304, 316, 316L, 420, 420F, 1.4112, 1.4031, 1.4057 | Corrosion-resistant steel parts |
| Carbon / Alloy Steel | `carbon_alloy_steel` | `42CrMo` | 16MnCr5, 42CrMo, C45, C40, S235JR, AISI 1020, AISI 1018, S355J2, DC01, SCM435, S50C | Strong mechanical parts |
| Brass / Copper | `brass_copper` | `Brass MS58` | Brass MS58, E-Cu CW004A, Tin Bronze | Conductive or decorative metal parts |
| Engineering Plastic | `engineering_plastic` | `POM` | POM, Nylon | Lightweight plastic machining |
| High-Performance Plastic | `high_performance_plastic` | `PEEK` | PEEK, PTFE | High-temperature or chemical-resistant plastic |
| Specialty Metal | `specialty_metal` | `Titanium Gr5` | Titanium Gr5, Titanium Gr1, Hastelloy C-276, Tungsten Carbide | Specialty metal, engineering review recommended |

### 4.1 默认排序

推荐排序：

1. Aluminum Alloy
2. Stainless Steel
3. Carbon / Alloy Steel
4. Engineering Plastic
5. Brass / Copper
6. High-Performance Plastic
7. Specialty Metal

默认选中：

```text
Aluminum Alloy
```

原因：铝合金是 CNC 询价中最常见、客户理解成本最低、报价结果也通常更容易接受的入口。

### 4.2 前端展示形态

优先使用卡片式单选，取代长下拉框。

```text
[ Aluminum Alloy       ]
  Lightweight, common for CNC prototypes

[ Stainless Steel      ]
  Corrosion-resistant steel parts

[ Engineering Plastic  ]
  Lightweight plastic machining
```

如果暂时不想改 HTML 结构，可先使用 `<select>`，但 option 必须是英文大类：

```html
<option value="aluminum_alloy">Aluminum Alloy</option>
<option value="stainless_steel">Stainless Steel</option>
<option value="carbon_alloy_steel">Carbon / Alloy Steel</option>
```

### 4.3 不展示具体材料

前端不显示：

```text
Representative material: Al 6061
Mapped to AISI 304
Using POM as benchmark
```

这些属于内部报价口径。客户只需要看到材料大类。

## 5. 后端材料大类配置

推荐新增配置文件：

```text
backend/data/quote_model_v2_1/material_categories.json
```

示例：

```json
{
  "aluminum_alloy": {
    "label": "Aluminum Alloy",
    "description": "Lightweight, common for CNC prototypes",
    "representative_material_id": "Al 6061",
    "public": true,
    "range_multiplier": 1.45
  },
  "stainless_steel": {
    "label": "Stainless Steel",
    "description": "Corrosion-resistant steel parts",
    "representative_material_id": "AISI 304",
    "public": true,
    "range_multiplier": 1.50
  },
  "carbon_alloy_steel": {
    "label": "Carbon / Alloy Steel",
    "description": "Strong mechanical parts",
    "representative_material_id": "42CrMo",
    "public": true,
    "range_multiplier": 1.55
  },
  "brass_copper": {
    "label": "Brass / Copper",
    "description": "Conductive or decorative metal parts",
    "representative_material_id": "Brass MS58",
    "public": true,
    "range_multiplier": 1.65
  },
  "engineering_plastic": {
    "label": "Engineering Plastic",
    "description": "Lightweight plastic machining",
    "representative_material_id": "POM",
    "public": true,
    "range_multiplier": 1.50
  },
  "high_performance_plastic": {
    "label": "High-Performance Plastic",
    "description": "High-temperature or chemical-resistant plastic",
    "representative_material_id": "PEEK",
    "public": true,
    "range_multiplier": 1.80
  },
  "specialty_metal": {
    "label": "Specialty Metal",
    "description": "Titanium, nickel alloy, carbide and other specialty materials",
    "representative_material_id": "Titanium Gr5",
    "public": true,
    "range_multiplier": 2.00,
    "review_recommended": true
  }
}
```

### 5.1 API options

`GET /api/public/quote/options` 返回：

```json
{
  "material_categories": [
    {
      "id": "aluminum_alloy",
      "label": "Aluminum Alloy",
      "description": "Lightweight, common for CNC prototypes"
    }
  ]
}
```

Public response 不返回：

```text
representative_material_id
range_multiplier
material_price_rmb_per_kg
density_g_cm3
included_materials
```

### 5.2 Calculate request

前端 payload 改为：

```json
{
  "material_category": "aluminum_alloy",
  "process": "CNC",
  "postprocess_group": "去毛刺",
  "quantity": 100,
  "currency": "USD"
}
```

过渡期可兼容旧字段：

```text
material_id
```

优先级：

1. 如果 payload 有 `material_category`，按材料大类计算。
2. 如果只有 `material_id`，按旧具体材料计算，但 public response 仍展示大类或材料 label。
3. 正式上线后前端只传 `material_category`。

## 6. 区间报价算法

### 6.1 基础算法

先用 v2.1 公式得到内部精确值：

```text
exact_unit_price
exact_total_price
```

再生成 public range：

```text
range_min = nice_round(exact_price)
range_max = nice_round(exact_price * range_multiplier)
```

单价和总价都使用同一个倍率。

### 6.2 默认倍率

| 材料大类 | 默认倍率 |
|---|---:|
| Aluminum Alloy | 1.45 |
| Stainless Steel | 1.50 |
| Carbon / Alloy Steel | 1.55 |
| Engineering Plastic | 1.50 |
| Brass / Copper | 1.65 |
| High-Performance Plastic | 1.80 |
| Specialty Metal | 2.00 |

后处理和工艺可进一步增加区间宽度：

| 条件 | 额外倍率 |
|---|---:|
| `process = 板金` | +0.10 |
| `postprocess_group = 热处理` | +0.10 |
| `postprocess_group = 电镀涂层` | +0.10 |
| `postprocess_group = 其他后处理` | +0.20 |
| `quantity >= 501` | +0.05 |

最终倍率建议封顶：

```text
max_range_multiplier = 2.20
```

### 6.3 Round 规则

报价区间要像商业报价，不要像计算器输出。

推荐：

| 金额 | round step |
|---:|---:|
| `< 10` | `0.5` |
| `10 - 99` | `5` |
| `100 - 999` | `10` |
| `1,000 - 9,999` | `50` |
| `>= 10,000` | `100` |

示例：

```text
237.42 -> 240
356.13 -> 360
1,227.8 -> 1,250
1,841.7 -> 1,850
```

### 6.4 区间最小宽度

避免出现太窄的区间，例如 `USD 99 - 101`。

规则：

```text
range_max >= range_min * 1.25
```

如果 round 后不满足，强制扩大到 1.25 倍再 round。

## 7. Public Calculate Response

推荐返回：

```json
{
  "quote_status": "estimated_range",
  "valid_until": "2026-07-02",
  "currency": "USD",
  "selections": {
    "material_category": {
      "id": "aluminum_alloy",
      "label": "Aluminum Alloy"
    },
    "process": "CNC Machining",
    "postprocess_group": "Deburring",
    "quantity": 100,
    "tolerance_grade": "General Tolerance"
  },
  "unit_range": {
    "min": 24,
    "max": 36,
    "display": "USD 24 - 36 / pc"
  },
  "total_range": {
    "min": 2400,
    "max": 3600,
    "display": "USD 2,400 - 3,600"
  },
  "review_note": "For exact material grade, tolerance, surface finish, and lead time, contact our engineers for a fast formal quote."
}
```

Public response 不返回：

```text
unit_price
total
amount_rmb
formula
breakdown
exact_unit_price
exact_total_price
representative_material_id
range_multiplier
```

内部 Inquiry 可保存完整字段：

```json
{
  "exact_internal_result": {},
  "public_range_result": {},
  "material_category": "aluminum_alloy",
  "representative_material_id": "Al 6061"
}
```

## 8. 前端结果展示

### 8.1 Empty state

```text
Estimated Range
USD 0 - 0

Unit Range        USD 0 / pc
Status            Waiting for STEP file
Review            Engineering confirmation available
```

### 8.2 Result state

```text
Estimated Range
USD 2,400 - 3,600

Unit Range        USD 24 - 36 / pc
Quantity          100 pcs
Valid Until       2026-07-02
Status            Reference range

Material          Aluminum Alloy
Process           CNC Machining
Postprocess       Deburring
Tolerance         General Tolerance

For exact material grade, tolerance, surface finish, and lead time, contact our engineers for a fast formal quote.

[Request Formal Quote]
```

### 8.3 CTA 文案

保留现有 mailto 链接。只改文案和周边说明。

按钮：

```text
Request Formal Quote
```

按钮上方或下方：

```text
Need an exact price? Our engineers can confirm material grade, tolerance, finish, and lead time quickly.
```

## 9. 前端材料选择交互

### 9.1 推荐卡片式

HTML 结构示意：

```html
<div class="material-card-grid" data-material-category-list>
  <label class="material-card">
    <input type="radio" name="material_category" value="aluminum_alloy" checked>
    <span class="material-card-title">Aluminum Alloy</span>
    <span class="material-card-desc">Lightweight, common for CNC prototypes</span>
  </label>
</div>
```

样式要求：

1. 桌面端 2 列。
2. 移动端 1 列。
3. 选中态使用蓝色边框和很浅的蓝底。
4. 卡片高度稳定，文字不挤压布局。
5. 不使用复杂图标。

### 9.2 备选 select 方案

如果先做最小改动：

```html
<select id="material" name="material_category" data-material-category-select>
```

渲染：

```js
materialSelect.innerHTML = options.material_categories
  .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
  .join("");
```

## 10. 实施阶段

### Phase M0: 配置落地

1. 新增 `material_categories.json`。
2. 写入 7 个材料大类。
3. 为每个大类配置 `representative_material_id` 和 `range_multiplier`。
4. 后端启动时校验代表材料是否存在于 `materials.csv`。

验收：

```text
所有 representative_material_id 都能在 materials.csv 查到。
```

### Phase M1: 后端 options

1. `get_quote_options_v2()` 增加 `material_categories`。
2. public response 不再输出 42 个具体材料作为主入口。
3. 若保留 `materials` 字段，只用于兼容旧前端，并在后续移除。

验收：

```text
/api/public/quote/options 包含 material_categories。
material_categories 每项只有 id、label、description。
```

### Phase M2: 后端 calculate

1. `calculate_quote_v2()` 支持 `material_category`。
2. 内部映射到代表材料。
3. 继续调用 v2.1 精确公式。
4. 生成 `unit_range` 和 `total_range`。
5. public result 只返回 range。
6. Inquiry 保存 exact internal result。

验收：

```text
同一 payload 每次区间一致。
public response 不含 exact amount。
internal Inquiry 保存 exact result。
```

### Phase M3: 前端表单

1. Material 字段改为卡片式材料大类。
2. payload 从 `material_id` 改为 `material_category`。
3. Postprocess 保持英文 label。
4. 现有 mailto CTA 保留。

验收：

```text
前端看不到 Al 6061、AISI 304、42CrMo 等内部代表材料。
```

### Phase M4: 前端结果卡

1. 主标题改为 `Estimated Range`。
2. 总价展示区间。
3. 单价展示区间。
4. 删除精确单价和精确总价。
5. CTA 周边文案改为工程师精确快速报价。

验收：

```text
页面不出现精确价格格式。
页面不出现 amount_rmb、formula、breakdown、v2.1。
```

### Phase M5: WordPress 同步

同步：

```text
daiyujin-tools/templates/quote.php
daiyujin-tools/assets/js/quote.js
daiyujin-tools/assets/css/plugins.css
```

验收：

```powershell
Compare-Object (Get-Content js\quote.js) (Get-Content daiyujin-tools\assets\js\quote.js)
```

预期无输出。

### Phase M6: 测试

新增或更新：

```text
backend/scripts/test_quote_v2.py
```

覆盖：

1. options 返回材料大类。
2. material_category 可计算。
3. 区间 min/max 正确。
4. public response 不含 exact price。
5. representative material 不出现在 public response。
6. WordPress JS 同步。

## 11. 测试命令

后端测试：

```powershell
& 'D:\anaconda\python.exe' -B backend\scripts\test_quote_v2.py
```

前端语法：

```powershell
& 'C:\Users\14539\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check js\quote.js
& 'C:\Users\14539\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check daiyujin-tools\assets\js\quote.js
```

敏感字段扫描：

```powershell
Select-String -Path js\quote.js,daiyujin-tools\assets\js\quote.js -Pattern 'Al 6061|AISI 304|42CrMo|amount_rmb|formula|breakdown|v2.1|representative|range_multiplier'
```

Public API 扫描：

```powershell
& 'D:\anaconda\python.exe' -B backend\scripts\test_quote_v2.py
```

测试脚本内应断言 public response 不包含：

```text
formula
breakdown
exact_unit_price
exact_total_price
representative_material_id
range_multiplier
amount_rmb
```

## 12. 文案建议

Hero subtitle:

```text
Upload a STEP file and receive a reference manufacturing range. Our engineers can confirm exact pricing and lead time quickly.
```

Material label:

```text
Material Category
```

Result title:

```text
Estimated Range
```

Result note:

```text
This range is for early cost evaluation. Exact pricing depends on material grade, tolerance, finish, and lead time.
```

CTA helper:

```text
Need an exact price? Contact our engineers for a fast formal quote.
```

CTA:

```text
Request Formal Quote
```

## 13. 验收标准

上线前必须满足：

1. 材料主选择项不超过 7 个。
2. 客户侧材料项全部为英文大类。
3. 客户侧不出现具体代表材料。
4. 客户侧展示 `Estimated Range`。
5. 单价和总价都为区间。
6. 区间数值经过商业化 round。
7. public response 不含 exact price。
8. public response 不含 `formula`、`breakdown`、`amount_rmb`。
9. 现有 `Request Formal Quote` mailto 保留。
10. CTA 周边文案明确可联系工程师获取精确快速报价。
11. 主站与 WordPress 插件体验一致。
12. 后端测试、前端语法检查、敏感字段扫描全部通过。
