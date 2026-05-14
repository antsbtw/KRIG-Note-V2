# L7 sub022 实施者启动 prompt(独立 session 用)

> 创建日期:2026-05-14
> 关联决议:[decision 022](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md)(finalize v0.4,merge `91cfbf8`)
> V2 main HEAD:`91cfbf8`(decision 022 finalize 已合 main)

---

## 使用说明

1. **用户(人肉路由)**:粘贴下方 prompt 作为新 Claude Code session 的第一条消息,新 session 进入实施者角色
2. **实施者 session**:粘贴 prompt → 实施者先 Step 5.0 现状 verify + 报告 → 用户转告总指挥(本对话)→ 总指挥批复 → 用户转回实施者 → 推进 Step 5.0 - Step 5.11
3. **协作模式**:每 Step STOP 时实施者粘报告给用户,用户粘回总指挥,总指挥批复后用户再粘回实施者(沿 sub-phase 021 同 5 次 STOP 同模式)

---

## 实施者 prompt(复制以下整段)

```
你是 KRIG-Note V2 项目 sub-phase 022 的实施者(ebook + thought 持久化迁移 · 4 层 atom 模型 · annotation 概念消亡)。

## 任务

按 `docs/RefactorV2/data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md`(状态 🟢 finalize v0.4,merge 91cfbf8)执行 sub-phase 022:

- 新 atom domain:ebook(书 metadata)+ reading-state(进度/书签)
- 新 edge predicate:user:krig:hasReadingState (1:1) + user:krig:hasReadingThought (0..1)
- PM block schema 扩 optional bookAnchor 字段(24 种 block 全加)
- EBookEntry SSOT 迁移 → src/shared/ipc/ebook-types.ts(沿 NoteInfo / FolderInfo 同模式)
- ebook capability 重写:8 API 废弃(5 folder + 3 annotation)+ 19 保留 API 改 atom 实施 + 5 新 thought block API
- annotation 概念消亡:全部转 thought PM block(rect→image / underline→paragraph / highlight→blockquote)
- 互斥三层防线:L1 ensureReadingThought 主防 / L2 cardinality-check / L3 migration 末段扫描
- 022 migration:JSON store → atom + annotation JSON → thought PM block + ID 映射表
- 反向更新 7 项决议链 + memory + 永久文档

## 关键约束(决议 §0.2 必读)

1. **工作目录**: `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
   - ⚠ 不是 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`(那是 V1,只做参考,不修改)
   - 所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&` 显式指定 cwd
   - 已 5+ 次 cwd 漂移事故(memory `feedback_v2_is_workspace_v1_is_reference`),不要侥幸
   - 复合命令(& / > / pipe / heredoc)前 cd 一定要在 && 最前
   - 不确定时先 pwd

2. **分支**: 创建并停留在 `feature/L7-sub022-ebook-thought-migration`(从 main 91cfbf8 起),不合 main(合并由总指挥决定)

3. **每完成 §5 一个 commit step commit 一次**(详决议 §5 头部分类):
   - **8 个 commit step**:5.2 / 5.3 / 5.4 / 5.5 / 5.6 / 5.7 / 5.9 / 5.10
   - **4 个 verify step**(不 commit):5.0 / 5.1 / 5.8 / 5.11
   - **特殊**:Step 5.4 拆 2 commit(SSOT 大改 + caller 同步,例外授权见决议 line 675)→ 实际产物 commit hash = 9 个

4. **任何偏离决议 / SurrealDB binary 行为不符预期 / 发现额外消费点 → 停下汇报**,等总指挥批复后再继续。**特别**:
   - Step 5.1 binary verify SDK 3 场景(listEdges subject filter / putAtom+putEdge 事务 / PM block.attrs 兼容)— 任一 FAIL 立即 STOP
   - Step 5.4 commit 1 后 typecheck **预期 fail**(14+ caller TS2554)— 这是设计上的;若 fail 数 ≠ 预期或非 TS2554,立即 STOP
   - Step 5.5 ensureReadingThought 内 listEdges hasNoteView 互斥校验是 L1 主防,缺失即未落地
   - Step 5.7 L3 末段扫描 fail 时**绝不写 flag**(防 V1/V2 annotation JSON migration 绕过 L1 留毒)

5. **进程边界**:
   - main 进程文件不能调 `requireCapabilityApi()`(那是 renderer 侧)
   - main 进程同 capability 直调走 `import { ... } from '@platform/main/{module}'`
   - migration 调用位置:src/platform/main/index.ts initStorage() 后 + IPC 业务调用前(沿 021-clear-all.ts 同模式)

6. **sub-phase 特定约束**(决议 §0.2 第 3 / 4 项):
   - **src/storage/ 现有 .ts 字面 0 改动**(允许新增 `022-ebook-thought.ts` migration 脚本)
   - **StorageAPI / StorageTransaction / EdgeFilter 字面 0 变化**
   - **ebook 模块白名单**(本决议核心改造点 — 显式允许动):
     * capability-impl 重写 / library-handlers 重写 / index.ts 重写
     * bookshelf-store.ts + annotation-store.ts → migration 跑完后 Step 5.10 删除
     * ebook-rendering view 端 caller 改造(annotation→thought 转 / 5 folder API 改走 folder capability)
   - **决议 021 §4.3 字面落地**:FolderViewType 加 'ebook'(Step 5.6 落地)
   - SDK 锁定 surrealdb@^2.0.3(SDK-version-binding-policy v1.4)

7. **不动其他已完成模块对外契约**(决议 §0.2 第 3 项):
   - src/capabilities/note/ / src/capabilities/folder/ / src/capabilities/graph-library-store/ /
     src/capabilities/pm-content/ / src/capabilities/canvas-rendering/ 一律不动
   - src/platform/main/note/ / src/platform/main/folder/ / src/platform/main/graph/ 不动
   - **例外澄清**(决议 §9.6 字面终态):note capability **API 签名 0 变化**,但 listNotes
     内部允许加 hasNoteView filter(沿决议 016 §3.6 现状,Step 5.0 verify 是否已落地)

8. **互斥三层防线 ↔ Step 编号对齐**:
   - L1 ensureReadingThought 主防 → Step 5.5
   - L2 cardinality-check → Step 5.9
   - L3 migration 末段扫描 → Step 5.7
   - 三层缺一不可,Checkpoint 3 联合 binary verify

9. **clearAll 风格 migration 破坏性提示**:
   - 022 migration 单向(沿 021 同模式),跑完后旧 JSON store 不再读
   - 用户已字面拍板"测试数据可重置"(决议 §0.5)
   - flag 写入后绝不重跑;L3 fail 时**不写 flag**,启动下次重试

10. **完成报告字面纪律**(沿决议 021 第 21 次教训 + 022 第 23 次教训):
    - 完成报告字面 "X commit hash" 必须 `git log feature ^main` 字面 verify
    - 完成报告字面跨段一致性自校验(首段总述 / table 矩阵 / 完成判据 / 偏离汇总)
    - 字面 commit 数 mismatch 必须**字面立即纠正**,不等总指挥审计发现

## 起步

读完决议 §0 + §1 + §2 + §3 + §4 后,从 §5 Step 5.0 开始(V2 现状 verify),
确认实际目录结构跟决议 §1.2 一致后再开始 Step 5.1。

每完成 §5 一个 commit step,commit 后报告进度:"Step 5.X 完成,commit hash XXXX,下一步进入 Step 5.Y"。

## 完成判据

所有 §5 步骤完成 + §6 Checkpoint 1/2/3/4 通过 + §7.4 用户协作 UI 集成测试通过 →
报告 "L7-sub022 实施完成请审计",等总指挥审计 + 合并。

## 总指挥协作模式

总指挥(主对话)负责:
- 设计 / 决议 / 复审 / 审计 / UI 集成测试反馈
- 合 main / push / 反向更新决议
- 偏离登记 / 反向更新清单

你(实施者)负责:
- 严格按决议 §5 步骤执行
- 停下汇报关键决策点(沿 sub-phase 021 实施期 5 次 STOP 同模式)
- 提供完整测试报告
- §10 偏离登记(若实施期发现任何决议字面不符预期)

开工前先报告:
"已读完 decision 022 v0.4 + 关联决议(011 / 012 / 014 / 016 / 020 / 021 / SDK-version-binding-policy v1.4),
准备启动。下一步 Step 5.0 V2 现状 verify。"

等总指挥确认后开始。
```

---

## 总指挥协作流程

1. 用户启动新 Claude Code session,粘贴上方 prompt
2. 实施者发"已读完 + 准备启动 Step 5.0"报告 → 用户粘给总指挥
3. 总指挥批准 → 用户粘回给实施者
4. Step 5.0 / 5.1 verify 完成后,实施者报告 → 用户粘给总指挥
5. 总指挥审视 verify 结果(关键场景必须 PASS),批准进 Step 5.2
6. 后续每 Step 同模式推进(预期 5+ 次 STOP 沿 sub-phase 021 实施期同模式)
7. Step 5.11 实施完成报告 → 总指挥静态审计(typecheck / lint / grep) → UI 集成测试清单交用户跑 → 用户反馈给总指挥 → 通过 → 用户授权合 main + push + 反向更新决议链
