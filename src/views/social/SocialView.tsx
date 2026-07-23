import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi, XHostHandle } from '@capabilities/x-extraction';
import { XPublishOverlay } from '@shell/global-progress-overlay/XPublishOverlay';
import './social.css';

type PlatformId = 'x';

const PLATFORMS: Array<{ id: PlatformId; name: string; icon: string }> = [
  { id: 'x', name: 'X', icon: '𝕏' },
  // 未来: { id: 'reddit', name: 'Reddit', icon: '🤖' },
];

interface SocialViewProps {
  workspaceId: string;
}

function getActivePlatform(workspaceId: string): PlatformId {
  const ws = workspaceManager.get(workspaceId);
  const persisted = ws?.pluginStates?.['social'] as { activePlatform?: string } | undefined;
  return persisted?.activePlatform === 'x' ? 'x' : 'x';
}

function setActivePlatform(workspaceId: string, platform: PlatformId): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  workspaceManager.update(workspaceId, {
    pluginStates: {
      ...(ws.pluginStates ?? {}),
      social: { activePlatform: platform },
    },
  });
}

export function SocialView({ workspaceId }: SocialViewProps) {
  const xApi = useMemo(
    () => requireCapabilityApi<XExtractionApi>('x-extraction'),
    [],
  );
  const XHost = xApi.Host;
  const xHostRef = useRef<XHostHandle | null>(null);

  const activePlatform = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => getActivePlatform(workspaceId),
  );

  const registerXWc = useCallback(() => {
    const wcId = xHostRef.current?.getWebContentsId() ?? null;
    if (wcId != null) xApi.registerXHostWcId(workspaceId, wcId);
  }, [xApi, workspaceId]);

  useEffect(() => {
    return () => xApi.clearXHostWcId(workspaceId);
  }, [xApi, workspaceId]);

  /**
   * 订阅 'x.open-tweet' — tweet block「Open original」触发 x-view.open-tweet 命令发的:
   * payload: { url: string, emittedAt: number }
   *
   * 收到 → 把 X webview 导航到该推文。
   * last-known pull + emittedAt 去重(应对 mount/切 ws 边角)。
   */
  const lastXNavAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as { url?: string; emittedAt?: number };
      if (typeof p.url !== 'string' || !p.url) return;
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastXNavAtRef.current) return;
      lastXNavAtRef.current = ts;
      xHostRef.current?.navigate(p.url);
    };
    const last = bus.channels.getLastValue('x.open-tweet');
    if (last) handle(last);
    const unsub = bus.channels.subscribe('x.open-tweet', handle);
    return () => unsub();
  }, [workspaceId]);

  /**
   * 订阅 'x.activate-launcher' — 「发到 X」注入前发的:
   * 让 SocialView 切到 X 平台,把 X webview 显示出来 + 注册 wcId,
   * main 侧 pasteTweet/pasteReply 才能拿到活跃 X webContents。
   */
  const lastXActivateAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as { emittedAt?: number };
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastXActivateAtRef.current) return;
      lastXActivateAtRef.current = ts;
      setActivePlatform(workspaceId, 'x');
    };
    const last = bus.channels.getLastValue('x.activate-launcher');
    if (last) handle(last);
    const unsub = bus.channels.subscribe('x.activate-launcher', handle);
    return () => unsub();
  }, [workspaceId]);

  return (
    <div className="krig-social-view">
      <div className="krig-social-view__tabbar">
        <div className="krig-social-view__tabs">
          {PLATFORMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`krig-social-view__tab${item.id === activePlatform ? ' krig-social-view__tab--active' : ''}`}
              onClick={() => setActivePlatform(workspaceId, item.id)}
              title={item.name}
            >
              <span>{item.icon}</span>
              <span>{item.name}</span>
            </button>
          ))}
        </div>
      </div>
      <XHost
        ref={xHostRef}
        workspaceId={workspaceId}
        className="krig-social-view__webview"
        onUrlChanged={() => { registerXWc(); }}
        onLoadingChanged={() => {}}
      />
      <XPublishOverlay />
    </div>
  );
}
