# src/views — 可视化层(L5)

> **纵向类目**:可视化层
> **横向 L 层**:L5
> **当前状态**:⏸️ 待启用,L5 阶段实施时填充

---

## 该层做什么

**View 是能力组合的轻声明**(charter § 1.4)——不是业务模块,不存在独立实现。

每个 view 文件极轻(20~50 行),只做:
1. `install` 列表(声明依赖的能力组合)
2. 注册菜单 / 命令到 L4 Registry
3. 视图 ID + 元数据

**不做**:
- ❌ UI 渲染实现(应用级 UI 在 Workspace Container,能力级 UI 在 Capability)
- ❌ 业务逻辑(全部在能力层)
- ❌ 状态管理(在 Workspace state)

详细说明见 [docs/00-architecture/charter.md § 1.4 + § 2.1](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ❌ 0 处业务 npm 包 import(prosemirror / three / pdfjs / epubjs / foliate-js / electron)
- ❌ 0 处 `import 'electron'`(电子相关走能力层)
- ❌ 不能 import `src/capabilities/<x>/main/...` 或 `src/capabilities/<x>/renderer/...` 内部细节(只能 import 入口 `src/capabilities/<x>/index.ts`)
- ✅ 允许 import:react / clsx / nanoid / 等纯函数白名单
- ✅ 允许 import:`@capabilities/`(通过入口)/ `@semantic/` / `@shared/`

详细见 [docs/00-architecture/directory-structure.md § 4 ESLint 屏障规则](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

待 L5 阶段实施时设计。命名反映**能力组合**(不用 V1 风格的 `NoteView` 等):

```
src/views/
├── note/             (能力组合:text-editing + history + find-replace + ...)
├── graph-canvas/     (能力组合:canvas-rendering + shape-library + text-editing(节点 label))
├── ebook-pdf/        (能力组合:pdf-rendering + bookmark + text-editing(注释))
├── ebook-epub/       (能力组合:epub-rendering + bookmark + text-editing(注释))
├── web-browser/      (能力组合:web-rendering + browser-capability + content-extraction)
├── family-tree/      (能力组合:canvas-rendering + family-tree-layout-algo)
└── ...
```

每个 view 命名描述"用什么能力组合",不命名虚构的"View 类型"。

---

## View 文件示例(目标态)

```ts
// src/views/note/index.ts(20~30 行)
import { registerView } from '@slot/view-type-registry';
import { contextMenuRegistry } from '@slot/context-menu-registry';
import { commandRegistry } from '@slot/command-registry';

// 1. 声明能力组合
registerView({
  id: 'note',
  install: ['text-editing', 'history', 'find-replace', 'note-link'],
});

// 2. 注册命令
commandRegistry.register('note.toggle-toc', () => { /* ... */ });

// 3. 注册菜单内容(式样由 Workspace Container 提供)
contextMenuRegistry.register({
  view: 'note',
  items: [
    { id: 'note-toggle-toc', label: 'Toggle TOC', command: 'note.toggle-toc' },
  ],
});
```

**view 文件超过 100 行需审查**——可能违反 § 1.4(view 不写 UI / 不写业务逻辑)。

---

## 下一步

L5 阶段(`note` view 起步)实施时:
1. 写 `src/views/DESIGN.md`(子目录详细设计)
2. 创建 `src/views/note/`(能力组合声明)
3. 写 `src/views/note/README.md` + `DESIGN.md`(描述能力组合 + 设计意图)
