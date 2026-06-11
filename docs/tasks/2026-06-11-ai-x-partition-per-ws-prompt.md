# 实施 Prompt:AI/X webview partition per-ws 化(cookie/session 按 ws 隔离)

> 记录日期:2026-06-11
> 提出人:总指挥(确认 ws 心智模型 = 「独立身份/网络单元」)
> 状态:**已拍板方向(分离),待发起;本期未动手**
> 关联:`docs/tasks/2026-06-01-per-ws-proxy-handoff.md`(per-ws 代理工程)、
>       记忆 `project-per-ws-proxy`、`project-x-integration-phase01`、`project-ws-instance-isolation-invariant`
>
> **前置已就绪(2026-06-11)**:ws 实例隔离统一收口(wcId 定向 + SSE per-wc 池)已合进
> `main`(merge commit `a21aa2cf`,含提交 `cea4a27e`),`main` 已 push、typecheck/vitest 全绿。
> **本期基于干净 main 起步,移交新对话完成。** partition(session 层)与本期前置的 wcId
> 定向(webContents 层)**正交**——partition 决定 webview 用哪份 session(cookie/出口),
> wcId 决定操作打到哪个 webContents 实例,两者不冲突;但 AI 登录态随 partition 变化会影响
> SSE 能否抓到回复,§5 回归须一并验。
> 注:X 集成主线(`docs/x-integration-design` 分支)尚未完成(后续 2.5-a 收尾 / 2.5-b 媒体 /
> 阶段3 article 等),本期是**插队**先做的地基,不阻塞也不依赖 X 后续阶段。

---

## 0. 一句话目标

把 AI View / X View 的 webview `partition` 从写死的全局 `WEBVIEW_PARTITION`('persist:webview')
改成 **per-ws** `persist:webview-${workspaceId}`,与内置浏览器(`WebView.tsx` 已 per-ws)对齐 ——
**同 ws 内 AI/X/浏览器共享登录态,跨 ws 完全隔离**。这是 per-ws 代理工程里「翻译/AI partition
也要 per-ws 化」(handoff §59)那一期的落地。

## 1. 为什么做(总指挥拍板理由)

- 总指挥心智模型 = **workspace 是严格隔离的网络单元 / 独立身份**(per-ws 代理第一性原理)。
- partition = session = {cookie + 网络出口 + 存储} 不可分割。AI/X 共用全局 partition →
  **AI/X 永远只能走同一网络出口**,是该原则的隔离漏洞;且与内置浏览器 per-ws 不一致。
- 现状成因:X 集成 阶段0/1 图登录便利,有意共享第一个 ws 的 `persist:webview`
  (记忆 `project-x-integration-phase01`)。已证此为缺口,需收口。

## 2. 现状(已核实,2026-06-11)

| 位置 | partition | 粒度 |
|---|---|---|
| 内置浏览器 [WebView.tsx:605](src/views/web/WebView.tsx#L605) | `persist:webview-${workspaceId}` | **per-ws(已对)** |
| AI Host [ai-extraction/Host.tsx:223](src/capabilities/ai-extraction/Host.tsx#L223) | `WEBVIEW_PARTITION`('persist:webview') | 全局共享(待改) |
| X Host [x-extraction/Host.tsx:131](src/capabilities/x-extraction/Host.tsx#L131) | `WEBVIEW_PARTITION` | 全局共享(待改),且有注释 `void workspaceId; // 不按 ws 隔离` |
| 翻译 webview | `WEBVIEW_TRANSLATE_PARTITION` | 独立(本期不动,除非要 per-ws 翻译) |

workspaceId 在 AI Host / X Host 都已拿得到(props),改动点本身很小(一行)。**难点在主进程钩子**。

## 3. 动手前必查(调查先行,别假设阶段1 已覆盖 AI/X)

per-ws 代理 handoff §3 列了「绑死单 partition 的主进程钩子」:下载 will-download、
media:// 协议、shouldHandle(右键/快捷键/弹窗判定)、ytdlp cookie。内置浏览器 per-ws 时
(阶段1)**应该**已修成「跟随 per-ws partition / 匹配 `persist:webview-*` 前缀」。本期必须核实:

1. **AI/X 的 webview 实际走没走这些钩子**:
   - SSE 注入 / X 提取走 `executeJavaScript` —— 不碰 session 钩子,改 partition 不影响。
   - 但 **media://**(AI 提取把跨域图下载入 mediaStore 换 media:// — 见 ask-orchestrator image-proxy)、
     **下载**、**shouldHandle**(AI/X webview 右键菜单 / 弹窗导流)可能碰。逐个 grep 确认。
2. **阶段1 的修法是否已是前缀匹配**:若 `shouldHandle` 已按 `persist:webview-*` 前缀判定,
   AI/X 的新 partition 自动被认成「普通浏览」→ 可能误把 AI/X 当普通网页处理(右键菜单等)。
   要确认 AI/X 的 partition 命名是否需要可区分(如 `persist:webview-ai-${ws}`)还是共用
   `persist:webview-${ws}`(同 ws 内 AI/X/浏览器共享 cookie 的前提是**同名**)。
   ⚠️ **关键张力**:同 ws 内共享 cookie 要求 AI/X/浏览器**同一个 partition 名**;但 shouldHandle
   等钩子可能需要区分「这是 AI webview 还是普通浏览」。先查 shouldHandle 到底靠 partition 还是
   靠别的(URL detect?)判定 —— 若靠 URL,则同名无碍;若靠 partition,需重新设计判定。

## 4. 设计决策(出方案让总指挥确认再动)

1. **partition 命名**:AI/X/浏览器同 ws 同名 `persist:webview-${ws}`(共享 cookie)?
   还是分名(AI/X 各自 per-ws 但与浏览器隔离)?取决于 §3.2 shouldHandle 判定方式 +
   总指挥要不要「同 ws 内浏览器登的 Google 让 AI 直接复用」。**倾向同名**(最大化 ws 内联动)。
2. **登录态迁移**(handoff §63):换 partition = 旧共享登录态对所有 ws「消失」。
   建议**首个 ws 继承旧 `persist:webview`**(把旧 session 目录平移给 ws-1 或让 ws-1 用旧名),
   其余 ws 全新。是否做迁移、怎么迁,总指挥拍板。
3. **per-ws 代理接入**:AI/X partition per-ws 后,ws 的 setProxy 要覆盖到 AI/X 的 session
   (handoff 阶段2/3 的 setProxy 是否已对所有 `persist:webview-*` 生效?核实)。

## 5. 回归清单(这次碰登录态 + 主进程钩子 + 刚收的 wcId/SSE)

- per-ws 登录隔离:ws-A 登 X 小号 / ws-B 登 X 大号,互不串;同 ws 内浏览器↔AI↔X 共享登录。
- per-ws 代理:ws-A 的 AI 走 A 出口、ws-B 走 B 出口(实测 IP)。
- **不回归本次 ws 隔离收口**:wcId 定向(AI 问答/提取、X 发推/回复/提取)+ SSE per-wc 池。
  partition(session 层)与 wcId(webContents 层)正交,理论不冲突,但 AI 登录态变化会影响
  SSE 能否抓到回复 —— 一并验。
- 不回归下载 / media:// / 右键菜单 / 弹窗导流(§3 钩子)。
- 首个 ws 登录态迁移生效(老用户 ws-1 不用重登)。

## 6. 爆破半径

只做「AI/X partition per-ws 化 + 配套钩子 + 登录迁移」。不顺手重构 AI/X 业务逻辑、
不动内置浏览器已跑通的 per-ws 路径、不动翻译 partition(除非单列)。
