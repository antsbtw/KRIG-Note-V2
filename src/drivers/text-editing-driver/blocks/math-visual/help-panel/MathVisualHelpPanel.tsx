/**
 * MathVisualHelpPanel — 函数图形参考 React 面板(V2)
 *
 * V1 vanilla DOM(createHelpPanel + showHelpPanel)→ V2 React Component(helpPanelRegistry +
 * helpPanelController)。功能等价:
 * - 顶部 Tab(8 分类)切换
 * - 每个 Tab 显示模板列表;点 preview 行 → 展开 detail(desc + code + Insert)
 * - Insert 按钮 → 调 SSOT context.insertFn(code) → inline 当前 math-visual 插表达式
 *
 * KaTeX 渲染走 driver components/KaTexHelpers.tsx 的 KaTeX 组件(已迁,走 capability)。
 */

import React, { useState, useRef, useEffect } from 'react';
import katex from 'katex';
import type { HelpPanelCloseProps } from '@slot/interaction-registries/help-panel-registry/help-panel-types';
import {
  getMathVisualHelpContext,
  clearMathVisualHelpContext,
} from './help-context';
import {
  MATH_VISUAL_CATEGORIES,
  type MathVisualTemplate,
} from './data';

// ─── KaTeX 行内渲染(driver 直 import katex,V2 已装) ─────

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
  tmpl: MathVisualTemplate;
  onInsert: (code: string) => void;
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
        <span className="mv-help__preview-title">{tmpl.label}</span>
        {tmpl.preview && <KaTeXFormula tex={tmpl.preview} />}
      </div>
      {expanded && (
        <div className="mv-help__detail">
          <span className="mv-help__detail-desc">{tmpl.desc}</span>
          {tmpl.code && (
            <>
              <code className="mv-help__code">{tmpl.code}</code>
              <button
                className="mv-help__action-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onInsert(tmpl.code);
                }}
              >
                Insert
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 主面板 ─────────────────────────────────────────

export const MathVisualHelpPanel: React.FC<HelpPanelCloseProps> = () => {
  const ctxRef = useRef(getMathVisualHelpContext());
  const [activeCat, setActiveCat] = useState(MATH_VISUAL_CATEGORIES[0].id);

  // unmount 时清 context(对齐 menu-context cleanup 模式)
  useEffect(() => {
    return () => clearMathVisualHelpContext();
  }, []);

  const handleInsert = (code: string) => {
    ctxRef.current?.insertFn(code);
  };

  const activeCategory = MATH_VISUAL_CATEGORIES.find((c) => c.id === activeCat);

  return (
    <div className="mv-help">
      <div className="mv-help__tabs">
        {MATH_VISUAL_CATEGORIES.map((cat) => (
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
