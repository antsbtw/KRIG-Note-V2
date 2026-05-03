# AI ↔ Note 协作流程设计

> 创建日期：2026-04-13
> 当前分支：`experiment/web-content-extractor`
> 状态：设计完成，待实施
>
> 本文档只定义**行为和边界**，不含代码。实施前按 §9 顺序分步进行，每步单独
> 可交付、可验证。

---

## 1. 目标

让 AI work mode 下的「AI 聊天 → Note 记录」流程自然、可控、不打扰用户：

- 不再强制给用户创建新 note（避免 note 列表被一次性消息污染）
- 支持**实时同步**（边聊边记）和**手动提取**（回头挑选有价值的段落）两种模式
- 粘贴、滚动、光标等细节都贴近用户直觉
- 三种 AI 服务（Claude / ChatGPT / Gemini）行为一致

---

## 2. 整体工作流

```
┌──────────────────────────────────────────────────────────────────┐
│  进入 AI work mode                                                │
│                                                                   │
│  ┌─────────────────────┐       ┌─────────────────────────────┐   │
│  │  AI WebView（左）   │ ────▶ │  Note View（右）             │   │
│  │                     │       │                             │   │
│  │  [☐ 实时同步]       │       │  打开 lastActiveNoteId       │   │
│  │  右键 assistant msg │       │  └─ 不存在 → updatedAt 最新  │   │
│  │  自动滚动跟随       │       │      └─ 无笔记 → 空态 [+ 新建]│   │
│  │  ↓ 跳到最新         │       │  工具栏：[打开] [+ 新建]     │   │
│  └─────────────────────┘       └─────────────────────────────┘   │
│                                                                   │
│  所有提取路径最终都调：                                            │
│  insertTurnIntoNote(userText, assistantMarkdown)                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Note 自动打开逻辑

### 3.1 选择策略

进入 AI work mode 时按顺序尝试：

1. **`settings.ai.lastActiveNoteId`**（global 设置，不分 workspace）
   - 存在且 note 未被删除 → 打开
2. **Fallback：`updatedAt` 最新的 note**
   - 有 note → 打开
3. **Fallback：空态**
   - 显示 `还没有笔记` + `[+ 新建笔记]` 大按钮
   - 点击按钮 → 创建 title 为空串的新 note → 打开

### 3.2 `lastActiveNoteId` 的维护

每次用户**在 AI work mode 下切换了 active note**（手动打开其他 note / 新建
note），都更新 `settings.ai.lastActiveNoteId` 为当前 note id。

**不在 AI work mode 下的 note 切换不触发更新** — 用户在 note 管理界面随便
点的不算。

### 3.3 被删除 note 的处理

`lastActiveNoteId` 指向的 note 已被删除 → 静默 fallback 到 updatedAt 最新，
并清空该字段。

### 3.4 Note view 工具栏改动

- `[打开]` 按钮：已有（打开文件选择）
- `[+ 新建]` 按钮：**新增**，创建空标题 note 并打开
- 空态界面：居中文字 + 大 `[+ 新建笔记]` 按钮

---

## 4. 提取核心：`insertTurnIntoNote`

三种提取路径（实时同步、右键提取、未来可能的其他触发）最终都调这个函数。

### 4.1 输入

```ts
{
  userText: string;           // 用户问的那句话
  assistantMarkdown: string;  // AI 的完整回复（已合并所有格式）
  source?: {                  // 可选元数据，不落入 note 文本
    serviceId: 'claude' | 'chatgpt' | 'gemini';
    conversationUrl?: string;
    timestamp?: number;
  };
}
```

### 4.2 产出格式

插入到 note 的文本固定为：

```markdown

> 用户问：{userText}

{assistantMarkdown}

```

前后各一个空行，保证和原有内容不挤在一行。

### 4.3 插入位置

1. Note editor 有焦点且记得 cursor → **光标位置插入**
2. 从未 focus 过 / cursor 不可用 → **append 到 note 末尾**
3. 插入完成后光标停在插入内容末尾（便于继续编辑）

### 4.4 更新状态

- `lastActiveNoteId` 已是当前 note → 不变
- 若不是 → 插入前**不切换 note**（用户可能正在别的 note，不能偷偷换）
- 提取后不自动保存 —— 走 editor 正常的 auto-save 机制

---

## 5. 模式 A：实时同步

### 5.1 开关

- **位置**：AI WebView 工具栏（与提取源逻辑就近）
- **控件**：`☐ 实时同步` 复选框
- **默认**：关
- **持久化**：每个 service profile 独立记忆（Claude 开了不影响 ChatGPT）

### 5.2 触发时机

- 开关打开 + 检测到 assistant message streaming 结束
- 信号来源：现有 SSE hook / conversation API polling（各 service 已有）
- 每轮只插入一次，用 `lastSyncedTurnId` 去重

### 5.3 格式

完全走 `insertTurnIntoNote` —— 用户问 + AI 回答，前后空行。

### 5.4 边界

- 如果当前 note 正在被用户编辑（typing mid-word），**等用户停止输入 500ms 后**再插入，避免打断
- 如果 note view 根本没打开（用户关了右侧 slot），**暂停同步**并在 AI webview 工具栏上给开关加一个 `⏸` 警示，告诉用户同步被阻塞
- 插入失败（note 被删等）→ 关闭开关 + 提示

---

## 6. 模式 B：右键提取

### 6.1 触发

- 在 AI WebView 内任意 assistant message 上右键
- 弹出菜单（替换浏览器默认菜单）
  - `📥 提取到笔记` ← 主要选项
  - `复制链接`, `检查元素` 等可选保留（看实现成本）

### 6.2 提取粒度

**整条 message**：用户的一次提问 + AI 的完整回复作为一个自然单位。
这是用户心智上的"一段对话"，也是最容易准确定位的 DOM 结构。

不做「选中段 only」、「单个 DOM 子节点」等精细粒度（v1 范围外）。

### 6.3 定位逻辑

右键时：
1. 向上找最近的 `assistantMessage` 容器（profile selector 已定义）
2. 拿它的 stable id（data-message-id / data-turn-id / etc.）
3. 向前找最近的 `userMessage` 容器，拿其 text
4. 走对应服务的 extractor 拿到 **markdown 原文**（不是 DOM 转 markdown）
   - Claude → conversation API 按 message uuid 定位
   - ChatGPT → conversation mapping 按 id 定位
   - Gemini → turns 按 responseId 定位
5. 调 `insertTurnIntoNote`

### 6.4 菜单注入实现要点

- Webview 加载完成后注入 `contextmenu` 监听脚本
- `e.preventDefault()` 拦截默认菜单
- 通过 IPC 把点击位置 + 命中的 message id 发给 host
- host 用 React 画自定义菜单（位置 = e.clientX / clientY 转 host 坐标）
- 菜单里点 `📥 提取到笔记` → 调提取管线

### 6.5 菜单的边界

- 右键在**用户自己的消息**上 → 不显示 `提取到笔记`（没意义）
- 右键在**非消息区域**（输入框、头像、工具栏）→ 使用浏览器默认菜单
- 只在 assistant 消息或其内部（文本/代码块/图像）右键才弹自定义菜单

---

## 7. 智能粘贴（方案 C + A）

### 7.1 方案 C：Note editor 粘贴 hook（v1 必做）

Note editor 监听 `paste` 事件：
1. 如果 `clipboardData.types` 含 `text/html`
2. 取 HTML → 跑 `htmlToMarkdown`（复用 domToMarkdown 的核心逻辑）
3. 替换默认粘贴行为，插入转换后的 markdown

**作用面**：任何网页复制过来的内容（包括 AI 页面、普通网页、维基百科等），
粘贴时自动保留结构（标题、列表、代码、图像链接）。

**不做**：
- 来源检测 / 提示文案（过度设计）
- 选择性粘贴菜单（v1 不做）

### 7.2 方案 A：AI 页面 copy 时写 Markdown（v2 可选）

AI webview 注入脚本 hook `copy` 事件：
- 将当前 selection 的 DOM 转 Markdown
- 同时写 `text/plain`（Markdown 源码）和 `text/html`（原 HTML）到 clipboard

**收益**：粘贴到任何地方（非 KRIG 的外部编辑器）都能拿到 Markdown。

**为什么放 v2**：方案 C 单独已经覆盖粘贴到 KRIG 的所有场景，A 是锦上添花。

---

## 8. 自动滚动 — 不做

### 8.1 最初的担心

Electron webview 中 AI 回复过长时看起来"滚动不到位"，怀疑 `<webview>`
和原生 Chrome 的行为有差异。基于这个假设最初设计了 autoscroll agent
+ 浮动"↓ 跳到最新"按钮。

### 8.2 实际验证结论

对比了同样版本的 ChatGPT 在：
- 系统 Chrome 直接打开 `chatgpt.com`
- KRIG 的 `<webview>` 里打开

两者行为**完全一致**：AI 生成完回复后，最后一段停在视口中上部，
输入框下方留出 300–400px 空白。这是 **ChatGPT/Claude 刻意的 UX 设计**：

- 长 AI 消息的末尾自然有"继续阅读"的空间
- 输入框固定在视口底部，用户回复新消息时旧消息末尾位于视口中部
- streaming 时最新 token 显示在屏幕中上部而非被推到边缘

Claude 也是同样模式（空白区域可能略大）。

### 8.3 决策：撤销 Step 3，相信原生行为

不做任何 autoscroll 干预。`<webview>` 就是一个嵌入的 Chromium，所有
AI 站点的内置滚动逻辑在其中都正常工作；我们"填满空白"反而会打破人家
精心设计的阅读节奏。

相关实现已经 revert（见 git history "revert(autoscroll)…" 提交）。
本设计文档保留本节作为历史记录，避免未来再次误判"需要 autoscroll"。

如果将来发现某个特定 AI 站点的**原生滚动真的失效**（不是视觉习惯不
符，是真的动都不动），那时再单独立项，不要往本节里补代码。

---

## 9. 实施顺序

每步独立可交付，可独立验证，不阻塞下一步。后续步骤依赖 Step 0 的
前置能力，因此 Step 0 必须最先完成。

### Step 0 — 前置：补齐转换层与 Media 存储

**这一步不直接改用户可见的流程**，但后续 Step 4（实时同步）/ Step 5
（右键提取）产出的 markdown 里含 `![](data:...)` / `$...$` / `$$...$$`，
当前 Atom 转换层不识别，直接落入 note 会丢数据。Step 0 补齐两件事：

#### 0.1 `md-to-atoms.ts` / `md-to-pm.ts` 识别三种新语法

| 输入 markdown | Atom 产出 |
|---|---|
| `![alt](src)` 独占一行（块级） | `{ type: 'image', content: { src, alt } }` |
| `![alt](src)` 在段落中 | 同上，但作为 parent `textBlock` 的兄弟节点插入（image 是块级，不能嵌 inline） |
| `$x^2+1$` | textBlock 内嵌 `math-inline` inline element |
| `$$\int ...$$` 独占一行 | `{ type: 'mathBlock', content: { latex } }` atom |

**注意**：
- `src` 是 `data:...` / `http(s)://` / `krig-media://` 都正确处理
- math 的 `$` 分隔符要避免误伤（如 `$50`） —— 要求两侧非数字，或用更严格的
  `\$([^\$\n]+?)\$` + 负向 lookahead
- 块级 `$$` 要求前后有换行，不能和文本混行

#### 0.2 Media 表启用（方案 A）

**目标**：base64 图像字节不再塞 note `doc_content`，改存 `media` 表。
`image.src` 写成 `krig-media://{mediaId}` 协议。

**组件：**

1. **Media store**（main 进程）
   - 新模块 `src/main/storage/media-store.ts`
   - API：
     ```
     mediaStore.put(base64: string, mimeType: string) → { mediaId, size, sha256 }
                   // 同内容去重：先按 sha256 查 existing
     mediaStore.get(mediaId) → { base64, mimeType, size } | null
     mediaStore.delete(mediaId)
     mediaStore.list({ limit, offset })
     ```
   - SurrealDB `media` 表 schema（扩展现有预留）：
     ```
     id          — mediaId
     sha256      — 内容哈希，用于去重
     mime_type
     size_bytes
     data        — base64 字符串
     created_at
     ```

2. **Custom protocol handler**（main 进程）
   - 注册 `krig-media://` scheme
   - `request.url` 解析成 `mediaId` → 查 media 表 → 返回字节 + mime header
   - webContents 里 `<img src="krig-media://abc123">` 直接渲染

3. **转换层自动上传**
   - `md-to-atoms.ts` 解析到 `![](data:...)` 时：
     - 调 `mediaStore.put(base64, mimeType)` → 拿 `mediaId`
     - atom 的 `src` 存 `krig-media://{mediaId}`
   - `md-to-atoms.ts` 解析到 `![](http://...)` 时：`src` 直接存原 URL（不入库）
   - `md-to-atoms.ts` 解析到 `![](krig-media://{id})` 时：直接透传

4. **旧数据兼容**
   - 现有 `image.src` 里的 data URL 不迁移，image block 渲染时 `src` 支持三种：
     `krig-media://` / `data:` / `http(s)://`
   - 后续如果要批量迁移，写一个独立 script，不影响 Step 0 交付

#### 0.3 IPC

- 转换器是 main-进程代码，可以直接访问 media-store；**不需要新 IPC**
- renderer 只消费 `<img src="krig-media://...">`（已工作）

#### 0.4 验收

- 把一份含 `![](data:image/png;base64,iVBORw...)` 和 `$e^{i\pi}+1=0$` 的
  markdown 喂给 `md-to-atoms.ts`
- 产出 atoms 包含正确的 image atom（src 是 `krig-media://...`）、mathInline、mathBlock
- `media` 表新增一条记录
- 把 atoms 转回 ProseMirror 文档加载到 note view，图像和公式都正确渲染

#### 0.5 已知债务

- 未实现 media 垃圾回收（note 删除后 media 是否清理？v1 暂不处理，留待日后）
- 未实现跨设备同步（KRIG 目前本地应用，暂不考虑）
- 未实现 media 引用计数（同一张图被多个 note 引用的情况由 sha256 去重自然解决，
  但不记引用数所以无法安全 delete）

---

### Step 1 — 改进 Note 自动打开逻辑
- 文件：`AIWebView.tsx` 里 sync mode 的自动创建逻辑 + Note view 空态 UI
- 依赖：`settings` 存储接口
- 范围：§3 全部
- 验收：进 AI mode → 打开上次的 note；删了 note 进入 → 打开最新；空仓库进入 → 看到空态

### Step 2 — 智能粘贴（方案 C）
- 文件：note editor 的 paste handler + 新模块 `html-to-markdown-paste.ts`
- 依赖：`domToMarkdown` 或独立的 `htmlToMarkdown`
- 范围：§7.1
- 验收：从网页 copy 富文本 → 粘贴到 note → 保留结构

### Step 3 — 自动滚动（已撤销）
- 决策：`<webview>` 行为和 Chrome 一致，AI 站点原生的滚动逻辑已经
  合理；不做任何 autoscroll 干预。
- 范围：§8。详情见该节。

### Step 4 — 实时同步重构（模式 A）
- 文件：新模块 `insert-turn.ts`（核心插入器）+ 重构现有 sync-driver
- 依赖：Step 0 的转换层（识别 image/math）+ Step 1 的 lastActiveNoteId
- 范围：§4 + §5
- 验收：开启开关 → AI 回复完（含 LaTeX、图像、代码块）→ 自动插入 note 光标位置，
  各类内容都正确渲染；关闭 → 不同步；note 被删 → 友好降级

### Step 5 — 右键提取（模式 B）
- 文件：新模块 `context-menu-extract.ts` + webview 注入脚本
- 依赖：Step 0 的转换层 + Step 4 的 `insertTurnIntoNote` + 各 service 的 extractor
- 范围：§6 全部
- 验收：右键 Claude/ChatGPT/Gemini 任意 assistant message → 菜单弹出 → 点提取 → 插入
  note；插入的图像、LaTeX、代码、表格全部正确渲染

---

## 10. 不做的事（v1 范围外）

- 右键选中段精细提取（用户明确说整条即可）
- 整对话全量同步（用模式 A 即可）
- 粘贴来源提示文案（用户明确不要）
- per-workspace lastActiveNoteId（global 即可）
- 在 note 里显示 AI 服务 favicon / 时间戳等装饰
- 双向同步（note 改了同步回 AI）— 属于 module 5 范畴
- 对话搜索 / 历史筛选 — 属于 AI webview 自身 UI，不在本设计范围

---

## 11. 术语

| 术语 | 定义 |
|---|---|
| turn / 对话段落 | 一对 user 问 + assistant 答，是本设计的最小提取单元 |
| lastActiveNoteId | 用户上次在 AI work mode 下激活的 note id |
| near-bottom | scroll container 距底部 < 300px |
| streaming_active | 有 assistant message 正在 SSE/API 流式生成 |
| insertTurnIntoNote | 所有提取路径共用的插入核心函数 |
