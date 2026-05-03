# 阶段 02b-1：text-editing Capability 最小骨架（波次 2 第二阶段）

> **状态**：待执行
> **目标分支**：`refactor/text-editing-skeleton`（已由 Commander 从 main 切出）
> **类型**：基础设施类阶段（仅建 capability 最小骨架，不搬业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`5b478326`（main HEAD，含阶段 02a merge）

---

## 阶段目标

在阶段 02a 已建好平台骨架（IntentDispatcher + 5 Registry + Capability 接口）之后，**实例化第一个 Capability 验证整套契约可工作**——只建 `capability.text-editing` 最小骨架（仅 id + README.md），**不搬迁任何 ProseMirror 业务代码**。

> **核心价值**：验证阶段 01 落的 Capability 类型契约**正确可实例化**，作为 02b-2/3/...（按 capability 维度）所有后续 capability 阶段的样板。

按总纲 § 5.4 数据契约 + § 5.9 能力清单：text-editing 是核心能力，被 note.editor / note.thought / graph.canvas 节点 label / 未来 timeline 描述等多个视图消费——**这正是 § 1.3 抽象原则规则 C 颗粒度判定（"至少两个互不相干视图使用"）的典型用例**。

## 阶段产出（按 task-card 完成判据 J1~J6 验证）

1. **J1** `src/capabilities/text-editing/index.ts` 新建（`textEditingCapability: Capability` 最小实例）
2. **J2** `src/capabilities/text-editing/README.md` 新建（说明 02b-2 才装实质内容）
3. **J3** `src/capabilities/README.md` 更新——从"目录占位中"改为"已有 1 个 capability(骨架)"（占位声明同步）
4. **J4** 范围对账（双点 diff + 显式基线 SHA `5b478326`，含且仅含 3 个文件）
5. **J5** typecheck=0 / lint=1 (780 不变) / lint:dirs=0 baseline 不变
6. **J6** commit message 规范

## Commander 起草前的现状探查（按 § 六纪律）

1. **ProseMirror 在 plugins**：69 个文件（note 66 + graph 3）。02b-1 **不动**——02b-2 才搬迁
2. **PM 子包分布**：prosemirror-model 47 / prosemirror-view 41 / prosemirror-state 38 / 其他 8 个子包共 25。02b-2 capability 内部封装这套
3. **type-only vs runtime import 比例**：约 1:1（74:73）。type-only 是好事——02b-2 搬迁时可保留部分 type-only 作"类型借用"
4. **`src/capabilities/text-editing/`**：不存在（02b-1 创建）
5. **现有 `src/capabilities/README.md`**：已存在（02a 落地，占位"目录占位中"）。02b-1 同步更新
6. **Capability 接口**：阶段 01 已落 `src/shared/ui-primitives.ts`，含 id + 5 大菜单 + schema + converters + createInstance + commands 字段。**实测验证**：模拟创建 textEditingCapability 后 typecheck exit 0，lint 全仓基线 780 不变 ✅

## 02b-2 起草指引（02b-1 完成后由 Commander 起草）

02b-2 是真正搬迁 ProseMirror 业务代码的**大手术**——69 文件 → `src/capabilities/text-editing/` 内部。预期：

| 维度 | 估计 |
|---|---|
| 文件移动 | ~30 文件（converters + plugins 子目录核心）|
| 视图层禁止直接 import 改造 | note + graph 入口 import 全部改走 capability |
| 完成判据 | typecheck=0 + lint warnings 数 ≤ 当前（views 层禁外部依赖 J5.4 warn 触发可能减少） |
| 风险 | 高——业务代码搬迁影响 NoteEditor 864 行入口 |

**02b-2 task-card 起草前，Commander 需做更深探查**：
- ProseMirror 67 文件中哪些是"实例工厂"职责？哪些是"schema 定义"？哪些是"plugins"？
- 视图层 vs capability 内部的边界
- 旧 imports 全删除还是保留 type-only？

02b-2 因规模大,可能进一步拆为 02b-2a（搬基础设施 schema/converters）+ 02b-2b（搬 plugins）+ 02b-2c（迁视图入口）等。届时 Commander 再决定。

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览（本文件） | 全员参考 |
| [task-card.md](task-card.md) | 任务卡：J1~J6 + 完成判据 + 严禁顺手做 + 风险 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令 | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令 | Auditor 读 |

## 全局引用

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 1.3 / § 5.4 / § 5.9 | 全员必读 |
| [CLAUDE.md](../../../../CLAUDE.md) 含重构期硬规则 | 全员必读 |
| [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts) Capability 接口 | 引用,不修改 |
| [src/capabilities/README.md](../../../../src/capabilities/README.md) | J3 同步更新对象 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备（含现状探查 + 实测） | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |
