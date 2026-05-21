# 任务：调查 V2 atom 颗粒度的设计 vs 实施 gap

> **任务性质**：纯调查任务，**不写代码、不下结论、不改 spec**
> **触发对话日期**：2026-05-21
> **驱动来源**：用户在位置记忆 feature 实施过程中发现 `krig://block/<noteId>/<idx>:<前30字>` 引用 anchor 不稳，追溯到 V2 atom 颗粒度可能存在设计与实施不一致

---

## 0. 工作目录纪律

所有 cwd 敏感命令(git/npm/grep/find 等)每次 Bash 调用都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 显式指定。

V1 (`/Users/wenwu/Documents/VPN-Server/KRIG-Note`) 仅作参考，**不动**。

---

## 1. 任务边界（严格）

**这是调查任务，不是决策任务。**

- ✅ 你要做：查清事实，列证据，整理成调查报告交给用户
- ❌ 你不该做：给方案、写代码、改 spec、替用户决定取向

最终交付物 = 一份**调查报告**（Markdown 文档），位置：`docs/RefactorV2/notes/atom-granularity-investigation-2026-05-21.md`

让用户读完报告能自己决策"要不要修这个 gap、怎么修"。

---

## 2. 调查触发的背景

前置对话发现 V2 atom 颗粒度有设计与实施不一致的迹象：

### 设计层（spec 文档）

[atom/spec.md §0](../../docs/RefactorV2/data-model/atom/spec.md)：
> "Atom = V2 语义层的**最小**实体"

[README.md §40-55](../../docs/RefactorV2/data-model/README.md)：
> "Atom 承载数据本体，按 domain 分类"
> "pm domain | ProseMirror node JSON | 用户可编辑内容（文本 / 数学 / 代码 / 列表 ...）"

[atom/spec.md §2.1 PmPayload](../../docs/RefactorV2/data-model/atom/spec.md)：
```ts
export interface PmPayload {
  type: string;          // 'textBlock' / 'mathBlock' / 'text' / 'mathInline'
  content?: PmPayload[];
  attrs?: Record<string, unknown>;
  marks?: Mark[];
  text?: string;
}
```
注释举例都是 **block 或 inline 级**（textBlock / mathBlock / text / mathInline），**不是 doc 级**。

文档字面意思：**一个 paragraph 是一个 pm atom，一个 mathBlock 是一个 pm atom，一个 text node 也是 pm atom**。

### 实施层

`src/platform/main/note/capability-impl.ts:55-83`（createNote）：

```ts
async function createNote(initialDoc, folderId) {
  const pmDoc = unwrapPmDoc(initialDoc);  // ← 整篇 doc
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'pm'>({
      payload: { domain: NOTE_DOMAIN, payload: pmDoc },  // ← 整篇 doc 作为 ONE atom payload
    });
    // ...
  });
}
```

**整篇 doc 作为一个 atom 的 payload 写入 SurrealDB**。

### 实际后果

- 一篇 note = 1 个 atom（含 1000+ block JSON 嵌套）
- block 没有独立 id
- block 之间没有边（虽然 spec 说"边是一等公民"，但 block 不是独立 atom 时根本没法连边）
- 跨 note 引用某段、AI 标注某段、关系图谱节点指向某段——缺基础设施
- 位置记忆只能用 `<idx>:<前30字>` 文本前缀算 anchor，编辑后会漂

---

## 3. 不要急下结论说"这是漏洞"

用户特别提醒。可能的真相至少 4 种：

| 可能性 | 含义 |
|------|------|
| **A. 故意延后** | 实施者**知道**应该按 block 拆，但选择延后到某 sub-phase；应该有决议文档记录 |
| **B. 措辞歧义** | 设计文档"最小"实际指"atom 类型最小"而非"颗粒度最细"；note 整体确实是 pm atom 的合理形态 |
| **C. 历史决议已记录** | 这件事已经讨论并决议过，文档藏在某 decision 里，需要找到 |
| **D. 真 gap** | 没人意识到这个偏离，没有任何记录 |

**调查目标**：穷举上面 4 种可能，给用户每种可能的证据，让用户自己判断真相。

---

## 4. 调查清单（按顺序做，每阶段完成后给用户 200 字汇报）

### 阶段 1：读完所有相关文档

按顺序读，**每读一份给用户简短要点**，然后读下一份：

1. `docs/RefactorV2/data-model/README.md` —— 整体框架 + Phase 历史
2. `docs/RefactorV2/data-model/atom/spec.md` —— Atom 通用接口、§0「最小实体」、§2 pm domain 完整定义
3. `docs/RefactorV2/data-model/atom/decisions/` 下**所有**编号决议（002 / 003 / 004 / 005...）
4. `docs/RefactorV2/data-model/persistence/spec.md`
5. `docs/RefactorV2/data-model/persistence/atom-entity.md`
6. `docs/RefactorV2/data-model/persistence/edge-entity.md`
7. `docs/RefactorV2/data-model/persistence/surreal-schema.md`
8. `docs/RefactorV2/data-model/persistence/decisions/` 下**所有**决议（006 / 007 / 008 / 009 / 010 / 011 等）
9. `docs/RefactorV2/data-model/relations/spec.md`
10. `docs/RefactorV2/data-model/relations/pm-note.md` + `pm-note/blocks/` 下若干份子文档（重点看 paragraph / heading / orderedList 三个）
11. `docs/RefactorV2/data-model/naming-conventions.md`
12. `docs/RefactorV2/data-model/mixins/spec.md`
13. `docs/00-architecture/three-layer.md` §2.2「atom = PM node JSON 形态」
14. `docs/00-architecture/vision.md` —— KRIG 整体定位
15. `docs/00-architecture/charter.md` §4 atom/block/blockView 定位
16. `docs/RefactorV2/stages/` 下任何提到「note 迁移」「block 拆分」「atom 颗粒度」的文档

**特别关注**这些 sub-phase 决议（最可能藏着"为什么按 note 整体存"的答案）：
- decision 012 —— sub-phase 2 noteStore 迁移设计
- decision 016 —— sub-phase 3a hasNoteView 边 / pm domain 复用
- decision 022 —— ebook+annotation→thought 迁移（涉及 PM atom 范式）
- 022 之后的决议（如果有）

### 阶段 2：grep 现有代码

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && \
  grep -n "putAtom\|getAtom\|listAtoms" src/platform/main/note/ src/platform/main/graph/ -r

# 对比 graph capability —— 用户提到 graph 的 text-node 是独立 atom
# 如果 graph 按 block/shape 拆 atom，但 note 按整篇拆，说明 note 是特例,值得调查
ls src/platform/main/graph/
grep -n "putAtom\|domain.*pm" src/platform/main/graph/ -r

# 边表达
grep -rn "putEdge\|listEdges" src/platform/main/ | head -30

# 现有 block schema 有没有任何 id 字段
grep -rn "attrs.*id\|attrs:.*{.*id" src/drivers/text-editing-driver/blocks/ | head

# anchor 体系当前用法
grep -rn "getBlockAnchorAt\|scrollToBlockAnchor\|krig://block" src/ | head -20

# PM doc 写入路径列全
grep -rn "updateNote\|noteUpdate" src/ | head -10

# 看 capability/note 完整实现
cat src/platform/main/note/capability-impl.ts
```

### 阶段 3：跨对比 spec ↔ 实施

针对每个发现，做一个 spec ↔ 实施 对照表（写进报告）：

| 维度 | spec 说什么（引原文 + 行号） | 实施做了什么（引代码 + 行号）| 一致？|
|------|------|------|------|
| pm atom 颗粒度 | … | … | ✅/❌ |
| block 之间关系表达 | … | … | ✅/❌ |
| 边的范围 | … | … | ✅/❌ |
| 跨 atom 引用机制 | … | … | ✅/❌ |
| atom 唯一性（id 字段） | … | … | ✅/❌ |
| 编辑事件粒度 | … | … | ✅/❌ |

### 阶段 4：找历史踪迹

```bash
# sub-phase 实施 commit message
git log --oneline --all | grep -iE "sub-phase|note.*store|block.*atom|pm.*atom" | head -20

# 早期讨论
find docs/refactor/ docs/RefactorV2/ -name "*.md" -exec grep -l "block.*atom\|atom.*block\|note.*粒度\|colocation" {} \; 2>/dev/null

# 用户上一对话有提到过的相关 PR 或决议
git log --grep "L7\|atom\|note migration" --oneline | head -20
```

### 阶段 5：把发现写成调查报告

输出文件：`docs/RefactorV2/notes/atom-granularity-investigation-2026-05-21.md`

**报告结构（严格按这个写，只摆事实、不下结论）**：

```markdown
# Atom 颗粒度调查报告（2026-05-21）

> 调查触发：用户问"note 内 block 不是 atom 符合数据模型设计吗？"
> 调查者：claude（本报告由 Agent 调查产出）
> 范围：纯事实调查，**不含决策建议**

## 1. 触发问题（背景）

…（一段说明）

## 2. 事实矩阵：spec ↔ 实施 对照表

…（阶段 3 的表格）

## 3. 历史踪迹（找到的相关决议、commit、文档）

### 3.1 找到的相关决议
- decision 012 §X: ...
- decision 016 §Y: ...
- ...

### 3.2 找到的相关 commit
- commit abc1234: ...
- ...

### 3.3 **未找到**的踪迹（同样重要）
- 未找到关于"为什么 note 整篇按一个 atom 存而不是按 block 拆"的明确决议
- 未找到关于"atom 颗粒度延后到 sub-phase X"的延后说明
- ...

## 4. 4 种可能真相的证据

### 可能性 A: 故意延后
**证据**：
- ...
**反证**：
- ...

### 可能性 B: 措辞歧义
**证据**：
- ...
**反证**：
- ...

### 可能性 C: 历史决议已记录
**证据**：
- ...
**反证**：
- ...

### 可能性 D: 真 gap
**证据**：
- ...
**反证**：
- ...

## 5. 影响面（事实层，不评价好坏）

### 5.1 当前受限的 feature
- 跨 note 引用某段：(代码位置 + 当前如何实现 + 哪些场景会失败)
- AI 标注某段：...
- 关系图谱节点指向某段：...
- 多设备协作冲突合并粒度：...
- 滚动位置记忆：...

### 5.2 设计原则被限制的表达
- README §40 "属性走边" 在 block 级不适用：原因 ...
- spec §2.1 PmPayload 举例的"text / mathInline"按 spec 应是独立 atom，但实施未拆：影响 ...

### 5.3 当前实施的合理性（不评价对错，只列事实）
- 整篇 atom 的优势：写入简单 / SurrealDB 一行操作 / no JOIN
- block 级 atom 的代价：写入碎 / 查询要拼装 tree / 边表数量爆炸

## 6. 开放问题（必须用户决策）

1. atom 颗粒度该不该下沉到 block？取决于产品定位
2. 如果下沉，新旧引用如何兼容？
3. 历史决议有没有第三方记录我没找到？

## 7. 不在本报告范围（守住边界）

- 我未决定要不要改架构
- 我未写代码
- 我未改设计文档
- 我未立 sub-phase
- 这些都等用户读完报告后决策
```

---

## 5. 调查纪律

### 5.1 用户已经踩过的坑（避免重复）

读 `/Users/wenwu/.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/MEMORY.md` 全部条目，**特别注意**：

- `feedback_no_fallback_bandaid_fixes.md` —— bug 排查必须先 log 定位真因
- `feedback_decision_grep_verify_complete_propagation.md` —— 决议字面拍板必须 grep 6 层传播链
- `feedback_v2_is_workspace_v1_is_reference.md` —— V2 是工作目录、V1 仅参考
- `feedback_strict_compliance_workflow.md` —— 严格态全谱表

### 5.2 不能做的事（红线）

- ❌ 不要替用户决定「应该拆 block atom」还是「应该改 spec」——这是产品/架构决策
- ❌ 不要边查边写代码或改文档——你是调查员，不是实施者
- ❌ 不要把"我推测的可能性"包装成"我的结论"——4 种可能列证据，让用户判
- ❌ 不要急着写 sub-phase 决议——决议是用户看完调查后才决定要不要立项
- ❌ 不要为了"产出感"而填造证据——找不到就如实写"未找到"

### 5.3 必须做的事

- ✅ 用 TodoWrite 记录调查计划（5 阶段）
- ✅ 每读完一份关键文档给用户 200 字内汇报，让用户随时看到你查到什么
- ✅ 全部读完阶段 1 才开始阶段 2 grep 代码
- ✅ 查到关键事实立刻告诉用户，不憋到报告写完才说
- ✅ 报告引用代码必须带行号、引用文档必须带 §章节号

---

## 6. 用户对话风格提示

- 用户偏好简洁、有事实根据的回答；避免冗长前置铺垫
- 用户会指出推测和事实的边界，主动标注"以下是推测"
- 用户不喜欢"我建议"的句式；倾向"事实是 X，可能性 A/B/C"
- 用户在意架构原则的一致性，不轻视小漏洞

---

## 7. 第一步该做

1. **读这个提示词全文**（已经在做）
2. **用 TodoWrite 把 5 阶段写成 todo list**
3. **开始阶段 1**：读 `docs/RefactorV2/data-model/README.md`，给用户 200 字要点
4. 等用户确认要点没偏后，继续读下一份文档

不要跳过任何阶段。
