# PRD：Quote 单文件解析进度与 3D Preview 状态保持修复

适用项目：`D:\myfirstgithubcode\daiyujinweb`

适用文件：

- `js/quote.js`
- `css/plugins.css`
- `daiyujin-tools/assets/js/quote.js`
- `daiyujin-tools/assets/css/plugins.css`

目标：修复 Quote 页面当前两个用户体验问题：

1. 单个零件上传后，几何解析阶段没有明确进度提示。用户点击 `Calculate Current Part` 时只看到 `not ready yet`，不知道系统是否在工作、什么时候能算。
2. 多文件状态下，当前零件处于 `3D View` 时，其他零件从 analyzing 变成 ready 会触发右侧 preview 重渲染，导致当前零件被强制切回 `Static PNG`。

---

## 1. 当前问题诊断

### 1.1 单文件没有解析进度

当前流程大致是：

```text
file input change
  -> addFilesToBatch(files)
  -> render()
  -> analyzePendingParts()
      -> part.uploadStatus = "analyzing"
      -> renderPartList()
      -> uploadStep(file)
      -> part.uploadStatus = "ready"
      -> render()
```

问题在这里：

```javascript
part.uploadStatus = "analyzing";
part.status = "analyzing";
renderPartList();
```

单文件模式下 Parts rail 是隐藏的，所以 `renderPartList()` 对用户几乎没有可见反馈。右侧 `Part Preview` 没有被重新渲染成 analyzing 状态，于是用户看不到解析进度。

随后用户点击 `Calculate Current Part`，代码会走到：

```javascript
if (part.uploadStatus !== "ready") {
    renderError("This part is not ready yet.");
    return;
}
```

这句话从工程角度没错，但从用户体验看是不完整的。用户需要知道：

```text
文件已经收到。
STEP 正在解析。
系统正在生成几何信息和预览图。
完成后才能计算。
```

### 1.2 多文件 3D View 被强制重置

当前 `analyzePendingParts()` 中每个零件解析完成后都会调用：

```javascript
render();
```

而 `render()` 会执行：

```javascript
result.innerHTML = `${previewCard()}${estimateCard()}`;
bindPreviewTabs();
```

`previewCard()` 目前默认生成：

```html
<button data-preview-tab="png" class="active">Static PNG</button>
<button data-preview-tab="3d">3D View</button>
```

所以当用户正在查看零件 A 的 `3D View`，零件 B 或 C 后台解析完成并调用 `render()` 时，右侧整个 preview DOM 被重建，tab 默认又回到 PNG。这不是用户主动切换，而是后台状态更新打断了当前操作。

---

## 2. 设计原则

### 2.1 解析阶段和报价阶段要分开

STEP 文件上传后有两个独立阶段：

```text
Analysis：解析 STEP、生成 PNG/STL/体积/包围盒
Estimate：根据当前参数计算报价
```

单文件时也要明确展示 Analysis 阶段。不要只在多文件 Parts 列表里显示 `Analyzing`。

### 2.2 后台零件状态更新不应打断当前预览

多文件模式中，非当前零件的状态变化只应更新 Parts rail，不应重建当前零件的 Preview / Estimate DOM。

简单判断：

```text
active part 变了 -> 可以重渲染右侧
active part 自己状态变了 -> 可以重渲染右侧
非 active part 状态变了 -> 只更新 Parts rail
```

### 2.3 Preview tab 是用户选择状态

`Static PNG` / `3D View` 不是一次性 UI，它是当前零件的用户选择状态。应该保存在 part 对象上：

```javascript
part.previewMode = "png" | "3d";
```

只要用户没有主动切换，后台分析完成不应该覆盖这个状态。

---

## 3. Phase A：预检与基础稳定

先确认 JS 没有语法错误。之前 Quote 页面出现过 `API checking`，根因就是 `quote.js` parse failed。

每次改完都先跑：

```powershell
cd D:\myfirstgithubcode\daiyujinweb
node --check js\quote.js
node --check daiyujin-tools\assets\js\quote.js
```

预期：无输出。

再确认插件模板中没有重复 Parts rail：

```powershell
rg -n "data-batch-parts|data-part-list" quote.html daiyujin-tools\templates\quote.php
```

预期：

```text
quote.html 中 data-batch-parts 1 次，data-part-list 1 次
quote.php 中 data-batch-parts 1 次，data-part-list 1 次
```

---

## 4. Phase B：单文件 Analysis 进度显示

### 4.1 状态模型扩展

创建 part 时增加 analysis presentation 字段：

```javascript
const part = {
    id: createPartId(),
    index: state.parts.length,
    file,
    fileName: file.name,
    fileKey: fk,
    status: "pending",
    uploadStatus: "pending",
    estimateStatus: "empty",
    analysis: null,
    estimate: null,
    settings: cloneDefaults(),
    settingsSource: "inherited",
    estimateCacheKey: "",
    error: "",

    previewMode: "png",
    analysisPresentation: {
        startedAt: 0,
        progress: 0,
        phase: "Queued for STEP analysis",
    },
};
```

### 4.2 分析阶段文案

建议使用专业但不过度夸张的英文：

```javascript
const ANALYSIS_PHASES = [
    "Uploading STEP file",
    "Reading geometry data",
    "Extracting bounding dimensions",
    "Generating static preview",
    "Preparing manufacturability inputs",
];
```

这比单纯 `Analyzing...` 更有信息量，也能减少用户点击未 ready 按钮时的困惑。

### 4.3 analyzePendingParts 改造

新增一个小工具函数：

```javascript
function renderForPartUpdate(part, { force = false } = {}) {
    if (!part) return;
    if (force || part.id === state.activePartId) {
        render();
    } else {
        renderPartList();
    }
}
```

修改 `analyzePendingParts()`：

```javascript
async function analyzePendingParts() {
    for (const part of state.parts) {
        if (part.uploadStatus !== "pending") continue;

        part.uploadStatus = "analyzing";
        part.status = "analyzing";
        part.analysisPresentation = {
            startedAt: performance.now(),
            progress: 5,
            phase: "Uploading STEP file",
        };

        renderForPartUpdate(part);

        try {
            part.analysis = await uploadStep(part.file);
            part.uploadStatus = "ready";
            part.status = "ready";
            part.analysisPresentation.progress = 100;
            part.analysisPresentation.phase = "Preview ready";
        } catch (e) {
            part.uploadStatus = "failed";
            part.status = "failed";
            part.error = e.message;
            part.analysisPresentation.phase = "STEP analysis failed";
        }

        renderForPartUpdate(part);
    }
}
```

关键点：

- 当前 active part 进入 analyzing 时必须 `render()`，这样单文件右侧 preview 能看到进度。
- 非 active part 进入 ready 时只 `renderPartList()`，避免打断当前 3D View。

### 4.4 Preview 卡片增加 analyzing 分支

修改 `previewCard()` 的状态分支：

```javascript
function previewCard() {
    const part = getActivePart();

    if (!part) {
        return previewEmptyCard();
    }

    if (part.uploadStatus === "pending" || part.uploadStatus === "analyzing") {
        return previewAnalysisCard(part);
    }

    if (part.uploadStatus === "failed") {
        return previewAnalysisFailedCard(part);
    }

    if (!part.analysis) {
        return previewAnalysisCard(part);
    }

    return previewReadyCard(part);
}
```

### 4.5 previewAnalysisCard 示例

```javascript
function previewAnalysisCard(part) {
    const p = part.analysisPresentation || {};
    const pct = Math.max(0, Math.min(95, Math.round(p.progress || 12)));
    const phase = p.phase || "Reading STEP geometry";

    return `<section class="tool-panel quote-preview-panel quote-preview-analysis" aria-live="polite">
        <div class="quote-preview-head">
            <h2>Part Preview</h2>
        </div>

        <div class="quote-analysis-card">
            <div class="quote-analysis-title">
                <span>STEP analysis</span>
                <strong>${esc(part.fileName || "Current part")}</strong>
            </div>

            <div class="quote-progress">
                <div class="quote-progress-bar">
                    <div class="quote-progress-fill" style="width:${pct}%"></div>
                </div>
                <div class="quote-progress-text">
                    <span class="quote-progress-phase">${esc(phase)}</span>
                    <span class="quote-progress-pct">${pct}%</span>
                </div>
            </div>

            <div class="tool-note" style="margin-top:.75rem;">
                We are extracting geometry and preparing the preview. You can calculate once this part is ready.
            </div>
        </div>
    </section>`;
}
```

### 4.6 进度更新方式

如果 `uploadStep()` 不能提供真实进度，可以用前端 presentation progress。不要伪装成真实上传字节进度，只作为“分析阶段反馈”。

新增定时器：

```javascript
function tickAnalysisProgress() {
    const part = getActivePart();
    if (!part || part.uploadStatus !== "analyzing") return;

    const elapsed = performance.now() - (part.analysisPresentation?.startedAt || 0);
    const phases = ANALYSIS_PHASES;
    const ratio = Math.min(elapsed / 8000, 0.92);
    const pct = Math.round(8 + ratio * 84);
    const phaseIndex = Math.min(Math.floor(ratio * phases.length), phases.length - 1);

    part.analysisPresentation.progress = pct;
    part.analysisPresentation.phase = phases[phaseIndex];

    updateVisibleAnalysisProgress(part);
}
```

`updateVisibleAnalysisProgress(part)` 只更新 DOM，不要每 300ms 调 `render()`：

```javascript
function updateVisibleAnalysisProgress(part) {
    if (!part || part.id !== state.activePartId) return;

    const fill = document.querySelector(".quote-preview-analysis .quote-progress-fill");
    const phase = document.querySelector(".quote-preview-analysis .quote-progress-phase");
    const pct = document.querySelector(".quote-preview-analysis .quote-progress-pct");

    if (fill) fill.style.width = `${part.analysisPresentation.progress}%`;
    if (phase) phase.textContent = part.analysisPresentation.phase;
    if (pct) pct.textContent = `${part.analysisPresentation.progress}%`;
}
```

启动：

```javascript
setInterval(tickAnalysisProgress, 350);
```

### 4.7 Calculate 按钮状态

不要让用户在 analyzing 时点击后才看到 `not ready yet`。按钮应该主动反馈。

新增引用：

```javascript
const calculateButton = document.querySelector("[data-calculate-current]");
```

新增：

```javascript
function updateCalculateButton() {
    if (!calculateButton) return;

    const part = getActivePart();
    const isCalculating = part?.estimateStatus === "calculating";
    const isReady = part?.uploadStatus === "ready";

    calculateButton.disabled = !part || !isReady || isCalculating;

    if (!part) {
        calculateButton.textContent = "Upload STEP First";
    } else if (part.uploadStatus === "pending" || part.uploadStatus === "analyzing") {
        calculateButton.textContent = "Analyzing STEP...";
    } else if (part.uploadStatus === "failed") {
        calculateButton.textContent = "Analysis Failed";
    } else if (isCalculating) {
        calculateButton.textContent = "Estimating...";
    } else {
        calculateButton.textContent = "Calculate Current Part";
    }
}
```

在 `render()` 末尾调用：

```javascript
updateCalculateButton();
```

同时 `calculateCurrentPart()` 里保留防御性判断，但文案改得更具体：

```javascript
if (part.uploadStatus !== "ready") {
    renderError("STEP analysis is still running. The estimate will be available once the preview is ready.");
    renderForPartUpdate(part, { force: true });
    return;
}
```

---

## 5. Phase C：3D Preview 状态保持

### 5.1 保存每个 part 的 previewMode

创建 part 时加入：

```javascript
previewMode: "png",
```

当用户点击 tab：

```javascript
function setPreviewMode(mode) {
    const part = getActivePart();
    if (!part) return;
    part.previewMode = mode === "3d" ? "3d" : "png";
}
```

### 5.2 previewReadyCard 使用 part.previewMode

当前 `previewCard()` 默认写死 PNG active。改成：

```javascript
function previewReadyCard(part) {
    const a = part.analysis;
    const mode = part.previewMode || "png";
    const thumbUrl = a.thumbnail_url
        ? new URL(a.thumbnail_url, window.DaiyujinAPI.config.baseUrl || window.location.href).href
        : "";

    return `<section class="tool-panel quote-preview-panel">
        <div class="quote-preview-head">
            <h2>Part Preview</h2>
            <div class="quote-preview-tabs" role="tablist">
                <button type="button" data-preview-tab="png" class="${mode === "png" ? "active" : ""}" aria-selected="${mode === "png" ? "true" : "false"}">Static PNG</button>
                <button type="button" data-preview-tab="3d" class="${mode === "3d" ? "active" : ""}" aria-selected="${mode === "3d" ? "true" : "false"}">3D View</button>
            </div>
        </div>
        <div class="quote-preview-stage">
            <img class="quote-thumb" src="${esc(thumbUrl)}" alt="${esc(a.name)} preview" data-png-preview ${mode === "3d" ? "hidden" : ""}>
            <div class="quote-3d-stage" data-3d-stage ${mode === "png" ? "hidden" : ""}></div>
        </div>
        <div class="metric-row" style="margin-top:0.5rem;"><span>File</span><strong>${esc(a.name)}</strong></div>
        <div class="metric-row"><span>Bounding Size</span><strong>${esc(a.obb_dimensions_mm)} mm</strong></div>
        <div class="metric-row"><span>Volume</span><strong>${formatNum(a.volume_mm3)} mm&sup3;</strong></div>
    </section>`;
}
```

### 5.3 bindPreviewTabs 不再只改 DOM，也要改 state

```javascript
function bindPreviewTabs() {
    const tabs = document.querySelectorAll("[data-preview-tab]");
    if (!tabs.length) return;

    const pngEl = document.querySelector("[data-png-preview]");
    const stage3d = document.querySelector("[data-3d-stage]");

    tabs.forEach(tab => {
        tab.addEventListener("click", async () => {
            const mode = tab.dataset.previewTab === "3d" ? "3d" : "png";
            setPreviewMode(mode);
            await applyPreviewMode(mode, { pngEl, stage3d, tabs });
        });
    });

    const part = getActivePart();
    if (part?.previewMode === "3d") {
        applyPreviewMode("3d", { pngEl, stage3d, tabs });
    }
}
```

`applyPreviewMode()` 负责 DOM 切换和 3D mount：

```javascript
async function applyPreviewMode(mode, { pngEl, stage3d, tabs }) {
    tabs.forEach(t => {
        const active = t.dataset.previewTab === mode;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (mode === "png") {
        if (stage3d) stage3d.hidden = true;
        if (pngEl) pngEl.hidden = false;
        return;
    }

    if (pngEl) pngEl.hidden = true;
    if (stage3d) stage3d.hidden = false;
    await mount3dForActivePart(stage3d);
}
```

### 5.4 避免非 active part 更新导致整块重渲染

这是修复 bug 的关键。即使保存了 `previewMode`，如果非 active part ready 时不断重建 3D canvas，也会造成闪烁和资源浪费。

在 `analyzePendingParts()` 中使用：

```javascript
function renderForPartUpdate(part, { force = false } = {}) {
    if (!part) return;
    if (force || part.id === state.activePartId) {
        render();
    } else {
        renderPartList();
    }
}
```

然后所有后台 part 状态变化都调用这个函数，而不是无条件 `render()`。

示例：

```javascript
part.uploadStatus = "ready";
part.status = "ready";
renderForPartUpdate(part);
```

这样：

```text
A 正在 3D View
B ready -> 只更新 Parts rail
A 的右侧 preview DOM 不动
A 继续保持 3D View
```

### 5.5 切换 active part 时的预期行为

当用户从 A 切换到 B：

- 如果 B 从未打开过 preview，默认 `png`。
- 如果 B 之前选择过 `3d`，回到 B 时继续显示 `3d`。
- 如果 B 尚未 ready，显示 analysis progress，而不是 PNG/3D tab。

这就是每个 part 独立持有 `previewMode` 的价值。

---

## 6. Phase D：样式补充

### 6.1 Analysis preview 样式

在 `css/plugins.css` 和插件 CSS 中新增：

```css
.quote-preview-analysis .quote-analysis-card {
    min-height: 220px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border: 1px solid rgba(148, 163, 184, .28);
    border-radius: var(--radius-sm);
    background:
        radial-gradient(circle at 24% 18%, rgba(255,255,255,.9), transparent 34%),
        linear-gradient(145deg, #f9fafb 0%, #eef1f5 48%, #e4e8ee 100%);
    padding: 1.25rem;
}

.quote-analysis-title span {
    display: block;
    font-size: .72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--muted);
}

.quote-analysis-title strong {
    display: block;
    margin-top: .2rem;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

### 6.2 禁用按钮样式

```css
.tool-button:disabled {
    cursor: not-allowed;
    opacity: .62;
    filter: grayscale(.15);
}
```

不要隐藏按钮。保留按钮并显示 `Analyzing STEP...`，用户会更清楚当前不能点击的原因。

---

## 7. WordPress 同步要求

本地改完后同步：

```text
js/quote.js -> daiyujin-tools/assets/js/quote.js
css/plugins.css -> daiyujin-tools/assets/css/plugins.css
```

如果模板中还有重复 `data-batch-parts`，继续清理：

```text
daiyujin-tools/templates/quote.php
```

同步后检查：

```powershell
node --check js\quote.js
node --check daiyujin-tools\assets\js\quote.js
rg -n "previewMode|previewAnalysisCard|renderForPartUpdate|updateCalculateButton|data-batch-parts" js\quote.js daiyujin-tools\assets\js\quote.js quote.html daiyujin-tools\templates\quote.php
```

---

## 8. 验收用例

### 8.1 单文件上传

操作：

1. 打开 Quote 页面。
2. 上传 1 个 STEP 文件。
3. 不要点击 Calculate。

预期：

- 右侧 `Part Preview` 立即显示 STEP analysis 进度。
- 进度文案会变化，例如 `Reading geometry data`。
- `Calculate Current Part` 按钮显示 `Analyzing STEP...` 并禁用。
- 不显示 Parts rail。

### 8.2 单文件未 ready 时点击计算

如果按钮仍可点击，预期也不能只显示 `not ready yet`。

预期：

- 显示明确提示：`STEP analysis is still running...`
- Preview 区继续显示解析进度。
- 页面不进入错误感很强的失败状态。

更推荐：按钮禁用，用户无法点击。

### 8.3 单文件 ready 后计算

操作：

1. 等待 STEP ready。
2. 点击 Calculate。

预期：

- Preview 显示 Static PNG / 3D View tab。
- Estimate 区显示 2-5 秒计算进度，或按当前实现显示估价进度。
- 计算完成后显示报价。

### 8.4 多文件 3D View 状态保持

操作：

1. 上传 A、B、C 三个 STEP 文件。
2. A ready 后点击 A。
3. 切到 A 的 `3D View`。
4. 等 B 或 C 后台 ready。

预期：

- A 仍然停留在 `3D View`。
- A 的 3D canvas 不应被强制切回 Static PNG。
- Parts rail 中 B/C 状态更新为 Ready。
- 右侧 Preview 不闪烁、不重置。

### 8.5 切换零件后保持各自 tab

操作：

1. A 选择 `3D View`。
2. B 保持 `Static PNG`。
3. A -> B -> A 来回切换。

预期：

- 回到 A 时仍是 `3D View`。
- 回到 B 时仍是 `Static PNG`。

### 8.6 失败状态

操作：

1. 上传一个损坏或不支持的 STEP 文件。

预期：

- Part Preview 显示 analysis failed。
- Calculate 按钮显示 `Analysis Failed` 或禁用。
- 如果是多文件，Parts rail 中该零件显示 Failed。
- 其他零件不受影响。

---

## 9. 最小完成标准

本轮修复完成必须满足：

1. 单文件上传后，右侧 Part Preview 显示解析进度。
2. 单文件 analyzing 时，Calculate 按钮不会只让用户看到 `not ready yet`。
3. 单文件 ready 后恢复 PNG / 3D Preview。
4. 多文件中非 active 零件 ready 不会重渲染当前 Preview。
5. 当前零件的 `previewMode` 能在 PNG / 3D 之间持久保存。
6. A 在 3D View 时，B/C ready 不会把 A 切回 Static PNG。
7. 本地 JS 和插件 JS 都通过 `node --check`。
8. WordPress 插件版本同步。

