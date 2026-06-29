# PRD: Batch Instant Quote v1

日期：2026-06-29  
范围：Instant Quote 页面批量 STEP 上传、单件聚焦、参数继承、结果缓存、联系人共享、报价记录关联  
目标：把当前单文件 Instant Quote 升级为适合多零件询价的 Batch Quote 工作台，同时保持现有后端接口和报价模型的稳定性。

## 1. 背景

当前 Quote 页面只支持单个 STEP 文件：

- `quote.html` 的 file input 没有 `multiple`。
- `js/quote.js` 使用 `fileInput.files[0]`。
- 前端 state 只有一个 `analysis` 和一个 `estimate`。
- 后端已有单文件接口：
  - `POST /api/public/quote/upload`
  - `POST /api/public/quote/calculate`
- 昵称和邮箱已经是全局联系人字段，适合被一次 batch 里的所有零件共用。

当客户有多个零件时，一条一条上传、分析、选材料、报价，会明显增加操作成本。这个需求要解决的是“多零件报价工作流”，不只是 file input 支持多选。

## 2. 产品目标

1. 用户可以一次选择多个 `.stp/.step` 文件。
2. 页面生成一个零件列表，每个零件有独立状态。
3. 用户可以切换当前聚焦零件，右侧 preview 和 estimate 跟着切换。
4. 材料、工艺、公差、后处理、数量、货币支持 batch default。
5. 每个零件第一次聚焦时自动继承 batch default。
6. 单个零件可以 override 自己的材料、后处理、数量等参数。
7. 昵称和邮箱只填一次，整批文件共用。
8. 已计算过的零件保留缓存。参数没变时切回零件不重新计算。
9. 后端报价记录可以识别同一次 batch 里的多个零件。
10. 第一版尽量复用现有 `/upload` 和 `/calculate`，降低后端风险。

## 3. 非目标

第一版不做：

1. 不做 ZIP 上传。
2. 不做真正的后端 batch upload API。
3. 不做后台管理端 batch quote 页面。
4. 不做整批正式报价自动邮件发送。
5. 不做多文件同时 3D 渲染。
6. 不做复杂表格编辑器。
7. 不改变现有报价公式。

这些可以进入 v2。

## 4. 核心概念

### 4.1 Batch

一次多文件上传形成一个 batch。batch 有：

- `batch_id`
- `created_at`
- `contact`
- `defaults`
- `parts`

`batch_id` 前端生成即可，例如：

```js
const batchId = crypto.randomUUID();
```

如果浏览器不支持 `crypto.randomUUID()`，用 fallback：

```js
const batchId = `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
```

### 4.2 Part

每个 STEP 文件是一条 part。part 有自己的：

- 文件信息
- 上传/分析状态
- preview
- settings
- estimate
- cache key
- error

### 4.3 Batch Defaults

用户在 Product Details 中填的默认参数：

- material_category
- material_id
- process
- tolerance_grade
- postprocess_group
- quantity
- currency

这些默认值会应用到新上传的 part。

### 4.4 Per-Part Override

如果用户聚焦某个零件后修改材料、后处理、数量等，该 part 的 settings 从 `inherited` 变为 `override`。

界面上建议显示：

```text
Using batch defaults
```

或：

```text
Custom settings for this part
```

### 4.5 Estimate Cache

缓存 key 应该包含文件与报价参数：

```text
file_key + material_id + process + tolerance_grade + postprocess_group + quantity + currency
```

如果 key 没变，直接显示缓存结果。  
如果 key 变化，该 part 标记为 `needs_recalculate`。

## 5. 推荐体验

### 5.1 页面布局

保持当前左右布局，但左侧从单表单升级成“批量工作台”。

左侧：

1. Batch Upload
2. Batch Defaults
3. Part List
4. Contact Details
5. Actions

右侧：

1. 当前聚焦 part 的 preview
2. 当前聚焦 part 的 estimate
3. Batch summary，小型状态摘要

### 5.2 Part List

建议做成紧凑列表，不做大卡片。每行显示：

```text
1  bracket.step      Ready
2  shaft.step        Estimated · USD 18.40
3  housing.step      Needs recalculation
4  cover.step        Upload failed
```

状态建议：

- `Pending`
- `Analyzing`
- `Ready`
- `Needs settings`
- `Estimated`
- `Needs recalculation`
- `Failed`

当前聚焦 part 用明显选中态。这里可以用一条左侧蓝色 rail 和浅背景，不要做成过重 card。

### 5.3 聚焦操作

支持：

- 点击 part row。
- Previous / Next 按钮。
- 未来可考虑键盘方向键。

聚焦后：

- 表单显示该 part 的 settings。
- preview 显示该 part 的 PNG/3D。
- estimate 显示该 part 的缓存报价或空状态。

### 5.4 Defaults 与 Override

用户上传后，默认流程：

1. 用户选择多个 STEP。
2. 系统逐个分析文件。
3. 每个 part 自动继承当前 batch defaults。
4. 用户可以直接 `Calculate Current Part`。
5. 如果某个 part 需要不同材料，聚焦后修改 settings，此 part 变为 override。

建议增加两个轻量操作：

- `Apply Current Settings to All`
- `Reset Current Part to Batch Defaults`

第一版可以先只做 `Reset Current Part to Batch Defaults`，`Apply to All` 放 Phase 2。

### 5.5 联系人信息

`How should we address you?` 和 `Email Address` 保持全局共享。  
不需要每个 part 单独填写。

所有 calculate payload 都带：

```js
customer_name
customer_email
batch_id
batch_item_id
batch_item_index
batch_item_count
```

这样数据库能把多个零件关联成同一次询价。

## 6. 前端状态设计

### 6.1 新 state 结构

替换当前单文件 state：

```js
const state = {
    batchId: "",
    activePartId: "",
    options: null,
    materialSearch: "",
    defaults: {
        material_category: "",
        material_id: "",
        process: "CNC",
        tolerance_grade: "ISO2768-M",
        postprocess_group: "bead_blasting",
        quantity: 100,
        currency: "USD",
    },
    contact: {
        customer_name: "",
        customer_email: "",
    },
    parts: [],
};
```

### 6.2 Part 结构

```js
{
    id: "part-...",
    index: 0,
    file: File,
    fileName: "bracket.step",
    fileKey: "bracket.step:123456:1780000000000",
    status: "pending",
    uploadStatus: "pending",
    estimateStatus: "empty",
    analysis: null,
    estimate: null,
    settings: {
        material_category: "",
        material_id: "",
        process: "",
        tolerance_grade: "",
        postprocess_group: "",
        quantity: 100,
        currency: "USD",
        source: "inherited"
    },
    estimateCacheKey: "",
    error: "",
}
```

### 6.3 文件 key

```js
function makeFileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
}
```

如果用户重复选择同一个文件：

- 同一个 batch 内建议去重。
- 如果确实需要同文件重复报价，后续再支持 duplicate。

第一版策略：同 batch 内同 `fileKey` 跳过，并提示：

```text
Duplicate file skipped: bracket.step
```

## 7. HTML 修改指导

### 7.1 file input 支持多选

当前：

```html
<input name="file" type="file" accept=".stp,.step">
```

改为：

```html
<input name="file" type="file" accept=".stp,.step" multiple>
```

上传区域文案改为：

```text
Choose STEP files
.stp / .step · multiple files supported · max 50 MB each
```

### 7.2 增加 Part List 容器

在 Batch Defaults 和 Contact Details 之间增加：

```html
<section class="quote-batch-parts" data-batch-parts>
    <div class="quote-batch-head">
        <h3>Parts</h3>
        <span data-batch-count>0 files</span>
    </div>
    <div class="quote-part-list" data-part-list></div>
</section>
```

### 7.3 增加 action buttons

建议按钮区：

```html
<div class="quote-action-row">
    <button class="tool-button" type="button" data-calculate-current>Calculate Current Part</button>
    <button class="tool-button secondary" type="button" data-calculate-all>Calculate All Ready Parts</button>
</div>
```

第一阶段如果不做 calculate all，可以先 disabled：

```html
<button class="tool-button secondary" type="button" data-calculate-all disabled>Calculate All Ready Parts</button>
```

或者完全不显示，放 Phase 2。

## 8. JS 实现指导

### 8.1 替换 file change 逻辑

当前逻辑只取：

```js
const file = fileInput.files[0];
```

改为：

```js
fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    addFilesToBatch(files);
});
```

### 8.2 addFilesToBatch

```js
function addFilesToBatch(files) {
    if (!state.batchId) state.batchId = createBatchId();

    const existing = new Set(state.parts.map(p => p.fileKey));
    const validFiles = files.filter(file => {
        const ext = file.name.toLowerCase().split(".").pop();
        return ext === "stp" || ext === "step";
    });

    validFiles.forEach(file => {
        const fileKey = makeFileKey(file);
        if (existing.has(fileKey)) return;

        const part = createPartFromFile(file, state.parts.length);
        state.parts.push(part);
        existing.add(fileKey);
    });

    if (!state.activePartId && state.parts.length) {
        state.activePartId = state.parts[0].id;
    }

    render();
    analyzePendingParts();
}
```

### 8.3 createPartFromFile

```js
function createPartFromFile(file, index) {
    return {
        id: createPartId(),
        index,
        file,
        fileName: file.name,
        fileKey: makeFileKey(file),
        status: "pending",
        uploadStatus: "pending",
        estimateStatus: "empty",
        analysis: null,
        estimate: null,
        settings: cloneDefaults(),
        estimateCacheKey: "",
        error: "",
    };
}
```

### 8.4 analyzePendingParts

不建议同时分析很多 STEP。OpenCascade 分析是重操作，浏览器也会等待多个请求。

第一版建议并发数为 1：

```js
async function analyzePendingParts() {
    for (const part of state.parts) {
        if (part.uploadStatus !== "pending") continue;
        part.uploadStatus = "analyzing";
        part.status = "analyzing";
        renderPartList();
        try {
            part.analysis = await uploadStep(part.file);
            part.uploadStatus = "ready";
            part.status = "ready";
        } catch (error) {
            part.uploadStatus = "failed";
            part.status = "failed";
            part.error = error.message;
        }
        render();
    }
}
```

后续可改成并发 2，但第一版不要超过 2。

### 8.5 当前聚焦 part

```js
function getActivePart() {
    return state.parts.find(p => p.id === state.activePartId) || null;
}
```

所有 preview、estimate、calculate 都基于 active part。

### 8.6 表单与 active part 同步

当用户切换 active part：

```js
function setActivePart(partId) {
    syncCurrentFormToActivePart();
    state.activePartId = partId;
    hydrateFormFromActivePart();
    render();
}
```

`syncCurrentFormToActivePart()` 把当前表单值写进旧 active part。  
`hydrateFormFromActivePart()` 把新 active part 的 settings 写回表单。

注意：联系人字段不写进 part，联系人字段写进 `state.contact`。

### 8.7 设置变更与 dirty

材料、工艺、公差、后处理、数量、货币任一变化后：

```js
function markActivePartDirty() {
    const part = getActivePart();
    if (!part) return;

    part.settings = readSettingsFromForm();
    part.settings.source = "override";

    const nextKey = makeEstimateCacheKey(part);
    if (part.estimate && part.estimateCacheKey !== nextKey) {
        part.estimateStatus = "needs_recalculate";
        part.status = "needs_recalculate";
    }
    renderPartList();
}
```

### 8.8 计算当前零件

```js
async function calculateCurrentPart() {
    const part = getActivePart();
    if (!part) throw new Error("Choose a STEP file first.");
    if (part.uploadStatus !== "ready") throw new Error("This part is not ready yet.");

    syncCurrentFormToActivePart();
    const cacheKey = makeEstimateCacheKey(part);
    if (part.estimate && part.estimateCacheKey === cacheKey) {
        part.estimateStatus = "cached";
        render();
        return;
    }

    part.estimateStatus = "calculating";
    part.status = "calculating";
    render();

    try {
        const estimate = await calculateEstimateForPart(part);
        part.estimate = estimate;
        part.estimateCacheKey = cacheKey;
        part.estimateStatus = "estimated";
        part.status = "estimated";
    } catch (error) {
        part.estimateStatus = "failed";
        part.status = "failed";
        part.error = error.message;
    }
    render();
}
```

### 8.9 calculateEstimateForPart

复用当前 `/api/public/quote/calculate`：

```js
async function calculateEstimateForPart(part) {
    const settings = part.settings;
    const contact = readContactFromForm();

    const payload = {
        batch_id: state.batchId,
        batch_item_id: part.id,
        batch_item_index: part.index + 1,
        batch_item_count: state.parts.length,
        file_id: part.analysis.file_id,
        part_name: part.analysis.name,
        stp_filename: part.fileName,
        volume_mm3: part.analysis.volume_mm3,
        obb_dimensions_mm: part.analysis.obb_dimensions_mm,
        material_category: settings.material_category,
        material_id: settings.material_id,
        process: settings.process,
        postprocess_group: settings.postprocess_group,
        tolerance_grade: settings.tolerance_grade,
        quantity: Number(settings.quantity),
        currency: settings.currency,
        customer_name: contact.customer_name,
        customer_email: contact.customer_email,
    };

    return window.DaiyujinAPI.request("/api/public/quote/calculate", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}
```

### 8.10 Calculate All Ready Parts

Phase 2 实现。规则：

1. 只计算 `uploadStatus === "ready"` 的 part。
2. 跳过 cache key 未变且已有 estimate 的 part。
3. 失败不终止整批，只标记该 part failed。
4. 并发数建议 1。

```js
async function calculateAllReadyParts() {
    for (const part of state.parts) {
        if (part.uploadStatus !== "ready") continue;
        state.activePartId = part.id;
        hydrateFormFromActivePart();
        await calculateCurrentPart();
    }
}
```

## 9. 后端实现指导

### 9.1 Phase 1 不新增 batch upload API

保持：

- `POST /api/public/quote/upload`
- `POST /api/public/quote/calculate`

前端循环调用即可。

理由：

- 当前 STEP 分析、缩略图、水印、3D STL 都已经围绕单文件稳定工作。
- 批量上传如果放到后端一次处理，会立刻引入队列、超时、部分失败、并发控制。
- 第一版用前端队列更容易验收和回滚。

### 9.2 calculate payload 增加 batch 字段

后端 `calculate_quote_v2(payload)` 不需要参与 batch 计算，但应保留这些字段：

```json
{
  "batch_id": "...",
  "batch_item_id": "...",
  "batch_item_index": 1,
  "batch_item_count": 8
}
```

### 9.3 数据库字段建议

当前 `inquiries` 已有：

- `customer_name`
- `customer_email`
- `stp_filename`
- `input_params`
- `result`

建议新增可查询字段：

```python
batch_id: Mapped[str | None] = mapped_column(String(80))
batch_item_id: Mapped[str | None] = mapped_column(String(80))
batch_item_index: Mapped[int | None] = mapped_column(Integer)
batch_item_count: Mapped[int | None] = mapped_column(Integer)
```

同时在 `backend/database.py` 的 additive SQLite migration 中补列：

```python
if "batch_id" not in columns:
    statements.append("ALTER TABLE inquiries ADD COLUMN batch_id VARCHAR(80)")
if "batch_item_id" not in columns:
    statements.append("ALTER TABLE inquiries ADD COLUMN batch_item_id VARCHAR(80)")
if "batch_item_index" not in columns:
    statements.append("ALTER TABLE inquiries ADD COLUMN batch_item_index INTEGER")
if "batch_item_count" not in columns:
    statements.append("ALTER TABLE inquiries ADD COLUMN batch_item_count INTEGER")
```

### 9.4 pricing._record_inquiry

在 `_record_inquiry()` 中写入：

```python
batch_id=(payload.get("batch_id") or "").strip() or None,
batch_item_id=(payload.get("batch_item_id") or "").strip() or None,
batch_item_index=payload.get("batch_item_index"),
batch_item_count=payload.get("batch_item_count"),
```

`input_params` 里也保留：

```python
"batch": {
    "batch_id": payload.get("batch_id"),
    "batch_item_id": payload.get("batch_item_id"),
    "batch_item_index": payload.get("batch_item_index"),
    "batch_item_count": payload.get("batch_item_count"),
}
```

这样以后即使数据库字段变更，raw snapshot 也能复盘。

## 10. 数据库记录语义

每个 part 计算一次，就写一条 `inquiries`。

同一个 batch 的多条记录通过 `batch_id` 关联。

示例：

| id | type | batch_id | batch_item_index | stp_filename | customer_email | total_display |
|---|---|---|---:|---|---|---|
| 201 | quote | batch-abc | 1 | bracket.step | user@example.com | USD 12.30 |
| 202 | quote | batch-abc | 2 | shaft.step | user@example.com | USD 18.40 |
| 203 | quote | batch-abc | 3 | cover.step | user@example.com | USD 9.80 |

后续后台销售视图可以按 `batch_id` 聚合。

## 11. 前端 UI 设计指导

### 11.1 视觉方向

Batch quote 是工作台，不是营销页。应保持：

- 信息密度更高。
- 状态清晰。
- 列表可扫描。
- 当前聚焦明确。
- 不使用大卡片堆叠。

### 11.2 Part row 设计

每个 row 固定高度，避免状态变化导致跳动：

```text
[index] [filename] [status badge] [total if estimated]
```

状态 badge 色彩：

- Pending: gray
- Analyzing: blue
- Ready: neutral
- Estimated: green
- Needs recalculation: amber
- Failed: red

### 11.3 Batch summary

右侧 estimate 卡或 part list 顶部显示：

```text
8 files · 5 estimated · 1 failed · 2 pending
```

不要在第一版做复杂图表。

### 11.4 当前聚焦反馈

Part row active：

- 左侧蓝色 rail。
- 浅蓝背景。
- 文件名加粗。

这与 Material picker 的 active 逻辑保持一致。

## 12. 3D / PNG 预览策略

当前 previewCard 只读取 `state.analysis`。升级后应读取：

```js
const part = getActivePart();
const analysis = part?.analysis;
```

3D View 也只加载当前 part。

切换 part 时：

1. 清理当前 3D viewer。
2. 静态 PNG 立即显示。
3. 用户点击 3D View 后再懒加载 STL。

不要一次加载所有零件的 STL。

## 13. Progress 设计

当前 progress 是单次计算动效。Batch 后建议分两层：

### 13.1 Global batch progress

用于 upload/analyze all：

```text
Analyzing 3 / 8 files
```

### 13.2 Current part progress

用于当前 part calculate：

```text
Manufacturing review
Cost assessment
Generating estimate
```

第一版可以复用当前 progress，只是在文案中加入当前文件名：

```text
Analyzing shaft.step
```

## 14. 错误处理

### 14.1 单文件上传失败

不要终止整个 batch。该 part 标记：

```text
Upload failed
```

row 内提供：

- Retry
- Remove

第一版可只做 Remove，Retry 放 Phase 2。

### 14.2 单文件计算失败

该 part 标记：

```text
Estimate failed
```

其他 part 不受影响。

### 14.3 文件数量限制

建议第一版限制：

- 最多 20 个文件。
- 单文件最大沿用 50 MB。

超过时提示：

```text
Upload up to 20 STEP files at a time. For larger RFQs, contact our engineers.
```

## 15. 阶段计划

### Phase B0: 数据结构与 UI 骨架

目标：

- file input 支持 `multiple`。
- 建立 `state.parts` 和 `activePartId`。
- 增加 Part List UI。
- 切换 part 时右侧显示对应 preview 空状态。

验收：

- 选择多个文件后列表出现。
- 可以点击切换 active part。
- 不计算、不上传也能看见列表状态。

### Phase B1: 多文件逐个上传分析

目标：

- 前端逐个调用 `/api/public/quote/upload`。
- 每个 part 保存 `analysis`。
- 当前 active part 显示 PNG preview。
- 上传失败只影响单个 part。

验收：

- 3 个 STEP 文件能依次分析。
- 每个 part 切换后 preview 正确。
- 失败文件不阻塞其他文件。

### Phase B2: Batch Defaults 与单件 settings

目标：

- Batch defaults 初始化。
- part 第一次创建时继承 defaults。
- 切换 part 时表单同步。
- 修改当前表单只影响当前 part。

验收：

- part A 改材料后，part B 不跟着变。
- 新上传文件继承当前 defaults。
- 当前 part 显示 `Using batch defaults` 或 `Custom settings`。

### Phase B3: 当前零件计算与缓存

目标：

- `Calculate Current Part` 使用 active part。
- payload 带 batch 字段和 contact。
- 计算结果写入 part.estimate。
- cache key 未变时不重复请求。
- 参数变更后标记 `Needs recalculation`。

验收：

- 同一个 part 第一次计算请求 API。
- 切换回来直接显示缓存。
- 改数量后显示 needs recalculation。
- 再计算后缓存刷新。

### Phase B4: 数据库 batch 字段

目标：

- `Inquiry` 增加 batch fields。
- `database.py` 增加 additive migration。
- `_record_inquiry()` 写入 batch_id 和 item index。

验收：

- 每个 part 报价后 `inquiries` 有独立记录。
- 同一次上传的记录 `batch_id` 相同。
- `customer_name/customer_email` 正确写入每条记录。

### Phase B5: Calculate All Ready Parts

目标：

- 增加 `Calculate All Ready Parts`。
- 顺序计算所有 ready parts。
- 跳过已有有效缓存的 part。
- 部分失败不中断全局。

验收：

- 5 个 ready parts 可连续计算。
- 一个失败不会影响其他成功。
- batch summary 显示成功/失败/跳过数量。

### Phase B6: WordPress 同步与打包

目标：

- 同步 `quote.html` 到 `daiyujin-tools/templates/quote.php`。
- 同步 `js/quote.js` 到 `daiyujin-tools/assets/js/quote.js`。
- 同步 CSS 到 `daiyujin-tools/assets/css/plugins.css`。
- bump plugin version。
- 重新打包 zip。

验收：

- 静态站和 WordPress 插件体验一致。
- Cloudflare/浏览器缓存清理后加载新资源。

## 16. 文件修改清单

静态站：

- `quote.html`
- `js/quote.js`
- `css/plugins.css`

后端：

- `backend/models.py`
- `backend/database.py`
- `backend/services/pricing.py`
- `backend/services/quote_calculator_v2.py`，仅在需要把 batch 字段回传 public response 时改。

WordPress：

- `daiyujin-tools/templates/quote.php`
- `daiyujin-tools/assets/js/quote.js`
- `daiyujin-tools/assets/css/plugins.css`
- `daiyujin-tools/daiyujin-tools.php`

测试：

- `backend/scripts/test_quote_batch.py`

## 17. CSS 指导

新增类名建议：

```css
.quote-batch-parts {}
.quote-batch-head {}
.quote-part-list {}
.quote-part-row {}
.quote-part-row.active {}
.quote-part-index {}
.quote-part-name {}
.quote-part-status {}
.quote-part-total {}
.quote-action-row {}
.quote-batch-summary {}
```

设计原则：

- Part list 是列表，不是 card grid。
- row 高度固定。
- status badge 尺寸固定。
- 长文件名省略号。
- active 反馈明显但克制。

示例：

```css
.quote-part-row {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    align-items: center;
    gap: .55rem;
    min-height: 38px;
    padding: .45rem .55rem;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
}

.quote-part-row.active {
    background: #eef6ff;
    border-color: rgba(0, 102, 204, .28);
    box-shadow: inset 3px 0 0 #0066cc;
}

.quote-part-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
```

## 18. 后端验证脚本建议

新增 `backend/scripts/test_quote_batch.py`：

```python
import sqlite3
import sys

sys.path.insert(0, "backend")
from app import create_app

app = create_app()
client = app.test_client()

payload = {
    "batch_id": "test-batch-001",
    "batch_item_id": "part-001",
    "batch_item_index": 1,
    "batch_item_count": 2,
    "file_id": "test-file",
    "part_name": "test-part",
    "stp_filename": "test-part.step",
    "volume_mm3": 15000,
    "obb_dimensions_mm": "50x30x10",
    "material_category": "aluminum_alloy",
    "material_id": "mp_a0077",
    "process": "CNC",
    "postprocess_group": "bead_blasting",
    "tolerance_grade": "ISO2768-M",
    "quantity": 10,
    "currency": "USD",
    "customer_name": "Batch Test",
    "customer_email": "batch-test@example.com",
}

resp = client.post("/api/public/quote/calculate", json=payload)
assert resp.status_code == 200
data = resp.get_json()
assert data["error"] is False
assert "total_estimate" in data

con = sqlite3.connect("backend/data/daiyujin.db")
row = con.execute(
    "SELECT batch_id, batch_item_id, customer_name, customer_email FROM inquiries WHERE stp_filename=? ORDER BY id DESC LIMIT 1",
    ("test-part.step",),
).fetchone()
assert row == ("test-batch-001", "part-001", "Batch Test", "batch-test@example.com")
con.execute("DELETE FROM inquiries WHERE stp_filename=?", ("test-part.step",))
con.commit()
con.close()
print("batch quote DB smoke passed")
```

## 19. 验收清单

### 19.1 基础上传

1. 一次选择 3 个 STEP 文件，列表出现 3 条 part。
2. 文件名、序号、状态正确。
3. 非 STEP 文件被拒绝或跳过。
4. 重复文件被跳过并提示。

### 19.2 分析与预览

1. 每个 STEP 依次上传分析。
2. 当前 active part 显示正确 PNG。
3. 切换 part 后 PNG 跟着变化。
4. 3D View 只加载当前 part。

### 19.3 参数继承

1. 新 part 继承 batch defaults。
2. 单个 part 修改材料后，其他 part 不变。
3. 切换 part 时表单正确回显。
4. 联系人字段不随 part 切换清空。

### 19.4 报价与缓存

1. 当前 part 可计算。
2. 计算完成后 part row 显示 estimate 状态和 total。
3. 切换回已计算 part 不重新请求 API。
4. 修改数量后状态变成 `Needs recalculation`。
5. 重新计算后缓存刷新。

### 19.5 数据库

1. 每个计算过的 part 对应 `inquiries` 一条记录。
2. 同 batch 的记录 `batch_id` 一致。
3. `batch_item_index` 正确。
4. `customer_name` 和 `customer_email` 正确写入。
5. `total_display` 等于用户看到的 `total_estimate.display`。

### 19.6 WordPress

1. 插件页可多文件上传。
2. 插件页 part list、preview、estimate 与静态页一致。
3. mailto 仍指向 `great@mfg-solution.com`。

## 20. 风险与处理

### 20.1 分析耗时过长

风险：多个 STEP 依次分析会让用户等待。  
处理：显示 batch progress，并允许先查看已分析完成的 part。

### 20.2 浏览器内存压力

风险：多个大文件对象保留在 state 中。  
处理：限制 20 个文件，单文件 50 MB；计算完成后可只保留必要引用，后续再优化。

### 20.3 OpenCascade 并发压力

风险：同时多个 upload 会拖垮本机 API。  
处理：Phase 1 并发数固定为 1。

### 20.4 用户误以为整批已报价

风险：只计算了当前 part，但用户以为全部完成。  
处理：按钮文案必须写 `Current Part`，batch summary 明确显示 `x / y estimated`。

### 20.5 数据库污染

风险：测试记录进入真实 `daiyujin.db`。  
处理：测试脚本用明确 `batch-test` 标记并在 finally 删除。

## 21. 推荐推进顺序

1. Phase B0，先让多文件列表跑起来。
2. Phase B1，做逐个上传分析。
3. Phase B2，做 defaults 和 per-part settings。
4. Phase B3，做 current part calculate 和缓存。
5. Phase B4，补数据库 batch 字段。
6. Phase B5，再做 calculate all。
7. Phase B6，同步 WordPress 插件和 zip。

不要一开始就做后端 batch API。先把前端工作台和数据状态跑顺，再考虑后端聚合接口。

## 22. 最终完成定义

Batch Instant Quote v1 完成后，用户应该能够：

1. 一次上传多个 STEP 文件。
2. 在 part list 中清楚看到每个零件状态。
3. 点击任意零件查看对应 preview 和 estimate。
4. 使用整批默认参数快速报价。
5. 对某个零件单独修改材料、工艺、数量。
6. 昵称和邮箱只填一次。
7. 已计算零件切换回来直接显示缓存结果。
8. 数据库里能按 `batch_id` 找到同一次上传的所有报价记录。
