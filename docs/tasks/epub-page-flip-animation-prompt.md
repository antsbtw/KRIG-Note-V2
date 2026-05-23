# EPUB 翻页动画（双 foliate-view 方案）

> 任务交接提示词,直接喂给新对话即可开干

## 任务

为 KRIG-Note V2 EPUB 全屏阅读添加翻页动画,对齐 PDF 全屏已实现的 PaperSwipe 效果
(旧页面向左滑出 / 新页面向右滑入,1500ms easeOutQuint 曲线)。

## 当前状态

- 仓库:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- 分支:从 `main` 切新分支 `feature/ebook-page-flip-animation`
- EPUB 全屏功能已完整可用(toolbar + 6 Books 主题 + 字号 + 双页布局 + 输入跳页),
  **仅缺翻页动画**
- 现在 EPUB 翻页 = foliate-js 默认瞬切,无过渡
- PDF 全屏翻页动画已在
  `src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx` 的
  `animateTransition` 函数中实现,**逐字对照该实现的策略移植到 EPUB**

## 用户拍板的方案:双 foliate-view

**不要走截图方案**(html2canvas / Electron capturePage 都不可靠,曾被讨论否决)。

实现思路:

1. Panel 内同时持有**两个 EPUBRenderer 实例**(current + 临时第二实例),
   各自管理独立的 foliate-view DOM
2. 翻页时:
   - **Next**:临时实例加载新页面 → 待渲染就绪 → 旧实例 wrapper translateX
     滑出屏幕左侧(1500ms easeOutQuint)→ 动画完成销毁旧实例,临时实例升为 current
   - **Prev**:临时实例加载新页面到屏外左侧 → 临时实例 wrapper translateX
     滑入到中央覆盖旧实例(1500ms) → 动画完成销毁旧实例
3. **设置同步**:popup 改字号 / 主题 / appearance 时,两个实例都要 apply
4. **wheel / 键盘 / 按钮锁**:动画进行中再触发的翻页 short-circuit 直接跳到目标,
   不堆动画

## 关键已知细节

- **EPUBRenderer 可独立 mount 多实例**:每个实例自己持 view/container/state,
  customElements.define 是全局的不影响
- **同一本书 ArrayBuffer 可喂给多个 renderer**:`r.load(buffer)` 各自独立
- **第二实例加载 ~200-500ms**(foliate 解压 EPUB + init),第一次翻页会卡顿。
  **先不预加载**,第一版接受这个代价;如果后续要优化,加预加载
  (panel mount 后立即在后台 init 第二实例定位到 currentPage+1)
- **CFI 定位**:用 `view.goTo(cfi)` 跳到任意位置。可以让 B 先
  `goTo(A 当前 cfi)` 再 `view.next()` 翻到下一页
- **buffer 来源**:从第一个 renderer 拿(需在 EPUBRenderer 加 `getFileData()` API),
  或 panel 直接调 `library.getData()` 重拿一次
- **shadow root closed**:`<foliate-view>` 是 shadow closed,不能 cloneNode 截图。
  所以必须双实例

## 必读源码(按优先级)

| 文件 | 必读原因 |
|---|---|
| `src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx` | PDF 翻页动画完整实现,是抄写参考 |
| `src/capabilities/ebook-rendering/fullscreen/EBookFullscreenPanel.tsx` | Panel 现状,要在此接入 EPUB 翻页动画 |
| `src/capabilities/ebook-rendering/epub/index.ts` | EPUBRenderer 完整实现,理解 load / initView / setStyles 流程 |
| `src/capabilities/ebook-rendering/Host.tsx` | Host 内 EPUB 路径走 ReflowableContent + 单 renderer,需理解再决定怎么改 |
| `src/capabilities/ebook-rendering/reflowable-content/index.tsx` | 当前 EPUB 渲染容器,可能需要新建一个 paginated 版本 |
| `node_modules/foliate-js/view.js` 的 `goTo / goToFraction` | EPUB 跳页 API |

## 必读 memory(避免踩已记录的坑)

- `feedback_event_listener_must_use_ref_for_business_fn` — wheel handler 必须 ref 化
  业务函数,否则一次手势翻 N 页(曾经踩过)
- `feedback_react_unmount_child_cleanup_order` — 外部 SDK 嵌套的 cleanup 顺序问题,
  销毁旧 EPUBRenderer 实例时要注意
- `project_ebook_fullscreen_overlay_done` — 全屏 overlay 整体架构 + PDF 翻页动画
  的 4 个核心教训
- `feedback_iframe_in_hidden_container_zero_height` — iframe 在 hidden 容器内
  高度变 0,新实例预加载时容器必须真实可见
- `feedback_strict_compliance_workflow` — 严格态工作流,bug 排查先 log 不要猜
- `feedback_diag_log_before_speculation` — 三个 log 点(操作起点 + capability 边界
  + 受害方)跑一次复现立刻收敛
- `feedback_v2_is_workspace_v1_is_reference` — 工作目录是 V2,每个 Bash 命令都
  cd 到 /V2
- `feedback_merge_requires_explicit_ok` — merge 需用户显式授权,不要主动合
- `feedback_branch_module_boundary` — 一个模块一条 feature 分支,里程碑后合并

## 工程量预估

- 约 300 行新代码 + 修改面 ~150 行
- 至少 2-3 个 commit(先 next 单方向跑通 → 加 prev → 设置同步完善)
- 不预加载方案的卡顿可接受性,**实测后再决定是否加预加载优化**
- 估计 2-3 个对话回合能完成(含手测往返)

## 推荐实施分阶段

### Phase 1:基础架构(1 commit)

- 在 EPUBRenderer 加 `getFileData()` 暴露 ArrayBuffer(供 panel 创建第二实例用)
- 新建 `PaginatedReflowableContent` 组件(或在 panel 内直接管 — 看哪个侵入面小,
  倾向新建组件保持隔离)
- Host 加 `epubLayout='scroll'|'paged'` prop,paged 时不渲染 ReflowableContent,
  让 panel 自管双 view
- panel mount EPUB 时创建 current 实例 + 容器结构(current wrapper + 预留
  incoming wrapper 位置)

**验收**:EPUB 全屏功能完全和之前一致(**单 view 走通**),只是架构改成
panel 自管。无翻页动画。

### Phase 2:next 翻页动画(1 commit)

实现 `epubAnimateNext()` 函数:

1. 创建第二个 EPUBRenderer 实例(B),用 getFileData() 拿同一 buffer
2. 第二个 wrapper appendChild 到容器,**visibility:hidden + zIndex:1**
   (A wrapper zIndex:2 在上)
3. `await B.load(buffer)` + `await B.initView(secondWrapper)` +
   **`await B.view.goTo(nextCfi)`**
   - nextCfi 怎么算:先 `B.view.goTo(A.lastCFI)` 再 `B.view.next()` 一次,
     await relocate 事件拿到新 cfi
4. B 像素就位 → `B.wrapper.visibility = visible`(仍被 A 挡住)
5. requestAnimationFrame → A.wrapper 加 transition translateX 滑出屏幕左侧
   (1500ms easeOutQuint)
6. 1530ms 后:销毁 A.renderer(`A.destroy()`)+ 移除 A.wrapper,B 升为 current

- wheel / 键盘 / 按钮翻页全走 `epubAnimateNext`
- `animatingRef.current` 锁:动画中再触发 short-circuit 直接 `B.view.next()`
  (不堆动画)

**验收**:EPUB 全屏 next 翻页有动画(旧页面滑出 1.5s),prev 仍是 foliate 默认瞬切。
第一次翻页可能卡顿 200-500ms(B init 时间)。

### Phase 3:prev 翻页 + 设置同步 + 完善(1 commit)

- `epubAnimatePrev()`:B 加载 prev cfi → wrapper 起点在屏外左侧
  (translateX -100vw)+ zIndex:2 → 像素就位 → transition translateX 到 0
  滑入覆盖 A
- 设置同步:panel 内 settings 变化时同步推两个 renderer:
  - subscribe `subscribeEpubReadingSettings` 时既推 current 也推 incoming(如果存在)
  - popup 改字号 / 主题 / appearance 时同上
  - 双页布局切换时同上
- 字号 / 主题变化触发的 foliate 重排可能导致 cfi 漂移,需要重新拿 lastCFI

**验收**:next + prev 都有动画。设置变化时两个 view 同步生效。无视觉跳变。

### Phase 4(可选):预加载优化

- panel mount + 每次翻页完成时,后台 init 第二实例定位到 currentPage+1,待用
- 翻页发生时直接用预加载好的实例,第一次翻页也无卡顿
- 内存代价:常驻两个 foliate-view = ~2x 内存(EPUB 通常 5-30MB,200-300MB 翻倍可接受)

**判断时机**:Phase 3 完成后实测,如果第一次翻页等待感强烈再做。

## 常量参考(从 PDF 路径抄)

```ts
const SLIDE_MS = 1500;
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'; // easeOutQuint
```

## 关键技术决策已落地(不要再讨论)

- ✅ 双 foliate-view(不是截图)
- ✅ 不预加载(先做,卡顿可接受再决定是否优化)
- ✅ 同一 buffer 共享(getFileData API)
- ✅ next = 旧滑出 / prev = 新滑入(对齐 PDF 语义)
- ✅ 1500ms easeOutQuint(对齐 PDF)

## 测试清单(每个 Phase 结束时跑)

| # | 操作 | 期望 |
|---|---|---|
| 1 | EPUB 全屏 next | 旧页面 1.5s 滑出屏幕左侧,新页面在原位呈现 |
| 2 | EPUB 全屏 prev | 新页面 1.5s 从屏外左侧滑入覆盖旧页面 |
| 3 | trackpad 双指连续翻多次 | 每次手势翻一次,动画中再触发 short-circuit 到目标 |
| 4 | 翻页中改字号 | 两个 view 同步重排,不视觉跳变 |
| 5 | 翻页中切主题 | 两个 view 同步换色 |
| 6 | 翻页中切单 / 双页 | 两个 view 同步切布局 |
| 7 | PDF 全屏翻页 | **完全不受影响**(独立路径) |
| 8 | 非全屏 view EPUB | **完全不受影响**(单 view 路径) |

## 流程纪律

- 写完每个 Phase **typecheck + lint 必须 0 errors / 0 新增 warnings** 再 commit
- commit 后用户手测,通过才下一个 Phase
- **不要主动 merge 到 main**,用户授权才合
- 每次 Bash 命令必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
  (V2 cwd 漂移已多次)
- bug 排查必先加 log 看真值,不要看代码猜

## 完成后的收尾

- 更新 memory:新建 `project_ebook_epub_flip_animation_done.md` 记录关键决策
  + 4 个核心教训(如果有)
- 如有发现新的通用 React/foliate 模式坑,写一条 feedback 类 memory
- 在 MEMORY.md 加索引行
