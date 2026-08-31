# Auditor 审计指令 — 阶段 02a：平台骨架

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入（按顺序）

1. **本目录文件**：
   - [README.md](README.md)
   - [task-card.md](task-card.md) — 完成判据 J1~J8（共 16 子项）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3 § 2 / § 5 / § 7
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出**：
   - `tmp/builder-report.md`
   - `git diff fc943e46..refactor/platform-skeleton --stat`（**双点 diff + 显式基线 SHA**）
   - `git log fc943e46..refactor/platform-skeleton --oneline`

## 二、本次审计要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/platform-skeleton` |
| 派活基线 SHA | `fc943e46`（task-card 强制使用此 SHA） |
| 审计阶段 | 基础设施类阶段（不动业务代码） |
| 功能契约 | **N/A** |
| 关键审计点 | A 段总纲合规 + 16 子项判据 + 范围越界 + J2 共存策略 + 5 个 index.ts 字节级一致 |
| 基线状态 | typecheck=0 / lint=1 (778 problems) / lint:dirs=0 |

## 三、特别关注

### 关注点 1：J1 / J3 / J4 / J5 字节级对账（与阶段 00/01 同模式）

**逐项 Read 文件 + Read task-card 对应代码块逐字符对照**：

| J | 文件 | task-card 段 |
|---|---|---|
| J1 | `src/main/workspace/intent-dispatcher.ts` | § J1 代码块 |
| J3 | `src/renderer/ui-primitives/command-registry.ts` | § J3 代码块 |
| J4 | `src/renderer/ui-primitives/{context-menu,toolbar,slash,handle,floating-toolbar}/index.ts` 共 5 个 | § J4 模板 |
| J5 | `src/capabilities/README.md` | § J5 代码块 |

**任何字符不一致 = ❌**——即便 Builder 解释"我改得更好"也不接受。

### 关注点 2：J4 五个 index.ts 内部一致性

5 个 ui-primitives 子目录的 index.ts 必须**结构完全相同**，仅以下三处不同：
- `import type { <ItemType> }` 的 ItemType（5 种）
- `class <Xxx>RegistryImpl` + `export const <xxx>Registry`（5 种）
- 注释中的"右键菜单"/"工具栏"/"Slash 命令"/"块手柄菜单"/"浮动工具栏"

**审计步骤**：Read 5 个文件，逐行对比框架结构是否一致。任何额外差异（如某个文件多/少一个方法）= ❌。

### 关注点 3：J2 共存策略——旧 API 必须保留

`src/main/app.ts` 的 ctx 对象**必须**包含以下 7 个字段（6 旧 + 1 新）：
- ✅ `getMainWindow`（保留）
- ✅ `openCompanion`（保留——共存策略）
- ✅ `ensureCompanion`（保留——共存策略）
- ✅ `getSlotBySenderId`（保留）
- ✅ `getActiveViewWebContentsIds`（保留）
- ✅ `runWithProgress`（保留）
- ✅ `dispatch`（新增）

**任意旧字段被删 = ❌**（违反共存策略，会让 L5 现有代码立即坏掉）

5 个 `register*Plugin(ctx)` 调用必须保留未动（grep `registerNotePlugin\|registerEBookPlugin\|registerWebPlugin\|registerThoughtPlugin\|registerGraphPlugin` in `src/main/app.ts`）。

### 关注点 4：J2 PluginContext 接口同步

如果 Builder 在 J2 中改动了 `src/shared/plugin-types.ts` 的 PluginContext 接口（task-card Q1 答中已预批为允许），审计**仅允许**：
- 追加 `dispatch: (event: IntentEvent) => void` 字段
- 追加对应的 `import type { IntentEvent } from '@shared/intents'`

**不允许**：
- 修改其他 PluginContext 字段
- 修改 plugin-types.ts 中其他类型定义
- 修改注释（除 dispatch 字段简短说明）

### 关注点 5：范围越界（C 段）

**Builder 引入的 diff 必须严格仅含以下 9 个文件**（task-card § J6 列表，加上 J2 隐含的 plugin-types.ts 是 10 个）：
- `src/main/workspace/intent-dispatcher.ts`（新建）
- `src/main/app.ts`（修改）
- `src/renderer/ui-primitives/command-registry.ts`（新建）
- `src/renderer/ui-primitives/context-menu/index.ts`（新建）
- `src/renderer/ui-primitives/toolbar/index.ts`（新建）
- `src/renderer/ui-primitives/slash/index.ts`（新建）
- `src/renderer/ui-primitives/handle/index.ts`（新建）
- `src/renderer/ui-primitives/floating-toolbar/index.ts`（新建）
- `src/capabilities/README.md`（新建）
- `src/shared/plugin-types.ts`（J2 隐含变更，仅追加 dispatch 字段）

**任意业务文件出现在 diff 中 = ❌**：
- 18 个含特权 API 的文件全部不动
- 任何含 ProseMirror（69 文件）或 Three.js（8 文件）的文件不动
- schema-* 不动
- ESLint 配置 / tsconfig.json / package.json 不动

### 关注点 6：`src/capabilities/` 仅占位

`find src/capabilities -type d` 应**仅输出** `src/capabilities` 自身。**不允许**：
- 任何 `src/capabilities/<x>/` 子目录
- 任何 `.ts` / `.js` / `.mjs` 文件

只允许 `README.md` 一个文件。

### 关注点 7：J7 三件命令独立重跑

```bash
git checkout refactor/platform-skeleton
npm run typecheck > /tmp/audit-tc.log 2>&1; echo "tc: $?"   # 预期 0
npm run lint > /dev/null 2>&1; echo "lint: $?"               # 预期 1
npm run lint > /tmp/audit-lint.log 2>&1
grep "✖" /tmp/audit-lint.log | tail -1                       # 预期 778 problems(与基线一致)
npm run lint:dirs > /tmp/audit-dirs.log 2>&1; echo "dirs: $?"  # 预期 0
grep "白名单已豁免" /tmp/audit-dirs.log                        # 预期含此摘要
```

**有任一不符 = ❌**

特别注意：lint problems **必须**与阶段 01 baseline 778 完全一致——本阶段创建的 9 个新文件不应引入新 lint problem（如有，说明新文件违规或 ESLint 配置漂移）。

### 关注点 8：J6 用 Builder 引入的 diff 口径

**强制使用** `git diff fc943e46..refactor/platform-skeleton --stat`（双点 diff + 显式基线 SHA）。

**不允许**用 `main...HEAD` 三点 diff。

> 本阶段 main HEAD 当前就是 fc943e46（task-card 起草时的派活基线），双点与三点理论上等价。但仍按 COMMANDER-PROMPT § 六新纪律统一使用双点 + 显式 SHA——审计员模板对齐总规则。

### 关注点 9：Builder G 段自决检查

读 builder-report.md G 段。本阶段 task-card 已答 5 条预期歧义，Builder 自决空间极小。任何 G 段标注的自决都需 Auditor 独立验证：
- 是否在 task-card 字面授权范围内？
- 是否引入未授权改动？

任何"超越 task-card 字面"的决断标 ⚠️ 待证明。

## 四、审计输出

按 AUDITOR-PROMPT § 四格式。要点：
- B 段（功能契约保留）填 "N/A 基础设施类阶段"
- D 段（Step B 合规）跳过
- 总评：通过 / 不通过 / 待 Builder 证明

## 五、审计纪律强提醒

- ❌ 不读 memory
- ❌ 不被 Builder 解释说服——**只看代码 + task-card**
- ❌ 不写代码、不修复
- ✅ 字节级对账 J1/J3/J4/J5（与阶段 00 J2b / 阶段 01 J5.5a 同模式）
- ✅ J7 自己跑命令对账
- ✅ J2 共存策略 7 字段 + 5 个 register 调用逐项 grep

---

**记住**：本阶段比阶段 01 简单（只建通道，不改旧代码），但字节级对账更严——5 个 ui-primitives 子目录的内部一致性是新审计点。审计完成立即结束会话。
