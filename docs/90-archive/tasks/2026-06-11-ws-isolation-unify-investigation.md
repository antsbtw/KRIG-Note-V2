# ws 实例隔离统一收口 —— 调查结论 + 下沉设计方案(待总指挥确认)

> 日期:2026-06-11
> 状态:**调查完成,设计待拍板,未动代码**
> 关联:`memory/project-ws-instance-isolation-invariant.md`、本目录 `2026-06-11-ws-isolation-unify-prompt.md`

---

## A. 基线(动手前实测,如实报数)

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **0 错** |
| `npm run lint` | **10 problems(4 errors, 6 warnings)** —— 与文档基线一致,全部 pre-existing |
| `npx vitest run` | **228 passed / 228**(本次全量跑,bulk-delete-perf-verify 的 order-dependent flaky **未触发**,全过) |

---

## B. 调查结论:三处遗留的真实现状(已逐一读码核实)

### 现有范式(已跑通的两条链路,作为收口模板)

renderer 侧两份 `Map<wsId,wcId>` registry,API 一字不差(只变量名差):
- `src/capabilities/ai-extraction/ai-host-registry.ts` —— `registerAIHostWcId / clearAIHostWcId / getAIHostWcId`
- `src/capabilities/x-extraction/x-host-registry.ts` —— `registerXHostWcId / clearXHostWcId / getXHostWcId`

登记时机:
- **AI**:`capabilities/ai-extraction/Host.tsx` 内部在 dom-ready / did-navigate / did-navigate-in-page 时 `registerAIHostWcId(workspaceId, wv.getWebContentsId())`(Host 自内聚,自己知道 wcId)。
- **X**:`capabilities/x-extraction/Host.tsx` **不自登记**;由 `views/ai/AIView.tsx` 的 `registerXWc()` 在 X Host `onUrlChanged` 回调里 `xApi.registerXHostWcId(workspaceId, wcId)`。**两边时机不对称**(AI 内聚、X 外挂),下沉时可顺手统一(见 §C 决策 5)。

清理时机:两者都在 `AIView.tsx` 卸载 `useEffect` 里 `clear*HostWcId(workspaceId)`。

main 侧定位:
- **AI**:`webview-registry.ts` 的 `resolveAIWebContents(serviceId, targetWcId)` —— `webContents.fromId` + 校验 URL 属该服务,**未命中 fail loud**(返 `{error}`,不回退全局)。另有 `resolveAIWebContentsWithWait`(poll 版,给 paste+send 用)。
- **X**:`x-write.ts` 内私有 `requireXWebContents(serviceId, targetWcId)` —— 同样 `webContents.fromId` + 校验,但**未命中 warn + 回退 `getActiveXWebContents` 全局**(回退正是 bug 根源)。

### ① 底座下沉 + 两套 registry 合一 —— 架构债

- 根源 `src/platform/main/web-service-base/webview-registry-base.ts` 的 `createWebviewServiceRegistry` 是 **per-serviceKey 全局单例**(`Map<K,WebContents>`「最后 navigate 胜出」),不分 ws。注释自承「多 ws 罕见留待迭代」——已证伪。
- 但**底座本身仍要保留**:它的 `track()`(did-navigate→detect→setActive)、`subscribeAttach()` 是 SSE attach 链路命脉(见 ③)。**只是「业务取哪个实例」不该再走它的 `getActive`**。
- 重复代码:两份 renderer registry(可合一)+ 两处 main resolver(`resolveAIWebContents` vs `requireXWebContents`,逻辑同构,fail 策略不同)。

### ② X extract-tweet 收口 —— 真 bug,冷门路径

- `src/platform/main/x/x-extract-tweet.ts:92` `extractTweetAt` 用 `getActiveXWebContents(serviceId)`(全局 active)。
- 调用链:`x-commands.ts:103` `x-view.extract-tweet` 命令 → `x.extractTweet('x', x, y)` → preload `xExtractTweet`(**不带 targetWcId**)→ IPC `X_EXTRACT_TWEET` → `handlers.ts:30` `extractTweetAt(p.serviceId, p.x, p.y)`(**不传 targetWcId**)→ 全局 active。
- **wsId 在命令侧拿得到**:`x-commands.ts:106` 已 `const wsId = workspaceManager.getActiveId()`,且 §B 范式里 `x.getXHostWcId(wsId)` 现成可用(发推路径就这么取)。收口只需把 wcId 一路透传到 `extractTweetAt`。

### ③ SSE manager 仍全局 —— 真 bug,ai-sync 关闭未暴露

关键发现(比记忆里描述更细):
- `ask-orchestrator.ts:48` 订阅 `subscribeAttachAIWebContents`,创建**单个全局** `captureManager = new SSECaptureManager(wc)` —— wc 跟随底座全局 active「最后 navigate 胜出」。
- **但 Claude/ChatGPT 的 SSE 数据存在 page-level cache(`window.__krig_sse_responses`,在 guest 页内)**。`ai-sync-orchestrator.ts` 的 `pollOnce`/`seedBaseline` **已经**按 ws 定向(`resolveAIWebContents(serviceId, state.targetWcId)` 取本 ws 的 wc),再 `readPageRecords(wc)` 从**那个 wc** 读 page-cache —— 所以 **Claude/ChatGPT 的「读哪个实例」其实已经按 ws 正确了**。
- **真正还全局的是两点**:
  1. **Gemini**:走 main 端 `captureManager.geminiResponses`(CDP 抓的,存在 manager 实例里,非 page-cache)。`pollOnce`/`seedBaseline` 对 gemini 走 `getSSECaptureManager().getAllGeminiResponses()` —— 这是**那个全局单 manager**,绑的 wc 是全局 active。多 ws 并存时 Gemini 的 CDP 偷听可能绑在 B 而注入打到 A → 错位。
  2. **manager 生命周期**:全局单 manager「最后 navigate 胜出」,A、B 两个 Gemini ws 并存时只有一个被 attach,另一个完全没 CDP 偷听。
- `interceptor.ts`(SSECaptureManager 类本身)按传入的 wc 注入/读,**逻辑无 bug**,问题在「谁来 new、new 几个、绑哪个 wc」。

---

## C. 设计决策(请总指挥逐条拍板,确认后再动手)

### 决策 1 —— 底座下沉形态(renderer 侧 registry 合一)

**方案**:在 `web-service-base` 出一个 renderer 侧工厂 `createWsHostRegistry(tag)`,返回 `{ register(wsId,wcId), clear(wsId), get(wsId) }`。AI / X 各 `new` 一个实例(命名空间天然隔离:AI 的 X vs 内置浏览器 X 本就是不同 capability 的不同 registry,无需再加 service 维度)。
- `ai-host-registry.ts` / `x-host-registry.ts` 各自瘦成一行 `export const xxx = createWsHostRegistry('x-host')` + 转发导出名(保 consumer 不动)。
- **删掉**:两份手写的 `Map` + 三函数模板(合并为一个工厂)。

**问总指挥**:renderer 侧工厂放 `web-service-base` 下哪个文件?倾向新建 `web-service-base/ws-host-registry.ts`(与现有 main 侧 `webview-registry-base.ts` 同目录分文件)。**认可吗?**

### 决策 2 —— main 侧 resolver 合一 + fail loud 统一

**方案**:把 AI 的 `resolveAIWebContents` 泛化成 `web-service-base` 公共 `resolveWsWebContents(targetWcId, validateUrl)`,AI / X / X-extract 都调它。`validateUrl(url): boolean` 由各服务传(AI 传 detectAI、X 传 detectX)。**统一 fail loud**(未命中返 `{error}`,不回退全局)。
- X 发推/回复 `requireXWebContents` 改用它 → **行为变化**:原来 targetWcId 找不到会回退全局 active,改后直接 fail。

**⚠️ 这会改 X 行为,必须实机验**:fail loud 后,X 发推/回复/extract 在「正常单 ws」下 targetWcId 一定有值吗?
- 看码:发推走 `send-to-x.ts` → `x.getXHostWcId(wsId)`,extract 收口后同样取得到。**只要 X Host 已 dom-ready 登记过,targetWcId 必有值**;没登记说明 X 根本没在台上(本就该 fail)。
- 但 `requireXWebContents` 现有 **poll 等待**逻辑(等 X webview navigate 就绪,1-3s)。AI 侧对应的是 `resolveAIWebContentsWithWait`。下沉时 **poll 版也要保留并泛化**(`resolveWsWebContentsWithWait`),否则 X 发推会因「切到 X 的瞬间还没 ready」误 fail。

**问总指挥**:
- (2a) **fail loud 统一**认可吗?(回退全局=没修,倾向统一)
- (2b) 统一后 **X 发推/回复必须你实机验一遍**(我无 GUI),确认切到 X 的 1-3s 等待窗口靠 poll 版覆盖、不误 fail。**接受这个实机验收点吗?**

### 决策 3 —— ② X extract 收口改法

**方案**:
- preload `xExtractTweet` 加 `targetWcId?` 参数;IPC `X_EXTRACT_TWEET` payload 带 `targetWcId`;`handlers.ts` 透传;`extractTweetAt(serviceId, x, y, targetWcId?)` 改用 §决策 2 的 `resolveWsWebContents` 取 wc。
- renderer:`x-commands.ts` 的 `x-view.extract-tweet` 命令体里已有 `wsId`,补 `const wcId = x.getXHostWcId(wsId)` 透传给 `x.extractTweet`。
- **fail loud**:未命中返明确 error(命令体已有 `window.alert(提取失败)`,天然 fail loud)。

**问总指挥**:认可吗?(这是纯透传,爆破半径最小)

### 决策 4 —— ③ SSE 按 ws 改法(最需要你定)

现状已澄清:Claude/ChatGPT 的 SSE 读取**已按 ws**(page-cache 在 guest 页内,pollOnce 用 resolved wc 读)。**只剩 Gemini + manager 生命周期是全局**。

**方案 A(小,推荐)—— per-ws manager 池**:
把 `ask-orchestrator` 里的单 `captureManager` 改成 `Map<wsId, SSECaptureManager>`(或 `Map<wcId, manager>`)。`subscribeAttachAIWebContents` 触发时按 wc 找/建对应 manager 并 start(不再 stop 旧的)。`getSSECaptureManager()` 改 `getSSECaptureManager(targetWcId)` 按 ws 取。ai-sync 的 gemini 路径用本 ws 的 manager。
- 优点:Gemini 多 ws 各自 CDP 偷听,彻底按 ws。
- 代价:manager 生命周期管理变复杂(何时销毁——绑 wc destroyed 时清);改动面中等,碰 ask-orchestrator + ai-sync-orchestrator。

**方案 B(更小)—— 只 Gemini 按 wc 重绑**:
保留单 manager,但把 Gemini CDP 缓存从 manager 实例里挪出来,按 wc 存(`Map<wcId, geminiResponses[]>`)。pollOnce 按 resolved wc 读对应缓存。
- 优点:改动更局部。
- 缺点:单 manager 仍只 attach 一个 wc 的 CDP,**第二个 Gemini ws 仍没 CDP 偷听** —— 没真正修复多 ws Gemini,只是不串错缓存。

**方案 C —— 暂不动 SSE,仅文档标注**:
`AI_SYNC_ENABLED=false`,③ 当前不暴露。本期只下沉 ①②,SSE 留「开 ai-sync 前再收口」并写清现状。
- 优点:爆破半径最小,不碰已跑通的 SSE 注入。
- 缺点:留尾巴(但 prompt §0 说「开 ai-sync 前必须先收口」,需你确认 ai-sync 何时开)。

**问总指挥**:③ 选 **A / B / C**?我倾向 **A**(一次治净 Gemini 多 ws,符合「bug 家族彻底了结」),但它碰 SSE 生命周期、风险高于 ①②,且无 GUI 难自验 Gemini 多 ws,需你实机验。若你想本期稳妥,**C** 也合理(ai-sync 还关着)。

### 决策 5 —— X Host 登记时机是否对齐 AI(内聚自登记)

现状 X Host 不自登记、靠 AIView 外挂。下沉时**顺手让 X Host 也内部自登记**(对称 AI),还是**保持现状不动**(超出本 bug 爆破半径)?

**倾向**:保持现状(§5 红线「不顺手重构」),只在 registry 工厂层合一,登记调用点不动。**认可吗?**

### 决策 6 —— 旧全局函数清理

- `getActiveAIWebContents`:已 `@deprecated`,底座 detect 内部仍用 → 保留。
- `getActiveXWebContents`:收口 ② 后,若 `x-write.ts` 也统一走 fail-loud（不再回退），则业务零调用 → 标 `@deprecated` 或删。track/subscribeAttach 保留。

**问总指挥**:`getActiveXWebContents` 业务清零后 **删** 还是 **@deprecated 留底**?倾向 `@deprecated`(对称 AI)。

---

## D. 回归保证(无 GUI,分「可自测」vs「必须你实机验」)

**我能自测**:typecheck / lint / vitest 全量 + 收口后 resolver 单元逻辑(若有测)。
**必须总指挥实机验**(这次碰两条跑通链路 + SSE,逐条列):
1. 单 ws 回归:AI 问答 / 提取整页 / 单条提取;X 发推 / 回复 / 右键提取推文 —— 全部如旧。
2. 多 ws:A 操作只打 A 实例(AI 问答 + X 发推 + **X 提取** 都验)。
3. **X fail loud 行为变化**(决策 2):切到 X 的 1-3s 窗口不误 fail。
4. ③ 若选 A/B:多 ws Gemini ai-sync 偷听不串(需开 `AI_SYNC_ENABLED`)。

---

## E. 待确认清单(请逐条回复)

- 决策 1:renderer registry 工厂放 `web-service-base/ws-host-registry.ts`?
- 决策 2a:main resolver 合一 + **fail loud 统一**(X 不再回退全局)?
- 决策 2b:接受「X 发推/回复 fail loud 后由你实机验」?
- 决策 3:② X extract 透传 targetWcId 收口?
- 决策 4:③ SSE 选 **A(per-ws manager 池)/ B(只 Gemini 缓存按 wc)/ C(本期不动+标注)**?
- 决策 5:X Host 登记时机**保持现状**(不顺手内聚)?
- 决策 6:`getActiveXWebContents` 清零后 **@deprecated** 还是删?
