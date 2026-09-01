/**
 * WorkspaceInstance — 单 Workspace 完整 React 组件树
 *
 * 按 charter § 1.4 + view-hierarchy-v2.md:
 * - 应用级 UI 全在 Workspace Container 内(NavSide / Toolbar / Slot / 5 大交互浮层 / 通用 Overlay)
 * - view 平等(所有 Workspace 共享同一套式样)
 *
 * S4:删除 isActive prop 和 display:none 切换（Container 直接渲染活跃 ws）。
 *    NavSideToggle 从 WorkspaceBar 移入，折叠时在 WorkspaceInstance 内部渲染展开按钮。
 */

import { useEffect, useRef } from 'react';
import { NavSideFrame } from './nav-side-frame/NavSideFrame';
import { ActivityBar } from './activity-bar/ActivityBar';
import { SlotArea } from './slot-area/SlotArea';
import { OverlayFrames } from './overlay-frames';
import { SettingsModal } from './settings/SettingsModal';
import { workspaceManager } from '../workspace-state/workspace-manager';
import {
  getActiveSlot,
  reconcileActiveSlot,
  resolveActiveViewId,
  useActiveSlot,
} from '../workspace-state/active-slot';
import { useContextMenuTrigger } from '@slot/triggers/use-context-menu-trigger';
import { useSlashTrigger } from '@slot/triggers/use-slash-trigger';
import { useHandleTrigger } from '@slot/triggers/use-handle-trigger';
import { useFloatingToolbarTrigger } from '@slot/triggers/use-floating-toolbar-trigger';
import { WorkspaceBusContext } from '@slot/workspace-bus/use-workspace-bus';
import { WorkspaceIdContext } from '../workspace-context/ws-id-context';
import { viewTypeRegistry } from '@slot/view-type-registry/view-type-registry';
import type { WorkspaceState } from '../workspace-state/workspace-state';
import './workspace-instance.css';

interface WorkspaceInstanceProps {
  state: WorkspaceState;
}

export function WorkspaceInstance({ state }: WorkspaceInstanceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleDividerChange = (ratio: number) => {
    workspaceManager.update(state.id, { dividerRatio: ratio });
  };

  const handleSwitch = (viewId: string) => {
    const viewDef = viewTypeRegistry.get(viewId);
    const navSideOnSwitch = viewDef?.navSideTab?.navSideOnSwitch ?? 'expand';
    const nextCollapsed = navSideOnSwitch === 'collapse';
    console.log(`[handleSwitch] view=${viewId} navSideOnSwitch=${navSideOnSwitch} → navSideCollapsed=${nextCollapsed} (当前=${state.navSideCollapsed})`);
    // 废除铁律 9(fix/slot-symmetry-drop-rule9):NavSide 切主 view **不再自动关 right**。
    //
    // 原契约「右 slot 是与主 view 共生的辅助位,主 view 换了辅位不再有意义」建立在
    // "right 是附属"的主从模型上。左右对称化落地后该前提不成立 —— right 已能独立
    // 持有自己的笔记/滚动位/目录状态,是用户主动摆放的持久 pane。切左栏就清掉它
    // 等于替用户丢弃他刚布置好的对照视图。
    //
    // 关右栏的入口是各 view toolbar 自己的 ✕(已按槽精确关闭),不需要框架代劳。
    //
    // feat/slot-navside-follow-active:切主 view 落到**活跃槽**,不再恒写 left。
    // 若仍恒写 left:焦点在右栏时用户点 ActivityBar 换 view,内容进了左栏,而
    // ActivityBar 高亮与 navSide 都跟着活跃槽(右栏)不动 —— 这一下看起来像**没反应**。
    // 「点哪一栏就操作哪一栏」在这里同样成立(PROTOCOL.md §1.5 原则 1)。
    const targetSlot = getActiveSlot(state.id);
    workspaceManager.update(
      state.id,
      {
        slotBinding:
          targetSlot === 'right'
            ? { ...state.slotBinding, right: viewId, rightPayload: undefined }
            : { ...state.slotBinding, left: viewId, leftPayload: undefined },
        navSideCollapsed: nextCollapsed,
      },
      { source: 'navside' },
    );
  };

  const handleToggleCollapse = () => {
    workspaceManager.toggleNavSide(state.id);
  };

  // 当前活跃 view ID — NavSide / Overlay / 4 大触发器的过滤参考。
  //
  // feat/slot-navside-follow-active:解析从「恒等于 left」改为**按活跃槽**。
  // 原实现 `left ?? right` 让整个结构层不知道「槽」的存在 —— 用户点右栏,navSide
  // 仍显左栏的导航,右栏成了没有导航的孤岛(左 Note / 右 eBook 时尤其明显:
  // 点右栏看不到书架)。activeSlot 是唯一来源,这里只做**读取**不做推导。
  //
  // 回落链(活跃槽为空 → 另一槽)收在 resolveActiveViewId 里,与 keymap-listener
  // 共用同一份 —— 两处曾逐字重复,将来改回落规则必漏一处。
  // 再回落到第一个有 navSideTab 的 view:新 Workspace slotBinding.left=null 时
  // 让 NavSide / SlotArea 至少有内容可显。
  const activeSlot = useActiveSlot(state.id);
  let activeViewId: string | null = resolveActiveViewId(state.slotBinding, activeSlot);
  if (!activeViewId) {
    activeViewId = viewTypeRegistry.getAllForNavSide()[0]?.id ?? null;
  }
  // left 为空时展示上回落到 activeViewId(与下方 effectiveSlotBinding 同一规则)
  const effectiveLeftViewId = state.slotBinding.left ?? activeViewId;

  // 该 view 有没有 NavSide 内容 —— 决定 NavSideFrame 渲不渲染(详见下方渲染处注释)
  //
  // ⚠️ 判据是**两个槽的并集**,不是只看活跃槽。
  // 只看 activeViewId 时:左 X(navSideDisabled)+ 右 X-Inbox(未标)双开,
  // 点一下右栏 → activeViewId 变成 x-inbox-view → NavSide 又渲染出来,
  // 从左槽抢走 ~230 CSS px。X 的响应式断点是 1280px,被抢完只剩 1267px,
  // 于是 x.com 全屏下也把左侧导航收成图标条(2026-09-01 用户实拍 + host=1267 实测)。
  //
  // 语义上也该如此:navSideDisabled 表达的是「这个 view 不需要 NavSide」,
  // webview 类 view(mail / ai / social)要的是**宽度**。只要台上有一个这样的
  // view,那栏空白 NavSide 就不该占着地方 —— 它对谁都没用。
  const navSideDisabled = ([
    effectiveLeftViewId,
    state.slotBinding.right,
  ].filter(Boolean) as string[]).some(
    (vid) => viewTypeRegistry.get(vid)?.navSideTab?.navSideDisabled === true,
  );

  // 计算"展示用 slotBinding"(left null 时 fallback 到 activeViewId,不改实际 state)
  const effectiveSlotBinding = state.slotBinding.left
    ? state.slotBinding
    : { ...state.slotBinding, left: activeViewId };

  // 4 大交互触发器统一在 WorkspaceInstance 挂(选项 A)— 范围 = Workspace 根 DOM,自然按 Workspace 隔离。
  // viewId 为 null 时 hook 不挂监听器(待 view 注册后自动激活)。
  //
  // feat/slot-navside-follow-active 风险复核:activeViewId 现在会随点击换栏而变,
  // 这 4 个 hook 都吃它。逐个查过后确认**共用一个变量是对的**,无需拆:
  // - useContextMenuTrigger:唯一真正**使用**该值的 —— 按 viewId 过滤右键菜单项。
  //   跟随活跃槽后反而更准:以前在右栏右键弹的是**左栏 view** 的菜单(右键会先
  //   触发 pointerdown 把该栏设为活跃,故解析结果 = 光标所在栏)。
  // - useSlashTrigger / useHandleTrigger / useFloatingToolbarTrigger:只把 viewId
  //   当**非空门闸**(`if (!viewId) return`)用,内部逻辑与具体是哪个 view 无关
  //   (各自只挂 Esc / 点击外部关浮层)。换值只会重挂一次同样的监听器,行为不变。
  useContextMenuTrigger(rootRef, activeViewId);
  useSlashTrigger(rootRef, activeViewId);          // L5-B3.1
  useHandleTrigger(rootRef, activeViewId);         // L5-B3.1
  useFloatingToolbarTrigger(activeViewId);         // L5-B3.1

  // 回落保护:right 槽关掉后活跃槽必须回 left,否则「焦点指向不存在的槽」——
  // navSide 解析不出内容、树上点笔记写进 rightActiveNoteId 却没有实例呈现 = 开到虚空。
  // 放这里(渲染后对账)而不是各个关栏路径里补:关右栏入口不止一条
  // (toolbar ✕ / bus.closeRight / closeLeft 升级),逐个补必漏。
  useEffect(() => {
    reconcileActiveSlot(state.id, state.slotBinding.right !== null);
  }, [state.id, state.slotBinding.right]);

  // L3.5:Workspace bus(每 Workspace 一实例,跨 Workspace 不通)
  const bus = workspaceManager.getBus(state.id) ?? null;

  return (
    <WorkspaceIdContext.Provider value={state.id}>
      <WorkspaceBusContext.Provider value={bus}>
        <div
          ref={rootRef}
          className="krig-workspace-instance"
          data-workspace-id={state.id}
        >
          <ActivityBar
            activeViewId={activeViewId}
            navSideCollapsed={state.navSideCollapsed}
            onSwitch={handleSwitch}
            onToggleCollapse={handleToggleCollapse}
          />
          {/*
            navSideDisabled 的 view(mail / ai / social 等 webview 类)**永远不渲染**
            NavSide,而不只是「切过来时收起」。

            ⚠️ 只靠 navSideOnSwitch:'collapse' 不够:那条只在 handleSwitch 里生效,
            也就是**用户点 tab 切过来**的那一次。view 通过其它路径成为活跃
            (恢复上次会话状态、slot 重建、右栏关闭后左栏顶上来……)时它根本不跑,
            于是 mail 顶着一栏空白 NavSide,里面只有「待 view 注册内容」占位
            (2026-08-28 用户实拍)。

            式样问题要由「有没有内容」决定,不能依赖某个一次性事件有没有被触发。
          */}
          {!state.navSideCollapsed && !navSideDisabled && (
            <NavSideFrame workspaceId={state.id} navSideWidths={state.navSideWidths ?? {}} viewId={activeViewId} />
          )}
          <div className="krig-workspace-main">
            {/* per-slot toolbar(fix/per-slot-toolbar):ToolbarFrame 下沉进 SlotArea 的
                每个 slot 容器内,left/right view 各自有独立 toolbar 不再越界。*/}
            <SlotArea
              workspaceId={state.id}
              slotBinding={effectiveSlotBinding}
              dividerRatio={state.dividerRatio}
              onDividerChange={handleDividerChange}
            />
          </div>
          <OverlayFrames viewId={activeViewId} />
          <SettingsModal />
        </div>
      </WorkspaceBusContext.Provider>
    </WorkspaceIdContext.Provider>
  );
}
