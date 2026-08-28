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
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { popupController } from '@slot/triggers/popup-controller';
import { SLOT_PICKER_POPUP_ID, slotPickerContext } from '@shell/slot-picker';
import { MAIL_ACCOUNT_POPUP_ID } from './account-popup';
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
 * 「当前邮箱服务商」per-ws(**刻意不 per-slot**)。
 *
 * 曾短暂改成 per-slot(declareSlotResource,与 note 的 activeNoteId / eBook 的
 * activeBookId 同款),动机是支撑「左 Gmail 右 Outlook 对照看」。
 * 用户 2026-08-26 明确「这个功能没有必要」→ 回退。
 *
 * 后果(已知且接受):左右双开 Mail 时两栏读同一字段,切服务商会同步切换。
 * 若将来真需要双栏各看一个邮箱,改回 per-slot 即可 —— slot-resource 抽象层现成,
 * 改动只在本文件这几个函数(参照 note/data-model.ts 的 activeNoteResource)。
 */
const MAIL_STORE_KEY = 'mail';

function getActiveService(workspaceId: string): MailServiceId {
  const ws = workspaceManager.get(workspaceId);
  const persisted = ws?.pluginStates?.[MAIL_STORE_KEY] as { activeService?: string } | undefined;
  const v = persisted?.activeService;
  // 守卫:持久化里可能是旧版遗留 / 手改坏的值,不认就回默认
  return v && VALID_IDS.has(v) ? (v as MailServiceId) : DEFAULT_MAIL_SERVICE;
}

function setActiveService(workspaceId: string, serviceId: MailServiceId): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const current = (ws.pluginStates?.[MAIL_STORE_KEY] as Record<string, unknown> | undefined) ?? {};
  workspaceManager.update(workspaceId, {
    pluginStates: {
      ...(ws.pluginStates ?? {}),
      [MAIL_STORE_KEY]: { ...current, activeService: serviceId },
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
    () => getActiveService(workspaceId),
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

  /** ⚙ 邮箱账号(IMAP 同步配置)—— 低频操作,弹窗而非常驻面板 */
  const handleOpenAccounts = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    popupController.toggle(MAIL_ACCOUNT_POPUP_ID, e.currentTarget);
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
      setActiveService(workspaceId, subId as MailServiceId);
    }
  }, [payload, workspaceId]);

  return (
    <div className="krig-mail-view">
      <div className="krig-mail-view__tabbar">
        <div className="krig-mail-view__tabs">
          {MAIL_SERVICE_PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`krig-mail-view__tab${p.id === activeService ? ' krig-mail-view__tab--active' : ''}`}
              onClick={() => setActiveService(workspaceId, p.id)}
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
            onClick={handleOpenAccounts}
            title="邮箱账号(IMAP 同步)"
          >
            ⚙
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
