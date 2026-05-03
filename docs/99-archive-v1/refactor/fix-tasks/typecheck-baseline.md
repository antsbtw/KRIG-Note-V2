# 修复任务（轻量）：仓库历史 type 债清理 → typecheck baseline

> **状态**：草稿
> **创建**：2026-05-02 by Commander
> **目标分支**：`fix/typecheck-baseline`（Builder 从 main 切出）
> **类型**：常规 fix PR（**不走 Auditor 三角**——纯历史 type 债清理）

---

## 为什么是"轻量任务"不是"阶段"

本任务**不在 docs/refactor/stages/ 目录下**，原因：

1. 这是仓库历史 type 错误清理，**与重构机制无因果关系**——KRIG 历来未跑 typecheck，这些错误早就存在
2. 修复方式简单，验证标准客观（`tsc --noEmit` 退出码 0）
3. 不涉及任何重构期产出（不动 schema、不动 Capability、不动 ViewDefinition）
4. Auditor 介入价值低——审什么？没有规则可对账

但它仍由 Builder 执行（Commander 不写代码）。本任务卡是给 Builder 的轻量指令。

## 任务速览

| 项 | 值 |
|---|---|
| 目标分支 | `fix/typecheck-baseline`（Builder 从 main 切出） |
| 错误来源 | 4 处仓库历史 type 错误（`WebkitAppRegion` ×3 + `view.webContents` ×1） |
| 完成判据 | 所有 4 处清零；不引入新 type error |
| 严禁顺手做 | 重构期产出不动（schema-* 文件已由 [stages/00x-schema-completion](../stages/00x-schema-completion/README.md) 处理并 merge 到 main） |

## 引用

- 前置依据：[tmp/builder-blockers.md](../../../tmp/builder-blockers.md) B1（阶段 00 Builder 报告 6 处 type error，本任务修其中 4 处）
- 总纲：[docs/refactor/00-总纲.md](../00-总纲.md) v2.3（仅 § 1.3 规则约束 import 范围；本任务不涉及 import 改动）
- CLAUDE.md（提交规范）

## 4 处错误详细

```
src/main/ipc/handlers.ts(454,7): error TS18046:
  'view.webContents' is of type 'unknown'.

src/renderer/shell/WorkspaceBar.tsx(176,5): error TS2353:
  Object literal may only specify known properties, and 'WebkitAppRegion'
  does not exist in type 'Properties<string | number, string & {}>'.

src/renderer/shell/WorkspaceBar.tsx(196,5): error TS2353: (同上)
src/renderer/shell/WorkspaceBar.tsx(240,5): error TS2353: (同上)
```

## 推荐修法（可选，Builder 自决具体写法）

### 错误 1：`handlers.ts:454` view.webContents is unknown

**Builder 自决**两种合法修法：

**修法 A**（类型断言）：
```ts
const view = ...;  // 假设这里类型是 unknown
(view as Electron.WebContentsView).webContents.send(...);
// 或
const wc = (view as { webContents: Electron.WebContents }).webContents;
wc.send(...);
```

**修法 B**（找到 view 的源头加正确类型注解）：
推荐的修法。Builder 顺着 view 变量的声明往上找，给它加上正确类型。

**Commander 倾向**：修法 B（根治，不留断言痕迹）。但如果 view 类型在 IPC 协议层面无法静态推断，允许修法 A。

### 错误 2~4：`WorkspaceBar.tsx` WebkitAppRegion ×3

这是 Electron 的拖拽区域 CSS 属性，React 类型系统不识别。**业界惯例修法**：

**修法 A**（类型断言，最简单）：
```tsx
<div style={{ ...others, WebkitAppRegion: 'drag' } as React.CSSProperties}>
```

**修法 B**（类型扩展，全局）：
在 `src/renderer/types/css.d.ts`（新建）或现有全局类型声明中：
```ts
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}
```

**Commander 倾向**：修法 B（一次性根治，不在 3 处用断言）。新建类型声明文件即可。

## 完成判据

- [ ] **F1**: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | wc -l` 输出 **0**（从基线 4 处历史 type 债清零；00x-schema-completion 已 merge 到 main，本分支已 rebase 到 main 之后基线为 4 处）
- [ ] **F2**: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "WebkitAppRegion"` 输出空
- [ ] **F3**: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "handlers.ts.*webContents.*unknown"` 输出空
- [ ] **F4**: `git diff main...HEAD --stat` 仅包含 `src/main/ipc/handlers.ts` + `src/renderer/shell/WorkspaceBar.tsx`（修法 A）；或追加一个 `src/renderer/types/css.d.ts`（修法 B）
- [ ] **F5**: 不修改任何业务逻辑（仅类型层面）
- [ ] **F6**: 所有 commit message 符合 CLAUDE.md（建议 `fix(typecheck): clear baseline type errors`）

## 严禁顺手做

- ❌ **不动 schema-* 任何文件**——schema 骨架已由 [stages/00x-schema-completion](../stages/00x-schema-completion/README.md) 处理完毕并 merge 到 main
- ❌ **不修改任何业务逻辑**（仅类型层面）
- ❌ **不重构** view / Electron 相关代码
- ❌ **不删除** `view.webContents` 调用代码
- ❌ **不优化** WorkspaceBar.tsx 的 inline style 写法（即便看起来丑）
- ❌ **不动** 任何与上述 2 个文件无关的代码
- ❌ **不擅自做** merge / push（列命令交回 Commander）

## Builder 流程（轻量）

```
1. git checkout main
2. git checkout -b fix/typecheck-baseline
3. mkdir -p tmp
4. 启动自检写 tmp/builder-startup.md（按 BUILDER-PROMPT § 四格式但简化）
   - 列基线: tsc 错误数当前是多少？哪几处？
5. 选定修法（A 或 B）→ 修代码 → commit
6. 跑 tsc 验证 F1~F3
7. 写 tmp/builder-report.md（按 BUILDER-PROMPT § 五简化）
8. 输出"builder-report 就绪"，会话结束
```

**不走 Auditor**——Commander 直接读 builder-report 决定是否 merge。如果 Commander 看 builder-report 觉得改法可疑，可以发起一次性 grep 自审；如果改法清晰、tsc 退出码 0，直接交用户拍板 merge。

## 与其他并行任务的关系

```
main (bd390c70)
 ├── refactor/eslint-bootstrap     ← 阶段 00（被 B1+B2 阻塞）
 ├── refactor/schema-interop-completion ← 阶段 00x（schema 补全）
 └── fix/typecheck-baseline        ← 本任务（历史 type 债）
                                       三个分支并行,merge 顺序无所谓
                                              ↓
                                       三个全部 merge 到 main 后
                                              ↓
                                       阶段 00 task-card 修订(改 .mjs)
                                              ↓
                                       阶段 00 重启,Builder 跑 J0~J5 全通
                                              ↓
                                       阶段 01-contracts 重启
```
