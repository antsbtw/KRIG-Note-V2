/**
 * sections/FunctionListSection — 函数列表 + 添加按钮(全屏 LeftPanel)
 *
 * 改造对比 PR1:
 * - 添加 / 编辑表达式统一走 ExpressionDialog(LaTeX live preview)
 * - 删 inline-editing input + draft buffer + onPaste 解码逻辑(全部移进 dialog)
 * - 函数卡片 click 直接弹 dialog,不再切 input 态
 *
 * 不变:颜色/线宽/线型 popover、导数按钮、显示切换、移除按钮
 *
 * y-of-x 导数按钮按 plotType 隐藏(implicit/parametric/polar/vertical-line 不显示)
 */

import React, { useState } from 'react';
import type { FunctionEntry } from '../../types';
import type { UseFunctionManagementResult } from '../../hooks/useFunctionManagement';
import { KaTeX, LatexDisplay } from '../../components/KaTexHelpers';
import { ExpressionDialog } from '../../components/ExpressionDialog';

interface FunctionListSectionProps {
  functions: FunctionEntry[];
  /** 一次性建函数 + 写表达式(走 hook.insertFromHelp,内部 detectPlotType + 同步参数) */
  insertFromHelp: UseFunctionManagementResult['insertFromHelp'];
  updateFunction: UseFunctionManagementResult['updateFunction'];
  removeFunction: UseFunctionManagementResult['removeFunction'];
}

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; fnId: string; initial: string }
  | null;

export const FunctionListSection: React.FC<FunctionListSectionProps> = ({
  functions: fns,
  insertFromHelp,
  updateFunction,
  removeFunction,
}) => {
  const [dialog, setDialog] = useState<DialogState>(null);

  function handleConfirm(expression: string) {
    if (!dialog) return;
    if (dialog.mode === 'add') {
      // 一次 onChange 完成"建函数 + 写表达式 + 重算参数"
      insertFromHelp(expression);
    } else {
      updateFunction(dialog.fnId, { expression });
    }
    setDialog(null);
  }

  return (
    <>
      <div className="mv-fl-section">
        <div className="mv-fl-section-title">函数</div>
        <div className="mv-fl-fn-list">
          {fns.map((fn) => (
            <FunctionCard
              key={fn.id}
              fn={fn}
              onUpdate={(updates) => updateFunction(fn.id, updates)}
              onRemove={() => removeFunction(fn.id)}
              onEdit={() =>
                setDialog({
                  mode: 'edit',
                  fnId: fn.id,
                  initial: fn.displayExpression ?? fn.expression,
                })
              }
              canRemove={fns.length > 1}
            />
          ))}
        </div>
        <button className="mv-fl-add-btn" onClick={() => setDialog({ mode: 'add' })}>
          + 添加函数
        </button>
      </div>

      {dialog && (
        <ExpressionDialog
          title={dialog.mode === 'add' ? '添加函数' : '编辑表达式'}
          initialValue={dialog.mode === 'edit' ? dialog.initial : ''}
          onConfirm={handleConfirm}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
};

// ─── 函数卡片(简化版,不再含 inline-editing input) ─────────────────

function FunctionCard({
  fn,
  onUpdate,
  onRemove,
  onEdit,
  canRemove,
}: {
  fn: FunctionEntry;
  onUpdate: (updates: Partial<FunctionEntry>) => void;
  onRemove: () => void;
  onEdit: () => void;
  canRemove: boolean;
}) {
  const [styleOpen, setStyleOpen] = useState(false);

  const COLORS = ['#2D7FF9', '#00D4AA', '#FF6B35', '#A855F7', '#EC4899', '#EAB308', '#ef4444', '#8B5CF6', '#06B6D4', '#84CC16'];

  // 导数按钮仅 y-of-x 显示(隐式/参数/极坐标/垂直线没有 dy/dx 概念)
  const supportsDerivative = !fn.plotType || fn.plotType === 'y-of-x';

  // dialog 展示的来源 = displayExpression 优先(用户原写法),退化到归一化 expression
  const displayed = fn.displayExpression ?? fn.expression;

  return (
    <div className="mv-fl-fn-card">
      <div className="mv-fl-fn-header">
        <span
          className="mv-fl-fn-color mv-fn-color--clickable"
          style={{ backgroundColor: fn.color }}
          onClick={() => setStyleOpen(!styleOpen)}
          title="点击修改颜色/线型"
        />
        <span className="mv-fl-fn-label">
          <KaTeX tex={fn.plotType === 'vertical-line' ? 'x =' : fn.label} />
        </span>
        <div style={{ flex: 1 }} />
        {supportsDerivative && (
          <button
            className={`mv-fl-fn-btn mv-fl-fn-btn-tex ${fn.showDerivative ? 'mv-fl-fn-btn--active' : ''}`}
            onClick={() => onUpdate({ showDerivative: !fn.showDerivative })}
            title="导数"
          >
            <KaTeX tex={`${fn.label.replace('(x)', "'(x)")}`} />
          </button>
        )}
        <button
          className={`mv-fl-fn-btn ${fn.visible ? '' : 'mv-fl-fn-btn--hidden'}`}
          onClick={() => onUpdate({ visible: !fn.visible })}
          title={fn.visible ? '隐藏' : '显示'}
        >
          {fn.visible ? '👁' : '👁‍🗨'}
        </button>
        {canRemove && (
          <button className="mv-fl-fn-btn mv-fl-fn-btn--remove" onClick={onRemove} title="移除">
            ×
          </button>
        )}
      </div>
      {styleOpen && (
        <div className="mv-style-popover" onMouseDown={(e) => e.stopPropagation()}>
          <div className="mv-style-colors">
            {COLORS.map((c) => (
              <span key={c}
                className={`mv-style-swatch ${c === fn.color ? 'mv-style-swatch--active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => onUpdate({ color: c })}
              />
            ))}
          </div>
          <div className="mv-style-row">
            <span className="mv-style-label">线宽</span>
            <input type="range" min="1" max="6" step="0.5" value={fn.lineWidth || 2.5}
              className="mv-style-slider"
              onChange={(e) => onUpdate({ lineWidth: Number(e.target.value) })} />
            <span className="mv-style-value">{fn.lineWidth || 2.5}</span>
          </div>
          <div className="mv-style-row">
            <span className="mv-style-label">线型</span>
            <div className="mv-style-btns">
              {(['solid', 'dashed', 'dotted'] as const).map((s) => (
                <button key={s} className={`mv-style-btn ${s === fn.style ? 'mv-style-btn--active' : ''}`}
                  onClick={() => onUpdate({ style: s })}>
                  {s === 'solid' ? '━━' : s === 'dashed' ? '╌╌' : '┈┈'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mv-fl-fn-expr-area">
        <span
          className="mv-fl-fn-expr"
          onClick={onEdit}
          title="点击编辑表达式"
        >
          {displayed ? (
            <LatexDisplay expression={displayed} />
          ) : (
            <span className="mv-fl-fn-expr-placeholder">点击添加表达式</span>
          )}
        </span>
      </div>
    </div>
  );
}
