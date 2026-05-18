/**
 * KaTeX 渲染辅助组件
 *
 * 1:1 迁自 V1 `src/plugins/note/blocks/math-visual/components/KaTexHelpers.tsx`,
 * **mathjs 直 import 改走 capability** (`requireCapabilityApi('math-rendering').exprToLatex`)。
 * KaTeX 本身 V2 已装(^0.16.45),driver 内继续直 import。
 */

import React, { useRef, useEffect, useMemo } from 'react';
import katex from 'katex';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MathRenderingApi } from '@capabilities/math-rendering/types';

/** KaTeX 渲染组件 */
export function KaTeX({ tex, fallback }: { tex: string; fallback?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      katex.render(tex, ref.current, { throwOnError: false, displayMode: false });
    } catch {
      if (ref.current) ref.current.textContent = fallback || tex;
    }
  }, [tex, fallback]);
  return <span ref={ref} className="mv-fn-expr-tex" />;
}

/** 表达式的 KaTeX 展示(mathjs → LaTeX,走 capability) */
export function LatexDisplay({ expression }: { expression: string }) {
  const latex = useMemo(() => {
    const { exprToLatex } = requireCapabilityApi<MathRenderingApi>('math-rendering');
    return exprToLatex(expression);
  }, [expression]);
  if (!latex) {
    return <span className="mv-fn-expr-text">{expression || '点击输入表达式'}</span>;
  }
  return <KaTeX tex={latex} fallback={expression} />;
}
