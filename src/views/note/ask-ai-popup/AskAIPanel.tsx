/**
 * AskAIPanel — 问 AI 浮窗(对齐 V1 src/plugins/note/components/AskAIPanel.tsx)
 *
 * 用户在 Note 右键 🤖 问 AI → askAiFromNote 命令:
 *   1. 抓选区 markdown + PM doc JSON 存到 panel-context.ts pending
 *   2. popupController.show(ASK_AI_POPUP_ID, anchor)
 *   3. 本组件 mount 读 pending → 显示预览 + textarea + 服务选择 + 发送
 *   4. 用户编辑 instruction → 点发送(或 Enter)→ 拼 prompt 发 emit
 *   5. emit 'ai.paste-and-send' → AIView 订阅自动 paste + send
 *
 * 操作:
 * - Enter 发送(Shift+Enter 换行)
 * - Esc 取消
 * - 点击外部 binding 自动关闭
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { AI_SERVICE_PROFILES, type AIServiceId } from '@shared/types/ai-service-types';
import { consumePendingAskAIContext, type AskAIContext } from './panel-context';
import './ask-ai-popup.css';

const PREVIEW_MAX = 200;

/**
 * 拼 prompt(纯 markdown,YAGNI:之前的 JSON 块对 AI 无信息增益且重复)。
 *
 * - 有 instruction:<inst>\n\n<markdown>(AI 先看问题,再看上下文)
 * - 无 instruction:单发 markdown(AI 自由发挥,一般会总结或解释)
 */
function buildPrompt(instruction: string, markdown: string): string {
  const trimmed = instruction.trim();
  if (!trimmed) return markdown;
  return `${trimmed}\n\n${markdown}`;
}

export function AskAIPanel({ onClose }: PopupCloseProps) {
  // mount 时读 pending ctx;读完即清。useMemo 保 SSR 安全 + 仅跑一次。
  const ctx = useMemo<AskAIContext | null>(() => consumePendingAskAIContext(), []);
  const [instruction, setInstruction] = useState('');
  const [serviceId, setServiceId] = useState<AIServiceId>(
    () => ctx?.defaultServiceId ?? 'claude',
  );
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    // 延迟 focus 避免与 popup binding 内 click 冲突
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // mount 时 ctx=null 是边角(直接打开 popup 但 pending 已被消费),不应发生 — 兜底 close
  useEffect(() => {
    if (!ctx) {
      console.warn('[AskAIPanel] no pending context, closing');
      onClose();
    }
  }, [ctx, onClose]);

  function handleSend(): void {
    if (!ctx) return;
    const prompt = buildPrompt(instruction, ctx.selectionMarkdown);
    const wsId = workspaceManager.getActiveId();
    if (!wsId) {
      onClose();
      return;
    }
    const bus = workspaceManager.getBus(wsId);
    if (!bus) {
      onClose();
      return;
    }
    // 开右槽 + emit 跨槽消息(AIView 订阅 'ai.paste-and-send')
    bus.slot.openRight('ai-view');
    bus.channels.emit('ai.paste-and-send', { prompt, serviceId, emittedAt: Date.now() });
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  if (!ctx) return null;

  const preview =
    ctx.selectionMarkdown.length > PREVIEW_MAX
      ? ctx.selectionMarkdown.slice(0, PREVIEW_MAX) + '...'
      : ctx.selectionMarkdown;
  const currentService = AI_SERVICE_PROFILES.find((p) => p.id === serviceId) ?? AI_SERVICE_PROFILES[0];

  return (
    <div className="krig-ask-ai-panel" onMouseDown={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="krig-ask-ai-panel__header">
        <span className="krig-ask-ai-panel__title">🤖 问 AI</span>
        <button
          type="button"
          className="krig-ask-ai-panel__close"
          onClick={onClose}
          title="关闭 (Esc)"
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      {/* Preview(选区 markdown) */}
      {preview && (
        <div className="krig-ask-ai-panel__preview">
          <span className="krig-ask-ai-panel__preview-label">选中内容:</span>
          <pre className="krig-ask-ai-panel__preview-text">{preview}</pre>
        </div>
      )}

      {/* Instruction */}
      <textarea
        ref={inputRef}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="请输入你的问题(可留空)..."
        className="krig-ask-ai-panel__textarea"
        rows={2}
      />

      {/* Bottom bar */}
      <div className="krig-ask-ai-panel__bottom">
        <div className="krig-ask-ai-panel__service-wrap">
          <button
            type="button"
            className="krig-ask-ai-panel__service-btn"
            onClick={() => setShowServiceMenu((v) => !v)}
            aria-expanded={showServiceMenu}
          >
            {currentService.icon} {currentService.name} ▾
          </button>
          {showServiceMenu && (
            <div className="krig-ask-ai-panel__service-menu" role="menu">
              {AI_SERVICE_PROFILES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className={
                    'krig-ask-ai-panel__service-item' +
                    (p.id === serviceId ? ' krig-ask-ai-panel__service-item--active' : '')
                  }
                  onClick={() => {
                    setServiceId(p.id);
                    setShowServiceMenu(false);
                  }}
                >
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="krig-ask-ai-panel__send"
          onClick={handleSend}
          disabled={!ctx.selectionMarkdown.trim() && !instruction.trim()}
        >
          发送 ▶
        </button>
      </div>
    </div>
  );
}
