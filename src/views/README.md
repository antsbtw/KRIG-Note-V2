# src/views — 可视化层(L5 视图主体)

> **纵向类目**:可视化层
> **横向 L 层**:L5 视图
> **当前状态**:⏸️ 待启用,L5 阶段实施时填充

---

## 该层做什么

L5 视图主体,纯声明,通过 install 列表使用能力。视图 React 组件 + 视图本地状态(光标 / 选区 / 滚动 / 缩放)+ 视图独有交互项。

详细说明见 [docs/00-architecture/charter.md § 2.1 可视化层](../../docs/00-architecture/charter.md)。

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

待 L5 阶段实施 NoteView 时设计。届时写 `DESIGN.md` 详述。

预期结构:
```
src/views/
├── note/      (L5 阶段第一个落地视图)
└── (graph/ ebook/ web/ 后续添加)
```

---

## 下一步

L5 阶段(NoteView)实施时:
1. 写 `src/views/DESIGN.md`(子目录详细设计)
2. 创建 `src/views/note/`(NoteView 模块)
3. 写 `src/views/note/README.md` + `DESIGN.md`
