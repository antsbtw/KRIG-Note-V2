# C8 sub-stage — D-C 删 `scope: 'global'` + W5 lint 整改

> 起因 + 二次发现:
> - **第一层**:C8 实施时 stage 04 README §七 已识别 — D-C 直接删字段会让
>   canvas-text-node popup(viewId='graph-canvas-view')失去全部 PM 通用菜单,
>   因为 graph-canvas-view 未注册任何浮条/slash 条目,完全靠 NoteView 注册的
>   `scope:'global'` 通配获得。**用户拍板方案 A**:graph-canvas-view 自注册一份
>   view='graph-canvas-view' 通用菜单。
> - **第二层(2026-05-15 实施 D-C.1 后跑 lint 发现)**:stage 04 C2-C5 commits
>   实施时**未跑 lint**,5 个 view 文件违反 W5 `no-restricted-imports` 规则
>   (view 不可直 import `@capabilities/*` 运行时值)。**方案 A inline import
>   工厂同款违规** — D-C 不能简单 inline,必须先 W5 整改。
>
> **本 sub-stage = D-C 删字段 + W5 lint 整改(选项 1)合并实施**。
> 用户拍板:capability 提供 `ui.*` 命名空间,view 走 requireCapabilityApi 间接路由。

## 一、调研结论(纸面证据)

### 1.1 D-C 现状证据

| 项 | 证据 |
|---|---|
| `scope:'global'` 全部使用面 | 22 处全在 `src/capabilities/text-editing/ui/{floating-toolbar,slash-menu}/items.ts`(9 浮条 + 13 slash) |
| 类型字段 | `floating-toolbar-types.ts:28` + `slash-types.ts:17` 各一处 `scope?: 'view' \| 'global'` |
| Registry 过滤分支 | `floating-toolbar-registry.ts:30` `if (item.scope === 'global') return true;` + `slash-registry.ts:31-33` 三项 OR 之一 |
| graph-canvas-view 当前注册 | `views/graph-canvas-view/index.ts` + `canvas-commands.ts` 均无 `floatingToolbarRegistry.register` / `slashRegistry.register` 调用 — 完全空白 |

### 1.2 W5 lint 违规清单(`npm run lint` 5 处错误)

| view 文件 | 违规 import | 引入 commit | 5 个 ui 子模块 |
|---|---|---|---|
| `views/note/floating-toolbar-content.ts:24` | `@capabilities/text-editing/ui/floating-toolbar/items` | C2 | createMarkButtons / createMathButton / createLinkButton / createColorButton |
| `views/note/toolbar-content.tsx:13` | `@capabilities/text-editing/ui/toolbar/items` | C2 | createHeadingDropdown / createSeparator / createToolbarMarkButtons / createToolbarLinkButton / createToolbarColorButtons |
| `views/note/slash-menu-content.ts:13` | `@capabilities/text-editing/ui/slash-menu/items` | C3 | createTurnIntoItems / createMathBlockItem |
| `views/note/handle-menu-content.tsx:27` | `@capabilities/text-editing/ui/handle-menu/items` | C4 | createTurnIntoContainer / createColorContainer / createTurnIntoSubmenu / createBlockActions |
| `views/note/context-menu-content.ts:27` | `@capabilities/text-editing/ui/context-menu/items` | C5 | createClipboardGroup / createSelectAllItem / createRemoveMarksGroup / createDeleteBlockItem |

**W5 规则**(`eslint.config.js:56-59`):
```js
{ group: ['@capabilities/*'],
  message: 'view 不直接 import capability 运行时值,走 requireCapabilityApi(id) 间接路由;' +
           '类型走 import type from @capabilities/<id>/types(W5 设计 § 5)',
  allowTypeImports: true },
```

5 处违规:**全在 NoteView 端**(graph-canvas-view 此刻还没接入)。stage 04 C2-C5
当时没跑 lint,违规直接进分支 HEAD。

### 1.3 viewId 传递链(D-C 实施验证用)

```
GraphCanvasView L260 enterEdit({ viewId: 'graph-canvas-view' })
  → sessionStore → edit-overlay.tsx L161 Host config.viewId = 'graph-canvas-view'
    ├─ buildSlashPlugin → slashMenuController.show(_, _, 'graph-canvas-view', q)
    │   → SlashMenuBinding 调 slashRegistry.getItemsForView('graph-canvas-view')
    └─ setupFloatingToolbarTrigger → floatingToolbarController.show(_, _, 'graph-canvas-view')
        → FloatingToolbarBinding 调 floatingToolbarRegistry.getItemsForView('graph-canvas-view')
```

当前 `getItemsForView('graph-canvas-view')` 全靠 `scope === 'global'` 短路放行 NoteView 贴的 22 项。

### 1.4 V1 对照(产品判断)

V1 `src/plugins/graph/canvas/edit/InlineToolbar.tsx` + `GraphEditor.ts:84 slashCommandPlugin()`
实证 — V1 画板文字 popup 挂了浮条 + slash menu。V2 `edit-overlay.tsx:42-52` 注释
显式声明"刻意保留"。**画板文字 popup 必须保留 slash + floating-toolbar 通用菜单**。

## 二、设计方案(选项 1 — capability ui.* 命名空间)

### 2.1 类型层 (`capabilities/text-editing/types.ts` 增量 ~20 行)

```ts
import type * as FloatingToolbarFactory from './ui/floating-toolbar/items';
import type * as ToolbarFactory from './ui/toolbar/items';
import type * as SlashMenuFactory from './ui/slash-menu/items';
import type * as HandleMenuFactory from './ui/handle-menu/items';
import type * as ContextMenuFactory from './ui/context-menu/items';

/** PM 通用菜单 item 工厂集(view 通过 requireCapabilityApi 取) */
export interface TextEditingUiApi {
  readonly floatingToolbar: typeof FloatingToolbarFactory;
  readonly toolbar: typeof ToolbarFactory;
  readonly slashMenu: typeof SlashMenuFactory;
  readonly handleMenu: typeof HandleMenuFactory;
  readonly contextMenu: typeof ContextMenuFactory;
}

export interface TextEditingApi {
  // ... 既有字段不动
  readonly ui: TextEditingUiApi;
}
```

**typeof namespace import 设计**:不手列每个工厂签名 — 直接 typeof 整个模块,
工厂内 export 新函数 view 自动可见,零维护负担。`import type` 编译期擦除,view
端 bundle 不引入 `@capabilities/text-editing/ui/*` 运行时模块。

### 2.2 Runtime 层 (`capabilities/text-editing/index.ts` 增量 ~15 行)

```ts
import * as floatingToolbarFactory from './ui/floating-toolbar/items';
import * as toolbarFactory from './ui/toolbar/items';
import * as slashMenuFactory from './ui/slash-menu/items';
import * as handleMenuFactory from './ui/handle-menu/items';
import * as contextMenuFactory from './ui/context-menu/items';

const api: TextEditingApi = {
  // ... 既有字段不动
  ui: {
    floatingToolbar: floatingToolbarFactory,
    toolbar: toolbarFactory,
    slashMenu: slashMenuFactory,
    handleMenu: handleMenuFactory,
    contextMenu: contextMenuFactory,
  },
};
```

### 2.3 view 端改写示例 (`views/note/floating-toolbar-content.ts`)

```ts
// 原(违规):
import {
  createMarkButtons, createMathButton, createLinkButton, createColorButton,
} from '@capabilities/text-editing/ui/floating-toolbar/items';

// 改(合规):
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

const VIEW = 'note-view';

export function registerFloatingToolbar(): void {
  // requireCapabilityApi 必须在函数内调,确保 capability 已 init
  // (模块顶层 import 时 capability 可能未注册)
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui.floatingToolbar;
  floatingToolbarRegistry.register([
    ...ui.createMarkButtons(VIEW),
    ui.createMathButton(VIEW),
    ui.createLinkButton(VIEW),
    ui.createColorButton(VIEW),
  ]);
}
```

调用时机说明:view register 函数都在 view init 时被调,capability 此时必然已注册
(workspace boot 序保证)。**绝不在模块顶层调 requireCapabilityApi** — 见
`views/note/*` 既有合规调用模式(NoteView/note-cache/extraction-import 等都在
函数体或 React useMemo 内调)。

### 2.4 graph-canvas-view 接入(D-C 方案 A)

`views/graph-canvas-view/index.ts` 末尾加 ~20 行:

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';

const VIEW = 'graph-canvas-view';

// canvas-text-node popup 编辑器(viewId='graph-canvas-view')自注册 PM 通用菜单
// 见 docs/refactor/stages/04-lift-pm-editing-to-capability/c8-d-c-design.md(方案 A)
// 注:7 业务插入(image/table/...)留 NoteView,画板文字节点无此语义
function registerTextEditingMenusForCanvas(): void {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui;
  floatingToolbarRegistry.register([
    ...ui.floatingToolbar.createMarkButtons(VIEW),
    ui.floatingToolbar.createMathButton(VIEW),
    ui.floatingToolbar.createLinkButton(VIEW),
    ui.floatingToolbar.createColorButton(VIEW),
  ]);
  slashRegistry.register([
    ...ui.slashMenu.createTurnIntoItems(VIEW),
    ui.slashMenu.createMathBlockItem(VIEW),
  ]);
}

registerTextEditingMenusForCanvas();
```

注意:这里 `registerTextEditingMenusForCanvas()` 在模块加载时立即调一次 —
**但 view module import 时 capability 早已 init**(capability 注册走
`src/capabilities/*/index.ts` 副作用 import,view module 注册在更晚的
`src/views/*/index.ts`,见 workspace boot 序)。

## 三、8-step grep 字面证据(memory feedback_decision_grep_verify_complete_propagation)

| Step | 检查项 | 字面证据 |
|---|---|---|
| 1. view caller | 6 个 view 文件(5 既有 + 1 新增 graph-canvas-view)调工厂 | grep `from '@capabilities/text-editing/ui` → 仅在 5 个 NoteView 文件 + 即将加 graph-canvas-view |
| 2. capability types | `types.ts` 加 `TextEditingUiApi` 接口 + `TextEditingApi.ui` 字段 | 单文件增量,无外部消费者改 |
| 3. capability index | `index.ts` runtime 挂 ui 字段 | 单文件增量 |
| 4. IPC+preload+d.ts | 无 | 纯前端注册,无 IPC |
| 5. 分层 lint | `npm run lint` 必须 0 error | 整改前 5 处,整改后 0 处 |
| 6. SSOT 位置 | ui 命名空间 SSOT = `TextEditingApi.ui` 接口 | 工厂签名直接 typeof,无类型漂移 |
| 7. 间接传播 | view 端 import 路径切换 | 5 NoteView 文件 + 1 graph-canvas-view |
| 8. 跨复用语义 | item id 命名空间 `${viewId}.ft.*` 天然分桶 | NoteView `note-view.ft.bold` 与 canvas `graph-canvas-view.ft.bold` 不撞名 |

## 四、实施 plan(5 commit)

### W-1 — capability 加 ui.* 命名空间(类型 + runtime)

**文件改动**:
- `src/capabilities/text-editing/types.ts`:加 5 个 `import type * as`(类型擦除) + `TextEditingUiApi` 接口 + `TextEditingApi.ui` 字段
- `src/capabilities/text-editing/index.ts`:加 5 个 `import * as` runtime + api.ui 挂载

**验证**:
- typecheck pass
- lint 还是 5 处违规(view 端 import 路径未改,本 commit 不动 view)— **预期**

**Commit message**:
```
refactor(text-editing): W-1 加 ui.* 命名空间(C8 W5 整改起手)

stage 04 C2-C5 期间发现 view 端直 import @capabilities/text-editing/ui/* 工厂
违反 W5 lint(no-restricted-imports)。整改方案:capability 提供 ui.* 子命名空间,
typeof namespace import 零维护暴露 5 个工厂模块。

types.ts:
- TextEditingUiApi 接口(floatingToolbar/toolbar/slashMenu/handleMenu/contextMenu)
- TextEditingApi.ui 字段

index.ts:
- 5 个 namespace runtime import 挂到 api.ui

view 端 import 改写见 W-2(本 commit 不动 view,lint 暂仍 5 处违规)。
```

### W-2 — view 端 5 文件改走 requireCapabilityApi.ui

**文件改动**:
- `views/note/floating-toolbar-content.ts`
- `views/note/toolbar-content.tsx`
- `views/note/slash-menu-content.ts`
- `views/note/handle-menu-content.tsx`
- `views/note/context-menu-content.ts`

每文件改 import block:删 `from '@capabilities/text-editing/ui/*/items'` →
改 `import type { TextEditingApi }` + `import { requireCapabilityApi }`,
register 函数内 `const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui.<sub>;`。

**验证**:
- typecheck pass
- **lint 0 error**(5 处违规清完)
- NoteView 浮条/toolbar/slash/handle/context menu 行为字面零变化

**Commit message**:
```
refactor(views/note): W-2 5 文件 ui 工厂走 requireCapabilityApi.ui(C8 W5 整改)

承接 W-1,view 端 5 个 register 文件改走 capability ui 命名空间间接路由。
原 import @capabilities/text-editing/ui/*/items 直接路径全部下线。

文件:
- floating-toolbar-content.ts
- toolbar-content.tsx
- slash-menu-content.ts
- handle-menu-content.tsx
- context-menu-content.ts

行为字面零变化 — 工厂模块本身不动,仅 view 端 import 路径切换。

验证:npm run lint 0 error(整改前 5 处)。
```

### D-C.1 — graph-canvas-view 自注册 PM 通用菜单(走 W-1 ui 命名空间)

**文件改动**:
- `src/views/graph-canvas-view/index.ts`:加 ~20 行 registerTextEditingMenusForCanvas()

**验证**:
- typecheck + lint pass
- ⚠ scope:'global' 字段仍在 → canvas popup 菜单暂时重复(NoteView scope:'global'
  + canvas 自注册 view='graph-canvas-view' 都通过,浮条 18 / slash 24)— 等 D-C.2

**Commit message**:
```
refactor(graph-canvas-view): D-C.1 自注册 PM 通用菜单(走 capability ui 命名空间)

C8 sub-stage 方案 A 第 1 步:graph-canvas-view 通过 requireCapabilityApi.ui
注册一份 view='graph-canvas-view' 浮条 9 + slash 13 条目,与 NoteView 各自独立。

走 W-1 引入的 TextEditingApi.ui 命名空间,W5 合规。

业务插入 7 项(image/audio/...)留 NoteView,画板文字节点无此语义。

⚠ 中间状态:scope:'global' 字段未删,canvas popup 菜单暂时重复 — D-C.2 删字段
后字面一致。两 commit 紧密连续,中间状态不发布。
```

### D-C.2 — 删 scope:'global' 字段 + 类型 + registry 过滤分支

**文件改动**:
- `src/capabilities/text-editing/ui/floating-toolbar/items.ts`:删 9 处 `scope: 'global',` + 注释 line 18
- `src/capabilities/text-editing/ui/slash-menu/items.ts`:删 13 处 `scope: 'global',` + 注释 line 15
- `src/slot/.../floating-toolbar-types.ts`:删 line 20-28 整段 scope 字段 + jsdoc
- `src/slot/.../slash-types.ts`:删 line 12-17 整段 scope 字段 + jsdoc
- `src/slot/.../floating-toolbar-registry.ts`:删 line 30 `if (item.scope === 'global') return true;` 分支 + 改 jsdoc
- `src/slot/.../slash-registry.ts`:删 line 31 `item.scope === 'global' \|\|` OR 项 + 改 jsdoc

**保留**:registry 的 `item.view === undefined` 历史兼容分支不动(stage 04 范围外,
长期清理挂下一 stage)。

**Commit message**:
```
refactor(slot+text-editing): D-C.2 删 scope:'global' 字段(C8 收尾)

D-C.1 graph-canvas-view 自注册 view='graph-canvas-view' 通用菜单后,
NoteView/canvas 各自独立,scope:'global' 通配机制不再需要。删 26 处:
- 22 处 capability 工厂内 scope: 'global' 字段
- 2 处类型定义 scope?: 'view' | 'global'
- 2 处 registry 过滤分支 scope === 'global'

view === undefined 历史兼容分支不动(stage 04 范围外)。
```

### D-C.3 — 测试清单交付(memory feedback_implementation_test_checklist)

不 commit,文档记录 + 用户验证(stage 04 整体收尾合 main 前最终通过)。

```
typecheck + lint:
  □ npm run typecheck — 0 error
  □ npm run lint — 0 error(整改前 5 处全清)

NoteView 功能不退化:
  □ 编辑区选中一段文字 → 浮条显示 B / I / U / S / <> / ∑ / 🔗 / A 共 9 项
  □ 点 B / I / U / S / <> → 各 mark 切换
  □ 点 🔗 → LinkPanel 弹出
  □ 点 A → ColorPicker 弹出
  □ 编辑区行首输 / → SlashMenu 显示 19 项(13 PM 通用 + 6 业务)— 注:7 业务中
    1 项 file-block 走 paste/drag 路径,slash 仅展示 6 项可触发
  □ 选 H1 → 当前块变 Heading 1
  □ 选 Image → 媒体选择对话框弹出(业务插入正常)
  □ 块 handle ⠿ 点开 → Turn Into / Color 子菜单 + 块操作 4 项
  □ 编辑区右键 → context menu 展示 Cut/Copy/Paste + Select All + 移除格式 + 查词/翻译 + Delete Block
  □ 顶部 toolbar:Heading dropdown + 5 mark + 🔗 + A / A̲ 双按钮工作

canvas-text-node popup 功能不退化:
  □ Graph WorkMode → 打开画板 → 双击文字节点进 popup 编辑
  □ popup 内选中文字 → 浮条显示 B / I / U / S / <> / ∑ / 🔗 / A 共 9 项
  □ popup 内行首输 / → SlashMenu 显示 13 项(11 turn-into + Math Block,无 Image/Table)
  □ 输 / + 关键字 "ima" → 不显示 Image(业务插入留 NoteView)
  □ Esc 退出 popup → 编辑结果保留 / 不保留按 V1 语义

N-1 + W5 验证:
  □ grep -rn "floatingToolbarRegistry.register" src/ → 仅 2 处(NoteView + graph-canvas-view)
  □ grep -rn "slashRegistry.register" src/ → 仅 2 处(NoteView + graph-canvas-view)
  □ grep -rn "scope: 'global'" src/ → 0 处
  □ grep -rn "scope === 'global'" src/ → 0 处
  □ grep -rn "from '@capabilities/text-editing/ui" src/views/ → 0 处(view 全走 ui.* 命名空间)
```

## 五、风险 + 回滚

- **W-1 / W-2 / D-C.1 / D-C.2 4 commits 紧密连续**:
  - W-1 单独完成后 view 仍违规(api.ui 还没人用)— 预期
  - W-2 完成后 lint 0 但 D-C 未做
  - D-C.1 后 canvas 重复菜单(预期,刻意不发布)
  - D-C.2 完成才到一致末状态
- 每 commit 独立可 revert(`git revert <sha>` 逆序)
- 类型字段删除是 breaking change,grep 0 外部消费者(本 sub-stage 范围内)
- 中间状态 D-C.1 / D-C.2 必须连续 commit,push 到 origin 时一次性 push 4 个 commit

## 六、stage 04 整体收尾

W-1 + W-2 + D-C.1 + D-C.2 完成后 stage 04 11 commit(C0~C8 + W-1 + W-2 + D-C.1 + D-C.2)
全部交付。合 main 须用户**显式拍板**(memory feedback_merge_requires_explicit_ok)。
