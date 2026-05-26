/**
 * ExpressionDialog — 表达式 modal,LaTeX 实时预览
 *
 * 统一两种入口:
 * - 添加新函数: title="添加函数",initialValue 空
 * - 编辑现有函数: title="编辑表达式",initialValue=fn.displayExpression
 *
 * 输入框接受任意表达式:`x^2` / `y = sin(x)` / `x^2+y^2=1` / 参数方程 `cos(t); sin(t)`。
 * 实时 KaTeX 预览(复用 LatexDisplay — 内部 mathjs → LaTeX → KaTeX)。
 * Esc/外部点击/取消 = 取消;Enter/确认 = 提交。
 */

import React, { useState, useEffect, useRef } from 'react';
import { LatexDisplay } from './KaTexHelpers';

export function ExpressionDialog({
  initialValue = '',
  title = '添加函数',
  onConfirm,
  onCancel,
}: {
  initialValue?: string;
  title?: string;
  onConfirm: (expression: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 自动聚焦 + 选中所有(编辑态下方便直接覆盖)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initialValue) el.select();
  }, [initialValue]);

  // 点击 dialog 外部关闭
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dialogRef.current && !dialogRef.current.contains(target)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onCancel]);

  function handleConfirm() {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div className="mv-add-dialog-overlay">
      <div ref={dialogRef} className="mv-add-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mv-add-dialog__title">{title}</div>
        <input
          ref={inputRef}
          className="mv-add-dialog__input"
          placeholder="例如: x^2 / y=sin(x) / x^2+y^2=1 / cos(t);sin(t)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleConfirm();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
            e.stopPropagation();
          }}
        />
        <div className="mv-add-dialog__preview">
          {value.trim() ? (
            <LatexDisplay expression={value.trim()} />
          ) : (
            <span className="mv-add-dialog__preview-placeholder">预览</span>
          )}
        </div>
        <div className="mv-add-dialog__actions">
          <button className="mv-add-dialog__btn" onClick={onCancel}>取消</button>
          <button
            className="mv-add-dialog__btn mv-add-dialog__btn--primary"
            onClick={handleConfirm}
            disabled={!value.trim()}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
