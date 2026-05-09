/**
 * time-tracker — 视频播放时间统一抽象(L5-B3.19.a 核心)
 *
 * 双源:
 * - YouTube iframe 走 postMessage IFrame API(`event:'listening'` 激活 + `infoDelivery` 推送)
 * - <video> 元素走 `videoEl.currentTime` 直读
 *
 * **单源 300ms 轮询多订阅**(对齐 V1 模式):tracker 内部一个 setInterval 轮询
 * `getCurrentTime()`,所有订阅者(CC / vocab-panel / Memory)共享。
 *
 * 零订阅时停轮询;新订阅恢复 — 避免空转。
 *
 * 严格校验 `event.source === iframe.contentWindow` 防止跨 iframe message 误中。
 */

const POLL_INTERVAL_MS = 300;

export interface TimeTracker {
  /** 订阅 currentTime 变化(每 ~300ms 触发,值是当前播放位置秒数)*/
  onTimeUpdate(cb: (time: number) => void): () => void;
  /** 订阅 duration 解析完成(YouTube 异步推送,video metadata 加载)*/
  onDurationReady(cb: (duration: number) => void): () => void;
  /** 同步取当前时间(0 if not ready)*/
  getCurrentTime(): number;
  /** 同步取总时长(0 if not ready)*/
  getDuration(): number;
  /** 跳转(YouTube postMessage / video.currentTime=)*/
  seekTo(seconds: number): void;
  /** 播放(YouTube postMessage / video.play)*/
  play(): void;
  /** 销毁:卸载 listener / 停轮询 */
  destroy(): void;
}

type TimeSource =
  | { kind: 'video'; el: HTMLVideoElement }
  | { kind: 'youtube'; iframe: HTMLIFrameElement };

/** 工厂:videoEl 已有时建 video tracker;否则建 youtube tracker(收 iframe ref)*/
export function createTimeTracker(
  source: { videoEl: HTMLVideoElement } | { iframe: HTMLIFrameElement },
): TimeTracker {
  const src: TimeSource =
    'videoEl' in source ? { kind: 'video', el: source.videoEl } : { kind: 'youtube', iframe: source.iframe };

  // ── state ──
  let currentTime = 0;
  let duration = 0;
  const timeListeners = new Set<(t: number) => void>();
  const durationListeners = new Set<(d: number) => void>();
  let pollId: number | null = null;
  let destroyed = false;

  // ── YouTube postMessage 接线(仅 youtube 源)──
  let ytMessageHandler: ((e: MessageEvent) => void) | null = null;
  if (src.kind === 'youtube') {
    ytMessageHandler = (event: MessageEvent) => {
      if (event.source !== src.iframe.contentWindow) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.event === 'infoDelivery' && data.info?.currentTime != null) {
          currentTime = data.info.currentTime;
        }
        if (data?.info?.duration != null && data.info.duration > 0 && duration === 0) {
          duration = data.info.duration;
          durationListeners.forEach((cb) => cb(duration));
        }
      } catch {
        /* ignore parse failures (其他源 postMessage 命中)*/
      }
    };
    window.addEventListener('message', ytMessageHandler);
    // iframe 加载后激活 YouTube 推 infoDelivery
    src.iframe.addEventListener('load', () => {
      src.iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*');
    });
  }

  // ── video 元素 metadata 监听(直接源)──
  let videoMetaHandler: (() => void) | null = null;
  if (src.kind === 'video') {
    videoMetaHandler = () => {
      if (src.el.duration > 0 && duration === 0) {
        duration = src.el.duration;
        durationListeners.forEach((cb) => cb(duration));
      }
    };
    src.el.addEventListener('loadedmetadata', videoMetaHandler);
  }

  // ── 同步 getter ──
  function getCurrentTime(): number {
    return src.kind === 'video' ? src.el.currentTime : currentTime;
  }

  function getDuration(): number {
    return src.kind === 'video' && src.el.duration > 0 ? src.el.duration : duration;
  }

  // ── 轮询管理 ──
  function startPolling(): void {
    if (pollId !== null || destroyed) return;
    pollId = window.setInterval(() => {
      const t = getCurrentTime();
      timeListeners.forEach((cb) => cb(t));
    }, POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollId !== null) {
      window.clearInterval(pollId);
      pollId = null;
    }
  }

  function ensurePolling(): void {
    if (timeListeners.size > 0) startPolling();
    else stopPolling();
  }

  // ── public API ──
  return {
    onTimeUpdate(cb) {
      timeListeners.add(cb);
      ensurePolling();
      return () => {
        timeListeners.delete(cb);
        ensurePolling();
      };
    },

    onDurationReady(cb) {
      // 已就绪则立即 fire 一次,避免错过
      if (duration > 0) cb(duration);
      durationListeners.add(cb);
      return () => {
        durationListeners.delete(cb);
      };
    },

    getCurrentTime,
    getDuration,

    seekTo(seconds) {
      if (src.kind === 'video') {
        src.el.currentTime = seconds;
      } else {
        src.iframe.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
          '*',
        );
      }
    },

    play() {
      if (src.kind === 'video') {
        void src.el.play().catch(() => {
          /* autoplay policy may block — ignore */
        });
      } else {
        src.iframe.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
          '*',
        );
      }
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPolling();
      timeListeners.clear();
      durationListeners.clear();
      if (ytMessageHandler) {
        window.removeEventListener('message', ytMessageHandler);
        ytMessageHandler = null;
      }
      if (videoMetaHandler && src.kind === 'video') {
        src.el.removeEventListener('loadedmetadata', videoMetaHandler);
        videoMetaHandler = null;
      }
    },
  };
}
