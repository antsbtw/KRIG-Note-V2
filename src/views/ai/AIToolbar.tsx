/**
 * AIToolbar — 服务切换下拉 + 新对话 + URL 显示
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

  return (
    <div className="krig-ai-view__toolbar">
      <select
        className="krig-ai-view__service-select"
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
        className="krig-ai-view__btn"
        onClick={onNewChat}
        title="新对话"
        aria-label="新对话"
      >
        ＋
      </button>
      <button
        type="button"
        className="krig-ai-view__btn"
        onClick={onReload}
        title="重载"
        aria-label="重载"
      >
        ↻
      </button>
      <div className="krig-ai-view__url" title={url}>
        {loading ? '⏳ ' : ''}
        {url}
      </div>
    </div>
  );
}
