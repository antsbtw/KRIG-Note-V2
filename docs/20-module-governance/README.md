# 模块化治理迭代（专项）

> **本目录** = 这一次「模块边界治理 / 可独立部署」专项优化的**唯一工作区**。
> **状态**：🔶 第 1 步「问题具体化」进行中（2026-07-21 起）。
> **总指挥**：用户。**执行**：每个模块/抽象的优化交由新对话按 prompt 完成并验收。

## 工作法（用户拍板的四步）

```
第1步 问题具体化   → 列全所有问题 + 按「可独立优化单元」分类（本目录 problems.md）
     ↓
第2步 总体规划     → 从哪到哪、哪些抽象、哪些规范化；分步分模块蓝图（plan.md）
     ↓
第3步 分模块细化   → 逐单元：评严重性/可迭代性 + 优化方法 + 单模块文档 + 执行 prompt
     ↓             （units/<unit>.md + units/<unit>.prompt.md）
第4步 执行         → 新对话按 prompt 改代码，交第 3 步验收标准验收
```

- 用户只做 1/2/3（规划、分解、出文档与 prompt），始终在架构高度掌控全局。
- 第 4 步（写代码）交新对话，独立、可验收、可迭代。沿用 [[project-graph-shape-library-rebuild]] 的「总指挥交新对话写」模式。

## 成功标志（用户定）

> **「优化得好，其他文档应逐步归档、不再被引用。」**
> 治理成功 ⟺ 描述旧混乱结构的文档过时可归档（代码变干净，病态描述不再成立）。
> 归档候选（治理完成后逐一核对是否已失效）：待第 2 步规划时列出。

## 目录内容

- `README.md`（本文）— 工作法 + 索引
- `problems.md` — 第 1 步产出：完整问题清单（U1~U5，按可独立优化单元）✅
- `plan.md` — 第 2 步产出：总体优化规划（目标态/抽象点/规范化点/顺序/验收）✅
- `units/` — 第 3 步产出：每个优化单元的细化文档 + 执行 prompt 🔶 进行中
  - `U1-a-ws-context-injection.md` + `.prompt.md` — ws 上下文注入链（地基）✅ **已交付验收**（commit 0741b78d）
  - `U1-b-component-inject.md` + `.prompt.md` — views nav-side 改注入（5 文件）✅ **已交付验收**（commit a96419c9）
  - `U1-c-command-ctx.md` — U1-c 地形排查 + c2 陷阱判定 + 关键收敛 ✅
  - `U1-c1-a2-interface.prompt.md` — 建 A2 注入接口(registerWsCommand)+1命令试水 ✅ **已交付验收**（commit c553e55a）
  - **归多窗口 step2**：40 命令批量注入 / c2-defer(ai-sync×2+keymap) / U1-b shell 3点删
  - U1-c2-inject(link-click/note-bridge/context-menu ~10)— ⏳ 待评估是否也依赖窗口独立性
  - U4/U5（独立小单元）、U2 收尾、U3 二次评估 — ⏳

## 关联（现有素材，将被本专项吸收/取代）

- [[module-boundary-governance]] — 依赖体检 + V1~V4 + 四层目标架构。**问题清单的原始素材**，
  本专项的 problems.md 会把它重组成「可执行优化单元」。治理完成后此文档或归档。
- [[multi-window-process-isolation]] — 多窗口设计（治理的抓手/首个应用场景）。
- [[reliability-charter]] — 完整性判据（关模块隔离测试）来源。
