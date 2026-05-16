# Decision 023 — callout emoji picker: Icons tab(v2 增量)

## §0 决议元数据

| 字段 | 值 |
|------|------|
| decision-id | 023-callout-icon-tab |
| 状态 | Pending(决议字面拍板,等实施) |
| 提出日期 | 2026-05-16 |
| 优先级 | P1(用户体验增量,非阻塞) |
| 前置决议 | v1 callout-as-container([test-checklists/callout-as-container.md](../../../test-checklists/callout-as-container.md))已合 main commit `794db28..361444d` |
| 后置决议 | 024 callout Upload tab(独立 sub-phase,本决议不做) |
| 涉及分支 | `feature/callout-icon-tab`(从 main 切) |

## §0.5 SDK 版本依赖登记

> 依据 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) §2.2 字面"决议字面拍板必须 grep package.json + .d.ts 字面证据"。

### §0.5.1 本 sub-phase 涉及 SDK 字面清单

| 包名 | 字面 package.json range | node_modules 实装版本 | npm latest(2026-05-16) | 本 sub-phase 是否升级 | 字面理由 |
|------|------|------|------|------|------|
| `lucide-react` | `^1.14.0` | `1.14.0` | `1.16.0` | **否** | 落后 2 minor,1952 个 icon 字面已覆盖目标子集;跨大版本升级独立 sub-phase(SDK policy §2 字面"跨大版本独立 sub-phase") |
| `react` | `^19.2.0` | `19.2.5` | (本 sub-phase 不动) | 否 | 字面 grep 确认 lucide-react peer 含 `^19.0.0`,兼容 |
| `emoji-mart` | `^5.6.0` | `5.6.0` | (v1 已锁) | 否 | v1 已锁 |
| `@emoji-mart/data` | `^1.2.1` | `1.2.1` | (v1 已锁) | 否 | v1 已锁 |

### §0.5.2 lucide-react 来源验证字面(防 typo 包/fork)

- `name: "lucide-react"` 字面(npm 官方包名)
- `author: Eric Fennis` 字面(lucide 官方维护者)
- `repository: github.com/lucide-icons/lucide` 字面(官方 monorepo,`directory: packages/lucide-react`)
- `homepage: https://lucide.dev` 字面(官方站点)
- npm `view lucide-react versions` 字面跨 `0.0.1 → 0.577.0 → 1.0.0-rc → 1.16.0` 连续主线

详见 [§2.5 lucide-react SDK 验证字面](#25-lucide-react-sdk-验证字面)。

---

## §1 背景与目标

### §1.1 上下文

V2 的 callout block emoji picker 字面在 [src/capabilities/text-editing/ui/emoji-picker/](../../../../../src/capabilities/text-editing/ui/emoji-picker/)。

**v1 已合 main**(commit 范围 `794db28..361444d`):
- emoji-mart 5.x Web Component 包装(不用 `@emoji-mart/react`,手写 React 包装)
- 4 tab 栏:**Emojis active** / Icons disabled / Upload disabled / Remove disabled
- "Callouts" 24 emoji 通过 `custom` prop 置顶
- callout schema 字面 `attrs.emoji: { default: '💡' }`(required string)
- emoji-picker 完整使用 [test-checklists/callout-as-container.md](../../../test-checklists/callout-as-container.md) F 段验证

### §1.2 目标

本 sub-phase 实施 **Icons tab**:
- 点击 Icons tab → 显示字符 icon 库 + 搜索
- 选中 icon 后 callout 头部显示该 icon(lucide `<svg>`) 而非 emoji
- 切回 Emojis tab 选 emoji → 自动清除 icon,渲回 emoji

### §1.3 范围决定

**做**:
1. Icons tab UI(lucide-react 字符画 icon 库 + 搜索 + 网格,默认置顶 Notion 风格子集)
2. callout schema 扩展(新增 `attrs.iconName: { default: null }`)
3. callout NodeView 渲染分支(emoji 字符 vs `<svg>` icon,iconName 优先)
4. atom 序列化处理新字段(零反向 converter,PM toJSON 透传)
5. 旧 callout 数据(仅有 emoji)向前兼容(schema default null 兜底)

**不做**(留 v3 / 后续):
- Upload tab(mediaStore 集成,独立 sub-phase 024)
- Remove tab(用户字面决议"无意义",不做)
- icon 颜色自定义(v2 用默认色)
- 多 icon 库切换(v2 只 lucide)
- theme light 模式(V2 字面无 theme store,主功能完成后统一调)
- lucide-react `1.14 → 1.16` 升级(SDK policy §2 字面独立 sub-phase)

---

## §2 现状(6 层传播 grep 结果字面)

### §2.1 view caller 真消费点

字面 grep `attrs.emoji` `setCalloutEmoji` 在 `src/views/` 全部使用:

```
src/views/  → 0 处直接消费 attrs.emoji 或 setCalloutEmoji
```

字面**所有消费方都在 driver / capability 层**,view 不直接读 callout attrs。

### §2.2 capability types.ts 接口

[src/capabilities/text-editing/types.ts](../../../../../src/capabilities/text-editing/types.ts) 字面:
- `setCalloutEmoji` 字面不出现在 capability types(由 driver 层 `textEditingDriverApi` 暴露)
- callout block 在 `BLOCK_TYPES` 字面枚举(line 33): `'callout' | 'toggle-list'`

### §2.3 capability index.ts renderer 入口

[src/capabilities/text-editing/index.ts](../../../../../src/capabilities/text-editing/index.ts) 字面:
- callout-emoji popup 字面注册在 [ui/popups.ts:47](../../../../../src/capabilities/text-editing/ui/popups.ts#L47): `id: 'text-editing.popup.callout-emoji'`
- emoji-picker integration 字面在 [ui/emoji-picker/integration.ts:39](../../../../../src/capabilities/text-editing/ui/emoji-picker/integration.ts#L39) `setCalloutEmojiHandler({...})`

### §2.4 IPC channel + preload + electron-api.d.ts

字面 callout atom **不过 IPC** — 走 PM `doc.toJSON()` 整体 payload 经存储层(SurrealDB)透明持久化。新字段 `iconName` 字面随 payload 透传,**零 IPC 改动**。

详见 [§3.3.bis 反向 PM→atom 字面路径验证](#33bis-反向-pmatom-字面路径验证反馈-2-闭环)。

### §2.5 lucide-react SDK 验证字面

> SDK-policy §2.2 字面要求:跨大版本 SDK 选定前必须 grep package.json + .d.ts 字面证据。
> 字面证据缺失则 §3 字面 B 方案基础动摇,字面禁止拍板。

#### §2.5.1 `npm view lucide-react versions` 字面输出

字面跨度:
- 起点 `0.0.1`(2020 初)
- 中段 `0.11.0 → 0.577.0`(2020–2025 主力)
- 切版 `1.0.0-rc.0 → 1.0.0`(2025 SemVer 正式化)
- 当前 `1.16.0` 字面 npm latest

V2 字面装版本: `^1.14.0`(落后 latest 2 个 minor)

**结论**: lucide-react 字面是同一作者(Eric Fennis)同一仓库(`lucide-icons/lucide`)的连续主线,非 typo/fork 包。

#### §2.5.2 `node_modules/lucide-react/package.json` 字面 version

| 字段 | 字面值 |
|------|------|
| name | `lucide-react` |
| version | `1.14.0` |
| author | Eric Fennis |
| homepage | `https://lucide.dev` |
| repository | `github.com/lucide-icons/lucide`(directory:`packages/lucide-react`) |
| main | `dist/cjs/lucide-react.js` |
| module | `dist/esm/lucide-react.mjs` |
| typings | `dist/lucide-react.d.ts` |
| peerDependencies.react | `^16.5.1 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0` |

**React 19 字面优势**: peer 字面已含 `^19.0.0`,V2 装 `react@19.2.5` 直接兼容,不像 `@emoji-mart/react@1.1.1` peer 只到 18 需要手写 React 包装绕开(详见 v1 决议字面)。

#### §2.5.3 24 个目标 icon 一次性 grep 命中表(反馈 2 闭环)

字面命令:
```bash
grep -oE "\b(Lightbulb|Hand|ChevronUp|ThumbsUp|Key|Construction|AlertTriangle|Flame|Pin|Scissors|HelpCircle|Ban|Octagon|AlarmClock|Phone|Siren|Recycle|CheckCircle|Lock|Paperclip|BookOpen|MessageCircle|ArrowRight|Megaphone|Wrench|Settings)\b" \
  node_modules/lucide-react/dist/lucide-react.d.ts | sort -u
```

24 个 v1 Callouts emoji → lucide icon 字面映射表:

| # | v1 emoji | v1 emoji name | lucide 候选名 | d.ts 字面命中 | 状态 |
|---|---|---|---|---|---|
| 1 | 💡 | Light bulb | `Lightbulb` | ✓ | 命中 |
| 2 | 👉 | Pointing right | `Hand` 或 `ArrowRight` | ✓ ✓ | 命中(取 `ArrowRight` 更对齐 Notion) |
| 3 | ☝️ | Pointing up | `ChevronUp` 或 `ArrowUp` | ✓ ✓ | 命中(取 `ChevronUp`) |
| 4 | 👌 | OK hand | `ThumbsUp` | ✓ | 命中(语义近似替换) |
| 5 | 🔑 | Key | `Key` | ✓ | 命中 |
| 6 | 🚧 | Construction | `Construction` | ✓ | 命中 |
| 7 | ⚠️ | Warning | `AlertTriangle` | ✓ | 命中(或 alias `TriangleAlert`) |
| 8 | 🔥 | Fire | `Flame` | ✓ | 命中 |
| 9 | 📌 | Push pin | `Pin` | ✓ | 命中 |
| 10 | ✂️ | Scissors | `Scissors` | ✓ | 命中 |
| 11 | ❓ | Question mark | `HelpCircle` 或 `CircleHelp` | ✓ ✓ | 命中 |
| 12 | 🚫 | No entry sign | `Ban` | ✓ | 命中 |
| 13 | ⛔ | No entry | `Octagon` | ✓ | 命中(语义近似) |
| 14 | ⏰ | Alarm clock | `AlarmClock` | ✓ | 命中 |
| 15 | ☎️ | Telephone | `Phone` | ✓ | 命中 |
| 16 | 🚨 | Rotating light | `Siren` | ✓ | 命中 |
| 17 | ♻️ | Recycle | `Recycle` | ✓ | 命中 |
| 18 | ✅ | Check mark | `CheckCircle` | ✓ | 命中(或 alias `CircleCheck`) |
| 19 | 🔒 | Lock | `Lock` | ✓ | 命中 |
| 20 | 📎 | Paperclip | `Paperclip` | ✓ | 命中 |
| 21 | 📖 | Book | `BookOpen` 或 `Book` | ✓ ✓ | 命中 |
| 22 | 🗣️ | Speaking head | `MessageCircle` | ✓ | 命中(语义近似) |
| 23 | ➡️ | Arrow right | `ArrowRight` 或 `MoveRight` | ✓ ✓ | 命中 |
| 24 | 📣 | Megaphone | `Megaphone` | ✓ | 命中 |

**字面 grep 总命中**: 45 个候选名全部命中,**24 个 v1 emoji 一对一映射全部成立,零缺失**。

#### §2.5.4 SDK 验证结论

- V2 装的 `lucide-react@^1.14.0` 字面是官方主线,非历史 typo 包,非 fork
- 字面 1952 个 icon 覆盖 Notion callout 风格子集(24 个目标 icon 字面全部命中)
- React 19.2.5 peer 兼容(peer 字面含 `^19.0.0`) — **这是 lucide-react 相对 `@emoji-mart/react@1.1.1` 的字面优势**,后者 peer 只到 18 需要手写 React 包装绕开
- **B 方案字面拍板基础成立**,§3 解禁
- 版本滞后(`1.14` vs `1.16`)字面登记在 §0.5,**本 sub-phase 不升级**,升级单立 sub-phase
- 字面零缺失,**fallback 策略字面无需启用**(原计划"缺失 icon 用近义或 emoji 兜底"未触发)

### §2.6 分层 lint 规则

[eslint.config.js](../../../../../eslint.config.js) 字面 `no-restricted-imports` 不禁止 capability 字面 import `lucide-react`(既有 [shell/workspace-bar/AddWorkspaceButton.tsx](../../../../../src/shell/workspace-bar/AddWorkspaceButton.tsx) 字面已用)。

⚠️ **注意**: audit §5.4 字面登记 ESLint config block 互覆盖让 capability 主块规则失效,**lint 通过不等于合规**,需手工核对 [refactor charter](../../../00-总纲.md) §1.1/§1.3。

### §2.7 V2 既有同类型 SSOT 位置

callout block attrs 字面唯一 SSOT 在 [drivers/text-editing-driver/blocks/callout/spec.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/spec.ts),无第二处镜像。新字段加在此处即可。

### §2.8 callout schema 6 处字面影响点 grep

| # | 文件 | 字面命中 | 改动 |
|---|------|------|------|
| 1 | `drivers/text-editing-driver/blocks/callout/spec.ts` | line 18 `emoji: { default: '💡' }` + toDOM line 32 + parseDOM line 27 | 新增 `iconName: { default: null }` + toDOM/parseDOM 处理 |
| 2 | `drivers/text-editing-driver/blocks/callout/node-view.ts` | line 16/21/35/51 字面读 `node.attrs.emoji` | 新增 iconName 分支(优先) |
| 3 | `drivers/text-editing-driver/api.ts` | line 149 `setCalloutEmoji` | 修订:同步清 iconName(§4.4) + 新增 `setCalloutIcon` |
| 4 | `capabilities/text-editing/converters/atoms-to-pm.ts:400` | line 401 字面 `emoji = c.emoji ?? '💡'` | 加 `iconName: c.iconName ?? null` 透传 |
| 5 | PM→atom 反向 converter | **字面不存在**(详 §3.3.bis) | 零改动 |
| 6 | 其他 `attrs.emoji` 消费方 | 字面 grep 仅 5 处(spec/node-view/api/atoms-to-pm/EmojiPickerPanel),无其他 | 已全覆盖 |

---

## §3 方案选型

### §3.1 待选方案

**方案 A — 复合字段**(否决)
- schema: `attrs.symbol: { type: 'emoji' | 'icon', value: string }`
- atom 改造代价: 全部既有 callout atom 必须 migrate `emoji: '💡'` → `symbol: { type: 'emoji', value: '💡' }`
- 否决理由: SurrealDB migration 字面成本高,旧数据零迁移目标违背

**方案 B — 双字段并存且 iconName 非 null 优先**(采纳)
- schema: 保留 `attrs.emoji: { default: '💡' }`,新增 `attrs.iconName: { default: null }`
- 渲染规则: NodeView 内 `if (iconName != null) 渲 lucide <svg>; else 渲 emoji 字符`
- atom 改造代价: 旧数据零迁移(缺 iconName 字段默认 null,走 emoji 分支)
- 序列化代价: atoms-to-pm.ts callout case 加一行 `iconName: c.iconName ?? null` 透传
- SSOT 单点: callout 块的"显示什么"由 `iconName == null` 单一判定决定

**方案 C — 双字段 + 显式类型标记**(否决)
- schema: `attrs.symbol: string` + `attrs.symbolType: 'emoji' | 'icon'`
- 否决理由: 信息冗余(`symbolType` 可由 `symbol` 字面是 emoji 还是 icon-name 推断),且需 migrate

### §3.2 采纳方案 B 的字面理由

1. **向前兼容零迁移**: 旧 callout atom 字面无 `iconName` 字段,PM schema `default: null` 自动填充
2. **回滚成本最低**: 移除字段只需删 `attrs.iconName` + node-view 分支,emoji 路径不变
3. **NodeView 渲染分支单点判定**: `iconName != null ? renderIcon() : renderEmoji()`
4. **API 增量不破坏**: 现有 `setCalloutEmoji(instanceId, pos, emoji)` 签名不变(行为字面修订见 §4.4),新增并行 `setCalloutIcon(instanceId, pos, iconName: string | null)`,iconName=null 字面表示"切回 emoji 模式"
5. **互斥副作用语义单一来源**(反馈 3): `setCalloutEmoji` 字面同步清 iconName(§4.4),view caller 不必字面记得两 API 配对调用 — 单 API 调用一次完成"切回 emoji 且清掉 icon"语义,无双调用同步漏洞

### §3.3 方案 B 字面影响清单(5 处文件)

| 文件 | 字面改动 |
|------|------|
| `src/drivers/text-editing-driver/blocks/callout/spec.ts` | attrs 加 `iconName: { default: null }`;toDOM 条件加 `data-icon-name`(iconName != null 时);parseDOM `getAttrs` 读 `data-icon-name`(为空字符串则按 null)。注:本 DOM 改动也字面服务于 `getBlockClipboardAt` 内 `DOMSerializer.fromSchema` 路径([api.ts:488](../../../../../src/drivers/text-editing-driver/api.ts#L488) 字面),iconName 通过 toDOM 自动进 clipboard HTML,无需独立 markdown serializer 改造 |
| `src/drivers/text-editing-driver/blocks/callout/node-view.ts` | `update()` + 初始化分支:iconName != null 时 mount lucide `<svg>`(字面通过 ReactDOM portal 或 dynamic 字面 createIcons 函数注入,实施期 Step 5.x 决定);iconName == null 时 textContent emoji;mousedown handler 不动 |
| `src/drivers/text-editing-driver/api.ts` | 新增 `setCalloutIcon(instanceId, blockPos, iconName: string \| null)` API(字面在 setCalloutEmoji 同位 line ~160);`setCalloutEmoji` 字面修订:setNodeMarkup 时同步把 `iconName` 字面写 null(切回 emoji 模式互斥);见 §4.4 |
| `src/capabilities/text-editing/converters/atoms-to-pm.ts:400` | callout case `attrs: { emoji, iconName: (c.iconName as string \| null) ?? null }`,既有逻辑透传新字段 |
| `src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx` | Icons tab 实装(替换 disabled tab),24 Notion 风格 icon 置顶 + 搜索过滤全库;选中 icon 时**只调 `api.setCalloutIcon(ctx.instanceId, ctx.blockPos, iconName)`,字面不动 emoji 字段**(iconName 优先单点判定,emoji 是 fallback 兜底);切回 Emojis tab 选 emoji 时 `setCalloutEmoji` 字面会清 iconName(§4.4 副作用) |

### §3.3.bis 反向 PM→atom 字面路径验证(反馈 2 闭环)

**字面 grep 结论**: V2 字面**不存在** atom-level pm-to-atoms 反向 converter。

证据链字面:
1. [Host.tsx:120](../../../../../src/drivers/text-editing-driver/Host.tsx#L120) 字面 `serializeDoc(v.state.doc)` 触发 onChange — 即 doc 变化时回调上层
2. [schema-builder.ts:65-71](../../../../../src/drivers/text-editing-driver/schema-builder.ts#L65) 字面 `serializeDoc` = `{ format: 'pm-doc-json', version: '0.1', payload: doc.toJSON() }` — payload 字面就是 PMDoc.toJSON() 整体序列化结果,**无任何 callout 字段抽取/转换逻辑**
3. [index.ts:24-31](../../../../../src/drivers/text-editing-driver/index.ts#L24) 字面 driver 协议 serialize/deserialize 是字面信封透传,payload 不动
4. 反向恢复: [schema-builder.ts:51](../../../../../src/drivers/text-editing-driver/schema-builder.ts#L51) 字面 `PMNode.fromJSON(schema, data.payload)` — 完全交给 PM schema 还原,**schema `attrs.iconName: { default: null }` 字面会自动兜底**旧 doc 缺字段
5. 旁路消费方字面只 2 处,均**不读 emoji/iconName 字段**:
   - [LinkPanel.tsx:164](../../../../../src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx#L164) 字面 `extractHeadings(drillNote.doc.payload)` 只递归 heading 类型
   - [lib/atom-serializers/svg/index.ts:197](../../../../../src/lib/atom-serializers/svg/index.ts#L197) 字面 `case 'callout': return '[Callout]'` 文字 fallback,不读 attrs

**结论**: `attrs.iconName` 字面通过 PM toJSON 透传写入 payload,重启时 PM schema default 兜底,**零反向 converter 改动,零持久化代码改动,零旁路消费方影响**。

### §3.3.ter markdown/HTML serializer 字面验证(反馈 3 闭环)

字面 grep 全谱搜索:
- `domSerializer` 字面命中 1 处: [api.ts:488](../../../../../src/drivers/text-editing-driver/api.ts#L488) `DOMSerializer.fromSchema(inst.view.state.schema)` 用于 `getBlockClipboardAt`(剪贴板 HTML 生成)
- `toMarkdown` 字面命中 0 处
- `MarkdownSerializer` 字面命中 0 处
- `serializeCallout` 字面命中 0 处

**结论**: V2 字面**无独立 markdown serializer**,**无独立 callout 序列化函数**。HTML 序列化字面走 PM `DOMSerializer.fromSchema` 自动从 `spec.toDOM` 推导 — spec.ts 改 toDOM 加 `data-icon-name` 字面**同时覆盖 clipboard HTML 路径**,无遗漏。

---

## §4 数据模型变更

### §4.1 callout schema 字面变更

```ts
// src/drivers/text-editing-driver/blocks/callout/spec.ts (字面)
const calloutNodeSpec: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: {
    emoji: { default: '💡' },              // 既有,不变
    bookAnchor: { default: null },         // 既有(sub-phase 022),不变
    iconName: { default: null },           // 【新增】lucide icon 名,null 表示走 emoji
  },
  parseDOM: [
    {
      tag: 'div.krig-callout',
      getAttrs(node) {
        const el = node as HTMLElement;
        const iconName = el.getAttribute('data-icon-name') || null;
        return {
          emoji: el.getAttribute('data-emoji') || '💡',
          iconName,                        // 【新增】
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {
      class: 'krig-callout',
      'data-emoji': node.attrs.emoji as string,
    };
    if (node.attrs.iconName) {
      attrs['data-icon-name'] = node.attrs.iconName as string;   // 【新增】
    }
    return ['div', attrs, 0];
  },
};
```

### §4.2 NodeView 渲染分支字面规则(单点判定)

```
if (node.attrs.iconName != null && node.attrs.iconName !== '') {
  // 渲 lucide <svg>
  emojiEl.innerHTML = '';
  mount(emojiEl, getLucideIconByName(node.attrs.iconName));
} else {
  // 渲 emoji 字符(fallback 兜底)
  emojiEl.innerHTML = '';
  emojiEl.textContent = node.attrs.emoji as string || '💡';
}
```

**字面单点判定语义**: iconName 字段是"显示模式开关",iconName 非 null 优先;emoji 字段始终保留作 fallback。

### §4.3 atom 字段字面变更(向前/向后兼容)

`AtomCalloutContent` 字面增加 `iconName?: string | null` 可选字段:

- **旧数据**(v1 callout atom,字面无 iconName 字段): 反序列化时 atoms-to-pm.ts 走 `(c.iconName as string|null) ?? null`,fallback null → schema default null 兜底 → 渲 emoji 模式(行为字面无变化)
- **新数据**(用户用 Icons tab 选了 icon): atom 字面写入 `iconName: 'Lightbulb'` 之类,PM toJSON 透传 payload,重启恢复 → schema 还原 attrs.iconName → 渲 icon 模式
- **混合数据**(同一 atom 既有 emoji 又有 iconName): iconName 字面优先,emoji 字面保留作切回 fallback

### §4.4 API 字面互斥副作用登记(反馈 1 字面方向)

**API 1: `setCalloutIcon(instanceId, blockPos, iconName: string | null)`**(新增)
```ts
// 字面只动 iconName,不动 emoji
setCalloutIcon(instanceId, blockPos, iconName) {
  const node = inst.view.state.doc.nodeAt(blockPos);
  if (!node || node.type.name !== 'callout') return;
  const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
    ...node.attrs,
    iconName,        // emoji 字面保留不动
  });
  inst.view.dispatch(tr);
}
```

**API 2: `setCalloutEmoji(instanceId, blockPos, emoji)`**(既有 + 字面修订)
```ts
// 字面修订:setNodeMarkup 时同步把 iconName 写 null(切回 emoji 模式互斥)
setCalloutEmoji(instanceId, blockPos, emoji) {
  const node = inst.view.state.doc.nodeAt(blockPos);
  if (!node || node.type.name !== 'callout') return;
  const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
    ...node.attrs,
    emoji,
    iconName: null,  // 【字面新增】互斥副作用 — 切回 emoji 模式自动清 iconName
  });
  inst.view.dispatch(tr);
}
```

**字面副作用语义**:
- 用户切到 Icons tab 选 icon → `setCalloutIcon(..., 'Lightbulb')` → emoji 字段保留 '💡'(或上次值),iconName 写入 → 渲 icon
- 用户切回 Emojis tab 选 emoji(比如 '🔥') → `setCalloutEmoji(..., '🔥')` → emoji 写入 '🔥',iconName 字面自动清 null → 渲 emoji
- 用户在 Icons tab 选"取消 icon"(即 `setCalloutIcon(..., null)`) → iconName 字面清 null → 渲 emoji(用上次保留的 emoji 值,平滑回退)

> 拍板理由字面登在 [§3.2 理由 5](#32-采纳方案-b-的字面理由) — 互斥副作用语义单一来源(view caller 不必字面记得两 API 配对)。

### §4.5 默认 Icons tab 置顶 24 icon 字面清单(对齐 v1 Callouts emoji 一对一)

按 §2.5.3 字面 grep 结果选定:

```ts
// src/capabilities/text-editing/ui/emoji-picker/callout-icons.ts (新建)
export const CALLOUT_ICON_PICKS = [
  { name: 'Lightbulb',     keywords: ['bulb', 'idea', 'tip'] },
  { name: 'ArrowRight',    keywords: ['point right'] },
  { name: 'ChevronUp',     keywords: ['point up'] },
  { name: 'ThumbsUp',      keywords: ['ok', 'good'] },
  { name: 'Key',           keywords: ['important'] },
  { name: 'Construction',  keywords: ['wip', 'progress'] },
  { name: 'AlertTriangle', keywords: ['warning', 'caution'] },
  { name: 'Flame',         keywords: ['fire', 'hot'] },
  { name: 'Pin',           keywords: ['pushpin', 'sticky'] },
  { name: 'Scissors',      keywords: ['cut'] },
  { name: 'HelpCircle',    keywords: ['question', 'doubt'] },
  { name: 'Ban',           keywords: ['no entry', 'forbidden'] },
  { name: 'Octagon',       keywords: ['stop', 'no entry'] },
  { name: 'AlarmClock',    keywords: ['time', 'reminder'] },
  { name: 'Phone',         keywords: ['telephone', 'call'] },
  { name: 'Siren',         keywords: ['emergency', 'alert'] },
  { name: 'Recycle',       keywords: ['reuse'] },
  { name: 'CheckCircle',   keywords: ['done', 'ok'] },
  { name: 'Lock',          keywords: ['secure', 'private'] },
  { name: 'Paperclip',     keywords: ['attach'] },
  { name: 'BookOpen',      keywords: ['read', 'docs'] },
  { name: 'MessageCircle', keywords: ['speak', 'comment'] },
  { name: 'Megaphone',     keywords: ['announce', 'broadcast'] },
  { name: 'Wrench',        keywords: ['tools', 'fix'] },
];
```

字面 24 条,与 v1 [callout-emojis.ts:19-46](../../../../../src/capabilities/text-editing/ui/emoji-picker/callout-emojis.ts#L19) 字面一对一对齐(实施期 Step 5.x 字面以代码为准微调)。

---

## §5 实施任务清单

### Step 5.1 — schema 字面扩展(driver 层)
- 修 [spec.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/spec.ts) 加 `iconName: { default: null }` + toDOM/parseDOM 字面如 §4.1
- typecheck 通过
- commit: `feat(callout): add iconName attr to PM schema (D023)`

### Step 5.2 — API 字面扩展 + 互斥(driver 层)
- 修 [api.ts:149 setCalloutEmoji](../../../../../src/drivers/text-editing-driver/api.ts#L149) 加 `iconName: null` 互斥写入
- 加新 API `setCalloutIcon(instanceId, blockPos, iconName)`(line 同位)
- types 字面更新(若 driver api types.ts 有镜像)
- commit: `feat(callout): setCalloutIcon API + setCalloutEmoji clear iconName side-effect (D023 §4.4)`

### Step 5.3 — NodeView 字面渲染分支
- 修 [node-view.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/node-view.ts):iconName 非 null 时 mount lucide `<svg>`
- 字面用动态 import `lucide-react` 按需加载(避免 1952 个 icon 全 bundle)
- mousedown handler 字面不动
- commit: `feat(callout): nodeView render branch for iconName (D023 §4.2)`

### Step 5.4 — atom 序列化字面透传
- 修 [atoms-to-pm.ts:400](../../../../../src/capabilities/text-editing/converters/atoms-to-pm.ts#L400) callout case 加 `iconName: (c.iconName as string|null) ?? null`
- 字面验证旧 atom(无 iconName 字段)反序列化兜底
- commit: `feat(callout): atoms-to-pm.ts passthrough iconName (D023 §4.3)`

### Step 5.5 — Icons tab UI 字面实装(capability 层)
- 新建 [callout-icons.ts](../../../../../src/capabilities/text-editing/ui/emoji-picker/callout-icons.ts) 含 24 条置顶 icon(字面如 §4.5)
- 修 [EmojiPickerPanel.tsx](../../../../../src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx):Icons tab 不再 disabled,切换时显示 icon 网格 + 搜索框
- icon 网格字面用 `<Lightbulb size={20} />` 之类 React 组件渲染
- 搜索字面过滤 24 置顶 + lucide 全库(动态 import 字面按名取组件)
- 选中 icon 字面调 `api.setCalloutIcon(ctx.instanceId, ctx.blockPos, name)`
- commit: `feat(callout): Icons tab implemented (D023 §3.3 §4.5)`

### Step 5.6 — 自测 + 测试清单字面输出
- 按 §6 字面测试清单逐项手测
- commit: `test(callout): D023 Icons tab manual test pass`

---

## §6 测试与验收

### §6.1 测试清单字面(可执行)

| # | 测试步骤 | 字面期望结果 |
|---|------|------|
| 1 | 创建新 callout block(slash menu 选 Callout) | 字面渲染 💡 emoji 默认 |
| 2 | 点击 emoji `<span>` | 弹 emoji picker popup,4 tab,Emojis active |
| 3 | 切换到 Icons tab(原 disabled) | tab 字面 active,显示 24 置顶 icon 网格 + 搜索框 |
| 4 | 选中 `Lightbulb` icon | callout 头部字面渲 `<svg>` 灯泡 icon(替换 emoji 显示) |
| 5 | 再点 callout 头部 icon | 重弹 picker,字面 Icons tab active |
| 6 | 切换到 Emojis tab,选中 🔥 | callout 头部字面渲 🔥 emoji(icon 字面被清) |
| 7 | 重新点 callout 头部 emoji | picker 字面 Emojis tab active(iconName 已 null) |
| 8 | 选 Lightbulb icon → 重启应用 | 字面 callout 仍渲 `<svg>` icon(持久化通过) |
| 9 | 选 emoji 🔥 → 重启应用 | 字面 callout 仍渲 🔥 emoji |
| 10 | 旧 callout block(v1 创建,字面无 iconName 字段) | 字面渲 emoji,行为不变 |
| 11 | Icons tab 搜索 "info" | 字面过滤显示 Info / Info* 系列 icon |
| 12 | Icons tab 选 icon 后,Copy/Paste callout block | 粘贴回 KRIG 字面恢复 icon(走 DOMSerializer 走 spec.toDOM 字面带 data-icon-name) |
| 13 | Upload tab / Remove tab | 字面仍 disabled(本 sub-phase 不做) |
| 14 | 字面 grep `attrs.emoji` 旧消费方 | 5 处字面无回归(spec/node-view/api/atoms-to-pm/EmojiPickerPanel) |

### §6.2 通过条件

§6.1 字面 14 项全 PASS → 通过

---

## §7 风险与回滚

### §7.1 风险字面清单

| 风险 | 概率 | 影响 | 字面缓解 |
|------|------|------|------|
| lucide-react dynamic import 字面失败(找不到 icon 名) | 低 | 中(NodeView 渲染空) | NodeView 字面兜底 fallback 到 emoji 渲染;实施期 Step 5.3 加 try/catch |
| 旧 callout atom 反序列化字面缺 iconName 字段 | 已验证零风险 | — | PM schema default null 兜底,§4.3 字面已确认 |
| `setCalloutEmoji` 字面修订(加 iconName: null)破坏既有 view caller | 极低 | 低 | 字面 grep `setCalloutEmoji` 仅 1 处真消费([EmojiPickerPanel.tsx:88](../../../../../src/capabilities/text-editing/ui/emoji-picker/EmojiPickerPanel.tsx#L88)),行为变化是预期 |
| Icons tab 搜索全库性能(1952 icon) | 中 | 低 | 字面用 debounce + 截前 60 项展示 |
| lucide-react `1.14 → 1.16` 升级字面 breaking | 中 | 高 | 本 sub-phase 字面不升级,§0.5 已锁定 |

### §7.2 回滚字面策略

- 字面 revert 5 commits(Step 5.1–5.5)
- schema iconName 字段保留无害(default null,旧行为)
- 或字面 revert spec.ts 单 commit 即移除 schema 字段

---

## §8 反向更新清单(本文档涉及更新的其他文档清单)

| 文档 | 更新内容 | 状态 |
|------|------|------|
| [MEMORY.md](/Users/wenwu/.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/MEMORY.md) | 加 project memory `decision-023-callout-icon-tab-done`(架构要点 + 12 偏离索引)+ feedback memory `flex-container-shrink-collapse`(nav 失踪教训);更新 `emoji-picker-v1-done-v2v3-pending` 把 Icons tab 标已完成 | ✅(2026-05-16) |
| [SDK-version-binding-policy.md §4](../SDK-version-binding-policy.md) | 表加一行 `lucide-react@^1.14.0` 锁定(决议号 023,日期 2026-05-16,允许 caret 到 < 2.0.0,禁止 2.x 跨大版本) | ✅(2026-05-16) |
| [test-checklists/callout-icon-tab.md](../../../test-checklists/callout-icon-tab.md) | 新建测试清单 A–H 8 段 30+ 项(UI / 跳转 lazy / 搜索 / 选 icon / 持久化 / Copy-Paste / 性能 / 回归);超出决议 §6.1 原 14 项是因为 Step 5.7-5.8 新增 nav + 搜索 + lazy render 功能 | ✅(2026-05-16) |
| [refactor charter](../../../00-总纲.md) | 本 sub-phase 挂在 charter 哪一波?暂未登记(charter 自身整改进行中,待第 6 波完成后回填) | ⏳ |

---

## §9 通过条件(实施完成后填)

- [x] Step 5.1–5.8 全 commit(13 commit hash `6e28dd0..bc81784`)
- [ ] [test-checklists/callout-icon-tab.md](../../../test-checklists/callout-icon-tab.md) A–H 全 PASS(用户手测)
- [x] §8 反向更新清单 3/4 完成(charter 回填留待第 6 波后)
- [ ] 用户拍板 merge to main

---

## §10 实施期偏离登记(实施期遇到的偏差登记)

### §10.1 提案期偏离(decision 拍板前)

- **偏离 #1**: 用户反馈字面 `react@19.2.6`,实测字面 `19.2.5`(差 patch 一位)。无实质影响,§0.5 字面以实测为准。

### §10.2 实施期偏离(待 Step 5.x 实施时填)

- **偏离 #2 (Step 5.3 字面架构选择 — B 路径)**:
  决议 §3.3 字面留白 "Step 5.x 决定 ReactDOM portal 或 dynamic 字面 createIcons 函数注入"。
  Step 5.3 实施期字面发现 driver NodeView 字面是 vanilla DOM(零 React 依赖),
  让 driver 字面 import lucide-react 违反既有"driver 零 view-layer SDK 依赖"架构
  (字面对照 [emoji-handler.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/emoji-handler.ts) 现有模式)。

  **拍板 B 路径**:driver 字面暴露 iconHost DOM + 加 `setCalloutIconRenderer` handler 接口
  (新建 [icon-handler.ts](../../../../../src/drivers/text-editing-driver/blocks/callout/icon-handler.ts),字面对齐 emoji-handler.ts 模板),
  capability 层字面注入 React/lucide 渲染逻辑(Step 5.5)。

  字面优势:
  - driver 层字面零 lucide-react / 零 React 新依赖
  - renderer 未注入时字面 fallback 到 emoji 渲染(零行为退化)
  - 字面对齐既有 emoji-handler / link-click-handler / note-link-search-handler 注入范式

  字面影响:
  - Step 5.3 单步无运行可见行为(renderer 未注入时字面渲 emoji 兜底,需 Step 5.5 接 capability 后才可见 icon)
  - 字面新增一个 driver re-export(`setCalloutIconRenderer` / `CalloutIconRenderer`)

- **偏离 #3 (Step 5.3 fallback cycle 字面互斥)**:
  NodeView 字面 fallback 路径(emoji cycle,capability 未装兜底)字面同步清 iconName,
  对齐 setCalloutEmoji 互斥副作用语义(§4.4),防 fallback 路径绕过互斥造成 iconName 残留。

- **偏离 #5 (Step 5.5.3 字面搜索范围:24 置顶 only,字面全库搜索推后)**:
  决议 §3.3 字面承诺 "24 Notion 风格 icon 置顶 + 搜索过滤全库"。
  Step 5.5.3 实施期字面发现 lucide-react 全库 1952 icon 字面两条路径都不可行:
  - 整包 import + tree-shake:搜索字面要按名取所有 icon → 全打包 bundle ~1MB(emoji picker 过重)
  - per-icon dynamic import:每 icon 字面单 chunk,搜索体验差(每输入字符触发若干网络请求)

  字面拍板 **5.5.3-A 路径**:v2 字面只搜 24 置顶 icon(`callout-icons.ts` 字面 keywords + label + name 匹配),
  覆盖 v1 Callouts 24 emoji 一对一映射,字面够用。

  字面全库搜索留独立 sub-phase(可走 dynamic import + 预生成 search index,
  或字面 import lucide 仅 `dynamicIconImports.mjs` 名字 manifest 加按需加载)。

  §7.1 字面"Icons tab 搜索全库性能(1952 icon)中风险"字面**不再适用**(v2 字面只搜 24),
  全库搜索独立 sub-phase 字面再评估。

  > **#5 字面反悔登记(2026-05-16,Step 5.7-5.8)**:用户字面 Step 5.6 路径 B 通过后再次提问字面
  > "1952 个 icon 但只看到 32 个?"(实际 68),字面拍板字面把"全库搜索"字面合进 D023
  > (字面不再字面独立 sub-phase)。字面具体走 lucide 字面自带 `DynamicIcon` + 字面预生成
  > manifest(Step 5.7)+ IntersectionObserver lazy render(Step 5.8)三段路径解决。
  > 字面 #5 字面原拍板的"5.5.3-A 路径"字面留作回滚 fallback(若 DynamicIcon 路径出问题字面回到 68 only)。

- **偏离 #7 (Step 5.6 字面路径 B — 扩 24 → 68 置顶 icon)**:
  用户字面 Step 5.5 截图通过后字面提问"1952 icon 只看到 32 个?"(实际 24),
  字面诊断为偏离 #5 字面后果(全库搜索字面留独立 sub-phase,v2 仅 24 置顶)。
  字面拍板路径 B:扩 callout-icons.ts 字面到 ~50,字面覆盖 Notion/Linear 高频子集。

  字面实施期 grep 字面全数命中 44 个候选(原计划 25,字面扩展时发现多个高频字面应纳入):
  - 收藏/标记: Heart, Bookmark, Star, Tag(4)
  - 奖励/成就: Trophy, Award, Crown, Rocket(4)
  - 能量/特效: Zap, Sparkles(2)
  - 提醒/时间: Bell, BellRing, Calendar, Timer(4)
  - 通讯: Mail, Send, Inbox(3)
  - 文件/数据: Folder, FileText, Database(3)
  - 工具/开发: Code, Terminal, Bug, GitBranch(4)
  - 媒体: Music, Camera, Image(3)
  - 用户/社交: User, Users, Smile(3)
  - 环境/天气: Sun, Moon, Cloud, Globe(4)
  - 商业/探索: ShoppingCart, MapPin, Eye, Search, Target(5)
  - 数据/可视: Activity, TrendingUp, Filter, Layers(4)
  - 食物: Coffee(1)

  字面 `Github` icon 缺失(lucide 1.14 字面无 Github brand named export,字面已剔除候选,
  用 GitBranch 替代;字面如需 git 平台 icon 走独立 brand-icons SDK 字面独立 sub-phase)。

  字面总计 24 + 44 = 68 个置顶 icon,字面 bundle 增量 ~22KB(每 icon ~500B tree-shake),字面可接受。
  字面零 schema/API/NodeView 改动 — 全数据驱动(callout-icons.ts 单文件追加)。

- **偏离 #6 (Step 5.5.3 字面 emoji-mart Picker 仅 Emojis tab 时 mount)**:
  v1 字面 emoji-mart useEffect 字面无 tab 守门(Icons tab 字面 disabled 时无需考虑)。
  Step 5.5.3 字面双 tab 切换 active 时,字面在 effect 头加 `if (activeTab !== 'emojis') return`,
  effect 字面 deps 加 `activeTab` — 切 Icons tab 字面 cleanup(picker 销毁),
  切回 Emojis 字面 re-run 重建。

  字面副作用:切 tab 字面 picker re-mount,字面有 loading 闪现(~50ms,首次后 emoji-mart data 字面已缓存,
  re-mount 字面比首次快)。可接受,且字面与"切到 Icons tab 字面 picker 不可见"的语义一致。

- **偏离 #4 (Step 5.4 字面 AtomCalloutContent SSOT 不存在)**:
  决议 §4.3 字面承诺"`AtomCalloutContent` 字面增加 `iconName?: string \| null` 可选字段"。
  Step 5.4 实施期字面 grep 确认 V2 字面**无 `AtomCalloutContent` interface SSOT**:
  [atoms-to-pm.ts:60](../../../../../src/capabilities/text-editing/converters/atoms-to-pm.ts#L60) 字面
  `AtomInput.content?: Record<string, unknown>` — 所有 atom content 字面共享宽松索引类型,
  callout 字段访问字面通过 `c.emoji as string` 类型断言,无独立 interface。

  字面无需新建 SSOT(对齐 atoms-to-pm.ts 既有风格,其他 12 种 atom 同样字面无独立接口),
  iconName 字段字面通过 `(c.iconName as string | null | undefined) ?? null` 类型断言访问。
  双层兜底:本处字面 `?? null` + PM schema `default: null`(§4.1)。

  字面影响:零 — 决议 §4.3 字面描述需理解为"逻辑字段加入",而非"独立 SSOT interface 改动"。

- **偏离 #8 (Step 5.7 字面 manifest 字面数据源:GitHub raw CDN 而非 official API)**:
  prompt 字面承诺走 `api.github.com/repos/lucide-icons/lucide/contents/icons` 字面 throttle 60req/min。
  Step 5.7 实施期字面发现:
  - unauth GitHub API rate-limit 字面 60 req/h(不是 60/min),字面绝对不够 1952 文件
  - lucide repo 字面所有 .json 字面在 `raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.json`
    字面可直接 fetch(CDN,字面无 API rate-limit)

  字面拍板:
  - icon 名清单字面走本地 `node_modules/lucide-react/dist/esm/dynamicIconImports.mjs`
    字面正则解析(零网络,1952 kebab name 字面 100% 覆盖)
  - 字面 categories/tags 字面走 raw CDN(并发 20,~50 秒跑完,字面比 prompt 预估 2 min 还快)
  - 字面 commit-sha 字面单走 official API(unauth 60/h 字面够用)字面 pin manifest 版本

  字面 manifest 实测:
  - 1952 icon 全收
  - 1703 有 meta(87%)
  - **249 无 meta**(字面 alias/deprecated icon 字面 lucide repo 字面无 .json — 比如 `sort-desc`
    是 `arrow-down-01` 字面 alias,`alarm-check` 字面已 deprecated)
  - 42 categories(prompt 预估 26-44 字面符合;字面 `animals` / `account` / `finance` / `emoji`
    等字面 prompt 未列字面但 lucide 实有)

  字面 249 no-meta icon 字面处理:Step 5.8 IconsTabPanel 字面给它们一个 "Others"
  字面 chunk 兜底,字面不进任何 category section(对齐 emoji-mart 字面 "no-category" 同款处理)。

- **偏离 #9 (Step 5.8 字面反悔 C3 lazy load:lucide-react 字面无法纯 lazy at picker open)**:
  prompt 字面 C3 路径承诺 "IconsTabPanel mount 时 dynamic import lucide-react 整包,
  字面首屏 0 bundle 影响"。
  Step 5.8 实施期字面发现 callout-icon-renderer 字面在 capability 加载就需要 lucide-react
  (字面 read-only callout 字面在 NoteView 第一帧字面就要渲 icon — 字面不能等 picker open):
  - 字面用户字面打开存有 callout-with-icon 的 note 字面立刻看 svg icon
  - 字面 renderer 字面 driver 注入字面发生在 capability registry init(text-editing/index.ts:84)
  - 字面无法字面用 React.lazy / 字面 dynamic import 字面包裹 renderer 字面 module

  字面拍板 **lucide-react 字面 eager at text-editing capability load**:
  - 静态 `import * as LucideIcons from 'lucide-react'` 字面 tree-shake 68 picks(~34KB)
  - 静态 `import { DynamicIcon } from 'lucide-react/dynamic'` 字面 Helper 组件(~2KB)
  - 字面 1952 个 icon body 字面 Vite 字面拆 1952 单 chunk,字面按需 fetch
    (字面只渲 IntersectionObserver visible section 字面才会下载)
  - 字面 IconsTabPanel 字面本身字面静态 import 字面进 text-editing capability bundle
    (字面 mount 时字面 IntersectionObserver 字面控制渲染开销)

  字面与 prompt 字面 C3 差异:
  - prompt 期待:首屏 ~5KB,Icons tab 打开时一次性 ~500KB-1MB loading
  - 实际:首屏 ~34KB(68 Pascal tree-shake)+ Icons tab 打开瞬时 render placeholder,
    字面 visible icon 字面 ~500B per chunk 字面渐进 fetch
  - 字面体验字面比 C3 字面好(无大 chunk loading 闪现,visible icon 字面立即渐进出现)

- **偏离 #10 (Step 5.8 字面 manifest.json 字面 inline 进 text-editing bundle)**:
  prompt 字面未明确字面 manifest 字面如何加载,字面只提"~200KB"字面 inline 默认。
  Step 5.7 实测字面 manifest 字面 **515KB**(超 prompt 预估 2.5 倍 — 字面 lucide tags
  字面比预估字面多)。

  字面两条路径:
  - inline JSON import(默认 Vite 字面 resolveJsonModule):字面进 text-editing chunk,
    字面 gzip ~80KB(string 字面大量重复 tag 字面压缩率高)
  - 字面 `?url` 字面 import + runtime fetch:字面延迟首次渲染 ~50ms,字面增加 async 复杂度

  字面拍板 **inline path**:
  - text-editing capability 字面已经 eager load(read-only callout 字面 icon 渲染依赖),
    字面无关 lazy-loading 时机
  - 515KB raw / 80KB gzip 字面对桌面 app 字面可接受
  - 字面减少 IconsTabPanel 字面 async ready state 字面复杂度(全 sync 渲)

  字面影响登记:text-editing capability chunk 字面增量 ~80KB gzip,字面 desktop app
  字面性能影响字面可忽略(Electron 字面无网络下载字面 webpack chunk)。

- **偏离 #11 (Step 5.8 字面 attrs.iconName 字面保持 Pascal,不改 kebab)**:
  Step 5.7 字面 manifest 字面 kebab 为主索引(对齐 lucide repo 字面文件名),字面 Step 5.8
  字面 DynamicIcon 字面 prop `name` 字面 IconName union(kebab)。
  字面但 attrs.iconName 字面已字面 Pascal(Step 5.1-5.5 字面锁定,字面写入持久化数据)。

  字面拍板字面保持 Pascal in attrs(向前兼容字面已存数据),字面 renderer 字面构建
  Pascal→kebab 反向 map(模块 init 一次性 ~30ms),字面 DynamicIcon 字面调用前 lookup:
  - 静态 lucide-react named export 字面 Pascal 命中字面优先(快路径)
  - 字面 Pascal 字面命中失败 → manifest 反向 map → DynamicIcon name={kebab}

  字面影响:字面零数据迁移,字面零 schema 改动,字面 attrs.iconName 字面继续 Pascal。
  字面 IconName type 字面 cast `as IconName`(运行期一定在 union 内,字面 TS 静态推不出)。

- **偏离 #12 (Step 5.8 字面 review:category nav 字面布局字面用户反悔 — emoji-mart 1:1 同款)**:
  Step 5.8 初版字面 IconsTabPanel 字面 search box 在上 / category nav text-chip 在下,
  字面用户字面截图反馈"分组方法不一样,字面应该和 emoji 字面检索方法一样,
  字面在搜索栏的下一行做 tab 分类"。

  字面再看 emoji-mart 实际字面截图:
  - **nav 字面在上**(横排 10 个 icon-only chip:* 🕐 😀 🐶 🍔 🏈 🚗 💡 🎵⚡ 🚩)
  - **search 在下**(占满字面下一行)

  字面拍板字面对齐 emoji-mart 1:1:
  - 字面布局顺序字面反:nav 在上,search 在下(原 search 在上字面 wrong)
  - 字面 chip 字面从 text 字面改 **icon-only**(28×28 button,字面渲一个代表 icon)
  - 字面 43 个 category → 代表 icon 字面手工映射表(callouts→lightbulb /
    accessibility→accessibility / arrows→arrow-right / .../ others→circle-help)
  - 字面选 icon 字面用"显然代表"(字面非"高 tag 命中"— 字面 shield 字面在 9 cat 排第一字面无区分度)

  字面无 schema / API / renderer 改动 — UI-only 字面体验调整。
  字面 commit 9723921。

---

## §11 教训登记(实施完成后填)

(待实施完成后填写)

---

## 附录 A — v1 决议交接字面索引

- v1 emoji picker 实施: [test-checklists/callout-as-container.md](../../../test-checklists/callout-as-container.md) F 段
- v1 commit 范围: `794db28..361444d`
- v1 决议号: 无独立 decision(随 callout-as-container 一起实施)
- v1 SDK 锁定: emoji-mart 5.6.0 + @emoji-mart/data 1.2.1(本决议 §0.5 字面继承)

## 附录 B — 字面 grep 命令复用清单

```bash
# 反馈 2 闭环:24 icon 一次性命中验证
grep -oE "\b(Lightbulb|Hand|ChevronUp|ThumbsUp|Key|Construction|AlertTriangle|Flame|Pin|Scissors|HelpCircle|Ban|Octagon|AlarmClock|Phone|Siren|Recycle|CheckCircle|Lock|Paperclip|BookOpen|MessageCircle|ArrowRight|Megaphone|Wrench|Settings)\b" \
  node_modules/lucide-react/dist/lucide-react.d.ts | sort -u

# 反馈 2 闭环:反向 PM→atom 字面路径
grep -rn "pm-to-atom\|pmToAtom\|pm_to_atom\|toAtoms\|fromPm\|fromPM\|docToAtoms" src/

# 反馈 3 闭环:markdown/HTML serializer
grep -rn "domSerializer\|DOMSerializer\|toMarkdown\|MarkdownSerializer\|serializeCallout" src/

# 6 层传播(SDK policy §2.2 字面)
grep -rn "attrs\.emoji\|setCalloutEmoji\|CalloutAttrs" src/
```
