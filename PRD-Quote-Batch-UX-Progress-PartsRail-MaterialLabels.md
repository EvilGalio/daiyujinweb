# PRD：Instant Quote 批量报价 UX 优化

适用项目：`D:\myfirstgithubcode\daiyujinweb`

适用页面：

- `quote.html`
- `js/quote.js`
- `css/plugins.css`
- `backend/services/quote_calculator_v2.py`
- `daiyujin-tools/templates/quote.php`
- `daiyujin-tools/assets/js/quote.js`
- `daiyujin-tools/assets/css/plugins.css`

目标：在多文件报价已经可用的基础上，修正三个体验问题：

1. 批量模式下计算结果出现过快，缺少“专业系统评估中”的等待反馈。
2. Parts 列表位于表单中部，用户选择零件、修改参数、点击计算的动线过长。
3. 前端材料菜单已英文化，但计算结果中仍可能出现中文材料描述，例如 `PVDF 白色`。

---

## 1. 背景判断

当前多文件模式的效率是好的：STEP 上传后先解析几何，零件进入 `Ready` 状态，用户切换零件时缩略图和几何信息已经准备好。这个机制应当保留。

真正的问题不是后端太快，而是前端把“几何解析完成”和“报价评估完成”的心理阶段压缩到一起了。用户看到 Ready 后点击 `Calculate Current Part`，如果接口很快或命中缓存，结果马上出现，会削弱商业系统的专业感。

因此本次优化的原则是：

```text
不重复解析 STEP，不降低真实效率；
在结果区域增加独立的报价评估演出层；
让缓存命中、接口快速返回、接口慢返回三种情况都有统一的专业反馈。
```

---

## 2. 当前代码观察

### 2.1 计算流程

当前 `js/quote.js` 的关键逻辑：

```text
calculateCurrentPart()
  -> readSettingsFromForm()
  -> makeEstimateCacheKey(part)
  -> 如果 part.estimate && estimateCacheKey 命中，直接 render() return
  -> 否则 part.status = calculating
  -> render()
  -> startProgress(part.fileName)
  -> POST /api/public/quote/calculate
  -> render()
```

这解释了“有时一点击就出结果”的体验问题：

1. 缓存命中时直接 `render()`，完全跳过进度条。
2. 非缓存命中时虽然调用了 `startProgress()`，但当前 `estimateCard()` 在 `!part.estimate` 时只返回一段 `Ready to calculate.` 文案，没有渲染 `.quote-progress-fill`、`.quote-progress-phase` 等 DOM，导致 `renderProgress()` 找不到目标元素。
3. API 返回很快时，即使后续补上 progress DOM，也需要最短展示时间，否则肉眼仍然像“瞬间算出”。

### 2.2 当前布局

`quote.html` 目前结构大致是：

```html
<section class="tool-grid">
  <form class="tool-panel tool-form" data-quote-form>
    upload
    material
    process
    tolerance
    postprocess
    quantity
    parts list
    contact
    calculate button
  </form>

  <aside class="quote-stack" data-quote-result>
    preview
    estimate
  </aside>
</section>
```

Parts 列表夹在表单中间。批量文件多时，用户要在页面里上下往返：

```text
选零件 -> 上滑看参数 -> 下滑点计算 -> 再上滑切换零件
```

这对单文件没问题，对批量报价会明显变慢。

### 2.3 中文材料泄露

当前公开结果大概率来自：

```python
public_quote_response()
  selections.material = mat.get("name", "")
```

而 `mat.name` 来自真实材料价格表中的内部字段，例如：

```text
PVDF 白色
PEEK 瓷白白色
PTFE 白色 黑色
```

前端菜单用的是 `material_public_options.json`，但结果卡片没有回查这个 public label，所以会出现：

```text
Material
High-Performance Plastic · PVDF 白色
```

正确做法是：公开结果永远使用 public material label，内部计算继续使用 raw material price row。

---

## 3. 优化目标

### 3.1 商业体验目标

用户应感知到：

- STEP 几何解析是一个阶段。
- 报价评估是另一个阶段。
- 系统在综合材料、工艺、公差、后处理、数量进行评估。
- 批量报价可以高效切换零件，但不会显得像前端写死公式。

### 3.2 工程目标

- 不重新解析已经解析过的 STEP。
- 不重复请求缓存命中的报价。
- 不引入不必要的外部依赖。
- 本地页面和 WordPress 插件行为一致。
- 公开 API 和前端结果不出现中文材料描述。

### 3.3 非目标

- 不重写报价算法。
- 不把缓存删除。
- 不把计算延迟放到后端。
- 不把内部模型明细重新展示给客户。
- 不把所有材料价格表字段暴露到前端。

---

## 4. Phase P1：报价评估进度动画

### 4.1 设计原则

进度动画应放在右侧 `Reference Estimate` 结果卡片内，而不是遮挡全页面。这样用户知道当前正在计算的是“当前零件”，同时还能看到左侧零件列表和预览。

推荐视觉方向：

- 安静、精密、工业软件感。
- 不做夸张科技大屏。
- 使用细进度条、阶段文案、淡入淡出、小型扫描线。
- 动画只使用 `transform`、`opacity`、`width`，避免卡顿。
- 支持 `prefers-reduced-motion`。

### 4.2 进度时长

每次点击 `Calculate Current Part` 后，前端生成一个随机展示时长：

```text
min: 2000 ms
max: 5000 ms
推荐：2200 ms 到 4800 ms
```

逻辑不是固定 sleep，而是“API 请求”和“最短演出时间”同时跑：

```javascript
const presentationMs = randomInt(2200, 4800);
const startedAt = performance.now();

const estimatePromise = cacheHit
  ? Promise.resolve(part.estimate)
  : requestCalculate(payload);

const estimate = await estimatePromise;
const elapsed = performance.now() - startedAt;
await sleep(Math.max(0, presentationMs - elapsed));

showEstimate(estimate);
```

如果 API 慢于 5 秒：

- 进度条停在 92% 到 96%。
- 阶段文案继续轻微切换。
- API 返回后补到 100%，再显示结果。

如果缓存命中：

- 不发请求。
- 仍然展示 2-5 秒的评估动画。
- 文案可以写成 `Retrieving calibrated estimate` 或 `Revalidating current estimate`，不要写 `Uploading` 或 `Parsing`。

### 4.3 状态机

建议把状态拆开，不要只靠 `part.status`：

```javascript
part.uploadStatus = "pending" | "analyzing" | "ready" | "failed";
part.estimateStatus = "empty" | "calculating" | "estimated" | "failed";
part.presentationStatus = "idle" | "running" | "finishing";
part.presentation = {
  progress: 0,
  phase: "",
  startedAt: 0,
  durationMs: 0
};
```

Parts 列表显示状态时可以合成：

```text
uploadStatus=analyzing -> Analyzing
uploadStatus=ready + estimateStatus=empty -> Ready
estimateStatus=calculating -> Estimating
estimateStatus=estimated -> Estimated
estimateStatus=failed -> Failed
```

### 4.4 结果卡片 loading DOM

当前 `estimateCard()` 在未计算时只有 `Ready to calculate.`。需要新增 calculating 分支：

```javascript
function estimateCard() {
  const part = getActivePart();

  if (part?.estimateStatus === "calculating") {
    return estimateLoadingCard(part);
  }

  if (!part || !part.estimate) {
    return estimateEmptyCard(part);
  }

  return estimateResultCard(part);
}
```

`estimateLoadingCard(part)` 应渲染：

```html
<section class="tool-panel quote-estimate quote-estimate-loading" aria-live="polite">
  <h2>Reference Estimate</h2>
  <div class="quote-eval-head">
    <span class="quote-eval-kicker">Manufacturing review</span>
    <strong>Evaluating current part</strong>
  </div>

  <div class="quote-progress">
    <div class="quote-progress-bar">
      <div class="quote-progress-fill" style="width: 0%"></div>
    </div>
    <div class="quote-progress-text">
      <span class="quote-progress-phase">Preparing manufacturing model</span>
      <span class="quote-progress-pct">0%</span>
    </div>
  </div>

  <div class="quote-eval-steps">
    <span>Geometry</span>
    <span>Material</span>
    <span>Tolerance</span>
    <span>Finish</span>
  </div>
</section>
```

### 4.5 阶段文案

建议使用专业但不夸张的英文文案：

```javascript
const ESTIMATE_PHASES = [
  "Preparing manufacturing model",
  "Reviewing machinability factors",
  "Evaluating material and process data",
  "Calibrating tolerance requirements",
  "Assessing surface finish impact",
  "Generating reference estimate"
];
```

不建议使用：

```text
AI super scan
Quantum calculation
Secret system compiling
```

原因：这些词短期看“高大上”，但放在 B2B 制造报价页面上会显得不可信。更好的表达是把真实评估维度写出来，让客户自然觉得系统严谨。

### 4.6 GSAP-like 动画方案

不强制引入 GSAP。当前页面是原生 HTML/CSS/JS，WordPress 插件环境也要尽量少依赖，因此推荐两种方案：

首选：CSS + 原生 JS

- 进度条宽度用 JS 更新。
- 阶段文案用 JS 切换。
- 卡片淡入、扫描线、骨架 shimmer 用 CSS animation。
- 易同步到 WordPress。

可选：GSAP

- 如果后续愿意引入 GSAP，可以用 `gsap.timeline()` 管理进度卡片的进场、阶段切换和完成态。
- WordPress 里需要 `wp_enqueue_script` 或 CDN 引入，注意缓存和加载失败。
- 当前阶段不建议为了一个进度动画增加依赖。

CSS 动画建议：

```css
.quote-estimate-loading {
  position: relative;
  overflow: hidden;
}

.quote-estimate-loading::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 0%, rgba(255,255,255,.55) 42%, transparent 58%);
  transform: translateX(-120%);
  animation: quote-scan 1.8s ease-in-out infinite;
}

@keyframes quote-scan {
  to { transform: translateX(120%); }
}

@media (prefers-reduced-motion: reduce) {
  .quote-estimate-loading::after {
    animation: none;
  }
}
```

### 4.7 代码修改点

文件：`js/quote.js`

需要改：

1. `calculateCurrentPart()`
2. `estimateCard()`
3. `startProgress()`
4. `renderProgress()`

推荐新增：

```javascript
function randomInt(min, max) {}
function sleep(ms) {}
function beginEstimatePresentation(part, options) {}
function finishEstimatePresentation(part, estimate, success) {}
function estimateLoadingCard(part) {}
```

重点修复：

```javascript
if (part.estimate && part.estimateCacheKey === cacheKey) {
  // 不要直接 render return
  // 要进入 presentation flow
}
```

改成：

```javascript
const cacheHit = part.estimate && part.estimateCacheKey === cacheKey;
part.estimateStatus = "calculating";
part.status = "calculating";
part.presentation = createPresentationState(cacheHit);
render();

const estimatePromise = cacheHit
  ? Promise.resolve(part.estimate)
  : requestCalculate(payload);

const estimate = await estimatePromise;
await waitForPresentationMinimum(part);

part.estimate = estimate;
part.estimateCacheKey = cacheKey;
part.estimateStatus = "estimated";
part.status = "estimated";
render();
```

### 4.8 验收标准

1. Ready 状态下点击 `Calculate Current Part`，结果不会瞬间出现。
2. 每次计算展示 2-5 秒随机进度动画。
3. 缓存命中也展示进度动画，但不重新请求 API。
4. API 慢时进度不会卡死在 100%，而是停在 92%-96% 等待。
5. 失败时进度卡片切换为错误提示。
6. WordPress 插件版本行为一致。

---

## 5. Phase P2：Parts 左侧 Rail 布局

### 5.1 UX 判断

批量报价的核心动作是：

```text
选择零件 -> 检查预览 -> 调整参数 -> 计算 -> 切换下一个零件
```

Parts 是批量任务的导航，不应藏在参数表单中部。它应该像文件队列或任务列表一样，固定在工作区左侧，成为页面的主导航。

### 5.2 推荐桌面布局

把当前两栏布局升级为三栏工作台：

```text
┌───────────────┬────────────────────┬────────────────────────┐
│ Parts Rail    │ Part & Process      │ Preview + Estimate     │
│               │                    │                        │
│ part 1 Ready  │ Material            │ Static PNG / 3D View    │
│ part 2 Est.   │ Process             │ Reference Estimate      │
│ part 3 Failed │ Tolerance           │                        │
│               │ Finish              │                        │
│               │ Quantity            │                        │
│               │ Contact             │                        │
│               │ Calculate button    │                        │
└───────────────┴────────────────────┴────────────────────────┘
```

建议 DOM：

```html
<section class="quote-workspace">
  <aside class="tool-panel quote-parts-rail" data-batch-parts hidden>
    <div class="quote-batch-head">
      <h2>Parts</h2>
      <span data-batch-count>0 files</span>
    </div>
    <div class="quote-part-list" data-part-list></div>
  </aside>

  <form class="tool-panel tool-form quote-config-panel" data-quote-form>
    ...
  </form>

  <aside class="quote-stack" data-quote-result>
    ...
  </aside>
</section>
```

这里的 `quote-batch-parts` 不再放在 form 内部。这样用户选零件时不会改变表单滚动位置。

### 5.3 CSS 布局建议

```css
.quote-workspace {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(360px, 480px) minmax(380px, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.quote-parts-rail {
  position: sticky;
  top: 1rem;
  max-height: calc(100vh - 2rem);
  overflow: hidden;
}

.quote-part-list {
  max-height: calc(100vh - 9rem);
  overflow-y: auto;
}

.quote-config-panel {
  position: relative;
}

.quote-action-row {
  position: sticky;
  bottom: 0;
  padding-top: .75rem;
  background: linear-gradient(to bottom, rgba(255,255,255,0), var(--panel) 38%);
}
```

注意：如果站点全局不是白色背景，`var(--panel)` 应替换为实际面板背景变量。

### 5.4 响应式布局

桌面宽屏，三栏：

```css
@media (min-width: 1180px) {
  .quote-workspace {
    grid-template-columns: minmax(220px, 280px) minmax(360px, 480px) minmax(380px, 1fr);
  }
}
```

中等屏幕，两栏：

```text
左：Parts Rail
右：Form + Preview/Estimate stacked
```

移动端：

```text
顶部：可横滑 Parts tabs
下方：Form
再下方：Preview/Estimate
```

移动端不要使用 sticky 左栏。改成：

```css
@media (max-width: 760px) {
  .quote-workspace {
    grid-template-columns: 1fr;
  }

  .quote-parts-rail {
    position: static;
    max-height: none;
  }

  .quote-part-list {
    display: flex;
    overflow-x: auto;
    max-height: none;
  }

  .quote-part-row {
    min-width: 220px;
  }
}
```

### 5.5 Parts Row 信息设计

每个零件行建议包含：

```text
index + filename
status badge
estimated total if available
small dirty indicator if settings changed after estimate
```

状态命名建议：

| 内部状态 | 前端显示 |
|---|---|
| `pending` | Pending |
| `analyzing` | Analyzing |
| `ready` | Ready |
| `calculating` | Estimating |
| `estimated` | Estimated |
| `needs_recalculate` | Needs Update |
| `failed` | Failed |

`Needs recalculation` 太长，建议改成 `Needs Update`，在窄 rail 中更稳。

### 5.6 参数继承与批量效率

移动 parts 后，建议顺手补两个小交互：

1. 当前零件标题

```html
<div class="quote-current-part">
  <span>Current Part</span>
  <strong>bracket.step</strong>
</div>
```

2. 复制设置入口

```text
Apply current settings to unestimated parts
```

这个按钮不是本次必须项，但对批量报价很自然。用户常常一批零件材料、工艺、后处理相同，只是尺寸不同。

### 5.7 验收标准

1. 桌面端 Parts 列表出现在页面最左侧。
2. 用户切换零件时，不需要上下滚动找 Parts。
3. `Calculate Current Part` 不再离当前参数太远。
4. Parts rail 能显示每个零件的 Ready、Estimating、Estimated、Failed 状态。
5. 移动端不出现三栏挤压，Parts 变成横向列表或顶部列表。
6. WordPress 插件模板同步。

---

## 6. Phase P3：公开材料名清洗

### 6.1 问题原则

内部材料价格表可以保留中文、颜色、采购描述，这是成本计算需要的数据。

公开前端只应显示：

```text
Material Category · Public Grade Label
```

例如：

```text
High-Performance Plastic · PVDF
High-Performance Plastic · PEEK
Stainless Steel · SUS304
Aluminum Alloy · 7075 Imported
```

不要显示：

```text
PVDF 白色
PEEK 瓷白白色
PTFE 白色 黑色
```

颜色、规格、采购备注会让客户误以为这是可选颜色或精确材料牌号，且会破坏英文商业页面的一致性。

### 6.2 后端修复点

文件：`backend/services/quote_calculator_v2.py`

新增 helper：

```python
def _public_material_display(material_id: str, category_id: str = "") -> dict:
    cats = material_categories()
    category_label = ""
    material_label = ""
    material_subtitle = ""

    for cat in cats.get("categories", []):
        if cat.get("id") == category_id:
            category_label = cat.get("label", "")
        for m in cat.get("materials", []):
            if m.get("id") == material_id:
                material_label = m.get("label", "")
                material_subtitle = m.get("subtitle", "")
                if not category_label:
                    category_label = cat.get("label", "")
                break

    return {
        "category": category_label or category_id or "",
        "material": material_label or _fallback_public_material_label(material_id),
        "subtitle": material_subtitle,
    }
```

新增 fallback 清洗：

```python
def _strip_cjk(text: str) -> str:
    return re.sub(r"[\u4e00-\u9fff]+", "", text or "").strip()
```

但 fallback 只作为兜底，不应替代 public options 回查。真正稳定的公开显示名必须来自 `material_public_options.json`。

### 6.3 public_quote_response 修改

当前倾向：

```python
"material": mat.get("name", "")
```

应改为：

```python
display = _public_material_display(
    material_id=mat.get("id", ""),
    category_id=cat_id or "",
)

"selections": {
    "material_category": display["category"],
    "material": display["material"],
    ...
}
```

`result["selections"]["material"]` 内部仍可以保留：

```python
{
  "id": "...",
  "name": "PVDF 白色",
  "density_g_cm3": ...,
  "price_rmb_per_kg": ...
}
```

但 `public_quote_response()` 不能把它原样返回。

### 6.4 mailto 同步

前端 `mailBody` 当前使用：

```javascript
Material: ${sel.material_category}${sel.material ? ' / ' + sel.material : ''}
```

只要 API 的 `sel.material` 修好，邮件内容自然修好。

但仍建议在前端加最后一道防线：

```javascript
function publicText(value) {
  return String(value || "").replace(/[\u4e00-\u9fff]+/g, "").replace(/\s+/g, " ").trim();
}
```

用于结果卡片和 mailto。注意这只是兜底，不能把后端修复省掉。

### 6.5 public options 生成脚本补强

文件：`backend/scripts/build_quote_material_public_options.py`

需要补强：

1. `_en_label()` 去掉中文颜色词。
2. 修正 `PEEK(：KETRON100)` 这种中英文符号混合：

```text
PEEK(：KETRON100) -> PEEK (Ketron 100)
```

3. 如果 label 清洗后为空，使用 `material_base_norm` 再清洗。
4. 输出后做 CJK 检查。

生成完成后检查：

```powershell
rg -n -P "[\x{4E00}-\x{9FFF}]" backend\data\quote_model_v2_2\material_public_options.json
```

预期：没有输出。

如果仍有输出，说明 public options 里还有中文泄露，不能发布。

### 6.6 验收标准

1. 选择 PVDF 后，结果显示 `High-Performance Plastic · PVDF`。
2. 选择 PEEK 后，不显示 `瓷白白色`。
3. 选择 PTFE 后，不显示 `白色 黑色`。
4. mailto 邮件正文不含中文材料描述。
5. `material_prices.csv` 可以继续保留中文，不作为问题。
6. `public_quote_response()` 返回体不含 CJK 字符。

---

## 7. 实施顺序

### Phase 0：保护当前可用能力

先不要大改结构，先记录当前行为：

```powershell
cd D:\myfirstgithubcode\daiyujinweb
rg -n "calculateCurrentPart|estimateCard|startProgress|public_quote_response|material_public_options|quote-batch-parts" js backend daiyujin-tools
```

手动记录：

1. 多文件上传是否成功。
2. Ready 状态是否可切换。
3. PNG 缩略图是否正常。
4. 3D View 是否正常。
5. 当前计算是否能写入数据库。

### Phase 1：先修进度演出层

先做这个，因为它改动小、价值高。

动作：

1. 给 `estimateCard()` 增加 calculating 分支。
2. 缓存命中也进入 presentation flow。
3. 设置 2-5 秒随机展示时间。
4. API 快时等待，API 慢时停在 92%-96%。
5. 同步 WordPress JS/CSS。

验收：

```text
同一个零件、同一参数连续点击 Calculate Current Part，两次都应该看到进度动画。
第二次不应重新发 calculate 请求，但要有 2-5 秒演出层。
```

### Phase 2：移动 Parts 到左侧 Rail

动作：

1. 修改 `quote.html` DOM。
2. 修改 `daiyujin-tools/templates/quote.php` DOM。
3. `.tool-grid` 或新增 `.quote-workspace` 三栏布局。
4. `.quote-batch-parts` 从 form 内迁出。
5. 处理 desktop / tablet / mobile 响应式。
6. 保证 `document.querySelector("[data-batch-parts]")` 仍能找到 rail。

验收：

```text
桌面：Parts 在左，参数在中，预览结果在右。
移动：Parts 不挤压表单，可以横滑或置顶。
切换零件后，参数表单正确 hydrate。
```

### Phase 3：修公开材料名

动作：

1. 后端新增 `_public_material_display()`。
2. `public_quote_response()` 使用 public label。
3. `build_quote_material_public_options.py` 增加 CJK 清洗和校验。
4. 前端 `mailBody` 可加 `publicText()` 兜底。
5. 同步 WordPress JS。

验收：

```text
PVDF、PEEK、PTFE 三个材料的结果和邮件正文都不出现中文颜色词。
```

---

## 8. 测试清单

### 8.1 静态检查

```powershell
python -B -m py_compile backend\services\quote_calculator_v2.py backend\services\pricing.py backend\app.py
rg -n "PVDF 白色|PEEK 瓷白|PTFE 白色|Material term|Setup allocation|Machining base" js daiyujin-tools backend\services
rg -n -P "[\x{4E00}-\x{9FFF}]" backend\data\quote_model_v2_2\material_public_options.json
```

说明：

- `backend/data/quote_model_v2_2/material_prices.csv` 里有中文是正常的。
- `material_public_options.json`、公开 JS、公开 API response 不应有中文材料描述。

### 8.2 浏览器手动验收

用 3 个 STEP 文件测试：

1. 批量选择并上传。
2. 等待三个零件都 Ready。
3. 点击第一个零件。
4. 选择材料、后处理、数量。
5. 点击 `Calculate Current Part`。
6. 观察 2-5 秒进度动画。
7. 切换第二个零件，确认左侧状态和右侧预览同步。
8. 重复点击第一个零件同样参数再次计算，确认缓存命中也有演出层。
9. 选择 PVDF，确认结果卡片没有 `白色`。
10. 点击 `Request Formal Quote`，确认邮件正文没有中文材料描述。

### 8.3 API 验收

建议临时写一个小脚本调用 `/api/public/quote/calculate`，指定 `material_id` 为 PVDF 对应 id，例如 `mp_p0170`，然后检查响应：

```python
import json, re, requests

payload = {
    "file_id": "test",
    "part_name": "test.step",
    "stp_filename": "test.step",
    "volume_mm3": 1000,
    "obb_dimensions_mm": "10 x 10 x 10",
    "material_category": "high_performance_plastic",
    "material_id": "mp_p0170",
    "process": "CNC",
    "postprocess_group": "bead_blasting",
    "tolerance_grade": "ISO2768-M",
    "quantity": 100,
    "currency": "USD",
}

r = requests.post("http://127.0.0.1:5000/api/public/quote/calculate", json=payload)
data = r.json()
public_text = json.dumps(data, ensure_ascii=False)
assert "PVDF 白色" not in public_text
assert not re.search(r"[\u4e00-\u9fff]", public_text)
print(data["selections"])
```

如果 review note 或 disclaimer 有中文文案，则这条断言需要缩小到 `data["selections"]` 和 mail 字段。当前 quote 页面整体是英文，建议公开 response 保持全英文。

---

## 9. WordPress 同步要求

每一阶段完成后，都要同步插件副本：

```text
quote.html                      -> daiyujin-tools/templates/quote.php
js/quote.js                     -> daiyujin-tools/assets/js/quote.js
css/plugins.css quote section   -> daiyujin-tools/assets/css/plugins.css
```

同步后检查：

```powershell
rg -n "quote-workspace|quote-parts-rail|estimateLoadingCard|beginEstimatePresentation|publicText" quote.html js\quote.js css\plugins.css daiyujin-tools
```

验收时必须以 WordPress 页面为准再测一次，因为本地静态页面通过不代表插件模板也同步了。

---

## 10. 最小完成标准

做到以下 9 点即可视为本轮完成：

1. Ready 零件点击计算时，Reference Estimate 卡片出现 2-5 秒进度动画。
2. 缓存命中不重新请求 API，但仍展示进度动画。
3. API 慢时进度停留在 92%-96%，返回后再进入完成态。
4. Parts 列表在桌面端移动到页面左侧 rail。
5. 移动端 Parts 不挤压表单，可以自然横滑或置顶。
6. 切换零件后，材料、工艺、公差、后处理、数量能正确 hydrate。
7. PVDF、PEEK、PTFE 的结果卡片不出现中文颜色词。
8. mailto 邮件正文不出现中文材料描述。
9. 本地页面和 WordPress 插件页面行为一致。

