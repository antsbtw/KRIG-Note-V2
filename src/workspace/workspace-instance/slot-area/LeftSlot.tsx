/**
 * LeftSlot — 左 Slot 容器
 *
 * L3 阶段:占位(等 L5 view 通过 viewTypeRegistry 注册 + L4 mount)
 */

interface LeftSlotProps {
  /** 装载的 view ID(null = 空 Slot)*/
  viewId: string | null;
}

export function LeftSlot({ viewId }: LeftSlotProps) {
  return (
    <div className="krig-slot krig-slot-left">
      <div className="krig-slot-empty">
        {viewId ? `Left Slot: ${viewId} (待 L5 view mount)` : 'Left Slot (空,待 L5)'}
      </div>
    </div>
  );
}
