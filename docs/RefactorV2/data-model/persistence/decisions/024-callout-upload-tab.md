# Decision 024 — callout emoji picker: Upload tab(v3 增量)

## §0 决议元数据

| 字段 | 值 |
|------|------|
| decision-id | 024-callout-upload-tab |
| 状态 | Pending(决议字面拍板,等实施) |
| 提出日期 | 2026-05-16 |
| 优先级 | P1(用户体验增量,非阻塞) |
| 前置决议 | 023 callout-icon-tab(已合 main commit `82ea08c`,4 tab 栏 + 互斥 attrs 模式既有) |
| 后置决议 | 025 全局媒体画廊(独立 sub-phase,本决议字面不做,留 §3.5 hook) |
| 涉及分支 | `feature/callout-upload-tab`(从 main 切) |

## §0.5 SDK 版本依赖登记

> 依据 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) §2.2 字面"决议字面拍板必须 grep package.json + .d.ts 字面证据"。

### §0.5.1 本 sub-phase 涉及 SDK 字面清单

| 包名 | 字面 package.json range | node_modules 实装版本 | 本 sub-phase 是否升级 | 字面理由 |
|------|------|------|------|------|
| `emoji-mart` | `^5.6.0` | `5.6.0` | 否 | v1 已锁(SDK policy §4 v1.8) |
| `@emoji-mart/data` | `^1.2.1` | `1.2.1` | 否 | v1 已锁 |
| `lucide-react` | `^1.14.0` | `1.14.0` | 否 | D023 已锁 |
| `react` | `^19.2.0` | `19.2.5` | 否 | 不动 |
| **新增 SDK** | — | — | — | **本 sub-phase 字面零新增 SDK**(mediaStore 字面是 main 进程自实现 IPC,不引外部包) |

### §0.5.2 字面验证记录

本 sub-phase 字面不引入新 SDK,字面不触发跨大版本升级,字面不触发 SDK-policy §2 独立 sub-phase 拆分要求。

媒体上传字面消费**既有 media-storage capability**([src/capabilities/media-storage/](../../../../../src/capabilities/media-storage/)) 的 `mediaPutBase64` API,字面 audit Wave 3.1 已把 storage/media-store 迁到 capability 层,charter §1.1 合规。

---

## §1 背景与目标

### §1.1 上下文

V2 的 callout block emoji picker 字面在 [src/capabilities/text-editing/ui/emoji-picker/](../../../../../src/capabilities/text-editing/ui/emoji-picker/)。

**D023 已合 main**(commit `82ea08c`):
- 4 tab 栏:**Emojis active** / **Icons active** / Upload disabled / Remove disabled
- callout schema 字面 `attrs.emoji + attrs.iconName`(D023 §4.1)
- driver/api 字面 `setCalloutEmoji`(清 iconName 副作用) + `setCalloutIcon`(D023 §4.4)
- NodeView 字面单点判定:`iconName != null` 优先渲 lucide,否则 emoji(D023 §4.2)
- driver 层字面零 React / 零 lucide-react 依赖(B 路径,setCalloutIconRenderer 注入)

### §1.2 目标

本 sub-phase 实施 **Upload tab**:
- 点击 Upload tab → 拖拽区 + 文件选择按钮
- 选文件 → `mediaPutBase64` → 返回 `media://...` URL
- 写入 callout `attrs.imageSrc` → NodeView 渲 `<img>`(macOS squircle 圆角)
- 切回 Emojis / Icons tab → 选 emoji/icon 自动清 imageSrc

### §1.3 范围决定

**做**:
1. callout schema 扩展(新增 `attrs.imageSrc: { default: null }`)
2. callout NodeView 渲染分支(三态独立,无优先级争议):
   - `imageSrc != null` → 渲 `<img src=imageSrc>`(macOS squircle border-radius 22.37%)
   - `iconName != null` → 渲 lucide `<svg>`(D023 既有)
   - 兜底 → 渲 emoji 字符
3. driver API 新增 `setCalloutImage(instanceId, blockPos, imageSrc: string | null)`,清 iconName(emoji 保留作 fallback,对齐 D023 setCalloutIcon 模式)
4. driver API 既有 `setCalloutEmoji` / `setCalloutIcon` 字面同步清 imageSrc(三字段互斥写入)
5. UploadTabPanel UI:拖拽区 + 文件选择 + 上传中态 + 错误 inline 红字
6. capability 字面通过 `requireCapabilityApi<MediaStorageApi>('media-storage')` 间接调 mediaPutBase64(charter §1.1 合规,不直 import `@storage/*`)
7. atom 序列化处理新字段(双层兜底,对齐 D023 §4.3 模式)
8. 旧 callout 数据(emoji 或 iconName)向前兼容(schema default null 兜底)

**不做**(留 v4 / 后续):
- **全局媒体画廊 / 历史选择**(留 decision-025 独立 sub-phase,见 §3.5 hook 字面理由)
- 图片裁剪 / 编辑 UI(直接用原图,CSS mask)
- GIF 动图支持判断(mediaStore 字面 image MIME 含 `image/gif`,默认支持)
- Remove tab(用户字面决议"无意义",不做)
- 上传进度条(mediaPutBase64 字面同步 IPC 不暴露 progress,显示"上传中..."文字即可)
- icon / image 复合(三态字面互斥,不允许同时显示 icon + image)
- theme light 模式(V2 字面无 theme store,主功能完成后统一调)

### §1.4 字面字段命名理由

新字段 `attrs.imageSrc` 字面命名理由:

- **不用裸 `src`**:callout 不是 media block 本体,`src` 字面在 image/file/audio/video block 已占用;callout 加 `src` 字面会让"callout 是不是 media block"产生语义混淆
- **不用 `imageMediaUrl`**:既有 image-block / file-block 字面就用 `src + mediaId` 双字段,没有 `xxxMediaUrl` 长名先例
- **不用 `imageMediaId`**:callout 字面**不需要 "在 Finder 显示" / shell.openPath 等 mediaId 路径**(image-block 才需要),单字段 URL 字面够用;v4 全局画廊需要时再扩
- **采用 `imageSrc`**:对齐 PM image block `src` 字面语义(存 `media://...` URL),加 `image` 前缀避免和 callout 未来可能扩展撞;三字段字面平级 `emoji / iconName / imageSrc`,无主从关系

---

## §2 现状(6 层传播 grep 结果字面 + mediaStore API 实证)

### §2.1 view caller 真消费点

字面 grep `attrs.emoji` `setCalloutEmoji` `setCalloutIcon` 在 `src/views/` 全部使用:

```
src/views/  → 0 处直接消费 attrs.emoji / setCalloutEmoji / setCalloutIcon
```

字面**所有消费方都在 driver / capability 层**,view 不直接读 callout attrs。新加 `imageSrc / setCalloutImage` 字面也将遵循此约定。

### §2.2 capability types.ts 接口

[src/capabilities/text-editing/types.ts](../../../../../src/capabilities/text-editing/types.ts) 字面:
- `setCalloutEmoji` / `setCalloutIcon` 字面**不出现在 capability types**(由 driver 层 `textEditingDriverApi` 暴露,view 通过 `requireCapabilityApi<TextEditingApi>` 拿运行时,通过 driver re-export 拿类型)
- 新增 `setCalloutImage` 字面沿用此模式,**类型由 driver api.ts 字面 inline 定义**,无需改 types.ts

### §2.3 capability index.ts renderer 入口

[src/capabilities/text-editing/index.ts](../../../../../src/capabilities/text-editing/index.ts) 字面:
- callout-emoji popup 字面注册在 [ui/popups.ts:47](../../../../../src/capabilities/text-editing/ui/popups.ts#L47): `id: 'text-editing.popup.callout-emoji'`
- emoji-picker integration 字面在 [ui/emoji-picker/integration.ts:39](../../../../../src/capabilities/text-editing/ui/emoji-picker/integration.ts#L39) `setCalloutEmojiHandler({...})`
- **本 sub-phase 字面不动 popup 注册 / handler 注入逻辑**(v1 / D023 已稳定)

### §2.4 IPC channel + preload + electron-api.d.ts

字面 callout atom **不过 IPC** — 走 PM `doc.toJSON()` 整体 payload 经存储层(SurrealDB)透明持久化。新字段 `imageSrc` 字面随 payload 透传,**零 IPC 改动**。

字面 media-storage IPC 字面已存在([src/shared/ipc/electron-api.d.ts](../../../../../src/shared/ipc/electron-api.d.ts) line 35-46):
- `mediaPutBase64(input, explicitMime?, hintedFilename?)` 字面返回 `{ success, mediaUrl?, mediaId?, error? }`
- `mediaDownload(url, type)`
- `mediaResolvePath(mediaUrl)`

本 sub-phase 字面**零 IPC 改动**(消费既有 API)。

### §2.5 分层 lint 规则

[eslint.config.js](../../../../../eslint.config.js) 字面规则:
- capability 层字面禁 import `@storage/*`(charter §1.1)
- capability 层字面允许 import `@slot/*`(popup-registry / capability-registry)
- 本 sub-phase UploadTabPanel 字面通过 `requireCapabilityApi<MediaStorageApi>` 间接拿 mediaPutBase64,**字面零 `@storage/*` 直 import**

⚠️ audit §5.4 字面 ESLint config block 互覆盖 bug 待修,字面 lint 通过不等于合规;字面 grep `import.*@storage/` 在 UploadTabPanel 自查作为兜底。

### §2.6 V2 既有同类型 SSOT 位置

| 类型 | 字面 SSOT 位置 |
|------|------|
| `MediaPutResult` | [src/capabilities/media-storage/index.ts](../../../../../src/capabilities/media-storage/index.ts) line 33 |
| `MediaStorageApi` | [src/capabilities/media-storage/types.ts](../../../../../src/capabilities/media-storage/types.ts) line 7 |
| callout `attrs` shape | [src/drivers/text-editing-driver/blocks/callout/spec.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/spec.ts) line 19-25 |
| callout setter API | [src/drivers/text-editing-driver/api.ts](../../../../../src/drivers/text-editing-driver/api.ts) line 153-185 |

### §2.7 callout schema 6 处字面影响点

字面 grep `attrs.emoji|attrs.iconName` 全 src:

| # | 文件 | 字面消费 |
|---|------|------|
| 1 | [src/drivers/text-editing-driver/blocks/callout/spec.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/spec.ts) | PM schema(attrs + parseDOM + toDOM) |
| 2 | [src/drivers/text-editing-driver/blocks/callout/node-view.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/node-view.ts) | NodeView 渲染(renderSymbol 单点判定) |
| 3 | [src/drivers/text-editing-driver/api.ts](../../../../../src/drivers/text-editing-driver/api.ts) | setCalloutEmoji / setCalloutIcon |
| 4 | [src/capabilities/text-editing/converters/atoms-to-pm.ts](../../../../../src/capabilities/text-editing/converters/atoms-to-pm.ts) | atom → PM(line 399-414) |
| 5 | [src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx) | setCalloutEmoji / setCalloutIcon 调用点 |
| 6 | (反向 pm-to-atoms 字面不存在)| converters/ 字面仅 `atoms-to-pm.ts + md-to-pm.ts + sanitize-atoms.ts`,**字面单向**(atoms→PM only),持久化字面走 PM `doc.toJSON()` 透明序列化,无需反向 converter |

### §2.8 mediaStore API 字面实证

[src/capabilities/media-storage/index.ts](../../../../../src/capabilities/media-storage/index.ts) 字面:

| API | 字面签名 | 字面返回 | 字面错误形态 |
|------|------|------|------|
| `mediaPutBase64(input, explicitMime?, hintedFilename?)` | `(string, string?, string?) => Promise<MediaPutResult>` | `{ success: true, mediaUrl, mediaId }` 或 `{ success: false, error }` | electronAPI 不可用 → success:false + error 字面字符串;大小超限 / MIME 未知 → main 进程 success:false |
| `mediaDownload(url, type)` | `(string, 'audio'|'image'|'video') => Promise<MediaPutResult>` | 同上 | 同上 |
| `mediaResolvePath(mediaUrl)` | `(string) => Promise<string | null>` | 路径或 null | 字面 try/catch 包,失败 null |

字面 `MediaPutResult.mediaUrl` 类型 `string | undefined`,**消费时字面必须 narrowing** `if (r.success && r.mediaUrl)` 后才能用(image-block / FileTab 字面已是此模式)。

字面 main-process 大小限制([media-store-impl.ts](../../../../../src/platform/main/media/media-store-impl.ts) line 33-37):
- image: 20 MB
- audio: 50 MB
- video: 200 MB

字面 putBase64 **不写 index entries**([media-store-impl.ts](../../../../../src/platform/main/media/media-store-impl.ts) line 262 注释):"SHA256 + 文件存在性已能跨调用去重"。**画廊 list API 字面前置 main 进程改动 + migration**,留 decision-025。

### §2.9 popup 第六交互合规字面

参考 [audit §5.3 popup 认清为第六交互 Registry](../../../audit/2026-05-08-register-and-layer-audit.md)。

字面 UploadTabPanel 不动 popup 注册 / popup-controller,字面在既有 callout-emoji popup 内**新加一个 activeTab 分支**,字面与 IconsTabPanel 字面同款架构。

---

## §3 方案选型

### §3.1 schema 改造方案 A/B/C

#### 方案 A:三态字段平级(`emoji + iconName + imageSrc`)— **选定**

```ts
attrs: {
  emoji: { default: '💡' },
  iconName: { default: null },
  imageSrc: { default: null },  // 新增
  bookAnchor: { default: null }, // sub-phase 022 既有
}
```

NodeView 渲染单点判定(无优先级争议,因为字面互斥写入):

```ts
if (imageSrc) → <img src={imageSrc}> + macOS squircle
else if (iconName) → lucide svg
else → emoji 字符
```

互斥由 setter 字面保证:
- `setCalloutEmoji` → 设 emoji,清 iconName + imageSrc
- `setCalloutIcon` → 设 iconName,清 imageSrc(emoji 保留 fallback,D023 既有)
- `setCalloutImage` → 设 imageSrc,清 iconName(emoji 保留 fallback)

**优点**:
- 字面对齐 D023 既有"三字段互斥"模式,改动最小
- 字段独立,字面单点判定无二义性
- 旧 callout 数据(只有 emoji 或 emoji+iconName)字面向前兼容(default null)
- 字段命名字面对齐既有 image-block `src` 语义,有前缀 `image` 避免与未来扩展撞

**缺点**:
- 三字段共存,字面消费方判定 if-else 链(可接受,字面同 D023 模式)

#### 方案 B:复合字段 `symbolType + symbolValue`

```ts
attrs: {
  symbolType: { default: 'emoji' },  // 'emoji' | 'icon' | 'image'
  symbolValue: { default: '💡' },     // emoji 字符 / iconName / mediaUrl
}
```

**优点**:字段紧凑,单字段判定无 if-else 链

**缺点**:
- 字面**破坏 D023 既有 schema**(emoji + iconName 双字段),要 atom migration 老数据(charter §1.3 评审)
- D023 NodeView / api / atoms-to-pm 字面全要重写,远超本 sub-phase scope
- 字面**字段语义模糊**:`symbolValue` 字段含义随 `symbolType` 变,IDE 类型推断字面退化为 string,IDE 类型守门失效

#### 方案 C:嵌套对象 `symbol: { type, value }`

类似 B,但用嵌套对象。**字面缺点同 B,且 PM schema 字面不支持嵌套对象 attrs**(PM schema attrs 字面是 `Record<string, primitive>`),pass。

#### 字面决议:**方案 A**

理由:
1. 字面对齐 D023 既有模式(最小改动)
2. 字段命名字面对齐既有 image-block / file-block(`src + mediaId` 双字段约定)
3. 零 atom migration(旧数据 default null 兜底)
4. PM schema 字面无嵌套约束,平级字段最简单

### §3.2 与 D023 协调字面

D023 已合 main,字面**不改 emoji / iconName 字段命名**:

- 保留 `attrs.emoji + attrs.iconName`(D023 既有,不强行重命名为 `symbolType/symbolValue`)
- 新增 `attrs.imageSrc` 字面同位平等三字段
- setCalloutEmoji 字面**新增清 imageSrc 副作用**(对齐已有清 iconName 模式)
- setCalloutIcon 字面**新增清 imageSrc 副作用**

### §3.3 mediaStore 接入路径

字面消费路径(完全对齐 [FileTab.tsx](../../../../../src/capabilities/text-editing/ui/link-panel/FileTab.tsx) 字面 v1 已成熟模式):

```tsx
// UploadTabPanel 字面
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MediaStorageApi } from '@capabilities/media-storage/types';

const mediaApi = requireCapabilityApi<MediaStorageApi>('media-storage');
const dataUrl = await readFileAsDataUrl(pickedFile);
const r = await mediaApi.mediaPutBase64(
  dataUrl,
  pickedFile.type || 'application/octet-stream',
  pickedFile.name,
);
if (r.success && r.mediaUrl) {
  api.setCalloutImage(ctx.instanceId, ctx.blockPos, r.mediaUrl);
  onCloseRef.current();
} else {
  setError(`上传失败:${r.error || '未知错误'}`);
}
```

字面合规字面证据:
- charter §1.1:`@capabilities/text-editing/ui/emoji-picker/UploadTabPanel.tsx` 不直 import `@storage/*` ✅
- charter §1.1:通过 `@slot/capability-registry` 间接调 media-storage ✅
- 字面与既有 FileTab.tsx 字面**字面零样式偏离**(setError inline 红字 / dataUrl + mediaPutBase64 / 成功 success+mediaUrl narrowing)

### §3.4 错误处理策略

参考 [feedback_implementation_test_checklist.md](../../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_implementation_test_checklist.md)。

| 错误形态 | 字面来源 | 字面 UI 表现 |
|------|------|------|
| 文件读取失败(FileReader error) | UploadTabPanel try/catch | inline 红字"读取文件失败: {err}" |
| MIME 类型未知 | mediaPutBase64 success:false + error | inline 红字"上传失败: no mimeType" |
| 文件过大(image 20MB) | mediaPutBase64 success:false + error | inline 红字"上传失败: file too large" |
| electronAPI 不可用 | mediaPutBase64 success:false + error | inline 红字"上传失败: electronAPI.mediaPutBase64 not available" |
| 网络中断(下载远程 URL,本 sub-phase 不做) | N/A | N/A(本 sub-phase 字面仅支持本地文件上传) |
| popup 关闭中途上传未完成 | 字面 cancelled 标志位 | popup 关 → setState 跳过,不写入 callout |

字面**不**显示进度条(mediaPutBase64 字面同步 IPC 不暴露 progress,字面显示"上传中..."文字即可,对齐 FileTab.tsx 既有 importing state)。

### §3.5 v4 全局媒体画廊 hook 字面预留

> 用户字面诉求:"上传后作为独立的库显示在上传的下方,方便下一次选择"。
> 本 sub-phase 字面**不做**,留 decision-025 独立 sub-phase 字面理由:

字面理由(参考用户字面同意"贸然修改数据模型不可取"):

1. **putBase64 字面不写 index**([media-store-impl.ts](../../../../../src/platform/main/media/media-store-impl.ts) line 18 + 262):"老用户磁盘上已有的图字面不在 index 里",画廊只显示"改动之后新上传的图",一次性需要 migration 扫 `images/` 目录回填,字面触发 [decision 009 migration-strategy.md](../009-migration-strategy.md) 范围
2. **index key 字面是 originalUrl 而非 mediaId**(line 195 + 239):画廊 list API 需要改 key 结构或加并行索引,字面是 [decision 008 storage-layer-interface.md](../008-storage-layer-interface.md) 接口字面变更
3. **未定语义**:删除策略(引用计数 / 孤儿清理)、缩略图生成(原图 20MB 不能直接挂网格预览)、命名标签、跨笔记隐私
4. **跨视图 SSOT 归属**(charter §1.3):画廊放 media-storage(全局共享)? 还是 text-editing 内部 recent uploads(callout 专属)? 字面 [project_two_atom_layers.md] 范围决策

字面 v4 留 hook 字面契约:
- v4 加 `mediaListImages(): Promise<MediaEntry[]>` 字面在 media-storage 层
- callout `setCalloutImage` 字面**不动**(仍接受 `media://...` URL 单参数)
- UploadTabPanel 字面**加 "Recent uploads" 区段消费 API**,**字面零 schema 变更**

字面 v3 → v4 升级路径**字面不需要 atom migration**(imageSrc 字段已 v3 落地)。

---

## §4 数据模型变更

### §4.1 callout schema 字面新字段

[src/drivers/text-editing-driver/blocks/callout/spec.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/spec.ts) 字面 attrs:

```ts
attrs: {
  emoji: { default: '💡' },
  bookAnchor: { default: null },     // sub-phase 022 既有
  iconName: { default: null },       // D023 既有
  imageSrc: { default: null },       // 本 sub-phase 新增
}
```

parseDOM 字面 getAttrs 新增:

```ts
return {
  emoji: el.getAttribute('data-emoji') || '💡',
  iconName: el.getAttribute('data-icon-name') || null,
  imageSrc: el.getAttribute('data-image-src') || null,
};
```

toDOM 字面新增:

```ts
if (node.attrs.imageSrc) {
  attrs['data-image-src'] = node.attrs.imageSrc as string;
}
```

### §4.2 callout NodeView 字面渲染分支

[src/drivers/text-editing-driver/blocks/callout/node-view.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/node-view.ts) 字面 renderSymbol:

```ts
function renderSymbol(
  hostEl: HTMLElement,
  imageSrc: string | null,
  iconName: string | null,
  emoji: string,
): void {
  // 字面三态单点判定
  if (imageSrc) {
    // 清 lucide React tree(如果切前是 icon)
    const renderer = getCalloutIconRenderer();
    if (renderer) renderer.unmount(hostEl);
    hostEl.textContent = '';
    const img = document.createElement('img');
    img.src = imageSrc;
    img.className = 'krig-callout__image';
    img.alt = '';
    hostEl.appendChild(img);
    return;
  }
  if (iconName) {
    const renderer = getCalloutIconRenderer();
    if (renderer) {
      renderer.render(hostEl, iconName);
      return;
    }
    // renderer 未注入 → 字面零行为退化到 emoji(D023 既有)
  }
  // 清 renderer 残留 + 清 img 残留
  const renderer = getCalloutIconRenderer();
  if (renderer) renderer.unmount(hostEl);
  hostEl.textContent = emoji || '💡';
}
```

字面 update / destroy 钩子同 D023 字面对齐:imageSrc 切换时清除前一态 DOM。

字面 CSS([src/capabilities/text-editing/ui/popups.css](../../../../../src/capabilities/text-editing/ui/popups.css) 或对应 callout 样式表):

```css
.krig-callout__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 22.37%;  /* macOS Big Sur+ squircle 字面规范 */
}
```

### §4.3 atom 序列化字面

[src/capabilities/text-editing/converters/atoms-to-pm.ts](../../../../../src/capabilities/text-editing/converters/atoms-to-pm.ts) 字面 callout 分支 line 399-414:

```ts
case 'callout': {
  const emoji = (c.emoji as string) ?? '💡';
  const iconName = (c.iconName as string | null | undefined) ?? null;
  const imageSrc = (c.imageSrc as string | null | undefined) ?? null;  // 新增
  const inner = convertTiptapContent(c.tiptapContent);
  return attachFrom(
    {
      type: 'callout',
      attrs: { emoji, iconName, imageSrc },  // 新增 imageSrc
      content: inner.length > 0 ? inner : [emptyParagraph()],
    },
    atom.from,
  );
}
```

字面双层兜底:
- 转换层 `?? null` 兜旧 atom 无字段
- PM schema `default: null` 字面再兜底

### §4.4 driver API 字面新增 setCalloutImage

[src/drivers/text-editing-driver/api.ts](../../../../../src/drivers/text-editing-driver/api.ts) 字面新增:

```ts
/**
 * 给 callout block 设 imageSrc attr(Upload tab 用)。
 *
 * imageSrc 非 null 时 NodeView 字面渲 `<img>` 取代 emoji / icon;
 * imageSrc === null 字面表示"取消 image",回退到 iconName / emoji(字段保留)。
 *
 * 仅作用于 callout block;其他 block 类型静默忽略(防误用)。
 * 字面互斥副作用:同步清 iconName(切回 emoji 模式 fallback,emoji 字段保留)。
 */
setCalloutImage(instanceId: string, blockPos: number, imageSrc: string | null): void {
  const inst = instanceRegistry.get(instanceId);
  if (!inst) return;
  const node = inst.view.state.doc.nodeAt(blockPos);
  if (!node || node.type.name !== 'callout') return;
  const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
    ...node.attrs,
    imageSrc,
    iconName: null,
  });
  inst.view.dispatch(tr);
},
```

字面 setCalloutEmoji 字面修改(新增清 imageSrc):

```ts
setCalloutEmoji(instanceId: string, blockPos: number, emoji: string): void {
  // ...
  const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
    ...node.attrs,
    emoji,
    iconName: null,
    imageSrc: null,  // 新增
  });
  // ...
},
```

字面 setCalloutIcon 字面修改(新增清 imageSrc):

```ts
setCalloutIcon(instanceId: string, blockPos: number, iconName: string | null): void {
  // ...
  const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
    ...node.attrs,
    iconName,
    imageSrc: null,  // 新增
  });
  // ...
},
```

### §4.5 UploadTabPanel UI 字面

[src/capabilities/text-editing/ui/emoji-picker/UploadTabPanel.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/UploadTabPanel.tsx) 字面新文件:

```tsx
/**
 * UploadTabPanel — Upload tab(D024)
 *
 * 字面架构同 IconsTabPanel:
 * - emoji picker popup 内一个 tab 子组件
 * - 父组件 EmojiPickerPanel 字面通过 `activeTab === 'upload'` 分支挂载
 * - 字面父组件传 onPick 回调(选中文件后回调,父组件调 setCalloutImage)
 *
 * UI 字面三态:
 * - 未选文件:拖拽区 + "选择文件"按钮
 * - 选中文件:预览缩略图 + 文件名 + "确认"/"重选"按钮
 * - 上传中:置灰所有按钮 + "上传中..."文字
 *
 * 错误形态字面 inline 红字(对齐 FileTab.tsx 既有模板)。
 */

import { useEffect, useRef, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MediaStorageApi } from '@capabilities/media-storage/types';

interface UploadTabPanelProps {
  onPick: (imageSrc: string) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const ACCEPT_MIME = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

export function UploadTabPanel({ onPick }: UploadTabPanelProps) {
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 字面预览 URL 清理(防内存泄漏)
  useEffect(() => {
    if (!pickedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pickedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pickedFile]);

  function pickFile(): void {
    setError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT_MIME;
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) setPickedFile(f);
    });
    input.click();
  }

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setError(null);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError(`不支持的文件类型:${f.type || '未知'}`);
      return;
    }
    setPickedFile(f);
  }

  async function confirm(): Promise<void> {
    if (!pickedFile) return;
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(pickedFile);
      const mediaApi = requireCapabilityApi<MediaStorageApi>('media-storage');
      const r = await mediaApi.mediaPutBase64(
        dataUrl,
        pickedFile.type || 'application/octet-stream',
        pickedFile.name,
      );
      if (r.success && r.mediaUrl) {
        onPick(r.mediaUrl);
      } else {
        setError(`上传失败:${r.error || '未知错误'}`);
      }
    } catch (err) {
      setError(`读取文件失败:${String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  if (!pickedFile) {
    return (
      <div
        ref={containerRef}
        className={`krig-emoji-picker__upload-tab ${isDragging ? 'krig-emoji-picker__upload-tab--dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="krig-emoji-picker__upload-dropzone">
          <div className="krig-emoji-picker__upload-hint">
            拖拽图片到此处,或
          </div>
          <button
            type="button"
            className="krig-emoji-picker__upload-pick-btn"
            onClick={pickFile}
          >
            📁 选择图片
          </button>
          <div className="krig-emoji-picker__upload-formats">
            支持 PNG / JPEG / WEBP / GIF / SVG(最大 20 MB)
          </div>
        </div>
        {error && <div className="krig-emoji-picker__upload-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="krig-emoji-picker__upload-tab">
      <div className="krig-emoji-picker__upload-preview">
        {previewUrl && (
          <img
            src={previewUrl}
            alt={pickedFile.name}
            className="krig-emoji-picker__upload-preview-img"
          />
        )}
        <div className="krig-emoji-picker__upload-preview-name">
          {pickedFile.name}
        </div>
      </div>
      <div className="krig-emoji-picker__upload-actions">
        <button
          type="button"
          className="krig-emoji-picker__upload-confirm-btn"
          onClick={confirm}
          disabled={uploading}
        >
          {uploading ? '上传中...' : '确认'}
        </button>
        <button
          type="button"
          className="krig-emoji-picker__upload-reset-btn"
          onClick={() => setPickedFile(null)}
          disabled={uploading}
        >
          重选
        </button>
      </div>
      {error && <div className="krig-emoji-picker__upload-error">{error}</div>}
    </div>
  );
}
```

### §4.6 EmojiPickerTabs 字面解 Upload disabled

[src/capabilities/text-editing/ui/emoji-picker/EmojiPickerTabs.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/EmojiPickerTabs.tsx) 字面:

```ts
const TABS: ReadonlyArray<TabDef> = [
  { id: 'emojis', label: 'Emojis', disabled: false },
  { id: 'icons', label: 'Icons', disabled: false },
  { id: 'upload', label: 'Upload', disabled: false },  // 字面解 disabled
  { id: 'remove', label: 'Remove', disabled: true },   // 用户决议不做
];
```

### §4.7 EmojiPickerPanel 字面加 Upload tab 分支

[src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx) 字面新增:

```tsx
import { UploadTabPanel } from './UploadTabPanel';

// ... 在 return JSX 内:
{activeTab === 'upload' && (
  <UploadTabPanel
    onPick={(imageSrc) => {
      if (ctx) api.setCalloutImage(ctx.instanceId, ctx.blockPos, imageSrc);
      onCloseRef.current();
    }}
  />
)}
```

字面 useEffect 字面修改:`if (activeTab !== 'emojis') return;` 字面已经覆盖 upload tab(切到 upload 字面 cleanup emoji-mart picker,无需新逻辑)。

---

## §5 实施任务清单

### Step 5.1 — 决议文档 commit

字面 commit `docs(callout): D024 decision — Upload tab schema + API + UploadTabPanel`。

### Step 5.2 — callout schema 新字段

字面动:
- [spec.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/spec.ts) attrs / parseDOM / toDOM 加 imageSrc

commit `feat(callout): add imageSrc attr to PM schema (D024 §4.1, Step 5.2)`。

### Step 5.3 — NodeView 渲染分支

字面动:
- [node-view.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/node-view.ts) renderSymbol 加 imageSrc 分支
- update / destroy 钩子对齐
- CSS 加 `.krig-callout__image`(macOS squircle)

commit `feat(callout): nodeView render branch for imageSrc + macOS squircle CSS (D024 §4.2, Step 5.3)`。

### Step 5.4 — driver API setCalloutImage + 互斥副作用

字面动:
- [api.ts](../../../../../src/drivers/text-editing-driver/api.ts) 新增 setCalloutImage
- setCalloutEmoji / setCalloutIcon 加清 imageSrc 副作用

commit `feat(callout): setCalloutImage API + tri-attr mutual-exclusion side-effect (D024 §4.4, Step 5.4)`。

### Step 5.5 — atom→PM passthrough

字面动:
- [atoms-to-pm.ts](../../../../../src/capabilities/text-editing/converters/atoms-to-pm.ts) callout 分支加 imageSrc 双层兜底

commit `feat(callout): atoms-to-pm.ts passthrough imageSrc (D024 §4.3, Step 5.5)`。

### Step 5.6 — UploadTabPanel + EmojiPickerTabs/Panel 整合

字面动:
- 新建 [UploadTabPanel.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/UploadTabPanel.tsx)
- [EmojiPickerTabs.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/EmojiPickerTabs.tsx) Upload disabled 改 false
- [EmojiPickerPanel.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx) 加 activeTab === 'upload' 分支
- CSS 加 UploadTab 样式(拖拽区 / 预览 / 错误红字 / disabled 按钮)

commit `feat(callout): Upload tab implemented — drag/pick → mediaPutBase64 → setCalloutImage (D024 §4.5, Step 5.6)`。

### Step 5.7 — 全量自测

字面跑 §6 测试清单 13 场景,登记任何偏离到 §10。

commit `docs(callout): D024 §10 deviations + §11 lessons (Step 5.7 self-test)`(若有偏离)。

### Step 5.8 — 反向更新 + 等用户合 main

字面动 §8 反向更新清单(SDK policy §4 / test-checklists / §8 勾选),用户字面确认后合 main。

---

## §6 测试与验收

### §6.1 黄金路径

| # | 步骤 | 期望结果 |
|---|------|------|
| T1 | 在 note 内插入 callout (slash 命令 callout) | 默认 💡 emoji 显示 |
| T2 | 点 💡 emoji → popup 弹出 | 4 tab 栏字面 4 个全可点(emojis / icons / upload active;remove disabled) |
| T3 | 切 Upload tab | 显示拖拽区 + 选择文件按钮 + 支持格式提示 |
| T4 | 点 "选择图片" → 系统文件对话框 → 选 PNG | 显示预览缩略图 + 文件名 + 确认/重选按钮 |
| T5 | 点确认 → 显示"上传中..." → 上传完成 | popup 关闭,callout 头部显示 `<img>`(macOS squircle 圆角) |
| T6 | 切回 Emojis tab → 选其他 emoji | callout 头部显示新 emoji(imageSrc 清空) |
| T7 | 持久化:reload note | callout `<img>` 字面恢复(imageSrc 透明持久化) |

### §6.2 三态互斥字面

| # | 步骤 | 期望结果 |
|---|------|------|
| T8 | callout 头部是 emoji → Upload tab 选图 | 渲 `<img>`(emoji 字段保留,但不渲) |
| T9 | callout 头部是 image → Icons tab 选 icon | 渲 lucide `<svg>`(imageSrc 清空,emoji 保留) |
| T10 | callout 头部是 image → Emojis tab 选 emoji | 渲 emoji 字符(imageSrc + iconName 都清空) |

### §6.3 错误场景

| # | 步骤 | 期望结果 |
|---|------|------|
| T11 | 拖拽非图片(.txt)到拖拽区 | inline 红字"不支持的文件类型: text/plain" |
| T12 | 选 25 MB PNG | 上传中 → inline 红字"上传失败: file too large"(或字面 main 进程错误消息),callout 不变 |
| T13 | popup 弹出后切回 Emojis tab 不上传直接关 popup | callout 状态字面不变(无副作用) |

### §6.4 持久化 + 兼容

| # | 步骤 | 期望结果 |
|---|------|------|
| T14 | 旧 callout(仅 emoji)reload | emoji 渲染,imageSrc default null 兜底 |
| T15 | D023 callout(emoji + iconName)reload | icon 渲染,imageSrc default null 兜底 |

---

## §7 风险与回滚

### §7.1 风险字面清单

| 风险 | 字面影响 | 缓解 |
|------|------|------|
| imageSrc 字段命名后悔 | 已落地数据需 atom migration | 字面 grep 既有命名做足前瞻;字段独立性高,后悔代价低于 D023 |
| `<img>` 加载失败(media:// URL 失效 / 资源被删) | callout 头部显示破图 | 加 `<img onError>` fallback 回 emoji 渲染(留 §11 偏离登记若实施期出问题) |
| 拖拽 dataTransfer 跨 popup 边界丢失 | 拖拽不响应 | 字面 popup 容器本身字面 onDragOver/onDrop 直接挂(测试期验证) |
| 三字段互斥被绕开(view 直 dispatch tr 不走 setter) | callout 头部同时显示多态 | 字面 grep `src/views/` 0 处直接动 callout attrs,view 层守门 |

### §7.2 回滚

字面 revert 本 sub-phase 6 commit 即回到 D023 状态。已落地的 imageSrc 字段字面 PM schema default null 兜底,旧数据无影响。

---

## §8 反向更新清单

| # | 字面文件 | 字面更新 |
|---|------|------|
| 1 | [SDK-version-binding-policy.md §4](../SDK-version-binding-policy.md) | 加 D024 字面 SDK 锁定记录(实质零新增 SDK,字面备注"消费既有 media-storage capability") |
| 2 | [test-checklists/callout-as-container.md](../../../../test-checklists/callout-as-container.md) | F 段 emoji picker 升级到 4 tab 字面 3 active(emojis / icons / upload) |
| 3 | 本 §8 勾选 | 实施完成后字面勾此清单 |
| 4 | [MEMORY.md](../../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/MEMORY.md) | 加 `project_decision_024_callout_upload_done` 记 D024 完成状态 + 下游 D025 待立 |

---

## §9 通过条件

字面通过条件(全部满足才能合 main):

1. §6 测试清单 15 场景字面 PASS
2. §10 偏离登记字面已写(若有)
3. §11 教训登记字面已写(若有)
4. §8 反向更新字面已落地(SDK policy + test-checklist + memory)
5. 用户字面显式说"合 main"(参考 [feedback_merge_requires_explicit_ok.md](../../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_merge_requires_explicit_ok.md))
6. lint 字面 pass(注意 audit §5.4 字面 block 互覆盖 bug,字面 grep `import.*@storage/` 自查)

---

## §10 实施期偏离登记

> 字面实施期凡是字面与本决议字面不符的决策都登记到此 — 教训累积参考 [feedback_decision_grep_verify_complete_propagation.md](../../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_decision_grep_verify_complete_propagation.md)。

(实施期待填)

---

## §11 教训登记

(实施期待填)
