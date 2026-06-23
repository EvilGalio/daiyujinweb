# 精密制造企业商务插件 · 任务计划书 — Task 2

> **项目代号**：Daiyujin Precision Tools · Task 2
> **版本**：v1.0
> **日期**：2026-06-23
> **来源**：Task 2 from Johnson
> **计划书作者**：待雨尽（Gorain）& 智子（Hanako）
>
> **前置依赖**：Task 1 PRD（`PRD-plugins.md` v1.1.1）已通过 Phase -1 验证，Phase 0 骨架已落地。

---

## 目录

- [0. 总体定位与 PRD 关联](#0-总体定位与-prd-关联)
- [1. 插件四：材质标准查表](#1-插件四材质标准查表)
- [2. 插件五：材料重量计算器](#2-插件五材料重量计算器)
- [3. 与 Task 1 PRD 的交叉链接](#3-与-task-1-prd-的交叉链接)
- [4. 开发分期与里程碑](#4-开发分期与里程碑)
- [A. 附录](#a-附录)

---

## 0. 总体定位与 PRD 关联

### 0.1 系统定位

Task 2 在 Task 1（报价/运费/公差三大商务插件）的基础上新增两个工具：

| 编号 | 插件名称 | 核心能力 | 用户角色 | 与 Task 1 的关系 |
|------|----------|----------|----------|-------------------|
| P4 | 材质标准查表 | 搜一个牌号 → 输出各国等效牌号 | 客户 + 内部工程师 | 为 Task 1 报价计算器的材质选择提供标准对照数据 |
| P5 | 材料重量计算器 | 选材质 + 形状 + 尺寸 → 计算重量 | 客户 | Task 1 报价器需 STP 上传才能算重量；P5 提供无需上传的快速重量估算 |

### 0.2 复用 Task 1 基础设施

Task 2 不新建项目，直接在 Task 1 已搭建的框架上扩展：

| 复用项 | 说明 |
|--------|------|
| 后端框架 | Flask + SQLAlchemy + SQLite（`backend/`） |
| 数据库 | 同一 `daiyujin.db`，新增表 |
| API 规范 | `api_utils.api_ok` / `api_error` 统一格式 |
| 前端样式 | `css/plugins.css` 的 tool-shell / tool-grid / tool-panel 组件体系 |
| API 客户端 | `js/api.js` 的 `DaiyujinAPI.request` / `checkHealth` |
| 部署 | 前端 GitHub Pages（`daiyujin.dpdns.org`），后端独立部署，Cloudflare 反代 |

### 0.3 设计原则（继承自 Task 1 + 新增）

1. **零暴露**：材料标准对照数据为公开信息，可全量返回前端（与 Task 1 商业参数隔离策略不同）
2. **渐进式扩充**：数据表先覆盖铝合金全系列 + 不锈钢，后续按需追加钛合金/铜合金/工程塑料
3. **可追溯**：每条对照记录标注数据来源 URL 和采集日期
4. **与 Task 1 双向联动**：材质查表结果可反向填充到 Task 1 报价器的材质选择；重量计算器复用报价器的密度表

### 0.4 前端页面规划

在现有导航中新增两个入口：

> **Daiyujin's Space** | 首页 · 报价计算 · 运费查询 · 公差查询 · **材质查表** · **重量计算** · 关于

```
daiyujinweb/
├── materials.html      # [新] 材质标准查表
├── weight.html         # [新] 材料重量计算器
├── js/
│   ├── materials.js    # [新] 材质查表前端逻辑
│   └── weight.js       # [新] 重量计算器前端逻辑
├── backend/
│   ├── models.py       # [改] 新增 MaterialCrossReference 表
│   ├── services/
│   │   ├── materials.py   # [新] 材质查表引擎
│   │   └── weight.py      # [新] 重量计算引擎
│   ├── routes/public/
│   │   ├── materials.py   # [新] 材质搜索 API
│   │   └── weight.py      # [新] 重量计算 API
│   └── scripts/
│       ├── seed_materials.py   # [新] 材质对照数据种子脚本
│       └── scrape_cross_ref.py # [新] 子 agent 采集脚本（Phase 2B）
└── data/
    └── daiyujin.db      # [改] 新增表
```

---

## 1. 插件四：材质标准查表

### 1.1 功能定义

#### 1.1.1 用户故事

> 作为一名跨国采购商/工程师，我在供应商网站输入一个模糊的材料牌号（如 "7075""AW7075""3.4365"），系统立即返回该材料在 ISO、EN、DIN、ANSI/AA、BS、AFNOR、UNE、UNS、JIS、CSA、SIS 等标准下的等效牌号。我不需要去翻多国标准手册。

#### 1.1.2 交互流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. 输入  │───▶│ 2. 搜索  │───▶│ 3. 结果  │
│  牌号    │    │  模糊匹配 │    │  多国对照 │
└──────────┘    └──────────┘    └──────────┘
```

**Step 1：输入**

| 输入项 | 控件 | 说明 |
|--------|------|------|
| 搜索关键词 | 文本输入 | 支持完整牌号（EN AW-7075）或片段（7075、AW7075、3.4365） |
| 材料类别筛选 | 可选下拉 | Aluminum / Stainless Steel / Carbon Steel / Titanium / Brass / Copper / Plastics |

**Step 2：搜索**

- 前端发请求 `GET /api/public/materials/search?q=7075`
- 后端在 `material_cross_references` 表中做模糊匹配（LIKE / 全文搜索）
- 返回所有匹配的标准 → 按材料类别分组

**Step 3：结果展示**

- 单行显示一个材料的所有国家标准牌号
- 以表格形式展示：标准列 × 牌号
- 高亮匹配的关键词
- 标注数据来源

### 1.2 数据模型

#### 1.2.1 材料对照表

```sql
CREATE TABLE material_cross_references (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    material_name   TEXT NOT NULL,        -- 通用材料名，如 "Aluminum 7075"
    material_category TEXT NOT NULL,      -- 大类：Aluminum/Stainless Steel/Carbon Steel/...
    standard        TEXT NOT NULL,        -- 标准代码：ISO/EN/DIN/ANSI/BS/AFNOR/UNE/UNS/JIS/CSA/SIS/GB
    designation     TEXT NOT NULL,        -- 该标准下的牌号，如 "EN AW-7075"
    is_primary      BOOLEAN DEFAULT 0,    -- 是否为主牌号（用于结果排序）
    source_url      TEXT,                 -- 数据来源 URL
    source_name     TEXT,                 -- 来源名称，如 "Worthwill Aluminium"
    notes           TEXT,                 -- 备注（如 "近似等效"）
    collected_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cross_ref_material ON material_cross_references(material_name);
CREATE INDEX idx_cross_ref_designation ON material_cross_references(designation);
CREATE INDEX idx_cross_ref_standard ON material_cross_references(standard);
CREATE INDEX idx_cross_ref_category ON material_cross_references(material_category);
```

**设计要点**：

- `material_name` 是通用名称（如 "Aluminum 7075"），用于将同一材料的不同国家标准牌号关联在一起
- `designation` 是具体牌号字符串，搜索时对该列做模糊匹配
- `standard` 限定在 11 个标准枚举值内
- 一个材料在 11 个标准中各有一行，靠 `material_name` 聚合展示

#### 1.2.2 v1.0 覆盖范围

**Phase 2A（内置种子数据）**：

| 大类 | 子类 | 材料数量（估） |
|------|------|---------------|
| Aluminum（锻造） | 1000–8000 系 | ~80 种（完整覆盖 Worthwill 转换表） |
| Aluminum（铸造） | Al-Si / Al-Si-Cu / Al-Mg / Al-Cu | ~30 种 |
| Stainless Steel | 303, 304, 304L, 316, 316L, 321, 410, 420, 430, 440C | ~10 种 |
| Carbon Steel | AISI 1018, 1045, 1060, 1095 | ~4 种 |

**Phase 2B（子 agent 采集扩充）**：

| 大类 | 子类 |
|------|------|
| Alloy Steel | 4140, 4340, 8620 等 |
| Titanium | Grade 1–5, Ti-6Al-4V 等 |
| Brass | C360, C260, C464 等 |
| Copper | C110, C122 等 |
| Engineering Plastics | POM, PA6, PTFE, PEEK, ABS, PC |
| Specialized Alloys | Inconel, Monel, Hastelloy 等 |

#### 1.2.3 输入定义

```json
{
  "q": "7075",
  "category": "Aluminum"
}
```

#### 1.2.4 输出定义

```json
{
  "query": "7075",
  "match_count": 3,
  "results": [
    {
      "material_name": "Aluminum 7075 (Wrought)",
      "material_category": "Aluminum",
      "designations": [
        { "standard": "ISO",   "designation": "AlZn5.5MgCu" },
        { "standard": "EN",    "designation": "EN AW-7075" },
        { "standard": "DIN",   "designation": "3.4365" },
        { "standard": "ANSI",  "designation": "7075" },
        { "standard": "BS",    "designation": "2L95" },
        { "standard": "AFNOR", "designation": "AlZnMgCu1.5" },
        { "standard": "UNE",   "designation": "7075" },
        { "standard": "UNS",   "designation": "A97075" },
        { "standard": "JIS",   "designation": "A7075" },
        { "standard": "CSA",   "designation": "A34x6" },
        { "standard": "SIS",   "designation": null },
        { "standard": "GB",    "designation": "7A09 (LC9)" }
      ],
      "source": {
        "name": "Worthwill Aluminium Conversion Chart",
        "url": "https://www.worthwillaluminium.com/blog/aluminum-onversion-chart/"
      }
    }
  ]
}
```

> 注：某标准若没有对应的等效牌号，`designation` 返回 `null`（前端显示为 "—"）。

### 1.3 数据采集策略

#### 1.3.1 Phase 2A：手动内置（当前阶段）

铝合金完整数据已从 Worthwill 转换表获取（80+ 锻造 + 30+ 铸造牌号 × 12 标准）。直接编写 `seed_materials.py` 种子脚本，将结构化数据写入 `material_cross_references` 表。

不锈钢常用牌号（303/304/316 等）可从公开对照表手动整理。

**工作量估计**：铝合金数据清洗 + SQL 化 → 0.5 天。不锈钢数据整理 → 0.5 天。

#### 1.3.2 Phase 2B：子 agent 自动化采集（后续阶段）

对于 Phase 2A 未覆盖的材料（钛合金、铜合金、工程塑料等），采用子 agent 分派策略：

1. **任务模板**：为每种材料生成搜索 prompt，如 "ISO EN DIN ANSI JIS cross reference equivalent grade Titanium Grade 5 Ti-6Al-4V"
2. **子 agent 执行**：每个子 agent 负责一个材料类别，搜索 3–5 个来源，返回结构化 JSON
3. **人工审核**：采集结果标记 `source_name` 和置信度，人工抽查 10–20% 后入库
4. **记录来源**：每条数据标注 URL + 采集日期，便于追溯和更新

> ⚠️ 注意：ISO 标准原文受版权保护，但标准牌号的对照关系（如 "7075 ↔ 3.4365"）属于公开工程知识，不受版权限制。数据采集时只提取牌号对照关系，不复制标准全文。

#### 1.3.3 数据质量标准

| 维度 | 要求 |
|------|------|
| 可追溯性 | 每条记录标注来源 URL 和采集日期 |
| 精确性 | 区分"等效"与"近似等效"，后者加 notes 标注 |
| 完整性 | 同一材料在所有 12 个标准中应有行（缺失标 null） |
| 去重 | 同一材料+标准组合唯一 |

### 1.4 搜索与查询引擎

#### 1.4.1 模糊匹配策略

```
输入: "7075"

匹配优先级:
  1. 精确匹配 designation = "7075" → 排序第1
  2. 前缀匹配 designation LIKE "7075%" → 排序第2
  3. 包含匹配 designation LIKE "%7075%" → 排序第3
  4. 标准化后匹配 → 排序第4
```

**标准化规则**（v1.0）：

- 去除空格：`"EN AW-7075"` → `"ENAW-7075"`
- 统一大小写：全部 uppercase
- 去除常见前缀：`"EN AW-"`, `"EN AC-"`, `"AISI "` 等
- 搜索结果同时匹配原始 `designation` 列和标准化后的计算列

**SQL 实现思路**：

```sql
SELECT DISTINCT material_name, material_category
FROM material_cross_references
WHERE designation LIKE '%' || :q || '%'
   OR :q_std != :q AND designation LIKE '%' || :q_std || '%'
ORDER BY
  CASE
    WHEN designation = :q THEN 0
    WHEN designation LIKE :q || '%' THEN 1
    ELSE 2
  END,
  is_primary DESC
LIMIT 20;
```

> 注：v1.0 使用 SQLite LIKE + 索引做模糊搜索。数据量（~1500 条）下性能足够。v2.0 可引入 FTS5 全文搜索。

#### 1.4.2 空搜索 / 无结果

- 空搜索：返回最近更新的 20 个材料（作为浏览入口）
- 无匹配结果：返回空列表 + 建议"尝试更短的搜索词或不同的牌号格式"

### 1.5 技术方案

#### 1.5.1 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/public/materials/search` | 搜索材质牌号（`?q=` 模糊搜索 + `?category=` 可选筛选） |
| GET | `/api/public/materials/categories` | 获取材料类别列表 |
| GET | `/api/public/materials/standards` | 获取支持的标准列表 |

#### 1.5.2 前端

- 搜索框：带 debounce（300ms）的实时搜索，输入即搜
- 结果表格：横向滚动（12 个标准列），移动端切换为卡片式布局
- 匹配高亮：搜索结果中高亮显示匹配的关键词
- 类别筛选：侧边栏或顶部标签切换材料大类

### 1.6 UI/UX 规格

#### 1.6.1 布局结构

```
┌─────────────────────────────────────────────┐
│  [导航栏]                                     │
├─────────────────────────────────────────────┤
│                                             │
│  ┌────────── 材质标准查表 ──────────┐        │
│  │                                    │        │
│  │  [🔍 输入牌号搜索...          ]    │        │
│  │                                    │        │
│  │  [全部] [铝合金] [不锈钢] [碳钢]    │        │
│  │  [钛合金] [铜合金] [工程塑料]       │        │
│  │                                    │        │
│  └────────────────────────────────────┘        │
│                                             │
│  ┌─ Aluminum 7075 (Wrought) ─────────────┐  │
│  │                                         │  │
│  │  ISO        AlZn5.5MgCu                 │  │
│  │  EN         EN AW-**7075**              │  │
│  │  DIN        3.4365                      │  │
│  │  ANSI/AA    **7075**                    │  │
│  │  BS         2L95                        │  │
│  │  AFNOR      AlZnMgCu1.5                │  │
│  │  UNE        **7075**                    │  │
│  │  UNS        A9**7075**                  │  │
│  │  JIS        A**7075**                   │  │
│  │  CSA        A34x6                       │  │
│  │  SIS        —                           │  │
│  │  GB         7A09 (LC9)                  │  │
│  │                                         │  │
│  │  Source: Worthwill Aluminium Chart      │  │
│  └─────────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

#### 1.6.2 响应式适配

- 桌面端：标准列横向排列，类似表格
- 移动端：标准列改为两列（标准名 + 牌号）垂直排列，match 关键词高亮

### 1.7 测试用例

| 编号 | 场景 | 输入 | 预期输出 |
|------|------|------|----------|
| T4.1 | 精确匹配 | `7075` | 返回 Aluminum 7075，DIN 3.4365，JIS A7075 等 |
| T4.2 | 带前缀搜索 | `EN AW-7075` | 同 T4.1 |
| T4.3 | DIN 牌号搜索 | `3.4365` | 返回 Aluminum 7075 的全标准对照 |
| T4.4 | 模糊片段 | `AW70` | 返回包含 AW70 的牌号列表 |
| T4.5 | 类别筛选 | `304` + 筛选 Stainless Steel | 只返回不锈钢 304 相关结果，排除其他材料 |
| T4.6 | 无匹配 | `XYZ999` | 返回空列表 + 建议提示 |
| T4.7 | 空搜索 | 不输入，点搜索/回车 | 返回最近更新的材料列表（浏览模式） |
| T4.8 | 缺失标准 | 搜索某材料 | 未覆盖的标准列显示 "—"，不显示为错误 |

### 1.8 风险与约束

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| 铝合金以外材料的数据采集耗时 | 中 | Phase 2A 只覆盖铝合金 + 不锈钢，其余放 Phase 2B 子 agent 采集 |
| 某些标准间不存在完美等效 | 低 | 标注"近似等效"，notes 字段说明差异 |
| 数据来源过期或错误 | 低 | 标注来源 + 采集日期；用户反馈入口 |
| ISO 标准版权 | 低 | 只存储牌号对照关系（公开工程知识），不复制标准全文 |

---

## 2. 插件五：材料重量计算器

### 2.1 功能定义

#### 2.1.1 用户故事

> 作为一名海外采购商/工程师，我希望在不提交 CAD 文件的情况下，快速估算一个标准形状零件的重量：选择材质和形状、输入几个关键尺寸，立即得到重量。这在初步询价阶段比上传 STP 文件更快。

#### 2.1.2 与 Task 1 报价计算器的定位差异

| 维度 | Task 1 报价计算器 | Task 2 重量计算器 |
|------|-------------------|-------------------|
| 输入 | STP 文件（精确 3D 模型） | 材料 + 形状 + 手动输入几个尺寸 |
| 精度 | OCC 计算体积，精确到 mm³ | 理想化几何公式，忽略倒角/孔洞/非标形状 |
| 速度 | 需上传 + 解析（5–15s） | 即时（纯前端计算或单次 API） |
| 输出 | 体积 + 重量 + 报价 | 仅重量 |
| 使用场景 | 正式询价 | 快速自评、初步筛选 |

#### 2.1.3 交互流程

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1. 选择  │───▶│ 2. 输入  │───▶│ 3. 计算  │
│ 材质+形状 │    │  尺寸参数 │    │  显示重量 │
└──────────┘    └──────────┘    └──────────┘
```

**Step 1：选择参数**

| 参数 | 控件 | 说明 |
|------|------|------|
| 材质 | 下拉选择（可搜索） | 复用 Task 1 materials 表的密度数据。分为 Aluminum / Steel / Stainless / Titanium / Brass / Copper / Plastics 分组 |
| 形状 | 下拉 + 参考图 | v1.0 支持 6 种形状（见 2.2.1）。选择后显示示意图和尺寸输入框 |
| 数量 | 数字输入 | 正整数，默认 1 |

**Step 2：输入尺寸**

根据所选形状，动态显示不同的尺寸输入字段。每个字段旁标注单位（mm/inch 可切换）。

**Step 3：计算并展示**

- 点击 Calculate 或实时计算（输入即更新）
- 显示：单件重量 + 总体积 + 总重量（单件 × 数量）
- 单位切换：kg / lb / g

### 2.2 数据模型与形状定义

#### 2.2.1 v1.0 支持形状

| 形状 | 参考图 | 输入参数 | 截面积公式 | 体积公式 |
|------|--------|----------|------------|----------|
| **Round Bar** 圆棒 | 实心圆截面 | 直径 D，长度 L | $A = \frac{\pi D^2}{4}$ | $V = A \times L$ |
| **Square Bar** 方棒 | 实心正方形截面 | 边长 A，长度 L | $A = A^2$ | $V = A \times L$ |
| **Flat Bar / Plate** 平板/板材 | 矩形截面 | 宽 W，厚 T，长 L | $A = W \times T$ | $V = A \times L$ |
| **Hexagonal Bar** 六角棒 | 正六边形截面 | 对边距 S，长度 L | $A = \frac{3\sqrt{3}}{2} \cdot \left(\frac{S}{2}\right)^2 \cdot 2 = \frac{\sqrt{3}}{2} S^2$ | $V = A \times L$ |
| **Round Tube / Pipe** 圆管 | 空心圆截面 | 外径 OD，壁厚 WT，长度 L | $A = \frac{\pi}{4}(OD^2 - (OD - 2WT)^2)$ | $V = A \times L$ |
| **Square Tube** 方管 | 空心方形截面 | 外边长 A，壁厚 WT，长度 L | $A = A^2 - (A - 2WT)^2$ | $V = A \times L$ |

> v2.0 可扩展形状：Angle（角钢）、Channel（槽钢）、I-Beam（工字钢）、Sheet（薄板，仅需长×宽×厚）。

#### 2.2.2 实心圆棒（Round Bar）的两种面积公式等价性

几何常识：正六边形对边距 $S$ 即为其内切圆直径。设正六边形边长为 $a$，则 $S = \sqrt{3} \cdot a$。截面积为六个等边三角形之和：

$$A = 6 \times \frac{\sqrt{3}}{4}a^2 = \frac{3\sqrt{3}}{2}a^2$$

代入 $a = S / \sqrt{3}$：

$$A = \frac{3\sqrt{3}}{2} \cdot \frac{S^2}{3} = \frac{\sqrt{3}}{2}S^2$$

后端实现直接用简化公式 $A = \frac{\sqrt{3}}{2} S^2$。

#### 2.2.3 核心公式

所有形状的计算归结为同一公式：

$$
\text{weight} = \text{volume} \times \text{density} \times \text{quantity}
$$

其中：
- $\text{volume} = A_{\text{cross-section}} \times L$（mm³）
- $\text{density}$ 从 Task 1 `materials` 表读取（g/cm³）→ 换算为 g/mm³（$\times 10^{-3}$）
- $\text{quantity}$ 为用户输入

最终重量转换为用户选择的单位（kg / lb / g）。

#### 2.2.4 输入定义

```json
{
  "material_id": 4,
  "shape": "round_bar",
  "dimensions": {
    "diameter": 25.0,
    "length": 100.0
  },
  "quantity": 10,
  "unit": "kg"
}
```

#### 2.2.5 输出定义

```json
{
  "material": {
    "name": "Aluminum 6061-T6",
    "density_gcm3": 2.70
  },
  "shape": "Round Bar",
  "dimensions": {
    "diameter_mm": 25.0,
    "length_mm": 100.0
  },
  "volume_single_cm3": 49.09,
  "weight_single_kg": 0.1325,
  "quantity": 10,
  "total_weight_kg": 1.325
}
```

### 2.3 计算引擎设计

#### 2.3.1 后端服务 `services/weight.py`

```python
SHAPE_FORMULAS = {
    "round_bar": lambda d: {"area": math.pi * d["diameter"]**2 / 4},
    "square_bar": lambda d: {"area": d["side"]**2},
    "flat_bar": lambda d: {"area": d["width"] * d["thickness"]},
    "hexagonal_bar": lambda d: {"area": math.sqrt(3) / 2 * d["across_flats"]**2},
    "round_tube": lambda d: {"area": math.pi / 4 * (d["od"]**2 - (d["od"] - 2*d["wall"])**2)},
    "square_tube": lambda d: {"area": d["side"]**2 - (d["side"] - 2*d["wall"])**2},
}

def calculate_weight(material_density_gcm3, shape, dimensions, quantity, target_unit):
    area_mm2 = SHAPE_FORMULAS[shape](dimensions)["area"]
    volume_mm3 = area_mm2 * dimensions["length"]
    volume_cm3 = volume_mm3 / 1000
    mass_g = volume_cm3 * material_density_gcm3
    mass_kg = mass_g / 1000
    total_kg = mass_kg * quantity
    return convert_weight(total_kg, target_unit)
```

#### 2.3.2 密度来源

直接复用 Task 1 `materials` 表的 `density_gcm3` 字段。公共接口从 `GET /api/public/materials` 获取材质列表（含 id / name / density_gcm3），用户选择材质后前端将 $V \times \rho$ 的计算留在本地以减少 API 调用（密度数据本身不敏感），也可走后端 API 保证一致性。

v1.0 选择：**前端计算**。密度从公共 API 获取后缓存在材质下拉框中，用户在切换材质/尺寸时本地实时计算，无需每次调 API。

#### 2.3.3 单位处理

| 维度 | 输入单位 | 输出单位（可选） |
|------|----------|------------------|
| 尺寸 | mm（默认），可切换 inch | — |
| 重量 | — | kg（默认），lb，g |
| 体积 | — | cm³（默认），in³ |

**inch → mm 转换**：$1 \text{ inch} = 25.4 \text{ mm}$

### 2.4 技术方案

#### 2.4.1 为什么选前端计算而非后端 API

| 考量 | 前端计算 | 后端 API |
|------|----------|----------|
| 响应速度 | 即时（0ms） | 网络延迟（~50ms） |
| 数据敏感性 | 密度为公开物理常数 | — |
| 与服务端一致性 | 密度从 API 取，本地算 | ✅ 永远一致 |
| 计算准确性 | JS 浮点数 vs Python 浮点数（差异 < 1e-12） | — |
| 复杂度 | 简单几何公式，6 种形状 | — |

结论：密度值从 API 取以保证与管理后台一致，但几何计算放在前端以提升响应速度。同时保留后端 `/api/public/weight/calculate` 作为 fallback（供其他系统调用或校验）。

#### 2.4.2 接口清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/public/materials` | 获取材质列表（复用 Task 1 已有接口，需确保含 density_gcm3） |
| POST | `/api/public/weight/calculate` | [可选] 后端重量计算（供校验或外部调用） |

#### 2.4.3 前端

- 形状选择器：每个形状选项旁带一个小 SVG 示意图（6 个内嵌 SVG，不依赖外部图片）
- 尺寸输入：根据所选形状动态渲染不同的输入字段组
- 实时计算：尺寸变化时即时更新重量（debounce 200ms）
- 单位切换：mm ↔ inch 切换联动所有输入字段值

### 2.5 UI/UX 规格

```
┌─────────────────────────────────────────────┐
│  [导航栏]                                     │
├─────────────────────────────────────────────┤
│                                             │
│  ┌────────── 重量计算器 ──────────┐          │
│  │                                  │          │
│  │  材质: [▼ Aluminum 6061-T6  ▾] │          │
│  │  形状: [▼ Round Bar       ▾]  │          │
│  │                                  │          │
│  │  ┌────────────────────┐         │          │
│  │  │     ○ (圆形截面)     │         │          │
│  │  │     ← D →          │         │          │
│  │  └────────────────────┘         │          │
│  │                                  │          │
│  │  直径 (D):  [  25  ] mm  ▾      │          │
│  │  长度 (L):  [  100 ] mm  ▾      │          │
│  │  数量:      [  10  ]            │          │
│  │                                  │          │
│  │  单位: [▼ kg ▾]                 │          │
│  │                                  │          │
│  └──────────────────────────────────┘          │
│                                             │
│  ┌────────── 计算结果 ──────────┐            │
│  │                                │            │
│  │  体积 (单件):    49.09 cm³     │            │
│  │  重量 (单件):    0.133 kg      │            │
│  │  总重量 (×10):   1.33 kg       │            │
│  │                                │            │
│  │  Density: 2.70 g/cm³           │            │
│  │  (Aluminum 6061-T6)            │            │
│  └────────────────────────────────┘            │
│                                             │
└─────────────────────────────────────────────┘
```

### 2.6 测试用例

| 编号 | 场景 | 输入 | 预期输出 |
|------|------|------|----------|
| T5.1 | 圆棒计算 | AL6061, Round Bar, D=25mm, L=100mm, Qty=1 | 体积 49.09 cm³，重量 0.133 kg |
| T5.2 | 方管计算 | SS304, Square Tube, A=50mm, WT=3mm, L=200mm, Qty=5 | 验证截面积公式和总重 |
| T5.3 | 六角棒计算 | Brass C360, Hex Bar, S=20mm, L=150mm, Qty=1 | 截面积 = √3/2 × 20² = 346.41 mm²；体积 = 51962 mm³ |
| T5.4 | 单位切换 | 同上，切换为 inch 输入 | 尺寸自动转换 25.4mm/inch |
| T5.5 | 重量单位切换 | 同上，切换为 lb | 1 kg = 2.2046 lb |
| T5.6 | 材质切换 | 从 AL6061 → SS304 | 重量按密度比例变化（7.93/2.70） |
| T5.7 | 零/负值 | 直径输入 0 或 -5 | 前端校验阻止，显示红色提示 |
| T5.8 | 大批量 | Qty=100000 | 返回正确数值，不溢出 |
| T5.9 | 圆管壁厚校验 | OD=25mm, WT=13mm | 前端校验：壁厚不能超过半径（12.5mm），显示错误提示 |
| T5.10 | 形状切换 | Round Bar → Round Tube | 尺寸输入框从 [D, L] 变为 [OD, WT, L]，示意图切换 |

### 2.7 风险与约束

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| 理想化几何与实际零件重量偏差 | 低 | 页面标注 "Based on ideal geometry, actual weight may vary."；引导用户上传 STP 获取精确重量 |
| 壁厚为 0 或超过外径一半 | 低 | 前端校验阻止无效输入 |
| 密度值更新后重量计算器未感知 | 低 | 密度每次从 API 获取最新值（或设置缓存 TTL） |

---

## 3. 与 Task 1 PRD 的交叉链接

### 3.1 数据层链接

```
Task 1: materials 表
  ├─ id, name, density_gcm3, unit_price_usd_kg, category, is_active
  │
  └── Task 2: material_cross_references 表
        ├─ material_name → 关联到 materials.name（通过名称模糊匹配）
        ├─ 11 个标准 × 牌号
        └── Task 2 重量计算器 → 复用 materials.density_gcm3

Task 1: backend/api_utils.py
  └── Task 2: 所有新 API 复用 api_ok / api_error

Task 1: backend/database.py
  └── Task 2: 同一数据库，新增表通过 models.py 定义
```

### 3.2 前端层链接

```
Task 1: css/plugins.css
  └── Task 2: materials.html / weight.html 复用 tool-shell / tool-grid / tool-panel

Task 1: js/api.js (DaiyujinAPI)
  └── Task 2: materials.js / weight.js 复用 request / checkHealth / config.baseUrl

Task 1: index.html 导航
  └── Task 2: 新增两个入口链接
```

### 3.3 功能联动

| 联动方向 | 说明 |
|----------|------|
| 重量计算器 → 报价计算器 | 用户在重量计算器中确认了某材质和大致重量后，可点击 "Get a Quote" 跳转到报价计算器，材质预填 |
| 材质查表 → 报价计算器 | 当某材料有多种等效牌号时，报价器材质选择可展示 "Also known as: EN AW-7075, 3.4365, A97075..." |
| 材质查表 → 重量计算器 | 用户在查表中找到目标牌号后，可点击材质名跳转到重量计算器，材质预选 |
| 管理后台统一 | Task 1 管理后台扩展材质管理页，增加对照表数据的 CRUD |

### 3.4 基础设施复用清单

| Task 1 件 | Task 2 使用方式 |
|-----------|----------------|
| `backend/database.py` | 同一 Session / engine |
| `backend/models.py` | 新增 `MaterialCrossReference` + 为 `Material` 增加 `density_gcm3` 公开字段确认 |
| `backend/api_utils.py` | 直接 import |
| `backend/app.py` | 注册新 Blueprint |
| `css/plugins.css` | 直接引用 |
| `js/api.js` | 直接引用 |
| `index.html` | 加导航链接 |
| Cloudflare + GitHub Pages + VPS | 同一部署架构 |

### 3.5 Task 1 需要适配的项

Task 2 上线后，Task 1 的以下接口/页面需要小幅适配：

| 适配项 | 优先级 | 说明 |
|--------|--------|------|
| `GET /api/public/materials` | 必须 | 确保返回 `density_gcm3`（当前已返回），Task 2 重量计算器依赖此字段 |
| `quote.html` 材质选择 | 建议 | 材质下拉添加 "Also known as" 提示行（从 cross_references 表取首个匹配） |
| `index.html` 导航 | 必须 | 加两个新入口 |

---

## 4. 开发分期与里程碑

### 4.1 分期规划

Task 2 不阻塞 Task 1 的 Phase 1B（运费计算器）和 1C（公差计算器）。两者可并行推进。

```
Phase 2A ─── 铝合金种子数据 + 查表页面（1–2天）
  ├─ [数据] 编写 seed_materials.py，录入铝合金 ~110 种材料 × 12 标准
  ├─ [数据] 不锈钢 ~10 种常用牌号对照表
  ├─ [模型] models.py 新增 MaterialCrossReference 表
  ├─ [服务] services/materials.py 搜索引擎（LIKE + 排序）
  ├─ [路由] routes/public/materials.py（搜索/类别/标准列表）
  ├─ [前端] materials.html + materials.js（搜索框 + 结果表格）
  ├─ [导航] index.html + about.html 加新入口
  └─ [测试] 8 个搜索测试用例

Phase 2B ─── 重量计算器（1–2天）
  ├─ [服务] services/weight.py（6 种形状公式 + 单位转换）
  ├─ [路由] routes/public/weight.py（可选后端计算 fallback）
  ├─ [前端] weight.html + weight.js（形状图 + 动态输入 + 实时计算）
  ├─ [SVG] 6 个内嵌形状示意图
  ├─ [联动] 重量结果页 "Get a Quote" → 跳转 quote.html
  └─ [测试] 10 个计算测试用例

Phase 2C ── 子 agent 数据采集（后续，可与 Task 1 Phase 2 并行）
  ├─ 钛合金 / 铜合金 / 工程塑料标准对照数据
  ├─ 子 agent 模板化搜索 + JSON 标准化
  ├─ 人工抽查 + 入库
  └─ 数据采集日志

Phase 2D ── 联动增强（后续）
  ├─ 材质查表 → 重量计算器跳转（材质预选）
  ├─ 报价器材质选择 "Also known as" 提示
  ├─ 管理后台材质管理页扩展
  └─ 缺失标准反馈入口
```

### 4.2 Phase 2A 详细任务

**T2A-1：数据库模型**

在 `models.py` 中新增 `MaterialCrossReference` 表（定义见 1.2.1），运行 `init_db.py` 建表。

**T2A-2：种子数据**

编写 `backend/scripts/seed_materials.py` 脚本：

- 铝合金：Worthwill 转换表已采集，结构化 ~80 锻造 + ~30 铸造牌号 × 12 标准 ≈ 1320 行
- 不锈钢：手动整理 303/304/304L/316/316L/321/410/420/430/440C ≈ 120 行
- 每个材料在 12 个标准中各一行，缺失标准 `designation = NULL`
- 标注 `source_name` 和 `source_url`

**T2A-3：搜索服务**

`services/materials.py` 实现：

- `search_materials(query, category=None)` → 返回匹配的材料列表
- 模糊匹配逻辑（见 1.4.1）
- 结果按精确度排序 + 按 `material_name` 聚合

**T2A-4：API 路由**

`routes/public/materials.py`：

- `GET /api/public/materials/search?q=` 搜索
- `GET /api/public/materials/categories` 类别列表
- `GET /api/public/materials/standards` 标准列表

**T2A-5：前端页面**

- `materials.html`：搜索框 + 类别筛选标签 + 结果表格
- `materials.js`：debounce 实时搜索 + 结果渲染 + 关键词高亮

**T2A-6：导航更新**

- `index.html` / `about.html` / 各工具页导航栏加"材质查表"和"重量计算"入口

### 4.3 Phase 2B 详细任务

**T2B-1：计算引擎**

`services/weight.py`：6 种形状的面积/体积公式 + kg/lb/g 单位转换

**T2B-2：前端页面**

- `weight.html`：材质下拉 + 形状选择（带 SVG 图）+ 动态尺寸输入 + 实时重量显示 + 单位切换
- `weight.js`：形状切换→输入框重绘；密度从 API 获取后本地计算；mm/inch 互转

**T2B-3：SVG 示意图**

6 个内嵌 SVG（≤ 200×120px 每个），不依赖外部资源：

- Round Bar：实心圆
- Square Bar：正方形
- Flat Bar：矩形
- Hex Bar：正六边形
- Round Tube：同心圆环
- Square Tube：空心方形

**T2B-4：后端 Fallback API**

`POST /api/public/weight/calculate`（可选）：
- 接收 material_id + shape + dimensions + quantity + unit
- 后端查密度 + 执行公式 → 返回重量
- 前端优先本地计算，此接口作为校验和外部调用口

### 4.4 Phase 2A 交付标准

- [ ] `MaterialCrossReference` 表建表成功
- [ ] 铝合金 ~110 种材料完整入库（~1320 行）
- [ ] 不锈钢 ~10 种常用牌号入库（~120 行）
- [ ] 搜索 "7075" 返回 Aluminum 7075 的 12 个标准对照
- [ ] 搜索 "3.4365"（DIN 牌号）反向查到 Aluminum 7075
- [ ] 类别筛选正常工作
- [ ] 前端页面无控制台错误，移动端响应式正常
- [ ] 导航栏入口全部更新

---

## A. 附录

### A.1 支持的标准清单

| 标准代码 | 全称 | 国家/地区 |
|----------|------|-----------|
| ISO | International Organization for Standardization | 国际 |
| EN | European Norm | 欧盟 |
| DIN | Deutsches Institut für Normung | 德国 |
| ANSI/AA | American National Standards Institute / Aluminum Association | 美国 |
| BS | British Standards | 英国 |
| AFNOR | Association Française de Normalisation | 法国 |
| UNE | Una Norma Española | 西班牙 |
| UNS | Unified Numbering System | 美国（金属统一编号） |
| JIS | Japanese Industrial Standards | 日本 |
| CSA | Canadian Standards Association | 加拿大 |
| SIS | Swedish Standards Institute | 瑞典 |
| GB | 中国国家标准 | 中国 |

### A.2 形状公式速查表

| 形状 | 截面积 $A_{\text{mm}^2}$ | 体积 $V_{\text{mm}^3}$ |
|------|---------------------------|-------------------------|
| Round Bar | $\frac{\pi}{4}D^2$ | $A \times L$ |
| Square Bar | $A^2$ | $A \times L$ |
| Flat Bar / Plate | $W \times T$ | $A \times L$ |
| Hexagonal Bar | $\frac{\sqrt{3}}{2}S^2$ | $A \times L$ |
| Round Tube | $\frac{\pi}{4}(OD^2 - (OD-2WT)^2)$ | $A \times L$ |
| Square Tube | $A^2 - (A-2WT)^2$ | $A \times L$ |

### A.3 形状示意图规格

6 个 SVG 均为内嵌式，使用 `<svg viewBox="0 0 160 100">` 统一画布，`stroke="#16181d"`，`fill="none"` 或浅灰填充。包含标注线（尺寸箭头）和参数标签（D/L/W/T/OD/WT/A/S）。

### A.4 数据来源

| 来源 | URL | 覆盖材料 | 采集日期 |
|------|-----|----------|----------|
| Worthwill Aluminium Conversion Chart | https://www.worthwillaluminium.com/blog/aluminum-onversion-chart/ | 铝合金全系列 | 2026-06-23 |
| MatWeb | https://www.matweb.com/ | 备选来源 | — |
| MakeItFrom | https://www.makeitfrom.com/ | 备选来源 | — |

### A.5 与 Task 1 PRD 的文档关系

| Task 1 章节 | Task 2 对应 |
|-------------|------------|
| 0. 总体架构 | 复用，新增 P4/P5 插件 |
| 1. 部署方案 | 复用，无需额外部署 |
| 4. 后端架构 | 新增表 + 服务，不改架构 |
| 5. ReadStep 重构 | 无直接关系 |
| 7. 开发分期 | Task 2 Phase 2A–2D 与 Task 1 Phase 1B–2 可并行 |

### A.6 文档变更记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-06-23 | v1.0 | 初稿：材质查表 + 重量计算器计划书，包含与 Task 1 PRD 交叉链接 |
