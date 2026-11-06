/**
 * ③ 编辑:note 卡片原地编辑浮层
 *
 * 蓝本 = 画板文字节点的 EditOverlay(capabilities/canvas-text-node/edit-overlay.tsx)——
 * 用户 2026-11-06:「功能建议参考 graph 的编辑方式就可以了,因为那个功能我做过多次调试并认可满意的」。
 * 浮层样式、插件开关、Esc / 提交规则、自动聚焦都照抄;只改一处:不是全局单例(session-store),
 * 而是受控组件,由使用方自己挂 —— 同窗口画板 + 别的模块同时挂时不会弹出两个编辑框。
 *
 * 唯一新增:⋮⋮ 块手柄开关(用户:「手柄显示与否作为一个开关」),缺省关 = 画板。
 *
 * 事件(同画板):
 * - 点浮层外 → 提交
 * - ⌘↩ → 提交
 * - Esc:光标在块内 → 交给编辑器(选中整块);已是块选中态 → 退出且不提交
 * - 浮层内 keydown 不冒泡(防宿主的 Delete / ⌘Z 等快捷键)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  DriverSerialized,
  TextEditingApi,
  TextEditingPluginToggles,
} from '@capabilities/text-editing/types';
import type { NoteCardEditorProps, NoteDoc } from './types';
import './editor.css';

/** = 画板 CANVAS_TEXT_NODE_PLUGIN_PRESET(blockHandle 由开关决定) */
function pluginPreset(blockHandle: boolean): TextEditingPluginToggles {
  return {
    blockHandle,
    vocabHighlight: false,
    noteLinkCommand: false,
    pasteMedia: false,
    dropCursor: false,
    slash: true,
    headingCollapse: false,
    bottomPad: true,
  };
}

export function NoteCardEditor({
  doc: initialDoc, rect, viewId, sessionKey, blockHandle = false, onExit,
}: NoteCardEditorProps): ReactElement {
  const textEditing = useMemo(() => requireCapabilityApi<TextEditingApi>('text-editing'), []);
  // doc 只给一次:Host 内 useEffect[doc] 引用一变就重建 → 光标跳回开头(记忆:嵌 note 编辑器三坑)
  const [doc] = useState<DriverSerialized>(() => initialDoc as unknown as DriverSerialized);
  const latestRef = useRef<NoteDoc>(initialDoc);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const exitedRef = useRef(false);
  const [plugins] = useState(() => pluginPreset(blockHandle));

  const exit = useCallback((commit: boolean): void => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    onExit(commit ? latestRef.current : null);
  }, [onExit]);

  // Esc / ⌘↩(window capture,拦在 PM keymap 之前)—— 规则同画板
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const pm = popupRef.current?.querySelector<HTMLElement>('.ProseMirror');
        const blockSelected = pm?.classList.contains('is-block-selecting') ?? false;
        if (pm && !blockSelected) return; // 放行给 PM(选中整块),不退出
        e.preventDefault();
        e.stopPropagation();
        exit(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        exit(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit]);

  // 挂载后聚焦(EditorView 异步建好,RAF 重试 ~20 帧)
  useEffect(() => {
    let raf = 0;
    let tries = 0;
    const tryFocus = (): void => {
      const pm = popupRef.current?.querySelector<HTMLElement>('.ProseMirror');
      if (pm) { pm.focus(); return; }
      if (tries++ < 20) raf = requestAnimationFrame(tryFocus);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, []);

  const Host = textEditing.Host;
  // 开手柄时左侧让出 24px 手柄位,浮层整体左移,文字仍对齐卡片原位置
  const gutter = blockHandle ? 24 : 0;
  const popupStyle: CSSProperties = {
    ...styles.popup,
    left: rect.left - gutter,
    top: rect.top,
    width: rect.width + gutter + 20,
    minHeight: rect.minHeight,
  };

  return (
    <div
      data-note-card-editor
      style={styles.backdrop}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) exit(true);
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        ref={popupRef}
        className={`krig-note-card-popup${blockHandle ? ' krig-note-card-popup--handle' : ''}`}
        style={popupStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Host
          config={{
            instanceId: `note-card::${sessionKey}`,
            undoScope: `note-card.${sessionKey}`,
            viewId,
            plugins,
          }}
          doc={doc}
          onChange={(d: DriverSerialized) => { latestRef.current = d as unknown as NoteDoc; }}
        />
      </div>
    </div>
  );
}

/** = 画板 edit-overlay.tsx styles */
const styles: Record<string, CSSProperties> = {
  backdrop: {
    // 全屏透明,只作「点空白处提交」的事件捕获层,不遮挡画面
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    background: 'transparent',
  },
  popup: {
    position: 'fixed',
    boxSizing: 'border-box',
    border: '1px solid #4a90e2',
    borderRadius: 8,
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.55)',
    overflow: 'auto',
    maxHeight: '70vh',
    padding: '8px 10px',
    fontSize: 14,
    lineHeight: 1.5,
    background: 'rgba(40, 40, 40, 0.98)',
    color: 'var(--krig-text-primary)',
  },
};
