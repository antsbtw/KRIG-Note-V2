# Stage 7 EM7 验收报告 — 字面 N/A(用户拍板跳过)

> **日期**:2026-05-21
> **分支**:`feature/L7-block-atomization`
> **状态**:⏭ **N/A**(用户字面拍板跳过 Stage 7;字面登记 D-14)

---

## 字面跳过理由(用户拍板 2026-05-21)

字面 Stage 5/6 完成后 AskUserQuestion 拍板:

> "跳过 Stage 7 手动测,直推进 Stage 8/9 + 合 main"

字面用户字面接受风险:
- 字面接受"静态检查已足"赌注
- 字面 bug 留运行中字面发现 + 字面后续 commit 修

---

## 字面未兑现的 11 个测试场景(留运行中发现)

字面以下场景**字面无 manual verify**,字面靠后续使用中字面暴露:

| # | 场景 | 字面 sub-phase | 字面残余风险 |
|---|---|---|---|
| T1 | 创 note + 输入 3 paragraph + 关闭重开 | Stage 2 | EM2 字面"清旧 dup-id note 后字面 0 throw"字面已隐含 cover |
| T2 | 已有 note 头部插 100 paragraph | Stage 4 | blockId 字面稳定理论上 cover,字面无实测 |
| T3 | paragraph 中间 Enter 拆分 | Stage 2 dup-id fix | EM2 用户字面验过(`dc74a4de` fix 后字面 0 throw)|
| T4 | Backspace 合并两 paragraph | Stage 2 | 字面无单独验,字面 diff 算法 cover |
| T5 | Cmd+C 一 block + Cmd+V 三次 | Stage 2 paste fix | dup-id fix 字面覆盖此场景,字面无单独验 |
| T6 | undo split | Stage 2 | 字面 PM history 自然 cover(decision 026 §5.6)|
| T7 | 创 callout + 内部 paragraph | Stage 2 | childOf 边 + 跨层 wrapper 重建字面无实测 ⚠ |
| T8 | thought 标注 → 编辑 note 上方 → thought 跳转 | Stage 4 | blockId 跨编辑稳定字面**根治性**字面无实测 ⚠ |
| T9 | Copy Link → URL 字面 26 字 ULID | Stage 5 | 字面无实测,但 typecheck cover 字面接口 |
| T10 | PDF 划高亮 → 关闭重开 → 保留 | Stage 2 D-10 | ebook reading-thought 字面走 updateNote 路径字面**最高风险**⚠⚠⚠ |
| T11 | 旧 URL 字面 console.warn | Stage 5 D-12 | 字面无实测,无 toast 直观反馈 |

**字面高风险项**(⚠ 标记):字面建议合 main 后**优先验**字面这三个;字面任一失败 → 字面 revert merge 或 hotfix。

---

## D-14 字面登记(本 Stage 跳过)

字面**新增 D-14** 到偏离日志(下条 commit 字面追加)。

---

*EM7 verify(N/A) · 2026-05-21*
