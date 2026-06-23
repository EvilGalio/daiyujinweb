# 精密制造企业商务插件 · 任务计划书

> **项目代号**：Daiyujin Precision Tools
> **版本**：v1.1.1
> **日期**：2026-06-23
> **来源**：Task 1 from Johnson
> **计划书作者**：待雨尽（Gorain）& 智子（Hanako）
>
> **v1.1.1 修订**：Phase -1 状态改为待验证（☐）；域名替换为当前真实域名 daiyujin.dpdns.org；运费 Excel 导入落地到具体 sheet（区域/区域运费DHL/区域运费FedEX/广诚FedEx运费/广诚DHL运费），新增中间 JSON 解析策略。
>
> **v1.1 修订说明**：新增部署方案、Phase -1 技术验证、MVP 范围收缩、公共/管理接口分层、报价免责声明、ReadStep 重构定义、公差公式统一。执行顺序调整为：运费/公差先行，报价器最后。

---

## 目录

- [0. 总体架构](#0-总体架构)
- [1. 部署方案](#1-部署方案)
- [2. 插件一：报价计算器](#2-插件一报价计算器)
- [3. 插件二：国家重量运费计算器](#3-插件二国家重量运费计算器)
- [4. 插件三：公差计算展示](#4-插件三公差计算展示)
- [5. ReadStep 重构：抽离为 Web 服务](#5-readstep-重构抽离为-web-服务)
- [6. 后端架构与数据库设计](#6-后端架构与数据库设计)
- [7. 开发分期与里程碑](#7-开发分期与里程碑)
- [A. 附录](#a-附录)

---

## 0. 总体架构

### 0.1 系统定位

本系统为精密材料/零件提供商面向全球客户的商务工具集，部署于企业网站（daiyujinweb），提供三个独立的功能插件：

| 编号 | 插件名称 | 核心能力 | 用户角色 | MVP 优先级 |
|------|----------|----------|----------|------------|
| P1 | 报价计算器 | STP 上传 → 解析 → 参数选择 → 估价（Estimated Quote） | 客户 | 第三批（风险最高） |
| P2 | 运费计算器 | 国家 + 重量 → DHL/FedEx 运费查询 | 客户 | 第一批 |
| P3 | 公差计算器 | 基本尺寸 + 配合类型 → ISO 286 公差查询 | 客户 | 第二批 |

### 0.2 技术架构总览

```
┌──────────────────────────────────────────────────────┐
│              前端（GitHub Pages 静态托管）              │
│  quote.html    freight.html    tolerance.html         │
│       │              │               │                │
│       └──────────────┼───────────────┘                │
│                      │                                │
│              fetch() → API 域名                        │
│                      │                                │
├──────────────────────┼────────────────────────────────┤
│          Cloudflare（DNS / HTTPS / 反代 / 防护）        │
│                      │                                │
├──────────────────────┼────────────────────────────────┤
│           后端 API Server（独立部署，见第1章）           │
│                      │                                │
│   /api/public/*     /api/admin/*                      │
│                      │                                │
│               OCC (pythonocc-core)                    │
│                      │                                │
├──────────────────────┼────────────────────────────────┤
│              数据库（SQLite → 可迁移 PostgreSQL）        │
│   materials    freight_rates    inquiries              │
│   admin_users  coefficients                           │
└──────────────────────────────────────────────────────┘
```

### 0.3 设计原则

1. **安全第一**：所有商业参数（材料单价、系数、运费表）只存在于后端数据库，前端零暴露。
2. **接口分层**：公共 API 只返回展示用字段（id / name / display_label）；商业字段（单价 / 系数 / 成本）仅管理后台可见。
3. **可追溯**：每次客户计算报价/运费，后端自动记录询盘日志。
4. **管理员可控**：参数修改通过受认证的管理后台完成，不涉及代码部署。
5. **前端纯静态**：三个插件页面是纯 HTML/CSS/JS，托管于 GitHub Pages，不依赖任何服务端渲染。
6. **渐进式交付**：三个插件独立开发、独立上线。运费/公差先行（无文件上传、无 OCC 依赖），报价器最后（风险最高）。

### 0.4 前端页面规划

三个插件各自独立页面，挂载在现有 daiyujinweb 站点导航中：

```
daiyujinweb/
├── index.html           # 首页（新增三个插件入口）
├── about.html           # 关于
├── quote.html           # [新] 报价计算器
├── freight.html         # [新] 运费计算器
├── tolerance.html       # [新] 公差计算器
├── css/
│   └── plugins.css      # [新] 插件共用样式
├── js/
│   ├── quote.js         # [新] 报价计算器前端逻辑
│   ├── freight.js       # [新] 运费计算器前端逻辑
│   └── tolerance.js     # [新] 公差计算器前端逻辑
├── backend/             # [新] 后端代码（独立仓库或子目录，不部署在 GitHub Pages）
│   ├── app.py
│   ├── models.py
│   ├── routes/
│   │   ├── public/      # 公共 API（客户页面调用）
│   │   └── admin/       # 管理后台 API（认证访问）
│   ├── services/
│   │   ├── step_analyzer.py    # [重构自 ReadStep] STP 解析服务
│   │   ├── pricing.py          # 报价引擎
│   │   ├── freight.py          # 运费查表
│   │   └── tolerance.py        # ISO 286 公差计算
│   └── requirements.txt
├── data/
│   ├── daiyujin.db      # SQLite 数据库（运行时生成）
│   └── D重量运费.xlsx    # 运费源数据
└── ...
```

页面导航栏更新为：

> **Daiyujin's Space** | 首页 · 报价计算 · 运费查询 · 公差查询 · 关于

### 0.5 API 接口分层规范

**公共接口**（`/api/public/*`）：客户页面调用，不认证，不暴露商业敏感字段。

| 返回内容 | 示例 |
|----------|------|
| 材质 | `{ id: 4, name: "Aluminum 6061-T6", density_gcm3: 2.70 }` |
| 公差等级 | `{ grade: "IT7", label: "IT7 — 精密加工" }` |
| 后处理 | `{ id: 1, name: "阳极氧化（本色）" }` |
| 货币 | `{ code: "EUR", symbol: "€", label: "Euro" }` |
| 报价结果 | 含明细但不含各系数的原始数值（只含最终价格和系数标签） |

**管理接口**（`/api/admin/*`）：管理后台调用，需认证，返回完整商业字段。

| 返回内容 | 示例 |
|----------|------|
| 材质（完整） | 含 `unit_price_usd_kg` |
| 公差等级（完整） | 含 `factor` |
| 后处理（完整） | 含 `cost_usd` |
| 运费表 | 含完整 `base_price` / `unit_price` |

> 核心原则：客户永远只能看到"选了 Aluminum 6061-T6"，而不知道它的单价是 $6.50/kg。报价结果展示的是总额和构成说明，不是每个系数的数值。

### 0.6 免责声明与报价状态

报价计算器产出的不是正式报价单，而是**估价（Estimated Quote）**。每个报价结果必须明确标注：

- `quote_status: "estimated"` — 标明这是估价，非最终报价
- `valid_until` — 估价有效期（默认 7 天）
- `disclaimer` — 标准免责文案
- 不含税费、运费、关税（明确排除项）
- "Request Formal Quote" 按钮 → 将当前估价参数发送为正式询盘

**免责文案模板**：

> This is an automated estimate based on your selected parameters. It does not constitute a binding offer. Final pricing may vary after engineering review and is subject to material availability, exchange rate fluctuations, and applicable taxes, duties, and shipping costs. To receive a formal quotation, please submit an inquiry — our engineers will review your STEP file and respond within 1–2 business days.

### 0.7 MVP 范围定义

v1.0 的范围从"三个插件完整实现 + 管理后台"收缩为可交付的最小闭环：

| MVP 包含 | MVP 不包含（v2.0+） |
|----------|---------------------|
| Phase -1 技术验证全部通过 | 汇率 API 自动更新 |
| Phase 1B 运费计算器（前端+后端+测试） | 管理后台完整 UI（v1.0 用 SQLite 直改或简易管理页） |
| Phase 1C 公差计算器（前端+后端+测试） | 报价 PDF 导出 |
| Phase 1A 报价计算器核心链路 | 询盘邮件通知 |
| 公共/管理接口分层 | 阶梯定价多维度扩展 |
| 询盘自动记录 | 数据库迁 PostgreSQL |
| 免责声明 | GD&T 扩展 |

---

## 1. 部署方案

### 1.1 基础设施选型

当前 daiyujinweb 托管于 **GitHub Pages**，该服务仅支持静态内容（HTML/CSS/JS），不能运行 Flask 或 OCC。因此采用**前后端分离部署**：

```
┌─────────────────────────────────────────────────────┐
│                  Cloudflare                          │
│         DNS · HTTPS (SSL) · 反向代理 · DDoS 防护      │
│                                                     │
│  daiyujin.dpdns.org ─┬── /api/* ──▶ API Server      │
│                      │         (api.daiyujin.dpdns.org)│
│                    │                                 │
│                    └── 其他路径 ──▶ GitHub Pages       │
│                                     (静态前端)        │
└─────────────────────────────────────────────────────┘
```

| 组件 | 托管平台 | 说明 |
|------|----------|------|
| 前端静态页面 | **GitHub Pages** | 现有站点，零成本，自动 HTTPS |
| DNS / CDN / 防护 | **Cloudflare** | 免费计划足够。配置子域名 API 路由指向后端 |
| 后端 API | **独立部署**（见 1.2） | Flask + OCC，需要能运行原生 Python C 扩展的环境 |

### 1.2 后端部署选项

按推荐度排序：

| 方案 | 适用场景 | 月费估算 | OCC 兼容 | 说明 |
|------|----------|----------|----------|------|
| **VPS（首选）** | 生产环境，长期运行 | $5–20 | ✅ 完整 Linux 环境 | 推荐 Hetzner / DigitalOcean / Vultr。可同时部署 API 和管理后台 |
| **Render / Fly.io** | 快速上线，免运维 | $0–25 | ⚠️ 需 Docker 化 OCC | 免费计划有冷启动；OCC 依赖需 Docker 镜像 |
| **Railway** | 同上 | $5+ | ⚠️ 需 Docker 化 | 比 Render 冷启动更快 |
| **Windows Server（自管）** | 已有 Windows 服务器 | 已有 | ✅ OCC Windows 兼容好 | 与 ReadStep 现有环境一致，部署最简单 |
| **Cloudflare Workers** | ❌ 不推荐 | — | ❌ 不支持原生 C 扩展 | Python Workers beta 无法运行 pythonocc-core |

**v1.0 推荐方案**：

- **开发/测试阶段**：本地 Windows（当前 ReadStep 运行环境）直接跑 Flask dev server
- **生产阶段**：VPS（Ubuntu 22.04）+ Docker，或 Windows Server + Waitress

### 1.3 Cloudflare 配置要点

1. 添加 DNS A 记录：`api.daiyujin.dpdns.org` → 后端服务器 IP
2. SSL/TLS 模式：**Full (strict)**（Cloudflare ↔ 源服务器也走 HTTPS）
3. 页面规则：`api.daiyujin.dpdns.org/*` → Cache Level: Bypass（API 响应不缓存）
4. 前端页面中的 API 请求统一走 `https://api.daiyujin.dpdns.org/api/public/*`

> **开发阶段**：后端在本地运行时，前端 API 地址使用 `http://localhost:5000`。生产部署后切换为上述域名。建议前端使用配置文件（如 `js/config.js`）统一管理 API base URL。

### 1.4 CORS 配置

后端 API 仅允许以下来源的跨域请求：

```
Access-Control-Allow-Origin: https://daiyujin.dpdns.org
```

管理后台由于部署在后端同域（`https://api.daiyujin.dpdns.org/admin`），无需 CORS。

---

## 2. 插件一：报价计算器

### 2.1 功能定义

#### 2.1.1 用户故事

> 作为一名海外采购商，我希望在供应商网站上直接上传 STP 文件，选择材质、公差和后处理工艺，立即获得一个 Estimated Quote（估价），这样我可以在不发送邮件的前提下快速评估项目成本。

#### 2.1.2 交互流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. 上传  │───▶│ 2. 解析  │───▶│ 3. 确认  │───▶│ 4. 选参  │───▶│ 5. 估价  │───▶│ 6. 询盘  │
│  STP文件 │    │  展示结果 │    │  零件信息 │    │  材质等  │    │  输出结果 │    │  正式询盘 │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

**Step 1：上传 STP 文件**

- 用户点击上传区域或拖拽单个 `.stp` / `.step` 文件
- 前端校验文件扩展名，限制文件大小（≤ 50MB）
- 通过 AJAX 上传至后端 `/api/public/quote/upload`（支持上传进度条）

**Step 2：解析与展示**

- 后端调用 `services/step_analyzer.py`（重构自 ReadStep，详见第5章）：
  - 提取 OBB 精确尺寸（mm）
  - 计算体积（mm³）
  - 生成 PNG 缩略图（3840×2880 渲染 → 压缩至 Web 展示尺寸）
  - 返回 `volume_mm3` / `dimensions` / `thumbnail_url`，**不返回重量**（重量由报价服务根据用户选择的材质动态计算）
- 返回 JSON，缩略图走独立静态资源 URL

**Step 3：零件信息确认框**

- 前端渲染一个信息卡片：
  - **3D 缩略图**（可点击放大 lightbox）
  - **尺寸**（mm）：长 × 宽 × 高
  - **体积**（cm³）
  - **重量**（kg）：初始显示"请选择材质"，选择后动态计算并更新
- 卡片下方是参数选择区域

**Step 4：参数选择**

用户通过表单选择以下参数。注意：前端只能拿到展示用字段（如材质名称和密度），拿不到单价。

| 参数 | 控件类型 | 说明 | 数据来源 |
|------|----------|------|----------|
| 材质 | 下拉选择（可搜索） | 显示名称+密度；切换时前端用密度×体积算重量并实时更新显示 | `GET /api/public/materials` |
| 公差等级 | 下拉选择 | 如 IT6、IT7 等，显示名称+说明 | `GET /api/public/tolerance-grades` |
| 后处理 | 多选复选框 | 显示工艺名称 | `GET /api/public/surface-treatments` |
| 数量 | 数字输入（正整数） | 触发阶梯系数 | 前端输入 |
| 货币 | 下拉选择 | 默认 USD，可选 EUR/CNY/JPY/GBP 等 | `GET /api/public/currencies` |

**Step 5：计算估价**

- 用户点击"Calculate Estimate"按钮
- 前端将参数（id 引用）发送至后端 `POST /api/public/quote/calculate`
- 后端从数据库读取完整商业参数，执行报价公式，返回结构化结果
- 前端渲染估价卡片

**Step 6：正式询盘（可选）**

- 估价卡片底部有"Request Formal Quote"按钮
- 点击后，后端将当前估价快照 + 上传的 STP 文件引用保存为正式询盘记录
- 前端展示确认信息："Your inquiry has been submitted. Our engineers will review your STEP file and respond within 1–2 business days."

### 2.2 数据模型

#### 2.2.1 输入定义

```json
{
  "file_id": "uuid-of-uploaded-stp",
  "material_id": 4,
  "tolerance_grade": "IT7",
  "surface_treatment_ids": [1, 4],
  "quantity": 100,
  "currency": "EUR"
}
```

#### 2.2.2 输出定义

```json
{
  "quote_id": "uuid",
  "quote_status": "estimated",
  "valid_until": "2026-06-30T23:59:59Z",
  "disclaimer": "This is an automated estimate... [完整免责文案]",
  "part_info": {
    "name": "ID0734-G-TORNITO",
    "dimensions_mm": "132.50 × 89.30 × 45.12",
    "volume_cm3": 423.87,
    "material": {
      "name": "Aluminum 6061-T6",
      "density_gcm3": 2.70
    },
    "weight_kg": 1.144
  },
  "pricing_breakdown": {
    "material_cost_label": "Material (Al 6061-T6)",
    "base_manufacturing_label": "Base MFG (dimension range 50-150mm)",
    "tolerance_label": "Tolerance IT7 (precision machining)",
    "surface_treatment_labels": ["Anodizing Natural", "Sandblasting"],
    "quantity_tier_label": "Qty 100 (tier 100-499)",
    "unit_price": 51.12,
    "total_price": 5112.00
  },
  "exclusions": ["Tax", "Shipping", "Customs duties"],
  "currency": "EUR",
  "exchange_rate": 0.92,
  "generated_at": "2026-06-23T12:00:00Z"
}
```

**关键设计**：`pricing_breakdown` 只返回标签字符串和各行的**结果金额**，不返回系数因子数值。例如客户看到"Tolerance IT7 (precision machining): included"而非"Tolerance factor: ×1.25"。这保证了商业参数的零暴露。

#### 2.2.3 报价公式（v1.0 基础版）

$$
P_{\text{unit}} = \big( M + B \big) \times F_{\text{tol}} + \sum S_i
$$

$$
P_{\text{total}} = P_{\text{unit}} \times Q \times F_{\text{qty}}
$$

其中：

| 符号 | 含义 | 说明 |
|------|------|------|
| $M$ | 材料成本 | $M = W \times C_{\text{mat}}$，$W$ 为重量(kg)，$C_{\text{mat}}$ 为材料单价(USD/kg) |
| $B$ | 基础制造成本 | 尺寸复杂度系数 × 基准工时费率，v1.0 简化为固定查表值 |
| $F_{\text{tol}}$ | 公差系数 | 例如 IT6=1.5, IT7=1.25, IT8=1.0（从数据库读取） |
| $S_i$ | 单项后处理费用 | 每个选中后处理的固定费用（USD），可叠加 |
| $Q$ | 数量 | 用户输入 |
| $F_{\text{qty}}$ | 数量阶梯系数 | 从数据库数量阶梯表匹配 |

**数量阶梯系数示例（v1.0 假设值，实际由管理员配置）：**

| 数量区间 | 系数 |
|----------|------|
| 1 – 9 | 1.00 |
| 10 – 49 | 0.92 |
| 50 – 99 | 0.85 |
| 100 – 499 | 0.78 |
| 500 – 999 | 0.72 |
| 1000+ | 0.65 |

#### 2.2.4 货币转换

$$
P_{\text{converted}} = P_{\text{USD}} \times R_{\text{target}}
$$

汇率 $R$ 从数据库 `exchange_rates` 表读取。v1.0 使用手动维护的汇率值；v2.0 可接入外部汇率 API 实现每日自动更新。

### 2.3 计算引擎设计

#### 2.3.1 材质密度与重量计算

ReadStep 当前硬编码密度 7.85 g/cm³。重构后的 `step_analyzer.py` 返回体积 $V$（mm³），重量由报价服务按 $W = V \times 10^{-3} \times \rho$ 计算（$V$ 单位为 cm³ 时乘一次转换因子）。

用户切换材质时，前端用已缓存的体积和用户选中的密度，调用 `POST /api/public/quote/recalculate-weight` 或本地计算（如果密度已在前端展示），实时更新重量显示。

**v1.0 预置材质表（合理假设，管理员可增删）：**

| ID | 材质名称 | 密度 (g/cm³) | 单价 (USD/kg) [管理端字段] |
|----|----------|-------------|---------------------------|
| 1 | Carbon Steel (AISI 1045) | 7.85 | 2.50 |
| 2 | Stainless Steel 304 | 7.93 | 8.00 |
| 3 | Stainless Steel 316 | 8.00 | 12.00 |
| 4 | Aluminum 6061-T6 | 2.70 | 6.50 |
| 5 | Aluminum 7075-T6 | 2.81 | 9.00 |
| 6 | Titanium Grade 5 (Ti-6Al-4V) | 4.43 | 45.00 |
| 7 | Brass (C360) | 8.50 | 10.00 |
| 8 | Copper (C110) | 8.96 | 14.00 |
| 9 | POM (Delrin) | 1.41 | 4.00 |
| 10 | PEEK | 1.32 | 80.00 |

> 注：v1.0 板材/棒材等原料形态影响单价。后续"材质项目"将引入形态维度。当前假设为棒材/块材基础价。公共 API 只返回 id/name/density_gcm3，不返回 unit_price_usd_kg。

#### 2.3.2 公差系数

**v1.0 预置公差系数表（合理假设）：**

| 公差等级 | 系数 [管理端字段] | 公共接口标签 |
|----------|-------------------|-------------|
| IT5 | 2.20 | IT5 — 精密磨削 |
| IT6 | 1.50 | IT6 — 精磨/精密车削 |
| IT7 | 1.25 | IT7 — 精密加工 |
| IT8 | 1.00 | IT8 — 标准加工 |
| IT9 | 0.90 | IT9 — 一般加工 |
| IT10 | 0.80 | IT10 — 粗加工 |
| IT11 | 0.70 | IT11 — 粗加工 |

#### 2.3.3 后处理工艺

**v1.0 预置后处理表（合理假设）：**

| ID | 工艺名称 | 费用 (USD) [管理端字段] |
|----|----------|------------------------|
| 1 | 阳极氧化（本色） | 5.00 |
| 2 | 阳极氧化（黑色） | 6.50 |
| 3 | 硬质阳极氧化 | 12.00 |
| 4 | 喷砂 | 3.00 |
| 5 | 抛光 | 8.00 |
| 6 | 镀锌 | 4.00 |
| 7 | 镀镍 | 7.00 |
| 8 | 钝化 | 3.50 |
| 9 | 热处理（淬火+回火） | 15.00 |
| 10 | 渗碳 | 18.00 |

公共 API 只返回 id 和 name，不返回 cost_usd。

#### 2.3.4 基础制造成本

v1.0 简化方案：根据零件最大尺寸查表。

| 最大尺寸范围 (mm) | 基础制造成本 (USD) [管理端字段] |
|-------------------|-------------------------------|
| ≤ 50 | 20.00 |
| 50 – 150 | 35.00 |
| 150 – 300 | 55.00 |
| 300 – 500 | 90.00 |
| > 500 | 150.00 |

### 2.4 接口清单（公共）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/public/quote/upload` | 上传 STP 文件，返回 file_id 和解析结果 |
| GET | `/api/public/quote/thumbnail/<file_id>` | 获取缩略图 |
| POST | `/api/public/quote/recalculate-weight` | 切换材质时重新计算重量 |
| POST | `/api/public/quote/calculate` | 执行完整报价计算（估价） |
| GET | `/api/public/materials` | 获取材质列表（id/name/density 仅展示字段） |
| GET | `/api/public/tolerance-grades` | 获取公差等级列表（id/label 仅展示字段） |
| GET | `/api/public/surface-treatments` | 获取后处理列表（id/name 仅展示字段） |
| GET | `/api/public/currencies` | 获取可用货币列表 |
| POST | `/api/public/quote/request-formal` | 将估价转为正式询盘 |

### 2.5 UI/UX 规格

#### 2.5.1 布局结构

```
┌─────────────────────────────────────────────┐
│  [导航栏: 首页 · 报价计算 · 运费 · 公差 · 关于]   │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │        📦 拖拽 STP 文件到此处          │    │
│  │           或点击上传                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌────── 解析中... ──────┐                  │
│  │  [进度条] 正在解析零件... │                  │
│  └────────────────────────┘                  │
│                                             │
│  ┌────────── 零件信息 ──────────┐            │
│  │  ┌──────┐                   │            │
│  │  │3D图片 │   尺寸: 132×89×45 │            │
│  │  │      │   体积: 423.9 cm³ │            │
│  │  │      │   重量: 1.14 kg   │            │
│  │  └──────┘                   │            │
│  └──────────────────────────────┘            │
│                                             │
│  ┌────────── 参数选择 ──────────┐            │
│  │  材质:    [▼ 搜索选择...]    │            │
│  │  公差:    [▼ IT7 — 精密加工] │            │
│  │  后处理:  [☑ 阳极氧化（本色）] │            │
│  │           [☑ 喷砂]          │            │
│  │           [ ] 抛光          │            │
│  │  数量:    [  100  ]         │            │
│  │  货币:    [▼ EUR (€)]       │            │
│  │                             │            │
│  │  [  📊 Calculate Estimate  ]│            │
│  └──────────────────────────────┘            │
│                                             │
│  ┌────────── Estimated Quote ──────────┐    │
│  │  ⚠ This is an automated estimate.   │    │
│  │  Valid until: 2026-06-30             │    │
│  │                                      │    │
│  │  Material (Al 6061-T6)        € 4.21│    │
│  │  Base MFG                     €32.20│    │
│  │  Tolerance (IT7)              incl. │    │
│  │  Surface: Anodizing + SB      € 7.82│    │
│  │  ─────────────────────────────────  │    │
│  │  Qty tier (100-499): ×0.78          │    │
│  │  Unit Price:           € 47.03      │    │
│  │  Total (100 pcs):      €4,703.00    │    │
│  │                                      │    │
│  │  Excludes: Tax, Shipping, Customs    │    │
│  │                                      │    │
│  │  [ 📩 Request Formal Quote ]         │    │
│  └──────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

#### 2.5.2 视觉规范

- 颜色：沿用现有 Apple 风格，`#007aff` 主色调，`#e5e5ea` 分隔线
- 字体：系统字体栈（`-apple-system, BlinkMacSystemFont, "Segoe UI", ...`）
- 容器：`max-width: 760px`，居中
- 上传区域：虚线边框，2:1 宽高比矩形，hover 时高亮
- 估价结果卡片：浅灰背景（`#f5f5f7`），数字加粗右对齐
- 免责声明以琥珀色/橙色警告条展示

#### 2.5.3 状态流转

```
[初始态] ──上传──▶ [上传中] ──成功──▶ [解析中] ──成功──▶ [参数选择] ──点击计算──▶ [计算中] ──成功──▶ [估价展示]
                    │                    │                                │
                    └──失败──▶ [错误提示]  └──失败──▶ [错误提示]             └──失败──▶ [错误提示]
                                                                                       │
                                                                         [Request Formal Quote]
                                                                                       │
                                                                               [询盘确认提示]
```

### 2.6 测试用例

| 编号 | 场景 | 输入 | 预期输出 |
|------|------|------|----------|
| T1.1 | 正常估价 | 上传有效 STP，选 AL6061，IT7，无后处理，数量 10，USD | 返回完整估价，quote_status=estimated，含免责声明 |
| T1.2 | 材质切换 | 钢材 → AL6061 | 重量从钢材值变更为 AL6061 值（密度比例 7.85/2.70） |
| T1.3 | 数量阶梯 | 数量=5 vs 数量=500 | 前者系数 1.00，后者系数 0.72 |
| T1.4 | 多个后处理 | 选阳极氧化 + 喷砂 | 后处理合计 $8.00 |
| T1.5 | 无后处理 | 不选任何后处理 | $\sum S_i = 0$ |
| T1.6 | 无效文件 | 上传 .txt 文件 | 前端阻止上传，提示"仅支持 STP/STEP 文件" |
| T1.7 | 损坏的 STP | 上传非标准 STP | 后端返回解析失败，前端提示具体错误 |
| T1.8 | 货币转换 | 选 EUR，汇率假设 0.92 | 转换后价格 = USD 价格 × 0.92 |
| T1.9 | 超大数量 | 数量=999999 | 返回合理估价，不溢出，不崩溃 |
| T1.10 | 正式询盘 | 估价完成后点 Request Formal Quote | 询盘记录写入 inquiries 表，前端显示确认信息 |
| T1.11 | 前端无法获取商业参数 | 浏览器 Network 面板检查公共 API 响应 | 不包含 unit_price_usd_kg / factor / cost_usd |

### 2.7 风险与约束

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| STP 文件过大导致解析超时 | 中 | 限制文件大小（≤ 50MB），超时 60s 后返回错误 |
| OCC 对某些 STEP 版本兼容性不足 | 中 | 预处理时检测格式版本，不兼容时给出明确提示 |
| 材质/系数数据不准确导致估价偏差 | 高 | 所有参数放在管理员后台，提供批量导入/导出，方便校准。估价明确标注为 estimated |
| 单个服务器 OCC 并发解析性能瓶颈 | 低 | v1.0 为单用户场景设计，后续可引入队列（Celery/Redis） |
| 客户以为估价即正式报价 | 中 | 多处标注 "Estimated"、有效期、免责声明、排除项；正式报价须经工程师审核 |

---

## 3. 插件二：国家重量运费计算器

### 3.1 功能定义

#### 3.1.1 用户故事

> 作为一名海外采购商，我希望在选定零件和数量后，直接查询 DHL 和 FedEx 从中国发往我国的具体运费，这样我可以把运费纳入总成本评估。

#### 3.1.2 交互流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. 输入  │───▶│ 2. 查询  │───▶│ 3. 展示  │
│ 国家+重量 │    │ 后端查表  │    │ 对比结果  │
└──────────┘    └──────────┘    └──────────┘
```

**Step 1：输入**

| 输入项 | 控件 | 说明 |
|--------|------|------|
| 目的地国家 | 下拉选择（可搜索） | 列出 DHL/FedEx 运费表中所有目的国 |
| 重量 | 数字输入 | 单位 kg，最小 0.5 kg，步长 0.5 |
| 快递商 | 多选复选框 | 默认全选 DHL + FedEx |
| 货币 | 下拉选择 | 默认根据目的国自动推荐，可手动切换 |

**Step 2：查询**

- 前端发送请求至 `POST /api/public/freight/calculate`
- 后端在 `freight_rates` 表中匹配：国家（精确）+ 重量（区间）+ 快递商
- 返回每个快递商的运费明细

**Step 3：展示**

- 并列卡片展示 DHL 和 FedEx 的结果
- 每条结果含：快递商名称、运费金额、时效（如有）、备注（如有）
- 支持货币转换

### 3.2 数据模型

#### 3.2.1 运费表数据结构

根据 `D重量运费.xlsx` 的预期结构，设计数据库表：

```sql
CREATE TABLE freight_rates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    carrier       TEXT NOT NULL,       -- 'DHL' | 'FedEx'
    source_sheet  TEXT,                -- 来源 sheet 名（可追溯）
    zone          TEXT,                -- 区域代码
    country       TEXT NOT NULL,       -- 目的国英文名
    country_cn    TEXT,                -- 目的国中文名
    currency      TEXT NOT NULL,       -- 该条目的计价货币（默认 CNY）
    weight_min    REAL NOT NULL,       -- 重量区间下界 (kg)
    weight_max    REAL,                -- 重量区间上界 (kg, NULL表示无上限)
    base_price    REAL NOT NULL,       -- 基础运费
    unit_price    REAL,                -- 每公斤续重单价（若非阶梯价则为NULL）
    first_weight  REAL,                -- 首重 (kg)（若有首重/续重结构）
    est_transit_days TEXT,             -- 预估时效，如 "3-5 days"
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> 注：实际表结构将根据 `D重量运费.xlsx` 中间 JSON 的解析结果进行调整。多 sheet 数据通过 `POST /api/admin/freight/import` 统一导入，source_sheet 和 zone 字段保留数据来源追溯。

#### 3.2.2 输入定义

```json
{
  "country": "Germany",
  "weight_kg": 12.5,
  "carriers": ["DHL", "FedEx"],
  "currency": "EUR"
}
```

#### 3.2.3 输出定义

```json
{
  "results": [
    {
      "carrier": "DHL",
      "freight_amount": 262.20,
      "display_currency": "EUR",
      "original_currency": "USD",
      "original_amount": 285.00,
      "exchange_rate": 0.92,
      "est_transit_days": "3-5 days",
      "note": null
    },
    {
      "carrier": "FedEx",
      "freight_amount": 247.02,
      "display_currency": "EUR",
      "original_currency": "USD",
      "original_amount": 268.50,
      "exchange_rate": 0.92,
      "est_transit_days": "4-6 days",
      "note": "含燃油附加费"
    }
  ],
  "weight_kg": 12.5,
  "country": "Germany"
}
```

### 3.3 计算逻辑

#### 3.3.1 运费查表算法

运费表的核心是**二维查找**：国家 + 重量。后端查表逻辑：

```
输入: country, weight, carrier
1. SELECT * FROM freight_rates WHERE carrier=X AND country=Y
2. 找出 weight_min ≤ weight < weight_max（若无 weight_max 则为最后区间）
3. 若匹配行有 unit_price: 运费 = base_price + CEIL((weight - first_weight) / step) × unit_price
4. 若匹配行无 unit_price: 运费 = base_price（阶梯价）
5. 返回运费金额和原始货币
```

#### 3.3.2 Excel 导入规则

`D重量运费.xlsx` 的实测结构：**非单张规整表，而是多个 sheet 混合**。

**已确认的 sheet 清单**：

| Sheet 名称 | 内容说明 | 计价货币 |
|------------|----------|----------|
| 区域 | 区域代码 ↔ 国家/地区名称映射表 | — |
| 区域运费DHL | DHL 对各区域的运费，按重量分档 | CNY |
| 区域运费FedEX | FedEx 对各区域的运费，按重量分档 | CNY |
| 广诚FedEx运费 | 广诚渠道 FedEx 运费（可能与区域表计价方式不同） | CNY |
| 广诚DHL运费 | 广诚渠道 DHL 运费（同上） | CNY |

##### Phase -1 第一步：Excel → 中间 JSON

在导入数据库之前，先用 Python 脚本将 Excel 各 sheet 解析为标准中间 JSON 文件：

```json
{
  "source_file": "D重量运费.xlsx",
  "parsed_at": "2026-06-23T12:00:00Z",
  "sheets": {
    "区域运费DHL": [
      {
        "carrier": "DHL",
        "source_sheet": "区域运费DHL",
        "zone": "1",
        "country_cn": "香港",
        "country_en": "Hong Kong",
        "weight_kg": 0.5,
        "price_cny": 85.00
      }
    ],
    "区域运费FedEX": [ ... ],
    "广诚FedEx运费": [ ... ],
    "广诚DHL运费": [ ... ]
  },
  "zone_mapping": {
    "1": ["香港", "澳门"],
    "2": ["日本", "韩国"],
    ...
  }
}
```

中间 JSON 的字段：

| 字段 | 说明 |
|------|------|
| `carrier` | DHL / FedEx |
| `source_sheet` | 来源 sheet 名（可追溯） |
| `zone` | 区域代码（关联到"区域"sheet） |
| `country_cn` / `country_en` | 目的国名称 |
| `weight_kg` | 该档位的重量（或区间上界） |
| `price_cny` | 运费（人民币） |

##### 导入流程

1. **Phase -1**：验证 `parse_freight_excel.py` 脚本能正确解析所有 sheet，输出中间 JSON
2. **人工校验**：检查中间 JSON 数据是否与 Excel 原文一致（抽查 10–20 行）
3. **入库**：`POST /api/admin/freight/import` 接收中间 JSON，按区域映射展开国家，写入 `freight_rates` 表
4. 导入前清空旧数据（按 carrier 选择性清空）
5. 入库校验：必填列非空、数值范围合法、同一国家+重量区间+快递商去重
6. 返回校验报告（成功/跳过/错误行数，按 source_sheet 分组统计）

##### 计价结构处理

不同 sheet 可能采用不同的计价方式（阶梯价/首重续重），中间 JSON 保留原始字段，入库时由 `services/freight.py` 根据 `source_sheet` 类型选择对应的查表逻辑。

#### 3.3.3 货币处理

- 运费表中的货币由 Excel 原始数据决定
- 前端默认使用目的国本地货币展示（德国→EUR，日本→JPY 等），用户可手动切换
- 若目标货币与原始货币不同，后端查 `exchange_rates` 表转换

### 3.4 接口清单（公共）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/public/freight/countries` | 获取支持的目的国列表 |
| POST | `/api/public/freight/calculate` | 查询运费 |

### 3.5 UI/UX 规格

```
┌─────────────────────────────────────────────┐
│  [导航栏]                                     │
├─────────────────────────────────────────────┤
│                                             │
│  ┌────────── 运费查询 ──────────┐            │
│  │                               │            │
│  │  目的地国家: [▼ 搜索...  ▾]    │            │
│  │  重量 (kg):  [  12.5     ]   │            │
│  │  快递商:     [☑ DHL] [☑ FedEx]│            │
│  │  显示货币:   [▼ EUR (€) ▾]   │            │
│  │                               │            │
│  │  [  📦 查询运费  ]             │            │
│  └───────────────────────────────┘            │
│                                             │
│  ┌── DHL Express ──┐  ┌── FedEx Priority ──┐│
│  │                  │  │                    ││
│  │  运费: €262.20   │  │  运费: €247.02     ││
│  │  (USD $285.00)  │  │  (USD $268.50)    ││
│  │  时效: 3-5 天    │  │  时效: 4-6 天      ││
│  │                  │  │  含燃油附加费      ││
│  └──────────────────┘  └────────────────────┘│
│                                             │
└─────────────────────────────────────────────┘
```

### 3.6 测试用例

| 编号 | 场景 | 输入 | 预期输出 |
|------|------|------|----------|
| T2.1 | 正常查询 | 德国, 5kg, DHL+FedEx | 返回两个快递商的运费 |
| T2.2 | 货币转换 | 德国, 5kg, 货币选 CNY | 运费按汇率转换为 CNY |
| T2.3 | 重量边界 | 重量恰好等于区间边界值 | 匹配正确区间 |
| T2.4 | 超大重量 | 1000kg | 匹配最高重量区间或返回"请联系客服获取大货报价" |
| T2.5 | 不支持的国家 | 选择不在运费表中的国家 | 返回明确提示 |
| T2.6 | 只选一家快递商 | 只勾选 DHL | 只返回 DHL 结果 |
| T2.7 | 空输入验证 | 不选国家，直接点击查询 | 前端校验阻止，高亮缺失字段 |
| T2.8 | Excel 导入校验 | 上传格式正确的运费表 | 全部行成功导入，校验报告无错误 |

### 3.7 风险与约束

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| 运费表数据结构复杂，Excel 导入解析易出错 | 中 | 导入时做数据校验（必填列、数值范围），输出校验报告 |
| 运费数据过期导致实际运费偏差 | 中 | 运费表加 `updated_at` 字段，页面显示"最后更新日期" |
| Excel 中有合并单元格/多级表头 | 低 | 使用 openpyxl 逐行解析，跳过格式行，宽容处理 |

---

## 4. 插件三：公差计算展示

### 4.1 功能定义

#### 4.1.1 用户故事

> 作为一名工程师，我希望在供应商网站上快速查询 ISO 286 公差配合数据：输入基本尺寸和配合代号（如 25 H6/k5），立即看到轴和孔的公差带、上下偏差、配合类型和间隙/过盈量。

#### 4.1.2 参考网站

- https://www.machiningdoctor.com/calculators/tolerances/#calc
- https://www.machiningdoctor.com/calculators/tolerances/#charts

功能对标 MachiningDoctor 的计算器，但在视觉设计上体现 Daiyujin 的品牌风格。

#### 4.1.3 交互流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. 输入  │───▶│ 2. 查表  │───▶│ 3. 展示  │
│ 尺寸+配合 │    │ ISO 286  │    │ 三段结果  │
└──────────┘    └──────────┘    └──────────┘
```

**Step 1：输入**

| 输入项 | 控件 | 说明 |
|--------|------|------|
| 基本尺寸 (Basic Size) | 数字输入 | 单位 mm，范围 1–3150 mm |
| 配合组合 (Fit Combination) | 文本输入 + 自动补全 | 格式如 `H6/k5`，支持 ISO 标准孔/轴代号 |

辅助控件：
- **孔公差**：下拉选择，联动填入配合组合的孔侧
- **轴公差**：下拉选择，联动填入配合组合的轴侧
- **预设配合类型**：下拉快速选择常见配合（如 H7/g6 间隙配合，H7/p6 过盈配合等）

**Step 2：查表计算**

后端根据 ISO 286-1 和 ISO 286-2 规定的计算公式和数值表执行以下计算：

1. **确定尺寸段**：将基本尺寸匹配到标准尺寸段
2. **计算标准公差 IT**：根据公差等级和尺寸段查表或公式计算
3. **计算基本偏差**：根据公差带字母和尺寸段确定基本偏差
4. **推导上下偏差**：孔 ES = EI + IT，轴 es = ei + IT 等
5. **计算配合参数**（统一公式，见 4.3.4）

**Step 3：结果展示**

三段式布局：

| 段落 | 内容 |
|------|------|
| **Shaft（轴）** | 基本尺寸 + 公差带，尺寸上下限，公差带 IT 值，下偏差 ei，上偏差 es |
| **Bore（孔）** | 基本尺寸 + 公差带，尺寸上下限，公差带 IT 值，下偏差 EI，上偏差 ES |
| **Fit（配合）** | 配合代号，配合类型（间隙/过盈/过渡），最大间隙，最大过盈 |

### 4.2 数据模型

#### 4.2.1 输入定义

```json
{
  "basic_size_mm": 25.0,
  "hole_tolerance": "H6",
  "shaft_tolerance": "k5"
}
```

备选输入（自动补全场景）：

```json
{
  "basic_size_mm": 25.0,
  "fit_combination": "H6/k5"
}
```

#### 4.2.2 输出定义

```json
{
  "basic_size_mm": 25.0,
  "size_range": "18-30",
  "shaft": {
    "tolerance": "k5",
    "it_grade": 5,
    "it_value_um": 9,
    "ei_um": 2,
    "es_um": 11,
    "limits_of_size": {
      "min_mm": 25.002,
      "max_mm": 25.011
    }
  },
  "bore": {
    "tolerance": "H6",
    "it_grade": 6,
    "it_value_um": 13,
    "ei_um": 0,
    "es_um": 13,
    "limits_of_size": {
      "min_mm": 25.000,
      "max_mm": 25.013
    }
  },
  "fit": {
    "type": "Transition",
    "type_cn": "过渡配合",
    "max_clearance_um": 11,
    "max_interference_um": 2
  }
}
```

### 4.3 计算引擎设计

#### 4.3.1 尺寸段匹配

ISO 286 的尺寸分段采用半开区间：

| 尺寸段 | 范围 (mm) | 用于计算 D 的几何均值 |
|--------|-----------|----------------------|
| 1–3 | 1 < D ≤ 3 | √(1×3) = 1.732 |
| 3–6 | 3 < D ≤ 6 | √(3×6) = 4.243 |
| 6–10 | 6 < D ≤ 10 | √(6×10) = 7.746 |
| 10–18 | 10 < D ≤ 18 | √(10×18) = 13.416 |
| 18–30 | 18 < D ≤ 30 | √(18×30) = 23.238 |
| 30–50 | 30 < D ≤ 50 | √(30×50) = 38.730 |
| 50–80 | 50 < D ≤ 80 | … |
| 80–120 | 80 < D ≤ 120 | … |
| 120–180 | 120 < D ≤ 180 | … |
| 180–250 | … | … |
| … | … | … |
| 2500–3150 | 2500 < D ≤ 3150 | … |

> v1.0 内置完整 21 段尺寸段表。数据来源于 ISO 286-1:2010 标准规定的尺寸分段，这些数值本身属于数学常数，不受版权限制。

#### 4.3.2 IT 公差计算

IT5–IT18 的标准公差值采用 ISO 286 规定的公式：

$$
\text{IT} = k \times i
$$

其中 $i = 0.45\sqrt[3]{D} + 0.001D$（$D$ 为尺寸段几何均值，mm），$k$ 为公差等级系数。

IT 等级系数表：

| IT | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
|----|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|----|
| k | 7 | 10 | 16 | 25 | 40 | 64 | 100 | 160 | 250 | 400 | 640 | 1000 | 1600 | 2500 |

> IT01–IT4 用于量规级精度，v1.0 暂不实现，v2.0 补充。

计算结果圆整到标准值（按 ISO 286 规定的圆整规则）。**实现策略**：优先使用公式计算，在关键交叉点用标准表值做单元测试校验。这避免了将完整的 21×14 数值表内置于代码中。

#### 4.3.3 基本偏差计算

基本偏差（孔为 EI，轴为 es 或 ei）根据公差带字母和尺寸段确定。

**轴的偏差计算（示例，$D$ 为尺寸段几何均值，mm）：**

| 公差带 | 下偏差 ei / 上偏差 es | 适用条件 |
|--------|----------------------|----------|
| h | es = 0 | 所有 |
| k (IT4–IT7) | ei = $+0.6\sqrt[3]{D}$ | D ≤ 500 |
| k (IT ≥ 8) | ei = 0 | 所有 |
| p | ei = IT7 + (0 to 5) | D ≤ 500 |
| g | es = $-2.5D^{0.34}$ | 所有 |
| f | es = $-5.5D^{0.41}$ | 所有 |

**孔的偏差：**

| 公差带 | 下偏差 EI / 上偏差 ES |
|--------|----------------------|
| H | EI = 0 |
| Js | ES = +IT/2, EI = -IT/2（对称分布） |

> v1.0 支持常用公差带（H6, H7, H8, H9, H11, k5, k6, k7, p6, g6, f7, h6, h7, h9, Js7, Js9 等）。不支持的公差带返回明确错误提示。

#### 4.3.4 配合类型判定（统一公式）

```
hole_max = basic_size + ES_hole
hole_min = basic_size + EI_hole
shaft_max = basic_size + es_shaft
shaft_min = basic_size + ei_shaft

max_clearance = hole_max - shaft_min
min_clearance = hole_min - shaft_max

判定:
  若 min_clearance >= 0  →  间隙配合 (Clearance Fit)
     max_interference = 0

  若 max_clearance < 0   →  过盈配合 (Interference Fit)
     max_interference = -min_clearance

  否则                    →  过渡配合 (Transition Fit)
     max_interference = max(0, -min_clearance)
```

**关键点**：`max_clearance` 和 `max_interference` 均以正数（绝对值）展示。对于过盈配合，`max_clearance` 的数学值为负但展示时取 0；`max_interference = -min_clearance` 为正。

示例验证（25mm H7/p6 过盈配合）：

```
hole: ES=+21, EI=0  →  min=25.000, max=25.021
shaft: es=+35, ei=+22  →  min=25.022, max=25.035
max_clearance = 25.021 - 25.022 = -1μm  →  展示为 0
min_clearance = 25.000 - 25.035 = -35μm
max_interference = 35μm  ✓
```

### 4.4 接口清单（公共）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/public/tolerance/tolerance-zones` | 获取可用公差带列表（供前端自动补全） |
| GET | `/api/public/tolerance/presets` | 获取常用配合预设列表 |
| POST | `/api/public/tolerance/calculate` | 执行公差计算 |

### 4.5 UI/UX 规格

```
┌─────────────────────────────────────────────┐
│  [导航栏]                                     │
├─────────────────────────────────────────────┤
│                                             │
│  ┌────────── 公差计算 ──────────┐            │
│  │                               │            │
│  │  基本尺寸 (mm):  [  25   ]    │            │
│  │                               │            │
│  │  配合组合:  [ H6/k5  ▾ ]     │            │
│  │  预设配合:  [▼ 选择常用配合  ]│            │
│  │                               │            │
│  │  或分别选择:                   │            │
│  │  孔公差: [▼ H6  ]            │            │
│  │  轴公差: [▼ k5  ]            │            │
│  │                               │            │
│  │  [  📐 计算  ]                │            │
│  └───────────────────────────────┘            │
│                                             │
│  ┌─── 轴 Shaft 25 mm k5 ───┐               │
│  │                           │               │
│  │  Limits of Size           │               │
│  │  Max: 25.011 mm           │               │
│  │  Min: 25.002 mm           │               │
│  │                           │               │
│  │  Tolerance Field (IT)     │               │
│  │  IT5 = 9 μm               │               │
│  │                           │               │
│  │  ei (下偏差): +2 μm       │               │
│  │  es (上偏差): +11 μm      │               │
│  └───────────────────────────┘               │
│                                             │
│  ┌─── 孔 Bore 25 mm H6 ───┐                │
│  │                           │               │
│  │  Limits of Size           │               │
│  │  Max: 25.013 mm           │               │
│  │  Min: 25.000 mm           │               │
│  │                           │               │
│  │  Tolerance Field (IT)     │               │
│  │  IT6 = 13 μm              │               │
│  │                           │               │
│  │  EI (下偏差): 0 μm        │               │
│  │  ES (上偏差): +13 μm      │               │
│  └───────────────────────────┘               │
│                                             │
│  ┌─── 配合 Fit 25 mm H6/k5 ───┐            │
│  │                              │            │
│  │  Fit Type: 过渡配合           │            │
│  │  (Transition)                │            │
│  │                              │            │
│  │  Max. Clearance:   11 μm     │            │
│  │  Max. Interference: 2 μm     │            │
│  └──────────────────────────────┘            │
│                                             │
└─────────────────────────────────────────────┘
```

### 4.6 测试用例

| 编号 | 场景 | 输入 | 预期输出 |
|------|------|------|----------|
| T3.1 | 标准过渡配合 | 25mm, H6/k5 | 轴 es=+11, ei=+2；孔 ES=+13, EI=0；Fit=过渡；Max Clearance=11μm, Max Interference=2μm |
| T3.2 | 间隙配合 | 25mm, H7/g6 | min_clearance≥0, Fit=间隙, Max Clearance=41μm, Max Interference=0 |
| T3.3 | 过盈配合 | 25mm, H7/p6 | max_clearance<0, Fit=过盈, Max Clearance=0, Max Interference=35μm |
| T3.4 | 边界尺寸 | 18mm（尺寸段边界） | 匹配到正确尺寸段 |
| T3.5 | 无效配合组合 | `X9/y9` | 返回验证错误，提示无效公差带 |
| T3.6 | 大量级尺寸 | 1500mm | 正确匹配到对应尺寸段 |
| T3.7 | 完整输入 | 配合组合=H6/k5 + 手改孔=H7 | 以最新输入为准 |
| T3.8 | 预设配合 | 选择 H7/g6 预设 | 自动填入配合组合并触发计算 |

### 4.7 风险与约束

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| 计算值与商业软件结果存在 1–2μm 圆整差异 | 中 | 页面底部注明"基于 ISO 286 公式计算，结果可能与商业软件存在微小圆整差异"。用已知标准值做交叉校验 |
| 非常用公差带（x8, z9 等）不支持 | 低 | v1.0 支持常用公差带，不支持的给出明确提示；v2.0 扩展 |
| ISO 标准版权 | 低 | 使用公式计算而非直接复制标准全文数值表。尺寸分段等数学常数不受版权限制 |

---

## 5. ReadStep 重构：抽离为 Web 服务

### 5.1 现状分析

`ReadStep/main.py` 当前是**桌面批处理脚本**，存在以下不适用于 Web 服务的问题：

| 问题 | 影响 | 重构目标 |
|------|------|----------|
| `analyze_step()` 返回 `shape`（OCC 对象），不可 JSON 序列化 | 无法从 API 返回 | 只返回可序列化数据 |
| 质量按固定钢密度 7.85 计算 | 不支持材质切换 | 只返回体积，重量由报价服务按材质密度算 |
| 没有单独输出体积 | 报价计算器无法获取体积 | 新增 `volume_mm3` 字段 |
| `input()` 阻塞式交互 | Web 服务不能有 stdin 交互 | 全部改为函数参数输入 |
| 缩略图生成有副作用（写入磁盘） | API 需管理文件路径 | 返回文件路径，由 API 层管理静态资源服务 |
| 无错误分类（可恢复 vs 致命） | 前端无法区分处理 | 返回结构化错误和 warnings 列表 |

### 5.2 重构目标

抽离为独立模块 `backend/services/step_analyzer.py`，对外提供一个函数：

```python
def analyze_step_file(file_path: str, thumb_dir: str) -> dict:
    """
    解析 STP/STEP 文件，返回可 JSON 序列化的结果字典。

    参数:
        file_path: STP 文件的绝对路径
        thumb_dir: 缩略图输出目录路径

    返回:
        {
            "success": bool,
            "data": {
                "name": str,              # 零件名（不含扩展名）
                "volume_mm3": float,       # 体积 (mm³)
                "obb_dimensions_mm": str,  # OBB 精确尺寸 "L×W×H"
                "aabb_dimensions_mm": str, # AABB 快速尺寸 "L×W×H"
                "thumbnail_path": str | None,  # 缩略图绝对路径
            },
            "warnings": [str],            # 可恢复警告列表
            "error": str | None,          # 致命错误（success=False 时有值）
        }
    """
```

**关键变更**：

1. **不再计算质量**：原 `mass_kg` 字段删除，改用 `volume_mm3`。重量由 `services/pricing.py` 根据用户选择的材质密度计算：`weight_kg = volume_mm3 × density_gcm3 × 1e-6`
2. **shape 对象不返回**：OCC shape 仅用于内存中生成缩略图，不序列化
3. **错误分级**：`error`（致命）vs `warnings`（可恢复警告，如缩略图生成失败但解析成功）
4. **无用户交互**：纯函数调用，不涉及 `input()` 或 `print()`

### 5.3 与报价计算器的集成

```
前端上传 STP
     │
     ▼
POST /api/public/quote/upload
     │
     ▼
routes/public/quote.py 接收文件
     │
     ├─ 保存到 backend/uploads/<uuid>.stp
     ├─ 调用 services/step_analyzer.analyze_step_file()
     ├─ 缩略图保存到 backend/static/thumbnails/<uuid>.png
     ├─ 返回 JSON（volume_mm3, dimensions, thumbnail_url）
     └─ 此时不计算任何重量
     
用户选择材质后:
     │
     ▼
POST /api/public/quote/recalculate-weight
     │
     └─ weight_kg = volume_mm3 × density_gcm3 × 1e-6

用户点击 Calculate Estimate:
     │
     ▼
POST /api/public/quote/calculate
     │
     └─ services/pricing.py 读取商业参数 → 执行报价公式 → 返回估价
```

### 5.4 ReadStep 缩略图渲染适配

原 `export_thumbnail()` 使用 `OffscreenRenderer(screen_size=(3840, 2880))` 生成 4K 缩略图。在 Web 服务中需注意：

1. **OffscreenRenderer 惰性初始化**：首次调用会触发的 OpenGL 日志，已在 `_suppress_occ_noise()` 中抑制
2. **线程安全**：OffscreenRenderer 非线程安全，v1.0 使用单线程 Flask，后续并发需加锁或进程池
3. **资源释放**：每次渲染后 `display.EraseAll()` 清理，避免内存泄漏

---

## 6. 后端架构与数据库设计

### 6.1 技术选型

| 层级 | 选型 | 理由 |
|------|------|------|
| Web 框架 | **Flask** | 轻量，与 OCC 无依赖冲突，学习成本低 |
| ORM | **SQLAlchemy** | Flask 生态标配，支持 SQLite→PostgreSQL 无缝迁移 |
| 数据库 | **SQLite** | v1.0 零配置起步，足够支撑企业站流量 |
| STP 解析 | **pythonocc-core** | 已验证可用（ReadStep），API 稳定 |
| 缩略图 | **OCC OffscreenRenderer** | 已集成，3840×2880 高清渲染 |
| Excel 导入 | **openpyxl** | 处理运费表导入 |
| 认证 | **Flask-Login + session** | 管理后台登录 |
| 部署 | **单进程 Flask + Waitress** | Windows 友好，后续可迁 Gunicorn |

### 6.2 数据库模型

#### 6.2.1 完整 ER 表

```
┌─────────────────┐     ┌──────────────────────┐
│  admin_users     │     │  materials            │
├─────────────────┤     ├──────────────────────┤
│ id (PK)         │     │ id (PK)              │
│ username        │     │ name                 │
│ password_hash   │     │ density_gcm3         │
│ created_at      │     │ unit_price_usd_kg    │  ← 管理端字段
└─────────────────┘     │ category             │
                        │ is_active            │
                        │ updated_at           │
┌──────────────────────┐ └──────────────────────┘
│  tolerance_grades     │
├──────────────────────┤ ┌──────────────────────┐
│ id (PK)              │ │  surface_treatments   │
│ grade (IT6, IT7...)  │ ├──────────────────────┤
│ factor               │ ← 管理端字段             │
│ label                │ │ id (PK)              │
└──────────────────────┘ │ name                 │
                         │ cost_usd             │ ← 管理端字段
┌──────────────────────┐ │ is_active            │
│  quantity_tiers       │ └──────────────────────┘
├──────────────────────┤
│ id (PK)              │ ┌──────────────────────┐
│ min_qty              │ │  freight_rates        │
│ max_qty              │ ├──────────────────────┤
│ factor               │ ← 管理端字段             │
└──────────────────────┘ │ id (PK)              │
                         │ carrier              │
┌──────────────────────┐ │ country              │
│  exchange_rates       │ │ country_cn           │
├──────────────────────┤ │ currency             │
│ id (PK)              │ │ weight_min           │
│ from_currency        │ │ weight_max           │
│ to_currency          │ │ base_price           │
│ rate                 │ │ ...                  │
│ updated_at           │ └──────────────────────┘
└──────────────────────┘
                         ┌──────────────────────┐
┌──────────────────────┐ │  inquiries            │
│  size_cost           │ ├──────────────────────┤
├──────────────────────┤ │ id (PK)              │
│ id (PK)              │ │ type (quote/freight) │
│ max_dim_mm           │ │ stp_filename         │
│ base_cost_usd        │ ← 管理端字段             │
└──────────────────────┘ │ input_params (JSON)  │
                         │ result (JSON)        │
                         │ client_ip            │
                         │ created_at           │
                         └──────────────────────┘
```

#### 6.2.2 询盘记录表设计

```sql
CREATE TABLE inquiries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT NOT NULL,          -- 'quote' | 'freight'
    stp_filename  TEXT,                   -- 报价计算器专有
    stp_file_path TEXT,                   -- 后端存储的 STP 文件路径
    input_params  TEXT NOT NULL,          -- JSON: 完整输入参数快照
    result        TEXT NOT NULL,          -- JSON: 完整计算结果快照
    client_ip     TEXT,
    user_agent    TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

每条询盘记录保存当时所有参数的**完整快照**。即使管理员后来修改了材质单价，历史询盘仍然可以精确复现当时的报价，避免纠纷。

### 6.3 管理后台

#### 6.3.1 功能清单（v1.0 最小可行）

| 功能 | 说明 | MVP |
|------|------|-----|
| 管理员登录 | 用户名/密码认证，session 管理 | ✅ |
| 材质管理 | 增删改查 | ✅ |
| 公差系数管理 | 修改各 IT 等级的系数 | ✅ |
| 后处理管理 | 增删改查 | ✅ |
| 数量阶梯管理 | 区间定义和系数设置 | ✅ |
| 运费表导入 | 上传 Excel 导入 | ✅ |
| 运费表查看 | 翻页浏览 | ✅ |
| 汇率管理 | 手动更新汇率 | ✅ |
| 询盘记录查看 | 搜索、筛选 | ✅ |
| 管理后台完整 UI | Dashboard + 侧边栏 | ⏳ v2.0 |

> v1.0 管理后台采用**简易管理页**：一个受认证的单页，含基本 CRUD 表格。不引入复杂 UI 框架，用原生 HTML/CSS + 少量 JS 实现。SQLite 数据库也可直接通过 DB Browser 操作作为后备方案。

### 6.4 安全设计

| 措施 | 说明 |
|------|------|
| 管理员认证 | 所有 `/api/admin/*` 需验证 session |
| 接口分层 | 公共接口只返回展示字段，管理接口返回完整商业字段 |
| STP 文件隔离 | 上传文件使用 UUID 重命名，不暴露原始文件名 |
| 输入校验 | 所有 API 入参做类型和范围校验，防注入和越界 |
| 速率限制 | 单 IP 每分钟最多 10 次计算请求 |
| CORS | 仅允许 `https://daiyujin.dpdns.org` 跨域请求 |

---

## 7. 开发分期与里程碑

### 7.1 分期规划（修订版执行顺序）

**核心原则**：先打通"静态前端 + 后端 API + 测试"闭环，再逐个落地插件。先做无文件上传、无 OCC 依赖的运费计算器和公差计算器，报价计算器因为牵涉 STP 上传、OCC 解析、缩略图生成、客户 CAD 文件安全，风险最高，最后推进。

```
Phase -1 ─── 技术验证（1天）
  ├─ 本地 Flask 能启动并响应 /api/health ☐
  ├─ ReadStep 的 analyze_step() 能被抽成独立服务函数 ☐
  ├─ 上传一个 STEP 文件能返回 JSON（volume + dimensions + thumbnail）☐
  ├─ 解析 D重量运费.xlsx 各 sheet 为标准中间 JSON ☐
  └─ 前端静态页能成功 fetch 后端 API ☐

Phase 0 ─── 项目骨架（1天）
  ├─ backend/ 项目结构搭建
  ├─ SQLite 数据库初始化（SQLAlchemy 模型 + 建表）
  ├─ 公共 API 统一错误格式：{ "error": true, "code": "...", "message": "..." }
  ├─ 三个插件页面 HTML 骨架 + 导航更新
  ├─ plugins.css 基础样式
  └─ API 客户端 JS 工具函数（fetch 封装、错误处理、加载状态）

Phase 1B ── 运费计算器（2-3天） ★ 第一批
  ├─ 解析 D重量运费.xlsx → 批量写入 freight_rates 表
  ├─ services/freight.py 查表引擎
  ├─ routes/public/freight.py（查询/国家列表）
  ├─ freight.html + freight.js 前端交互
  ├─ 简易管理页：运费表查看 + Excel 重导
  └─ 测试：查询/边界/货币/导入校验

Phase 1C ── 公差计算器（2-3天） ★ 第二批
  ├─ services/tolerance.py（尺寸段匹配 + IT 计算 + 偏差 + 配合判定）
  ├─ routes/public/tolerance.py（计算/公差带列表/预设）
  ├─ tolerance.html + tolerance.js 前端交互
  ├─ 单元测试：所有尺寸段 × 常用公差等级交叉校验
  └─ 与 MachiningDoctor 结果抽样对比

Phase 1A ── 报价计算器（3-4天） ★ 第三批（风险最高）
  ├─ services/step_analyzer.py（重构自 ReadStep）
  ├─ routes/public/quote.py（上传/解析/重量重算/估价/正式询盘）
  ├─ services/pricing.py（报价引擎：材质密度×体积 + 公差系数 + 后处理 + 数量阶梯）
  ├─ quote.html + quote.js 前端交互（上传 → 解析 → 选参 → 估价 → 询盘）
  ├─ 简易管理页：材质/公差/后处理/数量阶梯 CRUD
  └─ 测试：正常估价值/材质切换/阶梯/多后处理/无效文件/正式询盘

Phase 2 ── 增强功能（后续迭代）
  ├─ 管理后台完整 Dashboard UI
  ├─ 阶梯定价 v2.0（更多维度：材质形态、表面复杂度）
  ├─ 汇率 API 自动更新
  ├─ 公差计算器图表展示（孔轴公差带可视化）
  ├─ 估价 PDF 导出
  ├─ 询盘邮件通知
  ├─ 数据库迁 PostgreSQL
  └─ OCC 解析任务队列（Celery/Redis）
```

### 7.2 Phase -1 技术验证详细说明

这是整个项目最关键的一步，在投入大量开发之前验证核心技术路径可行。

**V-1：Flask 基础可用性**

```bash
cd backend
python -c "from flask import Flask; app = Flask(__name__); print('Flask OK')"
```

**V-2：ReadStep 函数抽离**

在 `backend/services/` 下创建 `step_analyzer.py`，导入 OCC 依赖，调用 `analyze_step_file()`，验证：

- 对一个已知正常的 STEP 文件，返回 `success: true`
- `volume_mm3` > 0
- `obb_dimensions_mm` 非空
- 缩略图生成成功且文件存在

**V-3：STEP 文件上传 + 解析 API**

用 curl 或 Postman 模拟前端上传：

```bash
curl -X POST https://localhost:5000/api/public/quote/upload \
  -F "file=@test.stp"
```

预期响应含 `volume_mm3`、`dimensions`、`thumbnail_url`。

**V-4：运费 Excel 多 sheet 解析**

```bash
python parse_freight_excel.py data/D重量运费.xlsx --output data/freight_intermediate.json
```

确认脚本能正确读取所有 sheet（区域/区域运费DHL/区域运费FedEX/广诚FedEx运费/广诚DHL运费），输出标准中间 JSON，字段含 carrier/source_sheet/zone/country_cn/weight_kg/price_cny。抽查 10 行与 Excel 原文比对。

**V-5：前端 fetch 后端**

在任意 HTML 页面（可以是最简单的 test.html）中：

```js
fetch('http://localhost:5000/api/health')
  .then(r => r.json())
  .then(d => console.log(d));
```

确认浏览器能成功跨域（开发阶段用 Flask-CORS 临时放通 `*`）。

### 7.3 MVP 交付标准

- [x] Phase -1 全部验证通过
- [ ] Phase 1B 运费计算器前端+后端+测试完整可用
- [ ] Phase 1C 公差计算器前端+后端+测试完整可用
- [ ] Phase 1A 报价计算器核心链路（上传→解析→估价→询盘）完整可用
- [ ] 公共接口与管理员接口分层正确：客户不可见商业参数
- [ ] 每次计算自动记录询盘日志
- [ ] 报价结果明确标注 "Estimated" + 有效期 + 免责声明 + 排除项
- [ ] 前端风格与现有 daiyujinweb 一致
- [ ] 部署架构（前端 GitHub Pages + 后端独立部署 + Cloudflare 反代）可行

---

## A. 附录

### A.1 术语对照

| 缩写/术语 | 全称 | 说明 |
|-----------|------|------|
| STP/STEP | Standard for the Exchange of Product Data | ISO 10303 标准 3D 文件格式 |
| OCC | Open CASCADE Technology | 开源 3D 几何内核 |
| OBB | Oriented Bounding Box | 有向包围盒 |
| AABB | Axis-Aligned Bounding Box | 轴对齐包围盒 |
| IT | International Tolerance | ISO 286 标准公差等级 |
| DHL / FedEx | 国际快递服务商 | 运费计算器数据源 |
| GD&T | Geometric Dimensioning and Tolerancing | 几何尺寸与公差（v2.0 扩展方向） |
| MVP | Minimum Viable Product | 最小可行产品 |
| VPS | Virtual Private Server | 虚拟专用服务器 |

### A.2 参考资源

- ISO 286-1:2010 — Geometrical product specifications (GPS) — ISO code system for tolerances on linear sizes — Part 1: Basis of tolerances, deviations and fits
- ISO 286-2:2010 — Part 2: Tables of standard tolerance classes and limit deviations for holes and shafts
- ReadStep 项目：`D:\dyj-scrapling\ReadStep\` — STP 解析核心逻辑
- MachiningDoctor Tolerances: https://www.machiningdoctor.com/calculators/tolerances/
- D重量运费.xlsx — 运费源数据（待添加到项目目录）
- GitHub Pages 文档：https://docs.github.com/en/pages
- Cloudflare 文档：https://developers.cloudflare.com/

### A.3 文档变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-06-23 | v1.0 | 初稿：三个插件计划书 + 后端架构设计 |
| 2026-06-23 | v1.1.1 | Phase -1 改为 ☐ 待验证；域名替换为 daiyujin.dpdns.org；运费 Excel 多 sheet 解析重构 |
| 2026-06-23 | v1.1 | 修订：新增部署方案、Phase -1 技术验证、MVP 收缩、公共/管理接口分层、报价免责声明、ReadStep 重构定义、公差公式统一、执行顺序调整 |
