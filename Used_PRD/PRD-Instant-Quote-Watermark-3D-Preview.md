# PRD: Instant Quote STEP 预览水印与 3D View 集成

Status: Draft for implementation  
Owner: Daiyujin Web / Instant Quote  
Date: 2026-06-27  
Scope: `backend/app.py`, `backend/services/step_analyzer.py`, `backend/scripts/test_watermark.py`, `test3d.html`, `quote.html`, `js/quote.js`, `css/plugins.css`, WordPress plugin quote template and assets

## 1. 背景

当前 Instant Quote 已经完成点估价、公差因子、邮箱字段和黑盒报价展示。剩余两块体验增强还没有稳定落地：

1. STEP 静态 PNG 预览水印。
2. 3D viewer 从测试页迁入 Instant Quote 页面。

目前水印已从右下角单点样式改为 45 度满屏平铺，但改完后水印不显示。`test3d.html` 已经验证了后端 STEP 上传、STL 导出、Three.js 加载和基础交互都能跑通，UI 方向也比较满意，但模型展示还不够清晰、稳定、工程化。

本 PRD 的目标是把这两件事做成可发布的产品能力：

1. 静态 PNG 预览始终带 45 度满屏水印。
2. Instant Quote 右侧同时提供 Static PNG 与 3D View。
3. 3D View 不影响报价主流程，不拖慢首次页面加载。
4. WordPress 插件后续可同步同一套能力。

## 2. 当前实现判断

### 2.1 已存在的能力

当前后端已经具备基础链路：

1. `POST /api/public/quote/upload` 保存 STEP 文件。
2. `backend/services/step_analyzer.py` 使用 OCC 解析 STEP，生成 `backend/static/thumbnails/<file_id>.png`。
3. `backend/app.py` 中已有 `_apply_preview_watermark(png_path)`。
4. `GET /api/public/quote/model/<file_id>` 将已上传 STEP 导出为 STL，并返回给前端。
5. `test3d.html` 使用 Three.js `STLLoader` 加载该 STL。

这说明本轮不需要重建 STEP 解析架构，只需要修水印绘制方法，并把测试页 viewer 模块化。

### 2.2 水印不显示的主要原因

当前 `_apply_preview_watermark()` 的思路是：

1. 在与原图同尺寸的透明 overlay 上平铺水平文字。
2. 将整个 overlay 旋转 45 度。
3. 裁剪回原图尺寸。
4. alpha composite 到原图。

这个方法容易失败：

1. 同尺寸 overlay 旋转后，大量文字会被旋转到裁剪区外。
2. 旋转再裁剪会让文字分布变得不可控，某些图片区域可能没有任何文字。
3. 当前水印颜色是白色，缩略图背景又是浅灰，透明度约 12% 时肉眼几乎不可见。
4. 函数捕获所有异常并直接返回 `False`，没有日志，调试时很难知道是字体、绘制、保存还是裁剪问题。
5. 当前测试脚本只检查右下角区域，不适合验证“斜 45 度满屏平铺”。

### 2.3 3D 测试页的主要问题

`test3d.html` 当前方向是好的，但要嵌入报价页，还需要解决：

1. 作为独立页面运行，尚未拆成可复用模块。
2. 使用 unpkg importmap，生产环境和 WordPress 环境可能受 CDN、CSP、网络波动影响。
3. 相机距离计算中 `dist * 2.8` 会让模型只占约三分之一视口，在报价页小卡片里会显得“看不清”。
4. 固定 ground position `y = -5.5` 对不同尺寸零件不稳定，可能离模型太远或穿模。
5. STL 没有材质信息，单一金属灰如果没有边线或轮廓增强，小孔、槽、倒角会不明显。
6. 在 tab 隐藏状态初始化 Three.js 时，容器尺寸可能是 0，需要切到 3D tab 后重新 `resize()` 和 `fitCamera()`。
7. 3D viewer 不应重新上传文件，应复用 quote upload 返回的 `file_id`。

## 3. 产品目标

### 3.1 水印目标

水印效果固定为：

1. 45 度斜向。
2. 满屏平铺。
3. 透明度约 12%。
4. 间距约为 3 倍文字宽度。
5. 不遮挡主要几何识别。
6. 对浅灰背景可见，但不能廉价、突兀。
7. 只加在静态 PNG 预览上，不修改客户上传的原始 STEP 文件。

### 3.2 3D View 目标

Instant Quote 上传 STEP 后，右侧 Part 模块应该包含两个预览方式：

```text
Part Preview
[ Static PNG ] [ 3D View ]

Static PNG: watermarked server-generated thumbnail
3D View: interactive STL preview generated from the same uploaded STEP
```

体验原则：

1. Static PNG 默认显示，保证首屏稳定。
2. 3D View 用户点击后再加载，避免拖慢页面。
3. 如果 3D 加载失败，PNG 仍然可用。
4. 3D View 是辅助确认几何的工程预览，不承诺替代正式 DFM 审查。
5. 3D viewer 不展示内部报价参数。

## 4. 非目标

本轮不做：

1. 浏览器直接解析 STEP。
2. 修改原始 STEP 文件。
3. 让客户下载带水印 STEP。
4. 在 3D 模型表面烘焙水印。
5. 完整 DFM 标注、尺寸标注、孔识别、倒角识别。
6. 多零件装配树。
7. 客户账户内的历史 3D 模型管理。
8. WebGL 不可用时的复杂降级，只降级到 PNG。

## 5. 水印技术方案

### 5.1 推荐实现方式

不要再旋转整张 overlay。推荐改为“单个文字 tile 先旋转，再平铺 paste”：

1. 打开 PNG，转为 `RGBA`。
2. 根据图像宽度计算字体大小。
3. 生成一个透明文字 tile。
4. 在 tile 上绘制水印文字。
5. 将 tile 旋转 45 度，`expand=True`。
6. 在整张 overlay 上按固定间距重复 paste 旋转后的 tile。
7. 将 overlay alpha composite 到原图。
8. 转为 RGB 保存。

这样每一个水印文本都是独立旋转的，不会因为整张图旋转裁剪导致文字丢失。

### 5.2 参数建议

```python
WATERMARK_TEXT = os.environ.get("QUOTE_PREVIEW_WATERMARK", "GCNOV CO., LIMITED")
WATERMARK_ANGLE = 45
WATERMARK_OPACITY = 0.12
WATERMARK_SPACING_MULTIPLIER = 3.0
```

字体大小：

```python
font_size = max(28, int(min(width, height) * 0.045))
```

透明度：

```python
alpha = int(255 * WATERMARK_OPACITY)  # 0.12 -> 30
```

颜色：

由于当前 OCC 缩略图背景是浅灰，建议第一版使用深灰蓝，而不是白色：

```python
fill = (24, 36, 52, alpha)
```

如果后续支持深色预览背景，可以根据图片平均亮度动态选择：

```python
fill = dark_text if average_luminance > 150 else light_text
```

间距：

```python
spacing = max(int(text_width * 3.0), rotated_tile_width + font_size)
```

解释：

1. 用户要求间距约 3 倍字宽。
2. 同时要保证小图上不会出现只有一两个水印。
3. 如果 `text_width * 3` 小于旋转后 tile 宽度，需要至少留出 tile 宽度，避免重叠严重。

### 5.3 伪代码

```python
def _apply_preview_watermark(png_path: Path) -> bool:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.open(png_path).convert("RGBA")
    w, h = img.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    text = os.environ.get("QUOTE_PREVIEW_WATERMARK", "GCNOV CO., LIMITED")
    opacity = float(os.environ.get("QUOTE_PREVIEW_WATERMARK_OPACITY", "0.12"))
    angle = float(os.environ.get("QUOTE_PREVIEW_WATERMARK_ANGLE", "45"))
    spacing_multiplier = float(os.environ.get("QUOTE_PREVIEW_WATERMARK_SPACING", "3.0"))

    font_size = max(28, int(min(w, h) * 0.045))
    font = load_font(font_size)

    probe = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    probe_draw = ImageDraw.Draw(probe)
    bbox = probe_draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    pad = int(font_size * 0.65)
    tile = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    tile_draw = ImageDraw.Draw(tile)
    tile_draw.text((pad, pad), text, font=font, fill=(24, 36, 52, int(255 * opacity)))

    rotated = tile.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    step = max(int(tw * spacing_multiplier), rotated.size[0] + font_size)

    for y in range(-rotated.size[1], h + rotated.size[1], step):
        row_offset = 0 if (y // step) % 2 == 0 else step // 2
        for x in range(-rotated.size[0] - row_offset, w + rotated.size[0], step):
            overlay.alpha_composite(rotated, (x + row_offset, y))

    out = Image.alpha_composite(img, overlay).convert("RGB")
    out.save(png_path, "PNG", optimize=True)
    return True
```

### 5.4 日志要求

当前函数异常被吞掉。应改为：

1. `_apply_preview_watermark()` 保留 `True / False` 返回值。
2. 在 `quote_upload()` 中拿到返回值。
3. 如果返回 `False`，写入 `app.logger.warning(...)`。
4. 如果异常发生，记录异常类型和图片路径，但不要向客户暴露本地路径。

示例：

```python
ok = _apply_preview_watermark(thumb_path)
if not ok:
    app.logger.warning("Preview watermark was not applied for %s", thumb_path.name)
```

## 6. 水印验收测试

### 6.1 替换当前测试思路

当前 `backend/scripts/test_watermark.py` 检查右下角亮度，只适合旧的右下角水印。新的斜向平铺水印需要检查整图差异。

推荐新增纯单元测试：

1. 创建一张浅灰测试图。
2. 调用 `_apply_preview_watermark()`。
3. 用 `ImageChops.difference()` 比较前后差异。
4. 将图分成 3 x 3 网格，至少 5 个网格存在差异。
5. 差异像素比例在合理范围，例如 `0.2%` 到 `15%`，避免完全没画或画得太重。

### 6.2 验收标准

1. 白色或浅灰背景上肉眼可见水印。
2. 实际 STEP 缩略图上水印 45 度倾斜。
3. 水印覆盖全图主要区域，不只在角落。
4. 透明度保持约 12%，不影响识别模型。
5. 原始 STEP 文件 hash 不变。
6. 上传接口即使水印失败，也不阻断 STEP 分析和报价流程。

## 7. 3D Viewer 技术方案

### 7.1 后端链路

继续使用现有后端路线：

```text
quote upload -> file_id
file_id -> /api/public/quote/model/<file_id> -> STL
STL -> frontend Three.js viewer
```

原因：

1. STEP 解析应继续放在后端 OCC。
2. 前端只负责渲染后端导出的 STL。
3. 同一个 `file_id` 同时服务 PNG 和 STL，避免二次上传。
4. STL 可以缓存到 `backend/static/stl/<file_id>.stl`。

### 7.2 新增前端模块

新增：

```text
js/quote-3d-viewer.js
daiyujin-tools/assets/js/quote-3d-viewer.js
```

建议导出：

```js
export async function mountQuote3DViewer(container, options) {
  // options: { apiBase, fileId, partName }
}

export function disposeQuote3DViewer(container) {
}
```

`quote.js` 保持普通脚本，通过动态 import 懒加载：

```js
async function show3DPreview(fileId) {
  const mod = await import("./quote-3d-viewer.js");
  await mod.mountQuote3DViewer(container, {
    apiBase: window.DaiyujinAPI.config.baseUrl,
    fileId,
    partName: state.analysis.name,
  });
}
```

WordPress 插件中路径不同，建议通过全局配置传入模块地址：

```js
window.DAIYUJIN_QUOTE_3D_MODULE_URL
```

或者在插件模板中给容器写入：

```html
data-viewer-module-url="..."
```

### 7.3 Three.js 依赖策略

测试页当前使用：

```html
https://unpkg.com/three@0.160.0/...
```

生产建议：

1. 固定 Three.js 版本。
2. 优先自托管到 `js/vendor/three/` 或插件 `assets/vendor/three/`。
3. 如果短期继续用 CDN，也要固定版本，不能使用 `latest`。
4. WordPress 环境要确认 CSP、安全插件和缓存插件不会拦截 module import。

建议目录：

```text
js/vendor/three/three.module.js
js/vendor/three/controls/OrbitControls.js
js/vendor/three/loaders/STLLoader.js
```

### 7.4 Viewer 展示优化

`test3d.html` 的 UI 可以保留，但模型展示建议优化：

1. 相机填充比例从约三分之一改为 55% 到 70%。
2. `fitCameraToObject()` 根据 bounding box、FOV 和容器 aspect 自动计算距离。
3. ground plane 根据模型 bounding box 动态放在 `box.min.y - padding`。
4. 加一层细边线 `EdgesGeometry`，颜色深一点，透明度 25% 到 35%，帮助客户看清孔、槽、外形。
5. 添加右上角轻量尺寸信息，复用 `obb_dimensions_mm`。
6. 添加加载状态：`Preparing 3D preview...`。
7. 添加错误状态：`3D preview is unavailable. Static preview remains available.`
8. tab 切换到 3D 后调用 `viewer.resize()`。
9. 当用户重新上传文件时 dispose 旧 viewer，释放 geometry、material、renderer。

### 7.5 推荐相机参数

当前：

```js
const dist = d * 2.8;
```

建议：

```js
const fitOffset = 1.35; // quote card 里可读，仍留边距
const distance = fitOffset * maxDim / (2 * Math.tan((camera.fov * Math.PI / 180) / 2));
```

如果容器较宽，要考虑 aspect：

```js
const fov = camera.fov * Math.PI / 180;
const fitHeightDistance = maxDim / (2 * Math.tan(fov / 2));
const fitWidthDistance = fitHeightDistance / camera.aspect;
const distance = fitOffset * Math.max(fitHeightDistance, fitWidthDistance);
```

### 7.6 推荐材质与光照

材质：

```js
new THREE.MeshStandardMaterial({
  color: "#8f98a3",
  roughness: 0.42,
  metalness: 0.45
})
```

边线：

```js
const edges = new THREE.LineSegments(
  new THREE.EdgesGeometry(geometry, 35),
  new THREE.LineBasicMaterial({
    color: "#2f3945",
    transparent: true,
    opacity: 0.28
  })
);
```

光照：

1. 保留 ambient + key + fill。
2. key light 跟随模型尺寸重新设置 shadow camera。
3. 不要让模型过亮，否则边缘被吃掉。

## 8. Instant Quote 页面集成设计

### 8.1 页面结构

当前右侧 `quote-stack` 有两个 panel：

1. Part
2. Reference Estimate

建议改为：

1. Part Preview
2. Reference Estimate

Part Preview 内部结构：

```html
<section class="tool-panel quote-preview-panel">
  <div class="quote-preview-head">
    <h2>Part Preview</h2>
    <div class="quote-preview-tabs" role="tablist">
      <button type="button" data-preview-tab="png" aria-selected="true">Static PNG</button>
      <button type="button" data-preview-tab="3d" aria-selected="false">3D View</button>
    </div>
  </div>

  <div class="quote-preview-stage">
    <img class="quote-thumb" ...>
    <div class="quote-3d-stage" hidden></div>
  </div>

  <div class="metric-row">...</div>
</section>
```

注意：

1. tab 是 panel 内的控制，不要再套一个卡片。
2. preview stage 要固定宽高或 aspect-ratio，避免 PNG 和 canvas 切换时页面跳动。
3. 移动端保持同样 tabs，stage 宽度 100%。

### 8.2 默认状态

上传前：

```text
Part Preview
Waiting for STEP file
```

上传后默认：

```text
Static PNG tab active
显示带水印 PNG
```

点击 3D View：

```text
Preparing 3D preview...
加载 /api/public/quote/model/<file_id>
渲染模型
```

3D 失败：

```text
3D preview is unavailable. Static preview remains available.
```

### 8.3 交互细节

1. 用户切到 3D View 后才加载 STL。
2. 加载成功后缓存 viewer，不重复请求。
3. 用户切回 Static PNG 时暂停 render loop，减少 CPU 消耗。
4. 用户切回 3D View 时恢复 render loop 并 resize。
5. 用户重新选择文件时销毁旧 viewer，清空 STL 缓存状态。
6. `Calculate Estimate` 不依赖 3D View 成功。

## 9. CSS 指导

新增类：

```css
.quote-preview-panel
.quote-preview-head
.quote-preview-tabs
.quote-preview-stage
.quote-3d-stage
.quote-3d-status
.quote-3d-toolbar
```

核心规则：

```css
.quote-preview-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #eef0f3;
}

.quote-thumb,
.quote-3d-stage,
.quote-3d-stage canvas {
  width: 100%;
  height: 100%;
  display: block;
}
```

视觉原则：

1. 沿用当前 quote 页面风格，不把测试页 header、drop-zone、全屏状态栏搬进来。
2. 3D View 在报价页里是一个工具区域，尺寸要稳定。
3. tab 用紧凑 segmented control，别做成大按钮。
4. 右上角 view controls 可以用小按钮：Iso / Front / Top / Right。
5. 控件不要遮挡模型中心。

## 10. WordPress 插件同步

需要同步：

```text
daiyujin-tools/templates/quote.php
daiyujin-tools/assets/js/quote.js
daiyujin-tools/assets/js/quote-3d-viewer.js
daiyujin-tools/assets/css/plugins.css
daiyujin-tools/assets/vendor/three/
```

插件注意事项：

1. WordPress 中 module script 需要确认加载方式。
2. 如果不能稳定使用 importmap，避免 importmap，直接在模块中使用相对路径 import。
3. API base 继续来自现有 `DaiyujinAPI` 配置。
4. Cloudflare Tunnel 下要确认 `/api/public/quote/model/<file_id>` 能返回 `model/stl`。
5. 安全插件可能拦截 `.stl` 或 `model/stl`，需要加入白名单。

## 11. 实施阶段

### Phase W1: 修复水印绘制

目标：

1. 重写 `_apply_preview_watermark()`。
2. 使用旋转 tile 平铺。
3. 参数化文字、角度、透明度、间距。
4. 添加日志。

验收：

1. 上传 STEP 后 PNG 肉眼可见 45 度满屏水印。
2. 透明度约 12%。
3. 间距约 3 倍字宽。
4. 不遮挡模型识别。
5. 原始 STEP 文件不变。

### Phase W2: 更新水印测试

目标：

1. 改造 `backend/scripts/test_watermark.py`。
2. 从右下角亮度检查改为全图差异检查。
3. 加入 3 x 3 网格覆盖检查。

验收：

1. 测试能在没有真实 STEP 文件时用合成图片验证水印函数。
2. 至少 5 个网格检测到像素变化。
3. 差异比例在合理范围。

### Phase V1: 拆出 3D viewer 模块

目标：

1. 从 `test3d.html` 提炼 `quote-3d-viewer.js`。
2. 保留 OrbitControls、STLLoader、view buttons。
3. 去掉测试页专用 upload/drop-zone/header。
4. 支持 mount、resize、pause、resume、dispose。

验收：

1. `test3d.html` 可以改成调用同一 viewer 模块。
2. 模块能用 `file_id` 加载 STL。
3. 重新上传文件不会叠加多个 render loop。

### Phase V2: 集成到 quote 页面

目标：

1. `quote.html` 增加 Part Preview tab 容器。
2. `js/quote.js` 渲染 Static PNG / 3D View tabs。
3. 3D View 点击后懒加载。
4. PNG 默认展示。

验收：

1. 上传 STEP 后默认看到带水印 PNG。
2. 点击 3D View 能看到同一零件 3D 模型。
3. 切回 Static PNG 不影响报价。
4. 3D 加载失败时 PNG 和报价流程仍可用。

### Phase V3: 展示质量优化

目标：

1. 改相机 fit，让模型占 55% 到 70% 视口。
2. 动态 ground。
3. 添加 edge overlay。
4. 优化 loading、error、resize。

验收：

1. 小零件、大零件都能居中展示。
2. 模型不会太小。
3. 孔、槽、外轮廓比当前测试页更清晰。
4. 移动端不溢出。

### Phase WP: WordPress 同步

目标：

1. 插件模板和 JS 同步。
2. Three.js 依赖可稳定加载。
3. Tunnel 公网访问可用。

验收：

1. WordPress 页面上传 STEP 后显示 PNG。
2. WordPress 页面 3D View 可加载。
3. API 不因 CORS、MIME、CSP、安全插件报错。

## 12. 测试计划

### 12.1 水印测试

命令建议：

```powershell
python backend/scripts/test_watermark.py
```

测试内容：

1. 合成图水印。
2. 真实 STEP 上传后的缩略图水印。
3. 全图差异。
4. 网格覆盖。
5. 原始 STEP hash 对比。

### 12.2 3D API 测试

1. 上传 STEP，获取 `file_id`。
2. 请求 `/api/public/quote/model/<file_id>`。
3. 确认返回 `200`。
4. 确认 `Content-Type` 为 `model/stl` 或浏览器可识别的二进制响应。
5. 确认 `backend/static/stl/<file_id>.stl` 被缓存。
6. 重复请求不重复导出。

### 12.3 前端手动验收

1. 打开 `quote.html`。
2. 上传一个已知 STEP。
3. 确认 Static PNG 默认显示。
4. 确认 PNG 有 45 度满屏水印。
5. 点击 3D View。
6. 拖拽旋转、滚轮缩放。
7. 点击 Iso / Front / Top / Right。
8. 切回 Static PNG。
9. 填表并 Calculate Estimate。
10. 确认报价流程不受 3D 成败影响。

### 12.4 浏览器兼容

最低要求：

1. Chrome 最新版。
2. Edge 最新版。
3. 移动端 Chrome 或 Safari 至少能稳定显示 PNG；WebGL 不可用时降级即可。

## 13. 风险与缓解

| Risk | Impact | Mitigation |
|---|---|---|
| 水印过浅 | 客户看不见，安全感不足 | 用深灰蓝 12% alpha，并做合成图测试 |
| 水印过重 | 遮挡零件 | 差异比例上限测试，透明度环境变量可调 |
| 整张 overlay 旋转裁剪 | 水印丢失 | 改为旋转 tile 后平铺 |
| Three.js CDN 失败 | 3D View 不可用 | 自托管 vendor 文件，PNG 作为默认 fallback |
| STL 文件过大 | 加载慢 | 懒加载，后续可在 OCC 导出时控制 mesh 精度 |
| WordPress 拦截 STL | 3D View 报错 | 白名单 API 路由和 MIME |
| 隐藏 tab 初始化尺寸为 0 | canvas 空白 | tab 激活后再 mount 或强制 resize |
| 多次上传内存泄漏 | 页面卡顿 | dispose renderer、geometry、material、controls |

## 14. 参考资料

1. MDN Canvas rotate  
   <https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/rotate>
2. MDN Canvas globalAlpha  
   <https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalAlpha>
3. Three.js OrbitControls  
   <https://threejs.org/docs/#examples/en/controls/OrbitControls>
4. Three.js STLLoader  
   <https://threejs.org/docs/#examples/en/loaders/STLLoader>
5. Three.js WebGLRenderer  
   <https://threejs.org/docs/#api/en/renderers/WebGLRenderer>

## 15. 推荐开工顺序

第一步先做 `Phase W1 + W2`。水印是独立能力，风险小，能最快把当前“不显示”的问题闭环。

第二步做 `Phase V1`，把 `test3d.html` 的代码拆成模块。拆模块之前不建议直接塞进 `quote.js`，否则报价页脚本会膨胀，后续 WordPress 同步也难维护。

第三步做 `Phase V2 + V3`，把 PNG 与 3D View 作为同一个 Part Preview 模块的两个 tab。

第四步做 WordPress 同步。等静态页稳定后再同步插件，可以减少线上调试成本。
