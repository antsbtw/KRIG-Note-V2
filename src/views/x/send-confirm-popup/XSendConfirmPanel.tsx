/**
 * XSendConfirmPanel — 「发到 X」发送前确认弹窗(X 集成 阶段 2.5-a,写方向)
 *
 * 用户右键「𝕏 发到 X」→ send-to-x 抓选区/整篇 → markdownToTweetText 降级 → **不再盲注入**,
 * 先弹本面板让用户:
 *   1. 看降级后的纯文本(所见即所发,markdown 标记已去、链接已改写)
 *   2. 看字数 / 超限标红提示(checkTweetLength;超限仍允许继续,X 那边会拦)
 *   3. 看发送类型(普通推 vs 回复某推)
 *   4. 最后改一版(可编辑;改动只作用于这次注入,**不回写 note**)
 *   5. 点「填入 X」才注入 / 点「取消」直接关(不注入、不消费 pending reply)
 *
 * ⚠️ 写方向红线:本弹窗只到「填入 X 框」。确认后绝不程序点 X 发布按钮 —— 文案明示
 *    「填入后还要自己在 X 点发布」。
 *
 * 复用 ask-ai-popup 模式:popupController.show + 模块级 pending-context(consume on mount)
 * + PopupCloseProps.onClose。样式独立(x-send-confirm-popup.css),不动 ask-ai-popup。
 *
 * 操作:
 * - 点「填入 X」/「取消」
 * - Esc 取消(= onClose,不注入)
 * - 点击外部 binding 自动关闭(= 取消)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { checkTweetLength } from '@shared/x/markdown-to-tweet';
import { consumePendingXSendConfirm, type XSendConfirmContext } from './panel-context';
import './x-send-confirm-popup.css';

/** 从视频源(media:// 或磁盘绝对路径)取末段文件名,供弹窗显示(取不到则原样)。 */
function videoFileName(url: string): string {
  const clean = url.replace(/^media:\/\//, '').split(/[?#]/)[0];
  const seg = clean.split(/[/\\]/).filter(Boolean).pop();
  return seg || url;
}

export function XSendConfirmPanel({ onClose }: PopupCloseProps) {
  // mount 时读 pending ctx;读完即清(useMemo 保仅跑一次)。
  const ctx = useMemo<XSendConfirmContext | null>(() => consumePendingXSendConfirm(), []);
  const [text, setText] = useState(() => ctx?.text ?? '');
  /** 用户当前保留的媒体清单(可移除某张,只影响本次发送)*/
  const [mediaUrls, setMediaUrls] = useState<string[]>(() => ctx?.mediaUrls ?? []);
  /** 用户当前保留的视频清单(X 互斥:有视频时图为空;可移除,只影响本次发送)*/
  const [videoUrls, setVideoUrls] = useState<string[]>(() => ctx?.videoUrls ?? []);
  /** 注入进行中(await onConfirm 期间禁按钮防重复点)*/
  const [injecting, setInjecting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // onClose 是父级(PopupBinding)每次 re-render 新建的闭包,用 ref 持最新,
  // 不进 effect 依赖(对齐 EmojiPickerPanel 的踩坑注释)。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // 延迟 focus 避免与 popup binding 内 click 冲突(同 AskAIPanel)
    const t = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, []);

  // ctx=null 是边角(直接打开但 pending 已被消费),不应发生 — 兜底 close。
  useEffect(() => {
    if (!ctx) {
      console.warn('[XSendConfirmPanel] no pending context, closing');
      onCloseRef.current();
    }
  }, [ctx]);

  if (!ctx) return null;

  const len = checkTweetLength(text);
  const isReply = ctx.replyPreview != null;
  const hasMedia = mediaUrls.length > 0 || videoUrls.length > 0;
  // 可发 = 有文字**或**有媒体(X 截图后:纯公式/纯图/纯视频推正文为空但带媒体,也应可发)。
  const canSend = (text.trim().length > 0 || hasMedia) && !injecting;

  async function handleConfirm(): Promise<void> {
    if (!ctx || injecting) return;
    const finalText = text.trim();
    // 文字为空但有媒体(纯公式/纯图/纯视频推)仍可发;皆空才挡。
    if (!finalText && mediaUrls.length === 0 && videoUrls.length === 0) return;
    setInjecting(true);
    try {
      // 注入 + 失败降级全在 onConfirm 内(send-to-x 侧)。本弹窗只负责确认 + 关闭。
      // 第二/三参回传用户保留下的图/视频清单(可能已移除某项)。
      await ctx.onConfirm(finalText, mediaUrls, videoUrls);
    } catch (err) {
      // onConfirm 内部已 fail-loud 降级处理;此处兜底防未捕获异常吞掉关闭。
      console.warn('[XSendConfirmPanel] onConfirm threw:', err);
    } finally {
      onCloseRef.current();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // ⌘/Ctrl + Enter 确认(普通 Enter 留给换行 —— 推文常多行)
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCloseRef.current(); // 取消:不注入、不消费 pending reply
    }
  }

  return (
    <div className="krig-x-send-confirm" onMouseDown={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="krig-x-send-confirm__header">
        <span className="krig-x-send-confirm__title">
          𝕏 {isReply ? '确认回复内容' : '确认发推内容'}
        </span>
        <button
          type="button"
          className="krig-x-send-confirm__close"
          onClick={() => onCloseRef.current()}
          title="取消 (Esc)"
          aria-label="取消"
        >
          ×
        </button>
      </div>

      {/* 发送类型 / 来源 */}
      <div className="krig-x-send-confirm__meta">
        {isReply ? (
          <span className="krig-x-send-confirm__reply-to">
            回复给:{ctx.replyPreview}
          </span>
        ) : (
          <span className="krig-x-send-confirm__source">
            {ctx.usedWholeDoc ? '来源:整篇 Note' : '来源:Note 选区'}
          </span>
        )}
      </div>

      {/* 媒体缩略图栏(阶段 2.5-b):显示将带的图 + 可移除某张(只影响本次发送)。
          media:// 是 privileged scheme,<img> 可直接渲染。*/}
      {mediaUrls.length > 0 && (
        <div className="krig-x-send-confirm__media">
          <div className="krig-x-send-confirm__media-label">
            将带 {mediaUrls.length} 张图
            {ctx.totalImageCount > 4 && (
              <span className="krig-x-send-confirm__media-trunc">
                (共 {ctx.totalImageCount} 张,X 限 4 张,仅带前 4 张)
              </span>
            )}
          </div>
          <div className="krig-x-send-confirm__media-thumbs">
            {mediaUrls.map((url, i) => (
              <div key={url + i} className="krig-x-send-confirm__thumb">
                <img src={url} alt={`媒体 ${i + 1}`} className="krig-x-send-confirm__thumb-img" />
                <button
                  type="button"
                  className="krig-x-send-confirm__thumb-remove"
                  onClick={() => setMediaUrls((prev) => prev.filter((_, j) => j !== i))}
                  title="不带这张图(只影响本次发送)"
                  aria-label="移除此图"
                  disabled={injecting}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 视频项栏(阶段 2.5-b 视频):X 一条推最多 1 个视频,且与图互斥(有视频时上面图栏为空)。
          视频源可能是 localFilePath 绝对路径(渲染进程无法 file:// 取),故只显文件名 + 可移除,不显缩略图。*/}
      {videoUrls.length > 0 && (
        <div className="krig-x-send-confirm__media">
          <div className="krig-x-send-confirm__media-label">
            将带 1 个视频
            {ctx.totalVideoCount > 1 && (
              <span className="krig-x-send-confirm__media-trunc">
                (共 {ctx.totalVideoCount} 个,X 限 1 个,仅带第 1 个)
              </span>
            )}
          </div>
          <div className="krig-x-send-confirm__media-thumbs">
            {videoUrls.map((url, i) => (
              <div key={url + i} className="krig-x-send-confirm__video-item">
                <span className="krig-x-send-confirm__video-icon" aria-hidden>🎬</span>
                <span className="krig-x-send-confirm__video-name" title={url}>
                  {videoFileName(url)}
                </span>
                <button
                  type="button"
                  className="krig-x-send-confirm__thumb-remove"
                  onClick={() => setVideoUrls((prev) => prev.filter((_, j) => j !== i))}
                  title="不带这个视频(只影响本次发送)"
                  aria-label="移除此视频"
                  disabled={injecting}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 可编辑预览(所见即所发;改动不回写 note)*/}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        className="krig-x-send-confirm__textarea"
        rows={6}
        spellCheck={false}
        disabled={injecting}
      />

      {/* 字数 + 超限提示 */}
      <div className="krig-x-send-confirm__count-row">
        <span
          className={
            'krig-x-send-confirm__count' +
            (len.overLimit ? ' krig-x-send-confirm__count--over' : '')
          }
        >
          {len.length} / {len.limit}
        </span>
        {len.overLimit && (
          <span className="krig-x-send-confirm__warn">
            超出上限,X 会标红不让发 —— 仍可填入,你可在 X 精简或留作 thread
          </span>
        )}
      </div>

      {/* 写方向红线提示文案 */}
      <p className="krig-x-send-confirm__hint">
        填入后内容仅出现在 X 输入框,需你自己在 X 点{isReply ? '「回复」' : '「发布」'}才会真正发出。
      </p>

      {/* 操作 */}
      <div className="krig-x-send-confirm__actions">
        <button
          type="button"
          className="krig-x-send-confirm__cancel"
          onClick={() => onCloseRef.current()}
          disabled={injecting}
        >
          取消
        </button>
        <button
          type="button"
          className="krig-x-send-confirm__confirm"
          onClick={() => void handleConfirm()}
          disabled={!canSend}
          title="填入 X(⌘/Ctrl+Enter)"
        >
          {injecting ? '填入中…' : '填入 X ▶'}
        </button>
      </div>
    </div>
  );
}
