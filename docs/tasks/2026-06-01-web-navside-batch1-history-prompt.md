# Web NavSide 批1:三段式面板框架 + 历史记录

> 用户决定:把 web view 的「书签 / 历史 / 下载」三类持久数据集中放 NavSide(左侧栏),仿 note(文件夹树)/ebook(书架)的注册式范式。
> 分三批:**批1=框架+历史(本包)→ 批2=下载持久化 → 批3=书签**。
> **在 `feat/web-downloads` 分支继续(已切好),不切新分支,不 merge/push**(三批做完一起 merge)。

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`(commit 可,merge/push 等显式 OK)。
3. **⚠️ 严禁源码写字面控制字符(NUL `\0` 等)**(踩过把 .ts 写成二进制的坑)。写完用 `file <路径>` 确认 "UTF-8 text"。
4. sandbox 拦 npm start → 用户跑(完全退出重跑)。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
5. 做完 typecheck + 自测 + commit → STOP 汇报。

---

## 1. 用户已拍板决策(贯穿三批)

| 决策 | 选择 |
|---|---|
| 放哪 | NavSide(左侧栏),三段:书签 / 历史 / 下载 |
| 工具栏下载图标 | **批2 去掉**(全移 NavSide)。本批1**先不动**工具栏图标 |
| 数据范围 | **全局共享**(所有 workspace 同一份,契合现有 web-history 全局 localStorage) |
| 节奏 | 分批,本包只做**框架 + 历史** |

---

## 2. 已查清的架构(调研结论,文件:行号)

### 2.1 NavSide 注册机制(仿 note/ebook)

- NavSide 是「workspace 级容器 + 全局单例 `navSideRegistry` + 按活跃 view 切内容」三层。基础设施**零改动**。
- 注册:`navSideRegistry.register({ view, title, actions?, searchPlaceholder?, onSearch?, contentRenderer })`([nav-side-types.ts](src/slot/nav-side-registry/nav-side-types.ts),`contentRenderer: () => ReactElement` 是**任意 React 组件**)。
- **范本**:[note/nav-side-content.tsx:166-180](src/views/note/nav-side-content.tsx#L166) `registerNavSide()` 注册 `view:'note-view'` + `contentRenderer: () => <FolderTreePanel/>`;在 [note/index.ts:71](src/views/note/index.ts#L71) self-register 入口调一次。ebook 同模式([ebook/nav-side-content.tsx:415](src/views/ebook/nav-side-content.tsx#L415))。
- 切到 web view 时 NavSide **自动**显示 `view:'web-view'` 注册的内容(WorkspaceInstance 按活跃 viewId 取),无需额外联动。
- web view 的 view id 是 `'web-view'`(见 [web/index.ts](src/views/web/index.ts) registerView)。

### 2.2 历史数据现状(已有,几乎白送)

- [web-history.ts:16](src/views/web/web-history.ts#L16):`localStorage['krig:web:history']`,上限 500(`MAX_ENTRIES`),**全局**(不分 ws)。
- 结构:`WebHistoryEntry { url, title, lastVisit, visitCount }`([:22-29](src/views/web/web-history.ts#L22))。
- 写:`recordVisit(url, title)`([:148](src/views/web/web-history.ts#L148)),WebView 导航成功时调。
- 现有读:只有 `queryHistory(rawInput)`([:154](src/views/web/web-history.ts#L154),空 input 返 `[]`),`load()` 是私有的。**缺"取全部历史"导出**。
- 现有 Phase 2 加的过滤 `shouldRecord`(只记 http(s)、跳过搜索页)仍在,本批不动。

### 2.3 在右栏打开 URL 的命令(历史项点击用)

- [web-commands.ts](src/views/web/web-commands.ts) 有 `web-view.open-url`(commandRegistry,在活跃 ws 右栏 web view 打开 URL)。历史项点击 → `commandRegistry.execute('web-view.open-url', url)` 或直接调 data-model 的 setWebUrl/addTab。grep 确认最顺的调用方式(优先复用现成命令)。

---

## 3. 实现方案(批1)

### 3.1 扩 web-history.ts:加全量读 + 删除导出

在 [web-history.ts](src/views/web/web-history.ts) 加:
- `getAllHistory(): WebHistoryEntry[]` — 返回 `load()`(按 lastVisit 倒序,最近在前)。
- `removeHistoryEntry(url: string): void` — 删单条(filter 掉 + save)。
- `clearHistory(): void` — 清空(save([]))。
- 这几个纯读写 localStorage,跟现有 load/save 同模块。不破坏现有 recordVisit/queryHistory/shouldRecord。

### 3.2 NavSide 三段式面板组件

新建 `src/views/web/nav-side-content.tsx`,导出 `registerNavSide()`(仿 note):
```tsx
navSideRegistry.register({
  view: 'web-view',
  title: 'Web',
  // actions / searchPlaceholder 本批可留空或加"清空历史"(见下)
  contentRenderer: () => <WebNavPanel />,
});
```

`WebNavPanel` 组件:**三段式**(书签 / 历史 / 下载),本批只实装"历史"段,书签/下载**先占位**(显示"敬请期待"或空,批2/3 填):
- 段落用折叠区(`<details>` 或自己做的可折叠 section),三段标题:📌 书签 / 🕘 历史 / ⬇ 下载。
- **历史段**:`getAllHistory()` 取全部,列表渲染。每条:
  - favicon(可选,简化先不做或用首字母)+ title(无则用 url host)+ url(灰色小字)+ lastVisit 时间(可选)
  - 点击 → 在右栏 web view 打开该 url(走 `web-view.open-url` 命令或 data-model)
  - hover 显 × → `removeHistoryEntry(url)` 删该条 + 刷新列表
- 历史段顶部一个"清空历史"小按钮 → `clearHistory()`。
- **书签段**:占位("批3 实装")。
- **下载段**:占位("批2 实装")。
- 列表数据用 `useState` + 组件 mount 时 `getAllHistory()`;删除后本地更新 state。**注意**:localStorage 没有跨组件响应式,删除/清空后手动 setState 刷新即可(本批不需要跨窗口同步)。

CSS 加到 [web.css](src/views/web/web.css)(或新建 web-nav.css),三段折叠 + 历史项 hover 样式。参考 NavSide 现有式样(深色)。

### 3.3 注册入口

[web/index.ts](src/views/web/index.ts):import 并调 `registerNavSide()`(仿 note/index.ts:71,在 registerWebCommands/registerWebContextMenu 旁)。

### 3.4 本批不碰

- 工具栏下载图标(WebDownloadBar)**不动**(批2 处理)。
- 下载持久化(批2)、书签(批3)只占位。
- data-model.ts(tab schema)不动。

---

## 4. 文件清单(批1)

| 文件 | 改动 |
|---|---|
| `src/views/web/web-history.ts` | 加 getAllHistory / removeHistoryEntry / clearHistory 导出 |
| `src/views/web/nav-side-content.tsx` | **新增** registerNavSide + WebNavPanel(三段,历史实装,书签/下载占位) |
| `src/views/web/index.ts` | 调 registerNavSide() |
| `src/views/web/web.css`(或新 web-nav.css) | 面板 + 历史项样式 |
| (可能) `tests/views/web/web-history.test.ts` | getAllHistory/remove/clear 单测(append) |

**不动**:WebDownloadBar、data-model.ts、web-download/handler.ts、其他 view。

---

## 5. 坑清单

1. **严禁字面控制字符**写源码。
2. **历史列表点击打开**:复用 `web-view.open-url` 命令,别新造路径。grep 确认它的签名(参数是 url 字符串)。
3. **localStorage 非响应式**:删除/清空后手动 setState 刷新;本批不做跨窗口同步。
4. **NavSide 自动联动**:注册 `view:'web-view'` 后,切到 web 自动显示,无需改 WorkspaceInstance/NavSideFrame。
5. **title 兜底**:历史项 title 可能空 → 用 url 的 hostname。
6. **占位别误导**:书签/下载段占位文案写清"批2/批3 实装",别让用户以为坏了。

---

## 6. 不做的事
- ❌ 不动工具栏下载图标(批2)。
- ❌ 不做书签/下载实装(只占位)。
- ❌ 不写字面控制字符。
- ❌ 不 merge/push。

---

## 7. 验收 + 汇报

commit 前:typecheck PASS / 现有单测无回归(web-history 27 + data-model 18 + omnibox 15)+ 新增历史接口单测过 / lint 改动文件 PASS / `file` 确认无 null 字节。

手动复现(给用户,完全退出重跑 npm start):
1. 切到 web view → 左侧 NavSide 显示「Web」面板,三段(书签/历史/下载)。
2. 历史段:列出访问过的网页(最近在前),点一条 → 右栏 web view 打开该 url。
3. hover 历史项 → × 删除该条;「清空历史」清全部。
4. 书签/下载段:占位提示(批2/3 实装)。
5. 切到 note/ebook view → NavSide 变回文件夹树/书架(web 面板不串)。

汇报模板:
```
Web NavSide 批1(feat/web-downloads)完成:
一、产出(commit hash + 文件数)
二、实现要点(web-history 全量读/删 / WebNavPanel 三段 / registerNavSide / 历史点击复用 open-url)
三、验收(typecheck/单测/lint/file 无 null 字节)
四、手动复现步骤
五、范围外/登记(书签/下载占位)
六、等指挥:进批2(下载持久化 + 去工具栏图标)?
```

---

## 8. Self-Contained Check
- ✅ 用户决策(NavSide 三段 / 全局 / 分批)
- ✅ NavSide 注册机制 + note 范本 + web-history 现状(§2)
- ✅ 历史接口 + 三段面板 + 注册入口方案(§3)
- ✅ 文件清单 + 坑(§4-5)
- ✅ 验收 + 汇报(§7)

**外部依赖**:用户完全退出重跑 npm start 验证;指挥拍板进批2。

---

*Web NavSide 批1 · 2026-06-01 · feat/web-downloads · 三段式面板框架 + 历史(复用 localStorage 数据) · 仿 note/ebook navSide 范式*
