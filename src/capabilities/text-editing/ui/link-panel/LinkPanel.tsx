/**
 * LinkPanel — 行内链接编辑面板(L5-B3.4 + L5-B3.15)
 *
 * 三 Tab(对齐 V1):
 * - 📄 笔记:noteCapability 搜索 + drill heading 二级标题
 * - 📎 文件(L5-B3.15):import 到 mediaStore / link 到原文件,B3.14 IPC 已就位
 * - 🔗 网页:输 URL
 *
 * 协议输出:
 * - krig://note/{id}             — 笔记 Tab 选中笔记
 * - krig://block/{id}/{anchor}   — 笔记 Tab drill 二级标题
 * - https://...                  — 网页 Tab 输入 URL
 * - file://{path}                — 文件 Tab link 模式
 * - media://{...}                — 文件 Tab import 模式
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { NoteInfo as Note } from '@capabilities/note/types';
import { useNoteList } from '../hooks/use-note-list';
import { FileTab } from './FileTab';

type LinkTab = 'note' | 'file' | 'web';

interface HeadingItem {
  level: number;
  text: string;
  /** L7 block atomization Stage 5(decision 026 §7.3):block atom ULID,稳定锚点 */
  id: string | null;
}

/**
 * 从 PM JSON doc 中提取 heading 列表(heading 节点,attrs.level 1-6)。
 *
 * L7 升级:同时抽 attrs.id(Stage 1 给 heading 加的稳定 block atom ULID)。
 * 无 id 字面 skip(数据异常:plugin 字面应保证所有 heading 有 id;migration 之前的旧
 * 数据已字面被 D-11 清空 → 不应在生产数据中遇到 null)。
 */
function extractHeadings(docJson: unknown): HeadingItem[] {
  const result: HeadingItem[] = [];
  if (!docJson || typeof docJson !== 'object') return result;
  const content = (docJson as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return result;

  for (const node of content) {
    if (!node || typeof node !== 'object') continue;
    const n = node as {
      type?: string;
      attrs?: { level?: number; id?: string | null };
      content?: unknown[];
    };
    if (n.type !== 'heading') continue;
    const level = n.attrs?.level;
    if (typeof level !== 'number' || level < 1) continue;

    // 提取 inline text
    let text = '';
    if (Array.isArray(n.content)) {
      for (const inline of n.content) {
        if (inline && typeof inline === 'object') {
          const i = inline as { type?: string; text?: string };
          if (i.type === 'text' && typeof i.text === 'string') {
            text += i.text;
          }
        }
      }
    }
    text = text.trim();
    if (text) {
      result.push({ level, text, id: n.attrs?.id ?? null });
    }
  }
  return result;
}

export function LinkPanel({ onClose }: PopupCloseProps) {
  const wsId = workspaceManager.getActiveId();
  const currentHref = useMemo(
    () => (wsId ? requireCapabilityApi<TextEditingApi>('text-editing').api.getActiveLinkHref(wsId) : null),
    [wsId],
  );

  // 已有 link 时按协议自动选 Tab(L5-B3.15:加 file/media → 文件 Tab)
  const initialTab: LinkTab = (() => {
    if (!currentHref) return 'note';
    if (currentHref.startsWith('http')) return 'web';
    if (currentHref.startsWith('file://') || currentHref.startsWith('media://')) return 'file';
    return 'note';
  })();
  const [tab, setTab] = useState<LinkTab>(initialTab);

  const handleApply = (href: string) => {
    if (!wsId || !href) return;
    requireCapabilityApi<TextEditingApi>('text-editing').api.setLink(wsId, href);
    onClose();
  };

  const handleRemove = () => {
    if (!wsId) return;
    requireCapabilityApi<TextEditingApi>('text-editing').api.removeLink(wsId);
    onClose();
  };

  return (
    <div className="krig-link-panel">
      <div className="krig-link-panel__tabs">
        {(['note', 'file', 'web'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`krig-link-panel__tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'note' ? '📄 笔记' : key === 'file' ? '📎 文件' : '🔗 网页'}
          </button>
        ))}
      </div>

      {tab === 'note' && <NoteTab onApply={handleApply} onClose={onClose} />}
      {tab === 'file' && <FileTab onApply={handleApply} onClose={onClose} />}
      {tab === 'web' && (
        <WebTab
          currentHref={currentHref?.startsWith('http') ? currentHref : null}
          onApply={handleApply}
          onClose={onClose}
        />
      )}

      {currentHref && (
        <div className="krig-link-panel__remove-row">
          <button
            type="button"
            className="krig-link-panel__remove-btn"
            onClick={handleRemove}
          >
            移除链接
          </button>
        </div>
      )}
    </div>
  );
}

// ── 笔记 Tab ──

function NoteTab({
  onApply,
  onClose,
}: {
  onApply: (href: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const notes = useNoteList();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [drillNote, setDrillNote] = useState<Note | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [drillNote]);

  // 过滤笔记
  const filteredNotes = useMemo(() => {
    if (drillNote) return [];
    if (!input) return notes.slice(0, 8);
    const q = input.toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [notes, input, drillNote]);

  // drillNote 时提取 headings
  const headings = useMemo(
    () => (drillNote ? extractHeadings(drillNote.doc.payload) : []),
    [drillNote],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (drillNote) {
        setDrillNote(null);
      } else {
        onClose();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      // 粘贴的完整链接 → 直接 apply
      if (trimmed && /^(krig:\/\/|https?:\/\/|file:\/\/)/.test(trimmed)) {
        onApply(trimmed);
        return;
      }
      if (drillNote) {
        const h = headings[selectedIdx];
        // L7 Stage 5:URL 用 block atom ULID 字面取代旧 heading text(decision 026 §7.3)
        if (h && h.id) onApply(`krig://block/${drillNote.id}/${h.id}`);
      } else {
        const note = filteredNotes[selectedIdx];
        if (note) onApply(`krig://note/${note.id}`);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const max = (drillNote ? headings.length : filteredNotes.length) - 1;
      setSelectedIdx((i) => Math.min(i + 1, max));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    }
  };

  // drill 视图
  if (drillNote) {
    return (
      <div onKeyDown={handleKeyDown}>
        <div
          className="krig-link-panel__back-row"
          onClick={() => setDrillNote(null)}
        >
          ◀ {drillNote.title || 'Untitled'}
        </div>
        <input
          ref={inputRef}
          className="krig-link-panel__input"
          placeholder="↑↓ 选标题,Enter 链接"
          value=""
          readOnly
          onKeyDown={handleKeyDown}
        />
        <div className="krig-link-panel__list">
          {headings.length === 0 && (
            <div className="krig-link-panel__empty">无标题</div>
          )}
          {headings.map((h, i) => (
            <div
              key={i}
              className={`krig-link-panel__item${i === selectedIdx ? ' active' : ''}`}
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              onClick={() => {
                // L7 Stage 5(decision 026 §7.3):URL 字面用 block atom ULID
                if (h.id) onApply(`krig://block/${drillNote.id}/${h.id}`);
              }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="krig-link-panel__heading-tag">H{h.level}</span>
              <span className="krig-link-panel__title">{h.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 一级:笔记列表
  return (
    <div>
      <input
        ref={inputRef}
        className="krig-link-panel__input"
        placeholder="搜索笔记..."
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setSelectedIdx(0);
        }}
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <div className="krig-link-panel__list">
        {filteredNotes.length === 0 && (
          <div className="krig-link-panel__empty">无匹配笔记</div>
        )}
        {filteredNotes.map((note, i) => (
          <div
            key={note.id}
            className={`krig-link-panel__item${i === selectedIdx ? ' active' : ''}`}
            onMouseEnter={() => setSelectedIdx(i)}
          >
            <span
              className="krig-link-panel__title"
              onClick={() => onApply(`krig://note/${note.id}`)}
            >
              📄 {note.title || 'Untitled'}
            </span>
            <span
              className="krig-link-panel__drill-btn"
              onClick={(e) => {
                e.stopPropagation();
                setDrillNote(note);
                setSelectedIdx(0);
              }}
              title="查看标题列表"
            >
              ▶
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 网页 Tab ──

function WebTab({
  currentHref,
  onApply,
  onClose,
}: {
  currentHref: string | null;
  onApply: (href: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState(currentHref || '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      // 已知协议(块/笔记链接 krig://、本地 file://、媒体 media://、http(s)://)原样保留;
      // 只对裸域名补 https://。否则粘贴「🔗 复制块链接」的 krig://block/... 会被破坏成
      // https://krig://block/...,链接失效。
      const hasScheme = /^(krig|https?|file|media):\/\//.test(trimmed);
      const href = hasScheme ? trimmed : `https://${trimmed}`;
      onApply(href);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        className="krig-link-panel__input"
        placeholder="输入网页地址,或粘贴块链接(🔗 复制链接)..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />
      <div className="krig-link-panel__hint">按 Enter 确认</div>
    </div>
  );
}
