# ebook-rendering capability

> v0.1 · 2026-05-09 · L5-C2
>
> 配套:[../../../docs/RefactorV2/v1-ebook-migration-plan.md](../../../docs/RefactorV2/v1-ebook-migration-plan.md) v0.3 § 3.2 + § 5 C2

## 职责

封装 `pdfjs-dist`(C2)+ `foliate-js`(C3 起)的整个生命周期,以
`<EBookHost ref={hostRef} />` 单一面孔暴露给 view。view 通过 ref 命令式 +
props 回调通信,**0 处** import 业务 npm 包。

## 实现位置

| 层 | 路径 | LOC | 备注 |
|---|---|---|---|
| 入口 + Registry | `index.ts` | ~70 | 注册 + api(EBookRenderingApi)+ 类型 export |
| 类型 | `types.ts` | ~190 | IBookRenderer 体系 + 守卫 + 工具函数 |
| Host 主组件 | `Host.tsx` | ~250 | forwardRef 命令式 API + 被动加载 + 派发到 fixed-page-content |
| PDF 引擎 | `pdf/index.ts` | ~300 | V1 直迁,**唯一 import pdfjs-dist 的文件** |
| 虚拟滚动 | `fixed-page-content/index.tsx` | ~280 | V1 改写,砍 AnnotationLayer + viewAPI |
| 样式 | `styles.css` | ~110 | V1 ebook.css 中 PDF / TextLayer 部分,改 krig- 前缀 |

C3 起追加:`epub/`(foliate-js)+ `reflowable-content/`。
C4 起追加:`outline-panel/` + `search-bar/` + `hooks/use-bookmarks` + `hooks/use-epub-annotation`。
C5 起追加:`annotation-layer/`。

## npm 屏障

| npm 业务包 | 仅在哪 | 版本锁 |
|---|---|---|
| `pdfjs-dist` | `pdf/index.ts` | `^4.9.155`(EBookView 设计 v2 § 5 #10:5.x 与 Electron 40 不兼容)|
| `foliate-js` | `epub/index.ts`(C3 起)| TBD |

view / driver / shell / workspace / slot:**0 处** import 这两个包(eslint 拦)。

## 对外 API 形状

详见 `types.ts` 的 `EBookRenderingApi`:

```ts
interface EBookRenderingApi {
  Host: ComponentType<EBookHostProps & { ref?: Ref<EBookHostHandle> }>;
  isFixedPage(r: IBookRenderer): r is IFixedPageRenderer;
  isReflowable(r: IBookRenderer): r is IReflowableRenderer;
  detectFileType(fileName: string): EBookFileType;
  getRenderMode(fileType: EBookFileType): RenderMode;
}
```

view 端用法(对齐 web-rendering 模式):

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookRenderingApi, EBookHostHandle } from '@capabilities/ebook-rendering/types';

const Host = useMemo(
  () => requireCapabilityApi<EBookRenderingApi>('ebook-rendering').Host,
  [],
);
const hostRef = useRef<EBookHostHandle | null>(null);

// 命令式驱动
hostRef.current?.loadFromInfo(info);
hostRef.current?.goToPage(42);
hostRef.current?.setScale(1.5);
```

## 订阅模式约定(C2 关键设计)

**view 端订阅 onBookOpened,Host 不订阅**。流程:

```
1. 用户点书 → library.open(id) → main 加载 buffer + 推 EBOOK_LOADED
2. view 通过 capability.ebook-library.onBookOpened 接收 info
3. view 调 hostRef.current.loadFromInfo(info) → Host 内部:
   - library.getData() 拿 Uint8Array
   - new PDFRenderer(); renderer.load(buffer)
   - 渲染到 FixedPageContent
4. Host 通过 onLoadComplete / onPageChange / onScaleChange 推送状态变化给 view
```

**为什么 Host 不订阅**:避免 Host + view 双订阅导致重复加载;view 是协调
中心,Host 是纯渲染设施。

## W5 严格态 A 边界(audit § 5.2)

- View 侧(强制):走 `requireCapabilityApi('ebook-rendering').Host` 间接路由
- Driver/slot 侧:本 capability 无 driver 消费场景
- 模块级 export 同时挂(双导出),对齐 V2 现行写法

## 与 ebook-library 的边界

- ebook-library = **数据 + IPC 中介**(书架 / 文件夹 / 标注 / 数据传输)
- ebook-rendering = **渲染能力**(pdfjs-dist 封装 / 虚拟滚动 / Canvas)
- ebook-rendering 在 Host.tsx 内通过 `requireCapabilityApi('ebook-library')`
  调 `library.getData()`(capability 间通信也走 registry,严格遵守"能力间不
  互相 install"原则,详见 charter § 1.2)

## 不做的事(C2 范围外)

| 不做 | 留给 |
|---|---|
| EPUB 渲染 | C3 |
| TOC / Outline panel | C3(在 capability 内追加 outline-panel/) |
| Cmd+F 搜索栏 | C3 |
| 书签 hooks | C4 |
| EPUB CFI 高亮 | C4 |
| PDF 空间标注(rect/underline)| C5 |
| OCR | D-12=A 砍出,留独立 epic |
| 全书提取 | D-8=A 不在本迁移 |
