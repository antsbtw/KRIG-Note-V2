/**
 * MindSemanticPane — 语义描述面(00-diglot-core §6 的 left slot 文本侧)
 *
 * ⭐⭐ 两个 tab(用户拍板 2026-09-10):
 * - `note`:⭐ **主路径** —— 用 note 的方式写导图。层级 h1~h6 + indent,
 *   block 自带稳定 id,⋮⋮ handle / slash / 富文本全套可用。
 * - `mermaid`:兼容通道 —— 导入现成图例、对照检验。
 *
 * ⚠️⚠️ **抑制回环是本组件的核心难点**(00 §6:「同步管道带方向标记抑制回环」)。
 * 两个 tab 各有一套闸门,形态不同:
 * - mermaid:比**字符串**(CM6 吃字符串)
 * - note:走 **dual-channel**(照抄 NoteView)—— 自家编辑**绝不回灌**
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CodeEditingApi, CodeEditingHandle } from '@capabilities/code-editing/types';
import type { DiglotModelApi } from '@capabilities/diglot-model/types';
import type { DiglotSnapshot } from '@capabilities/diglot-model/engine-contract';
import type { DriverSerialized, TextEditingApi } from '@capabilities/text-editing/types';
import {
  MIND_SEMANTIC_VIEW_ID,
  registerMindSemanticMenus,
} from './mind-semantic-menus';

/** 用户停止输入后多久才落笔。⚠️ 太短会在输入中途反复报错刷屏。 */
const PARSE_DEBOUNCE_MS = 400;

/**
 * ⭐ 语义面的两种写法。
 * ⚠️ 两者是**同一棵树的两种写法**,不是两份数据。
 */
export type SemanticTab = 'note' | 'mermaid';

export interface MindSemanticPaneProps {
  /** 当前快照(画布侧改动后会变) */
  readonly snapshot: DiglotSnapshot | null;
  /** mermaid tab:用户改文本且解析成功 → 上报新的 S 层文本 */
  readonly onSemanticCommit: (semantic: string) => void;
  /** ⭐ note tab:用户改 block → 上报新的 S 层(直接给树,不经文本) */
  readonly onTreeCommit: (doc: unknown) => void;
  /** 当前导图 id —— 用于构造互不相同的 PM instanceId */
  readonly graphId: string;
  /** ⭐ 折叠某节点(落 G 层,持久)—— 与画布折叠同一真源 */
  readonly onToggleCollapsed: (nodeId: string) => void;
}

export function MindSemanticPane({
  snapshot,
  onSemanticCommit,
  onTreeCommit,
  graphId,
  onToggleCollapsed,
}: MindSemanticPaneProps): ReactElement {
  const [tab, setTab] = useState<SemanticTab>('note');
  // ⭐ 语义面用**独立 viewId** 注册完整菜单(见 mind-semantic-menus.ts 的论证):
  //   `graph-canvas-view` 那套是画布节点用的,只有 6 项且被渲染态闸筛过。
  useEffect(() => {
    registerMindSemanticMenus();
  }, []);
  const codeApi = useMemo(() => requireCapabilityApi<CodeEditingApi>('code-editing'), []);
  const diglot = useMemo(() => requireCapabilityApi<DiglotModelApi>('diglot-model'), []);
  const textEditing = useMemo(() => requireCapabilityApi<TextEditingApi>('text-editing'), []);
  const CodeHost = codeApi.Host;
  /** ⭐ 与 NoteView 用的是**同一个** `textEditing.Host` —— 没有另造编辑器。 */
  const NoteHost = textEditing.Host;

  const handleRef = useRef<CodeEditingHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** mermaid 侧回环闸门:记住「我刚 setValue 写进去的串」。 */
  const echoGuardRef = useRef<string | null>(null);
  /** 用户是否正在本面板编辑 —— 编辑期间**不接受**画布侧回灌。 */
  const editingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // ─────────────────────────────────────────────────────
  // note tab:dual-channel(照抄 NoteView)
  // ─────────────────────────────────────────────────────

  /**
   * ⭐⭐ **dual-channel** —— 光标不跳的正解。
   *
   * ⚠️⚠️ 我起初把每次快照都喂给 `doc` prop,于是:
   * ```
   * 打字 → onChange → 改树 → 重渲染 → 新 doc → Host useEffect[doc] 重建 → 光标跳
   * ```
   * 还会把正在编辑的块劈成两半(真机截图里出现两个「主题」)。
   *
   * ⭐ NoteView 的注释早写明:「doc 走独立 incomingDoc 通道,
   *   **自家编辑不动 incomingDoc**」—— 避免 onChange 回灌让引用变。
   *   ⚠️ 我用的是**同一个 Host**,错在**喂法**,不是错在组件。
   *
   * 本组件照抄:`incomingDoc` 只在**换图**或**画布侧改动**时更新。
   */
  const [incomingDoc, setIncomingDoc] = useState<DriverSerialized | null>(null);
  /**
   * ⭐⭐ **自己提交出去的树的指纹** —— 回环闸门的真正锚点。
   *
   * ⚠️⚠️ 只靠 `editingRef` 的时间窗**挡不住**(真机实测:回车后光标跳回主题)。
   * 时序是这样的:
   * ```
   * 回车 → onChange → editingRef=true,起 400ms
   * 400ms → onTreeCommit → 改树 → render → setSnapView
   * setTimeout(0) → editingRef=false          ← 比下一步**更早**执行
   * snapshot 变 → effect 跑 → editingRef 已 false → 推新 doc → 重建 → 光标跳
   * ```
   * ⭐ 时间窗永远追不上 React 的批处理顺序。正解是**按内容认**:
   * 记住「我提交出去的那棵树长什么样」,effect 看到同一棵树就**不推**——
   * 与时序无关,怎么排都对。
   */
  const committedFpRef = useRef<string | null>(null);
  /** 上次推给编辑器的内容指纹 —— 判断画布侧是否真的改了。 */
  const pushedFpRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot) {
      setIncomingDoc(null);
      pushedFpRef.current = null;
      committedFpRef.current = null;
      return;
    }
    // ⚠️ 用户正在本面板打字 → 一律不推,编辑器此刻是真源
    if (editingRef.current) return;

    const built = diglot.treeToNoteDoc(snapshot.s) as unknown as DriverSerialized;
    const fp = JSON.stringify(built);

    // ⭐⭐ 这棵树正是我刚提交出去的 → 是自己的回声,**不推**
    //    (与 editingRef 的时间窗无关,按内容认,时序怎么排都对)
    if (committedFpRef.current === fp) {
      pushedFpRef.current = fp; // 对齐基线,免得下次误判成"变了"
      return;
    }
    // ⭐ 内容没变就不推 —— 推了就是无谓重建
    if (pushedFpRef.current === fp) return;

    pushedFpRef.current = fp;
    setIncomingDoc(built);
  }, [snapshot, diglot]);

  /**
   * ⭐⭐ 折叠状态来源:**读写 G 层**,不用 driver 内建的 plugin state。
   *
   * ⚠️ 两边策略刻意不同:
   * - note 本体:仅存 plugin state,重启即重置(用户决议「不污染 schema」)
   * - ⭐ mind:G 层 `collapsed`,**持久**(规格 01 §3.1 明写)——
   *   导图的折叠是**图的一部分**,不是「我这会儿不想看」的临时视图状态。
   *
   * ⭐ 接这个 source 之后,note tab 的三角与画布的折叠**是同一件事**:
   * 在哪边折,另一边跟着收。
   *
   * ⚠️ 用 ref 读快照:source 的身份必须稳定(变了会重建 PM plugin),
   * 但它要读到**最新**的折叠状态 —— ref 正好两全。
   */
  const snapshotRef = useRef<DiglotSnapshot | null>(null);
  snapshotRef.current = snapshot;
  /**
   * ⭐ 画布侧折叠后,推一下 note 侧重算。
   *
   * ⚠️ 画布折叠**不改 doc** → PM 没有新 transaction → 藏内容的 plugin 不重算
   *    → 三角切了但内容没藏(真机踩过)。这里显式推。
   */
  useEffect(() => {
    if (!snapshot) return;
    textEditing.api.refreshHeadingCollapseFor(`diglot-mind::${graphId}`);
    // 折叠集变了就要重算 —— 依赖整个 g(折叠状态在里面)
  }, [snapshot, textEditing, graphId]);

  const collapseSource = useMemo(
    () => ({
      isCollapsed: (blockId: string): boolean => {
        const snap = snapshotRef.current;
        return snap ? diglot.isCollapsed(snap, blockId) : false;
      },
      toggle: (blockId: string): void => onToggleCollapsed(blockId),
    }),
    [diglot, onToggleCollapsed],
  );

  const handleNoteChange = useCallback(
    (newDoc: DriverSerialized): void => {
      editingRef.current = true;
      if (noteTimerRef.current !== null) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(() => {
        noteTimerRef.current = null;
        setError(null);
        // ⭐ 先算出「这份 doc 变成树、再序列化回来」长什么样 —— 那才是 effect 会看到的东西。
        //   ⚠️ 不能直接用 newDoc 的指纹:用户敲的块可能缺 id、属性顺序不同,
        //      与树往返后的结果**字节不同**,拿它当锚点会漏判。
        try {
          const tree = diglot.noteDocToTree(newDoc);
          committedFpRef.current = JSON.stringify(diglot.treeToNoteDoc(tree));
        } catch {
          committedFpRef.current = null;
        }
        onTreeCommit(newDoc);
        editingRef.current = false;
      }, PARSE_DEBOUNCE_MS);
    },
    [onTreeCommit, diglot],
  );

  // ─────────────────────────────────────────────────────
  // mermaid tab:字符串闸门
  // ─────────────────────────────────────────────────────

  /**
   * mermaid tab 显示什么。
   *
   * ⚠️⚠️ **不能用 `snapshotToFile().semantic`** —— v1 之后那是
   * **note doc 的 JSON 串**,直接塞进编辑器就是满屏 `{"format":"pm-doc-json"...}`
   * (真机踩过:用户说「这是乱码呀」)。改格式时只改了存法、没改显示,是我漏的。
   *
   * ⭐ mermaid tab 要的是**mermaid 投影**(有损:只有层级 + 标题纯文本),
   *   这正是 mermaid 降级为「导入/导出通道」之后它该扮演的角色。
   */
  const semanticOf = useCallback(
    (snap: DiglotSnapshot): string => diglot.toMermaidMindmap(snap.s),
    [diglot],
  );

  useEffect(() => {
    if (tab !== 'mermaid') return;
    const handle = handleRef.current;
    if (!handle || !snapshot) return;
    if (editingRef.current) return;
    const next = semanticOf(snapshot);
    if (handle.getValue() === next) return;
    echoGuardRef.current = next; // 方向标记:这次是我写的
    handle.setValue(next);
  }, [snapshot, semanticOf, tab]);

  const handleChange = useCallback(
    (value: string): void => {
      if (echoGuardRef.current === value) {
        echoGuardRef.current = null;
        return;
      }
      editingRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        editingRef.current = false;
        // ⚠️ 解析失败**只显示错误,不改模型**(C6);输入到一半必然经过非法状态
        const parsed = diglot.fileToSnapshot({
          format: 'diglot-mind/v0',
          semantic: value,
          graphic: snapshot ? (diglot.snapshotToFile(snapshot) as { graphic: string }).graphic : '',
        });
        if (!parsed.ok) {
          setError(parsed.errors.map((e) => `第 ${e.line} 行:${e.message}`).join('\n'));
          return;
        }
        setError(null);
        onSemanticCommit(value);
      }, PARSE_DEBOUNCE_MS);
    },
    [diglot, snapshot, onSemanticCommit],
  );

  // ⚠️ 常驻 timer 必须有停止调用(铁律)
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (noteTimerRef.current !== null) {
        clearTimeout(noteTimerRef.current);
        noteTimerRef.current = null;
      }
    },
    [],
  );

  const initial = snapshot ? semanticOf(snapshot) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, opacity: 0.5, marginRight: 6 }}>语义描述面</span>
        {(['note', 'mermaid'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            title={
              t === 'note'
                ? '用 note 的方式写导图:层级 h1~h6,块自带稳定 id'
                : '兼容 mermaid 语法:可直接粘贴社区图例'
            }
            style={{
              fontSize: 12,
              padding: '2px 10px',
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.12)',
              background: tab === t ? 'rgba(120,160,220,0.22)' : 'transparent',
              color: tab === t ? '#cfe0ff' : 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'note' ? (
          incomingDoc ? (
            <NoteHost
              config={{
                // ⚠️ instanceId 必须与 NoteView / 画板文字编辑**互不相同** ——
                //    registry 按它区分多个 PM 实例,撞了会静默 no-op。
                instanceId: `diglot-mind::${graphId}`,
                undoScope: 'text-editing.pm',
                // ⭐ 独立 viewId —— 与画布节点的 'graph-canvas-view' 区分,
                //   这样两边的 slash/handle 菜单互不影响(画布那套要守渲染态闸)。
                viewId: MIND_SEMANTIC_VIEW_ID,
                // ⭐ 折叠走 G 层(持久 + 与画布同步),不用内建 plugin state
                headingCollapseSource: collapseSource,
                // ⭐ plugin **默认全开** —— note tab 就该是完整的 note 编辑器
                //   (有 block、有 ⋮⋮ handle、slash 可用)。
                // ⚠️ 唯一不开 titleGuard(opt-in,NoteView 专属的强制首块 isTitle):
                //   导图 root 由 role 决定,开了会与树推导打架。
              }}
              doc={incomingDoc}
              onChange={handleNoteChange}
            />
          ) : null
        ) : (
          <CodeHost
            initialValue={initial}
            theme="dark"
            onChange={handleChange}
            onMount={(h) => {
              handleRef.current = h;
            }}
            features={{ lineNumbers: true, lineWrap: true, tabIndent: true, defaultKeymap: true }}
          />
        )}
      </div>
      {error !== null && (
        <div
          style={{
            padding: '6px 10px',
            fontSize: 12,
            color: '#e07a5f',
            whiteSpace: 'pre-wrap',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}
        >
          {/* ⚠️ 显示错误但**不改模型** —— 画布仍是上一有效状态 */}
          {error}
        </div>
      )}
    </div>
  );
}
