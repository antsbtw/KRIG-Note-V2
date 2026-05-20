/**
 * LatexHelpPanel — LaTeX 公式速查 React 面板(V2)
 *
 * V1 vanilla DOM(createHelpPanel + showHelpPanel)→ V2 React Component(helpPanelRegistry +
 * helpPanelController)。功能等价:
 * - 顶部 Tab(16 分类)切换
 * - 每个 Tab 显示模板列表;点 preview 行 → 展开 detail(LaTeX 源码 + Insert)
 * - Insert 按钮 → 调 SSOT context.insertFn(latex) → 当前 math-block / math-inline 插入
 *
 * 结构对齐 math-visual/help-panel/MathVisualHelpPanel.tsx — 复用同套 .mv-help__* CSS。
 */

import React, { useState, useRef, useEffect } from 'react';
import katex from 'katex';
import type { HelpPanelCloseProps } from '@slot/interaction-registries/help-panel-registry/help-panel-types';
import {
  getLatexHelpContext,
  clearLatexHelpContext,
} from './help-context';
import {
  MATH_CATEGORIES,
  type MathTemplate,
} from './data';

// ─── KaTeX 行内渲染 ─────

function KaTeXFormula({ tex }: { tex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(tex, ref.current, {
        throwOnError: false,
        displayMode: false,
        output: 'html',
      });
    } catch {
      if (ref.current) ref.current.textContent = tex;
    }
  }, [tex]);
  return <span ref={ref} className="mv-help__preview-formula" />;
}

// ─── 模板条目 ───────────────────────────────────────

function TemplateItem({
  tmpl,
  onInsert,
}: {
  tmpl: MathTemplate;
  onInsert: (latex: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`mv-help__item ${expanded ? 'mv-help__item--expanded' : ''}`}>
      <div
        className="mv-help__preview"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        <KaTeXFormula tex={tmpl.label} />
      </div>
      {expanded && (
        <div className="mv-help__detail">
          <code className="mv-help__code">{tmpl.latex.trim()}</code>
          <button
            className="mv-help__action-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInsert(tmpl.latex);
            }}
          >
            Insert
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 主面板 ─────────────────────────────────────────

export const LatexHelpPanel: React.FC<HelpPanelCloseProps> = () => {
  const ctxRef = useRef(getLatexHelpContext());
  const [activeCat, setActiveCat] = useState(MATH_CATEGORIES[0].id);

  // 每次 mount 重新抓 context — 切换 active block 时旧的 panel 还未 unmount
  // 但 controller.show 是 idempotent;靠 onInsert 时刻取 latest context 兜底
  useEffect(() => {
    ctxRef.current = getLatexHelpContext();
    return () => clearLatexHelpContext();
  }, []);

  const handleInsert = (latex: string) => {
    // 兜底:每次 Insert 重抓 SSOT,防 panel 长开期间 context 被覆盖到新 block
    const latest = getLatexHelpContext() ?? ctxRef.current;
    latest?.insertFn(latex);
  };

  const activeCategory = MATH_CATEGORIES.find((c) => c.id === activeCat);

  return (
    <div className="mv-help mv-help--latex">
      <div className="mv-help__tabs">
        {MATH_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`mv-help__tab ${activeCat === cat.id ? 'mv-help__tab--active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveCat(cat.id);
            }}
            title={cat.name}
          >
            {cat.name}
          </button>
        ))}
      </div>
      <div className="mv-help__content">
        {activeCategory?.templates.map((tmpl, i) => (
          <TemplateItem key={`${activeCat}-${i}`} tmpl={tmpl} onInsert={handleInsert} />
        ))}
      </div>
    </div>
  );
};
