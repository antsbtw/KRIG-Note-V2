# KRIG-Note V2 目录结构

> v0.1 · 2026-05-03 · 草稿
>
> 配套文档:[charter.md](./charter.md)
>
> 设计决策:对话 2026-05-03 用户拍板"先纵向 4 层 + 后横向 L0~L5 + 能力内分 3 类 + 第一层不分 main/renderer"

---

## 0. 设计原则

本目录结构按 [charter.md § 1.1 分层原则](./charter.md) 落地:

1. **第一层(顶层目录)按职责分**——纵向 4 层 + 横向 L0~L4 + 共享层(shared)
2. **第二层(子目录)按业务/进程分**——能力按 3 类分组,跨进程能力内部分 main/renderer
3. **横向 L0~L5 不强制每层独立目录**——L0/L1 合并为 platform/,L2~L4 各自独立,L5 在 views/(纵向)+ capabilities/(支撑)
4. **屏障原则强制**——views / shell / workspace / slot 不允许 import 业务 npm,ESLint 自检

---

## 1. 顶层结构(src/ 之下 9 个第一层目录)

```
src/
├── views/          ← 纵向:可视化层(L5 视图主体)
├── capabilities/   ← 纵向:能力层(npm 屏障,3 类内分)
├── semantic/       ← 纵向:语义层(纯类型)
├── storage/        ← 纵向:存储层(SurrealDB)
├── platform/       ← 横向:L0 应用层 + L1 窗口层(Electron 进程入口)
├── shell/          ← 横向:L2 Shell 层(三栏布局 + Slot 容器)
├── workspace/      ← 横向:L3 Workspace 层(WorkMode 状态)
├── slot/           ← 横向:L4 Slot 层(Registry 基础设施)
└── shared/         ← 跨进程共享(IPC 契约 + 共享类型)
```

### 第一层目录的纵向 / 横向归属

| 目录 | 纵向类目 | 横向 L 层 |
|---|---|---|
| `views/` | 可视化层 | L5(视图主体) |
| `capabilities/` | 能力层 | 跨 L0~L5(被各层调用) |
| `semantic/` | 语义层 | 跨 L0~L5(纯类型,任何层可用) |
| `storage/` | 存储层 | L0(主进程持久化) |
| `platform/` | 跨纵向(平台基础) | L0 + L1 |
| `shell/` | 可视化层 | L2 |
| `workspace/` | 能力层(状态管理) | L3 |
| `slot/` | 能力层(Registry 基础) | L4 |
| `shared/` | 跨纵向(共享类型) | 跨 L0~L5 |

---

## 2. 各目录详细结构

### 2.1 `src/views/` — 可视化层(L5 视图主体)

```
src/views/
├── note/                     ← NoteView(V2 第一个落地视图)
│   ├── index.ts              (registerView 声明)
│   ├── components/           (内部 React 组件)
│   ├── styles.css
│   └── README.md             (链回 docs/10-business-design/note/)
├── (graph/ ebook/ web/ 后续添加)
└── README.md
```

**职责**:用户感知 + 视图本地状态。

**屏障约束**(ESLint 强制):
- ❌ 禁止 import 业务 npm 包(prosemirror / three / pdfjs / epubjs / foliate-js / electron)
- ❌ 禁止 import `src/capabilities/*/main/*` 或 `src/capabilities/*/renderer/*` 的内部细节(只能 import `src/capabilities/<name>/index.ts` 入口)
- ✅ 允许 import:react / clsx / nanoid / 等纯函数白名单
- ✅ 允许 import:`src/capabilities/`(通过入口)/ `src/semantic/` / `src/shared/`

---

### 2.2 `src/capabilities/` — 能力层(npm 屏障,3 类分组)

```
src/capabilities/
├── representation/                 ← 类 1:表征类能力(渲染方法)
│   ├── text-editing/
│   │   ├── main/                   (主进程实现,如有)
│   │   ├── renderer/               (renderer 实现:PM 封装)
│   │   ├── index.ts                (统一对外入口)
│   │   └── README.md
│   ├── canvas-rendering/
│   │   ├── renderer/               (Three.js 封装)
│   │   ├── index.ts
│   │   └── README.md
│   ├── pdf-rendering/
│   │   ├── renderer/               (pdfjs-dist)
│   │   ├── index.ts
│   │   └── README.md
│   ├── epub-rendering/
│   │   ├── renderer/               (epubjs / foliate-js)
│   │   ├── index.ts
│   │   └── README.md
│   ├── web-rendering/
│   │   ├── main/                   (WebContentsView 创建 + 控制)
│   │   ├── renderer/               (React Wrapper)
│   │   ├── index.ts
│   │   └── README.md
│   └── README.md
│
├── interop/                        ← 类 2:互操作类能力(动作抽象)
│   ├── browser-capability/
│   │   ├── main/                   (electron session / webContents)
│   │   ├── renderer/               (调用主进程 API)
│   │   ├── index.ts
│   │   └── README.md               (链回 docs/10-business-design/web/browser-capability/)
│   ├── content-extraction/
│   │   ├── main/                   (内容提取主进程)
│   │   ├── renderer/
│   │   ├── index.ts
│   │   └── README.md
│   ├── ai-conversation/
│   │   ├── main/                   (AI SDK 调用,API key 管理)
│   │   ├── renderer/               (UI 调用)
│   │   ├── index.ts
│   │   └── README.md
│   ├── elk-layout/
│   │   ├── renderer/               (elkjs 调用)
│   │   ├── index.ts
│   │   └── README.md
│   └── README.md
│
├── system-service/                 ← 类 3:系统服务类能力
│   ├── history/
│   │   ├── renderer/               (撤销/重做)
│   │   ├── index.ts
│   │   └── README.md
│   ├── find-replace/
│   │   ├── renderer/
│   │   ├── index.ts
│   │   └── README.md
│   ├── copy-paste/
│   │   ├── main/                   (剪贴板主进程操作)
│   │   ├── renderer/
│   │   ├── index.ts
│   │   └── README.md
│   └── README.md
│
└── README.md                       (能力层总览 + 注册机制说明)
```

**职责**:互操作能力的抽象,封装外部 npm 依赖,跨视图复用动作。

**3 类分组依据**:
- **representation/**:把语义投影成视图特定形态(渲染方法)
- **interop/**:跨视图通用的动作抽象,与"投影"无关
- **system-service/**:系统级跨视图通用功能

**跨进程内部约定(每个能力的 main/ + renderer/ 子目录)**:
- `main/`:能力的主进程实现(如有 IPC handlers / WebContents 操作 / 文件系统访问)
- `renderer/`:能力的 renderer 实现(如有 React Wrapper / DOM 操作 / 浏览器 API 调用)
- `index.ts`:**唯一对外入口**,根据消费方所在进程动态选择 main 或 renderer 实现
- 视图(`src/views/`)只 import `index.ts` 入口,不接触 main/ 或 renderer/ 内部

**屏障约束**(ESLint 强制):
- ✅ 唯一允许 import 业务 npm 包的位置
- ❌ 禁止能力之间互相 install(避免依赖图)
- ❌ 禁止从能力外暴露内部细节(只能通过 `index.ts` 暴露)

---

### 2.3 `src/semantic/` — 语义层(纯类型)

```
src/semantic/
├── atom/
│   ├── atom-types.ts            (Atom 类型定义)
│   ├── atom-validators.ts       (Atom 校验逻辑)
│   └── README.md                (链回 docs/10-business-design/ai/KRIG-Atom体系设计文档.md)
├── block/
│   ├── block-types.ts           (block 概念定义,自身可嵌套)
│   ├── block-tree-utils.ts      (block 树操作纯函数)
│   └── README.md                (链回 docs/10-business-design/block/)
├── intents/
│   ├── intent-events.ts         (IntentEvent 类型)
│   └── README.md
├── ids/
│   ├── id-types.ts              (各类 ID 类型 + 命名规范)
│   └── README.md
└── README.md
```

**职责**:内容本体,与可视化无关。Atom + block 在这里定义。

**屏障约束**:
- ❌ 0 处 npm 业务包 import
- ✅ 纯类型 + 纯逻辑,不持有状态
- ✅ 跨视图通用(任何视图都能消费)

---

### 2.4 `src/storage/` — 存储层(SurrealDB)

```
src/storage/
├── surreal-client/
│   ├── connection.ts            (SurrealDB 连接管理)
│   ├── schema.ts                (数据库 schema 定义)
│   └── README.md
├── ipc-handlers/
│   ├── atom-handlers.ts         (Atom 读写 IPC handler)
│   ├── workspace-handlers.ts    (Workspace 状态持久化)
│   └── README.md
└── README.md
```

**职责**:持久化,SurrealDB SDK 调用。

**屏障约束**:
- ✅ 唯一允许 import SurrealDB SDK 的位置
- ✅ 通过 IPC 提供给能力层(主进程 / renderer 隔离)
- ❌ 禁止其他纵向层直接 import SurrealDB SDK

---

### 2.5 `src/platform/` — L0 应用层 + L1 窗口层

```
src/platform/
├── main/                        ← Electron 主进程入口
│   ├── index.ts                 (app.whenReady + 启动主流程)
│   ├── window/
│   │   ├── main-window.ts       (主 BrowserWindow 创建)
│   │   ├── window-manager.ts    (多窗口管理)
│   │   └── README.md
│   ├── ipc/
│   │   ├── ipc-bus.ts           (IPC 总线)
│   │   ├── ipc-router.ts        (handler 路由)
│   │   └── README.md
│   ├── diagnostics/
│   │   ├── L0-alive.ts          (L0 自我诊断信号)
│   │   ├── L1-alive.ts          (L1 自我诊断信号)
│   │   └── README.md
│   └── README.md
├── renderer/                    ← Electron renderer 进程入口
│   ├── index.tsx                (React mount 到 #root)
│   ├── diagnostics/
│   │   └── renderer-alive.ts    (renderer 自我诊断信号)
│   └── README.md
└── README.md
```

**职责**:Electron 进程入口,L0 应用启动 + L1 窗口管理。

**屏障约束**:
- ✅ main/ 允许 import Electron API
- ✅ renderer/ 允许 import React 等浏览器 API
- ❌ main/ 不能 import renderer 代码(进程隔离)

---

### 2.6 `src/shell/` — L2 Shell 层(三栏布局 + Slot 容器)

```
src/shell/
├── three-column-layout/
│   ├── ShellLayout.tsx          (三栏布局 React 组件)
│   ├── ResizableDivider.tsx     (可拖拽分隔线)
│   └── README.md
├── slot-system/
│   ├── SlotContainer.tsx        (Slot 容器组件)
│   ├── SlotRouter.tsx           (Slot 内容路由)
│   └── README.md
└── README.md
```

**职责**:三栏布局骨架 + Slot 容器机制。

**屏障约束**(同 views):
- ❌ 禁止 import 业务 npm 包
- ✅ 允许 import react / clsx 等纯函数

---

### 2.7 `src/workspace/` — L3 Workspace 层

```
src/workspace/
├── workmode-registry/
│   ├── workmode-types.ts        (WorkMode 类型定义)
│   ├── workmode-registry.ts     (WorkMode 实例管理)
│   └── README.md
├── state/
│   ├── workspace-state.ts       (Workspace 状态)
│   ├── plugin-states.ts         (pluginStates 字典)
│   ├── persistence.ts           (状态持久化协议,调用 storage 层)
│   └── README.md
└── README.md
```

**职责**:WorkMode 实例管理 + Workspace 状态(activeViewId / activeResource / pluginStates)。

**屏障约束**:
- ❌ 禁止 import 业务 npm 包
- ✅ 允许调用 `src/storage/`(通过 IPC)

---

### 2.8 `src/slot/` — L4 Slot 层(Registry 基础设施)

```
src/slot/
├── view-type-registry/
│   ├── view-registry.ts         (ViewType 注册中心)
│   ├── register-view.ts         (registerView API)
│   └── README.md
├── capability-registry/
│   ├── capability-registry.ts   (Capability 注册中心)
│   ├── register-capability.ts   (registerCapability API)
│   └── README.md
├── command-registry/
│   ├── command-registry.ts      (CommandRegistry — 命令字符串引用实现)
│   ├── command-handler.ts       (CommandHandler 类型)
│   └── README.md
├── interaction-registries/
│   ├── context-menu-registry.ts (ContextMenu 五大交互之一)
│   ├── toolbar-registry.ts
│   ├── slash-registry.ts
│   ├── handle-registry.ts
│   ├── floating-toolbar-registry.ts
│   └── README.md
└── README.md
```

**职责**:5 大 Registry 基础设施(ViewType / Capability / Command + 五大交互)。

**屏障约束**:
- ❌ 禁止 import 业务 npm 包
- ✅ 允许 import `src/semantic/` / `src/shared/`

---

### 2.9 `src/shared/` — 跨进程共享

```
src/shared/
├── ipc/
│   ├── channel-names.ts         (IPC channel 名常量)
│   ├── message-types.ts         (IPC 消息类型契约)
│   └── README.md
├── types/
│   ├── common-types.ts          (跨进程共享类型)
│   └── README.md
├── constants/
│   ├── app-constants.ts         (应用级常量)
│   └── README.md
└── README.md
```

**职责**:main / renderer 进程共享的纯类型 + IPC 契约 + 常量。

**屏障约束**:
- ❌ 0 处 npm 业务包 import
- ✅ 纯类型 + 纯常量,不持有运行时状态
- ✅ 任何进程任何层都能 import

---

## 3. 文件命名规范

### 3.1 目录命名 — kebab-case

```
✅ src/capabilities/representation/text-editing/
✅ src/views/note/
✅ src/storage/surreal-client/

❌ src/capabilities/Representation/TextEditing/
❌ src/views/Note/
```

### 3.2 文件命名

- **TypeScript 模块**:`kebab-case.ts`(如 `atom-types.ts`)
- **React 组件**:`PascalCase.tsx`(如 `ShellLayout.tsx`)
- **类型纯文件**:`kebab-case.types.ts`(可选,推荐)
- **索引/入口**:`index.ts` / `index.tsx`

### 3.3 函数 / 类型命名 — camelCase / PascalCase

```ts
// camelCase 函数 / 变量
export function registerView(def: ViewDefinition) {}
const blockRegistry = new Registry();

// PascalCase 类型 / 类
export interface ViewDefinition {}
export class CapabilityRegistry {}
```

---

## 4. TypeScript Path Alias

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@views/*":        ["src/views/*"],
      "@capabilities/*": ["src/capabilities/*"],
      "@semantic/*":     ["src/semantic/*"],
      "@storage/*":      ["src/storage/*"],
      "@platform/*":     ["src/platform/*"],
      "@shell/*":        ["src/shell/*"],
      "@workspace/*":    ["src/workspace/*"],
      "@slot/*":         ["src/slot/*"],
      "@shared/*":       ["src/shared/*"]
    }
  }
}
```

**使用例**:

```ts
// src/views/note/index.ts
import { registerView } from '@slot/view-type-registry/register-view';
import type { Atom } from '@semantic/atom/atom-types';
import { textEditing } from '@capabilities/representation/text-editing';
```

---

## 5. ESLint 屏障规则

`eslint.config.js` 关键 overrides:

```js
overrides: [
  // 屏障层 1:可视化相关层(views / shell)零业务 npm import
  {
    files: ['src/views/**', 'src/shell/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*'], message: '使用 capability.text-editing' },
          { group: ['three', 'three/*'], message: '使用 capability.canvas-rendering' },
          { group: ['pdfjs-dist'], message: '使用 capability.pdf-rendering' },
          { group: ['epubjs', 'foliate-js'], message: '使用 capability.epub-rendering' },
          { group: ['electron'], message: 'Electron API 必须经能力层封装' },
        ],
      }],
    },
  },
  // 屏障层 2:Workspace / Slot 层零业务 npm import
  {
    files: ['src/workspace/**', 'src/slot/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs', 'foliate-js'],
            message: '基础设施层禁止 import 业务 npm 包' },
        ],
      }],
    },
  },
  // 存储层只允许 surrealdb
  {
    files: ['src/storage/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['prosemirror-*', 'three', 'pdfjs-dist', 'epubjs', 'foliate-js', 'react'],
            message: '存储层只允许 surrealdb + 内部模块' },
        ],
      }],
    },
  },
  // capabilities 是唯一允许业务 npm 的位置(无限制)
];
```

**CI 卡死**:任何违规 = CI 失败,无法 merge。

---

## 6. 与 V1 目录的对应关系

| V1 目录 | V2 目录 | 说明 |
|---|---|---|
| `src/main/index.ts` | `src/platform/main/index.ts` | 入口迁移 |
| `src/main/window/` | `src/platform/main/window/` | 窗口管理 |
| `src/renderer/index.tsx` | `src/platform/renderer/index.tsx` | renderer 入口 |
| `src/renderer/shell/` | `src/shell/` | Shell 提升为顶层 |
| `src/main/workspace/` | `src/workspace/` | Workspace 提升为顶层 |
| `src/renderer/ui-primitives/` | `src/slot/` | Registry 基础设施提升为顶层 |
| `src/plugins/note/` | `src/views/note/` + `src/capabilities/representation/text-editing/` | 纯视图与能力分离 |
| `src/plugins/graph/` | `src/views/graph/` + `src/capabilities/representation/canvas-rendering/` + `src/capabilities/representation/text-editing/`(节点 label) | 拆分到能力层 |
| `src/plugins/ebook/` | `src/views/ebook/` + `src/capabilities/representation/pdf-rendering/` + `src/capabilities/representation/epub-rendering/` | 同上 |
| `src/plugins/web/` | `src/views/web/` + `src/capabilities/representation/web-rendering/` + `src/capabilities/interop/browser-capability/` + `...` | 同上 |
| `src/shared/` | `src/shared/` + `src/semantic/` | 拆分:共享类型 vs 语义类型 |

---

## 7. 待拍板

- [ ] capabilities 内的 3 类分组(representation/interop/system-service)是否需要再细分?
- [ ] views 是否需要按 plugin 来源分子目录?(目前是 `views/note/`,V1 plugin 概念是否还存在)
- [ ] storage 是否需要分 main/renderer 子目录?
- [ ] semantic 内 atom 与 block 的实际目录耦合(block 引用 atom 类型)
- [ ] 跨进程共享的"运行时状态"放哪里?(目前 shared/ 仅纯类型 + 常量)

---

## 8. 修订记录

| 日期 | 版本 | 内容 | 作者 |
|---|---|---|---|
| 2026-05-03 | v0.1 | 初稿;按 charter v0.2 落地;9 个第一层目录(纵向 4 层 + 横向 L0~L4 部分独立 + shared)+ capabilities 内 3 类分组 + 能力跨进程内部 main/renderer 子目录 + ESLint 屏障规则 | wenwu + Claude |
