# note 卡片：「在别的画面上放一小段 note」的公共组件

> 状态：设计稿，未开工 · 2026-11-06
> 起因：math-visual 说明卡片（[题意图设计 §四·附二](../math/题意图-几何对象与分帧设计.md)）是仓库里第二次从头做「嵌一小段 note」，第一次是画板文字节点（`canvas-text-node`）。

## 一、为什么做

用户（2026-11-06）：「这个功能是否要做成一个公共的组件，未来其它模块调用的话，统一对外提供？它不应该只有编辑，还可以拖动、变大小等。」

两次实现踩的坑几乎一样：

| 坑 | 画板文字节点 | math-visual 说明卡片 |
|---|---|---|
| 菜单内容按 viewId 注册，不注册就弹空菜单 | 踩过 | 踩过 |
| 能插的块 ⊆ 显示得出的块（渲染闸） | 踩过 | 踩过 |
| 整页 note 版式塞进小框撑爆 | 踩过 | 踩过 |
| 编辑浮层是全局单例，多处挂会冲突 | 本身就是单例（画板、导图各挂一份） | 为避开它自己另做一个 |
| 全屏里菜单出不来 | — | 踩过（已在 shell 层通用修复） |

再加第三个使用方（PDF 批注、思考卡片、讲义排版……）还会再踩一遍。按「删掉它要动几处」判：现在每个使用方各自背着编辑会话、菜单注册、渲染闸、紧凑样式，改一处要动好几处。

## 二、用户定下的效果

- **调大小 = 改宽度**（用户 2026-11-06 选 A）：拖卡片左右边改宽，文字重新换行，高度跟着内容自动变；不做整体缩放。
- 卡片能：显示、双击原地编辑、拖动、改宽。
- **编辑照画板**（用户 2026-11-06：「功能建议参考 graph 的编辑方式就可以了，因为那个功能我做过多次调试并认可满意的」）：浮层样式、开哪些编辑功能、斜杠菜单 / 浮动工具条内容、Esc 与提交规则、自动聚焦，全部照 `canvas-text-node` 的 EditOverlay。**⋮⋮ 块手柄做成开关**（用户 2026-11-06：「参考画板，手柄显示与否作为一个开关」）：默认关（= 画板），块类型用 `/` 插入和转换；使用方可打开，打开时提供手柄菜单（「转换为…」同样过渲染闸）、编辑框左侧让出手柄位置。
- 模型（用户确认）：一份 note 内容 → 用 note 编辑器编辑（任何模块都能调起）→ 统一渲染成卡片 → 各模块只管放哪、多宽。

## 三、四层分工

```
① 内容   note doc 信封 + 宽 / 外观                     —— 数据格式,各方共用
② 显示   doc → SVG + 实际尺寸                          —— SVG 宿主、DOM 宿主都能用
③ 编辑   原地编辑会话(= 画板编辑浮层,改成各宿主自己挂)—— 嵌 note 编辑器 + 菜单项 + 渲染闸 + 紧凑版式 + 提交规则
④ 框     选中框:拖动、拖左右边改宽、双击进编辑        —— 只用屏幕像素,经回调交给宿主
```

**④ 不碰坐标系**：画板是 three.js 世界坐标，math-visual 是 Mafs 数据坐标 + 像素偏移，以后的 PDF 是页面坐标。框只报告「挪了多少像素 / 宽变成多少像素 / 要进编辑」，宿主自己换算。

| 使用方 | ① | ② | ③ | ④ |
|---|---|---|---|---|
| math-visual 说明卡片 | ✓ | ✓ | ✓ | ✓ |
| 画板 / 导图文字节点 | ✓ | ✓（经 three.js 贴图） | ✓ | ✗ 用画板自己的选中 / 缩放（世界坐标） |
| 以后：PDF 批注、讲义排版 | ✓ | ✓ | ✓ | ✓ |

## 四、接口草案（capability `note-card`）

```ts
interface NoteCardApi {
  // ① 内容
  emptyDoc(): NoteDoc;                         // 首段 isTitle:false(不是 note,没有标题)
  fromPlainText(text: string): NoteDoc;        // 一行一段
  toPlainText(doc: NoteDoc): string;           // 摘要 / 搜索用;公式取 LaTeX
  contentOf(doc: NoteDoc | undefined): NoteNode[] | null;  // 空 doc → null

  // ② 显示
  renderSvg(doc: NoteDoc, opts: { width: number; color?: string }):
    Promise<{ svg: string; width: number; height: number }>;

  // ③ 编辑 —— 行为 = 画板编辑浮层;组件由宿主自己挂(不再全局单例)
  Editor: ComponentType<{
    doc: NoteDoc;
    rect: { left: number; top: number; width: number; minHeight?: number };   // 屏幕像素
    viewId: string;                       // 宿主自己的 viewId(菜单按它注册)
    sessionKey: string;                   // 编辑器实例 id / 撤销域,宿主保证唯一
    blockHandle?: boolean;                // ⋮⋮ 块手柄开关,缺省 false(= 画板)
    onExit(doc: NoteDoc | null): void;    // 提交给 doc;放弃给 null
  }>;
  /**
   * 该 viewId 的菜单项(与画板注册的完全同一套:斜杠 = 过渲染闸的「转换为…」+ 块公式;
   * 浮动工具条 = 文字样式 / 公式 / 链接 / 颜色)。
   * 只生成不注册 —— 沿用 text-editing 的约定「工厂只返回 Item[],注册源在使用方」,
   * 也因为 capability 不允许依赖 slot 的菜单注册表。使用方拿去注册一次(幂等由使用方保证)。
   */
  menuItems(viewId: string): {
    slash: SlashItem[];
    floatingToolbar: FloatingToolbarItem[];
    handle: HandleItem[];   // 只有打开块手柄时才需要注册;「转换为…」过渲染闸
  };

  // ④ 框
  CardFrame: ComponentType<{
    rect: { left: number; top: number; width: number; height: number };  // 屏幕像素
    selected: boolean;
    minWidth?: number; maxWidth?: number;        // 缺省 80 / 800
    onSelect(additive: boolean): void;
    onMove(dx: number, dy: number, phase: 'move' | 'end'): void;
    onResizeWidth(width: number, phase: 'move' | 'end'): void;   // 拖左边时宿主同时收到 onMove 补偿左移
    onEnterEdit(): void;
    onContextMenu?(x: number, y: number): void;
  }>;
}
```

约定：
- 拖动 / 改宽过程中（phase `move`）宿主只更新临时状态，`end` 才写库（一步撤销）。
- 改宽时只画出新宽度的轮廓，松手再按新宽度重新渲染（`renderSvg` 文字转路径较重，不逐帧渲）。
- 编辑提交规则 = 画板：点外面 / ⌘↩ 提交；Esc 在光标位于块内时交给编辑器（选中整块），已是块选中态时 Esc 退出且**不提交**。
- 渲染闸用 `lib/atom-serializers/svg/slash-render-gate.ts`（已共用）；表格 / 图片补进渲染器后自动放开。

## 五、推进步骤

| 步 | 内容 | 行为变化 | 验收 |
|---|---|---|---|
| 1 抽出 | 新建 `note-card` capability：① ② 搬 math-visual 已做好的（doc 互转、渲染）；③ 以画板 EditOverlay 为蓝本做成受控组件（样式 / 插件 / Esc 规则照抄）+ `menuItems`；math-visual 改为调用它 | math-visual 卡片编辑对齐画板：去掉块手柄、Esc 规则、紧凑样式 | 卡片编辑与画板文字节点手感一致；单测迁过去仍全绿 |
| 2 加框 | 做 ④ `CardFrame`，math-visual 的标签卡片 / 文字对象换成它：拖边改宽、拖动、选中框 | 新增改宽 | 拖边宽度变、文字重排、高度自动；⌘Z 一步撤回 |
| 3 画板迁移 | 画板 / 导图文字节点改用 ③ `Editor`（各自挂、去掉全局单例 session-store），`canvas-text-node` 只留旧格式兼容（V1 atoms → doc）或并入 note-card；第 1 步暂时复制的编辑浮层样式在此合并 | 去掉「同窗口两个编辑框」隐患；其余行为不变 | 画板单独验收：双击编辑、斜杠、浮动工具条、提交 / 取消 |

第 3 步动到画板，单独排期、单独验收，不和 1、2 混在一起。

### 第 1 步实施记录（2026-11-06，分支 feature/math-visual-shapes-frames）

- 新建 `src/capabilities/note-card/`：`doc.ts`（① 互转）、`render.ts`（② 显示）、`Editor.tsx` + `editor.css`（③，蓝本画板 EditOverlay：样式 / 插件 / Esc 规则 / 自动聚焦照抄，改为受控组件，`blockHandle` 开关缺省关）、`menu-items.ts`（③ 菜单项，与画板同一套，只生成不注册）。
- math-visual 改用它：编辑器、内容格式、菜单项、卡片显示（ShapeLayer 经 `renderSvg`）都来自 note-card；自己只在 `fullscreen/card-menus.ts` 以 viewId `math-visual-card` 注册一次菜单。原 `NoteCardEditor.tsx` 与 pm-host.css 里的卡片紧凑样式删除。
- 行为变化（对齐画板）：卡片编辑去掉块手柄；Esc 规则改为画板的（块选中态 Esc 退出不保存）；编辑框样式用画板那份。
- ⚠️ 暂时两份：`note-card/editor.css` 照抄 `canvas-text-node/edit-overlay.css`，第 3 步合并。
- 单测：`tests/capabilities/note-card.test.ts`（互转 + 「菜单项 = 画板注册那套」逐项对照，注入漏一项验证会变红）。

## 六、不做 / 以后

- 整体缩放（用户选了只改宽）。
- 卡片外观（无框 / 边框 / 浅底）先留字段，UI 以后加。
- 表格、图片：先补 `atomsToSvg` 渲染器，补上后画板与卡片同时可用。
- 「互相转换」联动（表格数据 → 图上的点、公式 → 曲线）：与 math-visual 时间滑块一起做。
