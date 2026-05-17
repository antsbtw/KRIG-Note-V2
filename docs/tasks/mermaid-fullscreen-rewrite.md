# 任务:用 V2 popup 体系重写 mermaid 全屏编辑器

## 背景

V1 → V2 迁移 mermaid block 时,**inline 渲染版已落地并合 main**(commit `14bc615` +
merge `e7fb33f`),功能正常.但**全屏编辑器被砍**,因为最初实现用了"手工
`document.createElement` + `body.appendChild` 浮层"路线,在 V2 PM + slot 三层架构
里出现顽固的事件 hit-test bug:

- 浮层内 `<select>` 元素能用(浏览器原生 popup 走系统级路径)
- 浮层内 `position: fixed` 的脱离 toolbar 流的按钮能用
- **toolbar flex 流内的 `<button>` 全部失效** — `mouseenter` 触发但
  `mousedown/click` 不触发;PM 的 mousedown handler 在 capture 阶段对所有
  全局 mousedown 做"focus 回编辑器"处理,把焦点 / 事件从 toolbar 内的元素抢走
- 试过多种 workaround 都没根治:
  - 提高 z-index(99999/2147483647)
  - 用 `<dialog>.showModal()` 进 top layer + 自动 inert — 在 Electron + macOS
    hiddenInset 下有 bug,showModal 后所有 mousedown 不再派发(只剩 mouseenter)
  - 给 body 兄弟节点加 `inert` 属性 — 部分按钮仍受 PM 事件流影响
  - 给 toolbar 加 stacking-context + width:100% + flex-shrink:0 + overflow:hidden
  - 全部失败

**结论**:手工 DOM 浮层不属于 V2 范式,正确做法是走 **V2 popup-registry 注册一个
React 组件由 PopupBinding 渲染**.这是 V2 已有的第一公民,事件路由与 PM 隔离正确.

## 目标

把 V1 src/plugins/note/blocks/code-plugins/mermaid-fullscreen.ts(412 行)的能力
作为 React 组件接入 V2 popup 体系,从 mermaid block 的 NodeView toolbar 触发.

## V1 功能清单(对齐复制即可)

- CodeMirror 6 编辑器 + Mermaid 语法高亮(StreamLanguage)
- 实时 Mermaid 预览(300ms 防抖)
- 顶部 toolbar:
  - Template 下拉(8 个模板:Flowchart/Sequence/Class/State/ER/Gantt/Pie/Mindmap)
  - Theme 下拉(dark/default/forest/neutral/base)
  - 方向下拉(TB/LR/RL/BT)
  - 下载按钮(PNG/SVG 切换 — 点图标主体下载,点 PNG/SVG 标签切格式)
  - 复制按钮(PNG/SVG 切换 — 同上语义)
  - Fit 按钮 + 缩放控件(−/100%/+ + 点 100% 输入数字)
- 左右分屏(可拖动分隔条,localStorage 持久 splitRatio)
- 关闭(× 按钮 / Esc)
- 状态栏(✓ 渲染成功 / ✗ 语法错误 + 行号)

V1 参考路径:
- src/plugins/note/blocks/code-plugins/mermaid-fullscreen.ts
- src/plugins/note/blocks/mermaid-lang.ts (CodeMirror Mermaid StreamLanguage)
- src/plugins/note/note.css 第 583-753 行(全屏样式)

## V2 实现约束

### 必须走 V2 popup 体系
- 注册到 popup-registry(单独建一个 popup entry)
- 由 PopupBinding 渲染 React 组件
- 用 popupController.show / hide 触发

### 必须是 React 组件
- 不能用 document.createElement + appendChild
- 所有按钮都是 React JSX `<button>` 走合成事件
- CodeMirror 用 useEffect 挂载 + useRef 保持实例引用

### 不能在 React 组件外手工监听 mousedown
- 除了 CodeMirror 自己内部
- 这是 V2 其他 5 个 binding(toolbar/popup/handle/context/slash)失败的根因之一

### 不要踩的坑
- 不要用 `<dialog>.showModal()` — Electron + macOS hiddenInset 下事件 bug
- 不要靠 z-index 战争 — popup-registry 体系已经处理好层级
- 不要给 body 兄弟节点 inert — popup binding 已经管理这事
- 不要 `position: fixed` 浮在 PM 编辑器上 — 走 popup 体系

## 立项前的研究步骤(强烈建议)

新对话开始时先做:

1. **读 V2 popup 体系**:
   - src/slot/frame-bindings/PopupBinding.tsx
   - src/slot/triggers/popup-controller.ts
   - src/slot/interaction-registries/popup-registry/popup-registry.ts
   - src/slot/DESIGN.md(如有)
   - 找一个**最简单的 popup 注册案例**对照参考(grep `popupRegistry.register`)

2. **看 V2 现有大型 React UI 组件**(对照实现风格):
   - src/capabilities/text-editing/ui/link-panel/(link 编辑面板,有 tab/form)
   - 任何一个挂在 popup-registry 上的复杂组件

3. **看现 inline mermaid 实现**(沿用渲染核心,不要重写):
   - src/drivers/text-editing-driver/blocks/code-block/mermaid-renderer.ts
     — 已有 renderMermaidDiagram / getMermaidModule / MERMAID_TEMPLATES /
       MERMAID_THEMES / buildMermaidConfig,**直接复用**
   - src/drivers/text-editing-driver/blocks/code-block/save-blob.ts
     — 已有 downloadBlob / downloadText,**直接复用**

4. **设计入口触发**:
   - mermaid block NodeView toolbar 加回"全屏"按钮(node-view.ts 已有注释占位)
   - 点击调 popupController.show(popupId, anchorEl, payload)
   - payload 传当前 mermaid 源码 + write-back 回调

## 实施提纲

### 文件结构(建议)

```
src/drivers/text-editing-driver/blocks/code-block/
├── mermaid-renderer.ts        (已存在,复用)
├── save-blob.ts               (已存在,复用)
├── node-view.ts               (加回全屏按钮 + popup 触发)
├── spec.ts                    (不动)
└── fullscreen/                ← 新建
    ├── MermaidFullscreenPanel.tsx   (React 主组件)
    ├── MermaidEditor.tsx            (CodeMirror 子组件)
    ├── MermaidPreview.tsx           (预览 + 缩放子组件)
    ├── MermaidToolbar.tsx           (顶部工具栏子组件)
    ├── mermaid-lang.ts              (CodeMirror StreamLanguage,从 V1 直迁)
    └── register.ts                  (popup-registry 注册)
```

### CodeMirror 依赖

需要**重新安装**(之前砍 inline 全屏时卸载了):
```
npm i @codemirror/view @codemirror/state @codemirror/commands @codemirror/language @lezer/highlight
```

### popup-registry 注册要点

参考 V2 现有 popup 注册案例.大概形态:
```ts
popupRegistry.register({
  id: 'mermaid-fullscreen',
  Component: MermaidFullscreenPanel,
  // 全屏模式建议 placement: 'fullscreen' 或自定义 className 撑满 viewport
  // 具体看 popup-registry/popup-types 的接口
});
```

### NodeView 触发要点

在 node-view.ts 的 toolbar 加回一个 `ICON_FULLSCREEN` 按钮,点击时:
```ts
btnFullscreen.addEventListener('mousedown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  popupController.show('mermaid-fullscreen', btnFullscreen, {
    initialCode: code.textContent || '',
    onSave: (newCode: string) => {
      // 写回 PM(参考 V1 close() 里的 view.dispatch 逻辑)
    },
  });
});
```

但**确认 popupController.show 签名** — V2 实际 API 可能是 `(id, anchorEl)` 或
`(id, x, y, viewId, ...)`,需要看代码.payload 传递可能不在 show 里 — 可能要通过
controller 的额外字段或 ref 传.

## 验收标准

- /mermaid 创建 block → toolbar 点全屏按钮 → 弹出 React 组件全屏面板
- 所有按钮 100% 灵敏(点 1 次必响应):
  - Template / Theme / 方向 三个 select
  - 下载 PNG 图标 / PNG 标签切换 / SVG 切换 + 实际下载
  - 复制 PNG / SVG + 实际写入剪贴板
  - Fit 重置 / 缩放 +/-/百分比输入
  - × 关闭 + Esc 关闭
- 左右分隔条可拖动
- 退出时 mermaid 源码写回 PM(替换 codeBlock 内容)
- 全屏期间在底下的 NoteView 不可交互(popup 体系应该已处理 inert)
- typecheck + lint 全绿
- npm start 跑通,实测每个按钮稳定灵敏

## 不在范围内

- ? 语法参考面板(V1 有,V2 砍 — 不要重写)
- 多语言插件框架(html/markdown/js 插件 V2 已砍)
- 嵌 toolbar 内的语言下拉(V2 用 slash 命令创建)
- 修改 mermaid block 的 inline 渲染行为

## 提交规范

- 单独 feature 分支:`feature/mermaid-fullscreen-popup`
- 提交格式:`feat(text-editing/mermaid): 全屏编辑器走 popup 体系重写`
- merge 到 main 前必须用户**显式确认**(memory: feedback_merge_requires_explicit_ok)
- 不要 push(memory: 等用户显式 push 指令)

## 工作目录提醒

V2 工作目录是 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`.所有 cwd 敏感命令
(git / npm / find / rm 等)每次都要显式 `cd /...V2` — V1 仅作参考查代码用.
(memory: feedback_v2_is_workspace_v1_is_reference)
