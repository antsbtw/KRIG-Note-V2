# Handoff — extraction self-echo loop 诊断进行中

**项目**：KRIG-Note V2 (`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)
**日期**：2026-05-22
**分支**：main（origin/main 已是最新，含 fix/extraction-block-id-missing 和 slash-menu Notion 美化）
**Memory 关键条目**：
- `extraction-self-echo-loop-followup` — 本 bug 历史和怀疑根因
- `view-self-loop-jitter` — 通用模式 + 4 问检查表
- `diag-log-before-speculation` — 跨模块 bug 必须先 log 再修
- `no-fallback-bandaid-fixes` — 禁止给 storage.transaction 加通用 OCC retry 兜底
- `v2-cwd-drift-again` — V2 cwd 已漂 7 次，每次 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`

---

## Bug 描述

PDF extraction import 完成后，**用户没编辑、没点开 note**，main 进程出现 ~40 次 `note.update` 雪崩，docSize 每次递减 1 字节，SurrealDB transaction conflict 互踩，留下 cardinality violation 脏数据。

## 已确认事实（铁证，来自 `/tmp/krig-echo-diag.log` 文件日志）

1. **broadcast 守门完美工作**：
   ```
   broadcast emitterId=1 totalWins=1 skipped=[1] sentTo=[] noteId=... docSize=729393
   ```
   `sentTo=[]` 说明 broadcastNoteDocContentChanged **没发给任何窗口** —— echo 来源**不是** main 回灌 renderer。

2. **renderer 端在 createNote 后约 3 秒**（NoteView mount 期间）**自发**触发 40 次 `note.update` IPC：
   - 738ms 内 40 次 IN
   - docSize 单调递减 1 byte（729393 → 729354）
   - 每个间隔 15-30ms
   - 用户没编辑，没切换 note

3. **第 1 次 IPC 完成需要 66 秒**（main transaction queue 被压死，39 个后续全 FAIL）

4. PM dispatchTransaction stack（DevTools 截图证据）：
   ```
   handleDocChange (NoteView.tsx:103)
     ← Host.tsx onTransaction
     ← EditorView.dispatchTransaction
   ```

## 当前已部署的诊断探针

`src/platform/main/note/broadcast.ts` 顶部加了 `diagWrite()` helper：
- 写文件 `/tmp/krig-echo-diag.log`
- 60 行计数器封顶（防爆炸）
- 头文件 import 了 `fs from 'node:fs'`
- export `__diagWrite` 给其他模块复用

`broadcastNoteDocContentChanged` 已改用 `diagWrite`：记录 `emitterId/totalWins/skipped/sentTo/noteId/docSize`。

`handlers.ts` 中 `IPC_CHANNELS.NOTE_UPDATE` 也有 console.log 探针（旧的，应改成 diagWrite）。

## 未完成 — 下一步（用户已批准方案 A）

**加 Host.tsx onTransaction 文件日志探针**，看真正触发 emit 的 tr 是什么：

```ts
// src/drivers/text-editing-driver/Host.tsx
// onTransaction callback (line 154 附近)
(tr, v) => {
  // 临时探针 — 走文件而非 console
  const skipOnChange = tr.getMeta('skipOnChange');
  const appendedTransaction = tr.getMeta('appendedTransaction');
  // 把诊断行通过 IPC 传给 main 写文件,或直接 fs.appendFileSync(renderer 端也能调)
  // ...
  if (tr.getMeta('skipOnChange') === true) return;
  if (tr.docChanged) { /* emit */ }
}
```

注意 Host.tsx 在 renderer 端（vite dev 编译），需要走 ipc 把诊断转 main 进程，或 renderer 端直接 `require('fs')`（Electron 上允许）。

## 怀疑根因

1. **PM appendTransaction tr** 跟 rootTr 一起塞回 view.state，但 dispatchTransaction 回调拿到的 tr 是 rootTr，setMeta('skipOnChange') 标在 plugin 自己的 tr 上，**onTransaction 检查的是错的 tr**
2. **每次少 1 byte 不对应注 ULID（+26 byte）** —— 不是 plugin 反复注 id，是其他地方
3. **可能：某 plugin 在 view mount 时连续 dispatch 多个独立 tr**（例如 title-guard / TOC / block-handle），每个都触发 onChange emit IPC

## 工作流程纪律（用户严格要求）

- 不要"字面"刷屏（token 退化的表现，用户已警告 1 次）
- 输出要 concise，标点中英文都用，避免重复词
- 工作分支必须新开 `fix/extraction-self-echo-loop`，不在 main 上改
- 重要操作（rm krig-data、merge to main、git push）都要用户明确授权
- 每次 Bash 调用都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`，不然漂回 V1
- Read 工具必须绝对路径

## 测试流程

1. 用户关 V2 → 告诉 claude "已关"
2. claude 验证 `pgrep surreal` 空 + 删 `~/Library/Application Support/KRIG Note V2/krig-data`
3. 用户重启 V2 → 在 PDF reading view 里点"提取章节" → 等出现 transaction conflict 字样
4. 用户立即关 V2（1-2 秒内，防写满）
5. claude `cat /tmp/krig-echo-diag.log` 看证据

## Followup（本轮不做）

- 脏数据清理（cardinality violation 已合到 main 的 assemble fallback 暂时遮蔽）
- broadcastNoteListChanged 字面不带 emitterId — 但已确认 echo 不来自这条，所以不动
- SurrealDB OCC retry — memory 字面禁止用兜底 retry 绕过根因
