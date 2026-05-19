# src/capabilities — 能力层(npm 屏障)

> **纵向类目**:能力层
> **横向 L 层**:跨 L0~L5(被各层调用)
> **当前状态**:⏸️ 待启用,实施具体能力时填充(可能 L5 阶段开始)

---

## 该层做什么

互操作能力的抽象,封装外部 npm 依赖,跨视图复用动作。

**唯一中间层** —— 不再有"表征层"等中间分层。所有跨视图横向抽象都在能力层。

详细说明见 [docs/00-architecture/charter.md § 2.1 能力层](../../docs/00-architecture/charter.md)。

---

## 屏障约束

- ✅ **唯一允许 import 业务 npm 包的位置**(prosemirror / three / pdfjs / epubjs / foliate-js / electron / AI SDK 等)
- ❌ 能力之间禁止互相 install(避免依赖图)
- ❌ 实现细节不外泄:只通过入口 `index.ts` 暴露 API,不允许从能力外 import `main/` 或 `renderer/` 内部细节

详细见 [docs/00-architecture/directory-structure.md § 4](../../docs/00-architecture/directory-structure.md)。

---

## 子目录划分

待具体能力实施时设计。届时写 `DESIGN.md` 详述。

按 [charter § 3 能力层内部分类](../../docs/00-architecture/charter.md),能力按 3 类组织:

```
src/capabilities/
├── representation/    (表征类:渲染方法,如 text-editing / canvas-rendering / pdf-rendering)
├── interop/           (互操作类:动作抽象,如 browser-capability / content-extraction / ai-extraction)
└── system-service/    (系统服务类:如 history / find-replace / copy-paste)
```

---

## 跨进程能力的内部约定

每个能力的子目录可分 main/+renderer/(跨进程时):

```
src/capabilities/<class>/<capability-name>/
├── main/              (主进程实现,如 IPC handlers / 文件系统 / WebContents 控制)
├── renderer/          (renderer 实现,如 React Wrapper / DOM 操作)
├── index.ts           (统一对外入口,根据消费方所在进程动态选择)
└── README.md
```

视图(`src/views/`)只 import `index.ts`,不接触 main/ 或 renderer/ 内部。

---

## 下一步

具体能力实施时(如 L5 NoteView 阶段需要 text-editing 能力):
1. 写 `src/capabilities/DESIGN.md`(整体能力层架构)
2. 创建对应能力子目录
3. 写各能力的 `README.md` + `DESIGN.md`
