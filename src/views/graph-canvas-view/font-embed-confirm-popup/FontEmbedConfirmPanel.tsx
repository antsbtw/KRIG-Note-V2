/**
 * FontEmbedConfirmPanel — 嵌入系统字体确认弹窗(L5-G7.4)
 *
 * 用户在 node-toolbar Aa 面板「系统字体」分组里选了一个字体 → 先弹本面板:
 *   1. 显字体名 + 体积
 *   2. 8MB 守卫:超阈值时显著提示"该字体较大,将增大文档体积"
 *   3. license 提示(设计 §6 锁定文案):嵌入即随画板分发,商业字体慎用
 *   4. 点「嵌入」→ resolve(true);「取消」/ESC/点外 → resolve(false)
 *
 * 仿 X 2.5-a send-confirm-popup:popupController.show + 模块级 pending-context
 * (consume on mount)+ PopupCloseProps.onClose。pending 带 resolve 回调,保证无论
 * 哪条关闭路径都把 await 的 embedSystemFont 结掉(不泄漏 promise)。
 */

import { useEffect, useMemo, useRef } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import {
  consumePendingFontEmbedConfirm,
  FONT_EMBED_LICENSE_TEXT,
  type FontEmbedConfirmContext,
} from './panel-context';
import './font-embed-confirm-popup.css';

export function FontEmbedConfirmPanel({ onClose }: PopupCloseProps) {
  // mount 读 pending,读完即清(useMemo 仅一次)
  const ctx = useMemo<FontEmbedConfirmContext | null>(() => consumePendingFontEmbedConfirm(), []);

  // onClose 是父级每次 re-render 新建闭包,用 ref 持最新(对齐 XSendConfirmPanel)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // resolve 守卫:无论哪条路径都只结一次。默认(关闭/ESC/点外)= 取消。
  // 用 ref 持 resolve + 已结标记,卸载兜底 effect 无需依赖(避免 exhaustive-deps)。
  const settleRef = useRef<{ done: boolean; resolve?: (v: boolean) => void }>({ done: false });
  settleRef.current.resolve = ctx?.resolve;
  const settle = (confirmed: boolean): void => {
    if (settleRef.current.done) return;
    settleRef.current.done = true;
    settleRef.current.resolve?.(confirmed);
  };

  // 卸载兜底:若组件因点外 / ESC 被 binding 关掉而没走按钮,卸载时按取消结掉
  useEffect(() => {
    const ref = settleRef.current;
    return () => {
      if (!ref.done) {
        ref.done = true;
        ref.resolve?.(false);
      }
    };
  }, []);

  useEffect(() => {
    if (!ctx) {
      console.warn('[FontEmbedConfirmPanel] no pending context, closing');
      onCloseRef.current();
    }
  }, [ctx]);

  if (!ctx) return null;

  const confirm = (): void => {
    settle(true);
    onCloseRef.current();
  };
  const cancel = (): void => {
    settle(false);
    onCloseRef.current();
  };

  const sizeText = ctx.sizeKb > 0 ? `${(ctx.sizeKb / 1024).toFixed(1)} MB` : '未知大小';

  return (
    <div
      className="krig-font-embed-confirm"
      role="dialog"
      aria-label="嵌入系统字体"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="krig-font-embed-confirm__title">嵌入系统字体</div>
      <div className="krig-font-embed-confirm__family">{ctx.family}</div>
      <div className="krig-font-embed-confirm__size">
        体积:{sizeText}
        {ctx.overThreshold && (
          <span className="krig-font-embed-confirm__warn">
            ⚠️ 该字体较大,将明显增大画板文档体积
          </span>
        )}
      </div>

      <div className="krig-font-embed-confirm__license">{FONT_EMBED_LICENSE_TEXT}</div>

      <div className="krig-font-embed-confirm__actions">
        <button type="button" className="krig-font-embed-confirm__btn" onClick={cancel}>
          取消
        </button>
        <button
          type="button"
          className="krig-font-embed-confirm__btn is-primary"
          onClick={confirm}
        >
          嵌入
        </button>
      </div>
    </div>
  );
}
