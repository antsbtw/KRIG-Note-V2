/**
 * EmojiPickerPanel — callout emoji 选择器(L4 装配 / block-scoped)
 *
 * 用于:callout NodeView emoji 点击弹出 popup grid 选 emoji。
 *
 * ctx 取法:popup-controller 是匿名契约,不携带 payload。本组件 mount 时
 * 从 integration.ts 模块级 pending ctx 拿 {instanceId, blockPos}。
 * 与 ColorPickerPanel(用 focusedInstanceId)的区别:callout emoji 点击
 * 瞬间 PM 焦点可能漂走(emojiEl mousedown e.preventDefault),用显式 ctx
 * 比隐式焦点查询健壮。
 */

import { useMemo } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { EmojiPickerGrid, CALLOUT_EMOJIS } from './EmojiPickerGrid';
import { consumeCalloutEmojiCtx } from './integration';

export function EmojiPickerPanel({ onClose }: PopupCloseProps) {
  const api = requireCapabilityApi<TextEditingApi>('text-editing').api;
  // mount 时一次性拿 ctx(useMemo 防 re-render 重读已被清的 pending)
  const ctx = useMemo(() => consumeCalloutEmojiCtx(), []);

  const apply = (emoji: string) => {
    if (!ctx) {
      onClose();
      return;
    }
    api.setCalloutEmoji(ctx.instanceId, ctx.blockPos, emoji);
    onClose();
  };

  return (
    <div className="krig-emoji-picker">
      <EmojiPickerGrid
        emojis={CALLOUT_EMOJIS}
        activeEmoji={null}
        onPick={apply}
      />
    </div>
  );
}
