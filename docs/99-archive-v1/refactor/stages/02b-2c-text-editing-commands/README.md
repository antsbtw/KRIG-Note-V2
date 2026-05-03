# 阶段 02b-2c：text-editing capability commands 临时引用 plugin（02b 系列收尾）

> **状态**：待执行
> **目标分支**：`refactor/text-editing-commands`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（commands 临时引用 plugin，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`fe219294`（main HEAD，含阶段 02b-2b merge）

---

## 阶段目标

在阶段 02b-2b 已填入 schema/converters 字段之后，**填入 `commands` 字段**——临时引用 `plugins/note/commands/editor-commands.ts` 内 8 个核心文本编辑命令。

> **本阶段是 02b 系列收尾**——之后 textEditingCapability 5 字段中 4 个填入（id/schema/converters/commands），仅 createInstance 留 undefined 直到波次 3。

按总纲 § 2 推进策略 + 02b-2b 已建样板：capability 通过 import plugin 内现有命令导出**声明意图**，不搬业务代码。

## 重要决策记录：原"02b-2c createInstance"跳过

Commander 探查发现 NoteEditor.tsx 内 PM 实例创建与 React 生命周期深度耦合（5 个 ref + 3 个回调链 + dispatchTransaction 副作用 + createTocIndicator）——**临时引用模式失效**：
- ❌ buildPlugins 是 file-internal 函数,未导出
- ❌ EditorView 创建嵌在 useEffect 内,无独立工厂
- ❌ React refs/callbacks 不能脱离组件上下文

**决策**：原 02b-2c createInstance 跳过,推到波次 3 note 整体迁移时一并抽工厂函数。本阶段（重命名后的 02b-2c）做 commands 临时引用——这是 02b-2 系列收尾。

## 阶段产出（按 task-card 完成判据 J1~J5 验证）

1. **J1** `src/capabilities/text-editing/index.ts` 升级：填入 `commands` 字段（8 个命令引用 plugin/note）
2. **J2** `src/capabilities/text-editing/README.md` 状态段同步（含"02b 系列收尾"说明）
3. **J3** `src/capabilities/README.md` 状态段同步（含 4 SHA 嵌入）
4. **J4** 范围对账（双点 diff + 显式基线 SHA `fe219294`，含且仅含 3 文件）
5. **J5** typecheck=0 / lint warnings=15 不变 / lint:dirs=0

## Commander 起草前的现状探查 + 实测（按 § 六纪律 1+2+4）

1. **commands/ 7 文件特征**（已读）：
   - 总行数 1774；总导出 ~30 个函数
   - **完全无 React 依赖**（`grep -l "react"` 输出空）
   - 命令签名：`(view: EditorView, ...args) => boolean / void / Promise<...>`
   - 与 `CommandHandler = (...args: unknown[]) => unknown | Promise<unknown>` 完全兼容（宽松类型）

2. **8 个核心命令选择**（来自 editor-commands.ts）：
   - `toggleMarkCommand` / `applyLink` / `removeLink` / `indentBlockAt` / `outdentBlockAt` / `setTextAlign` / `insertInlineMath` / `deleteCurrentBlock`
   - 选择标准：粗体/斜体/链接/缩进/对齐/数学/删除——文本编辑最核心常用命令
   - 不引入：AI 命令（`askAI`）/ Thought 命令（`addThought`）/ Markdown 命令（`selectionToMarkdown`）/ Frame 命令——避免 capability.text-editing 跨域

3. **命令 id 命名空间**：`text-editing.<command-name>`（kebab-case）
   - 例：`text-editing.toggle-mark` / `text-editing.apply-link`
   - 符合总纲 § 5.5 强约束第 4 条（capability id 命名空间化）

4. **实测验证**（Commander 已做）：
   ```ts
   const textEditingCommands: Record<string, CommandHandler> = {
     'text-editing.toggle-mark': toggleMarkCommand as CommandHandler,
     // ... 共 8 个
   };
   ```
   实测结果：typecheck exit 0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅

5. **没有越界**：plugin/note 文件零改动；createInstance 字段保持 undefined（不在本阶段范围）

## 02b 系列总结

完成本阶段后，textEditingCapability 最终形态：

| 字段 | 状态 | 阶段 |
|------|------|------|
| `id` | ✅ `'capability.text-editing'` | 02b-1 |
| `schema` | ✅ 临时引用 `blockRegistry` | 02b-2b |
| `converters` | ✅ ConverterPair 适配 `converterRegistry` | 02b-2b |
| `commands` | ✅ 8 个命令临时引用 | **02b-2c（本阶段）** |
| `createInstance` | ⏳ undefined | 留波次 3 |

**02b 系列价值**：
1. 验证 Capability 接口可实例化（02b-1）
2. 验证字段占位语义（02b-2a）
3. 验证临时引用模式可行（02b-2b：schema/converters）
4. 验证 commands 临时引用（02b-2c）
5. 暴露 createInstance 与 React 深度耦合的真问题——推到波次 3 解

**为后续 capability（canvas-interaction / web-rendering 等）建立稳定可复制样板**。

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览（本文件） | 全员参考 |
| [task-card.md](task-card.md) | 任务卡：J1~J5 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令 | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令 | Auditor 读 |

## 全局引用

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2 + § 5.4 + § 5.5 + § 5.8 | 全员必读 |
| [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability + CommandHandler | 引用 |
| [src/plugins/note/commands/editor-commands.ts](../../../../src/plugins/note/commands/editor-commands.ts) | capability 引用对象（**不修改**） |
| [src/capabilities/text-editing/index.ts](../../../../src/capabilities/text-editing/index.ts) | J1 修改对象 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备（含现状探查 + 实测） | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
