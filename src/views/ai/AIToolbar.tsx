/**
 * AIToolbar — 服务切换 + 提取整页对话 + 跨 view 跳转 + 重载 + 关闭(条件)
 *
 * V1 对应:src/plugins/web/components/AIWebView.tsx 1224-1316 行 + SlotToggle.tsx
 *
 * 视觉对齐:字面照搬 WebToolbar 的 36px 高度 / #252525 背景 / 无边框按钮 hover 灰底,
 * 与 Note view 的 ToolbarFrame (workspace-instance/toolbar-frame.css) 同款主题。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AI_SERVICE_PROFILES,
  type AIServiceId,
} from '@shared/types/ai-service-types';
import { commandRegistry } from '@slot/command-registry/command-registry';

/** SlotToggle 下拉的 5 个跨 view 选项(V1 字面对齐:Note/eBook/Web/AI/Thought) */
const SLOT_TARGETS: Array<{ viewId: string; icon: string; label: string }> = [
  { viewId: 'note-view', icon: '📝', label: 'Note' },
  { viewId: 'ebook-view', icon: '📕', label: 'eBook' },
  { viewId: 'web-view', icon: '🌐', label: 'Web' },
  { viewId: 'ai-view', icon: '🤖', label: 'AI' },
  { viewId: 'thought-view', icon: '💭', label: 'Thought' },
];

export interface AIToolbarProps {
  /** 当前显示的服务 */
  serviceId: AIServiceId;
  /** 实时 URL(显示用) */
  url: string;
  /** loading 状态(显 spinner) */
  loading: boolean;
  /** 当前 right slot 装的 viewId(SlotToggle 高亮 + 决定 close 行为) */
  activeRightViewId: string | null;
  /** 本 view 是否在右槽中显示(决定 ✕ 按钮是否显示) */
  isInRightSlot: boolean;
  /** 用户切服务 */
  onSelectService: (id: AIServiceId) => void;
  /** 用户点"新对话"(reload 到 newChatUrl) */
  onNewChat: () => void;
  /** 用户点"重载" */
  onReload: () => void;
  /** 用户点"提取整页对话"(V1 batch extractor — V2 占位待迁移) */
  onExtractFull: () => void;
  /** 用户点 ✕ 关闭右槽(仅 isInRightSlot=true 时显示) */
  onCloseRightSlot: () => void;
}

export function AIToolbar(props: AIToolbarProps) {
  const {
    serviceId,
    url,
    loading,
    activeRightViewId,
    isInRightSlot,
    onSelectService,
    onNewChat,
    onReload,
    onExtractFull,
    onCloseRightSlot,
  } = props;

  const [slotMenuOpen, setSlotMenuOpen] = useState(false);
  const slotMenuRef = useRef<HTMLDivElement | null>(null);

  // 点菜单外关闭(V1 SlotToggle 同款)
  useEffect(() => {
    if (!slotMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!slotMenuRef.current) return;
      if (!slotMenuRef.current.contains(e.target as Node)) {
        setSlotMenuOpen(false);
      }
    };
    // 下一帧加 listener,避免捕获到打开菜单那次 click
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [slotMenuOpen]);

  const handleSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = e.target.value as AIServiceId;
      onSelectService(next);
    },
    [onSelectService],
  );

  const handleSlotPick = useCallback(
    (viewId: string) => {
      setSlotMenuOpen(false);
      // V1 SlotToggle 同款语义:再次点已激活项 → 关右槽;否则打开目标 view
      if (activeRightViewId === viewId) {
        commandRegistry.execute('ai-view.close-right-slot');
      } else {
        commandRegistry.execute('ai-view.open-right-slot', viewId);
      }
    },
    [activeRightViewId],
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
      </div>

      <div className="krig-ai-toolbar__url" title={url}>
        {displayUrl || 'about:blank'}
      </div>

      {/* 右侧 actions 区(V1 字面:提取整页对话 + SlotToggle + 重载 + 关闭) */}
      <div className="krig-ai-toolbar__actions">
        <button
          type="button"
          className="krig-ai-toolbar__btn krig-ai-toolbar__btn--primary"
          onClick={onExtractFull}
          title="提取整个对话(含所有 artifact)到 Note"
        >
          提取整页对话
        </button>

        {/* SlotToggle dropdown — V1 SlotToggle.tsx 字面对齐 */}
        <div className="krig-ai-toolbar__slot-group" ref={slotMenuRef}>
          <button
            type="button"
            className="krig-ai-toolbar__btn"
            onClick={() => setSlotMenuOpen((v) => !v)}
            title="在右栏打开其他视图"
            aria-label="切换视图"
            aria-expanded={slotMenuOpen}
          >
            ⊞ <span className="krig-ai-toolbar__caret">▾</span>
          </button>
          {slotMenuOpen && (
            <div className="krig-ai-toolbar__slot-menu" role="menu">
              {SLOT_TARGETS.map((opt) => (
                <button
                  key={opt.viewId}
                  type="button"
                  role="menuitem"
                  className={`krig-ai-toolbar__slot-item${
                    opt.viewId === activeRightViewId ? ' active' : ''
                  }`}
                  onClick={() => handleSlotPick(opt.viewId)}
                >
                  <span className="krig-ai-toolbar__slot-icon">{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="krig-ai-toolbar__btn"
          onClick={onReload}
          title={loading ? '加载中' : '重载'}
          aria-label={loading ? '加载中' : '重载'}
        >
          {loading ? '✕' : '↻'}
        </button>

        {/* 关闭 ✕ — 仅在 AI View 被召唤到右槽时显示;主舞台 NavSide tab 不显示 */}
        {isInRightSlot && (
          <button
            type="button"
            className="krig-ai-toolbar__btn krig-ai-toolbar__btn--close"
            onClick={onCloseRightSlot}
            title="关闭此面板"
            aria-label="关闭此面板"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
