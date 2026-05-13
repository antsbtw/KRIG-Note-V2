# L7 sub021 实施者启动 prompt(独立 session 用)

> 创建日期:2026-05-13
> 关联决议:[decision 021](../data-model/persistence/decisions/021-sub-phase-021-folder-view-isolation.md)(finalize v0.3,merge `03aab55`)
> V2 main HEAD:`03aab55`(decision 021 finalize 已合 main)

---

## 使用说明

1. **用户(人肉路由)**:粘贴下方 prompt 作为新 Claude Code session 的第一条消息,新 session 进入实施者角色
2. **实施者 session**:粘贴 prompt → 实施者先确认 + 报告 → 用户转告总指挥(本对话)→ 总指挥批复 → 用户转回实施者 → 推进 Step 5.0 - Step 5.8

---

## 实施者 prompt(复制以下整段)

```
你是 KRIG-Note V2 项目 sub-phase 021 的实施者(folder 视图隔离 + Q7 弱保护)。

## 任务

按 `docs/RefactorV2/data-model/persistence/decisions/021-sub-phase-021-folder-view-isolation.md`(状态 🟢 finalize v0.3,merge 03aab55)执行 sub-phase 021:

- 引入新边类型 user:krig:folderForView(folder atom → literal '__view__/note' or '__view__/graph')
- folder capability listFolders / createFolder 加 viewType 入参 + 过滤/写边逻辑(2 view 改造)
- graph folder-adapter 强制 'graph' viewType(renderer IPC 字面透明)
- 4 caller 改造(note 3 处 'note' viewType,graph 0 改)
- clearAll migration 一次性脚本(BEGIN ... COMMIT 多语句事务)+ flag 防重跑
- Q7 弱保护:含资源 folder 删除前弹框确认
- 反向更新 7 个决议链 + SDK-policy 修订 v1.3

## 关键约束(决议 §0.2 必读)

1. **工作目录**: `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
   - ⚠ 不是 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`(那是 V1,只做参考,不修改)
   - 所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&` 显式指定 cwd
   - 涉及 git / npm / find / rm 等 cwd 敏感命令尤其要小心(已 5 次事故,memory `feedback_v2_is_workspace_v1_is_reference`)
   - 复合命令(& / > / pipe / heredoc)前 cd 一定要在 && 最前
   - 不确定时先 pwd

2. **分支**: 创建并停留在 `feature/L7-sub021-implementation`(从 main 03aab55 起),不合 main(合并由总指挥决定)

3. **每完成 §5 一个有代码/文档/脚本变更的 step commit 一次**,纯 verify / 自测 / 用户测试 step 不 commit(详决议 §5 分类:6 个 commit step + 3 个非 commit step)

4. **任何偏离决议 / SurrealDB binary 行为不符预期 / 发现额外消费点 / 重大架构选择 → 停下汇报**,等总指挥批复后再继续。**特别**:
   - Step 5.1 binary verify SDK listEdges literal filter 行为(决议 §6.1 关键场景),若 FAIL 立即停下汇报
   - Step 5.2 typecheck 必须明示性 fail(预期 TS2554 ≥ 4 处);若 fail 数 != 4 或非 TS2554 错误,停下汇报
   - Step 5.6 clearAll migration 走单次 db.query() 承载多语句事务脚本(术语:**不是**"单 SQL 语句",见决议 §0.7 / §7.2)

5. **进程边界**:
   - main 进程文件不能调 `requireCapabilityApi()`(那是 renderer 侧)
   - main 进程同 capability 直调走 `import { ... } from '@platform/main/{module}'`
   - folder-adapter 现状已在 main 进程,沿用

6. **sub-phase 特定约束**:
   - **src/storage/ 现有 .ts 字面 0 改动**(决议 §0.2 第 3 条),但**允许**新建 `src/storage/migrations/021-clear-all.ts`(沿 transaction-helpers.ts 同模式)
   - **StorageAPI / StorageTransaction / EdgeFilter 字面 0 变化**(决议 §4.2 不变约束 + §0.7 第 15 次教训)
   - FolderCapabilityApi 仅 listFolders / createFolder 签名加 viewType,其他 5 API 签名不动(决议 §0.2 第 4 条)
   - graph 路径 IPC channel 字段**不**加 viewType(renderer 透明,viewType 在 main 端 folder-adapter 内部硬编 'graph')
   - SDK 锁定 surrealdb@^2.0.3(SDK-version-binding-policy §4)

7. **不动其他已完成模块**:
   - `src/capabilities/note/` / `src/capabilities/graph-library-store/` / `src/capabilities/pm-content/` 一律不动
   - `src/platform/main/note/` / `src/platform/main/graph/canvas-store.ts` 核心逻辑不动(folder-adapter.ts 例外)
   - `src/platform/main/ebook/` / `src/capabilities/ebook-library/` **完全不动**(ebook 接入留 sub-phase 022)
   - 允许通过 barrel 消费它们的对外 API,**禁止修改内部实施 + 对外契约**
   - 例外:决议 §0.2 第 3 条 / 第 4 条显式允许的改造点

8. **不动 view 渲染逻辑**:
   - `src/views/note/` / `src/views/graph-canvas-view/` 仅 listFolders / folderList 调用站点字面加 viewType 入参
   - 渲染层 / 编辑器 capability 不动

9. **clearAll migration 是破坏性操作**:
   - 第一次启动会清空整个 SurrealDB(folder / note / graph atom + 所有边)
   - 用户 2026-05-13 拍板"测试数据可重置"(决议 §0.5)
   - flag 文件写入后绝不重跑

## 起步

读完决议 §0 + §1 + §3 + §4 后,从 §5 Step 5.0 开始(V2 现状 verify),确认实际目录结构跟决议 §1.2 一致后再开始 Step 5.1。

每完成 §5 一个 commit step,commit 后报告进度:"Step 5.X 完成,commit hash XXXX,下一步进入 Step 5.Y"。

## 完成判据

所有 §5 步骤完成 + §6 Checkpoint 1 / Checkpoint 2 通过 + §7.4 用户协作 UI 集成测试通过 → 报告 "L7-sub021 实施完成请审计",等总指挥审计 + 合并。

## 总指挥协作模式

总指挥(主对话)负责:
- 设计 / 决议 / 复审 / 审计 / UI 集成测试反馈
- 合 main / push / 反向更新决议
- 偏离登记 / 反向更新清单

你(实施者)负责:
- 严格按决议 §5 步骤执行
- 停下汇报关键决策点
- 提供完整测试报告
- §10 偏离登记(若实施期发现任何决议字面不符预期)

开工前先报告:
"已读完 decision 021 v0.3 + 关联决议(012 / 014 / 016 / 020 / SDK-version-binding-policy v1.2),准备启动。下一步 Step 5.0 V2 现状 verify。"

等总指挥确认后开始。
```

---

## 总指挥协作流程

1. 用户启动新 Claude Code session,粘贴上方 prompt
2. 实施者发"已读完 + 准备启动 Step 5.0"报告 → 用户粘给总指挥
3. 总指挥批准 → 用户粘回给实施者
4. Step 5.0 / 5.1 verify 完成后,实施者报告 → 用户粘给总指挥
5. 总指挥审视 verify 结果(关键场景必须 PASS),批准进 Step 5.2
6. 后续每 Step 同模式推进
7. Step 5.8 实施完成报告 → 总指挥静态审计(typecheck / lint / grep) → UI 集成测试清单交用户跑 → 用户反馈给总指挥 → 通过 → 用户授权合 main + push + 反向更新决议链
