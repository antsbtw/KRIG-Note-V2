# 阶段 02b-2b：text-editing capability schema/converters 临时引用 plugin

> **状态**：待执行
> **目标分支**：`refactor/text-editing-bridge`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（capability 临时引用 plugin，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`eab6a95a`（main HEAD，含阶段 02b-2a merge）

---

## 阶段目标

在阶段 02b-2a 已升级 `textEditingCapability` 含 4 个 `undefined` 占位字段之后，**填入 `schema` 和 `converters` 两个字段**——但**不搬迁 9 个 converter 文件**，而是**临时引用** `plugins/note/` 内现有的 `converterRegistry` + `blockRegistry` 单例。

> **核心命题**（探查后修订）：02b-2 子阶段不做"实质搬迁"——而是采用"capability 临时引用 plugin"模式。真正的搬迁推到 **波次 3 note 整体迁移**时做（届时插件级重构自然带走 converters）。

按总纲 § 2 推进策略：
> 让"违规旧 API"和"合规新 API"共存一段时间，逐插件迁移完再删旧。

本阶段是这个精神的**直接应用**：capability 通过引用 plugin **声明意图**（"text-editing 的转换器和 schema 在这里"），实际代码留在 plugin 内运行。

## 修订原因（重要——记录给未来阶段参考）

原计划 02b-2b "搬 converters 9 文件 + 5 处调用方"。Commander 探查后发现：
1. **ConverterRegistry 与 BlockDef 强耦合**——搬走会带走 22 个 converter + BlockDef 类型定义
2. **5 处外部调用方需联动改 import**——增加范围风险
3. **graph atom-bridge 跨插件违规**与 converter 路径相关——纠缠
4. **ConverterPair 适配器仅需 ~5 行**——不必搬整个类

修订后：02b-2b/c/d 全部改为"临时引用"模式，真搬迁推到波次 3。优势是节奏轻快、零业务代码、零层次混乱风险。

## 阶段产出（按 task-card 完成判据 J1~J5 验证）

1. **J1** `src/capabilities/text-editing/index.ts` 升级：填入 `schema` + `converters` 字段（引用 plugin/note 单例）
2. **J2** `src/capabilities/text-editing/README.md` 状态段同步
3. **J3** `src/capabilities/README.md` 状态段同步
4. **J4** 范围对账（双点 diff + 显式基线 SHA `eab6a95a`，含且仅含 3 文件）
5. **J5** typecheck=0 / lint warnings=15 不变 / lint:dirs=0

## Commander 起草前的现状探查 + 实测（按 § 六纪律 1+2+4）

1. **ConverterRegistry 公共 API**（已读）：
   - `init(blocks: BlockDef[])` / `registerConverter(c)` / `docToAtoms(doc)` / `atomsToDoc(atoms)` / `atomsToDocChunked(atoms, chunkSize)` / `pmJsonToAtoms(...)`
   - 5 处调用方实际只用 `docToAtoms` / `atomsToDoc` / `atomsToDocChunked` 三个方法

2. **ConverterPair 接口**（已读）：
   ```ts
   { toAtom: (data: unknown) => unknown; fromAtom: (atoms: unknown) => unknown }
   ```
   适配仅需 ~5 行，包装 `docToAtoms`/`atomsToDoc`。

3. **schema 字段类型**（已读）：`SchemaContribution = unknown` —— 接受任何值，可直接赋 `blockRegistry`（unknown 类型）。

4. **实测验证**（Commander 已做）：
   ```ts
   import type { Capability, ConverterPair } from '@shared/ui-primitives';
   import type { Atom } from '@shared/types/atom-types';
   import type { Node as PMNode } from 'prosemirror-model';
   import { converterRegistry } from '@plugins/note/converters/registry';
   import { blockRegistry } from '@plugins/note/registry';

   const textEditingConverters: ConverterPair = {
     toAtom: (data) => converterRegistry.docToAtoms(data as PMNode) as Atom[],
     fromAtom: (atoms) => converterRegistry.atomsToDoc(atoms as Atom[]),
   };

   export const textEditingCapability: Capability = {
     id: 'capability.text-editing',
     schema: blockRegistry,
     converters: textEditingConverters,
     createInstance: undefined,
     commands: undefined,
   };
   ```
   实测结果：typecheck exit 0 / lint 全仓 780 (765e+15w) 严格不变 / 单文件 lint 干净 ✅

5. **没有越界**：
   - 不动 plugin/note 任何文件
   - 不动 5 处外部调用方
   - 不动 graph atom-bridge.ts 跨插件违规（留波次 3）
   - 不搬任何 converter 文件

## 02b-2c/d 起草指引（修订后预告）

按"临时引用"模式，后续子阶段也极轻量：

- **02b-2c** commands 临时引用：在 `text-editing/index.ts` 填入 `commands` 字段，引用 `plugins/note/commands/` 内现有命令函数
- **02b-2d** createInstance 临时引用 + graph atom-bridge 跨插件违规修复：实现 `createInstance` 包装 NoteEditor 的 PM 实例创建逻辑；修 graph 跨插件违规（改走 capability）

每个子阶段预期 ~3 文件改动（仅 capability 内 + 2 个 README）。

**真正的搬迁**推到波次 3 note 整体迁移时做。

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
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2 + § 5.4 + § 5.8 | 全员必读 |
| [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability + ConverterPair 接口 | 引用 |
| [src/capabilities/text-editing/index.ts](../../../../src/capabilities/text-editing/index.ts) | J1 修改对象 |
| [src/plugins/note/converters/registry.ts](../../../../src/plugins/note/converters/registry.ts) | capability 引用对象（**不修改**）|
| [src/plugins/note/registry.ts](../../../../src/plugins/note/registry.ts) | capability 引用对象（**不修改**）|

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备（含现状探查 + 实测） | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
