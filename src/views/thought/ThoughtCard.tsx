/**
 * ThoughtCard — 单个 thought 详情卡片(主舞台右区)
 *
 * Phase 5.2 升级:文本编辑由 ThoughtCardEditor(text-editing.Host 薄包装)承担。
 *
 * 操作:type 切换(9 种)/ resolve / pin / delete。
 * 状态:dangling-anchor 角标(anchor 在但 text 空)— v0.5 §8.3。
 * AI:type='ai-response' 且 doc 空 → spinner;非空 → Host readOnly + 复制按钮。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import type { ThoughtInfo } from '@capabilities/thought/types';
import {
  THOUGHT_TYPE_META,
  type ThoughtType,
} from '@shared/ipc/thought-types';
import { ThoughtCardEditor } from './ThoughtCardEditor';

interface ThoughtCardProps {
  thought: ThoughtInfo;
}

const TYPES: ThoughtType[] = [
  'thought', 'question', 'important', 'todo', 'analysis', 'ai-response',
  'highlight', 'underline', 'rect-frame',
];

function extractPlainText(doc: ThoughtInfo['doc']): string {
  const root = doc.payload as { content?: Array<Record<string, unknown>> } | undefined;
  if (!root?.content) return '';
  return root.content.map(extractBlockText).join('\n');
}

function extractBlockText(node: Record<string, unknown>): string {
  if (node.type === 'text') return (node.text as string) ?? '';
  const children = node.content as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(children)) return '';
  return children.map(extractBlockText).join('');
}

function isAiPending(t: ThoughtInfo): boolean {
  if (t.type !== 'ai-response') return false;
  return extractPlainText(t.doc).trim().length === 0;
}

function copyToClipboard(text: string): void {
  void navigator.clipboard?.writeText(text).catch((e) => {
    console.warn('[thought-card] clipboard failed:', e);
  });
}

function anchorBadge(t: ThoughtInfo): React.ReactNode {
  if (!t.anchor) return null;
  const sourceText = {
    note: '📝 Note',
    book: '📚 Book',
    graph: '📊 Graph',
    canvas: '🎨 Canvas',
  }[t.anchor.source];
  // v0.5 §8.3 dangling-anchor 简化探测:
  //   anchor 存在但 locator.text/textContent 都空 → 视为锚点失效(兜底视觉,
  //   真实 source 探测留后续 sub-phase 异步路径)。
  const locator = t.anchor.locator as { text?: string; textContent?: string };
  const anchorText = locator.text ?? locator.textContent ?? '';
  const isDangling = !anchorText.trim();
  return (
    <>
      <span className="krig-thought-anchor-source">{sourceText}</span>
      {isDangling ? (
        <span className="krig-thought-anchor-dangling" title="锚点失效 — 点击解依附">
          ⚠️ 锚点失效
        </span>
      ) : (
        <span className="krig-thought-anchor-text" title={anchorText}>
          {anchorText.slice(0, 40)}{anchorText.length > 40 ? '…' : ''}
        </span>
      )}
    </>
  );
}

export function ThoughtCard({ thought }: ThoughtCardProps) {
  const cardClass = [
    'krig-thought-card',
    thought.resolved ? 'resolved' : '',
  ].filter(Boolean).join(' ');
  const aiPending = isAiPending(thought);
  const aiReadOnly = thought.type === 'ai-response' && !aiPending;

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
        <div
          className="krig-thought-card-anchor clickable"
          onClick={() =>
            commandRegistry.execute('thought-view.scroll-to-source', thought.id)
          }
          title="跳转到源"
        >
          {anchorBadge(thought)}
        </div>
      )}

      {aiPending ? (
        <div className="krig-thought-card-ai-pending" aria-label="AI 正在回复">
          <span className="krig-thought-ai-spinner" aria-hidden>🤖</span>
          <span>AI 正在思考...</span>
        </div>
      ) : (
        // key={thought.id}:切换 thought 时强制 remount Host instance(避 stale state)
        <ThoughtCardEditor
          key={thought.id}
          thought={thought}
          readOnly={aiReadOnly}
        />
      )}
      {aiReadOnly && (
        <button
          className="krig-thought-card-copy"
          onClick={() => copyToClipboard(extractPlainText(thought.doc))}
          title="复制 AI 回复"
        >
          📋 复制
        </button>
      )}
    </div>
  );
}
