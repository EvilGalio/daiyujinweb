# Quote UIUX 选择反馈、公差文案、邮箱选填优化指导书

日期：2026-06-27
范围：Instant Quote 页面前端交互、选项文案、WordPress 插件同步
原则：只优化用户可见交互和表单约束，不改报价模型、不改材料价格参数、不暴露内部计算逻辑。

## 1. 背景与目标

当前 Quote 页已经进入更接近商业工具的阶段，核心问题从“功能能不能跑”转向“用户能不能明确理解自己正在操作什么”。这次要处理三类问题：

1. Material 二级菜单的选中状态不够明显，用户点选后缺少确认感。
2. General Tolerance 里的 `ISO 2768-c (Coarse)` 说明略显冗余，可以只展示 `ISO 2768-c` 这种更克制的工业标注。
3. Email Address 当前为必填，但业务上希望设为选填，避免用户在早期估价时被表单门槛劝退。

本指导书按 UIUX 和工程落地两条线写。执行时建议先做静态页面，再同步 WordPress 插件，最后做浏览器验收。

## 2. 当前问题诊断

### 2.1 Material 选择反馈弱

当前相关位置：

- `css/plugins.css`
- `daiyujin-tools/assets/css/plugins.css`
- `js/quote.js`
- `daiyujin-tools/assets/js/quote.js`

当前 CSS 的主要问题：

```css
.quote-material-cat-btn:hover { background: rgba(0,0,0,.04); color: var(--ink); }
.quote-material-cat-btn.active { background: rgba(0,0,0,.06); color: var(--ink); }
.quote-material-grade-option:hover { background: rgba(0,0,0,.03); }
.quote-material-grade-option.active { background: rgba(0,0,0,.05); }
```

`hover` 与 `active` 的差别太小。用户点完以后，如果鼠标还停在列表上，视觉上很难判断这是“悬停”还是“已选”。这会造成两个后果：

1. 用户不确定材料大类是否已经切换成功。
2. 用户不确定右侧细分材料是否已经作为报价参数提交。

从可用性角度看，选中状态需要至少两种反馈通道，例如颜色加结构标记、背景加图标、边框加文字权重。只靠浅灰背景，可靠性不够。

### 2.2 Tolerance 文案过度解释

当前后端 options 里大概率是：

```python
"ISO2768-C": ("ISO 2768-c (Coarse)", 1.00),
"ISO2768-M": ("ISO 2768-m (Medium)", 1.05),
"ISO2768-F": ("ISO 2768-f (Fine)", 1.20),
```

在专业报价页面里，`ISO 2768-c` 本身已经是足够明确的标准代码。继续显示 `(Coarse)` 会让界面显得偏教学化，也可能让客户过度关注“粗糙、精细”这样的自然语言，而不是标准等级。

建议只保留：

- `ISO 2768-c`
- `ISO 2768-m`
- `ISO 2768-f`

内部倍率仍然保持：

- `ISO2768-C`: `1.00`
- `ISO2768-M`: `1.05`
- `ISO2768-F`: `1.20`

### 2.3 Email 必填门槛偏高

当前位置：

- `quote.html`
- `daiyujin-tools/templates/quote.php`

当前输入框：

```html
<input id="customer_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email" required>
```

对于早期估价工具，用户还没有决定是否联系公司。强制填写邮箱会增加心理阻力。更合适的策略是：

1. 邮箱选填。
2. 若填写，后续可以用于工程师跟进或邮件报价。
3. 若不填写，不影响 Calculate Estimate。

后端当前如果使用 `customer_email or None`，则通常不需要改后端计算逻辑，只要移除前端 `required` 即可。

## 3. 设计原则

### 3.1 选中状态必须有“确认感”

材料选择器是报价参数入口，不是普通导航菜单。用户每点一次，都会影响价格，所以界面必须明确告诉用户：

- 当前材料大类是哪一个。
- 当前细分材料是哪一个。
- 当前选择已经被系统接受。

建议采用“三层反馈”：

1. 视觉反馈：蓝色边框、浅蓝底、文字加重。
2. 结构反馈：左侧竖线或右侧 check icon。
3. 文本反馈：在材料选择器下方显示 `Selected: Aluminum Alloy · 6061-T6`。

这种做法的优点是屏幕亮度低、色弱用户、鼠标悬停干扰、移动端触控场景下都能读懂。

### 3.2 工业工具要克制，不要花哨

Quote 页面面向 B2B 客户。视觉方向建议是：

- 安静、干净、可信。
- 反馈明确，但不使用大面积高饱和色。
- 动效只用于确认状态，不制造“娱乐化”。

可以借鉴 Apple 工业设计里的“低噪声、高确定性”：让界面保持安静，但在关键状态上非常清楚。

### 3.3 语义反馈和视觉反馈一起做

视觉上加 active 样式还不够。JS 渲染按钮时建议补充：

- category button: `aria-pressed="true/false"`
- material option: `role="option"` 和 `aria-selected="true/false"`
- material list: `role="listbox"`

这样键盘用户和辅助技术也能感知当前选择。

参考原则：

- WAI-ARIA Listbox Pattern: https://www.w3.org/WAI/ARIA/apg/patterns/listbox/
- WCAG 2.2 Focus Appearance 与可感知反馈方向: https://www.w3.org/TR/WCAG22/
- Nielsen Norman Group Visibility of System Status: https://www.nngroup.com/articles/ten-usability-heuristics/

## 4. Phase Q1: Material Picker 选中态重设计

### 4.1 目标效果

用户完成选择后，界面应当达到以下状态：

1. 左侧材料大类按钮有明显选中态。
2. 右侧细分材料行有明显选中态。
3. 右侧顶部或底部显示当前选择摘要。
4. 鼠标 hover 不会盖过 active。
5. 键盘 tab 到按钮时有清晰 focus ring。

建议视觉样式：

- 选中背景：非常浅的蓝色。
- 选中边框：中等强度蓝色。
- 选中文字：深蓝或当前主文字色加粗。
- 选中图标：右侧 check icon。
- category 选中：左侧 3px accent rail。
- material 选中：整行 border + check icon + subtle shadow。

推荐色值：

```css
:root {
    --quote-selected-bg: #eef6ff;
    --quote-selected-border: #0066cc;
    --quote-selected-ink: #083b73;
    --quote-selected-soft: rgba(0, 102, 204, .10);
    --quote-focus-ring: rgba(0, 102, 204, .22);
}
```

如果项目已有 `--accent`，可以把 `--quote-selected-border` 设为 `var(--accent)`。但建议保留 quote 专用变量，避免影响其他插件页面。

### 4.2 CSS 修改建议

修改文件：

- `css/plugins.css`
- `daiyujin-tools/assets/css/plugins.css`

建议把现有 material picker 样式替换或补强为以下方向：

```css
.quote-material-layout {
    --quote-selected-bg: #eef6ff;
    --quote-selected-border: #0066cc;
    --quote-selected-ink: #083b73;
    --quote-selected-soft: rgba(0, 102, 204, .10);
    --quote-focus-ring: rgba(0, 102, 204, .22);
}

.quote-material-cat-btn {
    position: relative;
    border: 1px solid transparent;
    transition: background .16s ease, border-color .16s ease, color .16s ease, box-shadow .16s ease;
}

.quote-material-cat-btn:hover {
    background: rgba(0, 0, 0, .035);
}

.quote-material-cat-btn.active {
    background: var(--quote-selected-bg);
    border-color: rgba(0, 102, 204, .34);
    color: var(--quote-selected-ink);
    font-weight: 700;
    box-shadow: inset 3px 0 0 var(--quote-selected-border);
}

.quote-material-cat-btn:focus-visible,
.quote-material-grade-option:focus-visible {
    outline: 3px solid var(--quote-focus-ring);
    outline-offset: 2px;
}

.quote-material-grade-option {
    position: relative;
    border: 1px solid transparent;
    padding-right: 2.35rem;
    transition: background .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease;
}

.quote-material-grade-option:hover {
    background: rgba(0, 0, 0, .025);
}

.quote-material-grade-option.active {
    background: var(--quote-selected-bg);
    border-color: rgba(0, 102, 204, .42);
    box-shadow: 0 1px 0 rgba(0, 0, 0, .04), 0 0 0 3px var(--quote-selected-soft);
}

.quote-material-grade-option.active .quote-material-grade-label {
    color: var(--quote-selected-ink);
    font-weight: 700;
}

.quote-material-grade-option.active::after {
    content: "✓";
    position: absolute;
    right: .85rem;
    top: 50%;
    width: 1.25rem;
    height: 1.25rem;
    transform: translateY(-50%);
    border-radius: 999px;
    background: var(--quote-selected-border);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: .82rem;
    font-weight: 800;
    line-height: 1;
}
```

说明：

- `active` 的视觉强度必须明显高于 `hover`。
- `focus-visible` 只在键盘导航时出现，比普通 `focus` 更自然。
- `padding-right` 给 check icon 留空间，避免文字和图标重叠。
- `box-shadow: inset 3px 0 0` 作为 category 的结构标记，比纯背景更可靠。

如果担心 `✓` 的字体兼容性，也可以改成项目已有图标库的 check icon。若没有图标库，CSS 伪元素足够轻量。

### 4.3 增加当前选择摘要

建议在 material picker 内增加一行轻量摘要，帮助用户确认当前选择：

```html
<div class="quote-material-selected" data-selected-material>
    Selected: Aluminum Alloy · 6061-T6
</div>
```

样式建议：

```css
.quote-material-selected {
    margin-top: .75rem;
    padding: .65rem .8rem;
    border: 1px solid rgba(0, 102, 204, .18);
    background: rgba(0, 102, 204, .055);
    color: var(--quote-selected-ink);
    border-radius: 8px;
    font-size: .78rem;
    font-weight: 650;
}
```

文案建议：

- 默认：`Selected: Aluminum Alloy · 6061-T6`
- 搜索后仍保留：`Selected: Stainless Steel · 304`
- 如果没有匹配结果：不要清空已选材料，只显示 `No matching grade. Current selection remains active.`

这条摘要不是说明书，不解释功能，只承担状态确认。

### 4.4 JS 渲染修改建议

修改文件：

- `js/quote.js`
- `daiyujin-tools/assets/js/quote.js`

当前 category button 约在 `renderMaterialPicker()` 中渲染：

```js
<button type="button" class="quote-material-cat-btn${c.id === state.selectedMaterialCategory ? ' active' : ''}"
    data-material-cat="${escapeAttr(c.id)}">${escapeHtml(c.label)}</button>
```

建议改为：

```js
<button
    type="button"
    class="quote-material-cat-btn${c.id === state.selectedMaterialCategory ? ' active' : ''}"
    data-material-cat="${escapeAttr(c.id)}"
    aria-pressed="${c.id === state.selectedMaterialCategory ? 'true' : 'false'}">
    ${escapeHtml(c.label)}
</button>
```

当前 material option 约为：

```js
<button type="button" class="quote-material-grade-option${m.id === state.selectedMaterialId ? ' active' : ''}"
    data-material-id="${escapeAttr(m.id)}">
```

建议改为：

```js
<button
    type="button"
    role="option"
    aria-selected="${m.id === state.selectedMaterialId ? 'true' : 'false'}"
    class="quote-material-grade-option${m.id === state.selectedMaterialId ? ' active' : ''}"
    data-material-id="${escapeAttr(m.id)}">
```

material list 外层建议补充：

```js
<div class="quote-material-grade-list" role="listbox" aria-label="Material grade">
```

在渲染模板中补充 selected summary：

```js
const selectedMaterial = categories
    .flatMap(c => c.materials || [])
    .find(m => m.id === state.selectedMaterialId);

const selectedCategory = categories.find(c => c.id === state.selectedMaterialCategory);

const selectedSummary = selectedMaterial
    ? `Selected: ${selectedCategory ? selectedCategory.label : 'Material'} · ${selectedMaterial.label}`
    : "Select a material grade";
```

然后在 HTML 里加入：

```js
<div class="quote-material-selected" data-selected-material>
    ${escapeHtml(selectedSummary)}
</div>
```

注意点：

1. 摘要只显示用户可见的材料名称，不显示单价、倍率、内部 ID。
2. 如果筛选关键词导致当前材料不在列表里，摘要仍保留当前已选材料。
3. 切换 category 时，若当前材料不属于新 category，应自动选择新 category 的第一个材料，避免空选择。

### 4.5 搜索与空状态

当前搜索为空时，如果没有匹配项，建议显示清晰但克制的空状态：

```html
<div class="quote-material-empty">
    No matching grade. Try another keyword.
</div>
```

样式建议：

```css
.quote-material-empty {
    padding: .85rem;
    color: var(--muted);
    font-size: .78rem;
    border: 1px dashed rgba(0, 0, 0, .12);
    border-radius: 8px;
    background: rgba(0, 0, 0, .015);
}
```

执行时注意，不要因为搜索无结果就清空 `state.selectedMaterialId`。用户已经选中的材料仍然是当前报价材料。

### 4.6 移动端表现

当前移动端 category 会横向换行。建议移动端做两点：

1. category 按钮保持足够点击面积，最小高度不低于 40px。
2. active 仍保留蓝色边框和 check 或左侧 rail。

移动端可加：

```css
@media (max-width: 640px) {
    .quote-material-cat-btn {
        min-height: 40px;
    }

    .quote-material-grade-option {
        min-height: 48px;
    }
}
```

## 5. Phase Q2: General Tolerance 文案收敛

### 5.1 修改目标

将用户可见 label 从：

- `ISO 2768-c (Coarse)`
- `ISO 2768-m (Medium)`
- `ISO 2768-f (Fine)`

改为：

- `ISO 2768-c`
- `ISO 2768-m`
- `ISO 2768-f`

### 5.2 后端修改点

修改文件：

- `backend/services/quote_calculator_v2.py`

建议把：

```python
_TOLERANCE_FACTORS = {
    "ISO2768-C": ("ISO 2768-c (Coarse)", 1.00),
    "ISO2768-M": ("ISO 2768-m (Medium)", 1.05),
    "ISO2768-F": ("ISO 2768-f (Fine)",   1.20),
}
```

改为：

```python
_TOLERANCE_FACTORS = {
    "ISO2768-C": ("ISO 2768-c", 1.00),
    "ISO2768-M": ("ISO 2768-m", 1.05),
    "ISO2768-F": ("ISO 2768-f", 1.20),
}
```

保留 key 和倍率。只改 label。

### 5.3 前端影响

当前前端的 tolerance options 由接口 hydrate：

```js
toleranceSelect.innerHTML = (options.tolerance_grades || [])
```

所以大概率不需要在前端硬编码改文案。只要后端 options 返回新 label，静态页和 WordPress 插件都会获得新展示。

需要检查的地方：

- Quote 表单下拉框展示。
- 估价结果 summary 中的 Tolerance 行。
- Request Formal Quote 的 mailto 内容。

如果这些地方读取的是 `selection.tolerance_label`，会自然同步。如果读取的是旧的硬编码文案，需要一并修改。

## 6. Phase Q3: Email Address 改为选填

### 6.1 静态页面修改

修改文件：

- `quote.html`

当前：

```html
<label for="customer_email">Email Address</label>
<input id="customer_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email" required>
```

建议改为：

```html
<label for="customer_email">Email Address <span class="field-optional">(optional)</span></label>
<input id="customer_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email">
```

可选增加一行 helper：

```html
<small class="field-hint">Add your email if you want our engineers to follow up with a formal quote.</small>
```

如果页面已有保密与合规提示，可以不额外增加 helper，避免表单变长。

### 6.2 WordPress 插件模板同步

修改文件：

- `daiyujin-tools/templates/quote.php`

做同样变更：

```html
<label for="customer_email">Email Address <span class="field-optional">(optional)</span></label>
<input id="customer_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email">
```

### 6.3 CSS 样式建议

修改文件：

- `css/plugins.css`
- `daiyujin-tools/assets/css/plugins.css`

增加：

```css
.field-optional {
    color: var(--muted);
    font-weight: 500;
    font-size: .78em;
}

.field-hint {
    display: block;
    margin-top: .35rem;
    color: var(--muted);
    font-size: .74rem;
    line-height: 1.45;
}
```

如果已有类似 helper class，优先复用现有样式。

### 6.4 JS 和后端检查

当前 JS payload 里大概率是：

```js
customer_email: String(formData.get("customer_email") || "").trim(),
```

这行可以保留。

后端如果是：

```python
"customer_email": customer_email or None,
```

也可以保留。

需要避免新增前端校验：

- 不要在 `calculateEstimate()` 里手动判断 email 为空。
- 不要把空 email 作为 API error。
- 如果未来自动发送邮件，必须仅在 email 非空且格式通过时触发。

## 7. Phase Q4: 文件同步清单

### 7.1 静态站文件

需要改：

- `quote.html`
- `js/quote.js`
- `css/plugins.css`
- `backend/services/quote_calculator_v2.py`

### 7.2 WordPress 插件文件

需要同步：

- `daiyujin-tools/templates/quote.php`
- `daiyujin-tools/assets/js/quote.js`
- `daiyujin-tools/assets/css/plugins.css`

建议检查：

- `daiyujin-tools/daiyujin-tools.php`

如果插件静态资源使用版本号控制缓存，建议 bump plugin version 或 asset version。否则 WordPress 可能继续加载旧 CSS/JS。

### 7.3 不建议改的文件

这次不需要改：

- 材料价格表。
- 报价公式。
- 价格区间逻辑。
- 邮件发送逻辑。
- 3D preview 或 static PNG preview。

## 8. 验收标准

### 8.1 Material Picker

必须满足：

1. 点击左侧大类后，该大类有明显 active 状态。
2. 点击右侧细分材料后，该材料有明显 active 状态。
3. active 状态与 hover 状态肉眼可区分。
4. 当前选择摘要显示正确，例如 `Selected: Aluminum Alloy · 6061-T6`。
5. 切换大类后，右侧材料自动落到该大类的有效材料。
6. 搜索无结果时，不清空当前已选材料。
7. 键盘 Tab 到 category 和 material option 时有清晰 focus ring。

### 8.2 General Tolerance

必须满足：

1. 下拉框只显示 `ISO 2768-c`、`ISO 2768-m`、`ISO 2768-f`。
2. 结果区 Tolerance 行不显示 `(Coarse)`、`(Medium)`、`(Fine)`。
3. Request Formal Quote 邮件正文不显示旧说明。
4. 内部倍率不变。

### 8.3 Email Optional

必须满足：

1. Email Address 标签显示 optional。
2. 邮箱为空时可以正常点击 Calculate Estimate。
3. 邮箱为空时 API payload 可传空字符串或不传，但后端不能报错。
4. 邮箱填写非法格式时，浏览器仍使用 `type="email"` 的原生校验。
5. 邮箱填写合法时，原有记录逻辑不受影响。

## 9. 建议验证命令

前端 JS 语法检查：

```powershell
node --check js\quote.js
node --check daiyujin-tools\assets\js\quote.js
```

后端 Python 语法检查：

```powershell
python -B -m py_compile backend\services\quote_calculator_v2.py backend\services\pricing.py backend\app.py
```

快速搜索旧文案：

```powershell
rg -n "Coarse|Medium|Fine|required|quote-material-cat-btn.active|quote-material-grade-option.active" quote.html js\quote.js css\plugins.css daiyujin-tools\templates\quote.php daiyujin-tools\assets\js\quote.js daiyujin-tools\assets\css\plugins.css backend\services\quote_calculator_v2.py
```

注意：`Medium` 可能出现在其他页面或正常文案中，不能机械删除。重点看 quote tolerance 选项是否还显示旧括号文案。

## 10. 浏览器手工验收流程

### 10.1 静态站

1. 启动 API。
2. 打开 `quote.html`。
3. 等待 API Ready。
4. 点击 Material 左侧不同大类。
5. 点击右侧不同细分材料。
6. 确认 active 状态明显，有 check 或结构标记。
7. 清空 Email Address。
8. 上传 STP 或使用现有测试流程。
9. 点击 Calculate Estimate。
10. 确认不会因为邮箱为空而阻止计算。
11. 检查结果区 Tolerance 显示是否为 `ISO 2768-c/m/f`。

### 10.2 WordPress 插件

1. 打包插件 zip。
2. 上传或覆盖安装插件。
3. 清理 WordPress 页面缓存、浏览器缓存、Cloudflare 缓存。
4. 打开官网对应工具页。
5. 重复静态站验收流程。

如果 WordPress 仍显示旧效果，优先检查：

- 插件版本号是否更新。
- CSS/JS 文件是否被浏览器缓存。
- 页面是否加载了 `daiyujin-tools/assets/...` 而不是旧路径。
- Cloudflare 是否缓存了旧静态资源。

## 11. 推荐执行顺序

1. 改 `backend/services/quote_calculator_v2.py` 的 tolerance label。
2. 改 `quote.html`，移除 email `required`，加 optional 文案。
3. 改 `css/plugins.css`，强化 material active、hover、focus 样式。
4. 改 `js/quote.js`，增加 aria、selected summary、空搜索状态。
5. 复制同步到 WordPress 插件文件。
6. 运行语法检查。
7. 浏览器验收静态站。
8. 打包插件并在 WordPress 验收。

## 12. 风险与回滚

### 12.1 主要风险

1. CSS active 过强，页面显得不像专业报价工具。
   处理：降低背景透明度，保留边框和 check。
2. JS 渲染 selected summary 时找不到材料，导致报错。
   处理：所有 `selectedMaterial`、`selectedCategory` 都做空值保护。
3. WordPress 加载旧缓存。
   处理：bump 插件版本，清缓存，确认 Network 面板资源版本。
4. 邮箱变选填后，未来邮件发送逻辑误以为空邮箱也要发送。
   处理：未来实现邮件功能时明确 `if customer_email:` 再触发。

### 12.2 回滚方式

如果上线后视觉反馈过重，只回滚 CSS 的颜色强度，不回滚 aria 和 optional email。

如果 JS selected summary 出现异常，可以先临时隐藏 `.quote-material-selected`，保留 active 样式。

如果 tolerance 文案争议，只改 label，不动 key 和倍率，回滚成本很低。

## 13. 最终交付定义

完成后，这次优化应达到：

- 用户一眼能确认自己选中了哪个材料大类和细分材料。
- General Tolerance 下拉框显得更专业、简洁。
- Email Address 不再成为早期估价的强制门槛。
- 静态站和 WordPress 插件体验一致。
- 报价模型和商业参数继续保持黑盒。
