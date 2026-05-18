/**
 * ThoughtCard — 单个 thought 详情卡片(主舞台右区)
 *
 * Phase 2 简化:文本编辑用 textarea(派生自 doc 首段);Phase 3 切到 text-editing.Host。
 * 数据兼容:textarea 内容 = doc.payload.content[0].content[0].text,空时建空 paragraph。
 *
 * 操作:type 切换(9 种)/ resolve / pin / delete。
 * 状态:dangling-anchor 角标(anchor 在但失效);v0.5 §8.3。
 */

import { useEffect, useRef, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type { ThoughtCapabilityApi, ThoughtInfo } from '@capabilities/thought/types';
import {
  THOUGHT_TYPE_META,
  type ThoughtType,
} from '@shared/ipc/thought-types';

interface ThoughtCardProps {
  thought: ThoughtInfo;
}

const TYPES: ThoughtType[] = [
  'thought', 'question', 'important', 'todo', 'analysis', 'ai-response',
  'highlight', 'underline', 'rect-frame',
];

function extractFirstParaText(doc: ThoughtInfo['doc']): string {
  const root = doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  const firstBlock = root?.content?.[0] as { content?: Array<Record<string, unknown>> } | undefined;
  if (!firstBlock?.content) return '';
  return firstBlock.content
    .filter((n) => n.type === 'text')
    .map((n) => (n.text as string) ?? '')
    .join('');
}

function wrapPlainText(text: string): ThoughtInfo['doc'] {
  const paragraph: Record<string, unknown> = { type: 'paragraph' };
  if (text) {
    paragraph.content = [{ type: 'text', text }];
  }
  return {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: [paragraph] },
  };
}

export function ThoughtCard({ thought }: ThoughtCardProps) {
  const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');
  const [draft, setDraft] = useState(() => extractFirstParaText(thought.doc));
  const saveTimer = useRef<number | null>(null);
  const lastSavedRef = useRef(draft);

  // 切换到不同 thought 时同步草稿(避免 stale)
  useEffect(() => {
    const fresh = extractFirstParaText(thought.doc);
    setDraft(fresh);
    lastSavedRef.current = fresh;
  }, [thought.id, thought.doc]);

  // debounce 2s 落库(防抖)
  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      lastSavedRef.current = draft;
      void thoughtApi.updateThought(thought.id, { doc: wrapPlainText(draft) });
    }, 1000);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draft, thought.id, thoughtApi]);

  const meta = THOUGHT_TYPE_META[thought.type];
  const cardClass = [
    'krig-thought-card',
    thought.resolved ? 'resolved' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      <div className="krig-thought-card-header">
        <select
          className="krig-thought-type-select"
          value={thought.type}
          onChange={(e) =>
            commandRegistry.execute('thought-view.change-type', {
              id: thought.id,
              type: e.target.value as ThoughtType,
            })
          }
          aria-label="思考类型"
        >
          {TYPES.map((t) => {
            const m = THOUGHT_TYPE_META[t];
            return (
              <option key={t} value={t}>
                {m.icon} {m.label}
              </option>
            );
          })}
        </select>

        <div className="krig-thought-card-actions">
          <button
            className={`krig-thought-action ${thought.pinned ? 'on' : ''}`}
            title={thought.pinned ? '取消置顶' : '置顶'}
            onClick={() => commandRegistry.execute('thought-view.toggle-pinned', thought.id)}
          >
            📌
          </button>
          <button
            className={`krig-thought-action ${thought.resolved ? 'on' : ''}`}
            title={thought.resolved ? '撤销解决' : '标记解决'}
            onClick={() => commandRegistry.execute('thought-view.toggle-resolve', thought.id)}
          >
            ✓
          </button>
          <button
            className="krig-thought-action danger"
            title="删除"
            onClick={() => commandRegistry.execute('thought-view.delete-active')}
          >
            🗑
          </button>
        </div>
      </div>

      {thought.anchor && (
        <div className="krig-thought-card-anchor">
          {anchorBadge(thought)}
        </div>
      )}

      <textarea
        className="krig-thought-card-editor"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`记一条 ${meta.label}...`}
        aria-label="思考内容"
      />
    </div>
  );
}

function anchorBadge(t: ThoughtInfo): React.ReactNode {
  if (!t.anchor) return null;
  const sourceText = {
    note: '📝 Note',
    book: '📚 Book',
    graph: '📊 Graph',
    canvas: '🎨 Canvas',
  }[t.anchor.source];
  // v0.5 §8.3:anchor 元数据在但 source 资源已删 → dangling-anchor。
  // Phase 2 仅 UI 显示,不做实时探测(Phase 3+ 接入跨槽 ping)。
  const locator = t.anchor.locator as { text?: string; textContent?: string };
  const anchorText = locator.text ?? locator.textContent ?? '';
  return (
    <>
      <span className="krig-thought-anchor-source">{sourceText}</span>
      {anchorText && (
        <span className="krig-thought-anchor-text" title={anchorText}>
          {anchorText.slice(0, 40)}{anchorText.length > 40 ? '…' : ''}
        </span>
      )}
    </>
  );
}
