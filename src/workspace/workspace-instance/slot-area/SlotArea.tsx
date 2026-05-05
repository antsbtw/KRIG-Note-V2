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
import { useWorkspaceBus } from '@slot/workspace-bus/use-workspace-bus';
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
  const bus = useWorkspaceBus();
  const hasRight = slotBinding.right !== null;
  const canCloseLeft = slotBinding.right !== null;

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

  // grid-template-columns 按 ratio 分配
  const gridColumns = hasRight
    ? `${dividerRatio * 100}% 4px ${(1 - dividerRatio) * 100}%`
    : '100% 0 0';

  return (
    <div
      ref={containerRef}
      className={`krig-slot-area${hasRight ? ' krig-slot-area--split' : ''}`}
      style={{ gridTemplateColumns: gridColumns }}
    >
      {/* 所有 view 实例 — 扁平列表,稳定 key,grid-area 决定位置 */}
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
            style={{ display: pos === 'hidden' ? 'none' : 'block' }}
          >
            <Comp workspaceId={workspaceId} payload={payload} />
          </div>
        );
      })}

      {/* Left slot 框架(关闭按钮 + 占位文字)— 单独容器,只装"框架装饰",不装 view 实例 */}
      <div className="krig-slot-frame krig-slot-frame--left">
        {slotBinding.left && (
          <button
            type="button"
            className="krig-slot-close"
            disabled={!canCloseLeft}
            onClick={() => bus.slot.closeLeft()}
            title={canCloseLeft ? '关闭左 Slot(右 Slot 升级)' : '至少保留一个 view'}
          >×</button>
        )}
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

      {/* Right slot 框架 */}
      {hasRight && (
        <div className="krig-slot-frame krig-slot-frame--right">
          <button
            type="button"
            className="krig-slot-close"
            onClick={() => bus.slot.closeRight()}
            title="关闭右 Slot"
          >×</button>
          {slotBinding.right &&
            allViews.find((v) => v.id === slotBinding.right)?.component === undefined && (
            <div className="krig-slot-empty">{`Right: ${slotBinding.right} (待 L5 component)`}</div>
          )}
        </div>
      )}
    </div>
  );
}
