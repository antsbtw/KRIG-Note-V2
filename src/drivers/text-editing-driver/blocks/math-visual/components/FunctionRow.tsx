/**
 * FunctionRow — 单条函数编辑行
 *
 * 点击表达式 → 触发 onEditExpression(父级弹 ExpressionDialog 修改),
 * 不再 inline input 编辑(统一入口 = 添加新 / 编辑现有 = 同款 dialog 体验)。
 */

import React, { useState } from 'react';
import type { FunctionEntry } from '../types';
import { KaTeX, LatexDisplay } from './KaTexHelpers';
import { StylePopover } from './StylePopover';

export function FunctionRow({
  fn,
  onUpdate,
  onRemove,
  canRemove,
  error,
  onEditExpression,
}: {
  fn: FunctionEntry;
  onUpdate: (updated: Partial<FunctionEntry>) => void;
  onRemove: () => void;
  canRemove: boolean;
  error: string | null;
  onEditExpression: () => void;
}) {
  const [styleOpen, setStyleOpen] = useState(false);

  return (
    <div className={`mv-fn-row ${error ? 'mv-fn-row--error' : ''}`}>
      <span
        className="mv-fn-color mv-fn-color--clickable mv-fn-aux"
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
      <span
        className="mv-fn-expr"
        onClick={onEditExpression}
        title="点击编辑表达式"
      >
        <LatexDisplay expression={fn.displayExpression ?? fn.expression} />
      </span>
      {error && (
        <span className="mv-fn-error" title={error}>!</span>
      )}
      {/* 导数按钮 — 只在显式 y-of-x 类型显示;implicit/parametric/polar/vertical-line 不支持数值导数 */}
      {(fn.plotType === undefined || fn.plotType === 'y-of-x') && (
        <button
          className={`mv-fn-btn mv-fn-btn-tex mv-fn-aux ${fn.showDerivative ? 'mv-fn-btn--active' : ''}`}
          onClick={() => onUpdate({ showDerivative: !fn.showDerivative })}
          title="导数"
        >
          <KaTeX tex={`${fn.label.replace('(x)', "'(x)")}`} />
        </button>
      )}
      <button
        className={`mv-fn-btn mv-fn-aux ${fn.visible ? '' : 'mv-fn-btn--hidden'}`}
        onClick={() => onUpdate({ visible: !fn.visible })}
        title={fn.visible ? '隐藏' : '显示'}
      >
        {fn.visible ? '👁' : '👁‍🗨'}
      </button>
      {canRemove && (
        <button
          className="mv-fn-btn mv-fn-btn--remove mv-fn-aux"
          onClick={onRemove}
          title="移除"
        >
          ×
        </button>
      )}
    </div>
  );
}
