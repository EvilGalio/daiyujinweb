# PRD: Freight Estimate DHL-Only 运费计算升级

> 版本：v0.3  
> 日期：2026-06-24  
> 最新依据：`DHL运费计算逻辑详细说明.md`  
> 页面范围：`freight.html`、`js/freight.js`、`backend/services/freight.py`、`backend/services/freight_importer.py`

## 1. 结论

Freight Estimate 后续只计算 DHL 运费。

由于 FedEx 适配国家/地区较少，新版本删除 FedEx 计算、FedEx 勾选项、FedEx 数据导入、FedEx 测试用例和 FedEx 结果卡。页面主流程只保留：

```text
目的国家/地区 + 货物质量 -> DHL 运费
```

默认展示币种仍为 USD。

新版本不再在计算结果里展示明细、解释链路、公式路径和数据源。用户侧只看到一个专业的 DHL 运费估算结果。内部测试和日志可以保留必要的调试信息，但公开 API 和页面结果默认不返回、不渲染这些内容。

第一次计算之前，右侧结果模块也要稳定存在，显示 `USD $0.00` 或等价占位状态，避免页面右侧空白。

## 2. 最新 DHL 计算依据

新 PRD 以 `DHL运费计算逻辑详细说明.md` 为准。

该说明对应的 Excel 结构：

| 区域 | 范围 | 作用 |
|---|---|---|
| 国家/地区 + 0.5–30kg 价格表 | `A1:BJ234` | 国家查分区，国家 + 计费重量查基础总价 |
| 30kg 以上阶梯单价表 | `A235:J238` | 重货按重量阶梯 + 分区查基础单价/kg |
| 34kg 以下报价计算区 | `A247:H267` | 原始重量 -> 加包装重量 -> 小货表 -> `x1.8` -> USD/EUR |
| 34kg 以上报价计算区 | `A273:H293` | 原始重量 -> 计费重量 -> 阶梯单价 -> `x1.7` -> USD/EUR |

实际输入只有两个核心字段：

```text
country
weight_kg
```

页面不需要把体积、箱数、长宽高作为 DHL v1 计算输入。体积相关设计暂不进入本轮。

## 3. 产品目标

### 3.1 用户目标

用户输入目的国家/地区和货物质量，点击计算后，得到 DHL 运费估算金额。

页面体验目标：

| 场景 | 要求 |
|---|---|
| 初始状态 | 右侧结果模块存在，显示 `USD $0.00` |
| 正常计算 | 右侧显示 DHL 运费金额 |
| 国家不存在 | 显示简短错误，不展示技术细节 |
| 重量非法 | 显示简短错误，不展示公式 |
| 计算失败 | 显示统一错误状态 |

### 3.2 系统目标

系统只维护一条 DHL 计算路径：

```text
输入国家和重量
  -> 查 DHL 分区
  -> 判断 <=33kg 或 >33kg
  -> 按对应规则计算计费重量
  -> 查基础价格或基础单价
  -> 乘倍率
  -> 按币种折算
  -> 返回最终金额
```

公开结果只包含报价所需字段：

```text
carrier = DHL
amount
currency
country
weight_kg
```

不返回：

```text
source sheet
source row
formula explanation
calculation steps
debug details
rate table path
```

## 4. 非目标

| 非目标 | 原因 |
|---|---|
| FedEx 报价 | 国家/地区适配较少，本项目后续只做 DHL |
| 体积重量 | 最新 DHL 说明中正式输入只有国家和货物质量 |
| 箱数/尺寸输入 | 当前 DHL v1 不需要 |
| 数据源展示 | 用户侧冗余，影响专业感 |
| 公式解释展示 | 用户侧冗余，保留在测试和内部文档即可 |
| 自动同步 DHL 官方实时价格 | 当前依据是内部 Excel 逻辑 |
| 做成正式下单系统 | 当前仍是 estimate |

## 5. DHL 计算算法

### 5.1 输入

API 请求：

```json
{
  "country": "Japan",
  "weight_kg": 5,
  "currency": "USD"
}
```

`currency` 可省略：

```text
currency default = USD
```

### 5.2 路由规则

根据原始货物重量 `C` 判断计算路径：

| 原始重量 | 计算路径 |
|---:|---|
| `C <= 33` | 34kg 以下规则 |
| `C > 33` | 34kg 以上规则 |

这里以 `33kg` 为实际分界点，因为 34kg 以上区公式中：

```excel
IF(C<=33,"",...)
```

### 5.3 34kg 以下规则

适用：

```text
weight_kg <= 33
```

第一步：查 DHL 分区。

```text
zone = VLOOKUP(country, A:B, 2, FALSE)
```

第二步：计算加包装重量 `F`。

| 原始重量 C | 加包装重量 F |
|---:|---:|
| `C <= 5` | `C + 1` |
| `5 < C <= 10` | `C + 2` |
| `10 < C <= 16` | `C + 3` |
| `16 < C <= 20` | `20` |
| `20 < C <= 26` | `C - 7` |
| `26 < C <= 33` | `20` |

第三步：用国家和加包装重量查 `0.5–30kg` 价格表。

```text
base_price = INDEX(C2:BJ234,
                   MATCH(country, A2:A234, 0),
                   MATCH(charge_weight, C1:BJ1, 0))
```

第四步：乘以小货倍率。

```text
rmb_total = base_price * 1.8
```

第五步：折算展示币种。

```text
USD = rmb_total / 6
EUR = rmb_total / 7
CNY = rmb_total
```

### 5.4 34kg 以上规则

适用：

```text
weight_kg > 33
```

第一步：查 DHL 分区，并转成 `x区`。

```text
zone_text = VLOOKUP(country, A:B, 2, FALSE) + "区"
```

第二步：计算计费重量 `F`。

| 原始重量 C | 计费重量 F |
|---:|---:|
| `33 < C <= 70` | `C + 7.5` |
| `70 < C <= 300` | `C + 12.5` |
| `C > 300` | `C * 1.0822` |

第三步：根据计费重量判断阶梯。

| 计费重量 F | 阶梯 |
|---:|---|
| `F <= 70` | `30.1-70` |
| `70 < F <= 300` | `70.1-300` |
| `F > 300` | `300.1-999` |

第四步：查重货基础单价/kg。

```text
base_unit_price = INDEX(B236:J238,
                        MATCH(tier, A236:A238, 0),
                        MATCH(zone_text, B235:J235, 0))
```

第五步：乘以大货倍率。

```text
rmb_unit_price = base_unit_price * 1.7
```

第六步：计算人民币总价。

```text
rmb_total = rmb_unit_price * charge_weight
```

第七步：折算展示币种。

```text
USD = rmb_total / 6
EUR = rmb_total / 7
CNY = rmb_total
```

### 5.5 特殊规则说明

这些规则必须按新说明保留：

| 规则 | 处理 |
|---|---|
| `20 < C <= 26` 使用 `C - 7` | 按 Excel 实际公式实现 |
| `26 < C <= 33` 使用 `20kg` | 按 Excel 实际公式实现 |
| 34kg 以上 `+CHOOSE -CHOOSE` 净影响为 0 | 不进入系统计算 |
| USD 折算除数为 6 | 第一版写入配置 |
| EUR 折算除数为 7 | 第一版写入配置 |
| 小货倍率 1.8 | 第一版写入配置 |
| 大货倍率 1.7 | 第一版写入配置 |

## 6. 数据模型设计

### 6.1 建议保留通用表名，但数据只存 DHL

为了减少迁移成本，可以继续使用现有 `freight_rates` 或后续的 rate card 表，但业务上只导入 DHL。

如果新增 v2 表，建议：

### 6.2 `dhl_zones`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| country | string | 英文国家名 |
| country_cn | string | 中文国家名 |
| zone_code | string | `1` 到 `9` |

### 6.3 `dhl_small_rates`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| country | string | 国家/地区 |
| zone_code | string | DHL 分区 |
| charge_weight | float | 表头重量，0.5 到 30 |
| base_price_cny | float | 基础价格，乘倍率前 |

### 6.4 `dhl_heavy_rates`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| tier | string | `30.1-70` / `70.1-300` / `300.1-999` |
| zone_text | string | `1区` 到 `9区` |
| base_unit_price_cny | float | 基础单价/kg，乘倍率前 |

### 6.5 `dhl_freight_configs`

| key | 默认值 | 说明 |
|---|---:|---|
| `default_currency` | `USD` | 默认展示币种 |
| `small_multiplier` | `1.8` | 34kg 以下倍率 |
| `heavy_multiplier` | `1.7` | 34kg 以上倍率 |
| `usd_divisor` | `6` | 美元折算除数 |
| `eur_divisor` | `7` | 欧元折算除数 |
| `small_weight_limit_kg` | `33` | 小货路径上限 |

## 7. Importer v2

### 7.1 输入来源

以 `DHL运费计算逻辑详细说明.md` 描述的 Excel 结构为准，目标源表为：

```text
A重量运费重制版.xlsx / Sheet1
```

如果实际文件名后续仍为 `D重量运费.xlsx`，导入器应通过配置指定 workbook path，不要写死文件名。

### 7.2 导入内容

导入器只导入 DHL：

| 数据 | Excel 范围 |
|---|---|
| 国家/地区与 DHL 分区 | `A2:B234` |
| 0.5–30kg 小货基础价格 | `C2:BJ234` |
| 小货重量表头 | `C1:BJ1` |
| 重货阶梯名称 | `A236:A238` |
| 重货分区表头 | `B235:J235` |
| 重货基础单价 | `B236:J238` |
| 配置参数 | `1.8 / 1.7 / 6 / 7 / 33` |

### 7.3 不再导入

| 数据 | 处理 |
|---|---|
| FedEx 国家矩阵 | 删除 |
| FedEx 重货表 | 删除 |
| FedEx 附加调整 | 删除 |
| FedEx 测试样例 | 删除 |
| FedEx UI 勾选项 | 删除 |

### 7.4 导入报告

导入脚本输出给开发者看的摘要可以保留：

```text
dhl_country_count
dhl_small_rate_count
dhl_heavy_rate_count
config_count
warnings
```

这些信息只用于命令行和测试，不进入前端结果。

## 8. API 设计

### 8.1 `/api/public/freight/calculate`

请求：

```json
{
  "country": "Japan",
  "weight_kg": 5,
  "currency": "USD"
}
```

响应：

```json
{
  "country": "Japan",
  "carrier": "DHL",
  "weight_kg": 5,
  "currency": "USD",
  "amount": 138.87
}
```

错误响应：

```json
{
  "error": {
    "code": "unsupported_destination",
    "message": "Destination is not supported yet."
  }
}
```

### 8.2 删除公开响应字段

以下字段不进入公开响应：

```text
results[]
missing_carriers
source
source_sheet
source_row
explanation
pricing_mode
zone
charge_weight_kg
base_price
unit_price
calculation_steps
surcharges
```

如果后端测试需要这些字段，可以放在内部函数返回值或 debug 脚本里，公共 API 默认不返回。

### 8.3 `/api/public/freight/prototype`

保留摘要接口，但内容只展示数据覆盖情况：

```json
{
  "carrier": "DHL",
  "country_count": 233,
  "small_rate_count": 13514,
  "heavy_rate_count": 27,
  "default_currency": "USD"
}
```

## 9. 前端 UX 设计

### 9.1 页面结构

页面整体布局可以保留：

```text
左侧：Shipment 表单
右侧：Rates / Result 模块
```

左侧字段调整为：

| 字段 | 类型 | 默认值 |
|---|---|---|
| Destination | searchable input | 空 |
| Cargo Weight | number | 5kg |
| Display Currency | select | USD |

删除：

```text
Carrier checkbox
FedEx option
Cargo Type segmented control
Dimensions / Advanced inputs
Box Count
Volumetric preview
```

### 9.2 初始右侧结果模块

第一次计算前，右侧模块必须存在。

初始显示：

```text
DHL Freight
USD $0.00
```

可以加一个低调状态：

```text
Ready for estimate
```

不要使用大段说明文字。

### 9.3 计算后结果模块

计算成功后显示：

```text
DHL Freight
USD $138.87
```

可选显示一行轻量信息：

```text
Japan · 5 kg
```

不显示：

```text
数据源
公式
查表路径
分区
计费重量
基础价格
解释明细
```

### 9.4 错误状态

| 场景 | 文案 |
|---|---|
| 国家不存在 | `Destination is not supported yet.` |
| 重量为空或 <=0 | `Enter a valid cargo weight.` |
| 重量无法匹配规则 | `No DHL rate found for this shipment.` |
| 后端不可用 | `Freight service is temporarily unavailable.` |

错误状态也保持右侧卡片存在，金额可以显示：

```text
USD $0.00
```

## 10. 实施阶段

### Phase F0: DHL 逻辑验证与黄金样例

目标：先把新 MD 的计算逻辑固化成测试。

任务：

1. 新建或更新 `backend/scripts/inspect_dhl_freight_workbook.py`。
2. 新建 `backend/scripts/test_dhl_freight_logic.py`。
3. 固定 DHL golden cases：
   - 日本，5kg，USD 138.87。
   - 日本，34kg，USD 247.04。
   - 德国，65kg，USD 936.70。
   - 任一 `20 < C <= 26` 样例，验证 `C - 7`。
   - 任一 `26 < C <= 33` 样例，验证按 `20kg`。
4. 验证默认 currency 缺省时为 USD。

验收：

```text
golden cases 全部通过。
测试覆盖小货路径和重货路径。
测试覆盖两个特殊重量区间。
```

### Phase F1: 删除 FedEx 入口

目标：产品层面变成 DHL-only。

任务：

1. 删除 `freight.html` 中 FedEx checkbox。
2. 删除 `js/freight.js` 中 carriers 数组收集逻辑。
3. API 请求不再传 `carriers`。
4. 后端忽略或拒绝 `carrier != DHL` 的输入。
5. 删除 FedEx 相关前端结果卡。

验收：

```text
页面上看不到 FedEx。
API 正常请求无需 carriers。
旧请求如果带 carriers，也不会返回 FedEx。
```

### Phase F2: DHL Importer v2

目标：只导入 DHL 所需数据。

任务：

1. 解析国家和分区。
2. 解析 0.5–30kg 小货价格。
3. 解析 30kg 以上重货阶梯单价。
4. 写入 DHL 配置参数。
5. 导入报告只输出 DHL 摘要。

验收：

```text
dhl_country_count >= 233
dhl_small_rate_count > 0
dhl_heavy_rate_count == 27
default_currency == USD
```

### Phase F3: DHL Calculation Engine

目标：后端按新 MD 计算 DHL 运费。

任务：

1. 实现 `calculate_dhl_freight(country, weight_kg, currency='USD')`。
2. 实现 34kg 以下包装重量规则。
3. 实现 34kg 以上计费重量规则。
4. 实现小货查价。
5. 实现重货阶梯查价。
6. 实现 CNY / USD / EUR 输出。
7. 公共返回值只包含最终金额，不包含明细和数据源。

验收：

```text
Phase F0 golden cases 全部通过。
公共 API 响应没有 source/explanation/debug 字段。
```

### Phase F4: 页面升级

目标：右侧模块始终存在，页面专业简洁。

任务：

1. 表单只保留 Destination、Cargo Weight、Display Currency。
2. Display Currency 默认 USD。
3. 右侧结果模块初始显示 `USD $0.00`。
4. 计算中显示 loading 状态，但保持金额区域稳定。
5. 计算成功显示 DHL 金额。
6. 计算失败显示错误，同时金额回到 `USD $0.00`。
7. 移除结果里的数据源、解释、分区、计费重量等信息。

验收：

```text
首次打开页面时右侧不是空白。
计算前显示 USD $0.00。
计算后只显示 DHL 运费金额和极简上下文。
移动端无文本溢出。
```

### Phase F5: 清理和部署准备

目标：删除遗留 FedEx 路径，避免以后误用。

任务：

1. 删除或归档 FedEx importer 分支。
2. 删除 FedEx 测试样例。
3. 更新 README。
4. 更新 WordPress 插件打包说明。
5. 本地浏览器验收。

验收：

```text
代码搜索 FedEx 只剩历史说明或已归档文件。
DHL-only API smoke test 通过。
WordPress 打包前无 console error。
```

## 11. 测试计划

### 11.1 单元测试

| 测试 | 断言 |
|---|---|
| `small_charge_weight(5)` | `6` |
| `small_charge_weight(21)` | `14` |
| `small_charge_weight(33)` | `20` |
| `heavy_charge_weight(34)` | `41.5` |
| `heavy_charge_weight(65)` | `72.5` |
| `heavy_charge_weight(320)` | `346.304` |
| `select_heavy_tier(41.5)` | `30.1-70` |
| `select_heavy_tier(72.5)` | `70.1-300` |
| `convert_currency(833.22, USD)` | `138.87` |

### 11.2 API 测试

| Case | 预期 |
|---|---|
| Japan 5kg | amount = 138.87 USD |
| Japan 34kg | amount = 247.04 USD |
| Germany 65kg | amount = 936.70 USD |
| 不传 currency | 默认 USD |
| 传 CNY | 返回人民币金额 |
| 传 EUR | 返回欧元金额 |
| 国家不存在 | `unsupported_destination` |
| weight <= 0 | validation error |
| 响应字段扫描 | 不包含 source、explanation、calculation_steps |

### 11.3 前端测试

| 场景 | 预期 |
|---|---|
| 页面首次打开 | 右侧显示 `USD $0.00` |
| 输入 Japan / 5kg | 显示 DHL USD 金额 |
| 切换 CNY | 金额显示 CNY |
| 国家不存在 | 右侧卡片保留，显示错误 |
| 后端断开 | 右侧卡片保留，显示服务不可用 |
| 搜索 FedEx | 页面无 FedEx 入口 |

## 12. 决策点

当前建议默认决策：

```text
1. 只做 DHL。
2. 删除 FedEx UI、API 和 importer 规划。
3. 默认币种 USD。
4. 输入只保留国家和货物质量。
5. 公开结果只显示最终 DHL 运费金额。
6. 右侧结果模块初始显示 USD $0.00。
7. 内部测试可以保留计算路径，但不进入公开响应和页面。
```

如果确认无误，下一阶段应从 Phase F0 开始，把 `DHL运费计算逻辑详细说明.md` 中的公式变成 golden tests。
