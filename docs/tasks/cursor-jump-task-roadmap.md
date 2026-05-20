# 光标跳末尾根治任务路线图

> 2026-05-20。回答"完成这事还需要几次对话?"
>
> 基于 grep 验证 + 已完成文档审计,**不是预估,是清点**。

---

## 总览

完整完成"NoteView 编辑稳定 + 同源 view 类 bug 防御"主线需 **2-4 次对话**(取决于 P0/P1 是否做):

| # | 对话 | 优先级 | 前置 | 改动估 | 状态 |
|---|---|---|---|---|---|
| 1 | 阶段 1:双 channel + ebook latent bug | 🔴 必做 | 无 | +170/-90 行,11 文件 | **提示词已就绪**([dual-channel-implementation-prompt.md](dual-channel-implementation-prompt.md)) |
| 2 | 阶段 2:删 200ms/指纹守护 | 🔴 必做 | #1 合 main ≥7 天无报警 | -120 行,1 文件 | 待 |
| 3 | ThoughtView 外部同步 | 🟡 建议 | #1 完成 | **见 §3 重估** | 待 |
| 4 | 角度 C:Host ref-based | 🟢 可选 | #2 稳定 | +80/-100 行,6 文件 | 待 |

**P2 可选项**(业务驱动才做,不一定需要):
- 12 处 PM dispatch 业务 review([[pm-internal-attr-write-must-mark-no-history]])
- extraction-import / migration origin 接入
- active note 被删时清 activeNoteId(方案 a)

---

## #1 阶段 1:双 channel(立即可启动)

### 提示词
[docs/tasks/dual-channel-implementation-prompt.md](dual-channel-implementation-prompt.md)

### 范围
按 [dual-channel-implementation.md §7 阶段 1](dual-channel-implementation.md)。

### 关键交付物
- IPC 协议加 `NOTE_DOC_CONTENT_CHANGED` channel + `NOTE_DOC_ORIGIN` 常量
- main broadcast 排除发起 renderer(NOTE_UPDATE 时)
- **顺手修 latent bug**:ebook addReadingThoughtBlock / removeReadingThoughtBlock 加 broadcast(P1#1 之前一直没工作)
- NoteView incomingDoc 独立通道(不再从 useAllNotes 取 doc)
- Host 加 `Selection.atStart`(替代 PM 默认末尾 fallback)
- **保留** 200ms/指纹守护作冗余

### 不在 #1 范围
- 不动 Host props 受控同步 → #4
- 不删旧守护 → #2
- 不动 ThoughtCardEditor / canvas-text-node / EBookView → #3 或不做

---

## #2 阶段 2:删 200ms/指纹守护

### 触发条件
**#1 合 main 后 ≥7 天观察期,无 cursor-jump 报警**

### 范围
仅 Host.tsx,grep 验证后改动面:
- 5 个 ref 声明删除(lastEmittedJsonRef, lastEmitTsRef)
- 4 处写入删除(onTransaction emit + compositionend flush)
- 2 处读取/判断删除(applyExternalDoc 入口指纹比较 + 200ms 检查)
- 1 个 100 行长 comment block 清理([Host.tsx:106-134](../../src/drivers/text-editing-driver/Host.tsx#L106) 那段)
- 净 **-120 行**

### 回滚 gate
任何 cursor-jump 报警重现 → 立刻 revert,先排查 #1 是否漏了某条 broadcast 路径。

### 估计 1 次对话 / 0.5 天

---

## #3 ThoughtView 外部同步(**重估**:比之前估计复杂)

### 之前的误判
我之前以为"沿用 useActiveNoteDocSync 就行" — 错了。

### 实际架构

ThoughtCardEditor 有**两条**外部更新来源:

| 来源 | 更新走的 channel | ThoughtCardEditor 是否监听 |
|---|---|---|
| 用户在另一卡片编辑同 thought(可能不存在) | THOUGHT_LIST_CHANGED | ✅(useAllThoughts) |
| ebook 标注 → main `updateNote(thoughtId)` | **NOTE_DOC_CONTENT_CHANGED**(#1 后) | ❌(没监听 note channel) |

**问题**:thought 数据物理存在 note 表(thought.id 是 note id),但有两套 capability + 两套 channel。ebook 写的更新走 note channel 广播,而 ThoughtCardEditor 只订阅 thought channel — **永远收不到 ebook 的更新**。

### 修法选项

**A. ThoughtCardEditor 也订阅 NOTE_DOC_CONTENT_CHANGED**
- 改动:复用 #1 的 hook,thought.id 当 noteId 过滤
- 跨 capability 边界(thought view 直接订阅 note channel),违反层次但简单
- 改动估 +30 行

**B. thought capability 也加 doc-content-changed channel**
- main updateNote 后**同时**广播 THOUGHT_DOC_CONTENT_CHANGED(若 atom 是 thought)
- thought capability hook 提供 onDocContentChanged
- 改动估 +80 行(thought 这边复制 #1 的整套机制)

**C. ebook 路径改走 thoughtCapability.updateThought 而不是直接 note.updateNote**
- 数据流统一从 thought capability 进
- 但 sub-phase 022 决议字面规定走 note.updateNote([capability-impl.ts:646](../../src/platform/main/ebook/capability-impl.ts#L646) 注释引"决议 §4.1.3 字面")
- **架构最干净但违背 sub-phase 022 决议**,不推荐

**推荐 A** — 改动小且语义合理(thought 物理存在 note 表,跨订阅可接受)。

### 估计 1 次对话 / 1 天(含分析 + 实施 + 测试)

---

## #4 角度 C:Host ref-based(架构硬化)

### 触发条件
#2 稳定后(旧守护已删 + 双 channel 跑稳)

### 范围
按 [host-ref-based-checklist.md](host-ref-based-checklist.md) §2 角度 C 部分。

### ⚠️ 文档遗留问题
[host-ref-based-checklist.md](host-ref-based-checklist.md) **§1 角度 A 部分已 outdated** — 那里写的"main broadcast 排除发起者"实施细节,已经被 #1 的双 channel 方案取代。**#4 实施时需要明确忽略 §1**,只看 §2(角度 C)。

后续可考虑出独立 `host-ref-only-checklist.md` 把 §1 从该文档剥离,但本路线图暂不要求。

### 改动估
6 文件,净 +80 / -100 行:
- types.ts ×2(driver + capability)
- Host.tsx(forwardRef + useImperativeHandle + 删 useEffect[doc])
- NoteView.tsx(hostRef + swapDoc 调用)
- ThoughtCardEditor.tsx(同 NoteView 模式)
- canvas-text-node/edit-overlay.tsx(同上)

### 估计 1 次对话 / 1 天

---

## P2 可选项(业务驱动才做)

### P2.1 12 处 PM dispatch 业务 review

子代理审计的 19 处高风险 dispatch 已处理 7 处(math-visual + 6 媒体),剩 12 处需要按"用户交互该不该进 undo"边界判断:

- task-list checkbox / toggle-list 折叠 / column-list 加减列 — **用户交互边界争议**
- code-block / math-block / table 的几处 dispatch
- callout emoji 循环 / math-inline Enter 保存
- fullscreen unmount cleanup(code-block / math-visual) — **特别敏感**

详见 [[pm-internal-attr-write-must-mark-no-history]] memory 待审清单。

**估计**:每处 5-15 分钟决策 + 改动,总计 1-2 次对话(0.5-1 天)分批做,或一次性 0.5 天集中决策。

### P2.2 extraction-import / migration origin 接入

`NOTE_DOC_ORIGIN.EXTRACTION_IMPORT / MIGRATION` 已在常量定义,但**没有实际入口写广播**:
- extraction-import 路径:创建 note(走 NOTE_CREATE 路径,不属于 doc-content-changed)
- migration:启动时修正 doc 数据(目前无此入口)

**结论**:当前并无具体需求,**可能永远不做**。常量定义保留为扩展点。

### P2.3 active note 被删时清 activeNoteId(方案 a)

阶段 1 走方案 b(UI 兜底显示"已删除"),activeNoteId 不清。升级到方案 a 需要改 workspaceManager 接入,改动 ~30 行。

**当前优先级低**,看用户反馈再决定。

---

## 时间线建议

```
今天        #1 阶段 1 启动(新对话)
            ↓ 跑测试 + 用户授权合 main + push

+1-3 天    #1 实施完成

           ↓ 观察期 ≥7 天

+10 天     #2 阶段 2(删守护)

           可并行启动:
+10-15 天  #3 ThoughtView 外部同步(P0)

           ↓ #2 稳定 1-2 周

+30 天      #4 角度 C(可选,架构硬化)

           ↓ 看时机

待业务驱动  P2 各项
```

---

## 必做 vs 可选

**必做(达成"光标稳定"主目标)**:
- #1(阶段 1) — 修跳末尾 + 修 P1#1 ebook 同步
- #2(阶段 2) — 删兜底,清理技术债

**强建议(防同款 bug)**:
- #3(ThoughtView)— ThoughtCardEditor 当前漏一条 bug

**可选(架构硬化)**:
- #4(角度 C) — 防御回归

**P2** — 业务驱动

---

## 最少投入路径

如果只追求"修光标跳"(不防同款 bug,不架构硬化):
- **2 次对话**(#1 + #2)≈ 1 天实施 + 7 天观察

**推荐路径**(消除全部已知风险):
- **4 次对话**(#1 + #2 + #3 + #4)≈ 4-5 天实施 + 2-3 周观察

---

*v1 撰写于 2026-05-20。下次启动新对话先看本文确认在哪一步*
