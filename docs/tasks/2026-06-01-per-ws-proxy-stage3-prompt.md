# 阶段3 实现包:Web 设置面板 UI(代理 / 清数据 / 搜索引擎 / 主页)

> **per-ws 代理工程「阶段3」的自包含实现包。** 读这份 + 引用代码位置即可执行,不需要前序对话上下文。
> 工作目录 **KRIG-Note-V2**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)。每条 cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。分支 **`feat/per-ws-proxy`**(阶段1 `c2a91c21`、阶段2 `71b9045f` 已 commit)。

---

## 0. 工作纪律(铁律,必守)

1. **⚠️ 严禁源码写字面控制字符 NUL `\0`**。每改/新建 .ts/.tsx 跑 `file <绝对路径>` 确认含 "UTF-8 text" / "ASCII text",不能是 "data"。
2. memory `feedback_merge_requires_explicit_ok`:可 commit,**绝不 merge / push / 切分支**。默认做完汇报让用户决定 commit。
3. memory `feedback_main_console_not_in_devtools`:主进程 log 在终端 stdout。
4. memory `feedback_diag_log_before_speculation`:跨进程问题先 log 实测。
5. memory `feedback-web-navside-vertical-toggle`:web NavSide 用垂直折叠区(本包不动 NavSide,但风格参考)。
6. **⚠️ useSyncExternalStore 死循环命门**:本包**不改 data-model 的 schema 字段**(proxyId 阶段2 已加好)。只在 hydrate 里把 `DEFAULT_URL` 常量改成读全局设置缓存——**这是同步读模块变量,不引入随机生成,安全**。但确认改完 sourceSignature 逻辑不变。
7. sandbox 拦 `npm start` → 用户跑验证。你只跑 typecheck(grep package.json scripts 确认命令)。
8. 做完 STOP 汇报,给用户 UI 操作验证步骤,等用户跑。

---

## 1. 这是什么 / 阶段3 范围(已拍板)

阶段1(partition per-ws + 修回归)、阶段2(节点表 store + proxyId 持久化 + setProxy 接入 + 节点 CRUD IPC)已完成并实测通过。**阶段3 把底层能力包成可视化 Web 设置面板**,一次做全四项:

| 项 | 范围 | 底层现状 |
|---|---|---|
| ① **代理** | per-ws | 节点表 store + CRUD IPC(WEB_PROXY_LIST/ADD/REMOVE)+ setWebProxy({workspaceId, proxyId})+ data-model `setWebProxyId` 都已就绪(阶段2)。本包只做 UI:节点增删改 + 当前 ws 选节点 |
| ② **清除浏览数据** | per-ws | **新建** clearStorageData IPC。UI 二次确认 + 清全部 |
| ③ **默认搜索引擎** | 全局 | **新建** 全局设置 store + renderer 同步缓存。预设列表(Google/Bing/DuckDuckGo/百度)+ 自定义模板 |
| ④ **默认主页** | 全局 | 同全局设置 store。可填 URL |

**入口**:WebToolbar 右侧加 ⚙ 图标 → 点开弹设置面板(已拍板)。

**已拍板决策**:
- 搜索引擎:**预设列表 + 自定义**(下拉 Google/Bing/DuckDuckGo/百度 + 「自定义」可填 %s 模板)。
- 清数据:**二次确认 + 清全部**(clearStorageData 清该 ws cookies/缓存/localStorage 等)。
- proxyId 入参是**裸 ws id**(主进程自己拼 `persist:webview-` 前缀)。

---

## 2. 关键架构事实(已调研确认)

### 搜索引擎 / 主页现状(写死 → 全局可配)
- [webview.ts:22](src/shared/constants/webview.ts#L22) `WEBVIEW_SEARCH_URL = 'https://www.google.com/search?q=%s'`,被 [omnibox.ts:46](src/views/web/omnibox.ts#L46) `resolveOmniboxInput`(**renderer 同步函数**)+ [web-history.ts](src/views/web/web-history.ts)(解析搜索页 host 过滤历史)读。
- [webview.ts:14](src/shared/constants/webview.ts#L14) `WEBVIEW_DEFAULT_URL = 'https://www.google.com'`,被 [data-model.ts:54](src/views/web/data-model.ts#L54) `DEFAULT_URL`(hydrate 初始 tab/关到空/新 tab)+ [WebView.tsx](src/views/web/WebView.tsx) `handleNewTab` 读。
- **核心矛盾**:omnibox / data-model 是 **renderer 同步使用**,不能 await IPC。

### 全局设置 store(新建)
- 阶段2 [proxy-node-store.ts](src/platform/main/web-proxy/proxy-node-store.ts) 是现成的「主进程 JSON + Map + atomic 写」套路,照搬。
- **renderer 同步读取方案(本包采用「启动缓存」混合方案,不用 preload 注入——preload 声明式无法 await store)**:
  1. 主进程全局设置 store 持有 `{ searchEngineTemplate, defaultUrl }`,JSON 持久化。
  2. renderer 模块 `src/views/web/web-settings-cache.ts`(新建):模块级变量 `let cache = { searchEngineTemplate: DEFAULT_SEARCH, defaultUrl: DEFAULT_HOME }`(默认值 = 现有写死常量,保证未初始化时行为不变)。导出同步 `getWebSettings()` + `setWebSettingsCache(s)`。
  3. **启动初始化**:web view 首次 mount(WebView useEffect,只跑一次)或 view 注册时,`await window.electronAPI.getWebSettings()` → `setWebSettingsCache(result)`。此后 omnibox/data-model 同步读缓存。
  4. 用户改设置 → IPC 写 store + 返回新设置 → renderer `setWebSettingsCache` 更新缓存。**搜索引擎/主页改动即时对"新搜索/新 tab"生效**(已打开页面不变,符合预期)。
  - ⚠️ 时序:initWebSettings 是 async,首次 omnibox 调用可能早于缓存就绪 → 此时读默认值(=旧写死常量),行为跟现在一致,无回归。可接受。

### 清数据 IPC(新建)
- 无现成 clearStorageData 先例。照 web-proxy/handler.ts 套路:`session.fromPartition('persist:webview-'+workspaceId).clearStorageData()`。

### WebToolbar / 弹层
- [WebToolbar.tsx](src/views/web/WebToolbar.tsx) 布局 `[← →] [↻] | URL | [翻译 ▾] [×]`,按钮基类 `.krig-web-toolbar__btn`,语言菜单弹层 [WebToolbar.tsx:304](src/views/web/WebToolbar.tsx#L304) 用 `langMenuOpen` state + `langMenuRef` + useEffect 外点击关闭 + CSS `position:absolute`。**设置面板照这个弹层模式**(useState + useRef + 外点击关闭)。
- 无通用 Modal 库,均自实现。ebook 的 ImportModal 是 fixed 全屏遮罩模式(可参考但设置面板用 toolbar 锚定的 popover 更轻)。

---

## 3. 要做的事(逐项)

### 3.1 全局设置 store(主进程,新建)

新建 **`src/platform/main/web-settings/web-settings-store.ts`**,照 proxy-node-store 套路:
```ts
export interface WebGlobalSettings {
  /** 搜索 URL 模板,含 %s 占位 */
  searchEngineTemplate: string;
  /** 默认主页 / 新 tab URL */
  defaultUrl: string;
}
```
- 默认值常量:`searchEngineTemplate: 'https://www.google.com/search?q=%s'`、`defaultUrl: 'https://www.google.com'`(= 现有写死值)。
- 文件 `{userData}/krig-data/web/settings.json`,schema `{ version:'1', settings: WebGlobalSettings }`。
- 内存缓存 + lazy ensureLoaded(容错不 throw,缺字段用默认)+ atomic save。
- 方法:`async get(): Promise<WebGlobalSettings>`、`async update(patch: Partial<WebGlobalSettings>): Promise<WebGlobalSettings>`(合并 + save + 返回全量)。
- `export const webSettingsStore = new WebSettingsStore()`。
- **WebGlobalSettings 类型放 `src/shared/types/`**(新建 `web-settings-types.ts` 或并入现有 proxy-types.ts 旁;d.ts 要用,别让 d.ts import main)。建议新建 `src/shared/types/web-settings-types.ts`。

### 3.2 IPC:全局设置 get/update + 清数据

新建 **`src/platform/main/web-settings/handler.ts`**(`registerWebSettingsHandler()`,在 index.ts hook 注册区调,挨着 registerWebProxyHandler):
- `WEB_SETTINGS_GET` → `webSettingsStore.get()`
- `WEB_SETTINGS_UPDATE` → 入参 `Partial<WebGlobalSettings>`,`webSettingsStore.update(patch)` 返回全量
- `WEB_CLEAR_STORAGE_DATA` → 入参 `{ workspaceId }`,`session.fromPartition('persist:webview-'+workspaceId).clearStorageData()`,log `[web-settings] cleared storage ws=`。
- **channel-names.ts** 加 `WEB_SETTINGS_GET: 'web.settings-get'`、`WEB_SETTINGS_UPDATE: 'web.settings-update'`、`WEB_CLEAR_STORAGE_DATA: 'web.clear-storage-data'`(对齐 web.xxx 命名)。
- **index.ts** 注册 registerWebSettingsHandler。

### 3.3 preload + d.ts

- **preload** [main-window-preload.ts](src/platform/main/preload/main-window-preload.ts) 加:
  - `getWebSettings(): Promise<WebGlobalSettings>`
  - `updateWebSettings(patch): Promise<WebGlobalSettings>`
  - `clearWebStorageData({ workspaceId }): Promise<void>`
- **d.ts** [electron-api.d.ts](src/shared/ipc/electron-api.d.ts) 同步声明(import WebGlobalSettings from shared types)。

### 3.4 renderer 全局设置缓存(新建)

新建 **`src/views/web/web-settings-cache.ts`**:
```ts
import type { WebGlobalSettings } from '@shared/types/web-settings-types';
import { WEBVIEW_SEARCH_URL, WEBVIEW_DEFAULT_URL } from '@shared/constants/webview';

let cache: WebGlobalSettings = {
  searchEngineTemplate: WEBVIEW_SEARCH_URL,
  defaultUrl: WEBVIEW_DEFAULT_URL,
};
let initialized = false;

export function getWebSettings(): WebGlobalSettings { return cache; }
export function setWebSettingsCache(s: WebGlobalSettings): void { cache = s; }
export function isWebSettingsInit(): boolean { return initialized; }
export async function initWebSettings(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const s = await window.electronAPI.getWebSettings();
    if (s) cache = s;
  } catch { /* 用默认缓存,无回归 */ }
}
```
- 默认值用现有写死常量,保证缓存未就绪时行为不变。

### 3.5 改 omnibox / data-model / WebView 读缓存

- **omnibox.ts** [resolveOmniboxInput](src/views/web/omnibox.ts#L46):搜索分支从 `WEBVIEW_SEARCH_URL.replace('%s', ...)` 改成 `getWebSettings().searchEngineTemplate.replace('%s', ...)`。保留对 WEBVIEW_SEARCH_URL 的 import(作默认兜底已在 cache 里),或直接删 import 改用 cache——确认 omnibox 不再直接引用常量后清理 unused。
  - ⚠️ web-history.ts 也用 WEBVIEW_SEARCH_URL 解析搜索页 host 过滤历史:**这个保持读常量即可**(过滤逻辑用默认 Google 模板兜底无伤大雅;若搜索引擎改了导致历史过滤不精确是次要问题,本包不为它改 history,**汇报里标注**)。
- **data-model.ts** [DEFAULT_URL](src/views/web/data-model.ts#L54):hydrate 里用到 `DEFAULT_URL` 的地方改成 `getWebSettings().defaultUrl`。**注意**:`DEFAULT_URL` 当前是模块顶层 `const`,改成在 hydrate 内部调 `getWebSettings().defaultUrl`(函数内读,拿到当时缓存值)。**不要**在模块顶层求值(那会固化成启动那刻的值)。sourceSignature 逻辑不变(它不涉及 DEFAULT_URL)。
- **WebView.tsx** `handleNewTab`:`addTab(workspaceId, WEBVIEW_DEFAULT_URL)` 改 `addTab(workspaceId, getWebSettings().defaultUrl)`。
- **WebView.tsx** 加初始化:在已有的某个 mount-once useEffect(或新加 `useEffect(() => { void initWebSettings(); }, [])`)调 `initWebSettings()`。**只跑一次**(initialized 守卫)。

### 3.6 设置面板 UI(核心,新建组件)

新建 **`src/views/web/WebSettingsPanel.tsx`**(+ 样式进 web.css 或同文件):

**入口**:WebToolbar 右侧(翻译组与 × 之间)加 `<button className="krig-web-toolbar__btn" title="设置" onClick={...}>⚙</button>`。点击 toggle `settingsOpen` state。面板用 popover 锚 toolbar(照语言菜单弹层模式:state + ref + 外点击关闭 + Esc 关闭)。WebToolbar 需要新 props:`workspaceId`(传给面板做 per-ws 操作)、或把整个面板逻辑放 WebView 层、WebToolbar 只发 `onOpenSettings` 回调。**推荐**:WebSettingsPanel 独立组件,WebView 渲染它(传 workspaceId + open/onClose),WebToolbar 只加 ⚙ 按钮 + `onOpenSettings` 回调。这样 WebToolbar 保持纯 UI。

**面板内容(四块,标注「本工作区」/「全局」)**:

**① 代理(本工作区)**:
- 显示当前 ws 选中的节点(读 wsState.proxyId,匹配节点列表名;无 = 直连)。
- 下拉/列表选节点:选项 = 「直连」+ `listProxyNodes()` 返回的所有节点。选中 → `setWebProxyId(workspaceId, proxyId)`(data-model setter,阶段2 已导出)+ 立即 `setWebProxy({workspaceId, proxyId})`(让出口即时切换,不等下次 mount)。
- 节点管理(增删):
  - 「+ 添加节点」:表单 name + type(socks5/http/direct 下拉)+ host(host:port,direct 时禁用/隐藏)→ `addProxyNode({name,type,host})` → 刷新列表。
  - 每个节点行 hover × 删除 → `removeProxyNode(id)` → 刷新列表(若删的是当前 ws 选中的,proxyId 置直连)。
  - **改**(可选,优先级低):点节点名编辑——**本包可不做编辑,只做增删**(改 = 删了重加),**汇报标注**。
- 列表状态:组件内 `useState<ProxyNode[]>` + mount 时 `listProxyNodes()` 拉,增删后重拉。

**② 清除浏览数据(本工作区)**:
- 按钮「清除本工作区浏览数据」→ 点击弹**二次确认**(inline 确认或 window.confirm 均可,inline 更可控):提示"将清除本工作区的 cookies、缓存、localStorage 等,登录态会丢失,不可恢复"。确认 → `clearWebStorageData({ workspaceId })`。完成 toast/提示"已清除"。

**③ 默认搜索引擎(全局)**:
- 下拉预设:Google(`https://www.google.com/search?q=%s`)、Bing(`https://www.bing.com/search?q=%s`)、DuckDuckGo(`https://duckduckgo.com/?q=%s`)、百度(`https://www.baidu.com/s?wd=%s`)、自定义。
- 选预设 → `updateWebSettings({ searchEngineTemplate })` + `setWebSettingsCache`(返回值)。
- 选「自定义」→ 显示输入框填模板(校验含 `%s`,不含则提示)→ update。
- 当前值匹配:面板打开时读 `getWebSettings().searchEngineTemplate`,匹配到某预设则选中它,否则选「自定义」并填入当前模板。

**④ 默认主页(全局)**:
- 输入框填 URL(默认显示当前 `getWebSettings().defaultUrl`)→ 失焦/确认 → `updateWebSettings({ defaultUrl })` + setWebSettingsCache。简单 URL 合法性提示(可选)。

**面板样式**:照 web 现有风格(grep web.css 看 `.krig-web-toolbar__lang-menu` / NavSide section 配色),分块加小标题 + 「本工作区」/「全局」标签。不追求华丽,清晰可用即可。

### 3.7 ProxyNode 列表在 renderer 拿
- `window.electronAPI.listProxyNodes()`(阶段2 已有)返回 `ProxyNode[]`(类型 `@shared/types/proxy-types`)。面板直接用。

---

## 4. 文件清单

| 文件 | 改动 |
|---|---|
| `src/shared/types/web-settings-types.ts`(新建) | WebGlobalSettings 接口 |
| `src/platform/main/web-settings/web-settings-store.ts`(新建) | 全局设置 store §3.1 |
| `src/platform/main/web-settings/handler.ts`(新建) | settings get/update + clearStorageData IPC §3.2 |
| `src/shared/ipc/channel-names.ts` | 加 WEB_SETTINGS_GET/UPDATE + WEB_CLEAR_STORAGE_DATA §3.2 |
| `src/platform/main/index.ts` | 注册 registerWebSettingsHandler §3.2 |
| `src/platform/main/preload/main-window-preload.ts` | getWebSettings/updateWebSettings/clearWebStorageData §3.3 |
| `src/shared/ipc/electron-api.d.ts` | 同步声明 §3.3 |
| `src/views/web/web-settings-cache.ts`(新建) | renderer 同步缓存 §3.4 |
| `src/views/web/omnibox.ts` | 搜索模板读缓存 §3.5 |
| `src/views/web/data-model.ts` | DEFAULT_URL 读缓存(hydrate 内,不动 sourceSignature)§3.5 |
| `src/views/web/WebView.tsx` | initWebSettings + handleNewTab 读缓存 + 渲染 WebSettingsPanel §3.5 §3.6 |
| `src/views/web/WebToolbar.tsx` | ⚙ 按钮 + onOpenSettings 回调 §3.6 |
| `src/views/web/WebSettingsPanel.tsx`(新建) | 设置面板四块 §3.6 |
| `src/views/web/web.css` | 面板样式 §3.6 |

**不动**:Host / should-handle / 下载 / media / NavSide / web-history(history 的搜索过滤保持读常量,§3.5 标注)。

---

## 5. 验证

1. **你跑**:typecheck(grep package.json 确认命令)0 error。
2. **每个改/新建文件** `file <绝对路径>` 确认 UTF-8/ASCII text(防 NUL)。
3. **用户跑** `npm start` 验证(§6)。

---

## 6. 给用户的验证步骤(汇报里列出,UI 操作)

1. **打开面板**:web view 工具栏点 ⚙ → 设置面板弹出,四块都在(代理/清数据 标「本工作区」,搜索/主页 标「全局」)。
2. **代理(per-ws)**:
   - 「+ 添加节点」加 socks5 `192.168.1.162:1080` → 列表出现。
   - 当前 ws 选这个节点 → 访问 `https://ipinfo.io/ip` 重新加载,IP 变隧道出口。
   - 选「直连」→ 重新加载,IP 回本地。
   - 另一个 ws 选不同节点 → 各自出口不同(核心目标)。
   - 删节点 → 列表移除。
3. **清数据(per-ws)**:点「清除本工作区浏览数据」→ 二次确认 → 确认后该 ws 登录态/cookies 清空(再访问已登录站点变未登录)。
4. **搜索引擎(全局)**:面板选 Bing → 地址栏输入关键词(非 URL)回车 → 走 Bing 搜索。选「自定义」填模板验证。重启 app 后设置还在。
5. **主页(全局)**:面板改主页 URL → ⌘T 新建 tab → 打开的是新主页。重启后还在。
6. **回归**:下载/图片/书签/历史/翻译/不同 ws 出口 仍 OK。

---

## 7. 汇报格式

```
阶段3(feat/per-ws-proxy)完成:
一、改动逐项(全局设置 store / settings+clearData IPC / renderer 缓存 / omnibox+data-model 读缓存 / WebSettingsPanel 四块 / ⚙ 入口),文件路径
二、UI 验证步骤(§6 六项)
三、设计说明:renderer 同步缓存方案(initWebSettings 时序,首次未就绪读默认值无回归)/ 搜索引擎预设列表 / 清数据二次确认 / 节点只做增删未做编辑(若是)
四、web-history 搜索过滤仍读常量的标注
五、typecheck 结果 + 每个文件 file 确认 UTF-8
六、回归点
七、等用户跑 → 全绿则 per-ws 代理工程三阶段完成
```

**不 commit 除非顺手(可 commit 到 feat/per-ws-proxy,绝不 merge/push)。** 做完 STOP 等用户跑。

---

*阶段3 实现包 · 2026-06-01 · feat/per-ws-proxy · Web 设置面板四项(代理/清数据 per-ws + 搜索/主页 全局)· 工程收官*
