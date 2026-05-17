# 任务:inline code block 接入 CodeMirror 6 capability

> 状态:**调研 / 决议 / 实施拆分**(2026-05-17 起草,等用户拍板后开 `feature/code-block-cm6` 分支动手)
>
> 前置 PR:`refactor/sdk-to-capability` 已合 main(merge 64eefbe),引入 [code-editing capability](../../src/capabilities/code-editing/) + [graph-layout capability](../../src/capabilities/graph-layout/)。本次 PR 是其下游消费者。

## 目标

让 NoteView 内的 codeBlock 从"空 `<pre><code>`、无任何 UI"升级为:

| 维度 | inline(NoteView 内) | 全屏(L2 FullscreenOverlay) |
|------|---------------------|----------------------------|
| 设计哲学 | **Notion 风格**:所见即所得,文本编辑走 PM 不打断阅读流 | **成熟 CM6 风格**:行号 / 高亮 / Tab 缩进 / defaultKeymap |
| 编辑器 | PM contentDOM(`<code>` 内文本节点) | code-editing capability 的 CodeHost(CMView) |
| 语法高亮 | **CodeMirror StreamLanguage tokenize + Decoration.inline overlay**(不换 editor) | CM6 内置 syntaxHighlighting |
| 语言切换 UI | block 右上角轻量 dropdown(参考 V1 [code-block.ts:149-220](https://github.com/.../v1)) | 全屏 toolbar 左上角 select |
| 复制按钮 | toolbar 内,hover 显示 | toolbar 内,常驻 |
| 行号 | ❌ 不做 | ✅ Phase 1A 默认开 |
| Mermaid preview | 现状保留(toolbar 切换 split/preview) | 现状保留(右侧 preview pane) |
| 触发入口 | 已有 ` ``` ` input rule + slash → 本次加"选语言"步骤 | 现有 mermaid 全屏按钮抽象为通用 code 全屏按钮 |

完成后:
- 用户在 note 内打 ` ``` ` 直接得到带语言下拉的 code block(默认 plain text)
- inline 编辑保持 PM 原生(光标 / IME / 复制粘贴 / undo / 多 block 选区都正常)
- 鼠标移到 code block 上 toolbar 显示:`[Language ∨] [Copy] [Fullscreen]`
- 点 [Fullscreen] 进 L2 overlay,等同 mermaid 全屏体验(CodeHost + toolbar)
- 6 内置语言:JS / TS / Python / JSON / Markdown / Mermaid;mermaid 仍走原 preview 路径

## 背景

### V1 现状(参考实现,**已完成的功能**)

V1 已经做完了 inline code block 的 dropdown + 复制 + lang plugin 框架,**609 行**:

- 文件:[/Users/wenwu/Documents/VPN-Server/KRIG-Note/src/plugins/note/blocks/code-block.ts](file:///Users/wenwu/Documents/VPN-Server/KRIG-Note/src/plugins/note/blocks/code-block.ts)
- L149-220:`langBtn` toolbar 按钮 + dropdown(支持 search + ✓ checkmark + 当前语言显示)
- L267-287:Preview 按钮(mermaid split/preview toggle + 其他语言的 inline preview 切换)
- L291-298:Copy 按钮(成功后 1.5s 绿色反馈)
- L494-511:MutationObserver 监听 `<code>.textContent` 变化,触发插件 onUpdate(实时高亮 / 预览)
- L532-535:`ignoreMutation(m) { return !code.contains(m.target) }` — toolbar/dropdown DOM 变化不让 PM 重渲(关键设计)
- 插件目录 [code-plugins/](file:///Users/wenwu/Documents/VPN-Server/KRIG-Note/src/plugins/note/blocks/code-plugins/):
  - default-plugin.ts / html-plugin.ts / js-plugin.ts / markdown-plugin.ts / mermaid-plugin.ts / mermaid-fullscreen.ts
  - types.ts 定义 `LanguagePlugin` 接口
  - registry.ts 注册中心
- **V1 没做行号**(`lineNumbers` 从 CM6 import 了但没用,L3)

### V1 → V2 砍法

V2 把 V1 的 609 行砍到 **231 行**,只保留:
- `buildPlainCodeBlockView`(45-63):空 `<pre><code>` 无任何 UI
- `buildMermaidCodeBlockView`(66-224):mermaid 专用 toolbar + preview + 全屏

V1 砍掉的部分**不是因为不要,是为了分阶段**:
- 第一阶段(已合 main)落 mermaid 全屏(`refactor/sdk-to-capability`)
- 第二阶段(本任务)恢复 V1 的 inline lang dropdown + 复制 + lang plugin 框架,**capability 化**重写

### V2 现状(本任务起点)

| 文件 | LOC | 现状 |
|------|-----|------|
| [src/drivers/text-editing-driver/blocks/code-block/spec.ts](../../src/drivers/text-editing-driver/blocks/code-block/spec.ts) | 52 | `code: true`,attrs `{ language, bookAnchor }`,parseDOM 支持 `<pre>`,toDOM 输出 `<pre class="krig-code-block"><code class="language-X">` |
| [.../node-view.ts](../../src/drivers/text-editing-driver/blocks/code-block/node-view.ts) | 231 | `buildPlainCodeBlockView`(空)+ `buildMermaidCodeBlockView`(完整) |
| [.../mermaid-renderer.ts](../../src/drivers/text-editing-driver/blocks/code-block/mermaid-renderer.ts) | 109 | 通过 `requireCapabilityApi('graph-layout').getMermaidElkLoader()` 拿 ELK loader(Phase 2 重构) |
| [.../fullscreen/](../../src/drivers/text-editing-driver/blocks/code-block/fullscreen/) | 4 文件 | mermaid 全屏 panel + toolbar + preview + menu-context |
| [src/capabilities/code-editing/](../../src/capabilities/code-editing/) | 14 文件 | Phase 1A 落地:Host + 6 语言 + dark theme + registry |
| [.../plugins/build-input-rules.ts:179](../../src/drivers/text-editing-driver/plugins/build-input-rules.ts) | — | ` ``` ` 触发空 codeBlock(`language: ''`,无起步语言) |
| [src/capabilities/text-editing/commands/register-pm-commands.ts:156](../../src/capabilities/text-editing/commands/register-pm-commands.ts) | — | `registerSlashTurn('text-editing.slash-turn-code', 'code-block')` |
| [src/drivers/.../plugins/build-vocab-highlight-plugin.ts:177](../../src/drivers/text-editing-driver/plugins/build-vocab-highlight-plugin.ts) | — | 现有 `Decoration.inline` 高亮参考实现 |

## 技术决议表

### D1 — inline 高亮技术路线

| 选项 | 描述 | 决议 |
|------|------|------|
| A | PM contentDOM + Decoration.inline 高亮 overlay(CM6 StreamLanguage tokenize) | ✅ **拍板** |
| B | block 内嵌迷你 CM6 Host(取消 contentDOM) | ❌ 拒(光标跨 block / IME / undo 合流复杂) |
| C | 不高亮,只语言下拉 + 复制 | ❌ 拒(用户期望对齐 Notion) |

**理由**:
- PM 编辑层不变,光标 / 选区 / IME / undo / 多 block 选区 / 跨 block 复制粘贴全部原生
- CM6 StreamLanguage 复用 capability 已注册的 6 个 loader,免重新封装
- Decoration.inline V2 已有 [vocab-highlight](../../src/drivers/text-editing-driver/plugins/build-vocab-highlight-plugin.ts:177) 在用,模式成熟
- code:true 节点不冲突(PM 不对 code 内部应用 marks,Decoration 走独立通道)

### D2 — Decoration 范围:plugin 还是 NodeView 局部

| 选项 | 描述 | 决议 |
|------|------|------|
| A | 一个全局 PMPlugin 扫整个 doc 找所有 codeBlock 计算高亮 | 候选 |
| B | NodeView 内部 update() 时手工 rebuild `<code>` 内 span(不走 Decoration) | 候选 |
| C | NodeView 持有一个 `DecorationSet`,update() 时 diff 增量更新,通过 plugin 注入 view-side decorations | ❌ 拒(过度设计) |

**拍板**:**A(全局 plugin)**,理由:
- vocab-highlight 已是同型(全局 plugin 扫词表)
- doc 内 codeBlock 数量不多(实测 50+ block 没问题);plugin 只在 docChanged + 落在 codeBlock 内时重算
- B 方案手工 rebuild `<code>` 内 DOM 会和 PM contentDOM 抢主导权(参考 V1 L494 MutationObserver 的复杂性),走 Decoration 更干净

**性能 budget**:单 codeBlock < 500 行内,高亮耗时 < 5ms(StreamLanguage 是 O(n));50 个 codeBlock 全 doc 重扫 < 250ms,在用户输入防抖 200ms 内消化。

### D3 — 语言切换 UI 位置

| 选项 | 描述 | 决议 |
|------|------|------|
| A | toolbar 右上角(hover 显示) | ✅ **拍板**(Notion 风格) |
| B | toolbar 左上角 | ❌ |
| C | 内嵌 floating label,点击展开 | ❌(过 hidden) |

**拍板**:右上角 + hover 显示(对齐 V1 toolbar 体验);常驻 toolbar 视觉过重。

### D4 — 语言切换 UI 形态

| 选项 | 描述 | 决议 |
|------|------|------|
| A | 自建 dropdown(参考 V1 L174-206:search box + list + ✓ checkmark) | ✅ **拍板** |
| B | 复用 V2 第六交互 popup-registry | 候选,但当前 popup 偏 PM 内浮层,代价高 |
| C | 原生 `<select>` | ❌(样式不可控) |

**拍板 A**,模仿 V1:简单 absolute DOM + search input + 列表;不挂 popup-registry(过设计)。

### D5 — 全屏 toolbar 语言切换

| 选项 | 描述 | 决议 |
|------|------|------|
| A | 全屏 toolbar 左上角语言 select(自建样式) | ✅ **拍板** |
| B | 不在全屏切语言,语言由 inline 传入,全屏只编辑 | ❌(用户已确认要切) |
| C | 不做全屏(只 inline) | ❌(用户已确认要做) |

### D6 — 默认语言

| 选项 | 描述 | 决议 |
|------|------|------|
| A | `language: ''`(plain text) | ✅ **拍板**(对齐 V2 现状 + V1 默认) |
| B | `language: 'javascript'`(脑回路:开发者 note 用 JS 最多) | ❌(假设用户类型) |
| C | 上次用过的语言(localStorage) | ❌(状态外溢,过设计) |

### D7 — Mermaid 兼容路径

mermaid 是 codeBlock 的 language=mermaid 特例,本次改造**不能破坏 mermaid 渲染**。

**拍板**:NodeView 内部按 `node.attrs.language` 分支:
- `=== 'mermaid'`:走现有 `buildMermaidCodeBlockView`(原状)
- `else`:走**新的** `buildGenericCodeBlockView`(本次新增,带 lang dropdown + Copy + Fullscreen + 高亮 decoration)
- 切换 mermaid ↔ 非 mermaid 时让 PM destroy 重建(update 返回 false)
- ` ``` ` input rule 默认创建 `language: ''`(plain)
- slash menu 加一个"插 mermaid block"(已有)+ 一个"插普通 code block"(已有 `slash-turn-code`)

### D8 — 全屏入口抽象

V2 当前只有 mermaid block 有"全屏"按钮(node-view.ts:L191-197 内 `btnFullscreen`)。本次扩到所有 codeBlock。

**拍板**:
- 全屏 overlay id 改成 **generic**:`text-editing.fullscreen.code`(原 `text-editing.fullscreen.mermaid` 留兼容名 redirect 到 generic)
- 通用 `CodeFullscreenPanel`(对齐 mermaid 全屏架构):
  - mount 时读 context(language + initial code + nodePos + instanceId)
  - 渲染:toolbar(语言 select + Copy + 关闭)+ CodeHost(语言传入)+ (条件)preview pane
  - 仅当 `language === 'mermaid'` 时显示 preview pane + mermaid-specific toolbar(模板下拉 / 方向切换 / 主题 / 下载)
  - 其他语言:**只编辑面板,无 preview**
- 现有 [MermaidFullscreenPanel.tsx](../../src/drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidFullscreenPanel.tsx) 重构为:**外壳 `CodeFullscreenPanel` + 子组件 `MermaidPreviewPane`**(由 language 条件渲染)

### D9 — slash menu 多步选语言?

| 选项 | 描述 | 决议 |
|------|------|------|
| A | slash → "Code" → 直接插 `language=''`,用户进 block 后通过 toolbar dropdown 切语言 | ✅ **拍板** |
| B | slash → "Code" → 弹二级菜单选语言 → 插入 | ❌(slash 当前架构不支持多步,代价高) |
| C | slash 注册 7 个独立项("Code", "Code: JS", "Code: Python" ...) | ❌(slash menu 膨胀) |

**拍板 A**,理由:
- V1 也走"先插再切"路径
- slash 多步流要改 register-pm-commands + slash plugin,改动大
- toolbar dropdown 已有,二次切语言体验 OK

### D10 — Decoration overlay 与 contentDOM 顺序

PM 渲染顺序:contentDOM 文本节点 → Decoration.inline 包裹 span(class="krig-code-syntax-token--keyword" 等)。Decoration 不修改 doc,只在 DOM 层包 span,**用户编辑时光标位置仍在 text 节点上,IME 不受影响**。

**陷阱备查**:
- `code: true` 节点 PM 不应用 mark inline parser,Decoration.inline 仍生效(走独立 view 层)
- Decoration 重算 budget:用 `mapping.maps.length` 判断 docChanged,只重扫 changed range 内的 codeBlock(增量优化,Phase 1 可先全量)

## 文件结构(规划)

```
src/drivers/text-editing-driver/blocks/code-block/
├── spec.ts                          (现有,微调)
├── node-view.ts                     (现有,新增 buildGenericCodeBlockView 分支)
├── mermaid-renderer.ts              (现有,不动)
├── save-blob.ts                     (现有,不动)
├── generic-toolbar.ts               🆕 通用 toolbar(lang dropdown + Copy + Fullscreen)
├── lang-dropdown.ts                 🆕 dropdown 实现(search + 6 语言列表 + ✓ checkmark)
└── fullscreen/
    ├── menu-context.ts              (现有,泛化:增 language 字段)
    ├── CodeFullscreenPanel.tsx      🆕 通用全屏外壳(取代 MermaidFullscreenPanel 为主)
    ├── MermaidPreviewPane.tsx       🆕 mermaid 特化的右侧 preview(从原 Panel 抽出)
    ├── MermaidFullscreenPanel.tsx   ❌ 删(逻辑迁入 CodeFullscreenPanel + MermaidPreviewPane)
    ├── MermaidPreview.tsx           (现有,保留;CodeFullscreenPanel 在 mermaid 路径下消费)
    ├── MermaidToolbar.tsx           ⚠️ 重构:mermaid-specific 部分留;通用部分(关闭 / 标题)抽到 CodeFullscreenPanel 上层
    ├── code-fullscreen.css          🆕(通用样式;mermaid-fullscreen.css 保留 mermaid-specific)
    └── mermaid-fullscreen.css       (现有,瘦身)

src/drivers/text-editing-driver/plugins/
├── build-code-syntax-highlight-plugin.ts  🆕 全局 PM Plugin,扫所有 codeBlock 调 CM6 StreamLanguage tokenize,产 Decoration.inline
└── build-block-plugins.ts                  ⚠️ 加上述 plugin 到 plugins 列表
```

**不动**:
- `src/capabilities/code-editing/` — Phase 1A 已落,本次只消费
- `src/capabilities/graph-layout/` — Phase 1B 已落,mermaid 渲染路径不动
- `register-pm-commands.ts:156` slash-turn-code — D9 拍板沿用现有命令

## 实施阶段拆分

按 [`refactor/sdk-to-capability` 三阶段](./cm6-elk-capability-refactor.md) 同思路,分独立可合的 sub-PR:

### Phase 1 — generic inline NodeView(无高亮)

**分支**:`feature/code-block-generic-nodeview`

**目标**:把"plain code block(空 pre code)"升级为"带 toolbar + lang dropdown + Copy 按钮,但暂无语法高亮"

**改动**:
- 新增 `generic-toolbar.ts` + `lang-dropdown.ts`(参考 V1 L149-220)
- `node-view.ts` 新增 `buildGenericCodeBlockView`,attrs.language !== 'mermaid' 走它
- 6 个语言来自 `requireCapabilityApi('code-editing').getLanguages()`(动态拉,不硬编)
- toolbar hover 显示(CSS,对齐 mermaid 现有体验)
- Copy 按钮:点 → `navigator.clipboard.writeText(code.textContent)` → 1.5s 绿色反馈
- Fullscreen 按钮:暂时 disable(Phase 3 启用)
- 切换语言:`setNodeMarkup(pos, null, { language: newLang })`(PM tr)
- ` ``` ` input rule 保持 `language: ''`(本期不改)

**验收**:
- 创建空 codeBlock → 看到 toolbar(hover 时)
- 点 Language ∨ → dropdown 弹出 → 选 JavaScript → `<code>` className 改为 `language-javascript`
- 点 Copy → 内容进剪贴板 + 按钮 1.5s 绿
- mermaid block 行为不变(走原 `buildMermaidCodeBlockView`)
- typecheck / lint 全绿

### Phase 2 — 语法高亮 Decoration

**分支**:`feature/code-block-syntax-highlight`

**目标**:加上 CM6 StreamLanguage 驱动的 inline 语法高亮

**改动**:
- 新增 `build-code-syntax-highlight-plugin.ts`:
  - 监听 docChanged,扫 doc 内所有 codeBlock,过滤 `language` 在 6 个内置之内的
  - 调 `requireCapabilityApi('code-editing').getLanguage(lang).loader()` 拿 StreamLanguage 实例(lazy + 缓存)
  - 用 `language.parser.parse(code)` tokenize,产 `Decoration.inline(from, to, { class: 'krig-code-syntax-token--<tag>' })`
  - return `DecorationSet`
- CSS:6 类 token color 套(参考 [host/theme-dark.ts](../../src/capabilities/code-editing/host/theme-dark.ts) 已有的色板)
- Mermaid 不参与本 plugin(它的 NodeView 自管 toolbar + preview;inline 编辑文本仍走 PM contentDOM,但**不**应用本 plugin 的 Decoration —— filter `lang !== 'mermaid'`)
- 性能:首次 docChanged 全扫;后续按 mapping 判断是否有 codeBlock 在 changed range,有才重算

**陷阱**:
- StreamLanguage tokenize API 是 stream-based(`startState` + `token(stream)`),不是一次性 parse。本 plugin 内部用 stream 迭代每行,produce token-class 数组。参考 [mermaid-lang.ts](../../src/capabilities/code-editing/languages/mermaid-lang.ts) 已有的 StreamLanguage 模式。
- code 节点内 text 必含 `\n`(`preserveWhitespace: full`),换行字符要正确处理 streamline。

**验收**:
- 写入 `language: 'javascript'` codeBlock + 贴一段 JS → keyword(function/const)显蓝,字符串显橙,注释显灰
- 切语言 → 高亮颜色对应变化
- 单 codeBlock 500 行内,高亮无明显延迟
- 切 mermaid → 没有 syntax highlight 干扰(mermaid block 显示自己的 preview,内文本仍是 plain monospace)

### Phase 3 — 通用全屏入口

**分支**:`feature/code-block-generic-fullscreen`

**目标**:把 mermaid 全屏抽成"通用 code 全屏",所有语言都能 fullscreen 编辑

**改动**:
- 新增 `CodeFullscreenPanel.tsx`:外壳 = toolbar(语言 select + Copy + 关闭)+ CodeHost(language 来自 context)+ (条件)`<MermaidPreviewPane>`
- 新增 `MermaidPreviewPane.tsx`:把 `MermaidFullscreenPanel.tsx` 中右侧 preview + mermaid-specific toolbar(模板 / 方向 / 主题 / 下载)部分抽出
- 重构 `MermaidFullscreenPanel.tsx`:删(逻辑分流到 CodeFullscreenPanel + MermaidPreviewPane)
- 改 menu-context.ts:加 `language` 字段(`MermaidFullscreenContext` → `CodeFullscreenContext`,旧导出名做 alias 短期兼容)
- generic-toolbar.ts:启用 Fullscreen 按钮,所有语言都触发 `text-editing.fullscreen.code`
- 全屏 overlay 注册改:[fullscreen-overlays.ts](../../src/capabilities/text-editing/ui/fullscreen-overlays.ts) 把 `text-editing.fullscreen.mermaid` 改成 `text-editing.fullscreen.code`(同时短期保留 mermaid 旧 id alias)

**验收**:
- 任意语言 codeBlock 点 Fullscreen → 弹出 overlay,CM6 完整体验(行号 / Tab / 高亮)
- 改完内容 × 关闭 → 写回 PM,光标回 codeBlock 内
- mermaid block 全屏 = inline 已有体验 + 右侧 preview(同 Phase 2 之前)
- Esc 关闭、× 关闭、controller.hide() 三条路径都走 lastValueRef 写回(不被 D10 / SDK cleanup 顺序坑)
- 全屏内切语言 → CodeHost 重 mount(已 capability 内部处理)+ 写回 PM 时 attrs.language 同步

## V1 参考 grep 速查表

| 功能 | V1 文件:行 | 复用 / 重写 |
|------|------------|-------------|
| toolbar HTML 结构 | [code-block.ts:139-300](file:///Users/wenwu/Documents/VPN-Server/KRIG-Note/src/plugins/note/blocks/code-block.ts) | 重写(V2 命名空间 + capability 化) |
| lang dropdown | code-block.ts:149-220 | 重写(同上;V2 用 capability.getLanguages()) |
| Copy 按钮 | code-block.ts:291-298 / 421-428 | 重写(行为可抄) |
| MutationObserver | code-block.ts:494-511 | ❌ 不用(改走 Decoration plugin) |
| ignoreMutation | code-block.ts:533-535 | ✅ 抄(toolbar/dropdown DOM 不污 PM) |
| lang plugin 框架 | code-plugins/{types,registry,index}.ts | ❌ 不要(V2 走 code-editing capability + Decoration plugin) |
| mermaid 全屏 | mermaid-fullscreen.ts | ❌ 不动(V2 已 capability 化,本次只扩抽象) |
| CM dark theme | code-block.ts:70-95 | ❌ 已迁入 [code-editing/host/theme-dark.ts](../../src/capabilities/code-editing/host/theme-dark.ts) |

## 与 mermaid 现状的兼容分析

本任务**不能破坏**已合 main 的 mermaid 全屏。兼容点:

1. **mermaid 渲染路径**:走 [mermaid-renderer.ts](../../src/drivers/text-editing-driver/blocks/code-block/mermaid-renderer.ts) + `requireCapabilityApi('graph-layout').getMermaidElkLoader()`,本次不动。
2. **mermaid inline NodeView**:`buildMermaidCodeBlockView` 不动;只在 `node-view.ts` 入口分支 `language === 'mermaid'` 时走它,否则走新的 generic view。
3. **mermaid 全屏 Component**:Phase 3 重构时,`MermaidFullscreenPanel` 删,逻辑迁到 `CodeFullscreenPanel` + `MermaidPreviewPane`。重构后**mermaid 全屏的所有功能保持等价**:工具栏 / split / 模板下拉 / 方向切换 / 主题切换 / PNG/SVG 下载 / 复制 / 缩放 / Esc 关闭 / × 关闭 / 写回 PM。
4. **mermaid Decoration filter**:Phase 2 高亮 plugin 显式 skip `language === 'mermaid'` 的 codeBlock(它自己有 preview 渲染语义,inline 编辑区文本不参与 syntax highlight)。
5. **mermaid 全屏 overlay id**:`text-editing.fullscreen.mermaid` → `text-editing.fullscreen.code`(Phase 3);registry 保留 alias 一段时间避免命令链断。

**完整回归测试清单**(每 Phase 验收时跑):
- ` ``` ` input rule → 空 plain codeBlock(language='')
- slash → Code → 同上
- 改 attrs.language='javascript' → 不破坏内容
- inline 编辑光标 / 复制粘贴 / undo / hard break / Backspace 跳出空 codeBlock → 全正常
- 插入 mermaid block → 渲染图 + toolbar 全在
- mermaid block 全屏 → 等同当前体验

## 实施约束

### 屏障守护

本任务**不**应破坏已建立的 [CM6 + ELK 单点屏障](./cm6-elk-capability-refactor.md):
- driver 层 `node-view.ts` / `generic-toolbar.ts` / `build-code-syntax-highlight-plugin.ts` 等**禁直 import** `@codemirror/*` / `@lezer/*` / `elkjs` / `@mermaid-js/layout-elk`
- 一律走 `requireCapabilityApi('code-editing')` 拿 StreamLanguage(loader 返回值传入 plugin 处理)
- ESLint 已配置(eslint.config.js Phase 2 启用的 driver 屏障)— 实施期间任何违规会编译失败

### 渐进式 — 每 Phase 独立可合

参考 [前置 PR 三阶段拆法](./cm6-elk-capability-refactor.md):
- Phase 1 合 main:用户已有 inline toolbar 体验(无高亮也能 dropdown / Copy)
- Phase 2 合 main:加高亮(可独立验证性能 + 高亮正确性)
- Phase 3 合 main:全屏抽象(单独验证 mermaid 不回归 + 其他语言全屏可用)

### 分支策略

- 主分支:`feature/code-block-cm6`(总分支,从 main 切)
- 子分支:Phase 1/2/3 各一(独立可并行 / 串行任选)
- 子分支合到主分支 → 主分支合 main(每 Phase 独立合或最后一次性合,**由用户授权决定**)

### 验收

- typecheck + lint 全绿(含 ESLint 屏障)
- npm start 启动正常,代码 / mermaid 块 inline + 全屏体验全验过
- mermaid 全屏完整功能不回归(对照前置 PR 测试清单)
- 6 内置语言每个都能切 + 看到高亮变化
- 单 codeBlock 500 行内输入不卡(< 16ms 帧)

## 不在范围内

- ❌ 行号 inline 显示(全屏有,inline 不做;Notion 也不做)
- ❌ 折叠 / 搜索 / linter / auto-complete UI
- ❌ vim / emacs keymap
- ❌ 第 7+ 语言(等用户提需求再加;capability `registerLanguage` 接口已留)
- ❌ 多步 slash menu 流(D9 拍板沿用现有命令)
- ❌ light theme(等 code-editing capability 实施 light theme 占位 → real)
- ❌ 代码块差异比对 / 历史回滚 / 自动保存
- ❌ Custom Highlight 主题切换 UI(用户级别偏好,留 settings 落地后做)

## 未来扩展(本 PR 不做,留下游 PR)

### html codeBlock 内嵌渲染框(2026-05-17 提出)

**想法**:html language 的 codeBlock 像 mermaid 一样,inline 显示"代码 + 渲染"双框
(可 split / preview-only 切换);**不再单独做 htmlBlock 节点**。

**和 D7 的关系**:这是 D7 "mermaid 是 codeBlock 特例" 思路的拓展 —— 把"特例"从单点
mermaid 泛化为"language 可挂 preview adapter",mermaid 是首批,html 是第二批。

**落地路径**(单独 PR `feature/code-block-html-preview`):

- spec 不变,`language='html'` 走新分支 `buildHtmlCodeBlockView`
- inline preview pane 用 **iframe `sandbox=""`** 渲染(完全沙箱,**不开 allow-scripts** —
  避免用户粘 `<script>` 任意执行)
- 切语言到 html ↔ 切出 html 都让 PM destroy 重建(update 返回 false,同 mermaid 现状)
- Phase 3 完成后的 `CodeFullscreenPanel` 通用外壳天然支持 `HtmlPreviewPane`(adapter 同型)
- 全屏内复用 generic toolbar(Copy / 关闭),html 特有的可选:"刷新预览 / 沙箱级别切换"

**风险点**:
- 安全:sandbox 不能开 allow-same-origin + allow-scripts 同时开(同源逃逸);默认全空
- 链接:iframe 内点链接默认替换 iframe;需要 `<base target="_blank">` 或拦截
- 资源加载:iframe 内 `<img src="local-path">` 不可达;若要支持本地资源,得走 srcdoc
  转 blob URL,这是独立子任务
- 性能:每次 source 变都重建 iframe srcdoc;实测够用即可,不需要 diff 增量

**开工前必须先讨论**:default 视图是 split 还是 preview-only?切语言到 html 自动开
preview 还是手动切?跟 mermaid 行为是否对齐?

### 通用 "language preview adapter" 抽象(html 落地后再讨论)

如果未来还有 svg / markdown(自渲染)/ latex 等带 preview 的 language,把"哪些 language
有 inline preview" 改成 capability 注册项 — code-editing capability 加 `registerPreview(lang, adapter)`,
NodeView 按 language 查 adapter 决定走 generic 还是 preview 版。当前 v1 不抽象,
mermaid / html 写死分支即可。

## 参考已有 memory

- `project_cm6_elk_capability_done` — 前置 PR 已合 main 64eefbe,capability 边界已确立
- `project_l2_fullscreen_overlay_done` — 全屏 overlay 接入模板(Phase 3 复用)
- `feedback_react_unmount_child_cleanup_order` — 全屏 Panel 嵌 CodeHost 时 lastValueRef 模式必须保留(已有 PoC 在 [MermaidFullscreenPanel:135](../../src/drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidFullscreenPanel.tsx))
- `feedback_external_sdk_lifecycle` — CM6 lazy loader 必须 await 完才能用
- `feedback_v2_is_workspace_v1_is_reference` — V2 是工作目录铁律
- `feedback_implementation_test_checklist` — 每个 Phase 给出可执行测试清单
- `feedback_strict_compliance_workflow` — 严格态全谱表,Phase 拆分纪律
- `feedback_branch_module_boundary` — 分支按模块切;Phase 1/2/3 都属于"inline code 模块",可在 `feature/code-block-cm6` 内多次 commit 不每次合 main

## 工作目录提醒

V2 工作目录:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
所有 cwd 敏感命令(git / npm / find / rm 等)每次都要显式 `cd /...V2`。

## 提交规范

- Phase 1 提交格式:`feat(code-block): inline generic NodeView + toolbar + lang dropdown + Copy(Phase 1)`
- Phase 2 提交格式:`feat(code-block): inline syntax highlight via code-editing capability(Phase 2)`
- Phase 3 提交格式:`refactor(code-block): 抽象 mermaid 全屏为通用 code 全屏(Phase 3)`
- 合 main 必须用户**显式确认**(memory `feedback_merge_requires_explicit_ok`)
- 不要 push(memory:等用户显式 push 指令)
