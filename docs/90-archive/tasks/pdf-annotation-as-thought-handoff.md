# PDF 标注 → Thought 评论一体化

## 任务

KRIG-Note V2 的 PDF 标注(rect / underline)目前**已经走 thought capability**(sub-phase 022
迁完,见 `usePdfAnnotations.create`),但**只是创建,没有评论入口**:

- 用户拖框 → AnnotationLayer 弹 5 色 picker → 选色 → `thoughtApi.createThought({ type: 'rect-frame' | 'underline', doc: 空 PM 段, ... })`
- 然后**什么都没发生** — thought 落库了,但用户看不到、没法写评论

**目标**:对齐 Note 的 thought 体验,让 PDF 标注后立即能写评论,已评论的标注 hover 时弹 preview。

具体行为(用户视角):

1. **非全屏**(navSideCollapsed=false)拖框标注 → 选色 → **右槽自动打开 ThoughtView 并 focus 到新 thought 的编辑器**(对齐 Note ⌘⇧M / 右键"💭 加思考"行为)
2. **全屏**(navSideCollapsed=true)拖框标注 → 选色 → **当场弹一个 ThoughtCard 浮卡**(定位贴在标注 rect 旁,可拖动 / 关闭),用户在浮卡上写评论,完成后浮卡关闭(或保持开,用户手动关)
3. **Hover 已有标注**(任何状态) → 显示只读 preview 卡片(thought.doc 渲染),包含 thought 标识颜色和创建时间
4. **删除**(任何状态) → 标注右键 → 调用 `thoughtApi.deleteThought`,thought + anchor 边 + 标注全部级联消失(**当前已实现,保持不变**)

---

## 仓库

- **CWD(每个 Bash 必 cd)**:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- V1 在 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`(**只读参考**,不要在那里跑 npm/git)
- 当前 main HEAD:`5f446bec` (Merge feature/pdf-fullscreen-paged)
- 当前分支:`feature/pdf-annotation-as-thought`(已基于 main 创建,working tree clean)

---

## 现状速查(已就位 / 还差什么)

### ✅ 已就位(直接复用,不要重写)

| 设施 | 位置 | 用途 |
|---|---|---|
| `thoughtApi.createThought` | `src/capabilities/thought/index.ts` | 建 thought atom + thoughtOf 边 |
| `thoughtApi.deleteThought` | 同上 | 级联删 atom + 所有边 |
| `thoughtApi.listThoughtsBySource('book', bookId)` | 同上 | 拿当前书所有 thought |
| `thoughtApi.onListChanged` | 同上 | 订阅 thought 变更广播 |
| `usePdfAnnotations.create` | `src/views/ebook/use-pdf-annotations.ts` | 已经在调 `createThought`,**返回 thought id 没暴露给调用方** — 任务一:暴露 |
| `usePdfAnnotations.annotations` | 同上 | 含 `thoughtId` 字段的 PageAnnotation 列表 |
| `ThoughtView` | `src/views/thought/ThoughtView.tsx` | 右槽伴随面板,source-aware 自动过滤 |
| `ThoughtPanel` | `src/views/thought/ThoughtPanel.tsx` | 卡片列表 |
| `ThoughtCard` | `src/views/thought/ThoughtCard.tsx` | 单卡片(颜色条 / 元信息 / 编辑器 / 删除) |
| `ThoughtCardEditor` | `src/views/thought/ThoughtCardEditor.tsx` | text-editing.Host 薄包装,1s debounce 落库 |
| 跨槽 channel `thought.activate` | `src/workspace/.../channels` + ThoughtView 内 useEffect | 触发后 ThoughtView 高亮对应 thoughtId |
| 命令 `thought-view.add-from-note` | `src/views/thought/command-impl/add-from-note.ts`(or 类似) | **参考实现** — note 加 thought 时如何开右槽 + activate |
| `commandRegistry`(`thought-view.*` 命名空间) | `src/slot/command-registry/...` | 注册新命令的入口 |
| AnnotationLayer rect/underline 绘制 + 5 色 picker | `src/capabilities/ebook-rendering/fixed-page-content/annotation-layer.tsx` | 已 work,不要重写,只在创建链路上扩展 |
| `EBookHost` 把 PDF 渲染分 scroll/paged 两路 | `src/capabilities/ebook-rendering/Host.tsx` | 两路都用同一 `AnnotationLayer`,所以**任务点只在 view 层和 thought 层,不要改 capability** |

### ❌ 缺失(本次要做)

1. **新建标注后不打开 ThoughtView / 不弹卡片** — 选色完就静默
2. **没有"刚创建 thought 的 id"传递通道** — `pdfAnn.create` 内部知道 thought.id 但没返回
3. **没有 Hover preview 卡片** — 标注上无 mouseenter 探针
4. **全屏期没有 ThoughtCard 浮卡组件** — 全屏不能开右槽(NavSide 收起后 ThoughtView 在哪都还没设计;按需求"弹一个 Thoughts card,方便用户评论")

---

## 架构原则(项目永久规则,违反我会回滚)

按 [[layered-refactor-charter]] + 用户偏好:

1. **L4 分层 / 注册原则**:任何跨 view 的交互必须走 `commandRegistry` + `contextMenuRegistry` 等 L4 统一 registry;不要在 view 内绕过 registry 直接 import 其他 view 模块
2. **capability ↔ view 边界**:capability 不能 import view;view 通过 `requireCapabilityApi<T>(id)` 拿 api
3. **view 间互不 import**:EBookView 不直接 import ThoughtView。要触发 ThoughtView 行为走命令(`commandRegistry.execute('thought-view.xxx', arg)`)
4. **新增命令必须自注册**:跟 `thought-view.add-from-note` 同模式 — capability 或 view 内的 `register-commands.ts` 文件 `commandRegistry.register(...)`,view `index.ts` 启动期调一次
5. **不要扩 L4 EnabledWhen / ContextInfo 枚举**:这次需求不需要,如果遇到引诱你扩的场景,先和用户讨论
6. **commit 前**:`npx tsc --noEmit` 过滤 main/ipc/handlers + WorkspaceBar 已有错误后必须 0 errors;触及文件 ESLint 0 new warnings
7. **merge to main 必须用户显式 OK**;"commit" ≠ "commit + merge"。中间多次 commit 允许,合并时机用户拍板
8. **每个 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&`**;Read 工具用绝对路径(V2 cwd 已漂移 7 次,有教训)
9. **实施完后给逐项测试清单**(操作步骤 + 期望结果),不只是"npm start 跑一下"
10. **严禁 fallback 绕过未诊断根因**:先 log 定位真因再针对性修

---

## 实施计划(建议路径,可调整)

### Phase 1: 暴露 thought.id + 改造 create 链路

`usePdfAnnotations.create` 当前签名 `(pageNum, draft) => Promise<void>`,改成返回创建的 `ThoughtInfo`(或至少 thought id)。调用方在 EBookView 内:

```tsx
onPdfAnnotationCreate={async (pageNum, draft) => {
  const created = await pdfAnn.create(pageNum, draft);
  if (!created) return;
  // ↓ Phase 2/3 加分支
}}
```

`pdfAnn.create` 落 thought 后还要 emit 一个事件让 view 知道哪个是新的(因为 thought 列表
是订阅式回流,新建后下一次 list 推送才会含新条目)。最干净:**create 返回 thoughtId**。

### Phase 2: 非全屏 — 复用 add-from-note 模式

读 `src/views/thought/command-impl/add-from-note.ts`(或对应 commands 注册文件)看
note 那边怎么:
- 开右槽
- activate 新 thought id
- focus 编辑器

抄模式,加一个 `thought-view.add-from-pdf-annotation`(命名:对齐
`thought-view.add-from-note`),接收 `{ thoughtId: string }` 参数。EBookView 在创建
分支调:
```tsx
commandRegistry.execute('thought-view.add-from-pdf-annotation', created.id);
```

**判断"非全屏"用 `!workspaceManager.get(wsId)?.navSideCollapsed`**(EBookView 内已订阅 `isFullscreen`)。

### Phase 3: 全屏 — ThoughtCard 浮卡

新组件,**不要复用 ThoughtCard**(那是列表里用的卡片样式)。建议命名:
`ThoughtFloatingCard.tsx`(放 `src/views/thought/` 或新建 `floating-card/`)。

设计要点:
- **定位**:`position: fixed`,锚到标注 rect 视口坐标 + 偏移(参考标注 rect 中心右下角 12px gap);拖出视口范围时翻边(参考 EpubAnnotationPicker 已有的 containerWidth 边界处理)
- **内容**:复用 `ThoughtCardEditor`(已经是 PM 编辑器,1s debounce 落库)
- **关闭**:×按钮 / ESC / 点击外部
- **生命周期**:模块级 controller 持 state(对齐 `popupController` / `contextMenuController` 模式),`floatingThoughtCardController.show(thoughtId, anchorRect)` / `.hide()`
- **跨实例**:同一时刻只允许一个 floating card(类比 EpubAnnotationPicker)

EBookView 全屏分支调 controller.show;非全屏分支走命令开右槽(Phase 2)。

**关键:不要做拖动改大小**,v1 先不带,够用就行 — 重点是评论能写。

### Phase 4: Hover preview

AnnotationLayer 内每个已有标注 div 上加 `onMouseEnter` / `onMouseLeave`:
- enter:200ms 延迟后(防误触)调 `thoughtHoverPreviewController.show(thoughtId, anchorRect)`
- leave:立即 hide(若鼠标进 preview 卡片本身则保持)

Preview 卡片**只读 ThoughtCardEditor**(传 readOnly=true),无编辑能力,只展示 doc + 时间。

`thoughtHoverPreviewController` 同 Phase 3 controller 模式,独立 controller(可能也独立组件)。

**Open question**:hover preview 和 floating card 能否复用同一组件? 共用 `ThoughtFloatingCard` + readOnly prop 即可,只是 controller 不同(一个 hover 触发,一个创建触发)。

### Phase 5(可延后):删除入口微调

当前 AnnotationLayer 右键删除直接调 `onAnnotationDelete(ann.id)`。需要检查:
- ann.id 现在是 `thought.id`(新路径)还是 `String(createdAt)`(老路径)? 看 [src/views/ebook/use-pdf-annotations.ts](src/views/ebook/use-pdf-annotations.ts) 已有处理两路的逻辑
- 全屏期 floating card 上要不要加"删除评论 + 标注"按钮? **建议加**(垃圾桶图标),走同一 `thoughtApi.deleteThought` 路径

---

## 用户拍板的设计点(直接照做,不要再问)

1. **标注 = thought** — 不要保留两个概念
2. **非全屏开右槽 ThoughtView**(对齐 Note 行为)
3. **全屏弹 ThoughtCard 浮卡**(类似 popup,但富文本编辑器)
4. **Hover 已评论块弹 preview**(只读)
5. **保留 5 色 picker**(rect / underline 创建时选色)— 颜色就是 thought.color

---

## 还需要用户拍板的开放问题

实施过程中若遇到以下问题,先和用户讨论再决定,不要自作主张:

1. **空 thought 怎么处理**:用户拖了框、选了色,但**没写评论**就关了浮卡 / 右槽,thought 已经落库,标注还在。这是预期(同 Note 那边 thought 行为)? 还是要做"空 thought 自动清理"? 
2. **全屏期 hover preview 会被 toolbar / paged 翻页 trackpad 事件干扰吗**:全屏期 wheel 被 FullscreenPageView 接管,鼠标停顿会触发 hover,这两者时序如何? 先实现观察,有冲突再讨论
3. **多标注重叠时 hover 命中哪个**:DOM 层级最上层的先响应(浏览器默认),够用? 
4. **PDF 翻页(scroll / paged)期间 floating card 怎么处理**:翻页后 anchor rect 视口坐标变了 — 直接 hide? 跟随? 建议 hide
5. **EPUB 路径**:本次只做 PDF。EPUB 已有 EpubAnnotationPicker(选区 → 5 色 picker → 高亮)。**EPUB 标注当前不走 thought 路径**(`useEpubAnnotation` 单独的 hook),先不动 EPUB,任务范围仅 PDF。如果用户后续要 EPUB 也走 thought 一体化,单开任务

---

## 关键文件(读这几个理解现状)

| 路径 | 必读理由 |
|---|---|
| `src/views/ebook/use-pdf-annotations.ts` | PDF 标注 view 协调 hook,**已经在调 thoughtApi**,看现状 |
| `src/views/ebook/EBookView.tsx` | view 主组件,标注 props 透传给 Host |
| `src/capabilities/ebook-rendering/fixed-page-content/annotation-layer.tsx` | 5 色 picker + rect/underline 绘制 + 右键删除 |
| `src/views/thought/ThoughtView.tsx` | 右槽伴随面板的当前实现,看 source-aware + `thought.activate` channel |
| `src/views/thought/ThoughtCard.tsx` | 单卡片渲染(可能可复用) |
| `src/views/thought/ThoughtCardEditor.tsx` | PM 编辑器薄包装(直接复用,Phase 3 浮卡内嵌) |
| `src/views/thought/command-impl/`(目录) | **关键** — 看 `add-from-note` 模式,本任务的 `add-from-pdf-annotation` 抄它 |
| `src/views/note/context-menu-content.ts` | Note 那边 `thought-view.add-from-note` 是怎么注册到右键菜单的 |
| `src/views/thought/index.ts` | thought view 启动期注册的入口 |
| `src/capabilities/thought/types.ts` | `ThoughtCapabilityApi` 全套 API 签名 |
| `src/capabilities/thought/DESIGN.md` | 双轨期 / source / locator 架构图 |

---

## 立即开始

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git status   # 确认 working tree clean,在 feature/pdf-annotation-as-thought 分支
git log --oneline -3   # 看最近 3 个 commit,理解从哪里出发

# 读关键文件理解现状(按推荐顺序)
cat src/views/ebook/use-pdf-annotations.ts
ls src/views/thought/command-impl/
cat src/views/thought/command-impl/*.ts  # 找 add-from-note 抄模式
cat src/views/thought/ThoughtView.tsx
cat src/capabilities/ebook-rendering/fixed-page-content/annotation-layer.tsx
```

读完代码 + 上面的"开放问题"清单,**先和用户对齐方案,讨论 Phase 1/2 设计**,
**别上来就动 Phase 3 浮卡组件**。建议拆 PR 思路:Phase 1+2 单独一波(非全屏路径全跑通),
Phase 3 独立一波(全屏浮卡 + Hover preview)。

---

## 测试清单(实施完成后逐项验证)

### 标注创建 + 评论
1. **非全屏 PDF 拖 rect** → 选色 → 右槽自动开 ThoughtView,新 thought 卡片 active,光标在编辑器内,可立即打字写评论
2. **非全屏 PDF 拖 underline** → 同上
3. **全屏 PDF 拖 rect** → 选色 → 弹 floating card 在标注右下方,光标在编辑器内,可立即打字
4. **全屏 PDF 拖 underline** → 同上

### Hover preview
5. **非全屏 hover 已评论标注** → 200ms 后弹只读 preview,显示评论内容 + 时间 + 颜色
6. **非全屏 hover 无评论标注**(空 thought)→ 弹 preview 显示"无内容"或类似 placeholder(不要白屏)
7. **全屏期 hover 同上**

### 持久化 + 跨场景
8. **写评论 → 切书 → 切回** → 评论内容保留
9. **重启 app** → 之前评论的标注 hover 仍能看到评论
10. **同书多页标注 → 切右槽 ThoughtView** → 看到所有 thought 卡片按顺序排列

### 删除链路
11. **标注右键删除** → 标注消失 + thought 消失 + 右槽对应卡片消失
12. **右槽卡片删除按钮** → 标注消失(PDF 上的高亮也清掉)
13. **全屏 floating card 删除按钮**(若 Phase 5 加了)→ 同上

### 翻页 / resize
14. **翻页**(paged 模式)→ 旧页 floating card 消失(或跟随? 决议见开放问题)
15. **resize 窗口**→ floating card 位置跟随标注 rect

### 不破坏既有
16. **EPUB 选区 → 颜色 picker → 创建标注** → 走 useEpubAnnotation 旧路径不变,**不要被 PDF 改动牵连**
17. **toolbar 标注按钮 ▢/▁** → 仍可切换标注模式(本次只改创建后的行为,不改入口)
18. **Note ⌘⇧M 加 thought** → 完全不变(本次只动 PDF 路径)

---

## 失败回滚

如果 Phase 3 浮卡设计走不通(全屏下 floating card 和 paged 翻页动画 / trackpad 手势
有难以协调的事件冲突),**先停下来跟用户讨论**。备选:
- 全屏期暂时不弹 floating card,只 toast 提示"已记录,展开 NavSide 后可评论"
- 或全屏期临时弹回 NavSide 让用户在右槽评论

不要硬着头皮打补丁。
