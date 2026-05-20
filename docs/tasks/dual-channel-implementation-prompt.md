# 实施提示词:NoteView 双 channel 改造(光标跳末尾根治)

> 把以下完整内容复制到新对话即可启动实施。
>
> 任务自包含,不依赖任何对话上下文 — 所有设计依据都在 `docs/tasks/` 下的 4 份文档里。

---

## 给新对话的提示词

```
请按 docs/tasks/dual-channel-implementation.md(阶段 1)实施 NoteView 光标
跳末尾根治。设计已经定稿,你的任务是**严格按 checklist 执行**,不要重新
设计也不要扩大范围。

## 任务背景

KRIG NoteView 在用户正常编辑(回车 / 空格 / Del / Backspace / 输入字符)时
偶发光标跳到 doc 末尾。今天已经打过 3 个补丁(在 main 上),但都是症状级
不是根治:

- commit 0ba6f74b: Host 200ms 时间窗 + caption 颜色
- commit 692a82a7: math-visual updateAttrs 加 addToHistory:false
- commit d982a921: 6 媒体 NodeView updateAttrs 加 addToHistory:false

用户明确反馈"延时不靠谱",于是从根因层重设方案。

## 必读文档(按顺序)

1. **docs/tasks/cursor-jump-rootcause.md** — 问题分析
   - 8 段链路梳理(用户按键 → IPC → broadcast → useEffect[doc] → replaceWith)
   - 3 个并发设计成因
   - 已打补丁定性(全部症状级)

2. **docs/tasks/noteview-sync-architecture-decision.md** — 方案对比
   - 8 个候选方案矩阵
   - 选定 #4(双 channel)

3. **docs/tasks/dual-channel-implementation.md** — **实施清单(你要执行的)**
   - §1 设计契约(channel 名 / payload 类型 / hook 命名)
   - §2 文件改动清单(按依赖顺序 11 个文件)
   - §3 测试清单(5 类)
   - §4 grep 验证命令
   - §5 风险点 + 应对(§5.1 关键决策:doc 通道与 list 通道分离)
   - §6 PR 拆分
   - §7 实施顺序(9 步阶段 1)
   - §8 followup(阶段 2 不在本 PR)

4. **docs/tasks/host-ref-based-checklist.md** — **不在本 PR 范围**,只作未来参考

## 范围严格态

- **本 PR 只做阶段 1**:双 channel + ebook latent bug 修 + NoteView incomingDoc 通道 + Host 加 `Selection.atStart`
- **不做阶段 2**:旧 200ms 守护 / JSON 指纹 / 100 行长 comment 保留不动
- **不做角度 C**:Host 仍是 doc prop 受控同步,不改 ref-based
- **不动**与本任务无关的文件 — 当前 working tree 可能有用户自己的 3 个 modified
  (math-rendering / MathVisualComponent / pm-host.css),不要动它们

## 执行流程

### 起手包

1. 跑这两条 grep 确认现状:
   ```
   git status -s
   git log -3 --format="%h %s"
   ```
   预期看到 main 最近 commit 含 `ab142e3a Merge docs/dual-channel-design`
   (设计文档已 commit)。working tree 可能有 3 个 user-owned modified,
   忽略它们。

2. 完整读 docs/tasks/dual-channel-implementation.md(尤其 §2 文件改动 + §5.1)。

3. 按 §7 阶段 1 步骤 1-9 顺序执行,**每步跑 `npx tsc --noEmit` 验证绿了
   再下一步**。

### 关键决策点提醒

- §5.1 NoteView 必须用 `incomingDoc` 独立通道,**不能**继续从 useAllNotes
  的 `activeNote.doc` 取 doc 喂给 Host(否则老 channel 仍回灌触发 useEffect)
- §1.2 origin 用 `NOTE_DOC_ORIGIN` 常量,**禁止**写裸字符串 `'note-editor'` /
  `'ebook-reading-thought'` 等
- §2.4 Host.tsx 仅加 `Selection.atStart` 一行,**不删** 200ms/指纹 — 留阶段 2
- §3.4 测试加 2 条 note 被删兜底场景必须 PASS

### 分支与提交

- 新建分支 `fix/note-doc-broadcast-dual-channel`
- 单 PR 一次过(标题见 §6)
- commit 信息参考 §6 "Commit 信息要点"
- 测试清单 §3 全部 PASS 后 **请用户授权再合 main**
  ([[merge-requires-explicit-ok]] —— 不要自己合 main)

### 风险护栏

按 [[strict-compliance-workflow]] 严格态:
- 字面要求即当下要求:checklist 写"加一行"就加一行,不顺手重构
- 复审触发系统重审:user 提出修正后,把已写的所有相关位置都重新检查
- 不挂"过渡方案"标签:旧守护属于阶段 2,本 PR 必须完整保留

### 验收

跑完 §3.1 + §3.2 + §3.3 + §3.4 + §3.5 全 PASS,把测试结果贴给用户后再请合 main。

特别 §3.2(P1#1 ebook 标注 → NoteView 自动刷新)是本 PR **新功能**,必须
亲自验证(过程中需要打开一个 ebook + 一个 thought 关联的 NoteView,做 highlight
操作观察 NoteView 自动刷新)。

## 不要做的事

- 不要重新设计 channel 名 / payload 字段 / hook 命名 — 全部按 §1 已定稿
- 不要"顺手"删 Host 旧守护(200ms / 指纹) — 那属于阶段 2
- 不要改 ThoughtCardEditor / canvas-text-node / EBookView 等其他 view —
  本 PR 只动 NoteView
- 不要触碰用户的 3 个 working tree modified 文件
- 不要自己合 main — 必须用户授权
- 不要 push origin — 必须用户授权
- 不要"觉得 §X.Y 写错了"就改文档 — 如有疑问问用户,设计已审过 3 轮

## 起手第一句话怎么回复用户

"已读完 4 份设计文档。准备按 dual-channel-implementation.md §7 阶段 1
顺序实施。先建分支 `fix/note-doc-broadcast-dual-channel`,然后步骤 1
改 IPC 协议层(channel-names.ts + note-folder-types.ts)。开始吗?"

等用户说 "开始" / "好" 之后再动手。
```

---

## 提示词使用说明

把上面三个反引号包裹的部分(从"请按 docs/tasks/dual-channel-implementation.md"
开始,到"等用户说 ... 之后再动手。"结束)整段复制到新对话窗口的第一条消息发送
即可。

新对话拿到提示词后会:
1. 读 4 份文档(全在仓库 docs/tasks/ 下)
2. 跑 git status 确认起手包干净
3. 按 §7 阶段 1 步骤实施
4. 跑完测试请求合 main

---

*生成于 2026-05-20,配套 docs/tasks/dual-channel-implementation.md 阶段 1 实施*
