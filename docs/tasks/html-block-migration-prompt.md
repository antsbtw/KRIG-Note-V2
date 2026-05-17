# 新对话提示词:V1 → V2 迁移独立 htmlBlock

> 整段复制粘贴给新对话的 Claude(在 V2 工作目录 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2` 启动新对话后)。

---

请把 V1 的独立 `htmlBlock` 节点完整迁移到 V2,**保持它是独立 PM 节点**(name=`htmlBlock`),**不要**并入 codeBlock 的 language=html 路径。

## 为什么独立

V1 `htmlBlock` 的真实数据形态是 **`attrs.src = media://xxx` URL 引用**,源码躺在 mediaStore 里;PM doc 只持有引用,不存源码。这跟 codeBlock(textContent 存源码)是**不同的数据模型**。

并入 codeBlock 会让 PM doc 因 Claude artifact(动辄 500-3000 行 HTML)严重变胖,失去 mediaStore 引用模型的去重 / 引用复制优势。

设计原则上,codeBlock 的角色是 **"code 内容的解释和讨论"**(读 + 高亮 + 复制 + 学习),不是 "运行 / 渲染产物"。运行/渲染产物走 RenderBlock 模型(图、视频、HTML 都是)。

## V1 文件位置

| V1 文件 | 行数 | 作用 |
|---|---|---|
| `src/plugins/note/blocks/html-block.ts` | 331 | 完整实现 — htmlBlock 节点 + NodeView + 工具栏 |
| `src/plugins/note/blocks/render-block-base.ts` | ~300+ | RenderBlock 基类(toolbar + placeholder 模板) |
| `src/plugins/note/blocks/claude-theme.ts` | — | Claude CSS variables 注入(html-block + image 都用) |
| `src/plugins/note/blocks/index.ts:31,84` | 注册点 | `import { htmlBlockBlock } from './html-block'` |

V1 路径绝对路径:`/Users/wenwu/Documents/VPN-Server/KRIG-Note/src/plugins/note/blocks/html-block.ts`

## V2 现状(任务起点)

- **V2 没有 V1 的 `render-block-base.ts` 抽象**。V2 的 audioBlock / image / videoBlock 各自手写 NodeView,不复用基类。**迁 html-block 时不要照搬基类,改成跟 V2 同款裸 NodeView。** 参考样板:[src/drivers/text-editing-driver/blocks/audio-block/node-view.ts](../../src/drivers/text-editing-driver/blocks/audio-block/node-view.ts)(placeholder 两态 + mediaStore 上传 + caption contentDOM 模式)
- **V2 atom-serializer 已为 htmlBlock 预留占位**:`src/lib/atom-serializers/svg/index.ts:202` 有 `case 'htmlBlock': return '[HTML]'`。说明类型系统对 htmlBlock 名字已认识,但运行时 spec 没注册。
- **mediaStore 已有 V2 capability**:[src/capabilities/media-storage/](../../src/capabilities/media-storage/),用 `mediaPutBase64(dataUrl, mimeType, filename)` + `mediaDownload(url, kind)`,参考 audio-block / image 用法。
- **artifact pipeline 仍在 V1**(`src/plugins/web-bridge/pipeline/content-to-atoms.ts:290`),**V2 暂未迁这条 pipeline** — 本任务不动 pipeline,只把"块本身"做出来,让用户可以手工 slash 插入 + Upload .html / 粘 URL 走通。
- **claude-theme.ts**:V1 里 html-block + image 都用 `claudeThemeStyleTag()` 注入 CSS 变量。**先查 V2 是否已迁** (`grep -rn claudeTheme src`),已迁就复用,没迁就跟 image 用同一路径迁(放 `src/drivers/text-editing-driver/blocks/_shared/` 或同级)。

## 任务范围

**仅做"独立 htmlBlock NodeView 迁移"**:

1. spec 注册:`src/drivers/text-editing-driver/blocks/html-block/spec.ts`
   - id: `htmlBlock`
   - attrs: `src` / `title` / `height` / `sandbox`(默认 `'allow-scripts'`,对齐 V1)
   - content: V1 是 `'textBlock'`(caption);V2 audio-block 用 `'paragraph'` 作 caption。**先看一下 V2 schema 内 textBlock / paragraph 哪个更合适** —— 参考 audio-block 现状即可。
   - parseDOM / toDOM 对齐 V1
2. NodeView:`src/drivers/text-editing-driver/blocks/html-block/node-view.ts`
   - 两态:placeholder(无 src)+ 渲染(有 src)
   - 加载 HTML:`loadHtmlContent` 函数从 V1 直迁(支持 `data:text/html;base64,` + `fetch` + XHR 兜底覆盖 `media://`)
   - iframe sandbox + srcdoc(注入 claude-theme + 高度上报脚本)
   - 高度自适应:postMessage 监听 + 用户拖拽 handle(对齐 V1)
   - 工具栏:`{ }` 查看源码 / `↗` 新窗口打开
3. 注册 BlockSpec 到 driver:`src/drivers/text-editing-driver/blocks/index.ts`(或 spec 列表的相应位置 — 跟 audio-block 同样的方式)
4. slash menu 加 "HTML Preview" 项:
   - 注册命令 `text-editing.slash-insert-html-block`:`src/capabilities/text-editing/commands/register-pm-commands.ts`(参考 `slash-insert-mermaid-block`)
   - 加 slash menu 项:`src/capabilities/text-editing/ui/slash-menu/items.ts`(图标 🌐 / keywords html web preview 网页)
   - driver 暴露 `insertHtmlBlockAtSelection`:`src/drivers/text-editing-driver/api.ts`(参考 `insertMermaidBlockAtSelection`)
5. CSS:V1 的 `html-block__*` 类不在 V2 任何 CSS 里 — 迁到 `src/drivers/text-editing-driver/pm-host.css`(或独立 css 文件;参考 mermaid 现状)
6. atom-serializer:`src/lib/atom-serializers/svg/index.ts` 已有 `htmlBlock` case 返回 `[HTML]`,够用;**不动**

## 不在范围内

- ❌ artifact pipeline 迁移(`web-bridge` / `browser-capability`)— 那是 separate 大工程,本 PR 只做"块本身"
- ❌ 把 codeBlock language=html 也接 inline preview — 本任务不并 codeBlock,html 独立 block
- ❌ V2 image-block 与 V1 image 的同步对照(image 已迁 V2)
- ❌ html 编辑器(全屏)— htmlBlock 不提供"编辑源码"全屏体验;源码只读(查看源码按钮);要改源码用户在 mediaStore 外部改后重传

## 硬约束(对齐项目 memory)

1. **V2 是工作目录**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)。所有 cwd 敏感命令(git / npm / find / rm 等)每次 Bash 调用都要显式 `cd /...V2`,**绝不能跑到 V1**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note`)。memory: `feedback_v2_is_workspace_v1_is_reference`
2. **分支策略**:从 main 切 `feature/html-block-migration`;commit 多个无所谓,**合 main 必须用户显式授权**。memory: `feedback_merge_requires_explicit_ok`
3. **绝不主动 push**。任何 `git push` 都要等用户显式指令。
4. **每次 commit 后给"请验证"测试清单**,含可执行的逐项测试(操作 + 期望结果),不只是 "npm start 跑起来看看"。memory: `feedback_implementation_test_checklist`
5. **遇到 doc 没说清的决策(content schema / sandbox 默认 / 高度上限 / placeholder 文案 / CSS 类位置等)必须先停下问,不自作主张**。memory: `feedback_strict_compliance_workflow`
6. **`sandbox="allow-scripts"` 不开 `allow-same-origin`**(对齐 V1)。iframe 内无法访问 parent cookie / storage,但 `<script>` 可执行 + 可外发 `fetch`。这是 V1 选定的信任模型,本任务沿用。
7. **代码风格 / 注释纪律**:V2 的 CLAUDE.md + `feedback_strict_compliance_workflow` — 不要写多行注释,不要写不必要的 doc 文件,严格交付。
8. **完成后** 给一份"迁移完成 + 行为对照表 V1 ↔ V2"的总结,标注哪些等价、哪些有意识地改了(比如基类不复用、CSS 类名前缀变化等)。

## 验收(每 commit 前必跑)

- `npm run typecheck` 全绿
- `npm run lint` 全绿(`--max-warnings 0`)
- `npm start` 启动正常
- 手工测试:
  - slash → HTML Preview → 插入空 htmlBlock(placeholder 状态)
  - placeholder Upload `.html` → 选本地 HTML 文件 → mediaStore 存进去 → 渲染为 iframe(显示页面)
  - placeholder Embed → 粘 URL(http / https / media:// / data:text/html;base64,...)→ 渲染
  - 渲染态 toolbar `{ }` → 切到源码视图 → 再点切回预览
  - 渲染态 toolbar `↗` → 新窗口打开
  - 用户拖底部 handle → iframe 高度变化 → 持久化到 attrs.height(reload note 仍是新高度)
  - postMessage 自适应:iframe 内 D3/Chart.js 等动态内容增高 → iframe 跟着长
  - caption 区(figcaption / paragraph)可编辑文字,与 PM 其他 block 一致

## 工作流建议

1. **先读 V1 完整 html-block.ts**(331 行) + V2 audio-block / image NodeView(找一个"V2 同型样板")
2. **先 grep 三个东西**:`claudeTheme` 在 V2 是否已迁;`htmlBlock` 在 V2 已有的痕迹(atom-serializer + 别处);`textBlock` vs `paragraph` 哪个是 V2 schema 内的有效 caption content
3. **建分支 + spec.ts 先行**:让 schema 注册先通(typecheck 全绿)再写 NodeView
4. **NodeView 分块写**:placeholder → 渲染态 → toolbar → 高度自适应 → destroy cleanup;**每块写完一次 typecheck**
5. **CSS 单独 commit**:迁完功能再加样式,避免功能 + 样式混在一个大 diff
6. **每次 commit 后**:给测试清单 → 用户测过 → 下一步

## 参考已有 memory(新对话开头自动加载,本任务相关)

- `feedback_v2_is_workspace_v1_is_reference` — V2 是工作目录铁律
- `feedback_merge_requires_explicit_ok` — 合 main 必须显式授权
- `feedback_implementation_test_checklist` — commit 后给可执行测试清单
- `feedback_strict_compliance_workflow` — 遇 doc 不清就问
- `project_code_block_cm6_done` — 上一个 PR 已合 main df8f13d,本任务**与之独立**,html 不并入 codeBlock 的决定见该 memory 关联讨论

## 一定要确认的事

开干前请回复确认:
- [ ] 我已读完 V1 html-block.ts(331 行)+ V2 audio-block NodeView 作为同型样板
- [ ] 我理解任务范围 — 仅迁块本身,不动 artifact pipeline,不并入 codeBlock
- [ ] 我会在 commit 后给测试清单,合前等用户授权,不主动 push
- [ ] 我会在遇到 doc 没说清的决策时先停下问

如果有任何疑问(content schema / sandbox 默认 / 高度行为细节 / CSS 类位置 / claude-theme 是否已迁),**先问再动手**。

---

(提示词到此结束)
