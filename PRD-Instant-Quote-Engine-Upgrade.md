# PRD: Instant Quoting 报价系统更新迭代

> 版本：v0.2  
> 日期：2026-06-24  
> 目标页面：`quote.html`  
> 目标后端：`backend/services/pricing.py`、`backend/services/step_analyzer.py`、`backend/models.py`、`backend/scripts/seed_data.py`

## 1. 背景

当前 Instant Quoting 已经可以完成基本闭环：

1. 上传 STEP 文件。
2. 用 OpenCascade 解析体积、OBB/AABB 尺寸并生成缩略图。
3. 用户选择材料、公差、后处理、数量、币种。
4. 后端按材料重量、尺寸 bucket、公差系数、数量系数、后处理费用给出估算。
5. 报价结果可转正式询盘。

这个系统适合展示“自动报价体验”，但价格模型仍偏粗糙。它把很多复杂因素压缩成全局系数，容易产生一种“看起来精确，实际不稳”的结果。

经过和专业报价员沟通后，新的方向应从“多因素连乘模型”升级为“工艺时间模型 + 风险分级 + 历史报价校准”。报价页面仍可以保持快速、漂亮、自动化，但内部要更像一个工程估算器。

本次审查后的关键优化：

1. 增加成功指标和能力边界，避免 PRD 只有方法论、缺少验收尺子。
2. 明确毛坯策略、最低收费、setup 摊销和 review gate，这是报价员实际判断里最容易被低估的部分。
3. 把几何特征增强拆成可测试的阶段，先做 OpenCascade 能稳定给出的特征，再做风险代理。
4. 增加模型版本、回测和人工报价回填，为未来校准留下数据结构。
5. 明确客户侧只看价格区间、置信度和复核提示，内部才保存成本拆分。

## 2. 行业调研结论

### 2.1 Xometry

Xometry 的公开信息显示，它的 Instant Quoting Engine 支持上传多种 CAD 文件，平台入口明确列出 STEP、STP、SLDPRT、STL、DXF 等文件格式。Xometry 同时强调 AI-powered quoting、平台智能、全球供应商网络、材料/工艺/交期/供应商能力选择。

可观察结论：

| 维度 | 启发 |
|---|---|
| 输入 | CAD 文件是报价入口，而不是只填参数 |
| 机制 | 报价系统与材料、工艺、供应商网络、交期、质量体系绑定 |
| 输出 | 报价不是单一公式结果，而是工艺选项、交期、供应链能力共同决定 |
| 可借鉴 | 我们可以先做 CAD 几何代理特征 + 工艺时间模型，不要追求完整供应链 marketplace |

来源：[Xometry](https://www.xometry.com/)

### 2.2 Protolabs

Protolabs 官网把流程描述为：上传 3D CAD 文件，获得 DFM 分析和实时价格。它还强调 automated 和 live manufacturing support 并存。也就是说，自动报价并没有取消工程师，而是把工程师放在复杂件、生产件、异常件、正式订单确认阶段。

可观察结论：

| 维度 | 启发 |
|---|---|
| 自动化边界 | 即时估价适合快速反馈，正式生产仍需要工程支持 |
| DFM | 报价系统要指出可制造性风险，而不是只给价格 |
| 人工复核 | 高风险零件必须引导提交正式询盘 |
| 可借鉴 | 我们要输出 estimate range 和 review flags，不承诺 binding quote |

来源：[Protolabs](https://www.protolabs.com/)

### 2.3 Protolabs Network / Hubs

Protolabs Network 首页强调 instant quoting with free design analysis、100+ 材料和表面处理组合、CNC 公差能力、低批量和生产批量，且背后有制造商网络。它的 CNC 页面还明确描述会用机器学习算法把上传的 CAD 文件和数百万个过往制造零件比较，再根据材料、制造要求、交期、供应商可用性和历史成本等因素生成报价。

可观察结论：

| 维度 | 启发 |
|---|---|
| 报价输入 | CAD + 材料 + 表面处理 + 数量 |
| 报价能力 | 不是孤立价格，而是材料、后处理、质量标准、交期共同配置 |
| 复杂件 | 依赖网络内专门工厂能力 |
| 可借鉴 | 我们的第一版不建网络，但要建立“能力边界”“历史数据回填”和“需人工复核”的提示 |

来源：[Protolabs Network](https://www.hubs.com/)

### 2.4 学术路线：3D CAD 深度学习

一篇关于 CNC 成本估计的研究提出，用 3D CAD 模型进行深度学习成本预测，并用 Grad-CAM 类方法可视化影响成本的加工特征。它说明 AI 可以从 3D 几何中学习成本相关特征，但也强调可解释性问题。

可观察结论：

| 维度 | 启发 |
|---|---|
| AI 能力 | AI 可以学习加工特征和成本关系 |
| 风险 | 黑箱模型难解释，不适合直接当报价责任主体 |
| 可借鉴 | 本地第一版用可解释规则模型，未来有数据后再做 ML 残差校准 |

来源：[Explainable Artificial Intelligence for Manufacturing Cost Estimation and Machining Feature Visualization](https://arxiv.org/abs/2010.14824)

### 2.5 学术路线：2D 图纸几何特征 + 机器学习

另一篇 2025 年研究从 13,684 张工程图中提取约 200 个几何/统计描述符，用 XGBoost、CatBoost、LightGBM 做制造成本预测，达到约 10% MAPE，并用 SHAP 解释几何成本驱动因素。

可观察结论：

| 维度 | 启发 |
|---|---|
| 数据 | 高质量历史报价/图纸数据极其关键 |
| 算法 | GBDT 类模型适合 tabular geometric features |
| 路线 | 先做特征体系和报价日志，再积累数据做校准 |
| 可借鉴 | 我们要从第一天保存 geometry features、manual final quote、model estimate、差异 |

来源：[Machine Learning-Based Manufacturing Cost Prediction from 2D Engineering Drawings via Geometric Features](https://arxiv.org/abs/2508.12440)

## 3. 核心判断

### 3.1 不继续做全局连乘

旧思路：

```text
材料 * 材料质量 * 加工系数 * 公差系数 * 后处理系数 * 数量系数 = 价格
```

主要问题：

| 问题 | 说明 |
|---|---|
| 因素不独立 | 公差、尺寸、材料、后处理会互相影响 |
| 全局系数过粗 | 一个孔的紧公差不应让整件零件整体翻倍 |
| 无法解释工时 | 报价员本质上在估时间、夹具、风险、返工，而不是乘系数 |
| 小件逻辑错误 | 小件贵通常来自装夹、检测、刀具、毛刺和最小收费，不是单纯体积小 |
| 后处理被误建模 | 影响公差的后处理会改变工艺顺序和返修风险，不能只加一个百分比 |

### 3.2 新模型采用分项加和

新方向：

```text
报价 = 材料成本
     + 编程/工程准备成本
     + 装夹/ setup 成本
     + 粗加工时间成本
     + 精加工时间成本
     + 检测成本
     + 后处理成本
     + 风险缓冲
     + 利润/管理费
```

然后按数量摊销：

```text
单件价格 = (一次性成本 / 数量) + 单件变动成本
```

这个结构更接近报价员思维，也更容易被历史报价校准。

### 3.3 审查后的执行原则

| 原则 | 说明 |
|---|---|
| 先代理，后精细 | 先用体积、毛坯、去除率、表面积等稳定特征做代理，不急着识别每一个孔和倒角 |
| 先区间，后单点 | 没有足够历史数据前，区间价比单点价诚实 |
| 先规则，后学习 | 规则模型先形成可解释基线，历史数据积累后再用 ML 修正残差 |
| 先复核门槛，后自动承诺 | 高风险件必须进入人工复核，不让系统硬算一个不可靠数字 |
| 先内部可追溯，后客户简洁 | 内部保存成本拆分和模型版本，客户只看到必要结果 |

## 4. 产品定位

### 4.1 页面定位

页面名称仍为：

```text
Instant Quoting
```

但结果文案要更谨慎：

```text
Instant Estimate
```

而不是：

```text
Final Quote
```

### 4.2 输出形式

不要只输出一个看似精确的单点价格。建议输出：

```text
Estimated Unit Price: USD 12.40 - 16.80
Estimated Total: USD 1,240 - 1,680
Confidence: Medium
Review: Recommended
```

如果零件非常简单，可以显示高置信度：

```text
Confidence: High
```

如果风险较高，直接提示：

```text
Engineering Review Required
```

### 4.3 对客户展示和内部数据分离

客户侧展示：

| 展示项 | 是否显示 |
|---|---|
| 价格区间 | 显示 |
| 总价区间 | 显示 |
| 置信度 | 显示 |
| 主要风险提示 | 显示简短文案 |
| 材料/数量/工艺选择 | 显示 |
| 详细公式 | 不显示 |
| 内部费率 | 不显示 |
| 工时拆分 | 不显示 |

内部保存：

| 内部字段 | 用途 |
|---|---|
| 几何特征 | 后续校准 |
| 成本拆分 | 调试和复核 |
| 风险 flags | 人工复核 |
| 模型版本 | 回归测试 |
| 人工最终报价 | 未来训练 |

### 4.4 成功指标

第一版不以“完全自动报准”为目标，而以“可解释、可复核、可积累数据”为目标。

| 阶段 | 指标 |
|---|---|
| Q1 几何特征 | STEP 上传成功后返回完整 geometry feature payload，旧上传流程兼容 |
| Q2 成本模型 | 常规样例返回价格区间，数量增加时单件价格下降，材料更难加工时价格上升 |
| Q3 风险分级 | 高风险样例触发 review_required，普通样例不误触发 |
| Q4 前端 | 客户能明确看到 estimate range、confidence、review 状态 |
| Q5 数据回填 | 每条正式询盘能回填人工最终报价并导出 CSV |

有 30 条人工回填前，不用 MAPE 作为硬指标。达到 30 条后开始看误差分布；达到 100 条后再讨论 ML 校准。

### 4.5 能力边界

第一版只覆盖：

```text
CNC milling 代理报价
常见金属/塑料材料
STEP 几何特征可解析的实体模型
一般公差等级和常见表面处理
```

第一版遇到以下情况应触发人工复核或拒绝自动报价：

| 场景 | 处理 |
|---|---|
| 需要车削、线切割、钣金、注塑等非 milling 工艺 | review_required |
| 薄壁、深腔、长细件、高去除率 | review_required 或 low confidence |
| 精密公差但没有 2D 图纸 | review_required |
| 后处理可能影响尺寸稳定 | review_required |
| STEP 解析失败或几何特征不完整 | 不自动报价 |
| 超出机床尺寸、重量或材料能力边界 | 不自动报价 |

## 5. 当前工程可行性

当前 `backend/services/step_analyzer.py` 已经具备：

| 能力 | 现状 |
|---|---|
| STEP 读取 | 已实现 |
| 体积 `volume_mm3` | 已实现 |
| AABB 尺寸 | 已实现 |
| OBB 尺寸 | 已实现 |
| 缩略图 | 已实现 |

当前 `backend/services/pricing.py` 已经具备：

| 能力 | 现状 |
|---|---|
| 材料表 | 已有 |
| 公差等级表 | 已有 |
| 后处理表 | 已有 |
| 数量阶梯 | 已有 |
| 汇率 | 已有 |
| 估价记录 | 已有 |
| 正式询盘 | 已有 |

因此第一阶段不需要引入 LLM 或云端 AI。最合理路径是增强本地几何特征和改造成本模型。

## 6. 新报价模型

### 6.1 输入

保留现有输入：

```json
{
  "file_id": "uuid",
  "volume_mm3": 12500,
  "obb_dimensions_mm": "48 x 32 x 18",
  "material_id": 1,
  "tolerance_grade": "ISO2768-m",
  "surface_treatment_ids": [2],
  "quantity": 100,
  "currency": "USD"
}
```

建议新增：

| 字段 | 类型 | 说明 |
|---|---|---|
| `process` | string | 默认 `cnc_milling_3axis` |
| `drawing_available` | bool | 是否有 2D 图纸 |
| `threaded_holes` | int | 用户可选填 |
| `critical_features` | int | 用户可选填 |
| `surface_finish_level` | string | `standard / cosmetic / precision` |
| `lead_time_preference` | string | `standard / expedited` |

第一版可以不强制新增这些输入，但后端模型要预留字段。

### 6.2 几何特征提取

基于现有 OpenCascade 能力，优先新增这些本地可计算特征：

| 特征 | 公式或来源 | 用途 |
|---|---|---|
| `part_volume_mm3` | solid volume | 净体积 |
| `obb_x/y/z_mm` | OBB | 毛坯尺寸代理 |
| `aabb_x/y/z_mm` | AABB | 尺寸校验 |
| `max_dim_mm` | max OBB | 机床行程风险 |
| `min_dim_mm` | min OBB | 薄件、小件风险 |
| `stock_volume_mm3` | OBB x y z | 毛坯体积代理 |
| `removal_volume_mm3` | stock - part | 去除体积代理 |
| `removal_ratio` | removal / stock | 粗加工难度 |
| `stock_to_part_ratio` | stock / part | buy-to-fly 代理 |
| `surface_area_mm2` | OpenCascade surface props | 精加工代理 |
| `surface_to_volume_ratio` | area / volume | 小件、薄壁、复杂曲面代理 |
| `aspect_ratio` | max_dim / min_dim | 长细件装夹风险 |
| `compactness` | volume / stock_volume | 形状复杂度代理 |

### 6.2.1 毛坯策略

毛坯是价格模型的地基，不能简单把成品净体积当材料成本。

第一版毛坯估算：

```text
stock_x = obb_x + stock_allowance_mm * 2
stock_y = obb_y + stock_allowance_mm * 2
stock_z = obb_z + stock_allowance_mm * 2
stock_volume_mm3 = stock_x * stock_y * stock_z
```

默认：

```text
stock_allowance_mm = 2
```

材料成本用毛坯重量：

```text
stock_weight_kg = stock_volume_mm3 * density_gcm3 / 1_000_000
```

保护规则：

```text
if stock_volume_mm3 < part_volume_mm3:
    stock_volume_mm3 = part_volume_mm3 * 1.05
```

后续可以按材料棒料、板料、圆棒、方料进一步细化。第一版只用 OBB 加余量，胜在稳定、可解释、工程成本低。

### 6.3 风险特征

第一版本地算法无法可靠识别所有孔、螺纹、深腔、倒扣。可以先用代理特征和用户输入生成风险 flags。

| Flag | 触发条件 |
|---|---|
| `tiny_part_risk` | `max_dim_mm < 15` 或 `weight_kg` 很小 |
| `thin_part_risk` | `min_dim_mm < 2` |
| `slender_part_risk` | `aspect_ratio > 8` |
| `high_removal_risk` | `removal_ratio > 0.85` |
| `complex_surface_risk` | `surface_to_volume_ratio` 高于阈值 |
| `tight_tolerance_risk` | 公差等级为精密级 |
| `treatment_tolerance_risk` | 后处理影响尺寸稳定 |
| `missing_drawing_risk` | 选择精密公差但未上传 2D 图纸 |
| `review_required` | 多个风险同时出现 |

### 6.3.1 Review gate

`review_required` 不是一个普通提示，而是报价系统的安全阀。

建议第一版规则：

```text
hard_review_required =
  missing_geometry
  or unsupported_process
  or unsupported_material
  or max_dim_mm > configured_machine_limit
  or tight_tolerance_risk and not drawing_available
```

```text
soft_risk_score =
  tiny_part_risk
  + thin_part_risk
  + slender_part_risk
  + high_removal_risk
  + complex_surface_risk
  + treatment_tolerance_risk
```

```text
if hard_review_required:
    estimate_mode = "review_required"
elif soft_risk_score >= 3:
    estimate_mode = "range_with_review"
elif soft_risk_score >= 1:
    estimate_mode = "range"
else:
    estimate_mode = "range_high_confidence"
```

客户侧文案：

| estimate_mode | 展示 |
|---|---|
| `range_high_confidence` | 显示区间和 High confidence |
| `range` | 显示区间和 Medium confidence |
| `range_with_review` | 显示较宽区间和 Review recommended |
| `review_required` | 不显示价格或显示询盘 CTA，提示工程复核 |

### 6.4 成本模型

成本拆成一次性成本、单件变动成本、批量后处理成本。

#### 6.4.1 材料成本

```text
stock_weight_kg = stock_volume_mm3 * density_gcm3 / 1_000_000
material_cost = stock_weight_kg * material_unit_price_usd_kg * material_yield_factor
```

说明：

现有系统用净体积算重量。新模型应改为毛坯体积或毛坯体积代理。因为 CNC 买料通常接近毛坯，不是成品净体积。

#### 6.4.2 编程成本

```text
programming_time_min =
  base_programming_min
  + complexity_score * programming_complexity_min
```

```text
programming_cost = programming_time_min / 60 * engineering_rate_usd_hour
```

`complexity_score` 可由这些特征组合：

```text
removal_ratio
surface_to_volume_ratio
aspect_ratio
tolerance_level
surface_finish_level
risk_flags
```

#### 6.4.3 装夹成本

```text
setup_count = estimate_setup_count(geometry, process)
setup_time_min = base_setup_min + setup_count * setup_time_per_setup_min
setup_cost = setup_time_min / 60 * machine_rate_usd_hour
```

第一版 setup_count 可用规则估计：

| 条件 | setup_count |
|---|---:|
| 简单块状件 | 1 |
| 常规三轴件 | 2 |
| 高去除率或多面加工代理 | 3 |
| 风险件 | 4 或 review required |

#### 6.4.4 粗加工成本

```text
roughing_time_min = removal_volume_cm3 / material_mrr_cm3_min
roughing_cost = roughing_time_min / 60 * machine_rate_usd_hour
```

`material_mrr_cm3_min` 按材料配置：

| 材料类别 | MRR 逻辑 |
|---|---|
| Aluminum | 高 |
| Brass | 中高 |
| Mild steel | 中 |
| Stainless steel | 低 |
| Titanium | 很低 |
| Plastics | 中，但有变形风险 |

#### 6.4.5 精加工成本

```text
finishing_time_min =
  surface_area_cm2 / finish_surface_rate_cm2_min
  * tolerance_time_factor
  * cosmetic_factor
```

```text
finishing_cost = finishing_time_min / 60 * machine_rate_usd_hour
```

如果暂时没有 surface area，则第一阶段用：

```text
surface_area_proxy = 2 * (xy + yz + xz)
```

但应尽快从 OpenCascade 取真实 surface area。

#### 6.4.6 检测成本

```text
inspection_time_min =
  base_inspection_min
  + tolerance_level_inspection_min
  + critical_features * inspection_min_per_feature
```

没有 2D 图纸时：

```text
critical_features = 0
```

但如果用户选择精密公差：

```text
review_required = true
```

#### 6.4.7 后处理成本

后处理分两类：

| 类型 | 处理 |
|---|---|
| 不影响公差 | 固定费用或按表面积/件数计费 |
| 影响公差 | 增加风险缓冲，必要时触发人工复核 |

模型：

```text
postprocess_cost =
  fixed_lot_cost / quantity
  + per_part_cost
  + surface_area_based_cost
```

如果后处理影响尺寸：

```text
treatment_tolerance_risk = true
inspection_time += extra_inspection_time
```

#### 6.4.8 批量摊销

```text
one_time_cost = programming_cost + setup_cost
variable_cost_per_part =
  material_cost
  + roughing_cost
  + finishing_cost
  + inspection_cost
  + postprocess_cost

unit_cost = one_time_cost / quantity + variable_cost_per_part
```

#### 6.4.9 风险缓冲和利润

```text
risk_buffer = unit_cost * risk_rate
selling_unit_price = (unit_cost + risk_buffer) * margin_factor
```

风险率按 confidence 决定：

| Confidence | risk_rate |
|---|---:|
| High | 5% |
| Medium | 12% |
| Low | 25% |
| Review Required | 不给单点价，给宽区间或要求询盘 |

#### 6.4.10 最低收费

报价系统必须有最低收费，否则小件、小批量会被模型低估。

建议配置：

```text
minimum_order_usd
minimum_unit_usd
minimum_setup_usd
minimum_programming_usd
minimum_postprocess_lot_usd
```

应用顺序：

```text
one_time_cost = max(programming_cost + setup_cost, minimum_setup_usd + minimum_programming_usd)
unit_cost = max(unit_cost, minimum_unit_usd)
total_center = max(unit_cost * quantity, minimum_order_usd)
```

这比在最后粗暴乘一个“小件系数”更稳定，也更贴近报价员对最小开机、最小编程、最小订单的判断。

### 6.5 价格区间

不要只返回单点价格。

```text
low = center * (1 - uncertainty)
high = center * (1 + uncertainty)
```

`uncertainty` 根据风险和数据完整度：

| 情况 | uncertainty |
|---|---:|
| 常规件，材料常见，公差普通 | 10% |
| 中等复杂，缺少图纸 | 20% |
| 高风险，后处理影响公差 | 35% |
| 超出能力边界 | 不自动报价 |

### 6.6 模型版本和回测

每次成本模型参数变化，都要保留版本号。

```text
pricing_model_version = quote-engine-v2.0
config_version = 2026-06-24-seed
geometry_feature_version = geom-v2.0
```

所有 quote inquiry 保存：

```text
model_version
config_version
input_payload
geometry_features
internal_cost_model
customer_result
```

每次修改模型后，必须跑固定 fixtures：

| Fixture | 用途 |
|---|---|
| cube_simple | 检查 compactness、低风险、价格基础 |
| long_bar | 检查 aspect_ratio 和装夹风险 |
| thin_plate | 检查 thin_part_risk |
| high_removal_block | 检查 removal_ratio 与粗加工成本 |
| small_part | 检查 minimum_unit_usd |
| precision_no_drawing | 检查 review_required |

## 7. API 设计

### 7.1 `/api/public/quote/calculate`

请求保持兼容，新增可选字段：

```json
{
  "file_id": "unit-test-file",
  "part_name": "bracket",
  "stp_filename": "bracket.step",
  "volume_mm3": 12500,
  "obb_dimensions_mm": "48 x 32 x 18",
  "max_dim_mm": 48,
  "material_id": 1,
  "tolerance_grade": "ISO2768-m",
  "surface_treatment_ids": [2],
  "quantity": 100,
  "currency": "USD",
  "process": "cnc_milling_3axis",
  "drawing_available": false,
  "threaded_holes": 0,
  "critical_features": 0,
  "surface_finish_level": "standard",
  "lead_time_preference": "standard"
}
```

响应：

```json
{
  "quote_status": "estimated",
  "pricing_model_version": "quote-engine-v2.0",
  "currency": "USD",
  "confidence": "medium",
  "estimate_mode": "range",
  "review_required": false,
  "model_versions": {
    "pricing_model": "quote-engine-v2.0",
    "geometry_features": "geom-v2.0",
    "config": "2026-06-24-seed"
  },
  "part": {
    "file_id": "unit-test-file",
    "volume_mm3": 12500,
    "stock_volume_mm3": 27648,
    "removal_volume_mm3": 15148,
    "removal_ratio": 0.548,
    "surface_area_mm2": 6200,
    "max_dim_mm": 48,
    "weight_kg": 0.034
  },
  "total": {
    "low": 1240,
    "center": 1460,
    "high": 1680,
    "currency": "USD",
    "display": "$1,240 - $1,680"
  },
  "unit_price": {
    "low": 12.4,
    "center": 14.6,
    "high": 16.8,
    "currency": "USD",
    "display": "$12.40 - $16.80"
  },
  "customer_summary": [
    "Estimate based on geometry, material, quantity, tolerance and finish.",
    "Engineering review is recommended before formal quotation."
  ],
  "review_flags": [
    {
      "code": "missing_drawing_risk",
      "severity": "medium",
      "message": "Precision requirements may need drawing review."
    }
  ],
  "disclaimer": "This is a preliminary estimate and not a binding offer."
}
```

内部可记录但不展示：

```json
{
  "internal_cost_model": {
    "material_cost": 120,
    "programming_cost": 80,
    "setup_cost": 160,
    "roughing_cost": 420,
    "finishing_cost": 380,
    "inspection_cost": 90,
    "postprocess_cost": 60,
    "risk_buffer": 120
  }
}
```

## 8. 数据库设计

### 8.1 新增 `quote_geometry_features`

| 字段 | 类型 |
|---|---|
| id | int |
| inquiry_id | int |
| file_id | string |
| volume_mm3 | float |
| stock_volume_mm3 | float |
| removal_volume_mm3 | float |
| removal_ratio | float |
| surface_area_mm2 | float |
| surface_to_volume_ratio | float |
| max_dim_mm | float |
| min_dim_mm | float |
| aspect_ratio | float |
| compactness | float |
| geometry_feature_version | string |
| created_at | datetime |

### 8.2 新增 `quote_model_configs`

| 字段 | 类型 | 示例 |
|---|---|---|
| key | string | `machine_rate_usd_hour` |
| value | string | `45` |
| value_type | string | number |
| model_version | string | `quote-engine-v2.0` |
| description | string | 说明 |

第一批配置必须覆盖：

```text
machine_rate_usd_hour
engineering_rate_usd_hour
base_setup_min
setup_time_per_setup_min
base_programming_min
programming_complexity_min
base_inspection_min
minimum_order_usd
minimum_unit_usd
minimum_setup_usd
minimum_programming_usd
stock_allowance_mm
machine_max_dim_mm
```

### 8.3 新增 `material_process_rates`

| 字段 | 类型 |
|---|---|
| id | int |
| material_id | int |
| process | string |
| material_mrr_cm3_min | float |
| finish_surface_rate_cm2_min | float |
| machinability_factor | float |
| scrap_factor | float |

### 8.4 新增 `quote_model_runs`

保存每次估价所用模型和内部结果，便于回测。

| 字段 | 类型 |
|---|---|
| id | int |
| inquiry_id | int |
| pricing_model_version | string |
| geometry_feature_version | string |
| config_version | string |
| estimate_mode | string |
| confidence | string |
| review_required | bool |
| internal_cost_json | text |
| customer_result_json | text |
| created_at | datetime |

### 8.5 新增 `quote_review_flags`

| 字段 | 类型 |
|---|---|
| id | int |
| inquiry_id | int |
| code | string |
| severity | string |
| message | string |

### 8.6 新增 `quote_actuals`

用于后续机器学习校准。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int | 主键 |
| inquiry_id | int | 关联估价 |
| estimated_total_usd | float | 系统估价中心值 |
| final_quote_total_usd | float | 人工最终报价 |
| final_unit_price_usd | float | 人工最终单价 |
| accepted | bool | 客户是否接受 |
| notes | text | 报价员说明 |
| created_at | datetime | 创建时间 |

### 8.7 数据保留和隐私

上传文件和报价记录要分层保存：

| 数据 | 保存策略 |
|---|---|
| STEP 原文件 | 仅用于工程复核，后续可配置过期清理 |
| geometry features | 长期保存，用于模型校准 |
| customer result | 长期保存，用于报价追踪 |
| internal cost model | 仅内部可见，不返回前端 |
| final quote actuals | 长期保存，用于误差分析 |

## 9. 前端设计

### 9.1 表单保留主路径

保留：

| 字段 | 处理 |
|---|---|
| STEP upload | 保留 |
| Material | 保留 |
| Tolerance Grade | 保留，但文案改为 general tolerance |
| Surface Treatment | 保留 |
| Quantity | 保留 |
| Currency | 保留 |

新增 Advanced 小区域：

| 字段 | 默认 |
|---|---|
| Process | CNC Milling, 3-axis |
| Drawing available | No |
| Critical features | 0 |
| Threaded holes | 0 |
| Surface finish level | Standard |
| Lead time | Standard |

### 9.2 结果卡

结果展示要从“精确报价”改成“估价区间”。

```text
Instant Estimate
$1,240 - $1,680

Unit Price
$12.40 - $16.80 / pc

Confidence
Medium

Engineering Review
Recommended
```

如果 `review_required = true`：

```text
Engineering Review Required
Upload drawing or request formal quote.
```

### 9.3 不展示内部成本公式

客户界面不展示：

```text
machine_rate
MRR
programming minutes
setup count
margin
risk_rate
```

显示简短可信理由即可：

```text
Estimate considers geometry, selected material, quantity, tolerance and surface treatment.
```

## 10. 实施阶段

### Phase Q0: 行业调研和模型冻结

目标：确认报价系统定位和 v2 模型边界。

任务：

1. 本 PRD 评审。
2. 确认第一版只做 CNC milling 代理模型。
3. 确认输出区间，不输出单点正式价。
4. 确认工程复核触发条件。
5. 确认最低收费默认参数。
6. 确认 machine/material 初始参数来自 seed，而非前端。

验收：

```text
用户确认 PRD 方向。
最低收费、review gate、模型版本策略已确认。
```

### Phase Q0.5: 参数初稿和测试夹具

目标：在改代码前先固定一组可回归样例和参数表。

任务：

1. 新建 `backend/docs/quote_engine_v2_parameters.md`。
2. 新建或生成 6 个 STEP fixture：
   - cube_simple
   - long_bar
   - thin_plate
   - high_removal_block
   - small_part
   - precision_no_drawing
3. 确认第一批材料 MRR 和 finish rate 初始值。
4. 确认 minimum charge 初始值。

验收：

```text
fixtures 文件或生成脚本存在。
参数文档存在。
后续 Q1/Q2 测试可以引用这些固定样例。
```

### Phase Q1: 几何特征增强

目标：让 STEP 分析不仅返回体积和尺寸，还返回报价需要的代理特征。

任务：

1. `step_analyzer.py` 增加 surface area。
2. 增加 OBB 数值数组返回，不只返回字符串。
3. 计算 stock volume、removal volume、removal ratio。
4. 计算 aspect ratio、compactness、surface_to_volume_ratio。
5. 更新上传接口响应。
6. 更新 smoke test。
7. 增加 geometry feature version。

验收：

```text
上传 STEP 后返回 v2 geometry features。
旧 quote 上传流程不破坏。
fixtures 中至少 4 个样例能稳定解析。
```

### Phase Q2: 成本模型 v2

目标：替换当前多因素乘法为工艺时间分项模型。

任务：

1. 新建 `backend/services/quote_geometry.py`。
2. 新建 `backend/services/quote_cost_model.py`。
3. 新建 `backend/services/quote_risk.py`。
4. 新增配置 seed：
   - machine rate
   - engineering rate
   - base setup time
   - material MRR
   - finish surface rate
   - risk rates
   - minimum charges
5. 实现 `estimate_mode`。
6. `calculate_quote()` 返回区间价格和 confidence。

验收：

```text
phase1A smoke test 更新后通过。
结果有 low/center/high。
结果不暴露内部费率。
小件不会低于 minimum_unit_usd。
```

### Phase Q3: 风险分级和人工复核

目标：让系统知道什么时候不要强行报价。

任务：

1. 实现 review flags。
2. 高风险件返回 `review_required = true`。
3. 前端结果展示 review 状态。
4. `request_formal_quote` 保存 review flags。
5. `review_required` 时不输出看似确定的价格中心值。

验收：

```text
薄件、长细件、高去除率、精密公差无图纸等场景能触发 review。
普通 cube_simple 不触发 review_required。
```

### Phase Q4: 前端体验升级

目标：把报价从“一个数字”改成“专业估价区间”。

任务：

1. 结果卡显示 total range。
2. 显示 unit price range。
3. 显示 confidence。
4. 显示 review recommended/required。
5. 增加 Advanced 区域。
6. 保留进度条体验。
7. review_required 时主 CTA 指向 formal quote。

验收：

```text
桌面和移动端无文本溢出。
客户能明确知道这是 estimate。
review_required 状态不会显示误导性的精准总价。
```

### Phase Q5: 历史报价校准准备

目标：为以后 ML 校准积累数据。

任务：

1. 增加 `quote_actuals`。
2. 增加后台脚本录入人工最终报价。
3. 增加误差报表：
   - estimated center
   - final quote
   - absolute error
   - percentage error
4. 当样本量达到 100 条后，考虑线性回归或 GBDT 残差校准。
5. 增加按材料、尺寸、confidence 分组的误差统计。

验收：

```text
每一条正式询盘可以回填人工报价。
系统能导出训练 CSV。
```

## 11. 测试计划

### 11.1 几何测试

| Case | 预期 |
|---|---|
| cube_simple | compactness 接近 1，review_required false |
| long_bar | aspect_ratio 高，slender_part_risk |
| thin_plate | thin_part_risk |
| high_removal_block | removal_ratio 高，加工成本上升 |
| small_part | tiny_part_risk，触发 minimum_unit_usd |
| precision_no_drawing | missing_drawing_risk，review_required true |

### 11.2 成本模型测试

| Case | 预期 |
|---|---|
| 数量增加 | 单件价格下降 |
| 材料换钛 | 价格上升 |
| removal_ratio 上升 | 加工成本上升 |
| 精密公差 | inspection 和 risk 上升 |
| 后处理影响公差 | review flag |
| 小件低成本 | unit price 不低于 minimum_unit_usd |
| 低数量订单 | total 不低于 minimum_order_usd |
| 模型版本变更 | quote_model_runs 记录新版本 |

### 11.3 API 测试

| Case | 预期 |
|---|---|
| 常规件 | 返回 range 和 medium/high confidence |
| 高风险件 | review_required true |
| quantity = 0 | 400 |
| unsupported currency | 400 |
| 响应扫描 | 不包含 machine_rate、margin、MRR、internal_cost_model |
| 模型版本 | 响应含 model_versions |
| review_required | estimate_mode 为 review_required 或 range_with_review |

### 11.4 前端测试

| Case | 预期 |
|---|---|
| 上传 STEP 并计算 | 显示总价区间 |
| review_required | 显示人工复核提示 |
| 移动端 | 卡片不挤压、不溢出 |
| 后端失败 | 保留错误状态 |
| Advanced 默认折叠 | 主流程仍然清爽 |
| 不展示内部数据 | 页面不显示 MRR、machine rate、margin |

## 12. 关键决策

建议采用以下默认决策：

```text
1. 不再使用全局连乘作为主模型。
2. 第一版只做 CNC milling 代理成本模型。
3. 输出价格区间，不输出单点正式价。
4. 高风险件触发人工复核。
5. LLM 暂不参与核心计算。
6. 从第一版开始保存几何特征和估价结果，为历史校准做准备。
```

## 13. 为什么暂不直接用 LLM

如果把同一份 3D 图给 LLM 或生成式 AI，AI 通常不会真正执行严谨的几何和工艺计算。它可能做这些事：

| 能力 | 可靠性 |
|---|---|
| 解释图纸文字 | 中等到高 |
| 总结材料和工艺风险 | 中等 |
| 识别明显 DFM 风险 | 中等，需要视觉/几何工具 |
| 精确计算体积、孔、壁厚 | 低，除非连接 CAD kernel |
| 直接给最终价格 | 低，容易幻觉 |

更合理的 AI 角色：

```text
CAD kernel 负责几何计算
规则模型负责工程估算
历史数据模型负责校准
LLM 负责解释、询盘摘要、报价员辅助
```

因此本项目本地第一版应先把几何特征和工艺时间模型做稳。等有真实报价数据后，再考虑 ML 校准；等业务需要更强解释或询盘自动化时，再引入 LLM。

## 14. 下一步

确认本 PRD 后，从 Phase Q1 开始：

1. 先做 Phase Q0.5，固定参数初稿和 STEP fixtures。
2. 增强 `step_analyzer.py` 的几何特征输出。
3. 保持旧报价接口兼容。
4. 新建 v2 成本模型，但先不改变前端展示。
5. 用测试确认新旧接口都能运行。

完成 Q1/Q2 后，再升级前端结果卡。
