/**
 * AIToolbar — 服务切换下拉 + 新对话 + 重载 + URL 显示
 *
 * 视觉对齐:字面照搬 WebToolbar 的 36px 高度 / #252525 背景 / 无边框按钮 hover 灰底,
 * 与 Note view 的 ToolbarFrame (workspace-instance/toolbar-frame.css) 同款主题。
 *
 * V1 对应:src/plugins/web/components/AIWebView.tsx 的顶栏(服务选择下拉)
 */

import { useCallback } from 'react';
import {
  AI_SERVICE_PROFILES,
  type AIServiceId,
} from '@shared/types/ai-service-types';

export interface AIToolbarProps {
  /** 当前显示的服务 */
  serviceId: AIServiceId;
  /** 实时 URL(显示用) */
  url: string;
  /** loading 状态(显 spinner) */
  loading: boolean;
  /** 用户切服务 */
  onSelectService: (id: AIServiceId) => void;
  /** 用户点"新对话"(reload 到 newChatUrl) */
  onNewChat: () => void;
  /** 用户点"重载" */
  onReload: () => void;
}

export function AIToolbar(props: AIToolbarProps) {
  const { serviceId, url, loading, onSelectService, onNewChat, onReload } = props;

  const handleSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value as AIServiceId;
      onSelectService(next);
    },
    [onSelectService],
  );

  // 显示简洁 URL(去掉协议前缀,对齐 WebToolbar)
  const displayUrl = url.replace(/^https?:\/\//, '');

  return (
    <div className="krig-ai-toolbar">
      <div className="krig-ai-toolbar__nav">
        <select
          className="krig-ai-toolbar__service-select"
          value={serviceId}
          onChange={handleSelect}
          aria-label="选择 AI 服务"
        >
          {AI_SERVICE_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="krig-ai-toolbar__btn"
          onClick={onNewChat}
          title="新对话"
          aria-label="新对话"
        >
          ＋
        </button>
        <button
          type="button"
          className="krig-ai-toolbar__btn"
          onClick={onReload}
          title={loading ? '加载中' : '重载'}
          aria-label={loading ? '加载中' : '重载'}
        >
          {loading ? '✕' : '↻'}
        </button>
      </div>

      <div className="krig-ai-toolbar__url" title={url}>
        {displayUrl || 'about:blank'}
      </div>
    </div>
  );
}
