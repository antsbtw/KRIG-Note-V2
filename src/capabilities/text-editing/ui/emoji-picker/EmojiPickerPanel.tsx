/**
 * EmojiPickerPanel — callout emoji 选择器 Notion 风格(emoji-mart 5.x 包装)
 *
 * 结构:
 * - 顶部 4 tab 栏(Emojis active / Icons|Upload|Remove disabled stub)— v1 留位
 * - "Callouts"精选 24 个 emoji 置顶分类(custom prop)
 * - 完整 emoji-mart picker:搜索 / 分类 / 最近 / 肤色 / 暗色主题
 *
 * 用 emoji-mart 核心 Web Component(`new Picker({...})`)+ 手写 React 包装。
 * 不用官方 @emoji-mart/react(其 peer ^16.8 || ^17 || ^18 不含 React 19,3 年未更新)。
 *
 * data 懒加载:首次 mount 时 dynamic import @emoji-mart/data,首屏 0 bundle 影响。
 *
 * ctx 取法:popup-controller 是匿名契约,不携带 payload。本组件 mount 时
 * 从 integration.ts 模块级 pending ctx 拿 {instanceId, blockPos}。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PopupCloseProps } from '@slot/interaction-registries/popup-registry/popup-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { consumeCalloutEmojiCtx } from './integration';
import { EmojiPickerTabs, type EmojiPickerTabId } from './EmojiPickerTabs';
import { CALLOUT_CUSTOM_CATEGORY } from './callout-emojis';

interface EmojiSelectEvent {
  native: string;
}

export function EmojiPickerPanel({ onClose }: PopupCloseProps) {
  const api = requireCapabilityApi<TextEditingApi>('text-editing').api;
  const ctx = useMemo(() => consumeCalloutEmojiCtx(), []);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  // v1: 后 3 个 tab disabled,activeTab 永远是 'emojis'。预留 state 给 v2/v3。
  const [activeTab, setActiveTab] = useState<EmojiPickerTabId>('emojis');

  // onClose 是父级闭包字面新引用(PopupBinding 每次 re-render 都新建),
  // 不能进 useEffect 依赖 — 否则父级 re-render 会触发 cleanup → cancelled=true
  // → dynamic import 完成后跳过创建 Picker。冷启动连续点 💡 会引发
  // popupController setState → PopupBinding re-render → cancel 循环,
  // 表现"点 N 次才能出 picker"。用 ref 持最新 onClose,effect 依赖只放
  // 真稳定项(api / ctx)。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    let pickerEl: HTMLElement | null = null;

    (async () => {
      const [{ Picker }, dataMod] = await Promise.all([
        import('emoji-mart'),
        import('@emoji-mart/data'),
      ]);
      if (cancelled || !mountRef.current) return;

      // emoji-mart Picker 构造器会自动 appendChild 到 props.ref.current
      pickerEl = new (Picker as unknown as new (props: Record<string, unknown>) => HTMLElement)({
        data: dataMod.default,
        custom: CALLOUT_CUSTOM_CATEGORY,
        // categories prop 定义显示分类 + 顺序;含 custom 'callouts' 置顶,
        // 后接 emoji-mart 内置 9 类(frequent/people/nature/foods/activity/
        // places/objects/symbols/flags)。源码 line 87 字面 filter+sort 按本序排。
        categories: [
          'callouts',
          'frequent',
          'people',
          'nature',
          'foods',
          'activity',
          'places',
          'objects',
          'symbols',
          'flags',
        ],
        theme: 'dark',
        previewPosition: 'none',
        skinTonePosition: 'search',
        maxFrequentRows: 2,
        // autoFocus: false — 抢 PM 焦点会让 PM blur, 之后再点 💡 时
        // instanceRegistry.getFocusedInstanceId() 拿不到, ABORT 不弹 popup
        // (虽 onOpen 已改 view 反查 fallback, 但避免 emoji-mart 焦点抢占
        // 仍是稳健选择 — picker 默认不抢搜索框, 用户需要时点一下即可)。
        autoFocus: false,
        ref: mountRef,
        onEmojiSelect: (e: EmojiSelectEvent) => {
          if (ctx) api.setCalloutEmoji(ctx.instanceId, ctx.blockPos, e.native);
          onCloseRef.current();
        },
      });
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
      if (pickerEl?.parentNode) pickerEl.parentNode.removeChild(pickerEl);
    };
  }, [api, ctx]);

  return (
    <div className="krig-emoji-picker">
      <EmojiPickerTabs activeTab={activeTab} onTabChange={setActiveTab} />
      <div ref={mountRef} className="krig-emoji-picker__mount" />
      {!loaded && <div className="krig-emoji-picker__loading">Loading…</div>}
    </div>
  );
}
