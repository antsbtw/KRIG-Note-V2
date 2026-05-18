/**
 * ThoughtCard — V1 形态对齐(inline 展开/收起 + 蓝色 anchor 引文 + Editor + bottom actions)
 *
 * 见 V1 src/plugins/thought/components/ThoughtCard.tsx:
 *   - header click → toggle expanded(active 时自动展开 + scrollIntoView)
 *   - 收起时:仅显 icon + title + time + chevron(性能优化销毁 Editor)
 *   - 展开时:anchor 引文条(点 ↗ 跳源)+ Editor + bottom action bar
 *     (type 切换菜单 / 完成/重开 / 删除;ai-response 加复制)
 */

import { useEffect, useRef, useState } from 'react';
import { commandRegistry } from '@slot/command-registry/command-registry';
import type { ThoughtInfo } from '@capabilities/thought/types';
import {
  THOUGHT_TYPE_META,
  type ThoughtType,
} from '@shared/ipc/thought-types';
import { ThoughtCardEditor } from './ThoughtCardEditor';

interface ThoughtCardProps {
  thought: ThoughtInfo;
  isActive: boolean;
  onActivate: (id: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function extractTitle(t: ThoughtInfo): string {
  const root = t.doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  if (!root?.content) return '';
  for (const block of root.content) {
    const children = block.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(children)) continue;
    for (const c of children) {
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        return c.text.trim().slice(0, 60);
      }
    }
  }
  return '';
}

function extractFullText(t: ThoughtInfo): string {
  const root = t.doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  if (!root?.content) return '';
  return root.content
    .map((b) => {
      const children = b.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(children)) return '';
      return children
        .filter((c) => c.type === 'text')
        .map((c) => (c.text as string) ?? '')
        .join('');
    })
    .join('\n');
}

function anchorPreviewText(t: ThoughtInfo): string {
  if (!t.anchor) return '';
  const loc = t.anchor.locator as { text?: string; textContent?: string };
  return loc.text ?? loc.textContent ?? '';
}

export function ThoughtCard({ thought, isActive, onActivate }: ThoughtCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // V1 同模式:active 时自动展开 + scrollIntoView。
  // **deps 字面只 isActive** — 含 expanded 会让用户手动收起后立刻被 effect
  // 反弹回展开(active && !expanded → setExpanded(true)),用户无法 toggle 收起。
  // V1 src/plugins/thought/components/ThoughtCard.tsx:45 字面 deps:[isActive]。
  useEffect(() => {
    if (isActive && !expanded) setExpanded(true);
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const meta = THOUGHT_TYPE_META[thought.type];
  const isAI = thought.type === 'ai-response';
  const title = extractTitle(thought);
  const isAiPending = isAI && !title;
  const anchorText = anchorPreviewText(thought);
  const displayTitle = isAI
    ? (isAiPending ? 'AI 思考中...' : (title || 'AI 回复'))
    : (title || '空思考');

  const cardClass = [
    'thought-card',
    isActive ? 'thought-card--active' : '',
    thought.resolved ? 'thought-card--resolved' : '',
  ].filter(Boolean).join(' ');

  const cardStyle = isActive
    ? { borderColor: meta.color, borderWidth: 2 }
    : undefined;

  const handleToggle = (): void => {
    setExpanded((p) => !p);
    onActivate(thought.id);
  };

  const handleScrollToSource = (e: React.MouseEvent): void => {
    e.stopPropagation();
    commandRegistry.execute('thought-view.scroll-to-source', thought.id);
  };

  const handleTypeChange = (newType: ThoughtType): void => {
    commandRegistry.execute('thought-view.change-type', {
      id: thought.id,
      type: newType,
    });
    setShowTypeMenu(false);
  };

  const handleResolve = (): void => {
    commandRegistry.execute('thought-view.toggle-resolve', thought.id);
  };

  const handleDelete = (): void => {
    commandRegistry.execute('thought-view.delete-thought', thought.id);
  };

  const handleCopyAi = (): void => {
    const text = extractFullText(thought);
    if (text) void navigator.clipboard?.writeText(text);
  };

  return (
    <div ref={cardRef} className={cardClass} style={cardStyle}>
      {/* Header */}
      <div className="thought-card__header" onClick={handleToggle}>
        <span className="thought-card__icon">{meta.icon}</span>
        <span className="thought-card__title">{displayTitle}</span>
        {isAI && thought.serviceId && (
          <span
            className="thought-card__service"
            style={{ color: meta.color }}
          >
            {thought.serviceId}
          </span>
        )}
        <span className="thought-card__time">{formatTime(thought.createdAt)}</span>
        <span className="thought-card__chevron">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <>
          {/* Anchor 引文条 — 点 ↗ 跳源 */}
          {anchorText && (
            <div
              className="thought-card__anchor"
              onClick={handleScrollToSource}
              title="点击跳转到原文位置"
              style={{ borderLeftColor: meta.color }}
            >
              <span className="thought-card__anchor-text">{anchorText}</span>
              <span className="thought-card__anchor-jump">↗</span>
            </div>
          )}

          {/* Editor 区(ai-response pending 时显 spinner 替代) */}
          {isAiPending ? (
            <div className="thought-card__ai-pending">
              <span className="thought-card__ai-spinner" aria-hidden>🤖</span>
              <span>AI 正在思考...</span>
            </div>
          ) : (
            <div className="thought-card__editor">
              <ThoughtCardEditor
                key={thought.id}
                thought={thought}
                readOnly={isAI}
              />
            </div>
          )}

          {/* Bottom action bar */}
          <div className="thought-card__actions">
            <div className="thought-card__type-switcher">
              <button
                className="thought-card__action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowTypeMenu((p) => !p);
                }}
              >
                {meta.icon} {meta.label} ▾
              </button>
              {showTypeMenu && (
                <div className="thought-card__type-menu">
                  {(Object.keys(THOUGHT_TYPE_META) as ThoughtType[]).map((t) => (
                    <button
                      key={t}
                      className={`thought-card__type-option ${t === thought.type ? 'thought-card__type-option--active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTypeChange(t);
                      }}
                    >
                      {THOUGHT_TYPE_META[t].icon} {THOUGHT_TYPE_META[t].label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isAI && !isAiPending && (
              <button
                className="thought-card__action-btn"
                onClick={handleCopyAi}
                title="复制 Markdown"
              >
                📋 复制
              </button>
            )}

            <button
              className={`thought-card__action-btn ${thought.resolved ? 'thought-card__action-btn--resolved' : ''}`}
              onClick={handleResolve}
            >
              {thought.resolved ? '↩ 重开' : '√ 完成'}
            </button>

            <button
              className="thought-card__action-btn thought-card__action-btn--danger"
              onClick={handleDelete}
            >
              🗑
            </button>
          </div>
        </>
      )}
    </div>
  );
}
