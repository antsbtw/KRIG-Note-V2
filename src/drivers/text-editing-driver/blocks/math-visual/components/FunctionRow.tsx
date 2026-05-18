/**
 * FunctionRow — 单条函数编辑行
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/components/FunctionRow.tsx`,
 * **latex-to-mathjs 直 import 改走 capability**(`requireCapabilityApi('math-rendering').latexToMathjs`)。
 */

import React, { useState, useRef } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MathRenderingApi } from '@capabilities/math-rendering/types';
import type { FunctionEntry } from '../types';
import { KaTeX, LatexDisplay } from './KaTexHelpers';
import { StylePopover } from './StylePopover';

export function FunctionRow({
  fn,
  onUpdate,
  onRemove,
  canRemove,
  error,
}: {
  fn: FunctionEntry;
  onUpdate: (updated: Partial<FunctionEntry>) => void;
  onRemove: () => void;
  canRemove: boolean;
  error: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`mv-fn-row ${error ? 'mv-fn-row--error' : ''}`}>
      <span
        className="mv-fn-color mv-fn-color--clickable"
        style={{ backgroundColor: error ? '#ef4444' : fn.color }}
        title={error || '点击修改颜色/线型'}
        onClick={() => setStyleOpen(!styleOpen)}
      />
      {styleOpen && (
        <StylePopover
          color={fn.color}
          lineWidth={fn.lineWidth || 2.5}
          style={fn.style}
          onChangeColor={(c) => onUpdate({ color: c })}
          onChangeLineWidth={(w) => onUpdate({ lineWidth: w })}
          onChangeStyle={(s) => onUpdate({ style: s })}
        />
      )}
      <span className="mv-fn-label">
        <KaTeX tex={fn.plotType === 'vertical-line' ? 'x =' : `${fn.label} =`} />
      </span>
      {editing ? (
        <input
          ref={inputRef}
          className="mv-fn-input"
          value={fn.expression}
          onChange={(e) => onUpdate({ expression: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setEditing(false);
            e.stopPropagation();
          }}
          onPaste={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const clip = e.clipboardData;
            let text = '';

            // 1. mirro-blocks LaTeX(V1 -> V2 仍保留同字段名 — clipboard 自定义 MIME)
            const mirroBlocks = clip.getData('application/mirro-blocks');
            if (mirroBlocks) {
              try {
                const blocks = JSON.parse(mirroBlocks) as Array<Record<string, unknown>>;
                const findLatex = (nodes: Array<Record<string, unknown>>): string => {
                  for (const n of nodes) {
                    if (n.type === 'mathInline') return ((n.attrs as Record<string, unknown>)?.latex as string) || '';
                    if (n.type === 'mathBlock') {
                      const content = n.content as Array<Record<string, unknown>> | undefined;
                      return content?.map(c => (c.text as string) || '').join('') || '';
                    }
                    if (Array.isArray(n.content)) {
                      const found = findLatex(n.content as Array<Record<string, unknown>>);
                      if (found) return found;
                    }
                  }
                  return '';
                };
                text = findLatex(blocks);
              } catch { /* ignore */ }
            }

            // 2. HTML data-latex
            if (!text) {
              const html = clip.getData('text/html');
              if (html) {
                const match = html.match(/data-latex="([^"]+)"/);
                if (match) text = match[1];
                if (!text) {
                  const div = document.createElement('div');
                  div.innerHTML = html;
                  text = div.textContent || '';
                }
              }
            }

            // 3. plain text
            if (!text) text = clip.getData('text/plain') || '';

            text = text.trim();
            if (!text) return;

            const eqMatch = text.match(/^[a-zA-Z]\s*(?:\([^)]*\))?\s*=\s*(.+)$/);
            if (eqMatch) text = eqMatch[1].trim();

            const { latexToMathjs } = requireCapabilityApi<MathRenderingApi>('math-rendering');
            const expr = latexToMathjs(text);
            if (expr) {
              onUpdate({ expression: expr, sourceLatex: text });
            } else {
              onUpdate({ expression: text, sourceLatex: text });
            }
          }}
          autoFocus
        />
      ) : (
        <span
          className="mv-fn-expr"
          onClick={() => setEditing(true)}
          title="点击编辑表达式"
        >
          <LatexDisplay expression={fn.expression} />
        </span>
      )}
      {error && (
        <span className="mv-fn-error" title={error}>!</span>
      )}
      <button
        className={`mv-fn-btn mv-fn-btn-tex ${fn.showDerivative ? 'mv-fn-btn--active' : ''}`}
        onClick={() => onUpdate({ showDerivative: !fn.showDerivative })}
        title="导数"
      >
        <KaTeX tex={`${fn.label.replace('(x)', "'(x)")}`} />
      </button>
      <button
        className={`mv-fn-btn ${fn.visible ? '' : 'mv-fn-btn--hidden'}`}
        onClick={() => onUpdate({ visible: !fn.visible })}
        title={fn.visible ? '隐藏' : '显示'}
      >
        {fn.visible ? '👁' : '👁‍🗨'}
      </button>
      {canRemove && (
        <button
          className="mv-fn-btn mv-fn-btn--remove"
          onClick={onRemove}
          title="移除"
        >
          ×
        </button>
      )}
    </div>
  );
}
