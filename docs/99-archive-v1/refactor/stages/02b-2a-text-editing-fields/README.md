# 阶段 02b-2a：text-editing Capability 字段占位（接口具体化）

> **状态**：待执行
> **目标分支**：`refactor/text-editing-fields`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（仅升级 capability 接口字段占位，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`252d8e69`（main HEAD，含阶段 02b-1 merge）

---

## 阶段目标

在阶段 02b-1 已实例化 `textEditingCapability`（仅 id 字段）之后，**升级该 capability 的接口字段为占位形态**——含 schema / converters / createInstance / commands 字段（全部 `undefined` 占位 + 详细注释指明各子阶段填充时机）。

> **核心价值**：建立 capability 内部"字段占位待填"的形态契约，作为 02b-2b/c/d 实质搬迁时的对账标尺——届时各子阶段把对应字段从 `undefined` 改为真实实现。

按 02b-1 § README "02b-2 起草指引"修订后的拆分（基于 Commander 探查 9 子目录的真实依赖图）：

| 子阶段 | 范围 | 文件估计 |
|---|---|---|
| **02b-2a**（本阶段） | textEditingCapability 接口字段占位（仅 capability/index.ts + 2 README）| 3 |
| 02b-2b | converters/ 9 文件 + 5 处外部调用方一起搬 | ~15 |
| 02b-2c | blocks/ 15 + commands/ 7 + plugins/ 17 文件 | ~39 |
| 02b-2d | components/ 9 + NoteEditor 入口改造 + graph atom-bridge.ts 修跨插件违规 | ~12 |

## 阶段产出（按 task-card 完成判据 J1~J5 验证）

1. **J1** 升级 `src/capabilities/text-editing/index.ts`：textEditingCapability 含 schema/converters/createInstance/commands 字段（全 `undefined` 占位 + 注释）
2. **J2** 更新 `src/capabilities/text-editing/README.md`："当前状态"段从"仅最小骨架(id)"升级到"含字段占位待填"
3. **J3** 更新 `src/capabilities/README.md`："## 当前状态"段同步（仅段内文字微调，不动其他段）
4. **J4** 范围对账（双点 diff + 显式基线 SHA `252d8e69`）含且仅含 3 文件
5. **J5** typecheck=0 / lint warnings=15 不变 / lint:dirs=0

## Commander 起草前的现状探查（按 § 六纪律 1+2+4）

1. **Capability 接口类型探查**（已做）：
   - `SchemaContribution` / `HostElement` / `CapabilityOptions` / `CapabilityInstance` 是 `unknown` 占位（阶段 01 故意留宽）
   - `ConverterPair` 有具体形状 `{ toAtom, fromAtom }`，参数都是 `unknown`
   - 所有字段都是 optional——可以全部 `undefined` 或不写

2. **实测验证**（已做）：
   - `undefined` 占位 + 完整字段声明 → typecheck exit 0 ✅
   - 不写字段 → typecheck exit 0 ✅（02b-1 已验证）
   - 选 `undefined` 占位形态——比"不写字段"更明确表达"占位待填"的设计意图

3. **converters/ 真实依赖图**（已做）：
   - converters/ 全 10 文件 PM import 均为 type-only
   - 5 处外部调用方（types.ts / registry.ts / NoteEditor.tsx / ai-workflow / graph atom-bridge.ts）
   - **重要发现**：graph atom-bridge.ts 跨插件 import note/converters 是历史 lint error,留待 02b-2d 修

4. **02b-2 拆分修订**（基于探查）：从原"4 拆,02b-2a 搬 converters" 改为"4 拆,02b-2a 仅升级接口"——避免 converters 单独搬时 5 处调用方先于其他子阶段就要改

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
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 5.4 数据契约 | 全员必读 |
| [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口 | 引用,不修改 |
| [src/capabilities/text-editing/index.ts](../../../../src/capabilities/text-editing/index.ts) | J1 修改对象 |
| [src/capabilities/text-editing/README.md](../../../../src/capabilities/text-editing/README.md) | J2 修改对象 |
| [src/capabilities/README.md](../../../../src/capabilities/README.md) | J3 修改对象 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备（含现状探查 + 实测） | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
