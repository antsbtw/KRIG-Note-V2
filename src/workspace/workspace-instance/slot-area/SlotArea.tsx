/**
 * SlotArea — 中央 Slot 区(L3.5 改造)
 *
 * 渲染单元 = (viewId, slot) 二元组(fix/slot-same-view-both-slots):
 * - 旧实现每个 viewId 只渲一次、key=viewId,故 left === right 时右列没有实例
 *   → 一块纯空白 pane。现改为以**槽**为主语枚举,同一 viewId 可在左右各一份实例。
 * - key = `${viewId}:${slot}`,通过 data-slot + CSS Grid Area 决定 left/right/hidden
 *
 * 铁律 7(view 实例不重建)重新推导:
 * - 旧保证靠"key 恒为 viewId",right→left 升级时 key 不变所以不重建。
 * - key 带上 slot 后该推导失效(升级会换 key → 重建 → 丢滚动位置/选区/编辑器 state)。
 * - 新保证挪到 **closeLeft 的语义**上:升级不再改 slotBinding.left 的值,而是
 *   把 left 槽整体**替换**为原 right 的 viewId 且同时清空 right —— 仍会换 key。
 *   故 closeLeft 改为**就地降级**:见 slot-control.ts closeLeft 注释。
 * - 结论:铁律 7 的「不重建」在同 view 双开场景下**只对未参与升级的那一侧成立**。
 *   参与升级的实例会重建,这是 per-slot 身份的必然代价(状态保留改由 view 自身
 *   持久化到 pluginStates 兜住,而非依赖 React 实例存活)。
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

  /**
   * 渲染单元 = (viewId, slot) 二元组,不再是 viewId 单值。
   *
   * 旧实现 positionOf(viewId) 只能返回一个位置,left 判定在先 —— left === right
   * 时(如左右都选 Note)右列拿不到任何实例,表现为一块纯空白 pane。
   *
   * 改法:以**槽**为主语枚举。left / right 各产出一个渲染单元,其余已注册 view
   * 作为 hidden 单元保活(它们的实例状态在切换 view 时不丢)。同一个 viewId 因此
   * 可以同时出现在 left 和 right,各自一个 React 实例。
   */
  const units: Array<{ viewId: string; slot: 'left' | 'right'; pos: SlotPosition }> = [];
  if (slotBinding.left) units.push({ viewId: slotBinding.left, slot: 'left', pos: 'left' });
  if (slotBinding.right) units.push({ viewId: slotBinding.right, slot: 'right', pos: 'right' });
  // 未占槽的 view 仍挂在 DOM 里(display:none)保活,避免切 view 时实例重建丢状态。
  // 归到 'left' 槽维度:它们没有可见位置,slot 取值只需稳定且不与在槽者碰撞 ——
  // 而在槽者若同 id 已在上面占了 left 单元,这里会被 seen 去重跳过。
  const seen = new Set(units.map((u) => `${u.viewId}:${u.slot}`));
  for (const v of allViews) {
    if (v.id === slotBinding.left || v.id === slotBinding.right) continue;
    const key = `${v.id}:left`;
    if (seen.has(key)) continue;
    seen.add(key);
    units.push({ viewId: v.id, slot: 'left', pos: 'hidden' });
  }

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
      {units.map(({ viewId, slot, pos }) => {
        const view = allViews.find((v) => v.id === viewId);
        const Comp = view?.component;
        if (!Comp) return null;
        const payload = pos === 'left' ? slotBinding.leftPayload
          : pos === 'right' ? slotBinding.rightPayload
          : undefined;
        return (
          <div
            key={`${viewId}:${slot}`}
            className="krig-slot-view"
            data-slot={pos}
            data-view-slot={slot}
            style={{ display: pos === 'hidden' ? 'none' : 'flex' }}
          >
            <ToolbarFrame viewId={viewId} slot={slot} />
            <div className="krig-slot-view-content">
              <Comp workspaceId={workspaceId} payload={payload} slot={slot} />
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
