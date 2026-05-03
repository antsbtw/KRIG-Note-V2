# KRIG-Note 重构实施计划

> 基于 2026-04-09 评估文档，按优先级分 4 阶段实施。

---

## Phase 1: 修复数据丢失问题（Workspace 状态）

### Task 1.1: 恢复 Session 时保留原始 Workspace ID

**文件**:
- `src/main/app.ts` (352-373 行)
- `src/main/workspace/manager.ts` (13, 16-38 行)

**问题**: `workspaceManager.create()` 每次生成新 ID（`ws-${++counter}`），原始 ID 被丢弃。所有绑定到 workspace ID 的状态无法恢复。

**改动**:
1. 在 `WorkspaceManager` 中新增 `restore(state: WorkspaceState)` 方法，直接用原始 ID 插入 map。
2. `app.ts` 中将 `create()` + `update()` 替换为 `restore(ws)`。
3. 恢复后将 `counter` 设为 `max(已有 ID 数字后缀) + 1`，避免后续新建 workspace 时 ID 冲突。
4. `activeWorkspaceId` 直接按 ID 匹配，不再用 index fallback。

**风险**: 低

---

### Task 1.2: 持久化右槽（Right Slot）状态

**文件**:
- `src/main/workspace/manager.ts` (31-34 行)
- `src/main/window/shell.ts` (232, 277, 206, 542-552 行)

**问题**: `WorkspaceState.slotBinding` 字段已定义但从未使用。右面板的 `workModeId` 仅存于 `WorkspaceViewPool.rightWorkModeId`（内存态），切 workspace 或重启即丢失。

**改动**:
1. `openRightSlot()` 时同步写入 `slotBinding.right`。
2. `closeRightSlot()` 时置 `slotBinding.right = null`。
3. `switchLeftSlotView()` 时同步写入 `slotBinding.left`。
4. Session 恢复后，检查 `slotBinding.right` 并调用 `openRightSlot()` 恢复右面板。
5. 恢复前需验证 `workModeRegistry.get(slotBinding.right)` 存在。

**依赖**: Task 1.1（恢复流程修改）
**风险**: 中

---

### Task 1.3: 补全 WORKSPACE_SWITCH 广播字段

**文件**:
- `src/main/ipc/handlers.ts` (80-91 行)
- `src/renderer/navside/NavSide.tsx` (165-168 行)

**问题**: `RESTORE_WORKSPACE_STATE` 广播只发送 `activeNoteId` 和 `expandedFolders`，缺少 `activeBookId`、`ebookExpandedFolders`、右槽状态。

**改动**:
1. 广播 payload 中加入 `activeBookId`、`ebookExpandedFolders`。
2. NavSide 的 `onRestoreWorkspaceState` handler 中增加对应处理逻辑。

**风险**: 低

---

### Task 1.4: navSideWidth 改为按 Workspace 隔离

**文件**:
- `src/main/slot/layout.ts` (28-36 行)
- `src/shared/types.ts`（WorkspaceState 接口）
- `src/main/ipc/handlers.ts` (196-216 行)
- `src/main/storage/session-store.ts`

**问题**: `navSideWidth` 是模块级全局变量，所有 workspace 共用同一宽度。

**改动**:
1. 移除 `layout.ts` 中的全局 `navSideWidth` 及 getter/setter。
2. `WorkspaceState` 接口新增 `navSideWidth: number` 字段。
3. `calculateLayout()` 改为接受 `navSideWidth` 参数。
4. resize handler 中通过 `workspaceManager.update()` 写入当前 workspace。
5. 拖拽过程中用局部变量，仅在 `RESIZE_END` 时写入 workspace（防止高频更新）。

**风险**: 中（注意 resize 防抖）

---

## Phase 2: 打通注册表模式

### Task 2.1: Shell 视图创建改为注册表驱动

**文件**:
- `src/main/window/shell.ts` (54-197 行 `createViewForWorkMode`)
- `src/main/workmode/registry.ts`
- `src/shared/types.ts`（WorkModeRegistration 接口）
- `src/main/app.ts` (33-66 行)

**问题**: `createViewForWorkMode` 内 4 分支 if/else 硬编码 HTML 路径和 WebPreferences。

**改动**:
1. `WorkModeRegistration` 接口新增:
   - `renderer: { devServerUrl?: string; htmlFile: string }`
   - `webPreferences?: Partial<WebPreferences>`
   - `onViewCreated?: (view: WebContentsView, variant?: string) => void`
2. 重构 `createViewForWorkMode`：从 registry 读取配置，统一构造 `WebContentsView`。
3. 各插件注册时补充 `renderer` 字段。

**风险**: 中（extraction 下载拦截器需仔细剥离）

---

### Task 2.2: NavSide 面板动态分发

**文件**:
- `src/renderer/navside/NavSide.tsx` (3-4, 766-802 行)
- 新建 `src/renderer/navside/panel-registry.ts`

**问题**: NavSide 第 4 行直接 `import { WebPanel }`，766-802 行用 `contentType ===` 硬编码条件渲染。

**改动**:
1. 建立 renderer 侧面板注册表: `Map<string, React.ComponentType<PanelProps>>`。
2. 插件自行注册面板组件。
3. NavSide 中用 `panelRegistry.get(contentType)` 动态渲染。
4. 将 `note-list` 内容提取为 `NoteListPanel` 组件并同样注册。
5. 移除 NavSide.tsx 中所有插件直接 import。

**风险**: 低-中

---

### Task 2.3: Extraction 下载逻辑下沉到插件

**文件**:
- `src/main/window/shell.ts` (125-178 行)
- 新建 `src/plugins/web/main/extraction-handler.ts`

**问题**: 53 行 Extraction 专属下载拦截逻辑嵌入通用视图创建函数。

**改动**:
1. 提取为 `setupExtractionInterceptor(guestWebContents)` 函数。
2. 通过 Task 2.1 的 `onViewCreated` hook 注册。

**依赖**: Task 2.1
**风险**: 低

---

## Phase 3: NavSide 拆分 + 主题系统

### Task 3.1: NavSide 组件拆分

**文件**: `src/renderer/navside/NavSide.tsx` (1037 行)

**拆分方案**:
| 提取目标 | 当前行范围 | 输出文件 |
|---|---|---|
| `useWorkspaceSync` | 125-184 | `hooks/useWorkspaceSync.ts` |
| `useNoteOperations` | 204-388 | `hooks/useNoteOperations.ts` |
| `useDragAndDrop` | 390-471 | `hooks/useDragAndDrop.ts` |
| `NoteListPanel` | 475-789 | `panels/NoteListPanel.tsx` |
| styles 对象 | 807-1037 | `navside-styles.ts` |

**目标**: NavSide 本体 < 200 行，回归纯渲染壳。

**风险**: 中（状态耦合紧密，需仔细传递 props/context）

---

### Task 3.2: 建立全局 CSS 变量主题系统

**新建**: `src/shared/theme/tokens.css`

**Token 映射**（从现有硬编码颜色提取）:
```css
:root {
  --krig-bg-base: #1e1e1e;
  --krig-bg-surface: #1a1a1a;
  --krig-bg-elevated: #252525;
  --krig-bg-input: #2a2a2a;
  --krig-bg-hover: #3a3a3a;
  --krig-text-primary: #e8eaed;
  --krig-text-secondary: #999;
  --krig-text-muted: #666;
  --krig-border: #333;
  --krig-border-light: #444;
  --krig-accent: #4a9eff;
  --krig-accent-bg: #264f78;
  --krig-accent-secondary: #c8a96e;
  --krig-danger: #f87171;
}
```

**迁移顺序**:
1. `web.css` → 用 tokens 替换硬编码值
2. `note.css` → 同上
3. NavSide 内联样式 → 迁移到 CSS 文件 + tokens
4. `ebook.css` → 将 `--ebook-*` 变量映射到全局 tokens

**风险**: 低（纯视觉重构，可逐文件推进）

---

## Phase 4: 安全 + 可访问性

### Task 4.1: WebView 弹窗安全加固

**文件**:
- `src/plugins/web/components/WebView.tsx` (141 行)
- `src/plugins/web/components/ExtractionView.tsx` (107 行)

**改动**: 移除 `allowpopups={'true' as any}`，依赖 shell.ts 中已有的 `setWindowOpenHandler` 做域控制。需测试 OAuth 流程。

**风险**: 中

---

### Task 4.2: 消除静默异常吞没

**涉及文件**:
- `WebView.tsx:61` — `catch(() => {})`
- `handlers.ts:832, 1079` — 广播失败静默
- `dictionary-panel.ts:412` — TTS 播放
- `video-block.ts:453, 533, 771` — 视频播放
- `render-block-base.ts:191` — 剪贴板

**改动**: 关键操作改为 `console.warn` + 用户提示；确实可忽略的（音频 play rejection）加注释说明原因。

**风险**: 低

---

### Task 4.3: 数据库凭据配置化

**文件**: `src/main/storage/client.ts` (17-18 行)

**改动**:
1. 首次启动时生成随机密码，存入 `{userData}/.db-credentials`。
2. 后续启动读取该文件。
3. spawn 和 connect 都使用动态凭据。

**风险**: 中（需兼容已有数据库的迁移）

---

### Task 4.4: 基础可访问性补齐

**最小可行改动**:
- NavSide: `role="tree"`/`role="treeitem"` + `aria-expanded` + `aria-selected` + 键盘导航
- WebToolbar: 所有图标按钮加 `aria-label`
- WorkspaceBar: `role="tablist"`/`role="tab"` + `aria-selected`
- Toggle 按钮: `aria-label="Toggle sidebar"` + `aria-expanded`

**风险**: 低

---

## 执行顺序与依赖关系

```
Phase 1（无外部依赖，最先执行）:
  ┌─ Task 1.1 (ID 保留)
  ├─ Task 1.3 (广播补全)     ← 可并行
  ├─ Task 1.4 (navSideWidth)  ← 可并行
  └─ Task 1.2 (右槽持久化)    ← 依赖 1.1

Phase 2（依赖 Phase 1 的 WorkspaceState 变更）:
  ┌─ Task 2.1 (注册表驱动视图)  ← 可并行
  ├─ Task 2.2 (动态面板分发)    ← 可并行
  └─ Task 2.3 (Extraction 下沉) ← 依赖 2.1

Phase 3（Phase 2 NavSide 改动后启动）:
  ┌─ Task 3.1 (NavSide 拆分)
  └─ Task 3.2 (主题系统)    ← 可与 3.1 并行

Phase 4（完全独立，可随时启动）:
  Task 4.1 ~ 4.4 互不依赖，可并行
```

---

## 检查清单

- [ ] **Phase 1**: Task 1.1 — Workspace ID 保留
- [ ] **Phase 1**: Task 1.2 — 右槽状态持久化
- [ ] **Phase 1**: Task 1.3 — 广播字段补全
- [ ] **Phase 1**: Task 1.4 — navSideWidth 按 workspace 隔离
- [ ] **Phase 2**: Task 2.1 — Shell 注册表驱动
- [ ] **Phase 2**: Task 2.2 — NavSide 动态面板
- [ ] **Phase 2**: Task 2.3 — Extraction 逻辑下沉
- [ ] **Phase 3**: Task 3.1 — NavSide 拆分
- [ ] **Phase 3**: Task 3.2 — 全局主题系统
- [ ] **Phase 4**: Task 4.1 — WebView 弹窗加固
- [ ] **Phase 4**: Task 4.2 — 静默异常处理
- [ ] **Phase 4**: Task 4.3 — 凭据配置化
- [ ] **Phase 4**: Task 4.4 — 可访问性补齐
