# 阶段 02a：平台骨架（波次 2 第一阶段）

> **状态**：待执行
> **目标分支**：`refactor/platform-skeleton`（待 Builder 从 main 切出）
> **类型**：基础设施类阶段（创建新平台层文件，不动业务代码）
> **功能契约**：N/A
> **派活基线 SHA**：`fc943e46`（main HEAD，含阶段 00 / 00x / typecheck-baseline / 01 全部 merge）

---

## 阶段目标

为波次 2 中间层建立**平台骨架**：IntentDispatcher + CommandRegistry + 5 个 UI Primitives Registry 类型骨架 + Capability 目录占位。**只建通道，不动旧代码**——L5 现有代码继续用 `openCompanion` / `closeRightSlot`，新代码可选用 `dispatch(IntentEvent)`。

按总纲 § 2 推进策略：
> 让"违规旧 API"和"合规新 API"共存一段时间，逐插件迁移完再删旧。

## 阶段产出（按 task-card 完成判据 J1~J7 验证）

1. **J1** `src/main/workspace/intent-dispatcher.ts` 新建（IntentDispatcher 类骨架）
2. **J2** `src/main/app.ts` ctx 增加 `dispatch` 新 API（旧 API 保留）
3. **J3** `src/renderer/ui-primitives/command-registry.ts` 新建
4. **J4** `src/renderer/ui-primitives/{context-menu,toolbar,slash,handle,floating-toolbar}/index.ts` 5 个子目录骨架
5. **J5** `src/capabilities/README.md` 占位（无任何 capability 子目录）
6. **J6** 范围对账（双点 diff + 显式基线 SHA）
7. **J7** lint=1 (778) / typecheck=0 / lint:dirs=0 baseline 不变

## 03（下一阶段）预告：02b 实质 Capability 封装

02a 完成后是 02b——**封装外部依赖到 Capability 内**。范围按现状探查：
- ProseMirror 在 plugins 内 **69 个文件**——封装到 `capability.text-editing` 内（最大块）
- Three.js 在 plugins 内 **8 个文件**——封装到 `capability.canvas-interaction` 内
- 其他 capability（pdf-rendering / web-rendering 等）按需

02b 因规模大可能拆为多个独立 PR（按 capability 维度切）。02a 严格不碰这些文件。

## 本阶段相关文件

| 文件 | 用途 | 角色 |
|------|------|------|
| [README.md](README.md) | 阶段总览（本文件） | 全员参考 |
| [task-card.md](task-card.md) | 任务卡：J1~J7 + 完成判据 + 严禁顺手做 + 风险 | Builder 必读 |
| [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) | Builder 派活指令（自包含） | Builder 读 |
| [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) | Auditor 审计指令（自包含） | Auditor 读 |

## 全局引用

| 文件 | 角色 |
|------|------|
| [docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 2 + § 5 + § 7 | 全员必读 |
| [CLAUDE.md](../../../../CLAUDE.md) 含重构期硬规则段 | 全员必读 |
| [BUILDER-PROMPT.md](../../BUILDER-PROMPT.md) / [AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md) | 角色规则 |

## 阶段流转状态

| 阶段 | 状态 |
|------|------|
| Commander 准备（含现状探查 + 实测） | ✅ 完成 |
| Builder 执行 | ⏳ 待启动 |
| Auditor 审计 | ⏳ 待 Builder 完成 |
| 用户拍板 merge | ⏳ 待审计 |

## Commander 起草前的现状探查（按 § 六纪律）

1. **特权 API 调用点**：18 个文件分布在 navside / commands / main IPC（与评估一致）。02a **不动这些**——共存策略保留旧 API
2. **外部依赖在 plugins**：ProseMirror 69 / Three.js 8 / pdfjs 1 / epubjs 0 / openai 0 / @anthropic-ai 0。02a **不碰** —— 02b 封装
3. **`src/capabilities/`**：不存在，02a 创建空目录 + README.md 占位
4. **`src/renderer/ui-primitives/`**：不存在，02a 创建
5. **`src/main/workspace/intent-dispatcher.ts`**：不存在，02a 创建
6. **现有 ctx 派发**：`app.ts:39-45` 含 `openCompanion` / `ensureCompanion`——02a **保留** + 追加 `dispatch`
7. **实测验证**：模拟创建 `intent-dispatcher.ts` import `@shared/intents` 后 `npm run typecheck` exit 0 —— path alias 工作正常，不阻塞
