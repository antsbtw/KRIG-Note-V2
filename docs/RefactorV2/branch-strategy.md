# V2 分支策略

> v1.0 · 2026-05-03

---

## 1. 核心原则

1. **main 永远稳定**——只接 merge,不直接 commit 业务代码
2. **一个工作单元 = 一个分支**(按工作内容命名,不按目录)
3. **测试通过才 merge**(按 [charter § 6.3](../00-architecture/charter.md) 完成判据)
4. **责任划分清晰**——部门或个人按"分支群"承担(不绑定单一分支)

---

## 2. 分支命名约定

### 2.1 命名格式

```
<前缀>/<工作单元>-<简短描述>
```

### 2.2 前缀含义

| 前缀 | 用途 | 例子 |
|---|---|---|
| `feature/` | 新功能 / 阶段实施 | `feature/L0-bootstrap` / `feature/capability-text-editing` |
| `fix/` | bug 修复 | `fix/window-flicker` |
| `chore/` | 杂项(依赖 / 配置 / 工具) | `chore/eslint-init` |
| `docs/` | 纯文档变更(本身不动代码) | `docs/charter-v0.4` |

### 2.3 工作单元命名

**L 阶段类**(charter § 6 6 大阶段):
- `feature/L0-bootstrap`(L0 平台层启动)
- `feature/L1-window-management`(L1 窗口深化)
- `feature/L2-shell-three-column`(L2 三栏布局)
- `feature/L3-workspace-state`(L3 状态)
- `feature/L4-slot-registry`(L4 注册基础设施)
- `feature/L5-noteview-mvp`(L5 NoteView 最小可用)

**能力类**(L 阶段后按需添加):
- `feature/capability-text-editing`
- `feature/capability-pdf-rendering`
- `feature/capability-history`
- `feature/capability-find-replace`

**视图类**(L5 阶段后按需添加):
- `feature/view-graph-canvas`
- `feature/view-ebook-pdf`
- `feature/view-web-browser`

---

## 3. 分支生命周期

```
1. 创建:从 main 切出 → git checkout -b feature/<name> main
2. 工作:在分支上多次 commit,可能多次 push
3. 测试:按 charter § 6.3 完成判据 5 条
4. 合并:测试通过 → git merge --no-ff(保留分支痕迹)
5. 删除:merged 后立即 git branch -d <name>
6. 历史保留:merged commits 在 main 永久保留
```

---

## 4. 合并策略

**`git merge --no-ff`**(沿用 V1 实践)

理由:
- 保留分支结构(main history 看到分支拓扑)
- 便于 git bisect 定位问题分支
- 与 V1 重构期实践一致

---

## 5. 测试通过定义

按 [charter § 6.3](../00-architecture/charter.md) 完成判据 5 条:

1. ✅ npm start 跑得起来
2. ✅ 用户操作能看到该层功能(UI 上看到,不是"代码审核通过")
3. ✅ console 打印 `[Lx] alive` 诊断行
4. ✅ 上一层"alive 行"也在(无回归)
5. ✅ 健康检查 IPC 返回 `alive: true`

满足 5 条 + 用户确认通过 → merge 到 main。

---

## 6. 责任划分(预留,V2 单人期不强制)

V2 当前为单人开发(用户 + Claude)。"部门责任"是**未来想法**。

未来分团队时,部门按"分支群"承担:
- 部门 A:平台层 → 管 `feature/L0-*` / `feature/L1-*` / 后续 platform/ 维护分支
- 部门 B:状态管理 → 管 `feature/L3-*` / 后续 workspace 相关分支
- 部门 C:能力开发 → 管所有 `feature/capability-*` 分支
- 部门 D:视图开发 → 管所有 `feature/view-*` 分支
- ...

**部门 = 分支群组,不是单一分支绑定**。

---

## 7. 历史例外

### 例外 1:c3d88d7 — 9 目录骨架直接 commit 到 main

**背景**:V2 仓库初始化阶段,在制定本分支策略前,9 目录骨架(全 README 文档,无代码)直接 commit 到 main。

**处理**:接受为例外。理由:
- 9 目录骨架是框架占位(无业务代码)
- 处于"L0 实施前的准备期",分支策略尚未确立
- revert + 重做的成本大于价值

**从 L0 实施起**:严格执行 main 不直接 commit 代码。

### 例外 2:文档单独 commit 到 main(可接受)

纯文档变更(charter / directory-structure / branch-strategy 本身等)允许直接在 main commit,前提:
- 不动 src/ 任何代码
- 不动 package.json / tsconfig / forge / vite / eslint 等工程配置
- 仅 docs/ 内修改

理由:文档是策略性内容,频繁切分支反而提高维护成本。

---

## 8. 与 V1 实践的对应

V1 重构期分支命名(参考 [V1 总纲 § 4.2](../99-archive-v1/refactor/00-总纲.md)):

```
refactor/charter
refactor/contracts
refactor/platform-skeleton
refactor/text-editing-skeleton
refactor/text-editing-fields
refactor/pdf-rendering
refactor/canvas-interaction
refactor/graph-view-definition-skeleton
refactor/graph-views-relocation
```

V1 是"按工作单元"风格,与 V2 方法 E 一致。

V2 改动:
- `refactor/` 前缀 → `feature/` / `fix/` / `chore/` / `docs/`(语义更准)
- 不再三角架构(Commander/Builder/Auditor)
- 不再字节级合规判据 / task-card / 立卡 SHA 等
- 沿用 `--no-ff` merge + 分支 merged 后立即删

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-03 | v1.0 | 初稿;选定方法 E(按工作单元命名)+ 沿用 V1 `--no-ff` 合并实践;含历史例外 c3d88d7 + 文档单独 commit 例外 |
