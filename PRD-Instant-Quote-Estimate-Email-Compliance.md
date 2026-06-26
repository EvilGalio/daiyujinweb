# PRD: Instant Quote 估价收窄、容差因子、邮箱触达与水印预览迭代

Status: Draft for review  
Owner: Daiyujin Web / Instant Quote  
Date: 2026-06-26  
Scope: `quote.html`, `js/quote.js`, `backend/services/quote_calculator_v2.py`, `backend/models.py`, WordPress plugin `daiyujin-tools/templates/quote.php`, `daiyujin-tools/assets/js/quote.js`

## 1. 背景

当前 Instant Quote v2.1 已经完成材料大类、黑盒展示、区间估价和 WordPress 插件同步。现在的问题集中在四个层面：

1. 客户侧价格区间太宽。大部分真实价格落在区间内，但区间过宽会削弱报价的决策价值，甲方认为这种展示不够严谨。
2. 公差选项缺少价格区分度。调参阶段为了稳定模型，公差没有明显影响，但客户会自然认为 `ISO 2768-C / M / F` 应反映不同制造难度。
3. 材料大类体验更好，但大类内部材料价格差异仍然明显。短期没有细分材料价格表，暂时只做二级菜单的产品与技术规划。
4. 报价表单开始承担询盘入口功能，需要增加邮箱收集、保密说明、合规提示、邮件内容设计和 STEP 预览水印的可行性路线。

本次迭代目标是让客户看到更像商业报价系统的结果，同时继续保护后台参数、公式、RMB 成本、样本量和模型版本。

## 2. 核心判断

### 2.1 价格展示从宽区间改为点估价

客户更容易把一个过宽区间理解为“系统没有把握”。短期建议前端显示一个点估价：

```text
Estimated Unit Price
USD 24.80 / pc

Estimated Total
USD 248.00
```

后台仍保留内部收窄区间和随机种子，方便复盘、A/B 测试、售后解释和后续模型校准。

### 2.2 点估价不能完全随机

如果每次点击都产生明显不同价格，客户会觉得系统不可靠。推荐做“稳定随机”：

1. 后台先计算 v2.1 基准价。
2. 按材料大类、工艺、后处理、数量、样本风险生成一个收窄区间。
3. 在收窄区间内用稳定种子取一个随机估价。
4. 同一份文件、同一组参数、同一天内返回同一个点估价。
5. 参数变化或跨日期时可重新生成。

稳定种子的建议输入：

```text
file_id + material_category + process + postprocess_group + tolerance_grade + quantity + currency + yyyy-mm-dd
```

这样既有“动态评估”的感觉，又避免客户刷新页面后看到价格跳动。

### 2.3 公差因子应作用于制造难度，不应粗暴乘总价

公差主要影响加工时间、检验难度、返工风险和工程确认成本。短期 v2.1 模型没有独立的检验项，因此建议先把公差因子作用在 `machining_term`，必要时叠加一个很小的工程风险项，不直接乘材料成本和后处理费用。

第一版参数按用户要求固定为：

| Public grade | Label | Factor | Applied to |
|---|---|---:|---|
| `ISO2768-C` | ISO 2768-c, Coarse | `1.00` | machining term |
| `ISO2768-M` | ISO 2768-m, Medium | `1.05` | machining term |
| `ISO2768-F` | ISO 2768-f, Fine | `1.20` | machining term |

默认值建议为 `ISO2768-M`。如果担心报价整体上浮，可以把默认值设为 `ISO2768-C`，但商业观感上 `Medium` 更接近常规询盘语义。

## 3. 本轮目标

### 3.1 必做

1. 将客户侧展示从 `Estimated Range` 改为 `Estimated Price` 或 `Reference Estimate`。
2. 后台生成收窄后的内部区间，并从区间中取一个稳定随机估价。
3. `unit_estimate` 和 `total_estimate` 返回给 public API。
4. `unit_range` 和 `total_range` 默认不在前端展示。是否保留在 public response 由实现阶段确认，推荐短期保留字段但前端不显示，后续再收紧 API。
5. 新增 `ISO 2768-C / M / F` 公差选项，并按 `1.00 / 1.05 / 1.20` 计算。
6. 将 `Bead Blasting / Polishing` 拆成两个公开选项。
7. 在 `Calculate Estimate` 按钮下增加保密与合规提示小字。
8. PRD 明确邮箱必填、报价邮件、mailto fallback、自动邮件发送的技术路线。
9. PRD 明确 STEP 预览水印的可行性和技术路线。
10. WordPress 插件与静态页面保持同等体验。

### 3.2 暂不实现，只做规划

1. 材料二级菜单。
2. 具体材料价格表。
3. 真正的材料级报价系数。
4. 邮件退订系统。报价邮件属于本次询价的交易或关系型邮件，不应混入营销邮件。
5. 用户账户系统。
6. 在线 NDA 签署。
7. 原始 STEP 文件水印改写。只处理预览图，不改原始客户文件。

## 4. 价格算法设计

### 4.1 当前状态

当前 `backend/services/quote_calculator_v2.py` 先计算：

```text
raw_unit_price =
  material_term
  + setup_term
  + machining_term
  + postprocess_fee

suggested_unit = raw_unit_price * SAFETY_MULTIPLIER
```

再按材料大类的 `range_multiplier` 生成一个较宽区间。这个宽区间适合早期“不要报死价格”，但甲方当前希望结果更有报价意义。

### 4.2 新算法输出结构

内部结果建议增加：

```json
{
  "unit_estimate": {
    "amount": 24.80,
    "amount_rmb": 178.56,
    "currency": "USD",
    "display": "USD 24.80 / pc"
  },
  "total_estimate": {
    "amount": 248.00,
    "amount_rmb": 1785.60,
    "currency": "USD",
    "display": "USD 248.00"
  },
  "estimate_band": {
    "unit_min_rmb": 171.40,
    "unit_max_rmb": 184.20,
    "total_min_rmb": 1714.00,
    "total_max_rmb": 1842.00,
    "band_policy": "tight_v1",
    "random_seed": "sha256..."
  }
}
```

public response 只返回客户需要看到的内容：

```json
{
  "quote_status": "estimated",
  "unit_estimate": {
    "display": "USD 24.80 / pc"
  },
  "total_estimate": {
    "display": "USD 248.00"
  },
  "valid_until": "2026-07-03",
  "review_note": "For an exact material grade, tolerance, surface finish, and lead time, contact our engineers for a fast formal quote."
}
```

### 4.3 收窄区间策略

推荐第一版不要把区间收得过窄。系统仍然是粗报价，不是 ERP 正式报价。建议使用“风险档位区间”：

| Risk level | Condition | Unit band |
|---|---|---|
| Low | 常规材料、CNC、Deburring、数量小于 500 | `-4%` to `+6%` |
| Medium | 常规材料但含 Anodizing、Passivation、Turning、Mill-Turn 或数量大于等于 500 | `-5%` to `+8%` |
| High | Specialty Metal、High-Performance Plastic、Sheet Metal、Heat Treatment、Plating / Coating | `-6%` to `+12%` |

前端不展示该区间。它只用于生成点估价。

### 4.4 稳定随机估价

建议实现函数：

```python
def _stable_estimate_in_band(base_rmb: float, low_pct: float, high_pct: float, seed_parts: list[str]) -> tuple[float, dict]:
    ...
```

逻辑：

1. `low = base_rmb * (1 + low_pct)`
2. `high = base_rmb * (1 + high_pct)`
3. 使用 `hashlib.sha256("|".join(seed_parts).encode("utf-8")).hexdigest()`
4. 将 hash 前 16 位转成 `[0, 1)` 的浮点数。
5. `estimate = low + random_ratio * (high - low)`
6. 走现有 `_commercial_round()` 或新增 `_commercial_round_public_estimate()`。

注意事项：

1. 随机只用于展示估价，不改变内部基准价。
2. `total_estimate = unit_estimate * quantity`，避免单价和总价互相不一致。
3. 如果商业取整导致 `unit_estimate` 变成 0，需要设置最低展示单位，例如 `USD 1.00`。
4. 种子中包含日期可以让估价每日更新。若希望报价有效期内稳定，则种子中使用 `valid_until` 或报价批次号。

### 4.5 公差因子接入

当前公式：

```python
machining_term = machining_base * DIFFICULTY_FACTOR
```

改为：

```python
tolerance_factor = _tolerance_factor(tolerance_grade)
machining_term = machining_base * DIFFICULTY_FACTOR * tolerance_factor
```

新增：

```python
_TOLERANCE_OPTIONS = [
    {"grade": "ISO2768-C", "label": "ISO 2768-c (Coarse)", "factor": 1.00},
    {"grade": "ISO2768-M", "label": "ISO 2768-m (Medium)", "factor": 1.05},
    {"grade": "ISO2768-F", "label": "ISO 2768-f (Fine)", "factor": 1.20},
]
```

public option 不返回 `factor`，避免泄露参数：

```json
{
  "tolerance_grades": [
    {"grade": "ISO2768-C", "label": "ISO 2768-c (Coarse)"},
    {"grade": "ISO2768-M", "label": "ISO 2768-m (Medium)"},
    {"grade": "ISO2768-F", "label": "ISO 2768-f (Fine)"}
  ]
}
```

兼容旧值：

| Old value | New mapping |
|---|---|
| `GENERAL` | `ISO2768-M` |
| empty | `ISO2768-M` |

## 5. Postprocess 拆分

### 5.1 问题

当前公开选项 `Bead Blasting / Polishing` 把两个常见后处理混在一起。客户会认为这是一个组合工艺，容易产生误解。

### 5.2 方案

公开选项拆成：

| Public id | Public label | Internal mapping for v1 |
|---|---|---|
| `bead_blasting` | Bead Blasting | `喷砂抛光` |
| `polishing` | Polishing | `喷砂抛光` |

短期没有独立价格表，可以先映射到同一个内部组。public response 展示客户选择的公开 label，不展示内部组。

### 5.3 后续数据升级

等后处理数据更细以后，再拆成：

1. `postprocess_public_options.json`
2. `postprocess_price_rules.csv`
3. `postprocess_aliases.csv`

第一版只需要在 `quote_calculator_v2.py` 增加 public option 与 internal group 的映射即可。

## 6. 前端改造

### 6.1 表单字段

当前字段保持：

1. STEP file
2. Material Category
3. Process
4. General Tolerance
5. Postprocess
6. Quantity
7. Currency

新增：

1. Email Address，必填。

建议位置：

1. 放在 Quantity / Currency 之前，或放在 Calculate Estimate 之前。
2. label 使用 `Email Address`。
3. placeholder 使用 `name@company.com`。
4. input 类型使用 `email`。
5. 设置 `required`。
6. autocomplete 使用 `email`。

HTML 示例：

```html
<label for="quote_email">Email Address</label>
<input id="quote_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email" required>
```

### 6.2 按钮下方保密与合规提示

推荐英文文案：

```text
By submitting this form, you confirm that you are authorized to share the uploaded file and contact details. We use this information only to generate and follow up on your manufacturing estimate, and we treat uploaded drawings and quote data as confidential business information.
```

如果要更短：

```text
Uploaded files and contact details are used only for estimate generation and engineering follow-up. We treat drawings and quote data as confidential business information.
```

不建议写：

```text
100% secure
Fully GDPR compliant
Guaranteed confidential
```

原因是这些表达会引入过强的法律承诺，除非公司已经有完整隐私政策、DPA、数据保留制度、访问审计和删除流程。

### 6.3 结果卡片

旧结构：

```text
Estimated Range
USD 240 - 360
Unit Range
USD 24 - 36 / pc
```

新结构：

```text
Reference Estimate
USD 248.00

Unit Estimate
USD 24.80 / pc

Valid until
2026-07-03
```

建议结果卡片保留：

1. Material Category
2. Process
3. Postprocess
4. General Tolerance
5. Quantity
6. Valid until
7. Review note
8. Request Formal Quote

继续隐藏：

1. model version
2. RMB
3. coefficients
4. material representative id
5. line-item cost
6. low sample warning 原文
7. internal estimate band

### 6.4 免责声明文案

报价结果下方推荐：

```text
This estimate is for early cost evaluation and is not a formal commercial offer. Final pricing depends on exact material grade, drawing requirements, tolerance, surface finish, lead time, and engineering review.
```

CTA 推荐：

```text
For an exact material grade, tolerance, surface finish, and lead time, contact our engineers for a fast formal quote.
```

### 6.5 mailto 按钮

当前 `Request Formal Quote` 已经是 mailto。需要把用户已填写和估价结果带入邮件正文。

前端生成：

```text
Subject:
Formal Quote Request - {part_name or stp_filename}

Body:
Hello Daiyujin Engineering Team,

I would like to request a formal quote for the part below.

Part: ...
Material Category: ...
Process: ...
Postprocess: ...
Tolerance: ...
Quantity: ...
Reference Estimate: ...
Unit Estimate: ...

Please review the exact material grade, tolerance, surface finish, lead time, and manufacturability.
```

mailto 的作用是让客户主动联系工程师。它不能替代自动发送给客户的报价副本。

## 7. 报价邮件设计

### 7.1 先定义两种邮件能力

| Capability | Description | Recommended phase |
|---|---|---|
| mailto formal quote | 客户点击按钮，给 Daiyujin 发邮件 | Phase 1 |
| transactional estimate email | 客户计算后，系统自动给客户发估价副本 | Phase 2 or 3 |

短期如果公司还没有 SMTP、企业邮箱 API 或 WordPress 邮件配置，先做 mailto 强化。自动发送需要后端邮件服务，不能只靠前端实现。

### 7.2 自动邮件触发时机

当用户点击 `Calculate Estimate` 且后端计算成功后：

1. 后端保存 Inquiry。
2. 后端生成 public quote result。
3. 后端调用邮件服务发送估价副本。
4. API 返回 `email_delivery` 状态。

public response 示例：

```json
{
  "email_delivery": {
    "status": "queued",
    "to": "name@company.com"
  }
}
```

如果邮件失败，估价仍应展示成功。邮件失败不应让报价计算失败：

```json
{
  "email_delivery": {
    "status": "failed",
    "message": "Estimate generated, but email delivery failed. Please use Request Formal Quote."
  }
}
```

### 7.3 邮件内容

Subject:

```text
Your Daiyujin Manufacturing Estimate - {part_name or stp_filename}
```

Plain text body:

```text
Hello,

Thank you for using Daiyujin Instant Quote.

Reference Estimate
Total: USD 248.00
Unit: USD 24.80 / pc
Quantity: 10
Valid Until: 2026-07-03

Submitted Configuration
Part: bracket.step
Material Category: Aluminum Alloy
Process: CNC Machining
Postprocess: Anodizing
General Tolerance: ISO 2768-m (Medium)

Important Notice
This estimate is for early cost evaluation and is not a formal commercial offer. Final pricing depends on exact material grade, drawing requirements, tolerance, surface finish, lead time, and engineering review.

For an exact material grade, tolerance, surface finish, and lead time, contact our engineers for a fast formal quote.

Daiyujin Precision Manufacturing
```

HTML 邮件可以后续再做。第一版建议同时发送 plain text 与简单 HTML，避免企业邮箱把复杂 HTML 判为垃圾邮件。

### 7.4 邮件服务实现

新增文件：

```text
backend/services/email_service.py
```

环境变量：

```text
QUOTE_EMAIL_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
QUOTE_EMAIL_FROM=quote@company.com
QUOTE_EMAIL_REPLY_TO=sales@company.com
```

接口：

```python
def send_quote_estimate_email(customer_email: str, public_quote: dict) -> dict:
    ...
```

返回：

```python
{"status": "sent", "message_id": "..."}
{"status": "disabled"}
{"status": "failed", "error": "..."}
```

### 7.5 数据库字段

当前 `Inquiry` 模型需要检查是否已有邮箱字段。若没有，建议新增：

```text
customer_email
email_sent_at
email_status
email_error
quote_public_snapshot_json
```

注意：

1. `customer_email` 是个人数据。
2. `quote_public_snapshot_json` 只保存客户可见数据，不保存公式、系数、RMB 内部明细。
3. 邮件错误信息需要截断，避免数据库存入过长 SMTP 错误。

## 8. 合规与保密原则

### 8.1 官方参考

本 PRD 只给产品与工程建议，不替代法律意见。实现时建议参考：

1. FTC CAN-SPAM Act compliance guide  
   <https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business>
2. European Commission GDPR, what is personal data  
   <https://commission.europa.eu/law/law-topic/data-protection/reform/what-personal-data_en>
3. California Attorney General CCPA overview  
   <https://oag.ca.gov/privacy/ccpa>

### 8.2 产品侧原则

1. 最小收集。报价阶段只收邮箱，不收电话、地址、公司规模等非必要信息。
2. 限定用途。说明邮箱用于生成估价、发送估价副本和工程跟进。
3. 保密处理。说明上传图纸和报价数据按商业保密信息处理。
4. 不在报价邮件中加入营销订阅内容。
5. 不把原始 STEP 文件附在自动邮件中。
6. 后台日志不要记录完整邮箱和文件名组合，必要时做脱敏。
7. 后续若接入正式隐私政策，应在表单说明中链接 `Privacy Policy`。

### 8.3 建议表单文案

最终推荐版本：

```text
By submitting this form, you confirm that you are authorized to share the uploaded file and contact details. We use this information only to generate and follow up on your manufacturing estimate, and we treat uploaded drawings and quote data as confidential business information.
```

如果页面空间紧张：

```text
Files and contact details are used only for estimate generation and engineering follow-up. Uploaded drawings and quote data are treated as confidential business information.
```

## 9. STEP 预览水印可行性

### 9.1 结论

可以做。推荐只给解析出来的预览图片加水印，不修改客户上传的原始 `.stp` / `.step` 文件。

### 9.2 两种路线

| Route | Description | Security | Effort | Recommendation |
|---|---|---:|---:|---|
| Frontend overlay | 在图片或 canvas 上叠一层半透明文字 | Low | Low | 只适合演示 |
| Server-side watermark | 后端生成 PNG/JPG 后用 Pillow 写入水印 | Medium | Medium | 推荐 |

前端 overlay 容易被浏览器开发者工具移除，更多是视觉提醒。后端水印会固化在预览图像素里，更适合商业场景。

### 9.3 技术路线

新增或修改 STEP 预览生成链路：

```text
STEP file -> geometry parser -> preview image -> watermark post-process -> public preview URL
```

如果当前已经生成预览 PNG：

1. 找到生成预览图的服务文件，可能在 STEP analyzer 或上传解析服务中。
2. 在保存 PNG 后调用 `apply_preview_watermark(image_path, file_id)`。
3. 使用 Pillow 打开图片。
4. 在中间或右下角写入半透明文字。
5. 保存为同一路径或 `*_watermarked.png`。

水印文本建议：

```text
Daiyujin Preview
Reference Only
{short_file_id}
```

视觉要求：

1. 透明度 12% 到 18%。
2. 不遮挡主要几何轮廓。
3. 斜向重复水印适合安全，右下角单点水印适合美观。
4. 第一版建议单点水印，避免影响客户查看零件。

### 9.4 验收标准

1. 上传 STEP 后预览图仍能正常显示。
2. 预览图出现水印。
3. 原始 STEP 文件未被修改。
4. 下载或打开预览图片时水印仍存在。
5. 小尺寸移动端预览不被水印完全覆盖。

## 10. 材料二级菜单规划

### 10.1 当前问题

大类材料降低了选择压力，但 `Aluminum Alloy` 内部的 6061、6082、7075 等价格和加工风险存在差异。长期看，只选大类会限制估价精度。

### 10.2 暂不实现原因

1. 当前没有专门的材料价格表。
2. v2.1 的材料数据来自既有参数包，材料级价格未必适合直接公开。
3. 如果先做细分材料而没有价格校准，客户会误以为具体牌号报价已经可靠。

### 10.3 后续产品方案

左侧选择大类，右侧选择细分材料：

```text
Material Category             Material Grade
[ Aluminum Alloy      ]       [ 6061-T6             ]
[ Stainless Steel     ]       [ 6082                ]
[ Engineering Plastic ]       [ 7075                ]
                               [ Not sure / Engineer review ]
```

默认右侧选择：

```text
Not sure / Use common grade
```

如果客户不知道牌号，也能继续计算。

### 10.4 后端数据结构

未来新增：

```json
{
  "material_categories": [
    {
      "id": "aluminum_alloy",
      "label": "Aluminum Alloy",
      "materials": [
        {"id": "al_6061", "label": "Aluminum 6061", "public": true},
        {"id": "al_7075", "label": "Aluminum 7075", "public": true}
      ]
    }
  ]
}
```

短期只在 PRD 中规划，不改现有 material category 逻辑。

## 11. 文件级实施指导

### 11.1 Backend

`backend/services/quote_calculator_v2.py`

1. 新增 `_TOLERANCE_FACTORS`。
2. 新增 `_normalize_tolerance_grade()`。
3. 新增 `_estimate_band_policy()`。
4. 新增 `_stable_estimate_in_band()`。
5. 修改 `machining_term`，接入 tolerance factor。
6. 修改 `get_quote_options_v2()`，返回 `ISO2768-C / M / F`。
7. 修改 postprocess public options，拆分 Bead Blasting 与 Polishing。
8. 修改 `public_quote_response()`，返回 `unit_estimate` 和 `total_estimate`。
9. 保留内部 `formula` 和 `estimate_band`，不要放进 public response。

`backend/services/pricing.py`

1. 确认 facade 不破坏新字段。
2. 如果 Inquiry 保存逻辑读取旧 `unit_range`，同步改为读取 `unit_estimate`。

`backend/models.py`

1. 检查 `Inquiry` 是否已有 email 字段。
2. 新增邮件与 public snapshot 字段。
3. 如果当前项目没有迁移框架，更新 `init_db.py` 或新增轻量 migration script。

`backend/services/email_service.py`

1. 新增 SMTP 邮件服务。
2. 支持 disabled 模式。
3. 捕获异常并返回结构化状态。

STEP preview service

1. 找到当前预览图生成位置。
2. 新增 Pillow 水印后处理。
3. 如果当前未生成预览图，本轮只做技术预留，不强行实现。

### 11.2 Frontend

`quote.html`

1. 新增 `customer_email` input。
2. 在按钮下新增合规提示。
3. 保持整体表单密度，不要把说明写成大段营销文案。

`js/quote.js`

1. payload 增加 `customer_email`。
2. 客户端做邮箱基本校验。
3. 结果卡片从 range 改为 estimate。
4. `Request Formal Quote` mailto 带入参数。
5. 如 API 返回 `email_delivery`，在结果卡片底部轻提示：

```text
A copy of this estimate has been sent to name@company.com.
```

如果邮件失败：

```text
Estimate generated. Email delivery is temporarily unavailable, please use Request Formal Quote.
```

`daiyujin-tools/templates/quote.php`

1. 同步 `quote.html` 的表单改动。

`daiyujin-tools/assets/js/quote.js`

1. 同步 `js/quote.js` 的逻辑。

### 11.3 CSS

如果当前样式不足，新增：

```css
.quote-privacy-note
.quote-email-status
.quote-estimate-value
```

视觉原则：

1. 合规提示字体小一号，颜色用 muted gray。
2. 估价数字比普通结果更醒目，但不要像促销价格。
3. 邮件状态用轻量文本，不要弹窗打断流程。

## 12. 实施阶段

### Phase Q1: 价格点估价与公差因子

目标：

1. 后端生成稳定随机点估价。
2. 前端展示单价与总价点估价。
3. 公差选项接入计算。

验收：

1. 同一参数同一天重复计算，估价一致。
2. 改变数量、材料、工艺、后处理、公差任一项，估价可能变化。
3. `ISO2768-F` 的价格高于 `ISO2768-M`，`ISO2768-M` 高于或等于 `ISO2768-C`。
4. public response 不包含 formula、RMB breakdown、model version。
5. 单价乘数量与总价一致，允许商业取整误差不超过 1 个最小展示单位。

### Phase Q2: Postprocess 拆分与前端文案

目标：

1. Bead Blasting 与 Polishing 分开显示。
2. 结果卡片显示客户选择的公开后处理 label。
3. 按钮下新增保密与合规提示。

验收：

1. 下拉框中有 `Bead Blasting`。
2. 下拉框中有 `Polishing`。
3. 页面不出现 `Bead Blasting / Polishing`。
4. 页面不出现中文后处理选项。
5. 页面不出现 CNY、RMB、内部费用或模型版本。

### Phase Q3: 邮箱必填与 mailto 增强

目标：

1. 表单新增必填邮箱。
2. Calculate Estimate payload 包含 `customer_email`。
3. Request Formal Quote mailto 带入报价内容。

验收：

1. 空邮箱无法提交。
2. 非法邮箱给出浏览器或自定义校验提示。
3. 邮箱不会显示在公开页面的显眼位置，只在邮件状态中脱敏或轻提示。
4. mailto subject 和 body 包含 part、material、process、postprocess、tolerance、quantity、estimate。

### Phase Q4: 自动估价邮件

目标：

1. 后端接入 SMTP。
2. 计算成功后发送估价副本给客户。
3. 邮件失败不影响页面估价展示。

验收：

1. `QUOTE_EMAIL_ENABLED=false` 时系统正常计算，返回 disabled 状态。
2. SMTP 配置正确时能收到邮件。
3. 邮件内容不包含内部公式、RMB 成本、模型版本、系数和样本量。
4. 邮件包含 disclaimer 与 formal quote CTA。
5. 邮件发送异常有日志，但 API 不返回敏感 SMTP 凭据。

### Phase Q5: STEP 预览水印

目标：

1. 给 STEP 解析预览图加水印。
2. 不修改原始 STEP 文件。

验收：

1. 预览图显示水印。
2. 原始 STEP 文件 hash 不变。
3. 预览图在桌面和移动端可读。
4. 水印不遮挡主要几何识别。

### Phase Later: 材料二级菜单

目标：

1. 等材料价格表或材料系数表稳定后再实现。
2. 采用左大类、右牌号的二级选择。
3. 提供 `Not sure / Use common grade`。

验收：

1. 没有选择具体牌号时仍可报价。
2. 选择具体牌号会进入材料级计算。
3. public response 不泄露材料内部价格。

## 13. 测试计划

### 13.1 后端测试

新增或更新 `backend/scripts/test_quote_v2.py`：

1. 验证 options 包含 `ISO2768-C / M / F`。
2. 验证 public postprocess options 包含 `Bead Blasting` 和 `Polishing`。
3. 验证同一 payload 重复计算点估价一致。
4. 验证 `ISO2768-F > ISO2768-M >= ISO2768-C`。
5. 验证 public response 不包含 `formula`、`breakdown`、`pricing_model_version`。
6. 验证 email disabled 模式不影响报价。

### 13.2 前端测试

1. 打开 `quote.html`。
2. 空邮箱提交应失败。
3. 合法邮箱可以提交。
4. 结果标题显示 `Reference Estimate`。
5. 页面无 `Estimated Range`。
6. 页面无中文 postprocess。
7. Request Formal Quote 打开邮件客户端时 subject/body 已填充。

### 13.3 WordPress 插件测试

1. 插件模板存在邮箱字段。
2. 插件 JS 与静态页面行为一致。
3. shortcode 页面不显示内部价格明细。
4. Cloudflare Tunnel 公网访问时 API 正常。

### 13.4 邮件测试

1. disabled 模式。
2. SMTP 成功模式。
3. SMTP 密码错误模式。
4. 收件人非法邮箱模式。
5. 邮件正文内容检查。

## 14. 风险与缓解

| Risk | Impact | Mitigation |
|---|---|---|
| 点估价被客户理解为正式报价 | 商业风险 | 明确显示 Reference Estimate 和 disclaimer |
| 稳定随机导致同一零件每日轻微变化 | 客户疑惑 | 把日期种子改为报价有效期种子或 file_id 种子 |
| 公差因子抬高价格过多 | 转化率下降 | 只作用于 machining term，不乘总价 |
| 邮箱收集引入隐私义务 | 合规风险 | 最小收集、限定用途、隐私链接、日志脱敏 |
| 自动邮件进入垃圾箱 | 客户收不到 | 使用企业域名 SMTP、plain text 版本、正确 From / Reply-To |
| 水印遮挡几何 | 客户体验下降 | 低透明度、右下角水印、保留原始预览尺寸 |
| 材料二级菜单没有价格数据 | 报价误导 | 放入 later phase，等价格表后再做 |

## 15. 发布前检查清单

1. 后端测试通过。
2. 前端静态页面手动验收通过。
3. WordPress 插件文件同步。
4. public API 不返回内部公式、CNY 明细、模型版本。
5. 报价邮件不含敏感内部参数。
6. 合规提示文案已由甲方确认。
7. Cloudflare Tunnel 下实际访问测试通过。
8. 回滚方案明确：保留旧 range 字段，必要时前端可快速回退展示。

## 16. 推荐实施顺序

建议先做 Phase Q1 和 Q2。它们直接解决甲方最关心的报价严谨感和选项专业度，而且不依赖外部 SMTP。

第二步做 Phase Q3。邮箱必填与 mailto 增强可以提升询盘质量，工程风险较低。

第三步做 Phase Q4。自动邮件需要公司邮箱、SMTP、域名发信信誉和隐私文案确认，适合在前面体验稳定后接入。

第四步做 Phase Q5。水印是安全与专业感增强项，依赖当前 STEP 预览链路是否已经生成图片。

材料二级菜单放在材料价格表完成之后。否则界面看起来更专业，但报价精度没有真实提升。
