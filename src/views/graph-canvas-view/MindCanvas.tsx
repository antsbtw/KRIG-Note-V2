/**
 * MindCanvas — diglot mind v0 渲染器
 *
 * ⭐⭐ **这里才是「拖了节点,文本跟着变」真正发生的地方。**
 *
 * 数据流(单向,一圈闭合):
 * ```
 * mind 文件 ──fileToSnapshot──→ {S, G}
 *                                 │
 *                    buildLayoutRequest → ELK(mrtree)
 *                                 │
 *                    projectToInstances(稀疏覆盖全量)
 *                                 ↓
 *                          CanvasHost 渲染
 *                                 ↓
 *                    用户拖动 → onInstancesChange
 *                                 ↓
 *                    ⭐ applyAction(canvas.dragNode) —— 落 G 层一条
 *                                 ↓
 *                    snapshotToFile → library.save
 * ```
 *
 * ⚠️ **不复用 GraphCanvasView**:那个 view 的真源是 `CanvasDocument`
 * (instances 就是本体),而 mind 的真源是 `{S, G}`,instances 是**派生物**。
 * 混在一起会让「谁是真源」变得含糊 —— 那正是双向同步最容易塌的地方。
 *
 * ⚠️ v0 只做**拖动钉坐标**这一条路径(三义中的落点①)。
 * 改父/转自由主题需要落点判定(01 §7.2),留下一步。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  CanvasHostHandle,
  CanvasRenderingApi,
  CanvasDocument,
  Instance,
} from '@capabilities/canvas-rendering/types';
import type { GraphLibraryStoreApi } from '@capabilities/graph-library-store/types';
import type { GraphLayoutApi } from '@capabilities/graph-layout/types';
import type { CanvasTextNodeApi } from '@capabilities/canvas-text-node';
import type { ShapeLibraryApi } from '@capabilities/shape-library/types';
import type { DiglotModelApi } from '@capabilities/diglot-model/types';
import type { DiglotSnapshot } from '@capabilities/diglot-model/engine-contract';
import { MindSemanticPane } from './MindSemanticPane';

const SAVE_DEBOUNCE_MS = 1000;

export interface MindCanvasProps {
  readonly workspaceId: string;
  readonly graphId: string;
  /**
   * 向上报告「有几个节点被钉住」+ 恢复回调。
   * ⚠️ toolbar 在 GraphCanvasView 里、状态在本组件里 —— 用回调上报而非
   * 把 toolbar 塞进来,避免两处各存一份 pinned 数量而漂移。
   */
  readonly onPinnedChange?: (count: number, releaseAll: () => void) => void;
}

/**
 * ⭐ 首屏视口:**root 居中,zoom=1**。
 *
 * ⚠️ 不用 `fitToContent` —— 它按 bbox 缩放填满容器,字号会随图的大小变,
 * 与「h1~h6 对齐 note 字号」的设计相矛盾(用户实测指出)。
 *
 * root 找不到时回落到整图中心(空图/异常数据也要有个合理落点,不 fail)。
 */
function centeredOnRoot(
  snap: DiglotSnapshot,
  projected: readonly { id: string; position?: { x: number; y: number }; size?: { w: number; h: number } }[],
): CanvasDocument['view'] {
  const rootId = snap.s.nodes.find((n) => n.role === 'root')?.id;
  const hit = rootId ? projected.find((p) => p.id === rootId) : undefined;
  if (hit?.position && hit.size) {
    return {
      centerX: Math.round(hit.position.x + hit.size.w / 2),
      centerY: Math.round(hit.position.y + hit.size.h / 2),
      zoom: 1,
    };
  }
  // 回落:整图 bbox 中心
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of projected) {
    if (!p.position || !p.size) continue;
    minX = Math.min(minX, p.position.x);
    minY = Math.min(minY, p.position.y);
    maxX = Math.max(maxX, p.position.x + p.size.w);
    maxY = Math.max(maxY, p.position.y + p.size.h);
  }
  if (!Number.isFinite(minX)) return { centerX: 0, centerY: 0, zoom: 1 };
  return {
    centerX: Math.round((minX + maxX) / 2),
    centerY: Math.round((minY + maxY) / 2),
    zoom: 1,
  };
}

/** 派生物 → CanvasDocument(画布吃的形态)。 */
function toCanvasDocument(instances: Instance[], view: CanvasDocument['view']): CanvasDocument {
  return { schema_version: 3, view, instances };
}

export function MindCanvas({ workspaceId, graphId, onPinnedChange }: MindCanvasProps): ReactElement {
  const { Host } = useMemo(
    () => requireCapabilityApi<CanvasRenderingApi>('canvas-rendering'),
    [],
  );
  const library = useMemo(
    () => requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store'),
    [],
  );
  const layoutApi = useMemo(() => requireCapabilityApi<GraphLayoutApi>('graph-layout'), []);
  /**
   * ⚠️ view 不直接 import capability 运行时值(W5 设计 §5,eslint 守着) ——
   * 走 requireCapabilityApi 间接路由;类型走 import type from .../types。
   */
  const diglot = useMemo(() => requireCapabilityApi<DiglotModelApi>('diglot-model'), []);
  const textNode = useMemo(
    () => requireCapabilityApi<CanvasTextNodeApi>('canvas-text-node'),
    [],
  );
  const shapeApi = useMemo(() => requireCapabilityApi<ShapeLibraryApi>('shape-library'), []);
  const TextEditOverlay = textNode.EditOverlay;

  const hostRef = useRef<CanvasHostHandle | null>(null);
  /** ⭐ 真源:{S, G}。instances 是派生物,**绝不反过来当真源**。 */
  const snapRef = useRef<DiglotSnapshot | null>(null);
  const titleRef = useRef<string>('');
  const loadedIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 被钉住的节点数 —— 决定「恢复自动布局」按钮是否可用(0 时置灰,别让用户点空)。 */
  const [pinned, setPinned] = useState(0);
  /**
   * ⭐ 快照的 React 镜像 —— 只为驱动语义面重渲染。
   * ⚠️ 真源仍是 `snapRef`(拖动回调在 ref 上连续改,不能等 React 批处理);
   *    这里是**投影**,每次 render() 时同步一次。两者不同步会出「文本落后一步」。
   */
  const [snapView, setSnapView] = useState<DiglotSnapshot | null>(null);
  /** 语义面宽度(px)。⚠️ 会话态,不持久 —— 与视口同理(01 §7.5)。 */
  const [paneW, setPaneW] = useState(340);
  /** 画布当前选中的节点 id(键盘操作的作用对象)。 */
  const selectedRef = useRef<string[]>([]);
  /**
   * ⭐ Alt 是否按下 —— 区分「裸拖=改结构」与「Alt+拖=自由摆位」(01 §7.2 v0.2)。
   *
   * ⚠️ 为什么在 view 层用键盘事件跟踪,而不是从拖动回调里读:
   * `onInstancesChange` 的签名只给 `instances`,**不带修饰键**。
   * 为 mind 改这个共享 API 会波及既有画板路径 —— 选架构纯度不选改动量
   * (与 `library.create` 不收初始内容时同样的取舍)。
   */
  const altRef = useRef(false);
  /**
   * ⭐ 上一次投影出来的节点位置 —— 用于判断「这个节点被拖动过吗」。
   * ⚠️ 不能拿 G 层的 pos 比:裸拖路径下 G 层根本没有条目,
   * 那样每个节点都会被当成"动过",每次回调全量误判。
   */
  const lastPosRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  /**
   * ⭐ 当前视口 —— 重排时**原样保留**,不要重置。
   *
   * ⚠️ 真机实测:拖动后整个画布跳动。三个原因叠加:
   *   ① `loadDocument` 会 setView,我每次传死值 (0,0,zoom=1) → 镜头瞬移
   *   ② 紧接着 `fitToContent` 又按新 bbox 重算缩放 → 再跳一次
   *   ③ 树一变(尺寸/层数变),bbox 就变,fit 出来的 zoom 每次都不同 → 持续跳
   * ⭐ 修法:**只有首次加载才 fit**;之后的重排保留用户当前的视口。
   */
  const viewportRef = useRef<CanvasDocument['view']>({ centerX: 0, centerY: 0, zoom: 1 });
  /** 是否已经 fit 过(每张图只在首次加载时自动取景一次)。 */
  const fittedRef = useRef(false);

  // ── 保存(防抖)──
  const flushSave = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const snap = snapRef.current;
    // ⚠️ 未 load 完不写盘(防止空模型擦掉真数据 —— 对齐 GraphCanvasView 的既有防御)
    if (!snap || loadedIdRef.current !== graphId) return;
    const file = diglot.snapshotToFile(snap) as { semantic: string; graphic: string };
    // ⭐ 「标题即 root」(01 §3.4):标题不再单独维护,改 root 的文字就是改标题。
    // ⚠️ 之前 title 与 root 是两份数据,改一个另一个不动 —— 这里收口。
    const rootTitle = diglot.rootTitleOf(snap.s);
    if (rootTitle !== null) titleRef.current = rootTitle;
    void library.mindSave(graphId, file.semantic, file.graphic, titleRef.current);
  }, [library, graphId, diglot]);

  const scheduleSave = useCallback((): void => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  /** {S,G} → 布局 → instances → 推给画布。 */
  const render = useCallback(
    async (snap: DiglotSnapshot, opts?: { fit?: boolean }): Promise<void> => {
      const host = hostRef.current;
      if (!host) return;
      const req = diglot.buildLayoutRequest(snap.s, snap.g);
      // ⭐ mrtree = graph-layout 文档里写明的 "Mind map 默认"
      const result = await layoutApi.computeLayout(req, {
        algorithm: 'mrtree',
        direction: 'RIGHT',
        // ⚠️ 间距要与节点尺寸同量级,否则 fit 之后视觉上挤成一团
        spacing: { node: 36, layer: 90 },
      });
      const projected = diglot.projectToInstances(snap.s, snap.g, result);
      // ⭐ shape ref 校验放在这里(不在 diglot-model):registry 的 bootstrap 用
      //   import.meta.glob(Vite 专属),diglot-model 要保持 node 纯环境可离线测。
      // ⚠️ fail loud —— 旧版在投影里 default 静默回落成圆角矩形,用户写了库里没有的
      //   形状,图上默默变个样子还不吭声(可靠性纲领:不静默兜底)。
      for (const inst of projected) {
        if (inst.type !== 'shape' || !inst.ref) continue;
        if (shapeApi.shapes.get(inst.ref)) continue;
        throw new Error(
          `[mind] 形状 '${inst.ref}' 不在 shape 库里(节点 ${inst.id})。` +
            `可用:${shapeApi.shapes.list().map((x) => x.id).join(', ') || '(库是空的)'}`,
        );
      }
      // ⭐ 记下本次投影的位置,供下次拖动回调比对
      const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const p of projected) {
        if (p.position && p.size) {
          posMap.set(p.id, { x: p.position.x, y: p.position.y, w: p.size.w, h: p.size.h });
        }
      }
      lastPosRef.current = posMap;
      setPinned(diglot.pinnedCount(snap));
      setSnapView(snap);
      const instances = projected as unknown as Instance[];
      // ⭐ 首次打开:**root 居中 + zoom=1**(用户拍板 2026-09-10)
      //
      // ⚠️ 之前用 `fitToContent` 取景 —— 它按内容 bbox **缩放到填满容器**,
      //    于是字号随图的大小忽大忽小:节点少时被放大、节点多时被缩小,
      //    和 note 正文对不上。而 h1~h6 的意义正是「与 note 同一套字号」。
      // ⭐ zoom=1 的不变量:**1 个世界单位 = 1 个 CSS 像素**(SceneManager 注释),
      //    所以 zoom=1 时节点字号就是它声明的 38/28/22 —— 与 note 渲染**一样大**。
      const initialView =
        opts?.fit && !fittedRef.current ? centeredOnRoot(snap, projected) : viewportRef.current;
      if (opts?.fit && !fittedRef.current) {
        viewportRef.current = initialView;
        fittedRef.current = true;
      }
      host.loadDocument(toCanvasDocument(instances, initialView));
    },
    [layoutApi, diglot],
  );

  // ── 加载 ──
  useEffect(() => {
    loadedIdRef.current = null;
    snapRef.current = null;
    fittedRef.current = false;
    viewportRef.current = { centerX: 0, centerY: 0, zoom: 1 };
    setError(null);
    let cancelled = false;

    void library
      .mindLoad(graphId)
      .then((record) => {
        if (cancelled || !record) return;
        // ⭐ B1:两段纯文本直接从 mind_doc 读出来,不经 doc_content 那层拆解
        const parsed = diglot.fileToSnapshot({
          format: 'diglot-mind/v0',
          semantic: record.semantic,
          graphic: record.graphic,
        });
        if (!parsed.ok) {
          // ⭐ 坏档 fail loud:显示错误,**不加载也不保存**,保住磁盘上的原文
          setError(
            `导图文件解析失败(已保护原文件,不会覆盖):\n` +
              parsed.errors.map((e) => `  第 ${e.line} 行:${e.message}`).join('\n'),
          );
          return;
        }
        titleRef.current = record.title;
        snapRef.current = parsed.value;
        loadedIdRef.current = graphId;
        void render(parsed.value, { fit: true });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`加载失败:${String(err)}`);
      });

    return () => {
      cancelled = true;
      // ⚠️ 卸载前 flush,别把最后一次拖动丢了
      flushSave();
    };
  }, [graphId, library, render, flushSave]);

  // ── ⭐⭐ 画布拖动 → 落 G 层 ──
  const handleInstancesChange = useCallback(
    (instances: Instance[]): void => {
      const snap = snapRef.current;
      if (!snap || loadedIdRef.current !== graphId) return;

      // ⭐⭐ v0.2 拖动分流(01 §7.2 修订):
      //   裸拖 → 改父/改序(S 层),图随后自动重排
      //   Alt+拖 → 钉住坐标(G 层),自由摆位
      // ⚠️ 这里**只发 action**,模型由 applyAction 改 —— 与断言同一条路径。
      //
      // 落点从画布回传的 instance.position 取;当前投影位置从 lastPosRef 取
      // (上一次渲染时算出来的),两者不同才算"被拖过"。
      let next = snap;
      let changed = false;
      let needsRelayout = false;

      for (const inst of instances) {
        // ⚠️ 跳过树连线:它们是**派生物**,没有对应的 S 层节点,也不该有 G 条目。
        if (diglot.isTreeLineId(inst.id)) continue;
        const node = snap.s.nodes.find((n) => n.id === inst.id);
        if (!node || !inst.position) continue;

        const prev = lastPosRef.current.get(inst.id);
        const x = Math.round(inst.position.x);
        const y = Math.round(inst.position.y);
        // 没动过就跳过(画布每次都回传全量 instances)
        if (prev && prev.x === x && prev.y === y) continue;

        if (altRef.current) {
          // ── Alt+拖:自由摆位,钉住坐标 ──
          next = diglot.applyAction(next, { kind: 'canvas.dragNode', id: inst.id, x, y });
          changed = true;
        } else {
          // ── ⭐ 裸拖:改结构 —— 位置由布局重算,不钉坐标 ──
          const target = diglot.resolveDropTarget(next.s, next.g, inst.id, { x, y }, lastPosRef.current);
          if (!target) {
            // 拖回原位 / 没有合法父 → 不产生变更,但要重排把它弹回去
            needsRelayout = true;
            continue;
          }
          next = diglot.applyAction(next, {
            kind: 'canvas.dragReparent',
            id: inst.id,
            newParent: target.newParent,
            ...(target.beforeSibling ? { beforeSibling: target.beforeSibling } : {}),
          });
          changed = true;
          needsRelayout = true;
        }
      }

      if (!changed && !needsRelayout) return;
      snapRef.current = next;
      // ⭐ 结构变了(或拖了但没变)→ 重跑布局,让图回到整齐状态
      if (needsRelayout) void render(next);
      if (changed) scheduleSave();
    },
    [graphId, scheduleSave, diglot, render],
  );

  // ── Alt 键跟踪(区分裸拖 / 自由摆位)──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      altRef.current = e.altKey;
    };
    // ⚠️ blur 时必须清掉:切走再回来若 Alt 卡在 true,裸拖会被误判成自由摆位
    const onBlur = (): void => {
      altRef.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // ── ⭐ 键盘操作(01 §7.1,照搬 XMind 肌肉记忆)──
  //
  // ⚠️⚠️ 用 **capture 阶段**并 stopPropagation:画布的 InteractionController
  // 也挂在 window 上监听 Delete/Backspace,它会**直接删 instance** ——
  // 而 instance 是派生物,删了模型还在,下次重排又冒出来(且 G 层留孤儿)。
  // 必须由本层先接管,转成模型 action。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 在输入框 / 语义面里打字时不拦截
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey) return; // 让 Cmd+Z / Cmd+C 等走画布既有逻辑

      const snap = snapRef.current;
      if (!snap || loadedIdRef.current !== graphId) return;
      const sel = selectedRef.current.filter((id) => !diglot.isTreeLineId(id));
      if (sel.length === 0) return;
      const id = sel[0];
      const node = snap.s.nodes.find((n) => n.id === id);
      if (!node) return;

      let next: DiglotSnapshot | null = null;
      if (e.key === 'Enter' && !e.shiftKey) {
        next = diglot.applyAction(snap, { kind: 'canvas.insertSibling', afterId: id, text: '新节点' });
      } else if (e.key === 'Tab') {
        next = diglot.applyAction(snap, { kind: 'canvas.insertChild', parentId: id, text: '新节点' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (node.role === 'root') {
          // ⚠️ root 是文档标题,删不得 —— 明确告知而非静默无视
          setError('root 是文档标题,不能删除(改标题请编辑它的文字)');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        next = diglot.applyAction(snap, { kind: 'canvas.deleteSubtree', id });
      } else if (e.key === '-' || e.key === '+' || e.key === '=') {
        // ⭐ 折叠/展开(01 §7.5「徽标点击 / `-` `+`」的键盘那一半)。
        //   `=` 一并收:美式键盘上 `+` 要按 Shift,不按也该能展开。
        //
        // ⚠️ 没有子节点就没得折 —— 静默无视会让人以为按键坏了,明确告知。
        const hasChildren = snap.s.nodes.some((n) => n.parent === id);
        if (!hasChildren) {
          setError('该节点没有子节点,无法折叠');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const collapsed = diglot.isCollapsed(snap, id);
        // `-` 只折、`+`/`=` 只展开 —— ⚠️ 不做成 toggle:
        //   规格给的是两个键,各司其职;按 `-` 却展开了会很意外。
        const wantCollapsed = e.key === '-';
        if (wantCollapsed === collapsed) {
          // 已经是目标状态,不产生无意义变更(也不报错 —— 这不是错误)
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        next = diglot.applyAction(snap, { kind: 'graphic.toggleCollapsed', id });
      } else {
        return;
      }

      e.preventDefault();
      e.stopPropagation(); // ⭐ 挡住画布的同名处理
      snapRef.current = next;
      setError(null);
      void render(next);
      scheduleSave();
    };
    // ⭐ capture:必须先于画布的 window 监听拿到事件
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [graphId, diglot, render, scheduleSave]);

  // ── ⭐ 注入 atom-bridge,节点文字才真渲染 ──
  //
  // ⚠️ 不注入的话,带 doc 的节点会退化成**空白灰矩形**(真机实测:六个空框)。
  // 文字层走 canvas-text-node 的 atomsToSvgInput 把 PM doc 转成可渲染原子 ——
  // 与 note 编辑器同一条链路(03 §4:content 这一格白送)。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.setAtomBridge(
      textNode.atomBridge.atomsToSvgInput as Parameters<CanvasHostHandle['setAtomBridge']>[0],
    );
    return () => host.setAtomBridge(null);
  }, [textNode, graphId]);

  /**
   * ⭐ 恢复自动布局:清空全部 pos,整图回到算出来的位置。
   *
   * ⚠️ 这是 `Alt`+拖(自由摆位)的**必要配套** —— 没有释放途径的话,
   * 钉住是单向的,用户摆乱了就再也回不去(01 §7.5「释放钉住」)。
   * ⭐ 也是 C7「删除条目即释放回自动」在 UI 上的直接体现。
   */
  const handleReleaseAll = useCallback((): void => {
    const snap = snapRef.current;
    if (!snap || loadedIdRef.current !== graphId) return;
    const next = diglot.applyAction(snap, { kind: 'graphic.releaseAllPos' });
    snapRef.current = next;
    void render(next);
    scheduleSave();
  }, [graphId, diglot, render, scheduleSave]);

  // 把入口交给上层 toolbar(view 持有状态,toolbar 只负责显示)
  useEffect(() => {
    onPinnedChange?.(pinned, handleReleaseAll);
  }, [pinned, handleReleaseAll, onPinnedChange]);

  /**
   * ⭐ 语义面改动落地:文本 → 新的 S 层。
   *
   * ⚠️ **G 层原样保留** —— 改标签不该动布局(C3:全部 pos 存活)。
   * id 由解析器按顺序确定性分配,故只要树形没变,G 条目仍配得上。
   * ⚠️ 已知局限:若用户在文本里增删了节点,后续 id 会整体位移,
   *    G 条目会配错 —— 记账,见提交说明。
   */
  const handleSemanticCommit = useCallback(
    (semantic: string): void => {
      const snap = snapRef.current;
      if (!snap || loadedIdRef.current !== graphId) return;
      const graphic = (diglot.snapshotToFile(snap) as { graphic: string }).graphic;
      const parsed = diglot.fileToSnapshot({ format: 'diglot-mind/v0', semantic, graphic });
      if (!parsed.ok) return; // 语义面自己已显示错误,这里静默返回不重复报
      snapRef.current = parsed.value;
      void render(parsed.value);
      scheduleSave();
    },
    [graphId, diglot, render, scheduleSave],
  );

  /**
   * ⭐ 双击节点 → 就地编辑标签(01 §7.3)。
   *
   * ⭐ 复用画板既有的 canvas-text-node 编辑浮层 —— 那是 **note 的同一个
   * text-editing.Host**(03 §4 实测),所以富文本/公式/图片天然可用。
   *
   * ⚠️⚠️ **与画板的关键差别**:画板编辑完走 `updateInstance`(instance 是本体);
   * mind 的 instance 是**派生物**,必须把结果写回 **S 层 content** ——
   * 写 instance 的话下次重排就被覆盖掉了。
   */
  const handleNodeDoubleClick = useCallback(
    (info: {
      instanceId: string;
      screenX: number;
      screenY: number;
      screenW: number;
      screenH: number;
    }): void => {
      // ⚠️ 树连线不可编辑(无文字层)
      if (diglot.isTreeLineId(info.instanceId)) return;
      const snap = snapRef.current;
      if (!snap || loadedIdRef.current !== graphId) return;
      const node = snap.s.nodes.find((n) => n.id === info.instanceId);
      if (!node) return;
      const inst = hostRef.current?.getInstance(info.instanceId);
      if (!inst) return;
      // ⭐ 与画板**同一套判定**(GraphCanvasView.handleNodeDoubleClick):
      //   line 类不可编辑(端点驱动、无文字层);
      //   几何 shape(parametric/svg)= 文字层叠在几何上 → popup 透明,几何透出不被遮挡;
      //   文字框(kind:'text')有自身底色 → 不透明。
      // ⚠️ 我原先硬编码 transparent: true —— 导图节点是 roundRect(parametric),
      //   碰巧也是 true,但那是**巧合不是道理**;换个形状就错了(用户指出要与画板一致)。
      let transparent = false;
      if (inst.type === 'shape') {
        const shape = shapeApi.shapes.get(inst.ref);
        if (shape?.category === 'line') return;
        transparent = shape?.geometry.kind !== 'text';
      }
      // 进编辑:隐藏渲染态文字层,避免与透明编辑浮层的文字重影(退出恢复)
      hostRef.current?.setNodeTextLayerVisible(info.instanceId, false);
      textNode.enterEdit({
        instanceId: info.instanceId,
        initialDoc: node.content,
        screenX: info.screenX,
        screenY: info.screenY,
        width: info.screenW,
        height: info.screenH,
        backgroundColor: inst.style_overrides?.fill?.color,
        transparent,
        // ⭐ 与画板一致:size_lock 决定编辑框高度是否固定
        heightFixed: !!inst.size_lock?.h,
        workspaceId,
        // ⚠️ 节点编辑用画板的 viewId(与画布文字节点同一套菜单 + 渲染态闸),
        //    **不是**语义面的 mind-semantic —— 节点内容要经 atomsToSvg 渲成 mesh,
        //    那道「能插 ⊆ 能渲」的闸对它是必要的。
        viewId: 'graph-canvas-view',
        onExit: (id, newDoc) => {
          if (newDoc === null) {
            // 取消编辑 → 恢复文字层可见
            hostRef.current?.setNodeTextLayerVisible(id, true);
            return;
          }
          const cur = snapRef.current;
          if (!cur) return;
          // ⭐ 写回 S 层 content(不是 updateInstance)—— 重排后仍然在
          const next = diglot.applyAction(cur, {
            kind: 'semantic.editLabelDoc',
            id,
            doc: newDoc,
          });
          snapRef.current = next;
          void render(next);
          scheduleSave();
        },
      });
    },
    [graphId, diglot, textNode, shapeApi, workspaceId, render, scheduleSave],
  );

  /**
   * ⭐ note tab 改动落地:block 序列 → 新的 S 层。
   *
   * ⚠️ **G 层原样保留** —— 与 mermaid 侧同理(改标签不该动布局,C3)。
   * ⭐ 且这条路**没有债 6**:block 自带稳定 id,用户增删块时其它块 id 不变,
   *    G 条目照样配得上(见 03 §8 的正解方向)。
   */
  const handleTreeCommit = useCallback(
    (doc: unknown): void => {
      const snap = snapRef.current;
      if (!snap || loadedIdRef.current !== graphId) return;
      const nextS = diglot.noteDocToTree(doc);
      // ⚠️ 空树不写入 —— 编辑器初始化中途可能给空 doc,写进去等于清空用户内容
      if (nextS.nodes.length === 0) return;
      const next = { s: nextS, g: snap.g };
      snapRef.current = next;
      void render(next);
      scheduleSave();
    },
    [graphId, diglot, render, scheduleSave],
  );

  /**
   * ⭐ 折叠/展开某节点 —— 落 G 层(持久),画布与 note tab **同一真源**。
   *
   * ⚠️ 折叠后画布会把该子树整个裁掉(projectToInstances 的 visibleNodes),
   * note tab 那边由 heading-collapse plugin 藏内容 —— 两边表现不同但**状态同源**。
   */
  const handleToggleCollapsed = useCallback(
    (nodeId: string): void => {
      const snap = snapRef.current;
      if (!snap || loadedIdRef.current !== graphId) return;
      const next = diglot.applyAction(snap, { kind: 'graphic.toggleCollapsed', id: nodeId });
      snapRef.current = next;
      void render(next);
      scheduleSave();
    },
    [graphId, diglot, render, scheduleSave],
  );

  // ── 常驻 timer 必须有停止调用(铁律)──
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    },
    [],
  );

  if (error) {
    return (
      <div style={{ padding: 24, color: '#c0392b', whiteSpace: 'pre-wrap', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      {/* ⭐ 左:语义描述面(00 §6 的 left slot 文本侧) */}
      <div style={{ width: paneW, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.1)' }}>
        <MindSemanticPane
          snapshot={snapView}
          graphId={graphId}
          onSemanticCommit={handleSemanticCommit}
          onTreeCommit={handleTreeCommit}
          onToggleCollapsed={handleToggleCollapsed}
        />
      </div>
      {/* 分隔条:拖动改宽度 */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = paneW;
          const onMove = (ev: MouseEvent): void => {
            setPaneW(Math.max(200, Math.min(720, startW + ev.clientX - startX)));
          };
          const onUp = (): void => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        style={{ width: 4, cursor: 'col-resize', flexShrink: 0, background: 'transparent' }}
      />
      {/* ⭐ 右:画布(right slot) */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <Host
          ref={hostRef}
          workspaceId={workspaceId}
          onInstancesChange={handleInstancesChange}
          onSelectionChange={(ids) => {
            selectedRef.current = ids;
          }}
          onNodeDoubleClick={handleNodeDoubleClick}
          /**
           * ⭐ 点节点右侧的连接点圆 → 折叠/展开(规格 §7.5「徽标点击」)。
           *
           * ⚠️ 这里用 toggle 而 `-`/`+` 两键各司其职 —— 不矛盾:
           * 圆上画的就是「点了会发生什么」(展开态画 `-`、折叠态画 `+`),
           * 所见即所得,不存在「按 `-` 却展开了」那种意外。
           *
           * ⚠️ 树连线 instance 不挂操作点(投影时只给有子节点的**节点**挂),
           * 所以这里拿到的 id 必然是节点 id。
           */
          onMagnetClick={(instanceId) => handleToggleCollapsed(instanceId)}
          onViewportChange={(vp) => {
            // ⚠️ 只记不写盘:视口是**会话态**,不持久(01 §7.5「缩放/平移不持久」)
            viewportRef.current = vp;
          }}
        />
      </div>
      {/* 文字编辑浮层(session-store 驱动) */}
      <TextEditOverlay />
    </div>
  );
}
