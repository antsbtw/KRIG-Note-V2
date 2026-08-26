/**
 * MailView — 网页版邮箱 view(阶段 0:webview 薄壳)
 *
 * 结构参照 SocialView:顶部服务商切换 tabbar + 下方 MailHost webview。
 *
 * ## ⚠️ handleClose 用 slot prop,不推导
 *
 * 「我在哪一栏」必须由框架经 ViewComponentProps.slot 告知。靠
 * `slotBinding.right === VIEW_ID` 反推在**左右双开同一个 view** 时对两个实例
 * 都成立 —— 点左栏的 ✕ 会把右栏关掉(note / eBook / web 各踩过一次)。
 * 见 memory「别猜自己在哪一栏」。
 *
 * closeLeft 在「最后一个 view」时自身会拒绝(slot-control 铁律 8),
 * 故这里不需要自己判断能不能关。
 *
 * ## 广播订阅不在这里
 *
 * 右键提取的 MAIL_EXTRACT_REQUEST 订阅在 mail-commands.ts 模块级做一次,
 * **不进本组件的 useEffect** —— 否则多 ws 并存时一次右键触发 N 次提取。
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { declareSlotResource } from '@workspace/workspace-state/slot-resource';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { popupController } from '@slot/triggers/popup-controller';
import { SLOT_PICKER_POPUP_ID, slotPickerContext } from '@shell/slot-picker';
import type { MailServiceApi, MailHostHandle } from '@capabilities/mail-service';
import {
  MAIL_SERVICE_PROFILES,
  DEFAULT_MAIL_SERVICE,
  type MailServiceId,
} from '@shared/types/mail-service-types';
import './mail.css';

interface MailViewProps {
  workspaceId: string;
  payload?: unknown;
  /** 框架告知本实例占哪个槽。⚠️ 关闭必须用它,不许反推(见文件头) */
  slot?: 'left' | 'right';
}

const VALID_IDS = new Set<string>(MAIL_SERVICE_PROFILES.map((p) => p.id));

/**
 * per-slot「当前邮箱服务商」的**唯一**槽分发声明。
 *
 * 为什么必须 per-slot:首版存成 per-ws 的 `pluginStates.mail.activeService`,
 * 左右双开 Mail 时两个实例读同一个字段 → 被迫显示同一个邮箱,
 * 「左 Gmail 右 Outlook 对照看」根本做不到,双开等于半残。
 * 与 note 的 activeNoteId / eBook 的 activeBookId 同款处理(slot-resource 抽象层)。
 */
const MAIL_STORE_KEY = 'mail';

const activeServiceResource = declareSlotResource<MailServiceId>({
  name: 'mail.activeService',
  storeKey: MAIL_STORE_KEY,
  leftField: 'activeService',
  rightField: 'rightActiveService',
  fallback: DEFAULT_MAIL_SERVICE,
});

function getActiveService(workspaceId: string, slot: 'left' | 'right'): MailServiceId {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return DEFAULT_MAIL_SERVICE;
  const v = activeServiceResource.get(ws, slot);
  // 守卫:持久化里可能是旧版遗留 / 手改坏的值,不认就回默认
  return v && VALID_IDS.has(v) ? v : DEFAULT_MAIL_SERVICE;
}

function setActiveService(
  workspaceId: string,
  slot: 'left' | 'right',
  serviceId: MailServiceId,
): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  // patch 产的是 **store 内部**字段(activeService / rightActiveService),
  // 要合并进 pluginStates['mail'] 里,不是摊到 pluginStates 顶层(照 note 的 writePersistent)。
  const current = (ws.pluginStates?.[MAIL_STORE_KEY] as Record<string, unknown> | undefined) ?? {};
  workspaceManager.update(workspaceId, {
    pluginStates: {
      ...(ws.pluginStates ?? {}),
      [MAIL_STORE_KEY]: { ...current, ...activeServiceResource.patch(slot, serviceId) },
    },
  });
}

export function MailView({ workspaceId, payload, slot = 'left' }: MailViewProps) {
  const mailApi = useMemo(
    () => requireCapabilityApi<MailServiceApi>('mail-service'),
    [],
  );
  const MailHost = mailApi.Host;
  const hostRef = useRef<MailHostHandle | null>(null);

  const activeService = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => getActiveService(workspaceId, slot),
  );

  // ✕ 关**自己那一栏**。用框架传的 slot,不用 slotBinding 反推(见文件头铁律)。
  const handleClose = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    if (slot === 'right') bus.slot.closeRight();
    else bus.slot.closeLeft();
  }, [workspaceId, slot]);

  /**
   * ⊞ 右栏视图切换 —— 复用全局 SlotPicker(与 Note / AI / Social toolbar 同一套机制)。
   *
   * 铁律:同功能同逻辑。右栏能开什么由 viewTypeRegistry 动态决定 —— 新增 view
   * 自动出现在列表里,不用回来改这里,也不必每个 view 各造一个「开右栏」按钮。
   */
  const handleOpenSlotPicker = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    slotPickerContext.setCommandId('mail-view.open-right-slot');
    popupController.toggle(SLOT_PICKER_POPUP_ID, e.currentTarget);
  }, []);

  // Host guest wcId 登记(提取时按 ws 定向,治多实例串扰)
  const registerWc = useCallback(() => {
    const wcId = hostRef.current?.getWebContentsId() ?? null;
    if (wcId != null) mailApi.registerMailHostWcId(workspaceId, wcId);
  }, [mailApi, workspaceId]);

  useEffect(() => {
    return () => mailApi.clearMailHostWcId(workspaceId);
  }, [mailApi, workspaceId]);

  // payload.subId → 切到指定服务商(SlotPicker 子项选择时传入)
  useEffect(() => {
    if (!payload || typeof payload !== 'object') return;
    const { subId } = payload as { subId?: string };
    if (subId && VALID_IDS.has(subId)) {
      setActiveService(workspaceId, slot, subId as MailServiceId);
    }
  }, [payload, workspaceId, slot]);

  return (
    <div className="krig-mail-view">
      <div className="krig-mail-view__tabbar">
        <div className="krig-mail-view__tabs">
          {MAIL_SERVICE_PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`krig-mail-view__tab${p.id === activeService ? ' krig-mail-view__tab--active' : ''}`}
              onClick={() => setActiveService(workspaceId, slot, p.id)}
              title={p.name}
            >
              <span>{p.icon}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="krig-mail-view__drag-spacer" />
        <div className="krig-mail-view__actions">
          <button
            type="button"
            className="krig-mail-view__action-btn"
            onClick={() => hostRef.current?.goBack()}
            title="后退"
          >
            ←
          </button>
          <button
            type="button"
            className="krig-mail-view__action-btn"
            onClick={() => hostRef.current?.goHome()}
            title="收件箱"
          >
            📥
          </button>
          <button
            type="button"
            className="krig-mail-view__action-btn"
            onClick={() => hostRef.current?.goCompose()}
            title="写邮件"
          >
            ✏️
          </button>
          <button
            type="button"
            className="krig-mail-view__action-btn"
            onClick={() => hostRef.current?.reload()}
            title="刷新"
          >
            ⟳
          </button>
          <button
            type="button"
            className="krig-mail-view__action-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleOpenSlotPicker}
            title="在右栏打开视图"
          >
            ⊞
          </button>
          <button
            type="button"
            className="krig-mail-view__close-btn"
            onClick={handleClose}
            title="关闭此栏"
          >
            ✕
          </button>
        </div>
      </div>
      <MailHost
        ref={hostRef}
        workspaceId={workspaceId}
        serviceId={activeService}
        className="krig-mail-view__webview"
        onUrlChanged={() => { registerWc(); }}
        onLoadingChanged={() => {}}
      />
    </div>
  );
}
