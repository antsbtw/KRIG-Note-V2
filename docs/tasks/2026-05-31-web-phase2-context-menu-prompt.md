# Phase 2 启动:Web view 右键菜单补全

> 总纲见 [docs/tasks/2026-05-31-web-browser-features-prompt.md](./2026-05-31-web-browser-features-prompt.md)(§2 Phase 2)。
> 本文档是 Phase 2 的**自包含启动包**,已替你 grep 完关键基础设施现状,直接开工。
> Phase 1 已落 main(`ca0c5333`)。**本 Phase 分支 `feat/web-context-menu` 已由指挥切好,从它开工。**

---

## 0. 工作纪律(同总纲 §0,精简)

1. **每条 cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**。Read 传绝对路径。
2. **只动本 prompt「文件清单」列的文件**。非范围 bug → 登记到汇报,不擅自修。
3. memory 必读:`feedback_no_fallback_bandaid_fixes`(不兜底)、`feedback_merge_requires_explicit_ok`(**commit 可以,merge/push 等显式 OK**)、`feedback_implementation_test_checklist`(自测清单)。
4. sandbox 拦 `npm start` → 报告,用户自己跑。typecheck / 单测你自己跑。
5. **允许在 `feat/web-context-menu` 分支自行 commit**,但 **merge/push 等指挥显式确认**。
6. 做完 typecheck + 自测 + commit → **STOP 汇报**,等拍板。

---

## 1. 现状(已 grep 确认,2026-05-31)

### 1.1 右键菜单现有 5 项

[src/views/web/context-menu-integration.ts](src/views/web/context-menu-integration.ts):

- 复制链接(linkURL,`enabledWhen:'always'` + 命令内判空)
- 复制图片地址(srcURL,同上)
- 复制选中文字(has-selection)
- 📖 查词(has-selection)
- 🌐 翻译(has-selection)

模式:`commandRegistry.register('web-view.cm-xxx', handler)` + `contextMenuRegistry.register([{id,label,command,view:'web-view',order,enabledWhen}])`。
**约束(L107 注释)**:V2 `enabledWhen` 只支持 `'always' | 'has-selection' | 'is-editable'`。link/src 条件用 `always` 显示 + 命令内 `if (!ctx?.linkURL) return` no-op。

context payload `currentContext`(模块级)由 `showWebContextMenu(payload)` 写入,payload 含 `linkURL / srcURL / selectionText / x / y`(来自 [Host.tsx](src/capabilities/web-rendering/Host.tsx) 的 `context-menu` 事件,L163-184)。

### 1.2 ✅ 关键:openExternal / showItemInFolder 已现成(不用新增 IPC)

grep 实证:

- **`window.electronAPI.openExternal(url)`** —— 已暴露,main 端 [src/platform/main/ipc/shell-handler.ts:31](src/platform/main/ipc/shell-handler.ts#L31) 调 `shell.openExternal`,**已做 scheme 白名单**(只放 `http/https/mailto`,挡 `javascript:`/`file:`)。返回 `{ ok, reason? }`。
  - 类型:[src/shared/ipc/electron-api.d.ts:49](src/shared/ipc/electron-api.d.ts#L49)。
  - 现成调用范例:[build-link-click-plugin.ts:202](src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L202) `window.electronAPI?.openExternal?.(href)`。
- **`window.electronAPI.showItemInFolder(filePath)`** —— 已暴露(Phase 3 下载会用,本 Phase 不需要)。

**结论**:Phase 2 的「在默认浏览器打开链接」**零 IPC 新增成本**,直接 `window.electronAPI.openExternal(ctx.linkURL)`。

### 1.3 多标签 = Phase 4,本 Phase 还没有

「在新标签页打开链接」依赖 Phase 4 的 tab 基础设施 —— **现在还没有**。处理见 §2.1。

---

## 2. 要做的事

### 2.1 「在默认浏览器打开链接」(必做,零成本)

- 命令 `web-view.cm-open-link-external`:
  ```ts
  commandRegistry.register('web-view.cm-open-link-external', () => {
    const ctx = currentContext;
    if (!ctx?.linkURL) return;
    void window.electronAPI?.openExternal?.(ctx.linkURL);
    contextMenuController.hide();
  });
  ```
- 菜单项:`label: '在默认浏览器中打开链接'`,`enabledWhen:'always'`,order 放在「复制链接」之前或之后(建议 `order: 5`,排在复制链接 order:10 前,符合 Chrome「打开链接」在最上的直觉)。
- **注意**:`openExternal` main 端已挡非 http(s)/mailto scheme,所以 `javascript:`/`file:` 链接点了会被 main 拒(返回 `{ ok:false }`),前端无需重复校验,但可不处理 reason(静默)。

### 2.2 「在新标签页打开链接」(占位,标依赖 Phase 4)

多标签还没做。**两个选择,默认 (a)**:

- **(a) 默认:本 Phase 先不加此项。** 在汇报里登记「待 Phase 4 多标签落地后补」。不做占位 disabled 项(V2 `enabledWhen` 不支持 per-item disabled 文案,放个永远灰的项体验差)。
- **(b) 备选:加成「在右栏 web view 打开链接」。** 复用现成命令 `web-view.open-url`(grep 确认它存在于 [web-commands.ts](src/views/web/web-commands.ts),作用是在当前 ws 右栏 web view 开 URL)。语义不是「新标签」而是「右栏打开」,**若加要把 label 写成「在右栏打开链接」别误导成新标签**。

**默认走 (a)**,除非你(实现 subagent)觉得 (b) 现成命令复用划算且 label 不误导 —— 那就做 (b) 并在汇报说明。**别自己造新标签逻辑**(那是 Phase 4)。

### 2.3 「复制图片」=复制图片本身(可选,默认降级跳过)

现有只有「复制图片地址」。Chrome 还有「复制图片」(把图片像素放剪贴板)。

- 需要主进程 `clipboard.writeImage` + 从 srcURL 抓图(NativeImage.createFromDataURL 或下载后写入)—— **新增 IPC + 抓图逻辑,工程量明显大于本 Phase 其它项**。
- **默认:本 Phase 跳过**,只保留现有「复制图片地址」。在汇报里登记为「未来增强」。
- 仅当你评估成本可控(srcURL 多为 http 图,需 fetch→buffer→writeImage,跨进程)且指挥后续要,才单独起轮做。**本 Phase 不做。**

### 2.4 顺带:补 Phase 1 附录 A 漏掉的「历史过滤」(指挥已确认并入本 Phase)

> 背景:Phase 1 merge 时「历史过滤」未实现,当前线上历史补全会把**搜索结果页**记进候选。指挥已确认并入 Phase 2 一起收。详见总纲附录 A。

在 [src/views/web/web-history.ts](src/views/web/web-history.ts) 加 `shouldRecord(url): boolean` 纯函数,`recordVisit` 接入:

1. **只记 `http://` / `https://`**(about:/data:/file:/blob: 跳过)。
2. **跳过搜索结果页**:从 `WEBVIEW_SEARCH_URL`(Phase 1 已加常量,在 [shared/constants/webview.ts](src/shared/constants/webview.ts))解析出 host + pathname 前缀比对,命中就不记。**别 hardcode `google.com/search`**。
3. 保留现有去重 + visitCount + 上限 500(mergeVisit 不动)。
4. SPA 碎片:**默认靠 mergeVisit 去重兜底**(不动 Host/capability 接口)。够不够用在汇报里说;不够再拍板「Host onUrlChanged 加 source 标记」(那是 capability 接口变更,做前汇报)。

给 `shouldRecord` 补单测(各 scheme + 搜索页命中/不命中)。

---

## 3. 文件清单

| 文件 | 改动 | 项 |
|---|---|---|
| `src/views/web/context-menu-integration.ts` | 加「默认浏览器打开链接」命令 + 菜单项(§2.1);可选 (b) 右栏打开(§2.2) | 2.1 / 2.2 |
| `src/views/web/web-history.ts` | `shouldRecord` 纯函数 + recordVisit 接入(§2.4) | 2.4 |
| `tests/views/web/web-history.test.ts` | append `shouldRecord` 单测 | 2.4 |

**不新增 IPC / preload / main 改动**(openExternal 已现成)。若选了 2.3「复制图片」(默认不选)才会动 main/preload —— 默认不动。

---

## 4. 不做的事

- ❌ **不造新标签逻辑**(Phase 4)。「在新标签打开」默认不加项(§2.2 (a))。
- ❌ **不做「复制图片本身」**(§2.3,默认跳过,避免 main/preload 改动)。
- ❌ 不动 `Host.tsx` / capability 接口(除非 §2.4 SPA 去重不够用且拍板了方案 b)。
- ❌ 不破坏 web-history.ts 现有 mergeVisit / matchHistory / localStorage 边界。
- ❌ 不 merge/push(commit 可以)。
- ❌ 不一口气往 Phase 3 冲 —— 做完 STOP 汇报。

---

## 5. 已知坑

1. **`enabledWhen` 只 3 值**(always/has-selection/is-editable)—— link 条件项一律 `always` + 命令内判空,别指望 per-item 动态 disabled。
2. **openExternal 已挡危险 scheme** —— 前端别重复校验,但也别假设所有链接都能开(`javascript:` 会被 main 拒,静默即可)。
3. **currentContext 是模块级单例** —— 菜单命令执行时读的是「最后一次右键」的 context。现有 5 项都这么用,沿用即可,别引入异步导致 context 被下次右键覆盖。
4. **搜索页过滤的 host+path 比对** —— `WEBVIEW_SEARCH_URL` 若是带 `%s` 或 `?q=` 的模板,解析时注意只取 origin+pathname 比对(query 不参与),否则匹配不上。

---

## 6. 验收(commit 前)

1. typecheck PASS(先 grep `package.json` scripts 确认命令名)。
2. `web-history.test.ts` 含 `shouldRecord` 新单测,全过。
3. lint(若有)PASS。
4. 手动复现步骤(给用户跑,sandbox 拦 npm start):
   - 网页里右键一个链接 → 出「在默认浏览器中打开链接」→ 点击 → 系统浏览器打开该 URL。
   - 右键空白/选区 → 该项行为符合预期(linkURL 空时点了 no-op,或不显示——说明实际行为)。
   - 搜几次(地址栏输关键词)→ 地址栏补全候选里**不再出现** `/search?q=` 条目(§2.4 过滤生效)。
   - about:blank / 普通页历史仍正常记录。
5. commit(分支 `feat/web-context-menu`,**不 merge/push**),message 中文动机优先,结尾:
   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

---

## 7. 汇报模板

```
Phase 2(feat/web-context-menu)完成:

一、产出(M commit)
二、实现要点(右键新项 + 历史过滤 file:line)
三、§2.2「新标签打开」最终选了 (a) 不加 / (b) 右栏打开 —— 理由
四、§2.4 SPA 碎片去重是否够用(够 → 不动 Host;不够 → 申请方案 b)
五、验收(typecheck / shouldRecord 单测 / lint)
六、手动复现步骤(给用户跑)
七、范围外发现 / 登记(如「复制图片本身」「新标签待 Phase 4」)
八、等指挥拍板:merge/push?进 Phase 3(下载管理)?
```

---

## 8. Self-Contained Check

- ✅ 现有 5 项右键 + 注册模式 + enabledWhen 约束(§1.1)
- ✅ openExternal/showItemInFolder 已现成 grep 实证(§1.2)
- ✅ 4 项任务 + 默认决策(§2)
- ✅ 文件清单仅 3 文件、零 IPC 新增(§3)
- ✅ 不做的事 + 已知坑(§4-5)
- ✅ 验收 + 汇报模板(§6-7)

**外部依赖**:用户跑 npm start 手动复现;用户拍板 merge/push + 进 Phase 3。

**第一步**:读本 prompt + §1.1 的 context-menu-integration.ts + §2.4 的 web-history.ts 确认未漂移 → 直接在已切好的 `feat/web-context-menu` 分支开工。

---

*Phase 2 启动包 · 2026-05-31 · feat/web-context-menu · 右键菜单补全 + 历史过滤收尾*
