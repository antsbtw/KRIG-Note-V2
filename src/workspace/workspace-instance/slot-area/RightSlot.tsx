/**
 * RightSlot — 右 Slot 容器(可选,双视图模式时显示)
 *
 * L3 阶段:占位(等 L5 view 通过 viewTypeRegistry 注册 + L4 mount)
 */

interface RightSlotProps {
  /** 装载的 view ID(null = Slot 不显示)*/
  viewId: string | null;
}

export function RightSlot({ viewId }: RightSlotProps) {
  return (
    <div className="krig-slot krig-slot-right">
      <div className="krig-slot-empty">
        {viewId ? `Right Slot: ${viewId} (待 L5 view mount)` : 'Right Slot (空,待 L5)'}
      </div>
    </div>
  );
}
