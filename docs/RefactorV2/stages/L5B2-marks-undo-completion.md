# L5-B2 Marks + Headings + Input-rules + 真 undo-redo + Toolbar 接入 阶段完成报告

> 阶段:L5-B2 driver 加 4 marks(bold/italic/strike/code)+ h1/h2/h3 keymap+input-rules + markdown 风格 mark input-rules + prosemirror-history 真 undo-redo + selection capability **首次真消费**(active marks/blockType) + Toolbar 接入(heading dropdown + 4 mark 按钮)
> 分支:`feature/L5B2-marks-undo`
> 完成日期:2026-05-06

---

## 1. 完成判据核对(L5-B2 设计 v0.1 § 6 — 15 条)

| # | 判据 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | npm run typecheck + lint 全过 | ✅ | 实施末通过 |
| 2 | 选中文字 Cmd+B → 加 bold(`<strong>`)/ 再按 → 撤销 bold | ✅ | 视觉 + DevTools |
| 3 | Cmd+I / Cmd+Shift+X / Cmd+E → italic / strike / code | ✅ | 键盘 |
| 4 | 输入 `**hello** ` → 自动变 bold | ✅ | 输入测试 |
| 5 | `*xx* ` → italic / `` `xx` `` → code / `~~xx~~ ` → strike | ✅ | 输入测试 |
| 6 | 行首 `# ` → h1 / `## ` → h2 / `### ` → h3 | ✅ | 输入测试 |
| 7 | Cmd+Alt+1/2/3 切 heading;Cmd+Alt+0 切 paragraph | ✅ | 键盘 |
| 8 | Toolbar 显 Heading dropdown + B/I/S/Code 4 按钮 | ✅ | 视觉 |
| 9 | Toolbar B 按钮:点 toggle bold;选区在 bold 内时蓝色高亮 | ✅ | 视觉 |
| 10 | Heading dropdown:点 H2 → 当前段变 h2;dropdown label 显 "H2" | ✅ | 视觉 |
| 11 | Cmd+Z / Cmd+Shift+Z 真撤销重做(替代 L5-A 占位 noop) | ✅ | 键盘 |
| 12 | undo/redo 不丢光标(prosemirror-history 标准) | ✅ | 键盘 |
| 13 | 多 Workspace:每 Workspace 独立 history 栈(切回不串) | ✅ | 切 Workspace |
| 14 | console `[L5] alive | view: note-view, blocks: 1, marks: 4, capabilities: 5+driver` | ✅ | 启动观察 |
| 15 | 重启 app 后 marks 内容(strong/em/s/code)正确反序列化 | ✅ | 重启 |

**总评**:**通过**(15 条全 ✅)。

---

## 2. 该阶段实施的具体内容

### 2.1 设计文档(1 篇)

| 文件 | 内容 |
|---|---|
| `docs/RefactorV2/stages/L5B2-marks-undo-design.md` v0.1 | 8 项决策(Q1-Q8 用户全推荐拍板)+ 15 完成判据 + ~955 行实施清单 + 11 项风险/开放问题 |

### 2.2 driver 内部新增 — marks 自治目录(~80 行)

`src/drivers/text-editing-driver/marks/`:

| 文件 | 行数 | 内容 |
|---|---|---|
| `README.md` | 11 | marks 目录约定(每 mark 一文件,index 收集成 MARKS dict) |
| `bold.ts` | 24 | parseDOM `strong/b/font-weight≥500` + toDOM `strong` |
| `italic.ts` | 12 | em/i/font-style |
| `strike.ts` | 13 | s/del/strike + text-decoration:line-through |
| `code.ts` | 10 | `excludes: '_'` 排他 + tag code |
| `index.ts` | 21 | MARKS 字典 + ENABLED_MARK_NAMES |

### 2.3 driver 内部新增 — plugins 子目录(~150 行)

`src/drivers/text-editing-driver/plugins/`:

| 文件 | 行数 | 职责 |
|---|---|---|
| `README.md` | 12 | plugins 装配顺序约定 |
| `build-history-plugin.ts` | 20 | history() + Mod-z/Shift-z/y keymap |
| `build-input-rules.ts` | 93 | headings(`# / ## / ### `)+ 4 mark markdown(`**xx** / *xx* / \`xx\` / ~~xx~~ `);触发字符空格;markInputRule 清 stored marks |
| `build-mark-keymap.ts` | 19 | Mod-b / Mod-i / Mod-Shift-x / Mod-e |
| `build-heading-keymap.ts` | 27 | Mod-Alt-0/1/2/3(避免 Cmd+N 冲突) |

### 2.4 driver 新增 — api.ts(~109 行)

`src/drivers/text-editing-driver/api.ts`:

view command handler 通过此路由到 driver 实例(view 不接触 PM 内部对象 — driver api 是 driver 对外契约):
- `toggleMark(instanceId, name)` — 走 `prosemirror-commands.toggleMark`
- `setHeading(instanceId, level)` — 走 `setBlockType(textBlock, { level })`
- `undo / redo(instanceId)` — 走 `prosemirror-history.undo/redo`
- `getActiveMarks(instanceId)` — 选区内激活的 marks
- `getActiveBlockType(instanceId)` — 当前 block 类型 + level
- `computeActiveMarks(state)` — 内部 helper(空选区取 storedMarks/$from.marks(),非空选区 rangeHasMark)

### 2.5 driver 升级文件(4 处)

| 文件 | 改动 |
|---|---|
| `schema-builder.ts` | `new Schema({ nodes, marks: MARKS })` — 装载 4 marks |
| `editor-view-builder.ts` | plugins 序列升级:**history 最前** → blockPlugins → input-rules → mark-keymap → heading-keymap → baseKeymap 兜底 |
| `capability-integrations/selection-source.ts` | 升级 emit:Snapshot diff(真变才 emit — 性能优化)+ 加 `activeMarks/activeBlockType/activeLevel` 字段 |
| `index.ts` | re-export `textEditingDriverApi / MarkName / ActiveBlockType` |

### 2.6 capability 层升级

| 文件 | 改动 |
|---|---|
| `src/capabilities/selection/index.ts` | SelectionPayload 加 3 字段:`activeMarks?: string[]` / `activeBlockType?: string` / `activeLevel?: number \| null`(L5-A 占位的 capability **首次真消费**) |

### 2.7 view 层升级

| 文件 | 改动 |
|---|---|
| `note-commands.ts` | 加 7 个新命令:toggle-bold/italic/strike/code + set-heading-level + undo/redo;通过 `withInstance` helper 路由(instanceId == workspaceId) |
| `toolbar-content.tsx`(新建,100 行) | 注册 6 个 Toolbar 项:Heading dropdown(Paragraph/H1/H2/H3 4 选项) + separator + B/I/S/<> 4 个 mark 按钮(activeWhen 订阅 selection capability 高亮) |
| `index.ts` | 加 `registerToolbar()` 调用 |

### 2.8 框架层升级 — Toolbar 三件套

| 文件 | 改动 |
|---|---|
| `slot/toolbar-registry/toolbar-types.ts` | ToolbarItem 重设计:加 `kind: 'button' \| 'dropdown' \| 'separator'` + `activeWhen` + `options` + `currentLabel` + `commandArg`;新增 ToolbarItemContext / DropdownOption |
| `slot/frame-bindings/ToolbarBinding.tsx` | 重写 — 支持三种 kind 渲染;订阅 selection capability;dropdown 内嵌浮层(锚 trigger 下边缘 + Esc/外部点击关闭 + onMouseDown preventDefault 不抢编辑器焦点) |
| `slot/frame-bindings/toolbar-bindings.css`(新建,117 行) | Toolbar 视觉(Q6=A 暗主题简陋):button + active 蓝色高亮 + separator + dropdown 浮层 |

### 2.9 引入的 npm 依赖

| 包 | 版本 | 用途 |
|---|---|---|
| `prosemirror-history` | ^1.5.0 | undo-redo 真实现 |
| `prosemirror-inputrules` | ^1.5.1 | headings + mark markdown 风格输入规则 |

`prosemirror-keymap` / `prosemirror-commands` / `prosemirror-state` / `prosemirror-view` / `prosemirror-model` L5-A 已装,沿用。

---

## 3. 自我诊断输出样本

主进程终端 console:
```
[L0] alive | electron: 40.9.3, node: 24.14.1
[L1] alive | window id: 1
[L2] alive | shell: rendered
[L3] alive | workspaces: N
[L4] alive | commands: 21, capabilities: 5, views: 1, ...
[L5] alive | view: note-view, blocks: 1, marks: 4, capabilities: 5+driver
```

`commands: 21` = L4 框架 6 + L5-A 3(create-note / delete-active / set-active) + L5-B1 5(create-folder / delete-by-tree-id / copy-by-tree-id / paste / sort-cycle-title/date) + L5-B2 7(toggle-bold/italic/strike/code + set-heading-level + undo/redo)。

DevTools 检查 Schema:
```js
> Object.keys(__krig.driver.lastSchema.marks)
['bold', 'italic', 'strike', 'code']
> __krig.driver.getActiveMarks(workspaceId)
['bold', 'italic']  // 选区在 bold + italic 文字时
```

DevTools 检查 SelectionPayload:
```js
> selection.api.getCurrent()
{ source: 'text-editing-driver:ws-1', kind: 'text', from, to, anchor, head,
  activeMarks: ['bold'], activeBlockType: 'text-block', activeLevel: 2 }
```

---

## 4. 阶段中遇到 / 解决的问题

### 4.1 input-rule 跟 markdown 心智的对齐

**设计争议**:V1 没做 mark input-rule(只做 block-level)。V2 加 mark input-rule(`**bold** ` 等)是 Notion/Tiptap 标配,但实施细节(空格触发?保留还是吃掉?stored marks 怎么处理?)有多种选择。

**最终方案**(`build-input-rules.ts.markInputRule`):
- 触发字符:**末尾空格**(避免输入中误触)
- 删除 markup chars(`**`),保留 content,加 mark
- 补回触发的空格(无 mark)
- `setStoredMarks([])` — 下一字符不再粘 mark(避免输入 `**bold** more` 时 `more` 也粘 bold)

跟 Notion / Tiptap 心智一致。

### 4.2 selection emit 频率优化(顺手做)

**风险**:L5-A selection emit 每次 transaction 都触发 → Toolbar 每次重渲性能差(频繁高亮闪烁)。

**应对**:`selection-source.ts` 加 Snapshot diff — `lastSnapshots: Map<instanceId, SelectionSnapshot>` + `shallowEqualSnapshot(prev, current)`,真变才 emit。

snapshot 字段:isEmpty / from / to / anchor / head / marksKey(activeMarks join '|') / blockType / level。

### 4.3 driver API 边界辨析

**辨析**:view command handler 通过 `textEditingDriverApi` import + 调,会不会破坏"view 不接触 driver 内部"边界?

**结论**:driver api 是 driver **对外契约**(类似 Host 组件),view 通过它跟 driver 通信 — 边界不破。view 不直接拿 EditorView / state / dispatch / Schema(那才是破坏)。

写进设计文档 § 8.8。

### 4.4 heading 键位选择

**问题**:Cmd+1/2/3 跟浏览器/系统切 tab 等冲突。

**应对**:用 Cmd+Alt+1/2/3(对齐 Notion 习惯;Cmd+Alt+0 切回 paragraph)。

### 4.5 Cmd+Shift+X 切 strike

**选择**:VS Code 风格 Cmd+Shift+X(V1 用 Cmd+Shift+S — 跟"保存"歧义)。L5-B2 选 X 避歧义。

### 4.6 Toolbar dropdown 视觉简陋(短期)

**选择**:Q6=A — Toolbar 视觉简陋暗主题,不抽通用 Popover。

**长期**:L5-B2.5/B3 floating-toolbar 时再抽 Popover 通用组件容纳所有锚点浮层(右键 / dropdown / floating-toolbar 共用)。

### 4.7 Toolbar 按钮 onMouseDown preventDefault

**问题**:用户点 Toolbar B 按钮 → 编辑器失焦 → toggleMark 无效(没有 selection 可 toggle)。

**应对**:`onMouseDown={(e) => e.preventDefault()}` 阻止默认 focus 转移行为 — Toolbar 按钮上 mouseDown 不抢焦点,onClick 时编辑器仍持有 selection,toggleMark 生效。

### 4.8 code mark 排他

**问题**:code mark 跟其他 inline 格式混用(bold + code)语义混乱(代码里有 bold?)。

**应对**:`code.ts` 加 `excludes: '_'` — code 跟所有其他 mark 互斥(用 PM 标准机制)。

---

## 5. 关键决策落地(用户拍板)

8 项决策见设计 § 0.3 表格。本阶段拍板沉淀进设计文档 v0.1 修订记录。

---

## 6. V1 → V2 改进对比验证

| 维度 | V1 | V2 实际 | 验证 |
|---|---|---|---|
| marks 装配 | 集中在 registry.ts 一个文件(8+ marks 全在内) | **每个 mark 一文件**(自治目录 + index 收集) | ✅ 改进 |
| input-rules | 只 block-level(`# ` 等),无 mark markdown | **block-level + 4 mark markdown**(对齐 Notion/Tiptap 习惯) | ✅ 改进 |
| keymap | Mod-b/i/u/Shift-s/e | **Mod-b/i/Shift-x/e**(strike 用 X 避歧义保存) | ✅ 微调 |
| heading 键位 | 无(V1 没 heading 键位) | **Mod-Alt-0/1/2/3** | ✅ 改进 |
| undo-redo | history + keymap 在 NoteEditor 内 | **driver 内 + capability 协议保留 scope**(协议形态完整) | ✅ 改进 |
| view↔editor 边界 | NoteEditor 直接 import 各种 PM API | **textEditingDriverApi 对外契约**(view 不接触 PM 内部) | ✅ 改进 |
| Toolbar 内容 | 后退/前进/保存/书签(业务) | **格式化按钮 + heading**(L5-B2 编辑体验);业务按钮留 L5-C+ | ✅ 改进 |
| Toolbar dropdown | 无(V1 用 floating-toolbar 替代格式化 toolbar) | **支持**(Heading 4 选项)+ 视觉简陋暗主题 | ✅ 改进 |
| Toolbar active 高亮 | 部分(V1 floating-toolbar 有,顶 Toolbar 无) | **统一**(订阅 selection capability,所有按钮自动 active) | ✅ 改进 |
| selection capability | N/A(V1 无 capability 体系) | **首次真消费**(driver emit activeMarks/blockType,Toolbar 订阅) | ✅ 协议落地 |
| selection emit 频率 | N/A | **真变才 emit**(Snapshot diff;性能优化) | ✅ 改进 |

---

## 7. 与 charter § 1.4 视图与实现归属的对照

| § 1.4 规则 | 本阶段如何遵守 |
|---|---|
| view 不接触 PM | ✅ note-commands 调 textEditingDriverApi(driver 对外契约),不持有 EditorView |
| driver 是 view 必经路径 | ✅ NoteView 仍只装 textEditingDriver.Host;view 命令路由 instance-registry |
| 应用级 UI 在 Workspace Container | ✅ ToolbarFrame 在 Workspace,Toolbar binding 渲染 toolbarRegistry |
| 共用 UI 在框架层 | ✅ ToolbarBinding 不感知 view 业务,通过 ToolbarItem 协议接收 |
| 能力 UI 在 Capability(L4) | ✅ selection capability 首次真消费 — driver emit + 框架 binding 订阅 |
| view 文件极轻 | ✅ NoteView.tsx 仍 ~50 行;Toolbar 注册分到独立 toolbar-content.tsx |
| 数据资产全局 / 工作状态 per-ws | ✅ marks 数据属于 Note.doc(全局)— 工作状态(history 栈 / selection)随 EditorView per-instance |

---

## 8. 进入 L5-B3 阶段的前置条件

L5-B2 完成后:
- ✅ driver 装 marks(4 个 + 自治目录)+ input-rules + keymap + history(完整)
- ✅ view↔driver 边界用 driver API 契约固化(api.ts)
- ✅ selection capability 首次真消费(driver emit / 框架 binding 订阅 / activeMarks/blockType/level)
- ✅ Toolbar 三套视觉(button / dropdown / separator)+ active 高亮 + dropdown 浮层
- ✅ 应用级 keymap 全套(Cmd+B/I/Shift-X/E + Cmd+Alt+0/1/2/3 + Cmd+Z/Shift+Z/Y)

**当前状态**:**可直接进入 L5-B3 阶段**。

下一阶段建议分支:`feature/L5B3-lists-blocks-dnd`。

L5-B3 范围(L5-B 拆分计划 + L5-B2 设计 § 9.1):
- 新 block 类型:bullet-list / ordered-list / task-list / blockquote(各自 BlockSpec 自治目录,inputRule + keymap + nodeView)
- 新 block 类型:codeBlock / horizontalRule
- input-rules 加 `[-*] / 1. / [] / [ ] / [x] / > / --- / \`\`\``
- driver dnd block-handle 拖动手柄(对应 capability drag-and-drop **首次真消费**)
- multi-envelope clipboard + paste dispatcher(对应 capability clipboard **首次真消费**)
- floating-toolbar(对应 floating-toolbar capability + L4 floatingToolbarRegistry **首次真消费**)
- 抽 Popover 通用组件(右键菜单 / dropdown / floating-toolbar 共用)

---

## 9. 遗留问题 / 待优化项

### 9.1 input-rule 与 IME(中文输入)兼容
**状态**:`prosemirror-inputrules` 标准行为是 composition 期间不触发,但用户 IME 多样未深测。
**应对**:实测 V1 同款依赖标准行为;真踩坑再加显式 IME 检测。

### 9.2 selection capability `getText()` 仍是 noop
**状态**:`selection/index.ts.api.getText()` L5-A 写的占位 — L5-B2 没用到所以没补。
**应对**:L5-B3 真有跨 view 复制选区文本场景时再实现。

### 9.3 capability undo-redo 协议消费
**状态**:Q4=A — driver 内 prosemirror-history,capability 注册 scope 保留协议形态但不真消费。
**应对**:L5-C+ 真有跨 view undo 需求时再做协议消费(scope 跨 view 协调)。

### 9.4 Toolbar 没接 keyboard navigation
**状态**:目前 Toolbar 只能鼠标点;V1 也没做。
**应对**:无障碍/键盘党需求显现时加(Tab 焦点 + Enter 激活)。

### 9.5 dropdown 浮层未抽 Popover 通用组件
**状态**:Q6=A 拍板 L5-B2.5/B3 floating-toolbar 时一起抽。
**应对**:L5-B3 范围内。

### 9.6 mark input-rule 的实现细节
**实现**:删 → insertText → addMark → 补空格 → setStoredMarks([])
**已知边界情况**:
- 选中文本时不触发(只末位空格触发,符合预期)
- IME 期间不触发(标准行为)
- 嵌套 marks(`***xx*** ` 同时 bold+italic)未测试 — 当前实现可能只生效内层

如未来用户反馈嵌套 mark 输入异常,加正则细化。

---

## 10. 提交清单

`feature/L5B2-marks-undo` 分支共 2 commits + 1 merge:

| Commit | 说明 |
|---|---|
| `6af55de` | docs(L5-B2): marks-undo 实施设计 v0.1 |
| `73a5efd` | feat(L5-B2): marks + headings + input-rules + 真 undo-redo + Toolbar 接入 |
| (待) | docs(L5-B2): marks-undo 阶段完成报告 |
| (待) | Merge feature/L5B2-marks-undo → main |

---

## 11. 用户记忆沉淀(本阶段)

实施过程沉淀进 auto-memory 的长期原则(均反映在协议文档 / 设计文档,不需要新增 memory 条目):

- **driver API 契约**:driver 通过 api.ts 对 view 暴露高阶动作,view 调 api 不破坏分层(api 是 driver 对外契约,等同 Host 组件)
- **Toolbar 按钮 onMouseDown preventDefault**:UI 控件需要保持编辑器焦点的关键技巧(否则点了按钮失焦,toggleMark 等命令没 selection 可作用)
- **selection capability 真变才 emit**:每次 transaction 都 emit 性能差;Snapshot diff 是必要优化 — 写进 capability 协议的"emit 时机"惯例
- **mark input-rule 后清 stored marks**:避免输入 `**bold** more` 时 `more` 也粘上 mark — 符合 markdown 心智

---

## 12. L5-B2 与 charter § 6.3 全局核对

charter § 6.3 通用判据:
- ✅ npm start 跑得起来(L0~L5-B1 不回归)
- ✅ typecheck + lint 全过
- ✅ console L0~L5 全部 alive
- ✅ 健康检查 IPC 全部 alive
- ✅ 主进程 / preload / renderer 三处都没新增越界 import

L5-B2 设计 v0.1 § 6 特定 15 判据:见 § 1。

**全部通过**。
