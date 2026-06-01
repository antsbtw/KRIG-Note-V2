# 阶段2 实现包:代理数据层 + proxyId 持久化 + 正式 setProxy 接入 + ytdlp per-ws

> **per-ws 代理工程「阶段2」的自包含实现包。** 读这份 + 引用代码位置即可执行,不需要前序对话上下文。
> 工作目录 **KRIG-Note-V2**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)。每条 cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。分支 **`feat/per-ws-proxy`**(阶段1 已 commit `c2a91c21`)。

---

## 0. 工作纪律(铁律,必守)

1. **⚠️ 严禁源码写字面控制字符 NUL `\0`**——本工程踩过两次写成二进制。每改完一个 .ts/.tsx 跑 `file <绝对路径>` 确认含 "UTF-8 text" / "ASCII text",不能是 "data"。
2. memory `feedback_merge_requires_explicit_ok`:可 commit,**绝不 merge / push / 切分支**。
3. memory `feedback_main_console_not_in_devtools`:主进程 log 在 `npm start` 终端 stdout。
4. memory `feedback_diag_log_before_speculation`:跨 session 问题先 log 实测。
5. **⚠️ useSyncExternalStore 死循环命门**:本包要给 data-model 加 `proxyId` 字段。`sourceSignature` / `hydrate` / `persist` / 接口 必须五处一致,且 **proxyId 不能含随机生成值**(它是纯持久化字符串,天然安全,但必须进 sourceSignature,否则改 proxyId 不触发重渲)。详见 §3.1。
6. sandbox 拦 `npm start` → 用户跑验证。你只跑 typecheck(grep package.json scripts 确认命令)。
7. 做完 STOP 汇报,重点给用户 console 验证示例 + 回归点,等用户跑。

---

## 1. 这是什么 / 阶段2 范围(已拍板)

阶段1 已完成:partition per-ws 化 + 修下载/media + 临时 `web.set-proxy` IPC(当前入参 `{workspaceId, rules}`,直接 setProxy)。阶段2 把代理从「console 手填 rules」升级成「全局节点表 + 每 ws 选 proxyId + 持久化 + 正式接入」。

| 决策点 | 已定 | 含义 |
|---|---|---|
| 阶段2 UI | **不做**(留阶段3) | 本包只做数据层 + 接入。验证靠 console / 临时塞测试节点 |
| proxyId 存哪 | **per-ws web state** | 改 src/views/web/data-model.ts 加 `proxyId`,五处一致(§3.1) |
| 节点认证 | **无认证** | store 只存 host:port,rules = `socks5://host:port` / `http://host:port` / `direct://` |
| 节点表范围 | **全局**(跨所有 ws 共用),每 ws 选一个 proxyId | 主进程全局 JSON store(§3.2) |
| proxyId→rules 解析 | **放主进程**(主进程持节点表) | renderer 只传 proxyId,主进程查表 + setProxy(§3.3) |

**不做**:代理 UI / 节点增删改 UI / 每 ws 选节点的 UI(全留阶段3)、搜索引擎/主页可配(阶段3)、清数据(阶段3)、socks5 认证。

---

## 2. 关键架构事实(已调研确认)

- **全局 JSON store 套路**(照搬):[web-download/download-store.ts](src/platform/main/web-download/download-store.ts)、[learning/vocab-store.ts](src/platform/main/learning/vocab-store.ts) —— 内存 Map cache + lazy ensureLoaded + atomic 写(`.tmp` → `fs.renameSync`)。文件位置 `{app.getPath('userData')}/krig-data/<域>/<资源>.json`。
- **data-model 五处一致点**([data-model.ts](src/views/web/data-model.ts)):`WebWorkspaceState` 接口(L29)、`PersistedWebWsState`(L43)、`sourceSignature`(L101)、`hydrateWebState`(L118)、`persist`(L177)。加字段必须五处都加,且 sourceSignature 要纳入新字段。
- **setProxy 接入点**:[WebView.tsx](src/views/web/WebView.tsx) 已有 `useEffect([workspaceId])` 诊断 log(约 L309)。proxyId 从 `wsState`(useSyncExternalStore 订阅的 per-ws state,约 L70)读。
- **阶段1 临时 IPC**:[web-proxy/handler.ts](src/platform/main/web-proxy/handler.ts) 当前 `web.set-proxy` 入参 `{workspaceId, rules}` 直接 setProxy。channel 名 `WEB_SET_PROXY: 'web.set-proxy'` 在 [channel-names.ts](src/shared/ipc/channel-names.ts)。preload `setWebProxy` 在 [main-window-preload.ts](src/platform/main/preload/main-window-preload.ts)。d.ts 在 [electron-api.d.ts](src/shared/ipc/electron-api.d.ts)。
- **ytdlp 硬编码两处**:[ytdlp/handlers.ts:22](src/platform/main/ytdlp/handlers.ts#L22)(`const WEBVIEW_PARTITION`)+ L115(YTDLP_CHECK_YOUTUBE_COOKIES handler 取 cookies);[ytdlp/downloader.ts:23](src/platform/main/ytdlp/downloader.ts#L23) + L34(`exportWebviewCookiesForYoutube`)。renderer caller:[capabilities/ytdlp/index.ts](src/capabilities/ytdlp/index.ts) `download()`(约 L85)、`checkYoutubeCookies()`(约 L149);最终调用点 [tweet-block/node-view.ts](src/drivers/text-editing-driver/blocks/tweet-block/node-view.ts) 约 L242。
- **主进程无 active-ws 概念**:ws id / proxyId 都靠 renderer 传(workspaceManager 在 renderer)。

---

## 3. 要做的事(逐项)

### 3.1 data-model 加 proxyId(五处一致,守死循环命门)

[src/views/web/data-model.ts](src/views/web/data-model.ts) 加可选 `proxyId`:

1. **`WebWorkspaceState` 接口**(L29):加 `/** 选中的全局代理节点 id;空/undefined = 直连(default) */ proxyId?: string;`
2. **`PersistedWebWsState`**(L43):加 `proxyId?: string;`
3. **`sourceSignature`**(L101):返回的 JSON 加 `proxyId: typeof s.proxyId === 'string' ? s.proxyId : null`。**这步关键**——不加则改 proxyId 不触发重渲(setProxy 接入靠 useEffect 依赖 proxyId 变化)。
4. **`hydrateWebState`**(L118):三个 return 分支都带上 `proxyId`。归一:`const proxyId = typeof p.proxyId === 'string' && p.proxyId ? p.proxyId : undefined;` 放函数顶部(跟 targetLang 一起),三个 return 的对象都加 `proxyId`(undefined 也行,保持字段存在性一致)。
   - ⚠️ proxyId 是纯字符串,**绝不 genXxx() 随机生成**(那是 tabId 死循环根因)。空就 undefined,不造值。
5. **`persist`**(L177):`[STORE_KEY]` 的对象加 `proxyId: state.proxyId`(satisfies PersistedWebWsState)。
6. **新 setter** `setWebProxyId(workspaceId, proxyId)`(放文件末尾,照 `setWebTargetLang` 的模式):读 cur,`if (cur.proxyId === proxyId) return;` 早返回,`persist(workspaceId, { ...cur, proxyId })`。proxyId 传 undefined / '' 表示直连(归一成 undefined 存)。

**自检**:改完想清楚——对同一 ws,proxyId 没变时 `getWebWsState` 必须返回同一引用(sourceSig 含 proxyId 即可保证)。typecheck 后若怕死循环,可临时在 WebView 加 `console.count('[web-render]')` 跑前自检(可选,别留)。

### 3.2 全局代理节点表 store(新建,照 download-store 套路)

新建 **`src/platform/main/web-proxy/proxy-node-store.ts`**:

```ts
export interface ProxyNode {
  id: string;
  /** 用户可见名(阶段3 UI 用;阶段2 可不展示)*/
  name: string;
  /** 'socks5' | 'http' | 'direct' */
  type: 'socks5' | 'http' | 'direct';
  /** host:port(无认证;direct 类型此字段空)*/
  host: string;   // 形如 '192.168.1.162:1080';direct 为 ''
  createdAt: number;
}
```

- 文件位置:`{app.getPath('userData')}/krig-data/web/proxy-nodes.json`(放 web 域下,跟 downloads.json 同目录)。
- schema:`{ version: '1', entries: Record<string, ProxyNode> }`。
- 照 download-store **完整套路**:内存 Map cache + `ensureLoaded()`(lazy,容错不 throw)+ atomic `save()`(`.tmp` → renameSync)。
- 公共方法:
  - `async list(): Promise<ProxyNode[]>`(按 createdAt 排序)
  - `async add(node: ProxyNode): Promise<void>`
  - `async remove(id: string): Promise<void>`
  - `async get(id: string): Promise<ProxyNode | undefined>`
  - **`async resolveRules(proxyId: string | undefined): Promise<string>`** —— 核心:proxyId 空 / 找不到 / type==='direct' → 返回 `'direct://'`;否则 `` `${type}://${host}` ``(如 `socks5://192.168.1.162:1080`)。setProxy 接入直接用这个。
- `export const proxyNodeStore = new ProxyNodeStore()`。
- **临时验证入口(阶段2 必须,因为没 UI)**:加一个 IPC `WEB_PROXY_LIST` + `WEB_PROXY_ADD` + `WEB_PROXY_REMOVE`(见 §3.3),让用户在 console 塞测试节点。阶段3 UI 复用这些 IPC。

### 3.3 IPC:升级 web.set-proxy + 加节点表 CRUD IPC

[src/platform/main/web-proxy/handler.ts](src/platform/main/web-proxy/handler.ts) 改造:

1. **`WEB_SET_PROXY` 升级**:入参从 `{workspaceId, rules}` 改成 `{workspaceId, proxyId}`:
   ```ts
   ipcMain.handle(WEB_SET_PROXY, async (_e, { workspaceId, proxyId }) => {
     const rules = await proxyNodeStore.resolveRules(proxyId);
     const partition = `persist:webview-${workspaceId}`;
     const sess = session.fromPartition(partition);
     await sess.setProxy(rules === 'direct://' ? { mode: 'direct' } : { proxyRules: rules });
     console.log('[per-ws-proxy] set ws=', workspaceId, 'proxyId=', proxyId || '(direct)', 'rules=', rules);
   });
   ```
2. **新增节点表 CRUD IPC**(同文件,加 `registerWebProxyHandler` 内):
   - `WEB_PROXY_LIST` → `proxyNodeStore.list()`
   - `WEB_PROXY_ADD` → 入参 `{ name, type, host }`,主进程生成 id(`crypto.randomUUID()` 主进程可用)+ createdAt,`proxyNodeStore.add(...)`,返回新 node。
   - `WEB_PROXY_REMOVE` → 入参 `{ id }`,`proxyNodeStore.remove(id)`。
3. **channel-names.ts** 加:`WEB_PROXY_LIST: 'web.proxy-list'`、`WEB_PROXY_ADD: 'web.proxy-add'`、`WEB_PROXY_REMOVE: 'web.proxy-remove'`(对齐现有 `web.xxx` 命名)。`WEB_SET_PROXY` 已存在,不动名字。
4. **preload** [main-window-preload.ts](src/platform/main/preload/main-window-preload.ts):
   - `setWebProxy` 签名改成 `({ workspaceId, proxyId })`(原 rules 入参去掉)。
   - 加 `listProxyNodes()` / `addProxyNode({name,type,host})` / `removeProxyNode(id)`。
5. **d.ts** [electron-api.d.ts](src/shared/ipc/electron-api.d.ts):
   - `setWebProxy(args: { workspaceId: string; proxyId?: string }): Promise<void>`(改签名)。
   - 加 `listProxyNodes(): Promise<ProxyNode[]>` / `addProxyNode(...)` / `removeProxyNode(...)`。ProxyNode 类型:d.ts 里可内联结构或从 shared 导出(若 ProxyNode 定义在 main store 文件,d.ts 不该 import main 代码——**把 ProxyNode 接口提到 `src/shared/types/` 下一个新文件 `proxy-types.ts`**,main store 和 d.ts 都从 shared import,避免跨层依赖)。

### 3.4 setProxy 正式接入(renderer 触发,守时序)

[src/views/web/WebView.tsx](src/views/web/WebView.tsx):

- 从 `wsState` 读 `proxyId`(wsState 是 `getWebWsState` 订阅结果,§3.1 后含 proxyId)。
- 加 `useEffect`,依赖 `[workspaceId, proxyId]`:调 `window.electronAPI.setWebProxy({ workspaceId, proxyId })`。每次 ws 切换或 proxyId 变化都重设。
  ```tsx
  useEffect(() => {
    void window.electronAPI.setWebProxy({ workspaceId, proxyId: wsState?.proxyId });
  }, [workspaceId, wsState?.proxyId]);
  ```
- **时序隐患 + 处理**:setProxy 是 async,首次 mount 时可能晚于 webview 首个请求(漏代理首包)。阶段2 **可接受**(用户切到 ws、设好 proxyId 后,webview 多数已在浏览;且阶段2 验证靠手动设代理后刷新)。**不为此做 Host 渲染 gate**(过度工程)。但**在汇报里明确告知**:首包时序问题留观察,若实测有"设了代理但首个页面仍走直连",阶段3 再加 gate(Host 渲染前 await setProxy)。这符合 `feedback_diag_log_before_speculation`——先观察实测再加复杂度。

### 3.5 ytdlp cookie 改 per-ws(加 partition 参数,5 处签名)

让 ytdlp 取当前 ws partition 的 cookies,而非硬编码旧 `persist:webview`:

1. **downloader.ts**:`exportWebviewCookiesForYoutube(partition?: string)`——partition 空则兜底用 `'persist:webview'`(向后兼容)。内部 `session.fromPartition(partition || 'persist:webview')`。`downloadVideo(url, onProgress?, outputPath?, partition?)` 透传给 export 函数。删 L23 的 `const WEBVIEW_PARTITION`(或留作兜底默认)。
2. **handlers.ts**:
   - `YTDLP_DOWNLOAD` handler 加第四参 partition,透传 `downloadVideo(..., partition)`。
   - `YTDLP_CHECK_YOUTUBE_COOKIES` handler 加入参 partition:`session.fromPartition(partition || 'persist:webview')`。
3. **preload**:`ytdlpDownload(url, outputPath?, partition?)`、`ytdlpCheckYoutubeCookies(partition?)` 透传。
4. **d.ts**:对应两个签名加 `partition?: string`。
5. **capability** [ytdlp/index.ts](src/capabilities/ytdlp/index.ts):`download(url, outputPath?, partition?)`、`checkYoutubeCookies(partition?)` 透传。
6. **caller** [tweet-block/node-view.ts](src/drivers/text-editing-driver/blocks/tweet-block/node-view.ts) 约 L242:这里调 `ytdlpDownload(tweetUrl)`。需传当前 ws 的 partition。**grep 确认 node-view 能否拿到 workspaceId / partition**:
   - 若能拿到 workspaceId → 传 `` `persist:webview-${workspaceId}` ``。
   - 若拿不到(driver 层可能无 ws 上下文)→ **partition 传 undefined**(兜底走旧 `persist:webview`),**在汇报里标注**:tweet-block 下载暂用旧 partition,ytdlp per-ws 的完整接入待 driver 层能拿到 ws 上下文(可能需阶段3 或单独小改)。**别硬塞**,拿不到就兜底 + 标注,符合最小改动。
   - checkYoutubeCookies 的 caller 同样 grep,能拿 partition 就传,拿不到兜底。

⚠️ ytdlp 这块**以"不破坏现有下载"为底线**:partition 可选 + 兜底旧 partition,保证拿不到上下文时行为跟阶段1 一致。

---

## 4. 文件清单

| 文件 | 改动 |
|---|---|
| `src/views/web/data-model.ts` | 加 proxyId(五处一致 + setWebProxyId setter)§3.1 |
| `src/shared/types/proxy-types.ts`(新建) | ProxyNode 接口(main + d.ts 共用)§3.3 |
| `src/platform/main/web-proxy/proxy-node-store.ts`(新建) | 全局节点表 store §3.2 |
| `src/platform/main/web-proxy/handler.ts` | WEB_SET_PROXY 升级 proxyId + 节点 CRUD IPC §3.3 |
| `src/shared/ipc/channel-names.ts` | 加 WEB_PROXY_LIST/ADD/REMOVE §3.3 |
| `src/platform/main/preload/main-window-preload.ts` | setWebProxy 改签名 + 节点 CRUD + ytdlp partition §3.3 §3.5 |
| `src/shared/ipc/electron-api.d.ts` | 同步声明 §3.3 §3.5 |
| `src/views/web/WebView.tsx` | setProxy 接入 useEffect §3.4 |
| `src/platform/main/ytdlp/downloader.ts` | partition 参数 §3.5 |
| `src/platform/main/ytdlp/handlers.ts` | partition 参数 §3.5 |
| `src/capabilities/ytdlp/index.ts` | partition 透传 §3.5 |
| `src/drivers/text-editing-driver/blocks/tweet-block/node-view.ts` | 传 partition(能拿到则传,拿不到兜底+标注)§3.5 |

**不动**:Host.tsx、should-handle、web-context-menu/web-shortcuts、download-store、media。

---

## 5. 验证

1. **你跑**:typecheck(grep package.json 确认命令)0 error。
2. **每个改/新建文件** `file <绝对路径>` 确认 UTF-8 / ASCII text(防 NUL)。
3. **用户跑** `npm start` 验证(§6)。

---

## 6. 给用户的验证步骤(汇报里列出)

阶段2 无 UI,用 console 塞测试节点 + 选 proxyId 验证:

```js
// 1) 加一个测试 socks5 节点(renderer DevTools console)
const node = await window.electronAPI.addProxyNode({ name: '测试隧道', type: 'socks5', host: '192.168.1.162:1080' })
// node.id 就是 proxyId

// 2) 看节点表
await window.electronAPI.listProxyNodes()

// 3) 给当前 ws 选这个节点 —— proxyId 写进 per-ws state 并触发 setProxy
//    阶段2 没 UI,临时用 data-model 的 setter:需 grep 暴露方式。
//    最简:直接调 setWebProxy 验证接入(proxyId→rules→setProxy 链路):
await window.electronAPI.setWebProxy({ workspaceId: '<ws id>', proxyId: node.id })
// 然后该 ws 的 web view 访问 ipinfo.io 看 IP 走代理

// 4) 直连
await window.electronAPI.setWebProxy({ workspaceId: '<ws id>', proxyId: undefined })
```

> **拿 ws id**:阶段1 加的诊断 log——切到某 ws 的 web view,renderer console 打 `[per-ws] ws= <id> partition=...`,复制 id。
> **proxyId 持久化验证**:若 §3.1 把 setWebProxyId 也接进了某处(或临时暴露),设完重启 app 看 proxyId 是否还在、setProxy 是否自动跟随。阶段2 重点是**数据层 + 接入链路通**;持久化自动接入若没 UI 触发,可在汇报里说明"proxyId 写入靠阶段3 UI,阶段2 验证链路用 console"。

**回归点**(确认没弄坏阶段1):
- 下载 / media 图片 / 不同 ws 不同出口 仍 OK(阶段1 成果)。
- ytdlp:若 tweet-block 下载用到,验证 YouTube/推文视频下载仍正常(partition 兜底不破坏)。

---

## 7. 汇报格式

```
阶段2(feat/per-ws-proxy)完成:
一、改动逐项(data-model proxyId 五处一致 / 节点表 store / WEB_SET_PROXY 升级 proxyId + 节点 CRUD IPC / setProxy 接入 useEffect / ytdlp partition 5 处),关键文件路径
二、console 验证示例(addProxyNode → setWebProxy → ipinfo.io;含怎么拿 ws id)
三、proxyId 持久化 + 接入链路说明(setProxy 时序隐患是否做了 gate / 为何不做)
四、ytdlp:tweet-block caller 能否拿到 ws partition?传了还是兜底?标注
五、typecheck 结果 + 每个文件 file 命令确认 UTF-8
六、回归点(下载/media/不同ws出口/ytdlp 下载 仍 OK)
七、等用户跑 → 据结果进阶段3(Web 设置面板 UI:节点增删改 + 每ws选节点 + 搜索引擎/主页/清数据)
```

**不 commit 除非顺手(可 commit 到 feat/per-ws-proxy,绝不 merge/push)。** 做完 STOP 等用户跑。

---

*阶段2 实现包 · 2026-06-01 · feat/per-ws-proxy · 代理数据层 + proxyId 持久化 + 正式 setProxy + ytdlp per-ws · UI 留阶段3*
