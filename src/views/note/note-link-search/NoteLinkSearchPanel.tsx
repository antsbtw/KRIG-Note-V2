/**
 * NoteLinkSearchPanel — `[[` 触发的笔记搜索面板(L5-B3.12)
 *
 * V1 → V2 改造:src/plugins/note/components/NoteLinkSearch.tsx
 *
 * - V1:直接组件 + view.dispatch hook → V2:popup-registry 模式(对齐 LinkPanel/ColorPickerPanel)
 * - V1:viewAPI.noteList() IPC → V2:noteStore.getAll() 同步函数
 * - 订阅 plugin state:每次 PM transaction 后 query 可能更新,组件靠 view-version
 *   tick 重渲(panel 内部用 useState + 副作用挂 view dom keydown / 显式 tick)
 *
 * 行为:
 * - 默认列出 noteStore 全部笔记;输入过滤(title 含 query)
 * - ↑/↓ 导航;Enter 选中;Esc 关闭(全 popup 行为)
 * - 选中 → 删 [[query 文本 + 插入 noteLink atom + 关 popup
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { NoteInfo as Note } from '@capabilities/note/types';
import { useAllNotes } from '../use-notes-folders';

/** PM PluginKey 类型最小子集(避免直 import prosemirror-state)*/
interface NoteLinkPluginKey {
  getState(state: unknown): { active: boolean; query: string; from: number; to: number } | null;
}

/** 拿当前 plugin state 的 query / from / to */
function readPluginState(
  view: EditorView | null,
  noteLinkCommandKey: NoteLinkPluginKey,
): { query: string; from: number; to: number } | null {
  if (!view) return null;
  const s = noteLinkCommandKey.getState(view.state);
  if (!s?.active) return null;
  return { query: s.query, from: s.from, to: s.to };
}

export function NoteLinkSearchPanel({ onClose }: PopupCloseProps) {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const noteLinkCommandKey = textEditing.noteLinkCommandKey as NoteLinkPluginKey;
  const view = textEditing.getNoteLinkActiveView() as EditorView | null;
  const allNotes = useAllNotes();
  const [tick, setTick] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 监听 PM view 的 transaction,查询变化时 re-render(用 tick 让 useMemo 重算)
  useEffect(() => {
    if (!view) return;
    const origDispatch = view.dispatch.bind(view);
    view.dispatch = (tr) => {
      origDispatch(tr);
      // 异步避免在 dispatch 期间 setState
      window.setTimeout(() => setTick((t) => t + 1), 0);
    };
    return () => {
      view.dispatch = origDispatch;
    };
  }, [view]);

  const pluginState = useMemo(
    () => readPluginState(view, noteLinkCommandKey),
    [view, tick, noteLinkCommandKey],
  );

  // plugin 关闭时(query 删掉 [[ / 输了 ]] / esc)— 同步关 popup
  useEffect(() => {
    if (view && !pluginState) {
      onClose();
    }
  }, [view, pluginState, onClose]);

  // 过滤 + 重置 selection
  const filtered = useMemo(() => {
    const q = (pluginState?.query ?? '').toLowerCase();
    if (!q) return allNotes;
    return allNotes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.id.includes(q),
    );
  }, [allNotes, pluginState?.query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [pluginState?.query]);

  function insertNoteLink(note: Note): void {
    if (!view) return;
    const s = noteLinkCommandKey.getState(view.state);
    if (!s?.active) return;
    const schema = view.state.schema;
    const noteLinkType = schema.nodes.noteLink;
    if (!noteLinkType) return;

    const { from, to } = s;
    // step 1:删 [[query 源文本 + 标 close meta(同一个 tr)
    // setMeta 接受 PluginKey 实例;noteLinkCommandKey 类型在 capability 边界被
    // 窄化为 NoteLinkPluginKey,运行时仍是 PM PluginKey,通过 cast 还原 PM 兼容
    const tr = view.state.tr.delete(from, to).setMeta(noteLinkCommandKey as unknown as Parameters<typeof view.state.tr.setMeta>[0], { close: true });
    view.dispatch(tr);

    // step 2:在删除后位置(== from)插入 noteLink atom
    const node = noteLinkType.create({ noteId: note.id, label: note.title });
    view.dispatch(view.state.tr.insert(from, node));
    view.focus();
    onClose();
  }

  // 键盘:↑/↓/Enter — 监听 view.dom keydown(plugin 已让 PM 不处理它们)
  useEffect(() => {
    if (!view) return;
    const handler = (e: KeyboardEvent) => {
      const s = noteLinkCommandKey.getState(view.state);
      if (!s?.active) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = filtered[selectedIdx];
        if (target) insertNoteLink(target);
      }
    };
    view.dom.addEventListener('keydown', handler);
    return () => view.dom.removeEventListener('keydown', handler);
  }, [view, filtered, selectedIdx]);

  if (!view || !pluginState) return null;

  return (
    <div ref={containerRef} className="krig-note-link-search">
      {filtered.length === 0 ? (
        <div className="krig-note-link-search__empty">无匹配笔记</div>
      ) : (
        filtered.map((note, i) => (
          <div
            key={note.id}
            className={
              'krig-note-link-search__item' +
              (i === selectedIdx ? ' krig-note-link-search__item--active' : '')
            }
            onMouseDown={(e) => {
              e.preventDefault();
              insertNoteLink(note);
            }}
            onMouseEnter={() => setSelectedIdx(i)}
          >
            <span className="krig-note-link-search__icon">📄</span>
            <span className="krig-note-link-search__label">{note.title || 'Untitled'}</span>
          </div>
        ))
      )}
    </div>
  );
}
