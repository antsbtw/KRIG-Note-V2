# V1 → V2 NoteEditor 完整迁移盘点

> 日期:2026-05-07
> 用途:盘点 V1 NoteEditor 的所有功能,标注 V2 完成度,识别后续优先级
> V1 总规模:`src/plugins/note/` ~20,685 行
> V2 当前:`src/drivers/text-editing-driver/` + `src/views/note/`

---

## 0. 状态图例

- ✅ **已迁完整** — V2 已实现且功能对等(或更好)
- ⚙️ **已迁基础** — V2 有核心,部分子功能未迁
- ⏸️ **已知限制 / 占位** — 设计文档明示留 sub-stage
- ❌ **未迁** — V2 完全没有

---

## 1. blocks(节点类型)

### V1 共 23 个 block 文件

| V1 block | V2 状态 | 备注 |
|---|---|---|
| text-block | ✅ | text-block(段落 + h1-h3) |
| bullet-list / ordered-list | ✅ | 含 listItem |
| task-list | ✅ | taskItem(checkbox + 时间标签 + deadline) |
| blockquote | ✅ | 同名 |
| code-block | ⚙️ | V2 基础;**code-plugins(~1195 行,html/js/markdown/mermaid 高亮)未迁**;CodeMirror 6 升级阻塞分支 |
| horizontal-rule | ✅ | 同名 |
| hard-break | ✅ | 同名 |
| callout | ✅ | 同名 |
| toggle-list | ✅ | 同名 |
| image | ✅ | L5-B3.5,3 态 + SVG 安全清洗 |
| math-block | ✅ | L5-B3.6,KaTeX |
| math-inline | ✅ | L5-B3.6,行内 atom |
| **table / tableRow / tableHeader / tableCell** | ⚙️ | L5-B3.7 B+ 路径,核心 OK,UX 装饰留 sub-stage |
| **note-link** | ❌ | 双链 `[[note-title]]`,**KRIG 知识图谱基础,优先级最高** |
| **page-anchor** | ❌ | 跨笔记锚点(链接到笔记内某 block) |
| **external-ref** | ❌ | 外部文件引用 `file://path` |
| **file-link** | ❌ | 文件链接(轻量,不上传) |
| **file-block** | ❌ | 附件 block(上传到 mediaStore) |
| **column-list** | ❌ | 多列容器(Notion 风格分栏) |
| **frame-block** | ❌ | KRIG 特有,框选标注 |
| **html-block** | ❌ | 嵌 HTML 片段 |
| **tweet-block** | ❌ | Twitter 嵌入 |
| **audio-block** | ❌ | 音频(mediaStore + audio 标签) |
| **video-block** | ❌ | 视频(mediaStore + video 标签 / YouTube 嵌入) |
| **math-visual** | ❌ | LaTeX 可视化编辑器(独立模块 ~1219 行) |
| **mermaid-lang** | ❌ | mermaid 图渲染(在 codeBlock 子集,留 codeBlock 升级一起做) |
| **render-block-base.ts** | ❌ | V1 简单 render block 基类(image/audio 等用)— V2 没复用,每个 block 独立写 |

**V2 已迁 12 个核心 + 4 table = 16 / 23**(70%)

---

## 2. marks(行内格式)

| V1 mark | V2 状态 |
|---|---|
| bold / italic / underline / strike / code | ✅ |
| link | ✅ L5-B3.4 全栈(LinkPanel + 5 协议路由) |
| textStyle(文字色) | ✅ |
| highlight(背景色) | ✅ |
| **thought** | ❌ **V2 暂无 thought mark 系统**(留 thought view 一起做) |

**V2:8 / 9**(thought 留 thought view)

---

## 3. plugins(PM 插件 — 交互 / 行为层)

V1 `plugins/` 共 17 个文件,V2 `plugins/` 11 个。

| V1 plugin | V2 状态 | 备注 |
|---|---|---|
| input-rules.ts | ✅ build-input-rules.ts | heading + 4 mark markdown 输入规则 |
| slash-command.ts | ✅ build-slash-plugin.ts | slash menu 触发 |
| block-handle.ts | ✅ build-block-handle-plugin.ts | ⋮⋮ 手柄 + drag |
| code-block-keyboard.ts | ✅ build-code-block-keymap.ts | Enter / Tab / 双 Enter 跳出 |
| link-click.ts | ✅ build-link-click-plugin.ts | 5 协议路由 |
| (history) | ✅ build-history-plugin.ts | undo/redo |
| (mark keymap) | ✅ build-mark-keymap.ts | Mod+B/I/U/E |
| (heading keymap) | ✅ build-heading-keymap.ts | Mod-Alt-1/2/3 |
| (list keymap) | ✅ build-list-keymap.ts | Tab 缩进 / Enter 出列表 |
| (hard-break keymap) | ✅ build-hard-break-keymap.ts | Shift-Enter |
| **block-selection.ts** | ❌ | block 级选区(光标在 block 边缘选整 block,V1 自绘) |
| **block-frame.ts** | ❌ | frame 框装饰(配 frame-block 用) |
| **column-collapse.ts** | ❌ | column-list 折叠 |
| **container-keyboard.ts** | ❌ | 容器 block 边界键盘(blockquote / callout 等出入) |
| **from-page-decoration.ts** | ❌ | "来自某页"装饰(KRIG note 之间引用关系视觉化) |
| **heading-collapse.ts** | ❌ | heading 下方内容折叠 |
| **indent.ts** | ❌ | 段落首行缩进(text-block.attrs.indent V1 有,V2 schema 已预留 attr 但无插件) |
| **note-link-command.ts** | ❌ | `[[` 触发双链选择面板 |
| **paste-media.ts** | ❌ | 粘贴图片自动 mediaPutBase64(L5-B4.3.1 已有底层 API,只缺 plugin 接入) |
| **render-block-focus.ts** | ❌ | render block 聚焦时显示外框 |
| **thought-plugin.ts** | ❌ | thought mark 交互(留 thought view) |
| **title-guard.ts** | ❌ | 第一行 = 标题保护(V2 暂无 isTitle 概念) |
| **vocab-highlight-plugin.ts**(in learning/) | ❌ | 词汇高亮(KRIG 学习系统) |

**V2:10 / 24**(plugins 缺口最大,主要是 KRIG 业务相关:thought / frame / from-page / 等 + 几个常规缺:indent / paste-media / heading-collapse / note-link-command)

---

## 4. components(UI 组件)

| V1 component | V2 状态 |
|---|---|
| FloatingToolbar | ✅ V2 用 floating-toolbar registry + floating-toolbar-content.ts |
| ContextMenu | ✅ V2 用 context-menu registry |
| HandleMenu(⋮⋮ 菜单) | ✅ V2 用 handle-menu registry + handle-menu-content.ts |
| SlashMenu | ✅ V2 用 slash registry + slash-menu-content.ts |
| LinkPanel | ✅ L5-B3.4(views/note/link-panel/) |
| ColorPicker | ✅ L5-B3.4(views/note/color-picker/) |
| FramePicker | ❌ frame-block 没迁 |
| NoteLinkSearch | ❌ 双链选择(`[[` 触发) |
| AskAIPanel | ❌ 选中文字 → ask AI 面板 |
| icons.tsx | ⚙️ V2 各处嵌入 SVG,未集中 |
| NoteEditor.tsx | ⚙️ V2 走 driver Host 模式,组件级简化 |
| NoteView.tsx | ✅ V2 同名 |

---

## 5. commands(业务命令)

V1 `commands/` 共 7 个文件 ~700 行。

| V1 command | V2 状态 |
|---|---|
| editor-commands.ts(基础)| ✅ V2 走 commandRegistry + textEditingDriverApi |
| set-text-block-level.ts | ✅ V2 turnInto 系列 |
| selection-cache.ts | ⚙️ V2 selection capability 替代,部分行为可能不全 |
| selection-to-markdown.ts | ❌ **选中内容导出为 markdown(复制 / 分享场景)** |
| ask-ai-command.ts | ❌ AI 集成命令(选区 + AskAIPanel) |
| frame-commands.ts | ❌ frame-block 没迁 |
| thought-commands.ts | ❌ thought mark 没迁 |

---

## 6. converters(序列化层)

V1 `converters/` 共 10 个文件 ~1500 行,处理 PM doc ↔ Atom[] (KRIG 内部格式) 互转。

| V1 converter | V2 状态 |
|---|---|
| registry.ts / converter-types.ts | ❌ V2 直接 PM JSON,没有 Atom 中间层 |
| text-block-converter.ts | ❌ 不需要 |
| list-converter.ts | ❌ 不需要 |
| container-converters.ts | ❌ 不需要 |
| render-block-converters.ts | ❌ 不需要 |
| math-visual-converter.ts | ❌ math-visual 没迁 |
| inline-utils.ts | ❌ marks ↔ atom marks |

**V2 决策**:不引入 Atom 中间层,直接用 PM doc JSON 持久化(`DriverSerialized` 信封)
+ md-to-pm 单向转换。这是 V2 跟 V1 的架构差异之一,**整个 converters 模块不迁**。

---

## 7. paste(粘贴系统)

V1 `paste/` ~1500 行:smart-paste-plugin / html-to-markdown / internal-clipboard / sources/generic.ts。

| 功能 | V2 状态 |
|---|---|
| 内部复制粘贴(PM 自带) | ✅ |
| 粘贴外部 markdown | ❌ |
| 粘贴外部 HTML | ❌(浏览器 PM 默认走 parseDOM,基础工作) |
| 粘贴 base64 图 | ❌ paste-media plugin 没迁 |
| **smart-paste**(识别来源:GitHub / Notion / Google Docs 等智能转换)| ❌ V1 复杂 |

---

## 8. help-panel(辅助面板)

V1 `help-panel/` 共 11 个文件 ~1792 行:

| 面板 | 内容 | V2 状态 |
|---|---|---|
| help-panel-core | 基础设施 | ❌ |
| latex/ | LaTeX 速查参考 | ❌ L5-B3.6 已知限制留 |
| mermaid/ | Mermaid 图速查 | ❌ |
| math-visual/ | math-visual 编辑器辅助 | ❌ |
| bookmarks/ | 书签面板 | ❌ |

V2 有 **popup registry**(L5-B3.4 引入),后续 help-panel 接 popup registry 是路径。

---

## 9. learning(学习系统)

V1 `learning/` ~600 行:vocab-highlight-plugin / dictionary-panel — 词汇高亮 + 字典查询。
KRIG 业务特性,**整个模块未迁**。

---

## 10. ai-workflow(AI 集成入口)

V1 `ai-workflow/`:blocks-to-pm-nodes.ts / sync-note-receiver.ts —
跟 AI Web View 双向同步,接收 AI 对话写入 note。

V2 状态:**❌ 未迁**,等 L5-B4.3.2 / L5-B4.3.3 一起做(本来就在路线里)。

---

## 11. toc(目录)

V1 `toc/`:toc-indicator.ts + toc.css ~150 行。

V2 状态:**❌ 未迁**(右侧目录指示器,标题导航)。

---

## 12. main(主进程 IPC)

V1 `main/` ~600 行:14 个 ipc handlers(NOTE_CREATE / NOTE_SAVE / NOTE_LIST / NOTE_DELETE / NOTE_RENAME / NOTE_MOVE_TO_FOLDER / NOTE_SAVE_LAST_VIEW / NOTE_SAVE_BOOKMARKS / SET_ACTIVE_NOTE / SET_EXPANDED_FOLDERS / 等)。

V2 状态:**架构上不需要**(单 React tree,note 模块是 renderer module + localStorage 持久化,直接调函数,无 IPC)。**已天然迁完**。

---

## 13. navside(笔记列表面板)

| 功能 | V2 状态 |
|---|---|
| 笔记列表 | ✅ views/note/nav-side-content.tsx |
| 文件夹树 | ✅ folder-store.ts |
| 拖拽 / 多选 / 复制粘贴 | ⚙️ 基础有,边界 case 待验 |
| 排序 / 重命名 / 移动 | ✅ |
| **search**(笔记内容搜索)| ❌ 未迁 |
| **bookmarks**(书签)| ❌ 留 help-panel 一起做 |

---

## 14. 综合统计

| 维度 | V2 完成度 |
|---|---|
| Block 节点 | 16 / 23(70%) |
| Mark | 8 / 9(89%) |
| 核心 plugins(常规交互) | 10 / 24(42%) |
| 标准 UI 组件 | 7 / 12(58%) |
| 业务 commands | 2 / 7(29%) |
| Paste 系统 | 1 / 5(基础)|
| Help-panel | 0 / 5 |
| Learning(KRIG 业务) | 0 / 1 |
| AI workflow | 0 / 1 |
| TOC | 0 / 1 |
| **整体** | **~50-60%** |

**V2 注意点**:
- converters / main IPC / smart-paste sources(GitHub 等)等 V1 路径在 V2 架构下**不需要**,实际待补的"用户可见功能"比 50% 看上去要少
- 缺口主要是 **KRIG 业务特性**(thought / frame / from-page / learning / ai-workflow)+ **常规 UX 增强**(indent / paste-media / heading-collapse / TOC / help-panel)

---

## 15. 推荐优先级(按"价值 + 阻塞")

### Phase B — note 完整化主线(高优)

**B1. note-link 双链系统**(KRIG 核心,知识图谱基础)
- note-link block + `[[` slash trigger + NoteLinkSearch 组件
- ~600 行(V1 估)
- ⭐⭐⭐⭐⭐

**B2. paste-media plugin**(粘贴图片自动 mediaPutBase64)
- ~150 行,L5-B4.3.1 已有底层 API,只缺 plugin
- ⭐⭐⭐⭐

**B3. heading-collapse plugin**(标题折叠下方内容,常用)
- ~200 行
- ⭐⭐⭐⭐

**B4. file-block / file-link / external-ref**(剩余 ❌ 节点)
- 一组三件,~400 行
- ⭐⭐⭐⭐

**B5. selection-to-markdown**(选中内容复制为 markdown)
- ~200 行
- ⭐⭐⭐

**B6. indent plugin + text-block.attrs.indent UI**
- ~150 行
- ⭐⭐⭐

**B7. TOC(目录指示器)**
- ~200 行
- ⭐⭐⭐

### Phase C — Phase A/B sub-stage 补齐

- **L5-B3.7.1** table cell context-menu / floating-toolbar 集成
- **L5-B3.7.2** SlashItem visibleWhen(cell 内 slash 上下文)
- **L5-B3.6.1** LaTeX 速查面板(help-panel 主框架 + latex 数据)

### Phase D — KRIG 业务特性(留后续)

- thought view + thought mark + thought-plugin
- frame view + frame-block + FramePicker + frame-commands
- learning 系统(vocab-highlight + dictionary)
- AskAIPanel + ask-ai-command(等 L5-B4.3 AI 闭环)
- ai-workflow sync-note-receiver(L5-B4.3.3 时一起)
- column-list / html-block / tweet / audio / video(常规 block 进阶批)

### Phase E — 整体优化

- code-block CodeMirror 6 升级(阻塞分支)+ code-plugins(html/js/md/mermaid 高亮)
- math-visual 完整模块
- smart-paste sources(GitHub / Notion 等)
- help-panel 全套(latex / mermaid / math-visual / bookmarks)
- 笔记内容全文搜索

---

## 16. 我的建议

**短期(下一阶段)**:推 **Phase B1-B4**(note-link / paste-media / heading-collapse / file-block 系列),解决"用户每天写 note 高频缺陷",~1500 行,5-7 个 sub-stage。

**中期**:Phase C(table sub-stage 收尾)+ Phase B5-B7。

**长期**:Phase D / E 跟 L5-B4.3 AI 闭环 / 后续业务一起规划。

**建议先做 B1 note-link**,这是 KRIG 知识图谱基础能力,缺了 note 闭环不完整。
