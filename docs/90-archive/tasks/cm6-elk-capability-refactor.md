# 任务:CM6 + ELK 下沉到 capability 层重构

## 目标

把当前散落在 mermaid 全屏实现里的两个外部 SDK 依赖 — **CodeMirror 6** 和 **ELK(elkjs)**,下沉为 V2 capability 层公共能力。让未来任何 view / block 需要"代码编辑器"或"图布局算法"时,只需 `requireCapabilityApi(...)` 拿到统一接口,**不直接 import 外部 npm**。

完成后:
- `mermaid` 全屏改为接 `code-editing` capability(而非直接 import `@codemirror/*`)
- `mermaid-renderer.ts` ELK 注册改为接 `graph-layout` capability(而非直接 import `@mermaid-js/layout-elk`)
- 未来 code-block 接 CM6 / 未来 BPMN/Mind/知识图谱接 ELK 全部走 capability,**零额外架构改动**

## 背景

当前 main(commit `b7eaa02` 含 L2 fullscreen-overlay + mermaid 全屏)状态:
- `package.json` 装了 `@codemirror/{view,state,commands,language}` + `@lezer/highlight`(5 包)
- `package.json` 装了 `@mermaid-js/layout-elk@0.2.1`(依赖 `elkjs@0.9.3`,可用 `npm ls elkjs` 验证)
- 唯一消费方:`src/drivers/text-editing-driver/blocks/code-block/`
  - `fullscreen/MermaidEditor.tsx` 直接 import `@codemirror/*` + `@lezer/highlight`
  - `fullscreen/mermaid-lang.ts` import `@codemirror/language`(StreamLanguage)
  - `mermaid-renderer.ts` import `@mermaid-js/layout-elk`(注册 mermaid 的 ELK loader)
- **没有任何其他 view / capability 用 ELK**(grep 验证过)

V2 的 capability 体系成熟模式参考:
- `src/capabilities/canvas-rendering/` — Three.js 单点屏障(P1-1 严格屏障)
- `src/capabilities/shape-library/` — Shape + Substance 资源仓库,0 import three
- `src/capabilities/text-editing/` — ProseMirror Host + atom-bridge

新增两个 capability 跟这些是同级。

未来规划用 ELK 的业务(用户拍板):
- 画布 graph canvas — 自动布局起点(用户拖完后凝结)
- BPMN 2.0 业务流程图 — `layered` (sugiyama)
- Mind map — `mrtree` / `radial`
- 知识图谱 — `force` / `stress` / `layered`

## 拆解任务

### Task A:`code-editing` capability(CM6 单点封装)

**职责**:封装 CodeMirror 6 + 高亮 + 语言扩展加载,对外提供 React 组件 + imperative API。

**对外 API 设计**(初版):
```ts
// src/capabilities/code-editing/types.ts
export interface CodeEditingApi {
  /** React Component:挂 CM6 容器,自管生命周期 */
  Host: ComponentType<CodeEditingHostProps>;
  /** 注册语言(业务方/未来 code-block 可贡献新语言)*/
  registerLanguage(item: LanguageItem): void;
  /** 取已注册语言(供 UI 下拉等用)*/
  getLanguages(): LanguageItem[];
}

export interface CodeEditingHostProps {
  initialValue: string;
  language?: string;          // 'javascript' / 'python' / 'mermaid' / undefined(plain)
  theme?: 'dark' | 'light';   // 默认 dark
  onChange?: (value: string) => void;
  onMount?: (handle: CodeEditingHandle) => void;
  readOnly?: boolean;
  /** 扩展配置:line numbers / Tab 缩进 / keymap 等 */
  features?: {
    lineNumbers?: boolean;    // 默认 true
    tabIndent?: boolean;       // 默认 true
    defaultKeymap?: boolean;   // 默认 true
  };
}

export interface CodeEditingHandle {
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
}

export interface LanguageItem {
  id: string;                 // 'javascript' / 'python' / 'mermaid' / ...
  label: string;              // 显示名 'JavaScript' / 'Python' / ...
  /** lazy loader:返回 CM6 LanguageSupport 或 StreamLanguage */
  loader: () => Promise<LanguageSupport | StreamLanguage<unknown>>;
}
```

**文件结构**:
```
src/capabilities/code-editing/
├── README.md
├── index.ts                 (capability 注册 + Host + registerLanguage)
├── types.ts
├── host/
│   ├── CodeHost.tsx          (React Host,内含 CM6 mount 逻辑)
│   ├── theme-dark.ts         (cmDarkTheme / cmDarkHighlight,从 MermaidEditor 抽)
│   └── theme-light.ts        (未来加,Phase A 暂留空)
├── languages/
│   ├── mermaid-lang.ts       (从 fullscreen/mermaid-lang.ts 搬过来,语义不变)
│   ├── javascript.ts          (@codemirror/lang-javascript wrapper)
│   ├── typescript.ts          (同)
│   ├── python.ts              (同)
│   ├── json.ts                (同)
│   └── markdown.ts            (同)
└── register-builtin.ts       (启动时一次性注册 6 个内置语言:mermaid + 5 静态)
```

**屏障约束**(对齐 charter §1.3 npm 屏障):
- **只有** `src/capabilities/code-editing/` 内可以 import `@codemirror/*` / `@lezer/*`
- 其他地方一律 `requireCapabilityApi<CodeEditingApi>('code-editing')` 拿 Host

**依赖装包**(从仅 5 个扩到包含语言包):
```
npm i @codemirror/lang-javascript @codemirror/lang-python \
      @codemirror/lang-json @codemirror/lang-markdown
```
(TypeScript 走 @codemirror/lang-javascript 的 jsx:false + typescript:true)

### Task B:`graph-layout` capability(ELK 单点封装)

**职责**:封装 elkjs,对外提供"通用图布局算法"接口,给画板 / BPMN / Mind / 知识图谱 / mermaid 五类业务统一调用。

**对外 API 设计**:
```ts
// src/capabilities/graph-layout/types.ts
export interface GraphLayoutApi {
  /** 计算布局,返回每个节点的 x,y 坐标 + 边的 polyline */
  computeLayout(input: LayoutInput, options: LayoutOptions): Promise<LayoutResult>;
  /** 直接拿 elkjs 实例(给 mermaid 这种 SDK 需要 registerLayoutLoaders 的特殊用法)*/
  getElkInstance(): unknown;  // 类型 ELK from 'elkjs'
}

export interface LayoutInput {
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string }[];
}

export interface LayoutOptions {
  algorithm: 'layered' | 'mrtree' | 'force' | 'radial' | 'stress' | 'box';
  direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
  spacing?: { node?: number; layer?: number; edge?: number };
  // ... elk options 透传
}

export interface LayoutResult {
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  edges: { id: string; sections: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[] }[];
}
```

**文件结构**:
```
src/capabilities/graph-layout/
├── README.md
├── index.ts                 (capability 注册 + computeLayout API)
├── types.ts
├── elk-singleton.ts          (lazy init elkjs 全局单例)
├── algorithms/
│   ├── layered.ts            (option preset:层级布局)
│   ├── mrtree.ts             (option preset:多根树)
│   ├── force.ts              (option preset:力导向)
│   ├── radial.ts             (option preset:辐射树)
│   └── stress.ts             (option preset:应力模型)
└── adapters/
    └── mermaid-elk-loader.ts (给 mermaid 用的 ELK loader,内部仍 @mermaid-js/layout-elk)
```

**依赖装包**:
```
npm i elkjs
```
(`@mermaid-js/layout-elk` 保留 — 它对 mermaid 是必需的;两者共底层 elkjs@0.9.3 通过 npm hoist)

**屏障约束**:
- **只有** `src/capabilities/graph-layout/` 内可以 import `elkjs` / `@mermaid-js/layout-elk`
- 其他地方一律 `requireCapabilityApi<GraphLayoutApi>('graph-layout')` 拿 API

### Task C:重构 mermaid 实现接两个 capability

**改动**:
1. `src/drivers/text-editing-driver/blocks/code-block/mermaid-renderer.ts`
   - 删除 `import('@mermaid-js/layout-elk')`
   - 改为:`const elkLayouts = requireCapabilityApi<GraphLayoutApi>('graph-layout').getMermaidElkLoader()` (或直接调暴露的方法)

2. `src/drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidEditor.tsx`
   - 完全删除(改用 `requireCapabilityApi<CodeEditingApi>('code-editing').Host`)
   - 或保留作"thin wrapper" — 内部调 capability Host,业务只关心 mermaid 语言

3. `src/drivers/text-editing-driver/blocks/code-block/fullscreen/mermaid-lang.ts`
   - **删除**(搬到 `src/capabilities/code-editing/languages/mermaid-lang.ts`)

4. `src/drivers/text-editing-driver/blocks/code-block/fullscreen/MermaidFullscreenPanel.tsx`
   - import 改为 capability Host(替换 `<MermaidEditor>` for `<CodeHost language="mermaid">`)
   - lastValueRef 模式保留(子组件 unmount cleanup 顺序问题,见 memory `feedback_react_unmount_child_cleanup_order`)

### Task D:架构文档同步

- 新增 `src/capabilities/code-editing/README.md`:模块说明 + 业务方接入示例
- 新增 `src/capabilities/graph-layout/README.md`:同上
- 更新 `docs/00-architecture/view-hierarchy.md` §十一 文档关系表:加这两条
- (可选)更新 `src/shell/DESIGN.md` 引用:如果有 capability 层级图

## 实施约束

### 单点屏障(强制)

参考 `src/capabilities/canvas-rendering/` 的"Three.js 单点屏障"模式 — `npm i three` 只在此目录有效,其他地方禁止 import。

**ESLint 规则**(已有类似规则,扩展即可):
```
no-restricted-imports:
  - "@codemirror/*" — 只允许 src/capabilities/code-editing/ 内
  - "@lezer/*"      — 同上
  - "elkjs"         — 只允许 src/capabilities/graph-layout/ 内
  - "@mermaid-js/layout-elk" — 同上(给 graph-layout 的 mermaid adapter 用)
```

### 渐进式 — 不破坏 mermaid 现有行为

- Phase 1: 起 `code-editing` + `graph-layout` capability 骨架,**不接入 mermaid**(类似 fullscreen-overlay Phase 1 思路)
- Phase 2: mermaid 切换到 capability(类似 fullscreen-overlay Phase 2)
- 每个 PR 独立合 main

### 分支策略

- 主分支:`refactor/sdk-to-capability`(总分支)
- 子分支:`feature/code-editing-capability` + `feature/graph-layout-capability`(独立可并行)
- 子分支合到主分支 → 主分支接 mermaid → 总合 main

### 验收

- typecheck + lint 全绿(含新加的 no-restricted-imports 规则)
- npm start 启动正常
- mermaid 全屏所有功能不回归(完整测一遍 Phase 2 验收清单)
- `grep -r "@codemirror" src/` 只在 `src/capabilities/code-editing/` 内出现
- `grep -r "elkjs\|@mermaid-js/layout-elk" src/` 只在 `src/capabilities/graph-layout/` 内出现

## 不在范围内

- ❌ inline code block 接 CM6(等本次 capability 落地后再起 Path 1 PR)
- ❌ BPMN / Mind / 知识图谱接 ELK(等具体 view 立项时再接)
- ❌ light theme 完整支持(Phase 1 只 dark,占位接口预留)
- ❌ dynamic language import(Phase 1 静态打 6 个内置语言:mermaid + JS/TS/Python/JSON/Markdown)

## 参考已有 memory

新对话启动时,这些 memory 应该会被自动加载到上下文(MEMORY.md 索引):

- `project_l2_fullscreen_overlay_done` — 类似的两阶段重构落地模板
- `feedback_external_sdk_lifecycle` — 外部 SDK 边界处理
- `feedback_react_unmount_child_cleanup_order` — Panel 用 capability Host 时仍需 lastValueRef
- `feedback_v2_is_workspace_v1_is_reference` — V2 是工作目录,每个 Bash 命令都 cd
- `feedback_merge_requires_explicit_ok` — merge 必须用户显式确认
- `feedback_implementation_test_checklist` — 实施完成后给可执行测试清单

## 工作目录提醒

V2 工作目录:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
所有 cwd 敏感命令(git / npm / find / rm 等)每次都要显式 `cd /...V2`。

## 提交规范

- 子分支提交格式:`feat(capabilities/code-editing): ...` / `feat(capabilities/graph-layout): ...`
- mermaid 重构提交格式:`refactor(text-editing/mermaid): 接入 code-editing + graph-layout capability`
- merge 到 main 前必须用户**显式确认**(memory: `feedback_merge_requires_explicit_ok`)
- 不要 push(memory: 等用户显式 push 指令)
