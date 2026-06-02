/**
 * SlotArea — 中央 Slot 区(L3.5 改造)
 *
 * 铁律 7 实施(view 实例不重建):
 * - 所有已注册 view 在**同一扁平列表**渲染一次,各有稳定 React key
 * - 通过 data-slot 属性 + CSS Grid Area 决定显示在 left / right / hidden
 * - right→left 升级时 view 仍在同一 React tree 位置(扁平列表),只是 grid-area 变了
 *   ⇒ React **不卸载不重建**,内部 state / DOM 状态全保留
 *
 * 布局:
 * - 单视图(right=null):left 占整个 grid,关闭按钮 disabled
 * - 双视图:left | divider | right,可拖拽 ratio
 *
 * 关闭按钮(铁律 8):
 * - left 关闭:bus.slot.closeLeft();right=null 时按钮 disabled + 灰显
 * - right 关闭:bus.slot.closeRight()
 */

import { useRef, useSyncExternalStore } from 'react';
import { ResizableDivider } from './ResizableDivider';
import { viewTypeRegistry } from '@slot/view-type-registry/view-type-registry';
import { ToolbarFrame } from '../toolbar-frame/ToolbarFrame';
import type { SlotBinding } from '../../workspace-state/workspace-state';
import './slot-area.css';

interface SlotAreaProps {
  workspaceId: string;
  slotBinding: SlotBinding;
  dividerRatio: number;
  onDividerChange: (ratio: number) => void;
}

type SlotPosition = 'left' | 'right' | 'hidden';

export function SlotArea({ workspaceId, slotBinding, dividerRatio, onDividerChange }: SlotAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRight = slotBinding.right !== null;

  // 订阅 view 注册变化(L5 view 注册时自动触发重渲)
  const allViews = useSyncExternalStore(
    (cb) => viewTypeRegistry.subscribe(cb),
    () => viewTypeRegistry.getAll(),
  );

  const positionOf = (viewId: string): SlotPosition => {
    if (viewId === slotBinding.left) return 'left';
    if (viewId === slotBinding.right) return 'right';
    return 'hidden';
  };

  // grid-template-columns 按 ratio 分配。
  // 用 fr 分配剩余空间(扣掉 4px divider 后),避免 `r*100% 4px (1-r)*100%`
  // 总和 = 100%+4px 溢出容器(被 overflow:hidden 裁掉右侧 4px)。
  const gridColumns = hasRight
    ? `minmax(0, ${dividerRatio}fr) 4px minmax(0, ${1 - dividerRatio}fr)`
    : '100% 0 0';

  return (
    <div
      ref={containerRef}
      className={`krig-slot-area${hasRight ? ' krig-slot-area--split' : ''}`}
      style={{ gridTemplateColumns: gridColumns }}
    >
      {/* 所有 view 实例 — 扁平列表,稳定 key,grid-area 决定位置
       *
       * per-slot toolbar(fix/per-slot-toolbar):view 实例内嵌"顶部 toolbar + 主体"
       * 两层结构。toolbar 由 ToolbarFrame 按 viewId 渲染(view 没注册 items 时 frame
       * 自动空渲不占高度)。这样 right slot 装的 view 自己有 toolbar,不被 left
       * 的 toolbar 越界覆盖(V1 同语义:view 自带 toolbar)。
       *
       * 铁律 7(view 实例不重建)仍然成立:slot-view 容器 key 是稳定的 viewId,
       * right→left 升级时 grid-column 变 toolbar 跟着 viewId 走,不影响 view 内部 state。
       */}
      {allViews.map((view) => {
        const pos = positionOf(view.id);
        const Comp = view.component;
        if (!Comp) return null;
        const payload =
          pos === 'left' ? slotBinding.leftPayload :
          pos === 'right' ? slotBinding.rightPayload :
          undefined;
        return (
          <div
            key={view.id}
            className="krig-slot-view"
            data-slot={pos}
            style={{ display: pos === 'hidden' ? 'none' : 'flex' }}
          >
            <ToolbarFrame viewId={view.id} />
            <div className="krig-slot-view-content">
              <Comp workspaceId={workspaceId} payload={payload} />
            </div>
          </div>
        );
      })}

      {/* Left slot 框架(空态占位文字 / view 未注册兜底)
       *
       * per-slot toolbar(fix/per-slot-toolbar):删 SlotArea 的关闭按钮 —
       * V1 同语义,每个 view 自己 toolbar 自带关闭(Note 已有 note-view.close-view;
       * 其他 view 需要时自己注册)。SlotArea frame 只负责"view 未 mount 的兜底文字"。
       */}
      <div className="krig-slot-frame krig-slot-frame--left">
        {!slotBinding.left && (
          <div className="krig-slot-empty">Left Slot (空,从 NavSide 选 view)</div>
        )}
        {slotBinding.left &&
          allViews.find((v) => v.id === slotBinding.left)?.component === undefined && (
          <div className="krig-slot-empty">{`Left: ${slotBinding.left} (待 L5 component)`}</div>
        )}
      </div>

      {/* 拖拽分隔线 */}
      {hasRight && (
        <ResizableDivider
          ratio={dividerRatio}
          onRatioChange={onDividerChange}
          containerRef={containerRef}
        />
      )}

      {/* Right slot 框架(空态占位文字 / view 未注册兜底) */}
      {hasRight && (
        <div className="krig-slot-frame krig-slot-frame--right">
          {slotBinding.right &&
            allViews.find((v) => v.id === slotBinding.right)?.component === undefined && (
            <div className="krig-slot-empty">{`Right: ${slotBinding.right} (待 L5 component)`}</div>
          )}
        </div>
      )}
    </div>
  );
}
