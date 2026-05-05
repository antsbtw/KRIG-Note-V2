/**
 * SlotArea — 中央 Slot 区(Left + Divider + Right)
 *
 * L3 阶段:Slot 内容是占位(等 L5 view mount)。
 * 单视图模式(slotBinding.right === null):LeftSlot 全宽,无 Divider / RightSlot
 * 双视图模式:LeftSlot + Divider + RightSlot,按 dividerRatio 分配
 */

import { useRef } from 'react';
import { LeftSlot } from './LeftSlot';
import { RightSlot } from './RightSlot';
import { ResizableDivider } from './ResizableDivider';
import type { SlotBinding } from '../../workspace-state/workspace-state';
import './slot-area.css';

interface SlotAreaProps {
  slotBinding: SlotBinding;
  dividerRatio: number;
  onDividerChange: (ratio: number) => void;
}

export function SlotArea({ slotBinding, dividerRatio, onDividerChange }: SlotAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasRight = slotBinding.right !== null;

  return (
    <div ref={containerRef} className="krig-slot-area">
      <div className="krig-slot-wrapper" style={{ flexBasis: hasRight ? `${dividerRatio * 100}%` : '100%' }}>
        <LeftSlot viewId={slotBinding.left} />
      </div>
      {hasRight && (
        <>
          <ResizableDivider
            ratio={dividerRatio}
            onRatioChange={onDividerChange}
            containerRef={containerRef}
          />
          <div className="krig-slot-wrapper" style={{ flexBasis: `${(1 - dividerRatio) * 100}%` }}>
            <RightSlot viewId={slotBinding.right} />
          </div>
        </>
      )}
    </div>
  );
}
