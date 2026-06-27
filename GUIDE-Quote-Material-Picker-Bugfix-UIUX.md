# Quote Material Picker Bugfix、表单结构与 UIUX 优化指南

日期：2026-06-27  
范围：Instant Quote 页面 Material 二级选择器、左侧报价表单结构  
目标：修复搜索框失焦、去掉多余 selected 框、取消不必要的左侧滚动条、治理重复材料公开选项，并把表单重组为 Product 与 Contact 两个自然模块。  
执行边界：本指南只指导修改，不直接改变报价公式和材料价格参数。

## 1. 当前结论

这次 Material 选择部分和左侧表单结构有五个独立问题：

1. `Selected: ...` 框信息重复。左侧大类和右侧材料已经有蓝色选中态，再额外加一个 selected 框会让界面显得解释过多。
2. 左侧 category 菜单信息量很少，却出现 scrollbar。原因是 `.quote-material-categories` 设置了 `overflow-y: auto` 和 `max-height: 240px`，当前内容高度接近或超过 240px 时就会触发滚动条。
3. 搜索框每输入一个字符就失焦。原因是 `input` 事件里调用 `renderMaterialPicker()`，而该函数每次都会执行 `materialPicker.innerHTML = ...`，把原来的 input DOM 整个销毁重建。
4. `High-Performance Plastic` 中多个 `PEEK / PEEK alloy` 不是前端重复渲染，而是 `material_public_options.json` 里已经有多条可见文案完全相同的选项。根因是构建公开材料 options 时，中文颜色、品牌等差异被删除或清洗失败，导致不同原始材料在前端看起来一模一样。
5. 左侧表单顺序现在是产品参数、联系人、再回到产品参数。邮箱夹在 Postprocess 和 Quantity 中间，会打断用户填写路径。更合理的结构是先填完产品信息，再进入可选联系人信息。

## 2. 相关文件

静态站：

- `js/quote.js`
- `css/plugins.css`
- `backend/data/quote_model_v2_2/material_public_options.json`
- `backend/scripts/build_quote_material_public_options.py`

WordPress 插件：

- `daiyujin-tools/assets/js/quote.js`
- `daiyujin-tools/assets/css/plugins.css`
- `daiyujin-tools/templates/quote.php`

数据源：

- `backend/data/quote_model_v2_2/material_prices.csv`

表单与联系人：

- `quote.html`
- `js/quote.js`
- `backend/services/quote_calculator_v2.py`
- `backend/services/pricing.py`
- `backend/models.py`，仅当需要把昵称作为独立数据库字段保存时修改。

## 3. 现有代码根因定位

### 3.1 搜索框失焦

当前代码在 `js/quote.js` 中：

```js
const searchInput = materialPicker.querySelector('[data-material-search]');
if (searchInput) {
    searchInput.addEventListener('input', () => {
        state.materialSearch = searchInput.value;
        renderMaterialPicker();
    });
}
```

而 `renderMaterialPicker()` 内部会执行：

```js
materialPicker.innerHTML = `...`;
```

这相当于用户输入 `p` 后，整个 material picker 被重建。浏览器原来聚焦的 input 被删除，新 input 虽然有同样的 value，但它不是刚才那个节点，所以焦点消失。用户再输入 `e` 时，必须重新点击搜索框。

这是确定的 DOM 生命周期问题，不是 CSS 问题。

### 3.2 左侧 scrollbar

当前 CSS：

```css
.quote-material-categories {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    max-height: 240px;
}
```

左侧目前只是材料大类列表，并没有复杂内容。给它固定 `max-height` 和 `overflow-y:auto` 会让一个轻量菜单像“嵌套滚动面板”，视觉上显得拥挤。Windows 环境下滚动条也更显眼。

### 3.3 selected 框冗余

当前 JS 生成：

```js
<div class="quote-material-selected" data-selected-material>
    ${escapeHtml(selectedSummary)}
</div>
```

当前 CSS：

```css
.quote-material-selected {
    margin-top: .75rem;
    padding: .65rem .8rem;
    border: 1px solid rgba(0,102,204,.18);
    background: rgba(0,102,204,.055);
    color: var(--quote-selected-ink);
    border-radius: 8px;
    font-size: .78rem;
    font-weight: 650;
}
```

这个框的内容与左侧 active category、右侧 active material 重复。由于它也是浅蓝色，会和真正的选项状态争夺注意力。Material picker 的核心任务是“选择”，不是“说明选择结果”，因此更推荐删掉 selected 框，把反馈集中在两处：

- 左侧当前 category。
- 右侧当前 material。

### 3.4 PEEK 重复项

当前公开 options 中可以看到：

- `mp_p0159`: `PEEK / PEEK alloy`
- `mp_p0160`: `PEEK / PEEK alloy`
- `mp_p0161`: `PEEK / PEEK alloy`
- `mp_p0162`: `PEEK / PEEK alloy`
- `mp_p0163`: `PEEK / PEEK alloy`

原始 CSV 中这些行其实来自不同材料描述：

- `PEEK 瓷白白色`
- `PEEK 黑色`
- `PEEK 红色`
- `PEEK 蓝色 黄色`
- `PEEK 灰色米黄`

当前构建脚本：

```python
cleaned = re.sub(r'\s+[\u4e00-\u9fff]+$', '', label)
cleaned = re.sub(r'[\u4e00-\u9fff]+', '', cleaned).strip()
```

这会把颜色差异删除掉。`_en_subtitle()` 又回退为：

```python
return f"{base} alloy" if base else ""
```

所以多条不同原始数据被公开成同一个 `PEEK / PEEK alloy`。从用户角度看，它们没有区别；从报价角度看，它们的价格可能不同。这会造成一个很不好的体验：用户选择两个看起来一样的 PEEK，报价却可能变化。

## 4. UIUX 方向

这块界面建议采用“精密工具感”，而不是“说明文档感”：

- 保留两个蓝色选中态即可。
- 删除 selected summary 框。
- 左侧菜单保持轻薄，不出现内部滚动。
- 右侧材料选项用轻量 check 或蓝色边框确认选中。
- 搜索框输入过程稳定，不跳动、不失焦。

视觉层级建议：

1. 左侧 category：浅蓝背景 + 蓝色左边线。
2. 右侧 material：浅蓝背景 + 蓝色边框 + 小 check。
3. 搜索框：只在 focus 时蓝色边框。
4. 不再出现第三块蓝色 selected 信息框。

## 5. Phase M1: 删除 selected 框

### 5.1 JS 修改

修改文件：

- `js/quote.js`
- `daiyujin-tools/assets/js/quote.js`

删除或停止生成这些变量：

```js
const selectedMat = cats.flatMap(c => c.materials || []).find(m => m.id === state.selectedMaterialId);
const selectedCat = cats.find(c => c.id === state.selectedMaterialCategory);
const selectedSummary = selectedMat
    ? `Selected: ${selectedCat ? selectedCat.label : ''} &middot; ${selectedMat.label}`
    : 'Select a material grade';
```

从模板里删除：

```js
<div class="quote-material-selected" data-selected-material>
    ${escapeHtml(selectedSummary)}
</div>
```

### 5.2 CSS 修改

修改文件：

- `css/plugins.css`
- `daiyujin-tools/assets/css/plugins.css`

删除：

```css
.quote-material-selected { ... }
```

如果暂时不想删除，也可以先隐藏：

```css
.quote-material-selected {
    display: none;
}
```

推荐直接删除，避免后续维护者误以为它仍然是设计的一部分。

## 6. Phase M2: 左侧 category 去掉不必要 scrollbar

### 6.1 CSS 修改

把：

```css
.quote-material-categories {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    max-height: 240px;
}
```

改为：

```css
.quote-material-categories {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: visible;
    max-height: none;
    align-self: start;
}
```

如果担心未来 category 数量变得很多，可以改成更克制的保护：

```css
.quote-material-categories {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    max-height: min(60vh, 420px);
    scrollbar-gutter: stable;
}
```

但以当前信息量看，第一种更合适。材料大类不是长列表，不应让用户在左侧小面板里滚动。

### 6.2 宽度建议

当前 grid 是：

```css
.quote-material-layout {
    grid-template-columns: 140px 1fr;
}
```

`High-Performance Plastic` 这类长文本可能会挤压。建议略微放宽：

```css
.quote-material-layout {
    grid-template-columns: 168px minmax(0, 1fr);
}
```

同时给按钮允许正常换行，避免为了不换行造成横向压力：

```css
.quote-material-cat-btn {
    white-space: normal;
    line-height: 1.25;
}
```

如果你想保持非常紧凑，也可以保留 `white-space: nowrap`，但左侧宽度建议不低于 `168px`。

## 7. Phase M3: 修复搜索框输入失焦

### 7.1 推荐方案：拆分渲染函数

核心原则：搜索时只重绘右侧材料列表，不重绘整个 material picker。

建议把当前 `renderMaterialPicker()` 拆成三个层级：

```js
function getCurrentMaterialContext() {
    const cats = state.options.material_categories || [];
    const currentCat = cats.find(c => c.id === state.selectedMaterialCategory) || cats[0];
    const materials = currentCat?.materials || [];
    const query = state.materialSearch.trim().toLowerCase();
    const filtered = query
        ? materials.filter(m =>
            `${m.label || ""} ${m.subtitle || ""}`.toLowerCase().includes(query)
        )
        : materials;
    return { cats, currentCat, materials, filtered };
}
```

第一层渲染完整外壳，只在初始化、切换 category、切换 material 时调用：

```js
function renderMaterialPicker() {
    if (!materialPicker || !state.options) return;
    const { cats, filtered } = getCurrentMaterialContext();

    materialPicker.innerHTML = `
        <div class="quote-material-categories">
            ${renderMaterialCategories(cats)}
        </div>
        <div class="quote-material-grades">
            <input type="text" class="quote-material-search" placeholder="Search grade..."
                value="${escapeHtml(state.materialSearch)}" data-material-search>
            <div class="quote-material-grade-list" role="listbox" aria-label="Material grade">
                ${renderMaterialGradeOptions(filtered)}
            </div>
        </div>`;

    bindMaterialPickerEvents();
}
```

第二层只渲染右侧材料列表：

```js
function renderMaterialGradeListOnly() {
    const list = materialPicker.querySelector('.quote-material-grade-list');
    if (!list) return;
    const { filtered } = getCurrentMaterialContext();
    list.innerHTML = renderMaterialGradeOptions(filtered);
    bindMaterialOptionEvents();
}
```

搜索 input 事件改成：

```js
searchInput.addEventListener('input', () => {
    state.materialSearch = searchInput.value;
    renderMaterialGradeListOnly();
});
```

这样 input DOM 不会被销毁，焦点会自然保留。

### 7.2 最小修复方案

如果暂时不想拆函数，可以在重绘后恢复焦点：

```js
searchInput.addEventListener('input', () => {
    const cursor = searchInput.selectionStart || searchInput.value.length;
    state.materialSearch = searchInput.value;
    renderMaterialPicker();
    const nextInput = materialPicker.querySelector('[data-material-search]');
    if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(cursor, cursor);
    }
});
```

这个方案能快速止血，但不如拆分渲染干净。因为它仍然每个字符都重建整个 picker，会重新绑定所有按钮事件，也会造成更多 DOM 抖动。

推荐采用 7.1。

### 7.3 搜索匹配范围

当前只搜索 `m.label`：

```js
materials.filter(m => m.label.toLowerCase().includes(state.materialSearch.toLowerCase()))
```

建议同时搜索 label 和 subtitle：

```js
materials.filter(m =>
    `${m.label || ""} ${m.subtitle || ""}`.toLowerCase().includes(query)
)
```

这样用户输入 `ketron`、`flame`、`black` 这类词也可能命中。

## 8. Phase M4: 治理 High-Performance Plastic 重复材料

### 8.1 业务判断

公开报价页面不适合展示多个看起来完全一样的材料。只要两个选项的可见信息完全一致，就必须做其中一种处理：

1. 合并为一个公开选项。
2. 显示明确差异，例如 `PEEK Natural / White`、`PEEK Black`、`PEEK KETRON100`。

不能保留多个 `PEEK / PEEK alloy`。这会让用户觉得系统数据质量差。

### 8.2 推荐策略

短期推荐合并：

- 普通颜色 PEEK 合并为一个 `PEEK`。
- 有品牌或特殊牌号的保留为独立选项，例如 `PEEK KETRON100`。
- PEI 等出现相同 label/subtitle 的材料也按同样规则处理。

原因：

- 当前这是粗报价，不需要让客户按颜色变体选择。
- 颜色可能影响材料价格，但客户看不到差异时，不能让它影响公开选择体验。
- 真正需要指定颜色或品牌时，应通过 formal quote 处理。

### 8.3 构建脚本修改方向

修改文件：

- `backend/scripts/build_quote_material_public_options.py`

在 build 过程中增加“公开可见 key”去重。

伪代码：

```python
def visible_key(item: dict) -> tuple[str, str]:
    return (
        item.get("label", "").strip().lower(),
        item.get("subtitle", "").strip().lower(),
    )
```

生成材料项时，不要直接 append。先做候选项：

```python
item = {
    "id": r["price_id"],
    "label": grade,
    "subtitle": subtitle,
    "badges": ["Common"] if r.get("source_priority", "0") == "100" else [],
    "review_recommended": False,
}
```

然后对每个 category 内部按 visible key 去重：

```python
existing = seen.get(key)
if existing is None:
    seen[key] = item
else:
    seen[key] = choose_public_representative(existing, item, r)
```

代表项选择原则建议：

1. 优先 `source_priority` 高。
2. 优先 `confidence` 高。
3. 如果价格差距小，保留当前默认项。
4. 如果价格差距大，但公开文案没有差异，优先选更保守的高价代表，降低低估风险。

这里的“高价代表”只影响该公开材料对应的内部 `material_id`，不把价格展示给用户。

### 8.4 PEEK KETRON100 文案清洗

当前类似 `PEEK(名牌：KETRON100)` 的内容需要公开为：

```text
PEEK KETRON100
```

不建议显示：

```text
PEEK(：KETRON100)
PEEK(锛欿ETRON100)
PEEK(名牌：KETRON100)
```

修改 `_en_label()` 时可以加一条更稳的规则：

```python
upper = label.upper()
if "PEEK" in upper and "KETRON" in upper:
    return "PEEK KETRON100"
```

这比依赖中文 `名牌` 两个字更可靠。

### 8.5 如果选择显示颜色差异

如果你希望保留颜色变体，必须把颜色翻译成英文可见差异，例如：

- `PEEK Natural / White`
- `PEEK Black`
- `PEEK Red`
- `PEEK Blue / Yellow`
- `PEEK Grey / Beige`

但这会把材料选择复杂度重新带回来。对于当前 quote 工具，不推荐把颜色作为公开选择项。

### 8.6 生成后检查重复

生成 `material_public_options.json` 后，必须检查每个 category 内是否还有重复可见项。

PowerShell 检查：

```powershell
$json = Get-Content -LiteralPath 'backend\data\quote_model_v2_2\material_public_options.json' -Raw | ConvertFrom-Json
foreach ($cat in $json.categories) {
    $dups = $cat.materials | Group-Object label,subtitle | Where-Object Count -gt 1
    if ($dups) {
        Write-Host "Duplicate visible materials in $($cat.label):"
        $dups | Select-Object Count,Name | Format-Table -AutoSize
    }
}
```

验收要求：不应再出现 `5 PEEK, PEEK alloy` 这种结果。

## 9. Phase M5: CSS 去重整理

当前 `css/plugins.css` 和插件 CSS 中 material picker 样式存在两套定义：

第一套在 `.quote-material-layout` 到 `.quote-material-badge.review` 附近。

第二套又重新定义：

```css
.quote-material-layout { --quote-selected-bg: ... }
.quote-material-cat-btn { ... }
.quote-material-grade-option { ... }
```

后面的 CSS 会覆盖前面的 CSS。虽然浏览器能运行，但维护时很容易出现“我改了前面，为什么页面没变”的误判。

建议整理为一套完整定义：

```css
.quote-material-layout {
    --quote-selected-bg: #eef6ff;
    --quote-selected-border: #0066cc;
    --quote-selected-ink: #083b73;
    --quote-focus-ring: rgba(0, 102, 204, .22);
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    gap: 0.75rem;
    min-height: 160px;
}
```

右侧 active 建议收敛为：

```css
.quote-material-grade-option.active {
    background: var(--quote-selected-bg);
    border-color: rgba(0,102,204,.42);
}
```

可以去掉这条较重的外发光：

```css
box-shadow: 0 1px 0 rgba(0,0,0,.04), 0 0 0 3px var(--quote-selected-soft);
```

保留 check icon 和边框已经足够清晰：

```css
.quote-material-grade-option.active::after {
    content: "\2713";
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

左侧 active 建议保留：

```css
.quote-material-cat-btn.active {
    background: var(--quote-selected-bg);
    border-color: rgba(0,102,204,.34);
    color: var(--quote-selected-ink);
    font-weight: 700;
    box-shadow: inset 3px 0 0 var(--quote-selected-border);
}
```

这就是你说的“两个蓝色足够醒目”：左侧一个，右侧一个。界面不再额外制造第三个 selected 框。

## 10. Phase M6: 左侧表单重组为 Product 与 Contact

### 10.1 当前问题

当前 `quote.html` 与 `daiyujin-tools/templates/quote.php` 的左侧表单顺序大致是：

1. STEP file
2. Material
3. Process
4. General Tolerance
5. Postprocess
6. Email Address
7. Quantity
8. Currency

这个顺序的问题在于：用户刚填完产品加工要求，就被要求填邮箱，然后又回到数量和货币。用户的心理路径会在“产品信息”和“个人信息”之间跳转。

更自然的填写逻辑应该是：

1. 先完成产品和制造参数。
2. 在产品模块结束处给一个轻量询盘引导。
3. 再进入联系人模块，昵称和邮箱都选填。
4. 最后点击 Calculate Estimate。

这样左侧表单会从一个长列表变成两个清楚的模块：

- Product Details
- Contact Details，optional

### 10.2 推荐字段顺序

建议调整为：

1. Choose STEP file
2. Material
3. Process
4. General Tolerance
5. Postprocess
6. Quantity
7. Currency
8. Product inquiry note，带 mailto 链接
9. Contact Details，optional
10. How should we address you?，optional
11. Email Address，optional
12. Calculate Estimate
13. Privacy note

从前端设计角度，这个顺序更像一个专业报价工作流：

- 前半段是“这是什么零件、怎么做、做多少”。
- 后半段是“如果需要跟进，我们如何联系你”。

### 10.3 HTML 结构建议

修改文件：

- `quote.html`
- `daiyujin-tools/templates/quote.php`

建议在 form 内引入轻量 section wrapper。不要做嵌套 card，不要加大面积背景块，只用标题、间距和分隔线形成模块感。

推荐结构：

```html
<form class="tool-panel tool-form" data-quote-form>
    <section class="quote-form-section quote-form-section-product" aria-labelledby="quote-product-title">
        <h2 id="quote-product-title">Part &amp; Process</h2>

        <label class="tool-upload" data-upload-label>
            <input name="file" type="file" accept=".stp,.step">
            <span>Choose STEP file</span>
            <small>.stp / .step &middot; max 50 MB</small>
        </label>

        <div class="tool-field">
            <span class="tool-label">Material</span>
            <div class="quote-material-layout" data-material-picker></div>
        </div>

        <div class="tool-field">
            <label for="process">Process</label>
            <select id="process" name="process" data-process-select>
                <option value="">Loading&hellip;</option>
            </select>
        </div>

        <div class="tool-field">
            <label for="tolerance">General Tolerance</label>
            <select id="tolerance" name="tolerance_grade" data-tolerance-select>
                <option value="">Loading&hellip;</option>
            </select>
        </div>

        <div class="tool-field">
            <label for="postprocess">Postprocess</label>
            <select id="postprocess" name="postprocess_group" data-postprocess-select>
                <option value="">Loading&hellip;</option>
            </select>
        </div>

        <div class="tool-field">
            <label for="quantity">Quantity</label>
            <input id="quantity" name="quantity" type="number" min="1" step="1" value="100">
        </div>

        <div class="tool-field">
            <label for="currency">Currency</label>
            <select id="currency" name="currency" data-currency-select>
                <option value="USD">USD</option>
            </select>
        </div>

        <p class="quote-inquiry-note">
            Looking for more material grades, custom materials, machining processes, or finishing options?
            <a href="mailto:?subject=Custom%20Manufacturing%20Request">Contact our engineers</a>
            for a fast formal review.
        </p>
    </section>

    <section class="quote-form-section quote-form-section-contact" aria-labelledby="quote-contact-title">
        <h3 id="quote-contact-title">Contact Details <span class="field-optional">(optional)</span></h3>

        <div class="tool-field">
            <label for="customer_name">How should we address you? <span class="field-optional">(optional)</span></label>
            <input id="customer_name" name="customer_name" type="text" placeholder="Name or nickname" autocomplete="name" maxlength="80">
        </div>

        <div class="tool-field">
            <label for="customer_email">Email Address <span class="field-optional">(optional)</span></label>
            <input id="customer_email" name="customer_email" type="email" placeholder="name@company.com" autocomplete="email">
            <small class="field-hint">Add your email if you want our engineers to follow up with a formal quote.</small>
        </div>
    </section>

    <button class="tool-button" type="submit">Calculate Estimate</button>

    <p class="quote-privacy-note">
        By submitting this form, you confirm that you are authorized to share the uploaded file.
        If you provide contact details, we use them only to generate and follow up on your manufacturing estimate.
        We treat uploaded drawings and quote data as confidential business information.
    </p>
</form>
```

### 10.4 英文文案建议

产品模块下方询盘引导推荐：

```text
Looking for more material grades, custom materials, machining processes, or finishing options? Contact our engineers for a fast formal review.
```

这个文案的优点：

- 没有暴露系统选项不足。
- 提到了更多材料、自定义材料、加工、后处理。
- “fast formal review” 比 “quote now” 更稳，不会承诺自动给正式报价。
- 链接集中在 `Contact our engineers`，用户能直接行动。

如果想更短，可以用：

```text
Need a material, process, or finish that is not listed? Contact our engineers for a fast formal review.
```

联系人模块标题推荐：

```text
Contact Details (optional)
```

昵称字段推荐：

```text
How should we address you? (optional)
```

比 `Nickname` 更适合 B2B 语境，也比 `Name` 更轻，不会让用户觉得必须提交真实全名。

### 10.5 mailto 链接处理

当前项目里的 Request Formal Quote 使用：

```html
mailto:?subject=...
```

也就是没有固定收件人，由用户邮件客户端自己选择。产品模块下方的 `Contact our engineers` 可以先沿用这个策略：

```html
<a href="mailto:?subject=Custom%20Manufacturing%20Request">Contact our engineers</a>
```

如果公司已有正式询盘邮箱，建议改为：

```html
<a href="mailto:sales@company.com?subject=Custom%20Manufacturing%20Request">Contact our engineers</a>
```

执行时把 `sales@company.com` 替换为公司确认过的官网询盘邮箱。不要把个人邮箱硬编码进插件。

也可以加 body，方便客户发起询盘：

```html
<a href="mailto:sales@company.com?subject=Custom%20Manufacturing%20Request&body=Hello%20Daiyujin%20Engineering%20Team%2C%0D%0A%0D%0AI%20would%20like%20to%20ask%20about%20custom%20materials%2C%20processes%2C%20or%20finishing%20options.%0D%0A">
    Contact our engineers
</a>
```

如果 URL 太长影响可读性，可以在 JS 里生成 mailto。短期用静态 `subject` 即可。

### 10.6 CSS 样式建议

修改文件：

- `css/plugins.css`
- `daiyujin-tools/assets/css/plugins.css`

建议增加：

```css
.quote-form-section {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
}

.quote-form-section + .quote-form-section {
    margin-top: 1.15rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
}

.quote-form-section-contact h3 {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.25;
    color: var(--ink);
}

.quote-inquiry-note {
    margin: 0.1rem 0 0;
    color: var(--muted);
    font-size: 0.76rem;
    line-height: 1.5;
}

.quote-inquiry-note a {
    color: var(--accent);
    font-weight: 700;
    text-decoration: none;
    border-bottom: 1px solid rgba(0, 102, 204, .28);
}

.quote-inquiry-note a:hover {
    border-bottom-color: currentColor;
}
```

设计注意：

- 询盘引导只是一行小字，不要做成蓝色 banner。
- Contact 模块用上边线分隔即可，不要在已有 panel 里再套 card。
- `Contact Details` 用 `h3`，不要和页面主标题抢层级。
- `field-optional` 沿用现有样式。

### 10.7 JS payload 修改

修改文件：

- `js/quote.js`
- `daiyujin-tools/assets/js/quote.js`

在 `calculateEstimate()` 的 payload 中增加：

```js
customer_name: String(formData.get("customer_name") || "").trim(),
```

示例：

```js
const payload = {
    file_id: state.analysis.file_id,
    part_name: state.analysis.name,
    stp_filename: state.fileName,
    volume_mm3: state.analysis.volume_mm3,
    obb_dimensions_mm: state.analysis.obb_dimensions_mm,
    material_category: state.selectedMaterialCategory,
    material_id: state.selectedMaterialId,
    process: String(formData.get("process") || "CNC"),
    postprocess_group: String(formData.get("postprocess_group") || "bead_blasting"),
    tolerance_grade: String(formData.get("tolerance_grade") || "ISO2768-M"),
    quantity: Number(formData.get("quantity")),
    currency: String(formData.get("currency") || "USD"),
    customer_name: String(formData.get("customer_name") || "").trim(),
    customer_email: String(formData.get("customer_email") || "").trim(),
};
```

昵称和邮箱一样选填。不要在前端因为昵称为空而阻止计算。

如果需要在 Request Formal Quote 的 mailto body 中带上昵称，可以在 `mailBody` 里追加：

```js
const customerName = String(new FormData(form).get("customer_name") || "").trim();
if (customerName) {
    mailBody += `%0D%0AContact Name: ${encodeURIComponent(customerName)}`;
}
```

注意：当前 `mailBody` 是手工拼接的 `%0D%0A` 字符串。追加动态字段时要用 `encodeURIComponent()`，避免用户输入特殊字符破坏 mailto。

### 10.8 后端记录建议

修改文件：

- `backend/services/quote_calculator_v2.py`
- `backend/services/pricing.py`
- `backend/models.py`，仅当要单独建字段时。

短期推荐做法：

1. `calculate_quote_v2()` 里读取：

```python
customer_name = str(payload.get("customer_name", "")).strip()
```

2. result 里保留：

```python
"customer_name": customer_name or None,
```

3. `_record_inquiry()` 的 `input_params` 中增加 contact 快照：

```python
"contact": {
    "customer_name": payload.get("customer_name", ""),
    "customer_email": payload.get("customer_email", ""),
},
```

这样不需要立刻改数据库结构，也能在 raw snapshot 里保留联系人信息。

如果后续需要后台直接按昵称检索，则增加 nullable 字段：

```python
customer_name: Mapped[str | None] = mapped_column(String(120))
```

同时要更新建表脚本或迁移脚本。这个不是本轮 UI 优化必须项。

### 10.9 验收标准

必须满足：

1. Email Address 移到 Quantity 和 Currency 后面。
2. 新增 `How should we address you? (optional)` 输入框。
3. 昵称为空时可以正常 Calculate Estimate。
4. 邮箱为空时可以正常 Calculate Estimate。
5. 产品模块下方出现一行小字询盘引导。
6. `Contact our engineers` 是可点击的 mailto 链接。
7. 产品模块与联系人模块通过轻量分隔线区分，没有新增嵌套 card。
8. WordPress 插件模板与静态页顺序一致。

## 11. WordPress 同步

完成静态站后，同步到：

- `daiyujin-tools/assets/js/quote.js`
- `daiyujin-tools/assets/css/plugins.css`
- `daiyujin-tools/templates/quote.php`

如果 WordPress 插件有版本号或 enqueue asset version，需要 bump 一次版本。否则浏览器或 Cloudflare 可能继续加载旧 JS/CSS。

## 12. 验收清单

### 12.1 UI 验收

必须满足：

1. Material 区域不再显示 `Selected: ...` 框。
2. 左侧 category 默认桌面视图不出现 scrollbar。
3. 当前 category 仍然有清晰选中态。
4. 当前 material 仍然有清晰选中态。
5. 蓝色反馈集中在左侧 active 和右侧 active 两处。
6. 右侧列表 hover 与 active 可区分。
7. 键盘 Tab 到搜索框、category、material 时焦点可见。

### 12.2 搜索验收

必须满足：

1. 点击搜索框输入 `p`，输入框不失焦。
2. 连续输入 `peek`，不需要重新点击输入框。
3. 删除搜索词时列表正常恢复。
4. 搜索无结果时显示空状态。
5. 搜索无结果时，不清空当前已选 material。
6. 搜索应匹配 label 和 subtitle。

### 12.3 材料数据验收

必须满足：

1. `High-Performance Plastic` 里不再出现多个完全相同的 `PEEK / PEEK alloy`。
2. 若保留多个 PEEK，必须有可见差异，例如 `PEEK` 与 `PEEK KETRON100`。
3. 不显示中文、乱码中文、内部价格、source row、confidence。
4. 生成后的 `material_public_options.json` 中，同一 category 内没有重复 `label + subtitle`。

### 12.4 表单结构验收

必须满足：

1. 左侧表单先完成产品参数，再进入 Contact Details。
2. Quantity 和 Currency 位于 Contact Details 之前。
3. `How should we address you?` 与 `Email Address` 均标注 optional。
4. 联系人两项为空时，估价流程不报错。
5. Product inquiry note 的 mailto 链接可点击。
6. 隐私文案改成“如果提供联系人信息才用于跟进”，避免暗示邮箱必填。

## 13. 建议验证命令

JS 语法检查：

```powershell
node --check js\quote.js
node --check daiyujin-tools\assets\js\quote.js
```

Python 语法检查：

```powershell
python -B -m py_compile backend\scripts\build_quote_material_public_options.py backend\services\quote_calculator_v2.py
```

重新生成公开材料 options：

```powershell
python backend\scripts\build_quote_material_public_options.py
```

检查重复公开材料：

```powershell
$json = Get-Content -LiteralPath 'backend\data\quote_model_v2_2\material_public_options.json' -Raw | ConvertFrom-Json
foreach ($cat in $json.categories) {
    $dups = $cat.materials | Group-Object label,subtitle | Where-Object Count -gt 1
    if ($dups) {
        Write-Host "Duplicate visible materials in $($cat.label):"
        $dups | Select-Object Count,Name | Format-Table -AutoSize
    }
}
```

快速定位旧 selected 框：

```powershell
rg -n "quote-material-selected|Selected:" js\quote.js css\plugins.css daiyujin-tools\assets\js\quote.js daiyujin-tools\assets\css\plugins.css
```

快速确认联系人字段同步：

```powershell
rg -n "customer_name|How should we address|Contact our engineers|quote-inquiry-note|quote-form-section" quote.html js\quote.js css\plugins.css daiyujin-tools\templates\quote.php daiyujin-tools\assets\js\quote.js daiyujin-tools\assets\css\plugins.css backend\services\quote_calculator_v2.py backend\services\pricing.py
```

## 14. 推荐执行顺序

1. 先改 `js/quote.js`，拆分搜索列表渲染，修复输入失焦。
2. 删除 `quote-material-selected` 相关 JS 和 CSS。
3. 整理 `css/plugins.css`，合并 material picker 样式，取消左侧 category scrollbar。
4. 修改 `backend/scripts/build_quote_material_public_options.py`，增加公开可见项去重和 `PEEK KETRON100` 清洗。
5. 重新生成 `material_public_options.json`。
6. 重排 `quote.html` 表单顺序，增加 Product inquiry note、Contact Details、昵称字段。
7. 在 `js/quote.js` payload 中增加 `customer_name`。
8. 后端按短期方案把 `customer_name` 保留进 result 或 inquiry raw snapshot。
9. 把 HTML/PHP、JS、CSS 同步到 WordPress 插件。
10. 运行语法检查、重复材料检查、联系人字段同步检查。
11. 浏览器手工验收搜索、选中态、左侧菜单、High-Performance Plastic 列表、表单顺序和 mailto 链接。

## 15. 最终完成定义

这轮完成后，Material 选择器应该表现为：

- 简洁，只有左侧 category 和右侧 material 两个明确蓝色选中反馈。
- 稳定，搜索时不丢焦点。
- 干净，左侧没有多余滚动条。
- 可信，同一个分类里不会出现多个看起来完全一样但可能报价不同的材料。
- 可维护，CSS 不再有两套互相覆盖的 material picker 定义。
- 顺畅，左侧表单先完成 Product Details，再进入 Contact Details。
- 有转化意识，产品模块下方用克制的小字引导客户通过 mailto 发起自定义材料、加工、后处理询盘。
