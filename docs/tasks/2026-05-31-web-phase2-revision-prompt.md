# Phase 2 修订:撤掉「外部浏览器打开」+ 修 web view 右键菜单两个 bug

> 承接 Phase 2(已 commit `ee21d252`,分支 `feat/web-context-menu`,**未 merge**)。
> 指挥手动验收后给了 3 条反馈,本修订包据此调整 Phase 2 范围。诊断已由指挥做完,你只需执行明确修法。
> **在已有分支 `feat/web-context-menu` 上继续做,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. 每条 cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`。Read 传绝对路径。
2. 只动本包「文件清单」列的文件。非范围 bug → 登记汇报。
3. memory:`feedback_diag_log_before_speculation`(跨层坐标问题先 log 实测再改,**别猜**)、`feedback_no_fallback_bandaid_fixes`(不兜底)、`feedback_merge_requires_explicit_ok`(commit 可以,merge/push 等显式 OK)。
4. sandbox 拦 `npm start` → 用户跑。typecheck/单测你自己跑。
5. **bug 2(坐标偏移)必须先加 log 实测坐标系再修**,不要凭猜改公式。
6. 做完 STOP 汇报。

---

## 1. 指挥的 3 条验收反馈 + 已完成的诊断

### 反馈 1 →「外部浏览器打开链接」功能**撤掉**

指挥判定:KRIG 是集成 app,web view 只是子功能,把链接甩到外部浏览器违背「app 内完成一切」的设计,**这个右键项没意义,删掉**。

→ **撤销 commit `ee21d252` 里 §2.1 加的内容**:删 [context-menu-integration.ts](src/views/web/context-menu-integration.ts) 里的命令 `web-view.cm-open-link-external` + 对应菜单项。**§2.4 历史过滤 `shouldRecord` 保留**(那是 Phase 1 漏项,有意义)。

### 反馈 2 → 右键菜单**定位偏移**(离鼠标很远)

**诊断(指挥已查):** web view 右键菜单**不走** `useContextMenuTrigger`(正常 view 走那个,用 `e.clientX/clientY` 真 viewport 坐标,定位准)。web view 走独立路径:

```
Host.tsx webview 'context-menu' 事件
  → params.x/y (webview 内坐标)
  → rect.left + params.x  (Host.tsx:190-198 转 viewport)
  → showWebContextMenu(payload)  (context-menu-integration.ts:50-58)
  → contextMenuController.show(payload.x, payload.y, ...)
  → ContextMenuBinding 用 useCollisionPosition 渲染(期望传入 viewport 坐标 + position:fixed)
```

`useCollisionPosition` 期望 anchor 是 **viewport 坐标**。偏移说明 `rect.left + params.x` 算出来的不是准确 viewport 坐标。

**Electron webview `context-menu` 事件 params.x/y 的坐标系存疑** —— 可能受 webview 内页面滚动、devicePixelRatio、或 params 基准影响。**必须加 log 实测**(铁律 `feedback_diag_log_before_speculation`):
- 在 [Host.tsx:188-198](src/capabilities/web-rendering/Host.tsx#L188) 的 handleContextMenu 里临时打:`params.x/y`、`rect.left/top`、`rect.width/height`、`window.devicePixelRatio`、算出的最终 `x/y`。
- 用户右键几个位置(webview 左上角附近、中间、滚动后),对比鼠标实际位置 vs 算出坐标,定位偏移量来源(是固定偏移?按 DPR 缩放?随滚动漂移?)。
- **实测确认坐标系后再改换算公式**。常见可能:params 已经是相对 webview 的 CSS px(那 `rect.left + params.x` 应正确,偏移另有源);或 params 是相对 webview 的 device px(需除以 DPR);或需要的是 `e.clientX`(webview tag 的 context-menu 事件本身可能也带 clientX,但那是相对宿主的 webview 元素位置)。

> 临时 log 标注 `[web/ctxmenu-diag]` 前缀,实测定位后**删掉**再 commit(或留一条精简的,标注清楚)。

### 反馈 3 → 右键菜单**鼠标失焦/点外部不关闭**(只能点菜单 button 才关)

**诊断(指挥已查,根因明确):** `useContextMenuTrigger`(正常 view 走的)**已有完整的点外部关闭逻辑**:[use-context-menu-trigger.ts:68-82](src/slot/triggers/use-context-menu-trigger.ts#L68) 的 `handleClickOutside`(window mousedown,点非 `.krig-context-menu` 就 hide)+ `handleEscape`(Esc hide)。

**但 web view 绕过了这个 trigger**(它走 Host 事件 → 直接 `controller.show()`),所以**没挂上点外部关闭 / Esc 关闭**。这就是 bug 3。

→ **修法:给 web view 右键菜单补上「点外部关闭 + Esc 关闭」**。**不要改全局 `ContextMenuBinding.tsx`**(note/ebook 走 trigger 已经好的,动共享组件会重复挂监听 / 引入回归)。修法定在 web view 自己的路径:

**推荐做法**:在 `showWebContextMenu`(context-menu-integration.ts)弹菜单时,注册一次性的 `window mousedown`(点非 `.krig-context-menu` → `contextMenuController.hide()`)+ `keydown Esc → hide`,菜单关闭时移除监听。参考 [use-context-menu-trigger.ts:68-88](src/slot/triggers/use-context-menu-trigger.ts#L68) 的现成写法照搬到 web 路径,或参考 [WebToolbar.tsx](src/views/web/WebToolbar.tsx) 语言下拉菜单的「下一帧加 listener 避免捕获到打开那次 click」技巧(用 `setTimeout(0)` 延后挂 mousedown,避免右键本身触发的 mousedown 立即关掉刚弹的菜单 —— **这个坑要注意**:右键事件序列里 mousedown 可能先于菜单 show,直接挂会秒关)。

**关键防坑**:
- 延后挂 mousedown(setTimeout 0 或用 `{ once:false }` + 首次跳过),否则右键的 mousedown/contextmenu 序列会让菜单一弹就被关。
- 菜单 hide 后必须 removeEventListener,别泄漏。
- 点菜单项本身(`.krig-context-menu` 内)不关(由命令执行后 controller.hide() 关),mousedown handler 里判 `target.closest('.krig-context-menu')` 跳过 —— 跟 trigger 同款。

---

## 2. 文件清单

| 文件 | 改动 |
|---|---|
| `src/views/web/context-menu-integration.ts` | ①删 `cm-open-link-external` 命令+菜单项(反馈1);②加点外部关闭+Esc 关闭逻辑(反馈3) |
| `src/capabilities/web-rendering/Host.tsx` | 反馈2:加临时诊断 log 实测坐标系 → 据实测修 `rect.left+params.x` 换算(L188-198);log 删/精简后 commit |
| `src/views/web/web-history.ts` | **不动**(§2.4 shouldRecord 保留) |

**不动** `ContextMenuBinding.tsx` / `useCollisionPosition` / `useContextMenuTrigger`(共享基础设施,note/ebook 正常,改了有回归风险)。

---

## 3. 不做的事

- ❌ 不留「外部浏览器打开链接」项(撤掉)。
- ❌ 不改全局 ContextMenuBinding / collision hook / trigger。
- ❌ bug2 不凭猜改坐标公式 —— 先 log 实测。
- ❌ 不动 web-history 的 shouldRecord(保留)。
- ❌ 不 merge/push。

---

## 4. 验收(commit 前)

1. typecheck PASS(`npm run typecheck`)。
2. `npm run test -- web-history`(shouldRecord 仍在,27 测仍过 —— 撤外部浏览器项不影响它)。
3. lint PASS(`npm run lint` 对改动的 source 文件)。
4. 手动复现(给用户跑):
   - 右键链接 → **不再有**「外部浏览器打开」项(其余复制链接/图片地址/选区/查词/翻译 5 项还在)。
   - 右键菜单**弹在鼠标位置**(反馈2修好;附实测坐标系结论)。
   - 右键弹菜单后**点页面别处 / 按 Esc → 菜单关闭**(反馈3修好);点菜单项仍正常执行+关闭。
5. commit(分支 `feat/web-context-menu`,**不 merge/push**),中文动机优先,结尾:
   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```
   建议这是一个新 commit(在 `ee21d252` 之上),message 说明「撤外部浏览器项 + 修右键菜单定位/失焦两 bug」。

---

## 5. 汇报模板

```
Phase 2 修订(feat/web-context-menu)完成:

一、产出(新 commit hash)
二、反馈1:外部浏览器项已撤(file:line)
三、反馈2 定位偏移 —— log 实测的坐标系结论(params.x/y 实际是什么基准 / 偏移源)+ 修法公式
四、反馈3 失焦不关 —— 修法(点外部+Esc,如何避开右键秒关坑)
五、shouldRecord 保留确认(单测仍过)
六、验收(typecheck/test/lint)
七、手动复现步骤
八、等指挥拍板:merge/push?进 Phase 3?
```

---

*Phase 2 修订包 · 2026-05-31 · feat/web-context-menu · 撤外部浏览器项 + 修右键 2 bug · 诊断已由指挥完成*
