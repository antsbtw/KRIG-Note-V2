# Phase 2 收口:web view 右键菜单 bug2(坐标)+ bug3(失焦)真因修复

> 承接 commit `c23669e1`(分支 `feat/web-context-menu`)。上一轮诊断 log 已实测,真因查清(研究 + 用户实测数据),本包给确定修法。
> **在 `feat/web-context-menu` 分支继续,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. 只动「文件清单」文件。memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`(commit 可,merge/push 等显式 OK)、`feedback_main_console_not_in_devtools`。
3. sandbox 拦 npm start → 用户跑。typecheck/单测自己跑。
4. 命令名:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
5. 做完 STOP 汇报。

---

## 1. 已查清的真因(研究 + 用户实测,别再重新诊断)

### 架构背景(关键,先懂这个)

项目统一右键菜单 = `contextMenuRegistry`(注册项)+ `contextMenuController`(显示状态)+ `ContextMenuBinding`(渲染)+ `useContextMenuTrigger`(触发 + 关闭)。
[WorkspaceInstance.tsx:51](src/workspace/workspace-instance/WorkspaceInstance.tsx#L51) 在 workspace 根 DOM 挂 `useContextMenuTrigger(rootRef, activeViewId)`,监听冒泡上来的 `contextmenu`,**自带点外部 mousedown 关闭 + Esc 关闭**([use-context-menu-trigger.ts:68-88](src/slot/triggers/use-context-menu-trigger.ts#L68))。

**web view 复用了注册/渲染/controller,但 trigger 那部分用不了** —— 因为 `<webview>` 内容在独立渲染进程,右键事件**不冒泡**到宿主 rootRef。所以 web view 走自己的路径:[Host.tsx](src/capabilities/web-rendering/Host.tsx) 监听 webview `context-menu` 事件 → `showWebContextMenu` → `controller.show`,并自挂关闭监听。bug2/bug3 都出在这条自接路径。

### bug2:坐标偏移 —— 公式对,`rect` 来源错

用户实测一组:`params={x:329,y:290}`,`rect=getBoundingClientRect()={left:0, top:70.5, width:1173, height:1013.5}`,`dpr=2`,当前 `computed={x:329, y:360.5}`(=rect.left+params.x, rect.top+params.y)。菜单 y 比鼠标实际**多偏 ~70px,正好 = rect.top**。

**研究结论(Electron 40.6.0,electron.d.ts 证实)**:
- webview `context-menu` 事件的 `params.x/y` 是**相对 guest 页面 viewport 的 CSS 像素**(不含滚动、不乘 dpr)。
- 该事件是裸 `Event`(`ContextMenuEvent extends DOMEvent = Event`),**没有 clientX/clientY** —— 不能走"用 clientX"的捷径,必须几何换算。
- **正确公式仍是 `rect.left + params.x, rect.top + params.y`**,**dpr 不参与**(params 和 rect 同为 CSS px,乘 dpr 反而错)。
- **偏移真因 = `rect` 取错**:`wv.getBoundingClientRect()` 拿到 `top:70.5`,但若 webview 真实顶边并非 70.5(外层容器偏移 / 量取时机布局未稳),就会多偏一个 rect.top。

**修法**:
1. 确认 `wv` 量的是**真正铺满内容区的 webview 元素**。检查 [Host.tsx](src/capabilities/web-rendering/Host.tsx) 里 `wv` 引用链:`webviewRef.current` 是不是就是那个 `<webview>` tag 本身?它外层有没有带 padding/margin/transform 的容器导致 rect 不是内容区真实位置?
   - 排查:webview tag 的实际渲染盒。`rect.top=70.5` 这个 70.5 是什么?很可能是 WebToolbar(工具栏)的高度 —— 即 `wv` 的 rect 把 toolbar 也算进了偏移,或者 webview 元素本身从 toolbar 下方开始(那 rect.top=toolbar 高才对,可实测 rect.top=70.5 与 params 叠加却多偏,说明 params 的原点已在 webview 内容区顶部,rect.top 不该再加)。
   - **关键验证(用户已有 diag log,让用户再测一次确认)**:在 webview **内容区最顶部**(紧贴 webview 上边)右键,看 `params.y` 是否 ≈ 0。
     - 若 `params.y ≈ 0` 且此时鼠标真实宿主 y ≈ 70.5(toolbar 高)→ 那 `rect.top + params.y` 是对的,偏移另有源(menu 渲染容器自身有偏移?查 useCollisionPosition / ContextMenuFrame 是否在某个非 viewport 定位上下文里)。
     - 若 `params.y ≈ 0` 但鼠标真实宿主 y 也 ≈ 0(webview 紧贴窗口顶,没 toolbar 在上方)→ 那 rect.top=70.5 是错的,不该加。
2. **据上一步实测结果定修法**(二选一,让用户测了说):
   - (a) 若 rect 错:改用正确的 webview 内容区元素量 rect,或在 `requestAnimationFrame` 里量(布局稳定后)。
   - (b) 若 rect 对、偏移在 menu 渲染层:查 `ContextMenuBinding` 的 `style={{ left:x, top:y }}` + `useCollisionPosition` —— 菜单是不是渲染在某个有 `position:relative`/`transform` 的父容器内(那样 fixed/absolute 定位基准就偏了)。**但注意**:note/ebook 走同一个 `ContextMenuBinding` 且定位正常,所以渲染层大概率没问题,**偏移更可能在 web 路径的 rect**。
3. **dpr 不要乘**。
4. 修好后**保留一次 diag log 让用户最终验证准了**,确认后**删 diag log**(下一个 commit 或同 commit)。

> ⚠️ 因为 sandbox 跑不了 npm start,你无法亲眼看菜单位置。**你的任务是**:基于上面分析,给出最可能的修法(优先怀疑 rect 来源 / 量取时机),改完保留 diag log,在汇报里**明确告诉用户怎么测一次确认**(贴 params.y≈0 时的鼠标真实位置 vs rect.top),据反馈再收尾删 log。若分析后你有高置信结论(如确认 rect.top=70.5 是 toolbar 高、params 原点已在 webview 内容区顶 → 不该加 rect.top),可直接改并说明,但仍让用户验证。

### bug3:失焦不关 —— 自挂的 window mousedown 对 webview 内部点击无效

**真因(用户确认)**:[context-menu-integration.ts:59-82](src/views/web/context-menu-integration.ts#L59) 的 `handleClickOutside` 挂在宿主 `window` 的 mousedown。点宿主 UI(toolbar/侧边栏)有效,但**点 webview 内部页面时,mousedown 在 guest 独立进程、不冒泡到宿主 window** → 收不到 → 不关。Esc 同理(焦点在 webview 内时宿主 keydown 也收不到)。

**修法(用户拍板:复用 trigger 同款逻辑 + window blur 补边界)**:
1. **保留**现有 `handleClickOutside`(window mousedown,点非 `.krig-context-menu` → hide)+ `handleEscape`(Esc → hide)—— 它们对"点宿主 UI 关菜单"有效,跟 trigger 同款,留着。
2. **补 `window` 的 `blur` 监听**:用户点进 webview 内部 → 宿主 window 失焦 → `blur` 触发 → `contextMenuController.hide()`。这正盖住"点 webview 内部"这一进程边界情况(研究确认:webview tag 不发 focus/blur DOM 事件,但宿主 window 会因焦点转入 guest 而 blur,这个宿主 window blur 拿得到)。
   ```ts
   const handleBlur = (): void => contextMenuController.hide();
   window.addEventListener('blur', handleBlur);
   // teardown 里 removeEventListener('blur', handleBlur)
   ```
3. 三个监听(mousedown / keydown / blur)统一进现有 `attachCloseListeners` / `detachCloseListeners` 一套管理(已有 teardown 句柄机制,加一行 blur 即可)。
4. **blur 防误关注意**:`window blur` 也会在切到别的应用窗口、打开 DevTools 时触发 → 关菜单。对右键菜单这是可接受/期望行为(用户拍板接受此权衡),不用特殊处理。

---

## 2. 文件清单

| 文件 | 改动 |
|---|---|
| `src/capabilities/web-rendering/Host.tsx` | bug2:排查 `wv` rect 来源 / 量取时机,据实测修坐标(不乘 dpr),保留 diag log 待用户最终验证 |
| `src/views/web/context-menu-integration.ts` | bug3:`attachCloseListeners`/`detachCloseListeners` 加 `window blur` 监听 |

**不动** ContextMenuBinding / useCollisionPosition / useContextMenuTrigger(共享,note/ebook 正常)。**不动** web-history.ts。

---

## 3. 不做的事

- ❌ bug2 不乘 dpr。
- ❌ 不改全局 ContextMenuBinding / collision hook / trigger(除非 bug2 实测确证偏移在渲染层 —— 那也先汇报再动,因为会影响 note/ebook)。
- ❌ bug3 不删现有 mousedown/Esc(它们对宿主 UI 有效),只是**补** blur。
- ❌ 不 merge/push。

---

## 4. 验收(commit 前)

1. typecheck PASS。
2. `npm run test -- web-history` 仍 27/27(本轮不动它,确认没误伤)。
3. lint 改动文件 PASS。
4. 手动复现(给用户跑):
   - **bug3**:右键弹菜单 → 点 **webview 内部网页区域** → 菜单关闭(之前不关);点宿主工具栏/侧边栏 → 关闭;Esc → 关闭;点菜单项 → 正常执行+关闭。
   - **bug2**:右键 webview 内多个位置(顶部、中间、滚动后)→ 菜单弹在**鼠标位置**(贴 diag log 最终确认)。
5. commit(分支 `feat/web-context-menu`,**不 merge/push**),中文动机优先,结尾:
   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

---

## 5. 汇报模板

```
Phase 2 右键菜单收口(feat/web-context-menu)完成:

一、产出(commit hash)
二、bug2 坐标 —— rect 来源排查结论 + 修法(rect.top=70.5 是什么 / 最终公式 / 是否保留 diag log 待验)
三、bug3 失焦 —— 加 window blur(file:line),三监听统一管理
四、验收(typecheck/test/lint)
五、手动复现步骤(bug2 让用户贴 diag log 最终确认 / bug3 点 webview 内部验)
六、等指挥:bug2 用户验证准了后删 diag log(下个 commit)?merge/push?进 Phase 3?
```

---

## 6. Self-Contained Check

- ✅ 架构背景(为何 web view 自接路径)
- ✅ bug2 真因 = rect 来源错(非公式、非 dpr)+ 实测数据 + 排查步骤
- ✅ bug3 真因 = window mousedown 不收 webview 内部 + 修法(补 blur)
- ✅ 文件清单仅 2 文件
- ✅ 不做的事 + 验收 + 汇报模板

**外部依赖**:用户跑 npm start 贴 diag log 最终确认 bug2;用户验 bug3;用户拍板删 log + merge/push + 进 Phase 3。

---

*Phase 2 收口包 · 2026-05-31 · feat/web-context-menu · bug2 坐标(rect 来源)+ bug3 失焦(补 window blur)· 真因已查清*
