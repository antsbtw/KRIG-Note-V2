/**
 * BackgroundAIWebview — 后台 AI WebView 管理
 *
 * 创建一个隐藏的 BrowserWindow,直接加载 AI 服务页面(claude.ai / chatgpt.com / gemini.google.com)。
 * 共享 partition,复用用户在前台 webview 中的登录状态。
 *
 * 设计原则:
 * - 懒初始化:第一次 ai.ask 时才创建
 * - 自动销毁:5 分钟无请求后销毁释放资源
 * - 单实例:同一时间只有一个后台 webview
 *
 * V1 源:src/plugins/web-bridge/capabilities/background-webview.ts(字面搬,改 2 个 import 路径)
 */

import { BrowserWindow, session } from 'electron';
import {
  type AIServiceId,
  getAIServiceProfile,
} from '@shared/types/ai-service-types';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';

/** 后台 webview 的状态 */
export type BackgroundAIStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 自动销毁超时(毫秒):5 分钟无请求 */
const AUTO_DESTROY_TIMEOUT = 5 * 60 * 1000;

class BackgroundAIWebview {
  private window: BrowserWindow | null = null;
  private currentServiceId: AIServiceId | null = null;
  private status: BackgroundAIStatus = 'idle';
  private destroyTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 确保后台 webview 就绪并导航到指定 AI 服务。
   * 懒初始化:首次调用时创建隐藏窗口。
   *
   * @returns 后台窗口的 webContents(用于 executeJavaScript 注入脚本)
   */
  async ensureReady(serviceId: AIServiceId): Promise<Electron.WebContents> {
    this.resetDestroyTimer();

    // 1. 如果窗口不存在,创建
    if (!this.window || this.window.isDestroyed()) {
      await this.createWindow();
    }

    // 2. 如果服务不同,导航到新服务
    if (this.currentServiceId !== serviceId) {
      await this.navigateToService(serviceId);
    }

    return this.window!.webContents;
  }

  /** 获取当前状态 */
  getStatus(): { status: BackgroundAIStatus; serviceId: AIServiceId | null; url: string | null } {
    return {
      status: this.status,
      serviceId: this.currentServiceId,
      url: this.window && !this.window.isDestroyed()
        ? this.window.webContents.getURL()
        : null,
    };
  }

  /** 获取后台窗口的 webContents(如果存在) */
  getWebContents(): Electron.WebContents | null {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window.webContents;
  }

  /** 销毁后台 webview */
  destroy(): void {
    this.clearDestroyTimer();
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
    this.currentServiceId = null;
    this.status = 'idle';
  }

  // ── 内部方法 ──

  private async createWindow(): Promise<void> {
    this.status = 'loading';

    // 确保 CSP bypass 在共享 webview session 上(前台 WebView 已设置,但后台窗口可能先启动)
    this.setupCSPBypass();

    this.window = new BrowserWindow({
      show: false,            // 隐藏窗口
      width: 1280,
      height: 800,
      webPreferences: {
        // 后台窗口直接加载 AI 服务页面,不嵌套 webview 标签
        // 使用共享 partition 复用前台登录状态
        partition: WEBVIEW_PARTITION,
        contextIsolation: false,   // AI 服务页面需要完整的 JS 环境
        nodeIntegration: false,    // 安全:不暴露 Node API 给 AI 服务
        sandbox: false,            // 允许 preload 脚本注入
      },
    });

    // 窗口关闭时清理引用
    this.window.on('closed', () => {
      this.window = null;
      this.currentServiceId = null;
      this.status = 'idle';
    });
  }

  private async navigateToService(serviceId: AIServiceId): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;

    const profile = getAIServiceProfile(serviceId);
    this.status = 'loading';
    this.currentServiceId = serviceId;

    try {
      await this.window.webContents.loadURL(profile.newChatUrl);
      this.status = 'ready';
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  /**
   * 在共享 webview session 上设置 CSP bypass。
   * 剥离 HTTP 响应中的 Content-Security-Policy header,
   * 允许我们向 AI 服务页面注入脚本。
   */
  private setupCSPBypass(): void {
    const webSession = session.fromPartition(WEBVIEW_PARTITION);

    // 避免重复注册(前台 WebView 可能已经注册过)
    // Electron 没有提供检查 handler 是否已注册的 API,
    // 但重复注册 onHeadersReceived 会覆盖之前的 handler,所以这里安全地注册。
    webSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers['content-security-policy'];
      delete headers['Content-Security-Policy'];
      delete headers['content-security-policy-report-only'];
      delete headers['Content-Security-Policy-Report-Only'];
      callback({ responseHeaders: headers });
    });
  }

  private resetDestroyTimer(): void {
    this.clearDestroyTimer();
    this.destroyTimer = setTimeout(() => {
      this.destroy();
    }, AUTO_DESTROY_TIMEOUT);
  }

  private clearDestroyTimer(): void {
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
  }
}

/** 单例 */
export const backgroundAI = new BackgroundAIWebview();
