/**
 * MindSemanticPane — 语义描述面(00-diglot-core §6 的 left slot 文本侧)
 *
 * ⭐⭐ **这里才第一次让「双向」两个方向同时可见**:
 * ```
 * 改文本 → 图跟着变        (mermaid 也能做的那半)
 * 拖节点 → 文本跟着变      ⭐ 我们的差异点
 * ```
 *
 * ⚠️⚠️ **抑制回环是本组件的核心难点**(00 §6:「同步管道带方向标记抑制回环」):
 * ```
 * 用户输入 → onChange → 解析 → 改模型 → 重渲染 → 文本被 setValue 覆盖
 *                                                    ↑ 光标跳走、输入被打断
 * ```
 * 解法:`echoGuardRef` 标记「这次 setValue 是我自己发的」,
 * 收到对应的 onChange 时直接丢弃。⭐ 方向标记,不是防抖 ——
 * 防抖只是让它晚一点发生,回环还在。
 *
 * ⚠️ **坏语法不污染模型**(C6):解析失败时**只显示错误,不改模型**,
 * 画布保持上一有效状态。用户输入到一半必然经过非法状态,
 * 那是正常过程,不是错误。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  CodeEditingApi,
  CodeEditingHandle,
} from '@capabilities/code-editing/types';
import type { DiglotModelApi } from '@capabilities/diglot-model/types';
import type { DiglotSnapshot } from '@capabilities/diglot-model/engine-contract';
import type { DriverSerialized, TextEditingApi } from '@capabilities/text-editing/types';

/** 用户停止输入后多久才尝试解析。⚠️ 太短会在输入中途反复报错刷屏。 */
const PARSE_DEBOUNCE_MS = 400;

/**
 * ⭐ 语义面的两种写法(用户拍板 2026-09-10):
 * - `note`:⭐ **我们自己的格式** —— 层级用 h1~hn,block 自带稳定 id(规格 §5 右列)
 * - `mermaid`:继承 mermaid 语法,导入现成图例的通道(规格 §2 起步策略)
 *
 * ⚠️ 两者是**同一棵树的两种写法**,不是两份数据。切换随时,内容跟着走。
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
}

export function MindSemanticPane({
  snapshot,
  onSemanticCommit,
  onTreeCommit,
  graphId,
}: MindSemanticPaneProps): ReactElement {
  const [tab, setTab] = useState<SemanticTab>('note');
  const codeApi = useMemo(() => requireCapabilityApi<CodeEditingApi>('code-editing'), []);
  const diglot = useMemo(() => requireCapabilityApi<DiglotModelApi>('diglot-model'), []);
  const CodeHost = codeApi.Host;
  const textEditing = useMemo(() => requireCapabilityApi<TextEditingApi>('text-editing'), []);
  const NoteHost = textEditing.Host;

  const handleRef = useRef<CodeEditingHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ⭐ 回环闸门:记住「我刚刚 setValue 写进去的那个串」。
   * 收到内容相同的 onChange 说明是自己写的回声,直接丢弃。
   */
  const echoGuardRef = useRef<string | null>(null);
  /** 用户是否正在编辑 —— 编辑期间**不接受**画布侧回灌,免得光标被抢。 */
  const editingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  /** 当前快照对应的语义文本。 */
  const semanticOf = useCallback(
    (snap: DiglotSnapshot): string => {
      const f = diglot.snapshotToFile(snap) as { semantic: string };
      return f.semantic;
    },
    [diglot],
  );

  // ── 画布侧改动 → 文本跟着变 ──
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !snapshot) return;
    // ⚠️ 用户正在敲字时不回灌 —— 否则光标跳走、输入被打断
    if (editingRef.current) return;
    const next = semanticOf(snapshot);
    if (handle.getValue() === next) return;
    echoGuardRef.current = next; // 标记方向:这次是我写的
    handle.setValue(next);
  }, [snapshot, semanticOf]);

  // ── 文本改动 → 图跟着变 ──
  const handleChange = useCallback(
    (value: string): void => {
      // ⭐ 自己写进去的回声,丢弃(抑制回环)
      if (echoGuardRef.current === value) {
        echoGuardRef.current = null;
        return;
      }
      editingRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        editingRef.current = false;
        // ⚠️ 解析失败**只显示错误,不改模型**(C6:坏语法不污染模型,
        //    画布保持上一有效状态)。输入到一半必然经过非法状态,那是正常过程。
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

  // ── ⭐ note tab:block 改动 → 树跟着变 ──
  //
  // ⚠️ 同样要抑制回环,但闸门形态不同:note 侧比的是**结构指纹**而非字符串
  //    (PM 每次编辑都会产出新对象,引用比较必然不等)。
  const noteEchoRef = useRef<string | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 当前快照对应的 note doc。 */
  const noteDocOf = useCallback(
    (snap: DiglotSnapshot): DriverSerialized =>
      diglot.treeToNoteDoc(snap.s) as unknown as DriverSerialized,
    [diglot],
  );

  const handleNoteChange = useCallback(
    (newDoc: DriverSerialized): void => {
      const fp = JSON.stringify(newDoc);
      // ⭐ 自己回灌进去的,丢弃
      if (noteEchoRef.current === fp) {
        noteEchoRef.current = null;
        return;
      }
      editingRef.current = true;
      if (noteTimerRef.current !== null) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(() => {
        noteTimerRef.current = null;
        editingRef.current = false;
        setError(null);
        onTreeCommit(newDoc);
      }, PARSE_DEBOUNCE_MS);
    },
    [onTreeCommit],
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
      {/* ⭐ 两个 tab:note(我们自己的格式)/ mermaid(继承的语法) */}
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
                ? '我们自己的格式:层级用 h1~hn,块自带稳定 id'
                : '继承 mermaid 语法:可直接粘贴社区图例'
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
            {t === 'note' ? 'note' : 'mermaid'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'note' ? (
          snapshot ? (
            <NoteHost
              config={{
                // ⚠️ instanceId 必须与 NoteView / 画板文字编辑**互不相同** ——
                //    registry 按它区分多个 PM 实例,撞了会静默 no-op
                //    (memory: pm-panel-instance-id 记过这个坑)。
                instanceId: `diglot-mind::${graphId}`,
                undoScope: 'text-editing.pm',
                viewId: 'graph-canvas-view',
                // ⭐ **默认全开** —— note tab 就该是完整的 note 编辑器:
                //   有 block、有 ⋮⋮ handle、能拖块、slash 菜单可用。
                //
                // ⚠️ 我最初关掉了 blockHandle/pasteMedia/noteLinkCommand,理由是
                //   「导图只要层级+文字」—— 那是**错的**:关掉 blockHandle 等于
                //   把 note 编辑器降级成普通文本框,block 的存在感就没了(用户指出)。
                //   ⭐ 这条 tab 的全部价值正是「**用 note 的方式写导图**」,
                //   砍掉 note 的能力就失去了它与 mermaid tab 的区别。
                //
                // ⚠️ 唯一不开的是 titleGuard(opt-in,NoteView 专属的"强制首块 isTitle"):
                //   导图的 root 由 role 决定,不靠 isTitle;开了会与树推导打架。
              }}
              doc={noteDocOf(snapshot)}
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
