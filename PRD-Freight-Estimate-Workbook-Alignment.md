# PRD: Freight Estimate 按 DHL/FedEx Excel 逻辑升级

> 版本：v0.2  
> 日期：2026-06-24  
> 输入依据：`D重量运费.xlsx`、`DHL_FedEx运费计算逻辑说明.md`、当前 `freight.html` / `js/freight.js` / `backend/services/freight.py` / `backend/services/freight_importer.py`

## 1. 结论

当前 Freight Estimate 与 `D重量运费.xlsx` 的完整业务逻辑存在明显差距。

当前系统已经完成了一个可运行的 MVP：从 `区域运费DHL` 和 `区域运费FedEX` 两张国家展开矩阵中导入小货价格，并按「国家 + 承运商 + 重量档」返回报价。

但 Excel 的实际使用习惯更简单：核心输入只有目的国家/地区和货物质量。`体积公式` 是辅助工作表，当前 Excel 并没有把长宽高、体积重、箱数作为正式报价主输入。因此系统升级时，第一版页面应继续保持低摩擦输入：国家 + 货物质量 + 承运商，尺寸/体积只作为高级可选项。

另一个必须补上的现实因素是燃油/基建类附加费。FedEx 官方页面明确说明燃油附加费会按周调整，国际件燃油费可按百分比生效，并且部分场景会基于净运费及适用附加费计算。DHL/FedEx 这类附加费都不适合写死在代码里，应进入配置层和报价明细层。

本 PRD 的目标是把 Freight Estimate 从“小货矩阵查价器”升级为“以 Excel 规则为基础、默认 USD 展示、可解释附加费的 DHL/FedEx 运费估算器”。

## 2. 已验证事实

### 2.1 工作簿结构

`D重量运费.xlsx` 包含以下关键工作表：

| 工作表 | 作用 |
|---|---|
| `区域运费DHL` | DHL 国家/地区展开价目表，0.5kg 到 30kg |
| `区域运费FedEX` | FedEx 国家/地区展开价目表，0.5kg 到 20.5kg 左右 |
| `2KG内文件` | DHL 2kg 内文件价 |
| `广诚DHL运费` | DHL 基础价格、外币换算、重货区 |
| `广诚FedEx运费` | FedEx 基础价格、代码表、附加调整、重货区 |
| `体积公式` | 体积辅助计算，不是主报价入口 |
| `物流询价2` | 毛重、数量、总重等询价辅助计算 |

### 2.2 当前导入器覆盖范围

当前 `backend/services/freight_importer.py` 只导入 `区域运费DHL` 和 `区域运费FedEX` 两张矩阵表。

抽样验证结果：

```text
record_count: 9628
country_count: 233
carriers: DHL, FedEx
min_weight_kg: 0.5
max_weight_kg: 30.0
```

这个结果说明当前数据覆盖了小货矩阵，但没有覆盖：

| 逻辑 | 当前是否支持 |
|---|---|
| DHL 小货查价 | 支持 |
| FedEx 小货查价 | 支持 |
| DHL 文件价 | 未支持 |
| DHL 重货每 kg 单价 | 未支持 |
| FedEx 重货每 kg 单价 | 未支持 |
| 包装重量修正 | 未支持 |
| 体积重量高级估算 | 未支持 |
| FedEx 附加调整配置化 | 未支持 |
| DHL 表内加成/汇率配置化 | 未支持 |
| 燃油/基建附加费 | 未支持 |
| 报价解释链路 | 仅部分支持 |

### 2.3 Excel 公式证据

`物流询价2` 中存在重量辅助公式：

```excel
M2 = K2 * L2
R2 = I2 * F2
R13 = SUM(R2:R12)
```

DHL 重货试算区存在包装重量规则：

```excel
IF(C<=33,"",IF(C<=70,C+7.5,IF(C<=300,C+12.5,C*1.0822)))
```

FedEx 重货试算区存在包装重量规则：

```excel
IF(C<=21.9,"",IF(C<=40,C+4,IF(C<=70,C+7.5,IF(C<=300,C+12.5,C*1.0822))))
```

DHL 基础表存在外币换算和加成公式：

```excel
USD = RMB * 1.2 / 6.5 * 1.2
EUR = RMB * 1.2 / 7 * 1.2
```

FedEx 基础表存在特定区域附加公式：

```excel
AA4 = J4 + A4 * 11.2
```

这些证据支持 `DHL_FedEx运费计算逻辑说明.md` 的主要判断。

### 2.4 外部附加费事实

燃油附加费属于承运商动态费用，不能视为 Excel 固定矩阵的一部分。

已查证的官方口径：

| 来源 | 事实 |
|---|---|
| FedEx 官方 Fuel Surcharge 页面 | 燃油附加费会按周调整 |
| FedEx 官方 Fuel Surcharge 页面 | 2026-06-22 生效的国际燃油表中 Export & Import 使用百分比栏 |
| FedEx 官方 Fuel Surcharge 页面 | 相关燃油费在部分服务中基于净运费及适用附加费计算，规则可能变动 |

DHL 的具体百分比本 PRD 不写死。系统只预留 DHL/FedEx 通用的 surcharge 配置能力，由运营或后台 seed 数据维护。

## 3. 产品目标

### 3.1 用户目标

用户在 Freight Estimate 页面输入目的国家、货物质量、承运商和展示币种后，可以得到一个有解释的 DHL/FedEx 估算报价。

默认展示币种为 USD。

页面需要让用户看懂：

| 问题 | 页面应回答 |
|---|---|
| 为什么这个重量被计费 | 展示输入质量、命中重量档、必要时展示包装修正重量 |
| 为什么走小货或重货 | 展示承运商门槛和命中的价格模式 |
| 为什么 DHL/FedEx 价格不同 | 展示分区/代码、价格来源和重量段 |
| 为什么总价高于基础运费 | 展示燃油费、基建费、汇率、加成、附加调整 |
| 有没有使用体积 | 默认不使用；只有用户展开高级尺寸并输入完整尺寸时才使用 |

### 3.2 系统目标

把运费逻辑拆成四层：

1. 输入层：目的地、承运商、货物类型、货物质量、展示币种。尺寸和箱数为高级可选输入。
2. 派生层：重量档、重货段、包装修正重量。体积重量只在高级尺寸输入完整时派生。
3. 费率层：小货矩阵、文件矩阵、重货单价、汇率规则、燃油/基建附加费配置。
4. 输出层：基础运费、附加费明细、总价、命中规则、来源表、解释链路。

## 4. 非目标

本阶段不追求以下能力：

| 非目标 | 原因 |
|---|---|
| 做成正式物流下单系统 | 当前页面定位仍是 estimate |
| 自动同步 DHL/FedEx 官方实时价格 | 当前依据是内部 Excel，外部附加费先由配置维护 |
| 覆盖关税、偏远费、保险费 | Excel 当前未提供完整统一规则 |
| 后台可视化维护全部费率 | 先通过脚本导入和配置文件稳定算法 |
| 完全复刻 Excel 每一个手工试算单元格 | Excel 本身含试算区和缓存公式，系统应抽象稳定规则 |
| 把尺寸/体积变成必填项 | Excel 当前主流程只输入质量和国家，页面应尊重这个业务习惯 |

## 5. 现有实现差距

### 5.1 后端计算差距

当前 `calculate_freight()` 的输入：

```text
country
weight_kg
carriers
currency
```

当前计算逻辑：

```text
1. 按国家匹配 FreightRate。
2. 对每个 carrier 查找 weight_min >= input weight 的第一条价格。
3. 使用 exchange_rates 做币种转换。
4. 返回原币金额、展示币种金额、zone、source。
```

缺失：

| 缺失项 | 对报价的影响 |
|---|---|
| `cargo_type` | 无法区分文件和包裹 |
| 重货门槛 | DHL >30kg、FedEx >20.5/21.9kg 无法正确报价 |
| 包装重量 | 重货价格会偏低 |
| 每 kg 单价 | 重货无法按单价乘重量 |
| 燃油/基建附加费 | 总价会系统性偏低 |
| 附加费明细 | 用户无法知道基础运费和附加费各是多少 |
| 高级尺寸/体积 | 泡货场景仍可能低估，但不应成为默认主流程 |
| 规则解释 | 用户无法判断结果为何产生 |

### 5.2 前端页面差距

当前 `freight.html` 只收集：

```text
Destination
Weight
Carrier
Display Currency
```

需要改造为：

| 字段 | 类型 | 默认值 | 第一版状态 |
|---|---|---|---|
| Destination | searchable input | 空 | 主输入 |
| Cargo Weight | number | 5kg | 主输入 |
| Carrier | checkbox | DHL + FedEx | 主输入 |
| Cargo Type | segmented control | Package | 主输入 |
| Display Currency | select | USD | 主输入 |
| Length / Width / Height | number group | 空 | Advanced，可折叠 |
| Box Count | number | 1 | Advanced，可折叠 |
| Volumetric Divisor | hidden/config display | 5000 或 6000 | Advanced，仅展示 |

结果卡片需要新增：

| 展示项 | 示例 |
|---|---|
| Pricing Mode | Small parcel / Heavy cargo / Document |
| Base Freight | USD 120.00 |
| Fuel Surcharge | USD 42.00 |
| Infrastructure Surcharge | USD 5.00 |
| Estimated Total | USD 167.00 |
| Cargo Weight | 5.0kg |
| Charge Weight | 5.0kg |
| Volumetric Weight | 仅高级尺寸启用时展示 |
| Packaging Adjusted Weight | 仅重货时展示 |
| Zone / Code | DHL 5区 / FedEx U |
| Rate Source | 区域运费DHL row 128 / 广诚FedEx运费 heavy table |
| Explanation | `weight -> matrix lookup -> surcharge -> currency conversion` |

## 6. 目标算法

### 6.1 输入

API 请求建议升级为低摩擦主输入：

```json
{
  "country": "Germany",
  "carriers": ["DHL", "FedEx"],
  "cargo_type": "package",
  "actual_weight_kg": 5,
  "currency": "USD"
}
```

高级尺寸输入可选：

```json
{
  "country": "Germany",
  "carriers": ["DHL", "FedEx"],
  "cargo_type": "package",
  "actual_weight_kg": 5,
  "currency": "USD",
  "advanced": {
    "boxes": 1,
    "dimensions": {
      "length_cm": 30,
      "width_cm": 20,
      "height_cm": 15
    }
  }
}
```

兼容旧请求：

```json
{
  "country": "Germany",
  "weight_kg": 5,
  "carriers": ["DHL", "FedEx"],
  "currency": "USD"
}
```

旧请求进入兼容路径：

```text
actual_weight_kg = weight_kg
boxes = 1
cargo_type = package
dimensions = null
currency = USD if missing
```

### 6.2 重量基础

默认路径完全按 Excel 的主输入习惯执行：

```text
billable_base_weight = actual_weight_kg
```

只有当用户在 Advanced 中提供完整长宽高时，才计算体积重量：

```text
volumetric_weight_kg = length_cm * width_cm * height_cm * boxes / divisor
billable_base_weight = max(actual_weight_kg, volumetric_weight_kg)
```

`divisor` 建议先配置为 5000，后续可以按 carrier 或 channel 独立设置。

如果尺寸只填一部分：

```text
返回 validation error，不进入报价
```

### 6.3 小货重量档

小货按矩阵表头向上匹配。

```text
DHL: 0.5kg 到 30kg
FedEx: 0.5kg 到 20.5kg
```

例：

```text
5.1kg -> 5.5kg
8.01kg -> 8.5kg
```

### 6.4 文件价

仅 DHL 支持文件价。

```text
if cargo_type == document and carrier == DHL and billable_base_weight <= 2:
    使用 2KG内文件
```

文件价同样按重量向上匹配到：

```text
0.5 / 1 / 1.5 / 2
```

### 6.5 DHL 重货

适用条件：

```text
carrier == DHL
billable_base_weight > 30
```

包装重量：

```text
if weight <= 33:
    不走重货
elif weight <= 70:
    adjusted_weight = weight + 7.5
elif weight <= 300:
    adjusted_weight = weight + 12.5
else:
    adjusted_weight = weight * 1.0822
```

重量段：

```text
30.1-70
70.1-300
300.1-99999
```

基础运费：

```text
base_freight = unit_price * adjusted_weight
```

### 6.6 FedEx 重货

适用条件：

```text
carrier == FedEx
billable_base_weight > 20.5
```

包装重量：

```text
if weight <= 21.9:
    不走重货
elif weight <= 40:
    adjusted_weight = weight + 4
elif weight <= 70:
    adjusted_weight = weight + 7.5
elif weight <= 300:
    adjusted_weight = weight + 12.5
else:
    adjusted_weight = weight * 1.0822
```

重量段：

```text
21-44
45-70
71-99
100-299
300-499
500-999
1000-9999
```

基础运费：

```text
base_freight = unit_price * adjusted_weight
```

### 6.7 燃油/基建附加费

附加费在基础运费之后计算，并作为独立 line item 返回。

第一版支持三种计算方式：

```text
percentage: amount = base * rate
fixed: amount = fixed_amount
per_kg: amount = charge_weight * rate
```

默认计算顺序：

```text
1. base_freight = 小货固定价 或 重货单价 * 修正重量
2. fuel_surcharge = 按 carrier 配置计算
3. infrastructure_surcharge = 按 carrier 配置计算
4. subtotal = base_freight + fuel_surcharge + infrastructure_surcharge
5. converted_total = subtotal 转换到 display currency
```

第一版建议：

```text
燃油附加费和基建费默认配置为 0，但数据结构、API 输出和前端展示先做好。
如果已有公司内部百分比，写入 seed_data.py。
FedEx 官方百分比可作为运营参考，但不要硬编码进代码。
```

### 6.8 币种和加成

短期策略：

1. 默认展示币种为 USD。
2. 数据库仍保存源表币种，当前 Excel 导入价格以 CNY 为主。
3. API 输出同时返回源币种金额和 USD 展示金额。
4. DHL Excel 中 `1.2 / 6.5 / 7 / 6` 作为可配置参数记录，不在第一版强行替代当前汇率表。
5. FedEx `+8 / +11.2` 附加调整先随源表导入后的价格保存，同时记录规则来源。

中期策略：

把参数放入规则表：

```text
freight_rule_configs
freight_surcharge_configs
```

页面展示“估算参数版本”。

## 7. 数据模型设计

建议保留 `freight_rates` 表用于小货矩阵兼容，同时新增更明确的表。

### 7.1 `freight_zones`

保存国家到承运商分区/代码的映射。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| carrier | string | DHL / FedEx |
| country | string | 英文名 |
| country_cn | string | 中文名 |
| zone_code | string | DHL 数字区或 FedEx 代码 |
| source_sheet | string | 来源工作表 |
| source_row | int | 来源行 |

### 7.2 `freight_rate_cards`

统一保存固定价和每 kg 单价。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| carrier | string | DHL / FedEx |
| cargo_type | string | package / document |
| pricing_mode | string | small_matrix / heavy_per_kg / document |
| zone_code | string | 分区或代码 |
| weight_min | float | 重量下限 |
| weight_max | float | 重量上限 |
| charge_weight | float | 小货表头重量，可为空 |
| currency | string | 源表币种，通常为 CNY |
| price_type | string | fixed / per_kg |
| price | float | 固定价或每 kg 单价 |
| source_sheet | string | 来源工作表 |
| source_row | int | 来源行 |

### 7.3 `freight_rule_configs`

保存可调规则。

| 字段 | 类型 | 示例 |
|---|---|---|
| key | string | `dhl_heavy_threshold_kg` |
| value | string | `30` |
| value_type | string | number / json / string |
| description | string | 规则说明 |

第一批规则：

```text
default_display_currency = USD
volumetric_divisor_default = 5000
dhl_heavy_threshold_kg = 30
fedex_heavy_threshold_kg = 20.5
dhl_packaging_rules = json
fedex_packaging_rules = json
dhl_usd_fx_table = 6.5
dhl_usd_fx_trial = 6
dhl_eur_fx = 7
dhl_markup_1 = 1.2
dhl_markup_2 = 1.2
```

### 7.4 `freight_surcharge_configs`

保存燃油/基建等动态附加费。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| carrier | string | DHL / FedEx / all |
| surcharge_type | string | fuel / infrastructure / other |
| calculation_type | string | percentage / fixed / per_kg |
| rate | float | 百分比或每 kg 金额 |
| fixed_amount | float | 固定金额 |
| currency | string | 固定金额币种 |
| applies_to | string | base_freight / subtotal / charge_weight |
| effective_from | date | 生效日期 |
| effective_to | date | 失效日期，可空 |
| enabled | bool | 是否启用 |
| source_note | string | 来源说明 |

seed 默认：

```text
DHL fuel = 0%, disabled or enabled with 0
FedEx fuel = 0%, disabled or enabled with 0
DHL infrastructure = 0, disabled or enabled with 0
FedEx infrastructure = 0, disabled or enabled with 0
```

只要公司确认实际燃油/基建费率，就更新 seed 或后台配置，不改计算代码。

## 8. 导入器改造

### 8.1 当前导入器保留

保留当前矩阵导入能力，作为 small parcel 的基础。

需要补充：

| 改造点 | 说明 |
|---|---|
| `pricing_mode` | 小货统一标记为 `small_matrix` |
| `charge_weight` | 保存表头重量 |
| `zone_code` | 从国家行的代码列保存 |
| `source` | 保留工作表和行号 |

### 8.2 新增文件价导入

解析 `2KG内文件`：

```text
行：0.5 / 1 / 1.5 / 2
列：1区 到 9区
carrier = DHL
cargo_type = document
pricing_mode = document
price_type = fixed
```

### 8.3 新增重货单价导入

解析 `广诚DHL运费` 底部重货表：

```text
carrier = DHL
pricing_mode = heavy_per_kg
zone_code = 1..9
weight_min / weight_max = 重量段
price_type = per_kg
```

解析 `广诚FedEx运费` 重货表：

```text
carrier = FedEx
pricing_mode = heavy_per_kg
zone_code = FedEx 代码
weight_min / weight_max = 重量段
price_type = per_kg
```

### 8.4 生成导入报告

每次导入输出：

```text
small_matrix_count
document_rate_count
heavy_rate_count
zone_count
surcharge_config_count
warnings
```

警告包括：

| 警告 | 说明 |
|---|---|
| missing_weight_header | 表头重量无法识别 |
| duplicated_zone | 同一 carrier/country 多个 zone |
| blank_price | 价格为空 |
| unsupported_formula_region | 暂未解析的试算区 |
| missing_surcharge_config | 未找到承运商附加费配置，按 0 处理 |

## 9. 后端 API 设计

### 9.1 `/api/public/freight/calculate`

请求兼容旧版，新增字段见 6.1。

响应建议：

```json
{
  "country": "Germany",
  "currency": "USD",
  "inputs": {
    "actual_weight_kg": 5,
    "advanced_enabled": false,
    "boxes": 1,
    "dimensions": null
  },
  "results": [
    {
      "carrier": "DHL",
      "pricing_mode": "small_matrix",
      "zone": "5",
      "actual_weight_kg": 5,
      "volumetric_weight_kg": null,
      "billable_weight_kg": 5,
      "charge_weight_kg": 5,
      "packaging_adjusted_weight_kg": null,
      "unit_price": null,
      "base_freight": 100,
      "surcharges": [
        {
          "type": "fuel",
          "label": "Fuel surcharge",
          "amount": 0,
          "currency": "CNY",
          "rate": 0
        },
        {
          "type": "infrastructure",
          "label": "Infrastructure surcharge",
          "amount": 0,
          "currency": "CNY",
          "rate": 0
        }
      ],
      "subtotal": 100,
      "original_currency": "CNY",
      "converted_total": 13.8,
      "display_currency": "USD",
      "explanation": [
        "Actual cargo weight is used because advanced dimensions are not provided.",
        "DHL small matrix matched 5kg.",
        "Fuel and infrastructure surcharge configs are applied.",
        "Rate source: 区域运费DHL row 120."
      ],
      "source": {
        "sheet": "区域运费DHL",
        "row": 120
      }
    }
  ],
  "missing_carriers": []
}
```

### 9.2 `/api/public/freight/prototype`

扩展当前 summary：

```json
{
  "small_matrix_count": 9628,
  "document_rate_count": 36,
  "heavy_rate_count": 90,
  "zone_count": 466,
  "surcharge_config_count": 4,
  "default_display_currency": "USD",
  "carriers": ["DHL", "FedEx"],
  "supported_pricing_modes": ["small_matrix", "document", "heavy_per_kg"]
}
```

## 10. 前端 UX 设计

### 10.1 表单布局

保持当前页面的工具型布局，主流程只保留业务上真正常用的输入。

```text
Shipment
  Destination
  Cargo Weight
  Cargo Type: Package / Document
  Carrier
  Display Currency: USD by default

Advanced
  Enable dimensions
  Length
  Width
  Height
  Boxes
  Volumetric preview
```

Advanced 默认折叠。用户不展开时，系统完全按国家和货物质量报价。

### 10.2 结果卡片

每个 carrier 一张结果卡：

```text
DHL
Estimated Total: USD 167.00
Base Freight: USD 120.00
Fuel Surcharge: USD 42.00
Infrastructure Surcharge: USD 5.00
Mode: Heavy cargo
Zone: 5
Cargo weight: 36.0kg
Charge weight: 36.0kg
Packaging adjusted: 43.5kg
Unit price: USD 6.56/kg
Source: 广诚DHL运费, heavy table
```

如果 Advanced 未启用，不展示 Volumetric Weight。这样页面不会向客户暗示“体积是必填项”。

### 10.3 解释区

用短句展示计算路径：

```text
1. Actual cargo weight 36.0kg is used.
2. DHL exceeds 30kg, heavy cargo rule applied.
3. Packaging rule adds 7.5kg, adjusted weight is 43.5kg.
4. Zone 5 matched heavy tier 30.1-70.
5. Base freight = unit price * adjusted weight.
6. Fuel and infrastructure surcharge configs are applied.
7. Total is converted to USD.
```

### 10.4 错误状态

| 场景 | 文案 |
|---|---|
| 国家不存在 | `Destination is not supported yet.` |
| 文件价请求 FedEx | `Document rate is currently available for DHL only.` |
| 重量超出费率表 | `No rate table matched this weight.` |
| Advanced 尺寸不完整 | `Enter length, width, and height together, or turn off dimensions.` |
| 未勾选承运商 | `Select at least one carrier.` |
| 缺少附加费配置 | 不阻止报价，按 0 计算并在 source/debug 中记录 warning |

## 11. 实施阶段

### Phase F0: 黄金样例与回归框架

目标：先固定判断标准，再改系统。

任务：

1. 新建 `backend/scripts/inspect_freight_workbook.py`。
2. 输出工作簿结构、表头范围、关键公式位置。
3. 新建 `backend/scripts/test_freight_workbook_logic.py` 或脚本型 smoke test。
4. 固定至少 6 个 golden cases：
   - DHL Germany 5kg 小货，默认 USD 展示。
   - FedEx Germany 5kg 小货，默认 USD 展示。
   - DHL document 1.5kg，默认 USD 展示。
   - DHL 36kg 重货，验证包装重量。
   - FedEx 25kg 重货，验证包装重量。
   - 任一 carrier 的燃油/基建附加费配置，验证 line item 和 total。
5. 另设 1 个 advanced optional case：
   - 用户提供尺寸且体积重大于实重时，验证体积重路径。

验收：

```text
能从 Excel 抽取每个核心 golden case 的预期来源或预期计算路径。
默认币种为 USD。
Advanced 尺寸用例作为增强路径，不影响主流程。
现有小货用例仍通过。
```

### Phase F1: 数据模型和迁移

目标：数据库能表达文件价、重货单价和附加费。

任务：

1. 新增 `FreightZone`。
2. 新增 `FreightRateCard`。
3. 新增 `FreightRuleConfig`。
4. 新增 `FreightSurchargeConfig`。
5. 保留旧 `FreightRate`，避免页面立即断裂。
6. 更新 `init_db.py` 和 seed 脚本。
7. seed 默认展示币种为 USD。
8. seed 燃油/基建附加费为 0，或填入公司确认的实际费率。

验收：

```text
初始化数据库后，旧接口仍可返回当前小货报价。
新表存在，seed 后有基础规则配置和附加费配置。
默认 currency 缺省时返回 USD。
```

### Phase F2: Importer v2

目标：把 Excel 的三类费率导入数据库。

任务：

1. 抽象 parser：
   - `parse_small_matrix_rates()`
   - `parse_document_rates()`
   - `parse_heavy_rates()`
   - `parse_zone_mappings()`
2. 生成导入报告。
3. 对不可解析区域只输出 warning，不阻塞导入。
4. 更新 `backend/scripts/import_freight_rates.py`，支持 v1/v2 汇总。

验收：

```text
small_matrix_count >= 9628
document_rate_count == 36
heavy_rate_count > 0
zone_count >= 233 * 2 的有效映射规模
surcharge_config_count >= 4
```

### Phase F3: Calculation Engine v2

目标：后端能按目标算法报价。

任务：

1. 新建 `backend/services/freight_rules.py`：
   - 重量档向上匹配
   - 包装重量规则
   - 重货段匹配
   - 可选体积重量
2. 新建或扩展 `backend/services/freight_surcharges.py`：
   - percentage / fixed / per_kg 三种附加费
   - fuel / infrastructure 两类默认配置
   - 生效日期过滤
3. 改造 `backend/services/freight.py`：
   - 兼容旧输入。
   - 缺省 currency 使用 USD。
   - 主输入只依赖国家和货物质量。
   - Advanced 尺寸完整时才启用体积重。
   - 输出基础运费、附加费明细、总价、解释链路。
4. 保留源币种主计算，展示币种默认转 USD。

验收：

```text
6 个核心 golden cases 全部通过。
Advanced 体积重 case 通过。
旧 Phase 1B smoke test 仍通过。
```

### Phase F4: Freight Estimate 页面升级

目标：页面保持简单，但展示更完整的报价解释。

任务：

1. 更新 `freight.html` 表单，Display Currency 默认 USD。
2. Cargo Weight 和 Destination 保持为主输入。
3. Cargo Type 使用 Package / Document segmented control。
4. Advanced 尺寸区域默认折叠。
5. 更新 `js/freight.js` payload。
6. 增加 Advanced 尺寸完整性校验。
7. 结果卡展示 mode、zone/code、重量链路、base freight、fuel surcharge、infrastructure surcharge、estimated total、source、explanation。
8. 保持现有国家搜索体验。

验收：

```text
只填国家和货物质量即可报价。
默认展示 USD。
桌面和移动端文本不重叠。
结果卡能清楚区分 base freight 与附加费。
结果卡能清楚区分 small_matrix、document、heavy_per_kg。
```

### Phase F5: 验收与部署准备

目标：降低公网部署后的误报和维护成本。

任务：

1. 增加 `/api/public/freight/prototype` 新 summary。
2. 增加导入日志。
3. 增加 README 操作说明。
4. 增加燃油/基建附加费维护说明。
5. 增加 WordPress 插件包集成注意事项。
6. 使用本地浏览器检查页面交互。

验收：

```text
本地 API smoke test 通过。
浏览器手动测试通过。
WordPress 打包前无 console error。
附加费配置缺失时仍能报价，并给出 warning。
```

## 12. 测试计划

### 12.1 单元测试

| 测试 | 断言 |
|---|---|
| `round_up_weight()` | 5.1 -> 5.5 |
| `dhl_packaging_weight()` | 36 -> 43.5 |
| `fedex_packaging_weight()` | 25 -> 29 |
| `select_heavy_tier()` | 43.5 -> 30.1-70 或 21-44 |
| `calculate_surcharge_percentage()` | base 100, rate 0.35 -> 35 |
| `calculate_surcharge_fixed()` | fixed 5 -> 5 |
| `calculate_surcharge_per_kg()` | 10kg, rate 1.2 -> 12 |
| `volumetric_weight()` | Advanced 启用时，30*20*15/5000 = 1.8 |

### 12.2 导入测试

| 测试 | 断言 |
|---|---|
| 小货矩阵导入 | 记录数不低于当前 9628 |
| 文件价导入 | 4 个重量档 x 9 个 DHL 区 |
| DHL 重货导入 | 至少 3 个重量段 x 9 个区 |
| FedEx 重货导入 | 至少 7 个重量段 x 主要代码列 |
| 附加费 seed | 至少 DHL/FedEx x fuel/infrastructure 四条配置 |

### 12.3 API 测试

| Case | 预期 |
|---|---|
| Germany 5kg DHL/FedEx，不传 currency | display_currency = USD |
| Germany 5kg DHL/FedEx | 命中 small_matrix |
| DHL document 1.5kg | 命中 document |
| DHL 36kg | 命中 heavy_per_kg，包装重量 +7.5 |
| FedEx 25kg | 命中 heavy_per_kg，包装重量 +4 |
| 配置 fuel surcharge 10% | surcharges 中有 fuel，total = base + fuel + 其他附加 |
| 未传 dimensions | 使用 actual_weight_kg |
| Advanced 尺寸完整且体积重大于实重 | billable_base_weight 使用体积重量 |

### 12.4 前端测试

| 场景 | 预期 |
|---|---|
| 只填国家和货物质量 | 可报价 |
| 未选择币种 | 默认 USD |
| 展开 Advanced 并填尺寸 | 显示体积重量预览 |
| Advanced 尺寸只填一部分 | 阻止提交并提示 |
| cargo_type=document | FedEx 不返回文件价，DHL 返回文件价或提示超重 |
| 附加费为 0 | 仍展示基础运费和总价，可隐藏 0 金额明细或显示为 USD 0.00 |
| 移动端 | 表单和结果卡无文本溢出 |

## 13. 风险与处理

| 风险 | 处理 |
|---|---|
| Excel 存在 WPS/缓存公式，无法完全复算 | 以公式文本和费率表静态值为准，避免依赖 Excel 实时计算 |
| `区域` 与 `区域运费DHL` 可能代表不同渠道 | 第一版只使用 `区域运费DHL`，把 `区域` 标记为 alternate channel 待确认 |
| DHL USD 汇率在不同区域口径不一致 | 源币种主算，默认展示 USD，汇率走配置 |
| FedEx 附加调整已体现在源表或公式列里 | 第一版导入展开后的有效价格，燃油/基建附加费另算 |
| 燃油附加费变化频繁 | 独立配置，有生效日期，禁止硬编码 |
| 基建费口径可能来自公司内部 | 作为 `infrastructure` surcharge 配置，不从 Excel 推断 |
| 体积重 divisor 不确定 | Advanced 功能配置化，默认 5000，并在响应中返回 divisor |
| 旧页面调用可能断裂 | API 保持旧字段兼容 |

## 14. 决策点

开始实现前需要确认：

1. `区域运费DHL` 是否作为 DHL 小货唯一正式价格源。
2. `区域` 是否暂时不进入页面报价，只作为备用表。
3. 页面主流程是否只保留国家和货物质量，尺寸放入 Advanced。
4. 体积重 divisor 第一版是否先用 5000。
5. 页面 cargo type 是否先只做 `Package / Document`，大货由重量自动判断。
6. 外币报价是否默认展示 USD，并沿用当前 `exchange_rates`。
7. 燃油费和基建费第一版是否先 seed 为 0，等公司确认实际费率再填。

建议默认答案：

```text
1. 是。
2. 暂不进入。
3. 是。
4. 是。
5. 是。
6. 是。
7. 是，但数据结构和 UI 明细先做好。
```

## 15. 第一阶段执行清单

确认本 PRD 后，建议先推进 Phase F0。

Phase F0 具体产出：

1. `backend/scripts/inspect_freight_workbook.py`
2. `backend/scripts/test_freight_workbook_logic.py`
3. `backend/docs/freight_workbook_validation.md`
4. 6 个核心 golden cases 的来源、输入、预期路径和预期结果
5. 1 个 Advanced 体积重增强用例
6. 1 个 surcharge 配置用例

Phase F0 完成后，再进入数据模型、附加费配置和 importer v2。这样每一次后端重构都有 Excel 证据和回归样例托底。
