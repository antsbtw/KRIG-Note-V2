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

/** 用户停止输入后多久才尝试解析。⚠️ 太短会在输入中途反复报错刷屏。 */
const PARSE_DEBOUNCE_MS = 400;

export interface MindSemanticPaneProps {
  /** 当前快照(画布侧改动后会变) */
  readonly snapshot: DiglotSnapshot | null;
  /** 用户改文本且解析成功 → 上报新的 S 层 */
  readonly onSemanticCommit: (semantic: string) => void;
}

export function MindSemanticPane({
  snapshot,
  onSemanticCommit,
}: MindSemanticPaneProps): ReactElement {
  const codeApi = useMemo(() => requireCapabilityApi<CodeEditingApi>('code-editing'), []);
  const diglot = useMemo(() => requireCapabilityApi<DiglotModelApi>('diglot-model'), []);
  const CodeHost = codeApi.Host;

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

  // ⚠️ 常驻 timer 必须有停止调用(铁律)
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const initial = snapshot ? semanticOf(snapshot) : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div
        style={{
          padding: '6px 10px',
          fontSize: 12,
          opacity: 0.6,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}
      >
        语义描述面
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <CodeHost
          initialValue={initial}
          theme="dark"
          onChange={handleChange}
          onMount={(h) => {
            handleRef.current = h;
          }}
          features={{ lineNumbers: true, lineWrap: true, tabIndent: true, defaultKeymap: true }}
        />
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
