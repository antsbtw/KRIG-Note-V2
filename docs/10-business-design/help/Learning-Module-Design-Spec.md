# KRIG-Note · 学习模块设计规范

**Design Specification · v1.0 · 2026-04-05**

---

## 一、背景与目标

KRIG-Note 定位为知识管理工具，学习模块为核心差异化功能之一。第一阶段实现**英文查词 + 翻译 + 生词本**，为后续扩展（间隔复习、语境回顾等）打基础。

### 参考来源

基于 mirro-desktop 的 `language-learning/` 模块（已验证），适配 KRIG-Note 架构：

| | mirro-desktop | KRIG-Note |
|---|---|---|
| 存储 | JSON 文件 (`vocabulary.json`) | SurrealDB（已有基础设施） |
| 词典 | macOS Dictionary (Swift) + Google Translate | 同左 |
| 面板 | 独立 DOM，手动注册 help-panel 互斥 | 同左（外部面板模式） |
| 触发 | 右键菜单 → 查词/翻译 | 同左（扩展现有 ContextMenu） |
| 高亮 | ProseMirror Decoration plugin | 同左 |

---

## 二、架构分层

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (Note View)                                    │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ ContextMenu  │  │  Dictionary  │  │ Vocab        │  │
│  │ (查词/翻译   │  │  Panel       │  │ Highlight    │  │
│  │  入口)       │  │  (外部面板)  │  │ Plugin       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         └─────────────────┼──────────────────┘          │
│                           │ window.viewAPI.*            │
├───────────────────────────┼─────────────────────────────┤
│ Preload (view.ts)         │                             │
│  lookupWord / translateText / addVocab / ...            │
├───────────────────────────┼─────────────────────────────┤
│ Main Process              │                             │
│                           ▼                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ IPC Handlers │  │ Dictionary   │  │ Vocabulary   │  │
│  │ (handlers.ts)│  │ Service      │  │ Store        │  │
│  └──────────────┘  └──────┬───────┘  └──────────────┘  │
│                           │                             │
│              ┌────────────┼────────────┐                │
│              ▼            ▼            ▼                │
│        ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│        │ macOS    │ │ Google   │ │ SurrealDB│          │
│        │ Dict     │ │ Translate│ │          │          │
│        └──────────┘ └──────────┘ └──────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 分层原则

| 层 | 职责 | 不可做的 |
|---|---|---|
| **Dictionary Panel** | 纯 UI 渲染 + 用户交互 | 不直接调用 provider，不访问 DB |
| **Preload** | IPC 桥接，暴露 `window.viewAPI` 方法 | 不含业务逻辑 |
| **IPC Handlers** | 请求路由，调用 Service/Store | 不含 UI 逻辑 |
| **DictionaryService** | 编排 provider 查询 | 不持有状态 |
| **VocabularyStore** | 生词本 CRUD（SurrealDB） | 不感知 UI |
| **Providers** | 单一数据源适配 | 不互相调用 |

---

## 三、文件结构

```
src/
├── main/
│   ├── ipc/
│   │   └── handlers.ts                ← 新增 LEARNING_* handler 组
│   ├── preload/
│   │   └── view.ts                    ← 新增 learning API 到 viewAPI
│   └── learning/                      ← 新增：学习模块 Main 进程层
│       ├── dictionary-service.ts      ← Provider 编排
│       ├── vocabulary-store.ts        ← 生词本 SurrealDB CRUD
│       └── providers/
│           ├── macos-dictionary.ts    ← macOS 原生词典
│           └── google-translate.ts    ← Google Translate API
│
├── shared/
│   └── types.ts                       ← 新增 IPC 通道 + 学习模块类型
│
└── plugins/note/
    ├── help-panel/                    ← 已有框架
    │   └── (core, latex, mermaid)
    │
    ├── learning/                      ← 新增：学习模块 Renderer 层
    │   ├── dictionary-panel.ts        ← Dictionary UI（外部面板注册）
    │   ├── vocab-highlight-plugin.ts  ← ProseMirror 生词高亮装饰
    │   ├── types.ts                   ← Renderer 侧类型
    │   └── index.ts                   ← 公共 API 导出
    │
    └── components/
        └── ContextMenu.tsx            ← 修改：新增 查词/翻译 菜单项
```

### 归属原则

- `src/main/learning/` — Main 进程逻辑（service、store、provider）
- `src/plugins/note/learning/` — Renderer 面板 + 编辑器插件
- 不在 `help-panel/` 目录下建 dictionary 子目录，因为 dictionary-panel 是**外部面板**（自建 DOM），只通过 `registerExternalPanel` 参与互斥

---

## 四、类型定义

### 4.1 IPC 通道（添加到 `src/shared/types.ts` 的 `IPC` 常量）

```typescript
// 学习模块
LEARNING_LOOKUP: 'learning:lookup',
LEARNING_TRANSLATE: 'learning:translate',
LEARNING_TTS: 'learning:tts',
LEARNING_VOCAB_ADD: 'learning:vocab-add',
LEARNING_VOCAB_REMOVE: 'learning:vocab-remove',
LEARNING_VOCAB_LIST: 'learning:vocab-list',
LEARNING_VOCAB_CHANGED: 'learning:vocab-changed',  // main → renderer 广播
```

### 4.2 数据类型

```typescript
// src/plugins/note/learning/types.ts

/** 词典查询结果 */
export interface LookupResult {
  word: string;
  definition: string;
  phonetic?: string;       // "/wɜːrd/"
  source: string;          // "macOS Dictionary", "Google Translate"
}

/** 生词本条目 */
export interface VocabEntry {
  id: string;
  word: string;            // lowercase normalized
  definition: string;
  context?: string;        // 查词时的上下文句子
  phonetic?: string;
  createdAt: number;       // timestamp
}

/** Dictionary Provider 接口 */
export interface DictionaryProvider {
  readonly name: string;
  lookup(word: string): Promise<LookupResult | null>;
}
```

---

## 五、Main 进程设计

### 5.1 DictionaryService

```typescript
// src/main/learning/dictionary-service.ts

class DictionaryService {
  private providers: DictionaryProvider[] = [];

  register(provider: DictionaryProvider): void;

  /** 依次尝试 provider，返回第一个成功的结果 */
  async lookup(word: string): Promise<LookupResult | null>;
}

export const dictionaryService = new DictionaryService();
```

初始化时注册 provider 顺序：
1. macOS Dictionary（本地，快）
2. Google Translate（网络，慢，兜底）

### 5.2 VocabularyStore

```typescript
// src/main/learning/vocabulary-store.ts

/** 使用 SurrealDB 存储，复用现有 client.ts */
export const vocabStore = {
  async add(word: string, definition: string, context?: string, phonetic?: string): Promise<VocabEntry>;
  async remove(id: string): Promise<void>;
  async list(): Promise<VocabEntry[]>;
  async has(word: string): Promise<boolean>;
};
```

SurrealDB Schema:
```surql
DEFINE TABLE vocab SCHEMAFULL;
DEFINE FIELD word ON vocab TYPE string;
DEFINE FIELD definition ON vocab TYPE string;
DEFINE FIELD context ON vocab TYPE option<string>;
DEFINE FIELD phonetic ON vocab TYPE option<string>;
DEFINE FIELD created_at ON vocab TYPE int;
DEFINE INDEX idx_word ON vocab COLUMNS word UNIQUE;
```

### 5.3 Providers

**macOS Dictionary** (`macos-dictionary.ts`):
- 调用 macOS CoreServices DCSCopyTextDefinition
- 通过 `child_process.execFile` 执行 Swift 脚本
- 超时 10s，最大输出 1MB

**Google Translate** (`google-translate.ts`):
- 使用 `translate.googleapis.com/translate_a/single` 端点
- 自动检测源语言 → 中文 (zh-CN)
- 同时作为 DictionaryProvider（单词释义）和独立翻译 API（句子翻译）

### 5.4 IPC Handlers

添加到现有 `handlers.ts`，遵循 `ipcMain.handle()` 模式：

```typescript
// ── 学习模块 ──

ipcMain.handle(IPC.LEARNING_LOOKUP, async (_e, word: string) => {
  return dictionaryService.lookup(word);
});

ipcMain.handle(IPC.LEARNING_TRANSLATE, async (_e, text: string, targetLang?: string) => {
  return googleTranslate.translate(text, targetLang);
});

ipcMain.handle(IPC.LEARNING_VOCAB_ADD, async (_e, word, definition, context?, phonetic?) => {
  const entry = await vocabStore.add(word, definition, context, phonetic);
  broadcastVocabChanged(getMainWindow());  // 通知所有 renderer
  return entry;
});

ipcMain.handle(IPC.LEARNING_VOCAB_REMOVE, async (_e, id: string) => {
  await vocabStore.remove(id);
  broadcastVocabChanged(getMainWindow());
  return true;
});

ipcMain.handle(IPC.LEARNING_VOCAB_LIST, async () => {
  return vocabStore.list();
});

ipcMain.handle(IPC.LEARNING_TTS, async (_e, text: string, lang: string) => {
  return googleTranslate.tts(text, lang);
});
```

---

## 六、Preload 设计

扩展现有 `view.ts` 的 `viewAPI`：

```typescript
// 新增到 contextBridge.exposeInMainWorld('viewAPI', { ... })

lookupWord: (word: string) =>
  ipcRenderer.invoke(IPC.LEARNING_LOOKUP, word),

translateText: (text: string, targetLang?: string) =>
  ipcRenderer.invoke(IPC.LEARNING_TRANSLATE, text, targetLang),

playTTS: (text: string, lang: string) =>
  ipcRenderer.invoke(IPC.LEARNING_TTS, text, lang),

addVocabWord: (word: string, definition: string, context?: string, phonetic?: string) =>
  ipcRenderer.invoke(IPC.LEARNING_VOCAB_ADD, word, definition, context, phonetic),

removeVocabWord: (id: string) =>
  ipcRenderer.invoke(IPC.LEARNING_VOCAB_REMOVE, id),

listVocabWords: () =>
  ipcRenderer.invoke(IPC.LEARNING_VOCAB_LIST),

onVocabChanged: (callback: (entries: VocabEntry[]) => void) => {
  const handler = (_: any, entries: VocabEntry[]) => callback(entries);
  ipcRenderer.on(IPC.LEARNING_VOCAB_CHANGED, handler);
  return () => ipcRenderer.removeListener(IPC.LEARNING_VOCAB_CHANGED, handler);
},
```

---

## 七、Renderer 设计

### 7.1 Dictionary Panel（外部面板模式）

```typescript
// src/plugins/note/learning/dictionary-panel.ts

// 自建 DOM，通过 registerExternalPanel 参与 help-panel 互斥
registerExternalPanel('dictionary', () => hideDictionaryPanel());

/** 查词模式：词典释义 + 中文翻译 */
export function showDictionaryPanel(word: string, sentence?: string): void;

/** 翻译模式：句子/段落翻译 */
export function showTranslationPanel(text: string): void;

/** 隐藏面板 */
export function hideDictionaryPanel(): void;

/** 更新生词列表（main → renderer 广播触发） */
export function updateVocabList(entries: VocabEntry[]): void;
```

**两个 Tab**：
- **查词 Tab**：显示词典释义 + 中文翻译 + 音标 + TTS 按钮 + "添加到生词本"按钮
- **生词本 Tab**：可搜索的生词列表，支持删除

**面板位置**：与 help-panel 一致，右侧 360px fixed 面板

**面板样式**：使用 `--help-panel-*` CSS 变量，保持视觉一致

### 7.2 ContextMenu 扩展

扩展现有 `ContextMenu.tsx`，当有文本选中时显示查词/翻译选项：

```typescript
// 在现有 items 数组中动态添加

const { from, to } = view.state.selection;
const selectedText = view.state.doc.textBetween(from, to, ' ').trim();

if (selectedText) {
  const isWord = !/\s/.test(selectedText);
  const contextSentence = /* 获取选区所在段落文本 */;

  if (isWord) {
    items.push({
      id: 'lookup', label: '查词', icon: '📖',
      action: () => { showDictionaryPanel(selectedText, contextSentence); close(); },
    });
  }
  items.push({
    id: 'translate', label: '翻译', icon: '🌐',
    action: () => { showTranslationPanel(selectedText); close(); },
  });
}
```

### 7.3 Vocab Highlight Plugin

```typescript
// src/plugins/note/learning/vocab-highlight-plugin.ts

/**
 * ProseMirror Plugin：在编辑器中高亮生词本中的单词
 * - 黄色虚线下划线（非侵入 Decoration）
 * - Hover 显示 tooltip（释义 + TTS）
 * - 生词本变化时通过 transaction meta 更新
 */
export function vocabHighlightPlugin(): Plugin;

/** 更新生词定义（触发 Decoration 重建） */
export function updateVocabDefs(view: EditorView, entries: VocabEntry[]): void;
```

---

## 八、交互流程

### 8.1 查词流程

```
用户选中单词 → 右键 → "查词"
  → showDictionaryPanel(word, sentence)
    → notifyExternalShow('dictionary')     // 互斥：关闭 LaTeX/Mermaid 面板
    → 并行请求：
        viewAPI.lookupWord(word)           // → main → macOS Dict → 英文释义
        viewAPI.translateText(word)        // → main → Google → 中文翻译
    → 渲染结果：释义 + 翻译 + 音标 + TTS + "添加到生词本"
```

### 8.2 翻译流程

```
用户选中句子/段落 → 右键 → "翻译"
  → showTranslationPanel(text)
    → notifyExternalShow('dictionary')
    → viewAPI.translateText(text)          // → main → Google → 中文翻译
    → 渲染结果：原文 + 翻译
```

### 8.3 添加生词流程

```
用户在 Dictionary Panel 点击 "添加到生词本"
  → viewAPI.addVocabWord(word, definition, context, phonetic)
    → main: vocabStore.add() → SurrealDB INSERT
    → main: broadcastVocabChanged() → 所有 renderer
      → renderer: updateVocabList(entries)       // 更新面板生词本 Tab
      → renderer: updateVocabDefs(view, entries) // 更新编辑器高亮
```

### 8.4 互斥与关闭

Dictionary Panel 作为外部面板参与 help-panel 互斥：

```
打开 Dictionary → notifyExternalShow('dictionary')
  → 如果 LaTeX/Mermaid 面板打开 → 自动关闭

打开 LaTeX 面板（点击 mathBlock）
  → showHelpPanel('latex')
  → 如果 Dictionary 打开 → 调用 hideFn → hideDictionaryPanel()

关闭 Dictionary → notifyExternalHide('dictionary')
```

---

## 九、实施计划

### P2a：Renderer 骨架 + 面板 UI

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `plugins/note/learning/types.ts` | LookupResult, VocabEntry 类型 |
| 2 | `plugins/note/learning/dictionary-panel.ts` | 面板 UI（查词 Tab + 生词本 Tab），mock API |
| 3 | `plugins/note/learning/index.ts` | 导出 |
| 4 | `components/ContextMenu.tsx` | 新增查词/翻译菜单项 |
| 5 | `note.css` | Dictionary Panel 样式 |

**P2a 交付物**：面板可打开/关闭，与 LaTeX/Mermaid 互斥，UI 完整但数据 mock。

### P2b：Main 进程 + Preload

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `shared/types.ts` | 新增 LEARNING_* IPC 通道 |
| 2 | `main/learning/providers/macos-dictionary.ts` | macOS 原生词典 |
| 3 | `main/learning/providers/google-translate.ts` | Google 翻译 + TTS |
| 4 | `main/learning/dictionary-service.ts` | Provider 编排 |
| 5 | `main/learning/vocabulary-store.ts` | SurrealDB 生词本 CRUD |
| 6 | `main/ipc/handlers.ts` | 新增 LEARNING_* handlers |
| 7 | `main/preload/view.ts` | 新增 learning API |
| 8 | `main/app.ts` | 初始化 dictionaryService |

**P2b 交付物**：IPC 链路打通，面板使用真实数据。

### P2c：编辑器集成

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `plugins/note/learning/vocab-highlight-plugin.ts` | 生词高亮 Decoration |
| 2 | `components/NoteEditor.tsx` | 注册 plugin，监听 vocab 变化 |

**P2c 交付物**：编辑器中生词黄色下划线高亮 + hover tooltip。

---

## 十、设计约束

| CLAUDE.md 原则 | 如何遵守 |
|---|---|
| **分层独立** | Dictionary Panel 不直接访问 DB；Provider 不互相调用 |
| **注册原则** | 外部面板通过 `registerExternalPanel` 注册；Plugin 通过 `blockRegistry` 外部注册 |
| **不过度设计** | P2a 先 mock，验证 UI；P2b 接真实数据；P2c 再加高亮 |
| **模块自包含** | `src/main/learning/` 和 `src/plugins/note/learning/` 各自独立 |
| **现有模式** | IPC handler 遵循 `ipcMain.handle` 模式；Store 遵循 SurrealDB 模式；Preload 扩展 `viewAPI` |

---

## 十一、新增学习模块检查清单

- [ ] **IPC 通道注册**：LEARNING_* 添加到 `IPC` 常量
- [ ] **Preload 桥接**：viewAPI 新增 learning 方法
- [ ] **Main Handler**：handlers.ts 新增 LEARNING_* 处理
- [ ] **DictionaryService**：provider 注册 + lookup 链
- [ ] **VocabularyStore**：SurrealDB schema + CRUD
- [ ] **Dictionary Panel**：外部面板注册 + 互斥
- [ ] **ContextMenu**：查词/翻译入口
- [ ] **Vocab Plugin**：Decoration 高亮 + tooltip
- [ ] **广播机制**：vocab 变化通知所有 renderer
- [ ] **样式一致**：使用 `--help-panel-*` CSS 变量

---

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| 1.0 | 2026-04-05 | 初始版本：三阶段实施（P2a UI 骨架 → P2b Main 进程 → P2c 编辑器集成） |
