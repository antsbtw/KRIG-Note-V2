# 任务卡：refactor/platform-skeleton（阶段 02a-platform-skeleton）

> **状态**：草稿 v1
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）
> **派活基线 SHA**：`fc943e46`（main HEAD）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2 推进节奏 / § 5 View-scoped Registry / § 7 三角架构
- 数据契约：[src/shared/intents.ts](../../../../src/shared/intents.ts) / [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts)（阶段 01 已落）
- COMMANDER-PROMPT § 六纪律（基线 SHA 显式 + 字节级实测 + 现状探查）

## 本次范围

**波次 2 第一阶段：建平台骨架（IntentDispatcher + 5 Registry + Capability 目录占位）**

按总纲 § 2.4 / § 7.1 三角架构：本阶段创建**新平台层**文件（main / renderer / capabilities）+ 在 ctx 中追加 `dispatch` 新 API。**旧 API 保留共存**——L5 现有代码继续用 `openCompanion` / `closeRightSlot`，波次 3 各插件迁移时再切到 `dispatch`。

**严格只做"通道建好"**：
- 类型骨架 + 注册函数空壳（具体实现在 02b 与 调用方驱动）
- 不动任何业务代码
- 不创建任何 capability 子目录（02b 工作）

## 本分支只做

按以下顺序：

### J1：新建 `src/main/workspace/intent-dispatcher.ts`

**字节级照抄**——不允许 Builder 自行扩展：

```ts
import type { IntentEvent } from '@shared/intents';

/**
 * IntentDispatcher — L3 层意图调度中心
 *
 * 视图通过 dispatch(IntentEvent) 上抛意图,本类决定布局响应。
 * 取代视图直接调 openCompanion / closeRightSlot 等特权 API 的旧路径。
 *
 * 详见总纲 § 1.1 分层原则 + § 5 View-scoped Registry。
 *
 * v1 仅骨架,具体布局决策逻辑由波次 3 各插件迁移时驱动。
 */
export class IntentDispatcher {
  /**
   * 接收意图事件,决定布局响应。
   * v1 仅日志,实际布局调度由后续阶段实现。
   */
  dispatch(event: IntentEvent): void {
    // eslint-disable-next-line no-console
    console.log('[IntentDispatcher] received intent:', event.type, event);
  }
}

/** 全局单例——平台层共用一个 dispatcher */
export const intentDispatcher = new IntentDispatcher();
```

**关键约束**：
- **字节级照抄上述代码**
- 仅 1 个 import（type-only）
- 类 + 单例 export
- v1 实现仅 console.log（具体调度逻辑后续阶段填）

### J2：修改 `src/main/app.ts` ctx 加 `dispatch` 新 API

在现有 `function registerPlugins()` 内的 ctx 对象中**追加**两行（不删除任何现有字段）：

```diff
 function registerPlugins(): void {
+  // 新通道:视图通过 dispatch(IntentEvent) 上抛意图(总纲 § 1.1 + § 7)
+  // 旧 openCompanion / ensureCompanion 保留供 L5 现有代码使用,直至各插件迁移
   const ctx = {
     getMainWindow,
     openCompanion: openRightSlot,
     ensureCompanion: openRightSlot, // ensureRightSlot 内部逻辑相同
     getSlotBySenderId,
     getActiveViewWebContentsIds,
     runWithProgress,
+    dispatch: (event: IntentEvent) => intentDispatcher.dispatch(event),
   };
```

并在文件顶部 import 区追加：

```diff
+import { intentDispatcher } from './workspace/intent-dispatcher';
+import type { IntentEvent } from '@shared/intents';
```

**关键约束**：
- **不删除**任何现有 ctx 字段（`openCompanion` / `ensureCompanion` 等保留——共存策略）
- **不修改**任何 `register*Plugin(ctx)` 调用
- import 形式与现有 `import` 行风格一致

### J3：新建 `src/renderer/ui-primitives/command-registry.ts`

字节级照抄：

```ts
import type { CommandHandler } from '@shared/ui-primitives';

/**
 * CommandRegistry — 命令注册中心
 *
 * 五大交互组件(ContextMenu / Toolbar / Slash / Handle / FloatingToolbar)
 * 的菜单项 command 字段是字符串,实际函数在此注册。
 *
 * 详见总纲 § 5.5 强约束第 2 条:command 必须字符串引用。
 *
 * v1 仅骨架,具体命令在 02b/03 由 capability + view 注册。
 */
class CommandRegistryImpl {
  private commands = new Map<string, CommandHandler>();

  register(id: string, handler: CommandHandler): void {
    if (this.commands.has(id)) {
      // eslint-disable-next-line no-console
      console.warn('[CommandRegistry] command already registered, overwriting:', id);
    }
    this.commands.set(id, handler);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  get(id: string): CommandHandler | undefined {
    return this.commands.get(id);
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }
}

export const commandRegistry = new CommandRegistryImpl();
```

**关键约束**：
- **字节级照抄**
- 仅 1 个 type-only import
- 类不导出（仅导出单例 `commandRegistry`）

### J4：新建 5 个 ui-primitives 子目录 + 各自 index.ts

为每个交互类型创建子目录 + `index.ts`，路径分别：
- `src/renderer/ui-primitives/context-menu/index.ts`
- `src/renderer/ui-primitives/toolbar/index.ts`
- `src/renderer/ui-primitives/slash/index.ts`
- `src/renderer/ui-primitives/handle/index.ts`
- `src/renderer/ui-primitives/floating-toolbar/index.ts`

每个 index.ts **字节级照抄**对应模板（仅 ItemType 名不同）：

#### `context-menu/index.ts`

```ts
import type { ContextMenuItem } from '@shared/ui-primitives';

/**
 * ContextMenuRegistry — 右键菜单注册中心
 *
 * v1 骨架:支持按 viewId 注册菜单项;具体渲染在 02b/03 完成。
 * 详见总纲 § 5.4 数据契约 + § 5.7 五大交互的统一与差异。
 */
class ContextMenuRegistryImpl {
  private itemsByViewId = new Map<string, ContextMenuItem[]>();

  register(viewId: string, items: ContextMenuItem[]): void {
    this.itemsByViewId.set(viewId, items);
  }

  unregister(viewId: string): void {
    this.itemsByViewId.delete(viewId);
  }

  getItems(viewId: string): ContextMenuItem[] {
    return this.itemsByViewId.get(viewId) ?? [];
  }
}

export const contextMenuRegistry = new ContextMenuRegistryImpl();
```

#### 其他 4 个子目录的 index.ts

按上述 `context-menu/index.ts` **完全相同的结构**，仅做以下替换：

| 子目录 | ItemType | 单例名 |
|---|---|---|
| `toolbar` | `ToolbarItem` | `toolbarRegistry` |
| `slash` | `SlashItem` | `slashRegistry` |
| `handle` | `HandleItem` | `handleRegistry` |
| `floating-toolbar` | `FloatingToolbarItem` | `floatingToolbarRegistry` |

注释中"右键菜单"也对应替换为"工具栏"/"Slash 命令"/"块手柄菜单"/"浮动工具栏"。

**关键约束**：
- **5 个文件结构完全一致**（仅 ItemType + 单例名 + 注释名词不同）
- 仅 1 个 type-only import（对应 ItemType）
- 类不导出（仅导出 5 个单例）

### J5：新建 `src/capabilities/README.md`（占位）

`src/capabilities/` 目录现在不存在。Builder 创建该目录 + 占位 README.md：

```markdown
# Capabilities

跨视图共享的能力单元。本目录是 KRIG 重构期第一公民目录(总纲 § 4.1 / § 5)。

## 当前状态(阶段 02a-platform-skeleton)

**目录占位中**——尚无任何 capability 实质内容。

具体 capability(text-editing / web-rendering / canvas-interaction / pdf-rendering 等)
将在阶段 02b 起按需封装外部依赖逐个进入此目录。详见总纲 § 5.9 KRIG 可识别的能力清单。

## 设计原则

详见 [docs/refactor/00-总纲.md](../../docs/refactor/00-总纲.md):
- § 1.3 抽象原则:外部依赖一律经 Capability 封装零例外
- § 5.4 数据契约 Capability 类型骨架(已落 src/shared/ui-primitives.ts)
- § 5.5 强约束(命名空间 + 禁套娃 + 颗粒度)
- § 5.8 视图是声明,实现都在 Capability 里

## 不在本目录的实现

- 视图(View)→ `src/plugins/<X>/views/`
- 平台 Registry → `src/renderer/ui-primitives/`
- 意图调度 → `src/main/workspace/intent-dispatcher.ts`
```

**关键约束**：
- **字节级照抄**
- 路径 `src/capabilities/README.md` 严格匹配
- 不创建任何 `src/capabilities/<x>/` 子目录(02b 工作)

## 严禁顺手做

- ❌ **不修改** 18 个含特权 API 调用的文件(波次 3 处理):
  - navside 类:src/renderer/navside/{panel-registry.ts,NavSide.tsx} / 4 个 plugins navside
  - commands 类:src/plugins/note/commands/ask-ai-command.ts
  - ipc 类:src/plugins/web/main/ipc-handlers.ts
- ❌ **不修改** 任何含 ProseMirror 的 plugins 文件(69 个文件,02b 处理)
- ❌ **不修改** 任何含 Three.js 的 plugins 文件(8 个文件,02b 处理)
- ❌ **不创建** 任何 `src/capabilities/<x>/` 子目录(02b 工作)
- ❌ **不创建** 任何 `src/plugins/<X>/views/` 目录(波次 3 工作)
- ❌ **不修改** ESLint 规则(阶段 01 已立)
- ❌ **不修改** schema-* 文件
- ❌ **不修改** intents.ts / ui-primitives.ts(阶段 01 已落)
- ❌ **不删除** ctx 中现有 openCompanion / ensureCompanion 字段(共存策略)
- ❌ **不修改** memory 文件
- ❌ **不擅自做** merge / push(列命令交回 Commander)

## 完成判据

每条 Builder 必须证明:

- [ ] **J1**: `src/main/workspace/intent-dispatcher.ts` 字节级匹配 task-card § J1
- [ ] **J2a**: `src/main/app.ts` ctx 含 `dispatch: (event: IntentEvent) => intentDispatcher.dispatch(event)` 字段
- [ ] **J2b**: `src/main/app.ts` 顶部 import 区含 `import { intentDispatcher } from './workspace/intent-dispatcher'` + `import type { IntentEvent } from '@shared/intents'`
- [ ] **J2c**: ctx 中 `openCompanion` / `ensureCompanion` / `getMainWindow` / `getSlotBySenderId` / `getActiveViewWebContentsIds` / `runWithProgress` 6 个原有字段全部保留(共存策略)
- [ ] **J2d**: 5 个 `register*Plugin(ctx)` 调用全部保留未动
- [ ] **J3**: `src/renderer/ui-primitives/command-registry.ts` 字节级匹配 task-card § J3
- [ ] **J4a**: 5 个子目录 `src/renderer/ui-primitives/{context-menu,toolbar,slash,handle,floating-toolbar}/index.ts` 全部存在
- [ ] **J4b**: 5 个 index.ts 内容字节级匹配各自模板(仅 ItemType + 单例名 + 注释名词替换)
- [ ] **J5**: `src/capabilities/README.md` 字节级匹配 task-card § J5
- [ ] **J5b**: `src/capabilities/` 下**无任何子目录**(`find src/capabilities -type d` 仅输出 `src/capabilities` 自身)
- [ ] **J6**: `git diff fc943e46..HEAD --stat`(**强制双点 diff + 显式基线 SHA `fc943e46`**)含且仅含以下 9 个文件:
      - `src/main/workspace/intent-dispatcher.ts`(新建)
      - `src/main/app.ts`(修改)
      - `src/renderer/ui-primitives/command-registry.ts`(新建)
      - `src/renderer/ui-primitives/context-menu/index.ts`(新建)
      - `src/renderer/ui-primitives/toolbar/index.ts`(新建)
      - `src/renderer/ui-primitives/slash/index.ts`(新建)
      - `src/renderer/ui-primitives/handle/index.ts`(新建)
      - `src/renderer/ui-primitives/floating-toolbar/index.ts`(新建)
      - `src/capabilities/README.md`(新建)
      - **绝不允许**用 `main...HEAD` 三点 diff(本阶段无 Commander 派活 commit 在分支上,但仍按总规则统一)
- [ ] **J7a**: `npm run typecheck` exit 0
- [ ] **J7b**: `npm run lint` exit 1,778 problems 与基线一致(本次新增 9 文件不应引入新增 lint problem)
- [ ] **J7c**: `npm run lint:dirs` exit 0(白名单豁免有效;不得新增违规目录)
- [ ] **J8**: 所有 commit message 符合 CLAUDE.md `feat/fix(refactor/platform-skeleton): ...` 格式

## 已知风险

- **R1**: ctx 改动后 5 个 `register*Plugin(ctx)` 调用接收 ctx 含新字段。各 plugin 类型应已自动接受(plugin-types.ts `PluginContext` 接口需确认是否影响)——Builder 启动后第一步实测 `npm run typecheck` 是否通过(预期通过——`dispatch` 字段在 PluginContext 接口中可能需要追加)
- **R2(已 grep 验证)**: 视图层禁外部依赖 J5.4 规则不影响本阶段——本阶段仅在 main / renderer / shared / capabilities 创建文件,不在 `src/plugins/<X>/views/` 创建
- **R3(已实测)**: Commander 已模拟创建 `intent-dispatcher.ts` import `@shared/intents` 后 `npm run typecheck` exit 0——path alias 工作正常
- **R4(已 grep 验证)**: 18 个含特权 API 调用的文件分布在 navside / commands / main IPC,本阶段全部不动,共存策略保留旧 API
- **R5**: `commandRegistry` / `contextMenuRegistry` 等单例的具体使用要等到 02b/03 阶段才有调用方——v1 即便创建后未被任何业务代码 import,也是预期(占位骨架)。Builder 不擅自添加调用示例
- **R6**: `src/main/app.ts` 现已 import `openRightSlot`(line 2),Builder 不动这个 import——它仍为旧 API ctx 字段服务

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认(已答)

1. **PluginContext 接口是否需要追加 `dispatch` 字段** —— **Commander 答**:**追加**(在 `src/shared/plugin-types.ts` 同步加 `dispatch: (event: IntentEvent) => void` + import IntentEvent)。J2 应隐含此变更。Builder 实测后若 typecheck 失败再补——这种情况下 PluginContext 改动作为 J2 的一部分自然纳入(注:此变更**仅限** plugin-types.ts 中 PluginContext 接口字段,不动其他 plugin-types.ts 内容)
2. **5 个 ui-primitives 子目录的 index.ts 字面顺序** —— **Commander 答**:无所谓,Builder 自决(建议字典序便于审计)
3. **`commandRegistry` 等单例日后调用方在哪** —— **Commander 答**:不在本阶段考虑。02b 各 capability 实现 createInstance 时调注册;03 各 view 启动时挂载
4. **`@renderer/ui-primitives/*` 是否需要在 tsconfig.json `paths` 中加别名** —— **Commander 答**:**不加**(本阶段保持 tsconfig 不变,符合"不动 ESLint/tsconfig"约束)。需要时由 02b 或波次 3 起草时再加
5. **如果 plugin-types.ts 修改触发其他文件 typecheck 失败怎么办** —— **Commander 答**:升级 BLOCKING,不擅自修业务代码。J2 修订范围仅限 PluginContext 接口字段追加;若引发其他文件 type 错误,说明 PluginContext 在 plugins 内有强类型契约依赖——这是波次 3 才该处理的耦合。回报让 Commander 起草前置子任务

## Builder 完成后

- 写报告到 `tmp/builder-report.md`(按 BUILDER-PROMPT § 五格式)
- 输出"builder-report 就绪:tmp/builder-report.md"
- **不做** merge / push(列命令给 Commander)

## 备注:本次为基础设施类阶段

本次为波次 2 第一阶段(平台骨架),只建通道,不动业务代码。BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动自检"契约 § B 防御代码 grep 验证"跳过。
