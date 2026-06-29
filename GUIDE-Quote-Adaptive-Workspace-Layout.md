# Quote 页面自适应工作台布局优化指导书

适用项目：`D:\myfirstgithubcode\daiyujinweb`

适用页面：

- `quote.html`
- `css/plugins.css`
- `js/quote.js`
- `daiyujin-tools/templates/quote.php`
- `daiyujin-tools/assets/css/plugins.css`
- `daiyujin-tools/assets/js/quote.js`

目标：修复当前 Quote 页面在未上传、单文件、多文件状态下布局过窄、可读性下降的问题，让页面按任务复杂度自然切换：

```text
未上传：双列，像传统单文件报价工具
单文件：双列，不显示 Parts
多文件：三列，Parts rail 从左侧出现
移动端：单列，Parts 变为顶部横向列表
```

---

## 1. 当前问题诊断

### 1.1 现象

当前页面在宽屏下仍然显得窄，尤其是 `Part & Process` 表单栏可读性较差，材料选择器、上传区域和按钮都被压缩。即使 Parts rail 是隐藏状态，页面仍然像强行预留了多文件工作台的位置。

### 1.2 根因

当前代码有三个关键原因：

1. 外层容器仍然使用通用工具页宽度：

```css
.tool-shell {
    max-width: 1040px;
}
```

这个宽度适合 Freight、Tolerance、Weight 这类轻工具，但对 Instant Quote 的上传、材料二级菜单、预览、3D view、批量 parts 列表来说偏窄。

2. `.quote-workspace` 在宽屏下固定三列：

```css
@media (min-width: 1180px) {
    .quote-workspace {
        grid-template-columns: minmax(220px, 280px) minmax(360px, 480px) minmax(380px, 1fr);
    }
}
```

即使 `Parts` 是 hidden，CSS grid 仍然按三列模型计算。结果是未上传和单文件状态也被三栏工作台挤压。

3. JS 只控制 Parts 显示隐藏，没有控制整体布局状态：

```javascript
batchParts.hidden = state.parts.length === 0;
```

这只能让 Parts 节点不可见，不能告诉 `.quote-workspace` 当前应该是空状态、单文件状态还是批量状态。

### 1.3 设计判断

这不是“单纯加宽页面”能完整解决的问题。正确方向是：

```text
让布局由任务状态驱动，而不是永久三栏。
```

Instant Quote 的用户并不总是批量上传。未上传和单文件时，Parts rail 是多余信息；多文件时，Parts rail 才是主导航。

---

## 2. 目标体验

### 2.1 未上传状态

页面应该回到之前比较稳定的双列体验：

```text
左：Part & Process 表单
右：Part Preview + Reference Estimate
```

不显示 Parts rail。

用户第一眼看到的是一个干净、专业的报价工具，而不是一个空的批处理工作台。

### 2.2 单文件状态

用户只上传 1 个 STEP 文件时，仍然保持双列：

```text
左：当前零件参数
右：当前零件预览和报价结果
```

不显示 Parts rail。因为只有一个零件，不需要导航列表。显示 Parts 反而会让界面显得机械和累赘。

### 2.3 多文件状态

用户上传 2 个或更多 STEP 文件时，页面切换为三栏：

```text
左：Parts rail
中：当前零件参数
右：预览 + 报价结果
```

这个切换可以带轻微动画，让用户感觉界面“展开”为批量工作台。

### 2.4 移动端状态

移动端不要三栏。多文件时，Parts rail 改成顶部横向列表：

```text
顶部：Parts 横向滑动列表
下方：表单
下方：预览 + 报价
```

---

## 3. 实施总览

建议分 5 个阶段推进：

| 阶段 | 目标 |
|---|---|
| Phase A | 清理 DOM，确保页面只有一个 Parts rail |
| Phase B | JS 增加 workspace 状态类 |
| Phase C | CSS 改成状态驱动布局 |
| Phase D | 宽屏和移动端细化 |
| Phase E | WordPress 插件同步与验收 |

---

## 4. Phase A：清理 DOM 结构

### 4.1 本地页面结构

`quote.html` 推荐结构：

```html
<div class="tool-shell quote-shell">
  ...
  <section class="quote-workspace is-empty" data-quote-workspace>
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
</div>
```

重点：

1. 给 `.tool-shell` 增加 `quote-shell` class，只放宽 Quote 页面，不影响 Freight、Tolerance、Weight。
2. 给 `.quote-workspace` 增加 `data-quote-workspace`，方便 JS 精准选择。
3. 初始 class 使用 `is-empty`。
4. `quote-parts-rail` 只保留一个。

### 4.2 WordPress 模板清理

当前需要特别检查：

```text
daiyujin-tools/templates/quote.php
```

之前排查发现插件模板里可能同时存在：

```html
<aside class="tool-panel quote-parts-rail" data-batch-parts hidden>...</aside>
```

以及旧的：

```html
<section class="quote-batch-parts" data-batch-parts hidden>...</section>
```

这会产生两个 `data-batch-parts`，属于高风险结构。`querySelector("[data-batch-parts]")` 只会取第一个，后续维护时很容易出现“本地正常、插件不正常”。

处理要求：

```text
插件模板中只保留左侧 rail 版本。
删除 form 内部旧的 quote-batch-parts section。
确保 data-part-list 也只有一个。
```

验收命令：

```powershell
rg -n "data-batch-parts|data-part-list" quote.html daiyujin-tools\templates\quote.php
```

预期：

```text
quote.html 中 data-batch-parts 出现 1 次，data-part-list 出现 1 次
quote.php 中 data-batch-parts 出现 1 次，data-part-list 出现 1 次
```

---

## 5. Phase B：JS 增加布局状态

### 5.1 新增 workspace 引用

文件：

```text
js/quote.js
daiyujin-tools/assets/js/quote.js
```

在顶部 DOM 查询区增加：

```javascript
const workspace = document.querySelector("[data-quote-workspace]") || document.querySelector(".quote-workspace");
```

### 5.2 新增 updateWorkspaceMode

新增函数：

```javascript
function updateWorkspaceMode() {
    if (!workspace) return;

    const count = state.parts.length;
    workspace.classList.toggle("is-empty", count === 0);
    workspace.classList.toggle("is-single", count === 1);
    workspace.classList.toggle("is-batch", count > 1);
    workspace.dataset.partCount = String(count);

    if (batchParts) {
        batchParts.hidden = count <= 1;
    }
}
```

逻辑说明：

- `is-empty`：没有上传文件。
- `is-single`：只上传一个文件。
- `is-batch`：上传两个或更多文件。
- Parts rail 只在 `count > 1` 时显示。

### 5.3 修改 renderPartList

当前逻辑：

```javascript
batchParts.hidden = state.parts.length === 0;
```

建议改成：

```javascript
updateWorkspaceMode();
```

完整结构：

```javascript
function renderPartList() {
    updateWorkspaceMode();
    if (!batchParts || !partList) return;

    if (batchCount) {
        batchCount.textContent = `${state.parts.length} file(s)`;
    }

    if (state.parts.length <= 1) {
        partList.innerHTML = "";
        return;
    }

    partList.innerHTML = state.parts.map(...).join("");
    ...
}
```

注意：单文件时清空 `partList`，避免隐藏节点里还残留按钮，影响键盘导航或屏幕阅读器。

### 5.4 修改 render

当前：

```javascript
function render() {
    renderPartList();
    result.innerHTML = `${previewCard()}${estimateCard()}`;
    bindPreviewTabs();
}
```

可保留，但确保 `renderPartList()` 内部一定调用 `updateWorkspaceMode()`。

或者更显式：

```javascript
function render() {
    updateWorkspaceMode();
    renderPartList();
    result.innerHTML = `${previewCard()}${estimateCard()}`;
    bindPreviewTabs();
}
```

如果这么写，要避免 `renderPartList()` 又重复调用产生问题。重复调用通常无害，但建议只放在一个地方，减少维护负担。

### 5.5 上传文案优化

当前上传后可能显示：

```javascript
`${state.parts.length} file(s) selected`
```

建议更自然：

```javascript
function uploadLabelText(count) {
    if (count === 0) return "Choose STEP files";
    if (count === 1) return "1 STEP file selected";
    return `${count} STEP files selected`;
}
```

---

## 6. Phase C：CSS 改成状态驱动布局

### 6.1 放宽 Quote 页面容器

不要改全站 `.tool-shell`，否则 Freight、Tolerance、Weight 也会被拉宽，破坏现有视觉节奏。

建议新增：

```css
.quote-shell {
    max-width: min(1680px, calc(100vw - 48px));
}
```

移动端：

```css
@media (max-width: 780px) {
    .quote-shell {
        max-width: none;
        padding-inline: 1rem;
    }
}
```

如果 WordPress 插件模板不方便改 `.tool-shell quote-shell`，也可以使用：

```css
.tool-shell:has(.quote-workspace) {
    max-width: min(1680px, calc(100vw - 48px));
}
```

但 `:has()` 对旧浏览器兼容性稍弱。更推荐显式加 `quote-shell`。

### 6.2 默认双列布局

当前 `.quote-workspace` 不应该默认三栏。建议默认作为双列：

```css
.quote-workspace {
    display: grid;
    gap: 1.5rem;
    align-items: start;
    grid-template-columns: minmax(420px, 520px) minmax(480px, 1fr);
}
```

这个默认布局覆盖：

```text
is-empty
is-single
```

也就是未上传和单文件。

### 6.3 Parts rail 默认隐藏

```css
.quote-parts-rail[hidden] {
    display: none !important;
}
```

不要通过 `visibility: hidden` 或透明度隐藏，因为那样仍然占位。

### 6.4 批量三栏布局

只有 `.quote-workspace.is-batch` 才进入三栏：

```css
@media (min-width: 1180px) {
    .quote-workspace.is-batch {
        grid-template-columns:
            minmax(240px, 300px)
            minmax(420px, 520px)
            minmax(520px, 1fr);
    }

    .quote-workspace.is-batch .quote-parts-rail {
        position: sticky;
        top: 1rem;
        max-height: calc(100vh - 2rem);
        overflow: hidden;
    }

    .quote-workspace.is-empty,
    .quote-workspace.is-single {
        grid-template-columns: minmax(420px, 540px) minmax(520px, 1fr);
    }
}
```

这样 1920 宽屏下不会继续被压在 1040px 容器里，Preview / Estimate 也能获得合理宽度。

### 6.5 中等屏幕布局

在 900-1179px 区间，三栏会太挤。建议：

```css
@media (min-width: 900px) and (max-width: 1179px) {
    .quote-workspace {
        grid-template-columns: minmax(360px, 460px) minmax(420px, 1fr);
    }

    .quote-workspace.is-batch {
        grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    }

    .quote-workspace.is-batch .quote-parts-rail {
        grid-column: 1;
    }

    .quote-workspace.is-batch .quote-config-panel,
    .quote-workspace.is-batch .quote-stack {
        grid-column: 2;
    }
}
```

中等屏幕可以让左侧 Parts rail 占第一列，右侧表单和结果上下排列。这样比三栏硬挤更稳。

### 6.6 移动端布局

```css
@media (max-width: 899px) {
    .quote-workspace,
    .quote-workspace.is-batch,
    .quote-workspace.is-empty,
    .quote-workspace.is-single {
        grid-template-columns: 1fr;
    }

    .quote-workspace.is-batch .quote-parts-rail {
        position: static;
        max-height: none;
        overflow: visible;
    }

    .quote-workspace.is-batch .quote-part-list {
        display: flex;
        flex-direction: row;
        gap: .5rem;
        overflow-x: auto;
        max-height: none;
        padding-bottom: .25rem;
        scroll-snap-type: x proximity;
    }

    .quote-workspace.is-batch .quote-part-row {
        min-width: 220px;
        scroll-snap-align: start;
    }
}
```

移动端用户更可能逐项操作，横向 Parts 列表比左侧 sticky rail 更自然。

---

## 7. Phase D：细节优化

### 7.1 表单最小宽度

表单不应再低于 420px。材料二级菜单需要横向空间。

```css
.quote-config-panel {
    min-width: 0;
}

@media (min-width: 900px) {
    .quote-config-panel {
        min-width: 420px;
    }
}
```

不要用 `width: 420px` 写死，避免中等屏和 WordPress 容器出现横向滚动。

### 7.2 材料选择器

当前材料选择器是：

```css
.quote-material-layout {
    grid-template-columns: 168px minmax(0, 1fr);
}
```

这个设计在表单宽度足够时很好，但在 220px 表单中会被压成 `168px + 0px`。修复布局后它自然会恢复。

仍建议加一道保护：

```css
@container quote-form (max-width: 430px) {
    .quote-material-layout {
        grid-template-columns: 1fr;
    }
}
```

如果不用 container query，则保留现有移动端规则即可：

```css
@media (max-width: 640px) {
    .quote-material-layout {
        grid-template-columns: 1fr;
    }
}
```

### 7.3 Parts rail 出现动画

多文件上传后，Parts rail 从左侧出现可以做轻微动画：

```css
.quote-workspace.is-batch .quote-parts-rail {
    animation: quote-rail-enter .24s ease-out both;
}

@keyframes quote-rail-enter {
    from {
        opacity: 0;
        transform: translateX(-12px);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

@media (prefers-reduced-motion: reduce) {
    .quote-workspace.is-batch .quote-parts-rail {
        animation: none;
    }
}
```

动画要克制，只表示“界面进入批量模式”，不要做大幅位移。

### 7.4 Parts rail 的状态文案

建议把列表状态压短：

| 当前文案 | 建议文案 |
|---|---|
| `Analyzing...` | `Analyzing` |
| `Calculating...` | `Estimating` |
| `Needs recalculation` | `Needs Update` |

原因：rail 宽度通常 240-300px，长文本会抢占文件名空间。

### 7.5 Calculate 按钮位置

目前 `.quote-action-row` 是 sticky bottom。这个方向是对的，但背景应使用面板色，而不是页面色：

```css
.quote-action-row {
    background: linear-gradient(to bottom, transparent, var(--panel) 38%);
}
```

当前如果使用 `var(--surface)`，在白色表单卡片里会略显突兀。

---

## 8. WordPress 插件同步

本轮必须同步三类文件：

```text
quote.html -> daiyujin-tools/templates/quote.php
css/plugins.css -> daiyujin-tools/assets/css/plugins.css
js/quote.js -> daiyujin-tools/assets/js/quote.js
```

同步时注意：

1. 插件模板的 `.tool-shell` 也要加 `quote-shell`。
2. 插件模板只能有一个 `data-batch-parts`。
3. 插件 CSS 必须包含 `.quote-workspace.is-empty`、`.is-single`、`.is-batch`。
4. 插件 JS 必须包含 `updateWorkspaceMode()`。

验收命令：

```powershell
rg -n "quote-shell|data-quote-workspace|is-empty|is-single|is-batch|updateWorkspaceMode" quote.html css\plugins.css js\quote.js daiyujin-tools
rg -n "data-batch-parts|data-part-list" quote.html daiyujin-tools\templates\quote.php
```

---

## 9. 验收标准

### 9.1 未上传状态

视口：1440px 或 1920px

预期：

- 页面为双列。
- 不显示 Parts rail。
- 表单宽度不低于 420px。
- Preview / Estimate 在右侧。
- 材料选择器不是 `168px + 0px`。

检查方式：

```javascript
getComputedStyle(document.querySelector(".quote-workspace")).gridTemplateColumns
```

应类似：

```text
520px 900px
```

而不是：

```text
220px 360px 380px
```

### 9.2 单文件状态

操作：

1. 上传 1 个 STEP 文件。
2. 等待 Ready。

预期：

- 仍是双列。
- Parts rail 不显示。
- 表单和预览都保持足够宽。
- 当前文件信息显示在 Preview 中即可。

### 9.3 多文件状态

操作：

1. 上传 2 个或更多 STEP 文件。
2. 等待 Ready 或 Analyzing。

预期：

- 桌面宽屏切换为三栏。
- Parts rail 出现在左侧。
- 表单在中间。
- Preview + Estimate 在右侧。
- 点击 Parts 中的零件，表单和预览同步切换。

### 9.4 移动端状态

视口：390px 宽

预期：

- 单列。
- 多文件时 Parts 在顶部横向滑动。
- 不出现横向页面滚动。
- Calculate 按钮不遮挡表单内容。

### 9.5 WordPress 状态

线上 WordPress 插件页面同样测试：

- 未上传双列。
- 单文件双列。
- 多文件三栏。
- 移动端单列。
- `data-batch-parts` 无重复。

---

## 10. 推荐最小改动清单

如果只想快速修复当前“窄”的问题，最小改动如下：

1. `quote.html` 和 `quote.php`

```html
<div class="tool-shell quote-shell">
<section class="quote-workspace is-empty" data-quote-workspace>
```

并删除插件模板中 form 内部旧的 `quote-batch-parts`。

2. `js/quote.js` 和插件 JS

```javascript
const workspace = document.querySelector("[data-quote-workspace]") || document.querySelector(".quote-workspace");

function updateWorkspaceMode() {
    if (!workspace) return;
    const count = state.parts.length;
    workspace.classList.toggle("is-empty", count === 0);
    workspace.classList.toggle("is-single", count === 1);
    workspace.classList.toggle("is-batch", count > 1);
    workspace.dataset.partCount = String(count);
    if (batchParts) batchParts.hidden = count <= 1;
}
```

并在 `renderPartList()` 中用它替代：

```javascript
batchParts.hidden = state.parts.length === 0;
```

3. `css/plugins.css` 和插件 CSS

```css
.quote-shell {
    max-width: min(1680px, calc(100vw - 48px));
}

.quote-workspace {
    display: grid;
    gap: 1.5rem;
    align-items: start;
    grid-template-columns: minmax(420px, 540px) minmax(520px, 1fr);
}

.quote-parts-rail[hidden] {
    display: none !important;
}

@media (min-width: 1180px) {
    .quote-workspace.is-batch {
        grid-template-columns: minmax(240px, 300px) minmax(420px, 520px) minmax(520px, 1fr);
    }
}

@media (max-width: 899px) {
    .quote-shell {
        max-width: none;
        padding-inline: 1rem;
    }

    .quote-workspace,
    .quote-workspace.is-batch {
        grid-template-columns: 1fr;
    }
}
```

做到这三步，就能解决当前最明显的“未上传时也被三栏挤窄”的问题。

---

## 11. 设计结论

你的改进思路是正确的，但关键词不是简单的 `full width`，而是：

```text
adaptive workspace
```

Quote 页面比其他小工具更复杂，应当拥有更宽的工作台；但它也不应该在用户还没进入批量任务时强行显示批量结构。最合适的状态是：

```text
默认像专业单文件报价工具；
多文件时展开成批量工作台。
```

这样既保留了单文件用户的清爽体验，也让多文件用户获得高效导航。

