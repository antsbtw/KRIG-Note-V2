# L5-G1 Graph 平台基座 + library-store + view 骨架 完成报告

> 阶段:L5-G1 — V1 → V2 graph 迁移第 1 段(共 5 段 G1~G5)
> 分支:`feature/L5G1-graph-platform-and-skeleton`
> 起草日期:2026-05-10
> 设计:[./L5G1-graph-platform-and-skeleton-design.md](./L5G1-graph-platform-and-skeleton-design.md) v0.2
> 上游 plan:[../v1-graph-migration-plan.md](../v1-graph-migration-plan.md) v0.2 § 5 G1
> 业务规格:[../../10-business-design/graph/canvas/Canvas.md](../../10-business-design/graph/canvas/Canvas.md) +
>   [../../10-business-design/graph/library/Library.md](../../10-business-design/graph/library/Library.md)

---

## 0. 完成清单

### Commit 1 — feat(platform): main 侧 graph 后端([466021f](../../../../KRIG-Note-V2#commit/466021f))

| 项 | 实际 | 状态 |
|---|---:|---|
| `src/platform/main/graph/canvas-store.ts`(NEW,JSON atomic write + folder ops 合并 G1-5)| 366 行 | ✅ |
| `src/platform/main/graph/library-handlers.ts`(NEW,IPC 14 条 — plan 20 砍 6)| 149 行 | ✅ |
| `src/platform/main/graph/index.ts`(NEW,re-export + initGraphPlatform)| 16 行 | ✅ |
| `src/shared/ipc/channel-names.ts`(改 — 加 14 条 `GRAPH_*`)| +17 行 | ✅ |
| `src/shared/ipc/electron-api.d.ts`(改 — graph* / onGraphListChanged 类型)| +22 行 | ✅ |
| `src/platform/main/preload/main-window-preload.ts`(改 — 14 个 graph* invoke + 1 on*)| +56 行 | ✅ |
| `src/platform/main/ipc/ipc-bus.ts`(改 — 接 registerGraphHandlers)| +2 行 | ✅ |

**Commit 1 小计:628 行(估 ~600,+5%)**

### Commit 2 — feat(capabilities,view): graph-library-store + GraphCanvasView 骨架([2521466](../../../../KRIG-Note-V2#commit/2521466))

| 项 | 实际 | 状态 |
|---|---:|---|
| `src/capabilities/graph-library-store/types.ts`(NEW)| 85 行 | ✅ |
| `src/capabilities/graph-library-store/index.ts`(NEW,IPC 客户端 + Registry 注册 + 双导出)| 171 行 | ✅ |
| `src/capabilities/graph-library-store/DESIGN.md`(NEW)| 122 行 | ✅ |
| `src/views/graph-canvas-view/index.ts`(NEW,registerView + 3 个 register*)| 48 行 | ✅ |
| `src/views/graph-canvas-view/GraphCanvasView.tsx`(NEW,占位空壳 empty/placeholder 双态)| **66 行 ≪ 150~200 红线** ✅ | ✅ |
| `src/views/graph-canvas-view/GraphCanvasToolbar.tsx`(NEW,占位 — title 显示)| 67 行 | ✅ |
| `src/views/graph-canvas-view/data-model.ts`(NEW,pluginStates 形状 + transient selectedIds)| 148 行 | ✅ |
| `src/views/graph-canvas-view/nav-side-content.tsx`(NEW,FolderTree + 拖拽 + 右键 + 重命名;直迁 ebook 模板精简 35%)| 418 行 | ✅ |
| `src/views/graph-canvas-view/canvas-commands.ts`(NEW,`graph-canvas-view.*` 8 commands + 3 trigger 桥)| 161 行 | ✅ |
| `src/views/graph-canvas-view/graph-canvas-view.css`(NEW,主组件壳样式)| 85 行 | ✅ |
| `src/platform/renderer/index.tsx`(改 — import capability + view)| +2 行 | ✅ |

**Commit 2 小计:1373 行(估 ~1100,+25%;主要在 nav-side / commands / DESIGN 三处微涨)**

### Commit 3 — design(L5-G1) v0.1 → v0.2 实施后用户 P2 复审([d73dbe3](../../../../KRIG-Note-V2#commit/d73dbe3))

design 内部数字一致性修订(5 条全闭环):
- § 3.1 文件清单 LOC 改"估算 vs 实际"双列回填实测
- IPC 计数全文统一 14 条(原标题"19 条"是 plan § 3.7 笔误延续)
- § 4 "砍 5/共 6 条"算术矛盾改写"砍 6 条"
- § 15 双 commit 估算 → 估/实双列
- 加"实测偏差说明"段 + 屏障 grep 0 命中佐证

**总:~2001 行 driver + DESIGN.md 122 + design 修订 64 行**(完整 G1 范围)

---

## 1. 实际改动 vs 设计

### 1.1 完全照设计

- **D-1=A view-id 命名**:`graph-canvas-view`(用户 2026-05-10 拍板,对齐 V2 既有 `note-view` / `ebook-view` / `web-view` 惯例;目录名 `views/graph-canvas-view/`,与 D-1=A 字面一致)
- **D-2=A pluginStates**:activeGraphId / expandedFolders 走 `pluginStates['graph-canvas-view']`,renderer `workspaceManager.update()` 直写;selectedIds 走 transient 不持久化(Q8=B 对齐 ebook / note)
- **D-3=B JSON 起步**:沿用 V2 既有 `learning/vocab-store` + `ebook/bookshelf-store` atomic write tmp+rename 模板;持久化路径 `{userData}/krig-data/graph/`
- **D-4=B 过渡态**:`src/platform/main/graph/` 下放,退出条件二合一(G5 验收 + 稳定 ≥2 周 + W6 SurrealDB 客户端 epic 落地后整体迁 `src/storage/graph/`)
- **G1-4 持久化双文件结构**:`canvases.json` metadata + `documents/{id}.json` 每画板一文件(metadata 是真理之源,孤儿 documents 留 GC)
- **G1-5 folder 合并**:`folder-store.ts` 不存在,folders ops 全合并到 `canvas-store.ts` 内
- **G1-8 / G1-9 砍 IPC**:plan 20 条 → 实际 14 条(砍 GRAPH_PENDING_OPEN / GRAPH_OPEN_IN_VIEW / GRAPH_DELETED / GRAPH_TITLE_CHANGED / GRAPH_SET_ACTIVE / GRAPH_GET_ACTIVE,单一 GRAPH_LIST_CHANGED 推送 + commandRegistry.execute 同 renderer 路由替代)
- **W5 严格态 A 边界**:view 通过 `requireCapabilityApi` 间接路由(`nav-side-content` + `canvas-commands` 全走);capability 双导出(模块级 + api 字段);driver/slot 暂无消费者

### 1.2 实施时微调

| 微调点 | v0.1 design | v0.2 实测 / 落地 |
|---|---|---|
| canvas-store LOC | 估 ~180 行(单画板)+ ~80 行(folder,后决策 G1-5 合并 → 估调 ~260) | 实 366 行 — V1 SurrealDB 287 行 + atomic write 辅助 + 类型守卫 + 兜底逻辑共溢出 ~106 行 |
| IPC 计数标题 | v0.1 § 1.1/3.2/3.3/4 标题写"19 条"(沿 plan v0.2 § 3.7 笔误) | v0.2 全文统一 "14 条"(plan 列 20 - 砍 6 = 14) |
| GraphCanvasView import | v0.1 设计含 `useMemo(() => requireCapabilityApi('graph-library-store'))` 占位 | 实际删除 — install-coverage 自检读的是 `viewDefinition.install`,与 view 主体是否运行时调 api 无关;NavSide / Commands 已经走 requireCapabilityApi 满足屏障 |

### 1.3 不在 G1 范围(留 G2~G5)

- ❌ `npm install three` — G3 才需(P1-1 严格版屏障:仅 canvas-rendering)
- ❌ `shape-library` capability(G2)
- ❌ `canvas-rendering` capability + Three.js Scene / NodeRenderer / interaction(G3+G4)
- ❌ `canvas-text-node` capability(G4,文字节点 PM 桥接)
- ❌ Library Picker / Inspector / Combine 对话框(G4)
- ❌ Toolbar 注册到 toolbarRegistry(G5)
- ❌ undo-redo / clipboard 接 V2 capability(D-13=B / D-14=B,留 V1 自管)
- ❌ Canvas API(被 family-tree 调,D-8=A 不实施)

---

## 2. 完成判据自检(charter § 6.3)

| 项 | 标准 | 结果 |
|---|---|---|
| ✅ npm start 跑得起来 | 窗口出来 + 无报错 | ✅ |
| ✅ 用户能看到该层功能 | NavSide 显「画板」Tab + [+ 文件夹] [+ 画板] | ✅ |
| ✅ console 打印 alive 行 | `[Capability] alive` 含 `graph-library-store` + `[L5] alive` 含 `graph-canvas-view` | ✅ |
| ✅ 上一层 alive 行也在 | L0~L4 alive 行无回归 | ✅ |
| ✅ install-coverage 预期 missing 3 | `graph-canvas-view × 4 capabilities · missing 3:shape-library / canvas-rendering / canvas-text-node`(P1-A 修订:install 是声明性契约,G1 阶段后 3 项未注册是预期 warning,**不阻塞验收**;G2~G4 渐次归零)| ✅ |
| ✅ typecheck 0 error | tsc --noEmit 0 输出 | ✅ |
| ✅ lint 0 warn | eslint . 0 输出(全工程) | ✅ |
| ✅ 屏障 grep 0 命中 | view 0 `import 'three'` / view 0 运行时 import `@capabilities` | ✅ |

---

## 3. 用户验收(design § 13 12 项)

**全过**(用户 2026-05-10 确认):

1. ✅ 启动 — 窗口出 + console alive 行
2. ✅ 切 view — NavSide 显「画板」Tab + actions
3. ✅ 创建文件夹 — 自动进重命名态 → 持久化到 `canvases.json`
4. ✅ 创建画板 — 自动 setActiveGraphId + 进重命名态 → 持久化 `canvases.json` + `documents/{id}.json`
5. ✅ 打开画板 — 主 slot 显「画板加载中(G3)」+ activeGraphId 显示
6. ✅ 重启恢复 — pluginStates 自动恢复 activeGraphId
7. ✅ 重命名 — NavSide 列表更新
8. ✅ 复制 — 「测试画板 v2 (副本)」出现
9. ✅ 移动 — 拖到文件夹下显示
10. ✅ 删除画板 — 列表移除 + documents/{id}.json 删除
11. ✅ 删除文件夹 — 子画板回根级
12. ✅ 多 workspace 隔离 — 同一画板列表全局共享 + 各自 activeGraphId 独立

---

## 4. 自我诊断输出样本

```
[Capability] alive | registered: [..., 'graph-library-store']  (14 项)
[L5] View alive | active: '...', registered views: [..., 'graph-canvas-view']  (5 项)
[install-coverage] ❌ install 覆盖率自检:5 views · 14 capabilities · 缺失 3
  graph-canvas-view × ['graph-library-store'] · missing: shape-library, canvas-rendering, canvas-text-node
  (P1-A 预期 warning,G2~G4 渐次归零;dev-only,不阻塞验收)
```

---

## 5. 衔接 G2(下一段)

G2 启动需要:
- ✅ G1 G5 双 commit 已合并 main(本段)
- ⏳ 用户起 G2 设计 — `capability.shape-library`(Shape + Substance 资源仓库,22 shape JSON + 5 substance JSON + parametric renderer + formula-eval,**0 import three**;path-to-three 留 G3 一起迁到 canvas-rendering)

G2 不依赖本段任何 capability,与 G1 完全正交(G3 才开始把 graph-library-store + shape-library 一起消费)。

---

## 6. 遗留 / 待优化项

| 项 | 说明 | 留待 |
|---|---|---|
| canvas-store.ts 单文件 366 行 | folder ops 合并 + atomic write helpers 共溢出 ~106 行;后续 W6 升 SurrealDB 时整体重构 | W6 |
| documents/ 目录孤儿文件 GC | metadata 是真理之源,save 中途挂掉留孤儿可后期 GC | v1.5+ |
| canvases.json 元数据并发写入安全 | 单进程内 lazy load + atomic rename 已保证;多窗口同时写未测试 | v1.5+(目前 V2 单窗口) |
| viewport / inspectorOpen / addModeKey 等画板内交互状态归属未定 | 可挂 doc_content 也可挂 pluginStates,G3 接 Host 时决定 | G3 |

---

## 7. 修订记录

| 日期 | 内容 |
|---|---|
| 2026-05-10 | 初稿;3 commit 全合 + 12 项验收全过 + 完成判据全 ✅ + design v0.1 → v0.2 P2 复审纳入本报告 |
| 2026-05-10 | G2 启动前用户 P1-A 复审 — install 列表对齐 plan v0.2 § 6.1 口径(view install 1 项渐进式 → 4 项完整声明):完成判据"install-coverage 0 missing"改"预期 missing 3";自我诊断输出样本改 install-coverage warning + 说明 G2~G4 渐次归零;view 实际代码 `src/views/graph-canvas-view/index.ts` install 列表同步改 4 项(在 G2 分支顺手修补) |
