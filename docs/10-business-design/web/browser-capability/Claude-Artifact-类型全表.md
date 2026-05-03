# Claude Artifact 类型全表

> 文档类型：参考文档  
> 创建日期：2026-04-19 | 版本：v1.0  
> 数据来源：Claude conversation API 实际响应分析  
> 目的：确保所有 artifact 类型都有明确的处理方案，不遗漏

---

## 一、Artifact 来源分类

Claude conversation API 中的 artifact 来自以下几个位置：

```
chat_messages[].content[]
  ├── type: 'tool_use'          → tool 调用（主要 artifact 来源）
  ├── type: 'tool_result'       → tool 执行结果
  │   └── content[].type: 'local_resource'  → sandbox 文件引用
  ├── type: 'text'              → 纯文本（非 artifact）
  └── type: 'image'             → AI 生成的图片

chat_messages[].attachments[]   → 用户上传的附件
chat_messages[].files[]         → 用户上传的文件
```

---

## 二、Tool Use 类型全表

### 2.1 `visualize:show_widget` — SVG / HTML 交互图表

| 字段 | 说明 |
|------|------|
| `input.widget_code` | 完整的 SVG 或 HTML 源码 |
| `input.title` | artifact 标题 |
| `input.loading_messages` | 加载时的提示文本 |

**内容自包含**：✅ `widget_code` 包含完整渲染代码

**当前处理状态**：

| 子类型 | 检测方式 | 输出格式 | 状态 |
|--------|---------|---------|------|
| SVG 图表 | `widget_code` 含 `<svg` | `![title](media://images/xxx.svg)` → image block (SVG 路径) | ✅ 已完成已测试 |
| HTML 交互页 | `widget_code` 含 `<div`/`<style` | `!html[title](media://files/xxx.html)` → html-block | ✅ 已完成已测试 |

**SVG 预处理**（`prepareSvgForDom`）：
- xmlns 注入
- onclick 移除（含未转义引号，会破坏 XML）
- CSS 变量替换为 Claude 暗色主题值
- `<style>` 注入 Claude CSS 类（.ts/.th/.c-gray/.c-amber 等）

---

### 2.2 `visualize:read_me` — Widget 依赖声明

| 字段 | 说明 |
|------|------|
| `input.modules` | widget 使用的 JS 模块列表 |

**内容自包含**：⏭ 配合 `show_widget` 使用，本身无可视内容

**当前处理状态**：⏭ 跳过（不是独立 artifact）

---

### 2.3 `create_file` — 创建文件

| 字段 | 说明 |
|------|------|
| `input.file_text` | 文件的完整文本内容 |
| `input.path` | 文件路径（如 `/mnt/user-data/outputs/xxx.html`） |
| `input.description` | 文件描述 |

**内容自包含**：✅ `file_text` 包含完整文件内容

**当前处理状态**：

| 文件类型 | 输出格式 | 状态 |
|---------|---------|------|
| `.html` / `.htm` | `!html[title](media://files/xxx.html)` → html-block | ✅ 已完成已测试 |
| `.md` | 纯文本插入 | ✅ 已完成未测试 |
| `.txt` | 纯文本插入 | ✅ 已完成未测试 |
| `.py` / `.js` / `.ts` | `` ```lang `` 代码块 | ✅ 已完成未测试 |
| `.json` / `.csv` | `` ```json/csv `` 代码块 | ✅ 已完成未测试 |
| `.svg` | 应识别为 SVG → image block | ❌ 未处理（当前走代码块） |

---

### 2.4 `view` — 查看文件

| 字段 | 说明 |
|------|------|
| `input.path` | 文件路径 |
| `input.description` | 描述 |

**内容自包含**：❌ 只有路径引用，无文件内容

**当前处理状态**：⚠️ 输出 `> **title** — artifact 内容不可用`

**改进建议**：改为更友好的提示，如 `> 📄 查看了文件: SKILL.md`

---

### 2.5 `present_files` — 呈现文件列表

| 字段 | 说明 |
|------|------|
| `input.filepaths` | 文件路径数组 |

**内容自包含**：❌ 只有路径列表，无文件内容

**当前处理状态**：⚠️ 输出 `> **toolUseId** — artifact 内容不可用`

**改进建议**：
- 改标题为文件名（从 filepaths 提取）而非 toolUseId
- 输出为文件列表：`> 📎 sandbox 文件: motion_plan.html, script.html`
- 如果对应文件已被下载（download 事件捕获），关联到下载的 storageRef

---

### 2.6 `bash_tool` — 执行 Bash 脚本

| 字段 | 说明 |
|------|------|
| `input.command` | Bash 命令 |
| `input.description` | 描述 |

**内容自包含**：❌ 命令文本有，但执行结果（生成的文件）不在 conversation API 中

**当前处理状态**：❌ 未识别为 artifact

**tool_result 中的关键信息**：
```json
{
  "type": "tool_result",
  "content": [
    { "type": "text", "text": "脚本执行输出..." },
    {
      "type": "local_resource",
      "file_path": "/mnt/user-data/outputs/motion_plan.html",
      "name": "motion plan",
      "mime_type": "text/html",
      "uuid": "f6a1e5d7-..."
    }
  ]
}
```

**`local_resource` 是获取 bash_tool 产出物的关键**：
- `file_path`：sandbox 中的路径
- `mime_type`：文件类型
- `uuid`：文件唯一标识
- 但**没有文件内容**——内容只在 sandbox 中

**获取内容的方式**：
1. 用户在 Claude 页面点击 Download → browser-capability 捕获 download 事件
2. 通过 Claude API 的 download URL（`/api/.../conversations/.../wiggle/download-file?path=...`）主动下载
3. L4 Interaction 自动点击 Claude UI 的下载按钮

**改进路径**（分阶段）：

| 阶段 | 方案 | 说明 |
|------|------|------|
| 当前 | 不识别 | bash_tool 产出物完全不出现在提取结果中 |
| Phase 1 | 识别 local_resource | 从 tool_result 中提取 local_resource，输出为待下载提示 |
| Phase 2 | 关联已下载文件 | 如果 download 事件已捕获同名文件，自动关联 |
| Phase 3 | 主动下载 | 通过 Claude API download URL 或 L4 Interaction 自动获取 |

---

### 2.7 `ask_user_input_v0` — 向用户提问

| 字段 | 说明 |
|------|------|
| `input.questions` | 问题列表 |

**内容自包含**：⏭ 交互型 tool，不产出 artifact

**当前处理状态**：⏭ 跳过

---

### 2.8 `recent_chats` — 检索最近对话

| 字段 | 说明 |
|------|------|
| `input.n` | 检索数量 |

**内容自包含**：⏭ 系统 tool，不产出 artifact

**当前处理状态**：⏭ 跳过

---

## 三、非 Tool 类型的 Artifact

### 3.1 `content[].type === 'image'`

AI 生成的图片（如 Imagen）。

| 字段 | 说明 |
|------|------|
| `url` 或 `asset_pointer` | 图片 URL |
| `content_type` | MIME 类型 |
| `title` | 标题 |

**当前处理状态**：✅ `extractClaudeImageArtifact` 已处理

---

### 3.2 `message.files[]` — 用户上传的文件

| 字段 | 说明 |
|------|------|
| `file_name` | 文件名 |
| `mime_type` | MIME 类型 |
| `file_uuid` | 文件 UUID |
| `thumbnail_url` / `preview_url` | 预览 URL |

**当前处理状态**：✅ `extractClaudeMessageFileArtifacts` 已处理

---

### 3.3 `tool_result.content[].type === 'local_resource'`

bash_tool / present_files 执行后，sandbox 中生成的文件引用。

| 字段 | 说明 |
|------|------|
| `file_path` | sandbox 路径（如 `/mnt/user-data/outputs/motion_plan.html`） |
| `name` | 文件名 |
| `mime_type` | MIME 类型 |
| `uuid` | 文件 UUID |

**当前处理状态**：✅ 已完成（2026-04-19）

- `conversation-query.ts` 的 `extractLocalResources()` 从 `tool_result` 中提取
- `present_files` 自动关联其 `tool_result` 中的 `local_resource`
- `extract-turn.ts` 的 `downloadLocalResource()` 通过 Claude wiggle API 主动下载文件内容

---

## 四、总表：处理状态一览

| # | 类型 | 来源 | 内容可获取 | 处理状态 | Note 中的呈现 |
|---|------|------|-----------|---------|-------------|
| 1 | show_widget (SVG) | tool_use.widget_code | ✅ API 自包含 | ✅ 已完成已测试 | image block (SVG DOM 渲染) |
| 2 | show_widget (HTML) | tool_use.widget_code | ✅ API 自包含 | ✅ 已完成已测试 | html-block (iframe) |
| 3 | create_file (.html) | tool_use.file_text | ✅ API 自包含 | ✅ 已完成已测试 | html-block (iframe) |
| 4 | create_file (.py/.js/.ts) | tool_use.file_text | ✅ API 自包含 | ✅ 已完成未测试 | 代码块 |
| 5 | create_file (.md/.txt) | tool_use.file_text | ✅ API 自包含 | ✅ 已完成未测试 | 纯文本 |
| 6 | create_file (.svg) | tool_use.file_text | ✅ API 自包含 | ✅ 已完成 | SVG image block |
| 7 | AI 生成图片 | content.image | ✅ URL 可下载 | ✅ 已处理 | image block |
| 8 | 用户上传文件 | message.files | ✅ URL 可下载 | ✅ 已处理 | 附件引用 |
| 9 | view (文件引用) | tool_use.path | ❌ 只有路径 | ✅ 已改进 | 显示文件名 |
| 10 | present_files | tool_use.filepaths | ❌→✅ 关联 local_resource | ✅ 已完成 | 文件名列表 + 主动下载 |
| 11 | bash_tool 产出 (local_resource) | tool_result | ✅ Claude API 下载 | ✅ 已完成 | 按类型分流（SVG/HTML/代码块） |
| 12 | downloaded 文件 (.html) | download 事件 | ✅ 本地文件 | ✅ 已完成 | html-block |
| 13 | downloaded 文件 (.svg) | download 事件 | ✅ 本地文件 | ✅ 已完成 | image block |
| 14 | downloaded 文件 (其他) | download 事件 | ✅ 本地文件 | ✅ 已完成 | 附件引用 |
| 15 | read_me (模块声明) | tool_use.modules | ⏭ 配合型 | ⏭ 跳过 | 无需呈现 |
| 16 | ask_user_input | tool_use.questions | ⏭ 交互型 | ⏭ 跳过 | 无需呈现 |
| 17 | recent_chats | tool_use.n | ⏭ 系统型 | ⏭ 跳过 | 无需呈现 |

---

## 五、待办优先级

### 已完成（2026-04-19 更新）

- [x] **#11 bash_tool local_resource 识别**：从 tool_result 提取 + present_files 关联 + Claude API 主动下载
- [x] **#6 create_file .svg 处理**：file_text 内容是 SVG 时走 SVG image block 路径
- [x] **#9 view 提示改进**：标题改为文件名
- [x] **#10 present_files 标题改进**：从 filepaths/local_resource 提取文件名
- [x] **#11 Phase 1-3**：识别 + 关联下载 + 主动下载全部完成

### P1（待测试验证）

- [ ] **#4/#5 create_file 其他类型**：验证 .py/.js/.ts/.json/.csv 等文件类型的代码块输出
- [ ] **#7 AI 生成图片**：验证 Imagen 等图片 artifact 的导入

### P2（增强功能）

- [ ] **Phase E SVG Block**：独立 svg-block 替代 image block 的 SVG 分支
- [ ] **ChatGPT/Gemini adapter**：非 Claude 页面的 artifact 识别

---

## 六、数据统计（来自实际 trace）

基于当前已收集的 conversation 数据：

| tool 类型 | 出现次数 | 占比 |
|-----------|---------|------|
| `bash_tool` | 24 | 33.8% |
| `visualize:show_widget` | 17 | 23.9% |
| `present_files` | 13 | 18.3% |
| `visualize:read_me` | 8 | 11.3% |
| `ask_user_input_v0` | 4 | 5.6% |
| `view` | 3 | 4.2% |
| `recent_chats` | 1 | 1.4% |
| `create_file` | 1 | 1.4% |

**关键发现**：`bash_tool`（33.8%）是最高频的 tool 类型，比 `show_widget`（23.9%）还多。它通常和 `present_files`（18.3%）配合使用，两者合计超过 50%。这意味着**不处理 bash_tool 的产出物，会丢失超过一半的 artifact**。
