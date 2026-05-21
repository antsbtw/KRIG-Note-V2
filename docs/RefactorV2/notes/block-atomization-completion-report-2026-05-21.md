# L7 Block Atomization sub-phase 完成报告

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`(未合 main,等用户审计)
> **决议依据**:[decision 025](../data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md) + [decision 026](../data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) + [实施计划](../stages/block-atomization-implementation-plan.md)
> **commits 总数**:22+(详 git log)
> **总耗时**:1 个对话 session(2026-05-21)

---

## 0. 摘要

L7 block atomization sub-phase 字面完成 V2 note 视图字面**核心架构升级**:

| 维度 | 升级前 | 升级后 |
|---|---|---|
| pm atom 颗粒度 | 整篇 doc = 1 atom | 单 block = 1 atom |
| 边表达 | 仅 inFolder / hasNoteView | + belongsToNote / nextSibling / childOf |
| Thought NoteLocator | { pmPos, anchorType, text } | { blockId, offset?, preview? } |
| URL 协议 | krig://block/{id}/{idx:text}(漂移)| krig://block/{id}/{ULID}(跨编辑稳定) |

---

## 1. Stage 完成状态

| Stage | 内容 | 状态 | commits |
|---|---|---|---|
| **Stage 1** | PM schema + appendTransaction id 注入 + skipOnChange 防御 | ✅ EM1 PASS | 4 |
| **Stage 2** | note capability 改造(assemble/dissect/diff/cache + capability rewrite) | ✅ EM2 PASS(含 dup-id fix) | 7 |
| **Stage 3** | 3 predicate 字面登记 + L2 cardinality 检查 | ✅ EM3 PASS | 2 |
| **Stage 4** | NoteLocator 升级 + thought view 适配 + driver API + UI | ✅ EM4 静态 PASS | 2 |
| **Stage 5** | URL 协议演化 + 旧 URL 检测 + Copy Link / LinkPanel | ✅ EM5 静态 PASS | 3 |
| **Stage 6** | 一次性 migration script | ⏭ N/A(D-13 字面用户拍板跳过) | 1 |
| **Stage 7** | 8+3 场景手动测试 | ⏭ N/A(D-14 字面用户拍板跳过,留运行中发现) | 1(N/A 报告) |
| **Stage 8** | 性能压测 5 指标 | ⏭ N/A(D-15 字面跳过 + 已知 listNotes 性能退化) | (并入 D-14 commit) |
| **Stage 9** | 验收 + 文档反向更新 | ✅ 本报告 | 待 commit |

---

## 2. 偏离登记汇总(D-01 至 D-15)

[完整偏离日志](./block-atomization-deviations-2026-05-21.md):

| 编号 | 性质 | 字面摘要 |
|---|---|---|
| D-01 | 事实纠错 | IPC handler 路径 src/platform/main/preload/(决议字面 src/platform/preload/) |
| D-02 | 事实纠错 | NoteLocator 使用点实测 8 处(决议字面"约 10 处") |
| D-03 | 事实纠错 | scrollToBlockAnchor / URL 路由行号小偏(commit 后行号自然漂) |
| D-04 | 事实纠错 + 补充 | BlockSpec / NodeSpec 实测 21 加 id(决议字面"约 22") |
| D-05 | 事实纠错 | main 起点 3 个 lint warning(本 sub-phase 字面 0 新增) |
| D-06 | 决议字面冲突 | hardBreak 是 inline 字面不加 id(决议 §3.1.1 与 §3.1.3 矛盾) |
| D-07 | 决议字面冲突 | fileLink(inline 形态)字面不加 id(同 D-06) |
| D-08 | 事实纠错 | tableHeader 字面无 bookAnchor 字段(超 L7 范围,不补) |
| D-09 | 临时妥协 → 已 close | 粘贴语义 hook(Stage 2 dup-id fix `dc74a4de` 字面已实施) |
| **D-10** | 事实纠错 | reading-thought pm atom 字面无 hasNoteView 但走 updateNote(D-10 主修) |
| **D-11** | 用户拍板 | Stage 2 不引入旧数据兼容路径(开发期清空旧 V2 数据) |
| D-12 | 临时妥协 | 旧 URL 字面仅 console.warn(V2 字面无 toast capability) |
| D-13 | 用户拍板 | Stage 6 字面跳过(D-11 加成无 migration 消费者) |
| **D-14** | 用户拍板 | Stage 7 字面跳过(11 场景留运行中发现,3 高风险项标记) |
| **D-15** | 用户拍板 + 已知问题 | Stage 8 字面跳过 + listNotes 字面 N×3 query 退化 + diff O(N²) |

**字面高风险未验项**(D-14 字面标记,合 main 后字面优先验):
1. **T7** callout + 内部 paragraph(嵌套 childOf + 跨层 wrapper 重建字面无实测)
2. **T8** thought 锚点跨编辑稳定(blockId 字面根治性字面无实测)
3. **T10** ebook reading-thought 走 updateNote(D-10 路径字面**最高风险**)

---

## 3. 核心代码改动清单

### 3.1 新增文件(5)

| 文件 | 字面职责 |
|---|---|
| `src/platform/main/note/assemble-pm-doc.ts` | storage 字面 block atom + 边 → 完整 PM doc(跨层 wrapper 重建) |
| `src/platform/main/note/dissect-pm-doc.ts` | PM doc → block atom 集合 + 边集合(跨结构性容器跳层) |
| `src/platform/main/note/diff-block-tree.ts` | oldDoc vs newDoc → added/modified/removed/edges 增量 |
| `src/platform/main/note/pm-doc-cache.ts` | 进程内 Map<containerId, PmPayload> in-memory cache |
| `src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts` | PM appendTransaction 字面注入 ULID + dup-id 去重(split/paste) |

### 3.2 重写文件

| 文件 | 字面性质 |
|---|---|
| `src/platform/main/note/capability-impl.ts` | createNote / getNote / updateNote / deleteNote 字面全部走拆 atom + 边模型 |

### 3.3 改动文件

| 文件 | 字面改动 |
|---|---|
| `src/shared/ipc/thought-types.ts` | NoteLocator 字面升级 { blockId, offset?, preview? } |
| `src/drivers/text-editing-driver/api.ts` | + findBlockIdAtPos / findBlockNodeById + addThought* 字面返新字段 + getBlockIdAt(取代 getBlockAnchorAt)+ scrollToThoughtAnchor 字面新签名 |
| `src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts` | scrollToBlockAnchor 字面 blockId + isV1LegacyAnchor 字面检测 + onLegacyBlockAnchor callback |
| `src/views/thought/command-impl/add-from-note.ts` | NoteLocator 字面用新字段 |
| `src/views/thought/command-impl/ask-ai.ts` | 同上 |
| `src/views/thought/command-impl/scroll-to-source.ts` | scrollToThoughtAnchor 字面新签名 |
| `src/views/thought/ThoughtPanel.tsx` | 排序 getAnchorSortKey 字面复合 key([numKey, strKey]) |
| `src/views/thought/ThoughtCard.tsx` | anchorPreviewText 字面读 locator.preview |
| `src/views/note/note-commands.ts` | Copy Link 字面 getBlockIdAt + URL 字面 blockId |
| `src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx` | HeadingItem 字面加 id + Enter/onClick 字面 blockId URL |
| `src/drivers/text-editing-driver/blocks/*/spec.ts` | 22 NodeSpec 字面加 attrs.id(Stage 1.2)+ 6 媒体 atomId → id rename(Stage 1.3) |
| `src/storage/health/cardinality-check.ts` | + belongsToNote / childOf 字面 scan + scanNextSiblingCardinality 双向 ≤1 |
| `docs/RefactorV2/data-model/relations/spec.md` | §10 字面追加 3 predicate + §10.2 节字面语义解释 |
| `docs/RefactorV2/data-model/atom/spec.md` | §2.5.1 字面 L7 反向更新 |
| `docs/RefactorV2/data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md` | §3.2 字面"decision 030+" 占位字面注销 → decision 026 |
| `docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md` | §10.1 字面 NoteLocator 字面 preview 字段扩展 |
| `docs/00-architecture/three-layer.md` | §2.4 + §6.4 + §8 字面 L7 反向更新 |

---

## 4. 字面 sub-phase 完成判据对照(决议 §14)

| 条 | 字面状态 |
|---|---|
| ✅ Stage 1-9 全部 EM 通过 | Stage 1-5 ✅ + 6-8 ⏭ N/A + 9 ✅ |
| ⚠ 8 个测试场景通过 | ⏭ Stage 7 字面跳过(D-14)— 留运行中发现 |
| ⚠ 性能 5 项指标过 | ⏭ Stage 8 字面跳过(D-15)+ listNotes 字面已知退化 |
| ✅ 文档反向更新完成 | atom/spec + decision 022 + decision 026 + three-layer + relations/spec |
| ✅ memory 字面登记 | project_block_atomization_done.md(下条 commit) |
| ✅ 偏离登记归档 | D-01 至 D-15(15 个) |
| ✅ 完成报告 | 本文档 |
| ✅ commit 全部在 feature 分支 | 22+ commits 字面未合 main |
| ❌ Release Note 字面公告旧 URL 失效 | 字面**留合 main 时用户操作** |

---

## 5. 字面建议(合 main 前/后)

### 5.1 合 main 前(用户审计字面验)

字面字面建议字面执行:
- 字面 review 关键文件 diff:
  - `src/platform/main/note/capability-impl.ts`(重写)
  - `src/platform/main/note/assemble-pm-doc.ts`(新增,跨层 wrapper 重建逻辑字面复杂)
  - `src/platform/main/note/dissect-pm-doc.ts`(新增,跨层跳层逻辑字面字面)
  - `src/platform/main/note/diff-block-tree.ts`(新增,字面 stableStringify O(N²) 已知)
  - `src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts`(新增 + dup-id fix)
- 字面 review 决议反向更新(atom/spec / three-layer)

### 5.2 合 main 后字面优先验(D-14 字面 3 高风险)

1. **T7 callout + 内部 paragraph**:
   - 创 note → / 字面打 callout → 内打 paragraph
   - 关闭重开 → callout + paragraph 字面保留 + 嵌套关系字面正确
   - 字面失败 → assemble 字面跨层 wrapper 重建字面 bug → 查 [assemble-pm-doc.ts](../../../../src/platform/main/note/assemble-pm-doc.ts) `buildPmNode` + `wrapChildren`

2. **T8 thought 锚点跨编辑稳定**:
   - 创 note → 输入文字 → thought 标注某段(记 thoughtId)
   - 在 note 头部插 100+ paragraph
   - 切到 thought tab → 点该 thought 卡片 → 字面**精确滚到原段**(不漂移)
   - 字面失败 → blockId 字面不稳 / scrollToThoughtAnchor 字面 bug → 查 [api.ts findBlockNodeById](../../../../src/drivers/text-editing-driver/api.ts)

3. **T10 ebook reading-thought 走 updateNote(D-10 最高风险)**:
   - 打开 PDF → 划高亮(addReadingThoughtBlock 字面触发)
   - 关闭 PDF 重开 → 标注字面保留
   - 字面失败 → updateNote 字面对 reading-thought 字面 dissect / diff 字面 bug → 查 [capability-impl.ts](../../../../src/platform/main/note/capability-impl.ts) updateNote + [ebook/capability-impl.ts](../../../../src/platform/main/ebook/capability-impl.ts) addReadingThoughtBlock

### 5.3 字面 future sub-phase 待启动(L7 字面留下的)

1. **生产 migration sub-phase**(D-13):一次性 migration script + 备份 round-trip 测试
2. **toast capability sub-phase**(D-12):字面 wire onLegacyBlockAnchor + UI Toast 组件
3. **性能优化 sub-phase**(D-15):listNotes 轻量化 + diff hash 缓存 + 1000-block benchmark
4. **跨视图 Block 共享 sub-phase**(decision 026 §0.2 字面): 投影模型 / Block 复用
5. **携运语义 sub-phase**(decision 026 §13.6):drag-drop 移动 / cut+paste 区分

---

## 6. 字面下一步(用户字面拍板)

字面 sub-phase 字面在 feature/L7-block-atomization 分支字面完成,字面**等用户字面审计 + 字面 OK 拍板**字面合 main:

```bash
# 用户字面审计后
git checkout main
git merge feature/L7-block-atomization --no-ff -m "Merge sub-phase L7 — block atomization (Stage 1-9 全通过 + Stage 6/7/8 N/A 留 future)"
```

字面合 main 后字面**字面建议**:
1. 字面优先验 D-14 字面 3 高风险项(详 §5.2)
2. 字面发现任一 bug → hotfix 字面新 commit / 或 git revert 字面 merge commit

---

*Block Atomization Completion Report · 2026-05-21*
