/**
 * EditOverlay — 文字节点编辑浮层(V1 EditOverlay.ts 197 行 + GraphEditor.ts 167 行)
 *
 * V2 改造(路径 A,G4-2=B):
 * - V1 命令式 DOM API + 手动 createRoot → V2 React 组件,挂在 view 顶层
 * - V1 自管 GraphEditor(build schema/plugins/EditorView)→ V2 直接挂 text-editing.Host
 *   (它内部已封装完整 PM 实例,与 NoteView 同源)
 * - V1 InlineToolbar 371 行砍掉 — text-editing.Host 内部 setupFloatingToolbarTrigger
 *   自动注册 floating-toolbar,与 NoteView 共享
 * - V1 SlashMenu 砍掉 — text-editing.Host 内部 controller 已经接 SlashMenu(同 NoteView)
 *
 * 形态(对齐 V1 视觉):
 *   backdrop (fixed inset:0, z:1000, 半透明)
 *     └── popup (fixed,屏幕坐标定位,圆角胶囊,深灰背景)
 *           └── text-editing.Host(PM EditorView 挂载)
 *
 * 事件:
 * - 点 backdrop 空白 → exit(commit=true)
 * - Esc → exit(commit=false)
 * - Cmd/Ctrl+Enter → exit(commit=true)
 * - popup 内 keydown 阻止冒泡(防 InteractionController 全局 Delete/Backspace/Cmd+Z)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  DriverSerialized,
  TextEditingApi,
} from '@capabilities/text-editing/types';
import { sessionStore, type ActiveSession } from './session-store';
import { docToDriverSerialized } from './atom-bridge';

export function EditOverlay(): ReactElement | null {
  const textEditing = useMemo(
    () => requireCapabilityApi<TextEditingApi>('text-editing'),
    [],
  );

  // 订阅 session-store(view 端调 enterEdit 触发 store 更新 → 本组件重渲渲染 popup)
  const [session, setSession] = useState<ActiveSession | null>(() => sessionStore.get());
  useEffect(() => {
    const off = sessionStore.subscribe(() => setSession(sessionStore.get()));
    return off;
  }, []);

  // 初始 doc 是 DriverSerialized — V1 atoms[] 形态 lazy 转换
  const [initialDoc, setInitialDoc] = useState<DriverSerialized | null>(null);
  // 编辑期间最新的 doc(commit 时写回 instance.doc)
  const latestDocRef = useRef<DriverSerialized | null>(null);

  useEffect(() => {
    if (!session) {
      setInitialDoc(null);
      latestDocRef.current = null;
      return;
    }
    let cancelled = false;
    void docToDriverSerialized(session.opts.initialDoc).then((d) => {
      if (cancelled) return;
      const ds = d as DriverSerialized;
      setInitialDoc(ds);
      latestDocRef.current = ds;
    });
    return () => { cancelled = true; };
  }, [session]);

  const handleChange = useCallback((newDoc: DriverSerialized): void => {
    latestDocRef.current = newDoc;
  }, []);

  const exit = useCallback((commit: boolean): void => {
    if (!session) return;
    const doc = commit ? latestDocRef.current : null;
    session.opts.onExit(session.opts.instanceId, doc);
    sessionStore.clear();
  }, [session]);

  // ESC / Cmd+Enter(window 级,capture 阶段拦在 PM keymap 之前)
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
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
  }, [session, exit]);

  if (!session || !initialDoc) return null;

  const Host = textEditing.Host;
  const t = session.opts;
  // popup 最小宽 280 / 最小高 80 — 保证编辑器可用,不被退化为竖条;
  // 短小节点编辑时 popup 适度溢出 mesh 边界,提交后 mesh 自然 wrap.
  const popupW = Math.max(t.width, MIN_POPUP_W);
  const popupH = Math.max(t.height, MIN_POPUP_H);
  // 极窄节点(< 280):popup 居中对齐 mesh 中心,而不是左对齐 mesh 左边
  const popupLeft = t.width < MIN_POPUP_W
    ? t.screenX - (popupW - t.width) / 2
    : t.screenX;
  // 极矮节点(< 80):popup 顶对齐放下,避免 popup 顶部跑到画板外
  const popupTop = t.height < MIN_POPUP_H
    ? Math.max(8, t.screenY - (popupH - t.height) / 2)
    : t.screenY;
  const popupStyle: CSSProperties = {
    ...styles.popup,
    left: popupLeft,
    top: popupTop,
    width: popupW,
    [t.heightFixed ? 'height' : 'minHeight']: popupH,
    background: t.backgroundColor ?? 'rgba(40, 40, 40, 0.98)',
    color: t.backgroundColor ? '#222' : 'var(--krig-text-primary)',
  };

  return (
    <div
      style={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) exit(true);
      }}
    >
      <div
        style={popupStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation() /* 防 InteractionController Delete/Cmd+Z */}
      >
        <Host
          config={{
            instanceId: `${t.workspaceId}::${t.instanceId}`,
            undoScope: `canvas-text-node.${t.workspaceId}.${t.instanceId}`,
            viewId: t.viewId,
          }}
          doc={initialDoc}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

/** popup 最小尺寸 — 保证编辑器可用,不被退化为竖条 / 矮条 */
const MIN_POPUP_W = 280;
const MIN_POPUP_H = 80;

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(0, 0, 0, 0.2)',
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
  },
  popup: {
    position: 'fixed',
    boxSizing: 'border-box',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 8,
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
    overflow: 'auto',
    padding: '8px 12px',
    fontSize: 14,
    lineHeight: 1.5,
  },
};
