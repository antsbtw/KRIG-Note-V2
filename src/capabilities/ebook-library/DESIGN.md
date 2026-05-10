# ebook-library capability

> v0.1 · 2026-05-09 · L5-C1
>
> 配套:[../../../docs/RefactorV2/v1-ebook-migration-plan.md](../../../docs/RefactorV2/v1-ebook-migration-plan.md) v0.3 § 3.3

## 职责

把 main 进程的 ebook 持久化能力(书架 + 文件夹 + 进度 + 书签 + 标注 + 文件加载)封装成 renderer 端 API。

view + 后续 ebook-rendering capability 都通过此 capability 读写,**view 不直触 storage**(audit § R5 闭环)。

## 实现位置

| 层 | 路径 | LOC | 备注 |
|---|---|---|---|
| Renderer 入口 | `src/capabilities/ebook-library/index.ts` | ~280 | IPC 调用封装 + Registry 注册 |
| 类型 | `src/capabilities/ebook-library/types.ts` | ~150 | 与 IPC 边界两侧形状对齐 |
| Main 实现 | `src/platform/main/ebook/` | ~580 | bookshelf-store + annotation-store + file-loader + library-handlers |
| IPC channel | `src/shared/ipc/channel-names.ts` 新增 25 条 `EBOOK_*` | ~30 | |
| preload 暴露 | `src/platform/main/preload/main-window-preload.ts` 末尾追加 | ~95 | |
| electron-api 类型 | `src/shared/ipc/electron-api.d.ts` 末尾追加 | ~50 | |

## 持久化路径(D-3=B JSON 起步)

```
{userData}/krig-data/ebook/
  bookshelf.json              ← 书架元数据 + 文件夹结构(version='1' + entries[] + folders[])
  library/                    ← managed 模式的文件副本
    {uuid}.{ext}
  annotations/
    {bookId}.json             ← 按 bookId 索引的标注
```

写入策略:atomic — `*.tmp` → `fs.renameSync`(POSIX 保证原子);防"写一半挂掉损坏旧数据"。
对齐 V2 既有 `learning/vocab-store.ts` / `media-storage` 模式。

## 退出条件(对齐 v0.3 D-4)

C5 验收 + 稳定 ≥2 周 + 独立 SurrealDB 客户端 epic(候选 W6)落地 → 整体迁
`src/storage/ebook/` + 升 SurrealDB 实现。V1
`src/main/ebook/bookshelf-surreal-store.ts` + `annotation-surreal-store.ts`
保留作 W6 起点参考,不删。

## API 形状

详见 `types.ts` 的 `EBookLibraryApi` 接口。

扁平化方法,对齐 ytdlp / media-storage / learning 风格(不嵌套 `bookshelf.add()`
而是直接 `add()`)。视图侧用法:

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';

const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');

// 列书架
const books = await library.list();

// 订阅书架变化
useEffect(() => library.onBookshelfChanged(setBooks), []);

// 订阅"书已加载"
useEffect(() => library.onBookOpened(async (info) => {
  const data = await library.getData();
  if (data) renderer.load(data.data.buffer);
}), []);
```

## W5 严格态边界(audit § 5.2 A)

- **View 侧(强制)**:走 `requireCapabilityApi('ebook-library')` 间接路由,
  不直 import `@capabilities/ebook-library` 运行时值
- **Driver/slot 侧(允许)**:可直 import 单例 export 兜底(临时允许项,B/C
  达成时统一改造)
- 模块级 export 同时挂(双导出),对齐 V2 既有 capability 现行写法

## 装配关系(charter § 1.3 表格)

- ebook-library 内部依赖:**仅** `@slot/capability-registry`(注册自身)
- ebook-library 不依赖 driver(本 capability 无 driver 层)
- ebook-library 不依赖 ebook-rendering(底层数据能力,被 rendering 反向消费)

## 零业务 npm import

本 capability 是纯 IPC 客户端,**仅** import:
- `@slot/capability-registry/capability-registry`(Registry 注册)
- 相对路径 `./types`(纯类型)

`window.electronAPI.ebook*` 由 preload 注入,不算 npm import。

## 不做的事(C1 范围外)

| 不做 | 说明 |
|---|---|
| 渲染引擎封装 | 留 C2 ebook-rendering capability(pdfjs-dist + foliate-js) |
| Toolbar / 标注层 UI | 同上 |
| activeBookId 等 per-ws 状态 | 在 view 端走 pluginStates(D-2=A) |
| Slot 锚定同步 | D-9=B 单独阶段 |
| PDF 全书提取 | D-8=A 不在本迁移 |
| OCR | D-12=A 砍出,留独立阶段 |
