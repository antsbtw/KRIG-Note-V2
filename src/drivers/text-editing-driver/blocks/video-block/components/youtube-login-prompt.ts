/**
 * youtube-login-prompt — YouTube 登录提示 modal(L5-B3.19.e UX)
 *
 * 用户首次下载 YouTube 视频时,如果 webview partition 没有 YouTube cookies,
 * 显示这个 modal 引导用户去 web view 登录(我们自己的 webview session,
 * 不读用户系统 Chrome — 隐私友好)。
 *
 * UI:全 NodeView 内部遮罩 modal(类似 vocab-panel,自管 DOM)
 *  ┌─────────────────────────────────┐
 *  │  ⚠️ YouTube 反爬检测             │
 *  │                                  │
 *  │  下载需要先在 web view 登录       │
 *  │  Google 账号(YouTube 账号)。     │
 *  │                                  │
 *  │  [前往 web view 登录]  [取消]     │
 *  └─────────────────────────────────┘
 *
 * 用户点 [前往登录] → onConfirm 回调 → download-button 调
 *   commandRegistry.execute('web-view.open-url', 'https://www.youtube.com')
 * 用户登录后 cookies 自动写入 persist:webview;再点 ⬇ 即可。
 */

export interface YoutubeLoginPromptDeps {
  onConfirm: () => void; // 用户点"前往登录"
  onCancel: () => void; // 用户点"取消"(尝试不带 cookies 下载,可能失败)
}

export interface YoutubeLoginPrompt {
  el: HTMLElement;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function createYoutubeLoginPrompt(deps: YoutubeLoginPromptDeps): YoutubeLoginPrompt {
  // 遮罩层:覆盖整个 NodeView,挡住底层交互
  const overlay = document.createElement('div');
  overlay.className = 'krig-video-block__login-prompt-overlay';
  overlay.style.display = 'none';
  // 阻止 mousedown 冒泡到 PM(防 NodeSelection 销毁)
  overlay.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  const modal = document.createElement('div');
  modal.className = 'krig-video-block__login-prompt-modal';
  overlay.appendChild(modal);

  const title = document.createElement('div');
  title.className = 'krig-video-block__login-prompt-title';
  title.textContent = '⚠️ 需要登录 YouTube';
  modal.appendChild(title);

  const body = document.createElement('div');
  body.className = 'krig-video-block__login-prompt-body';
  body.innerHTML =
    '下载视频前,需要先在 <strong>web view</strong> 中登录你的 Google 账号(YouTube 账号),' +
    '让 YouTube 信任来源(反爬验证)。<br><br>' +
    '点击"前往 web view 登录"按钮 — 将自动切到 web view 并打开 youtube.com。' +
    '登录完成后回来再点 ⬇ 下载即可。';
  modal.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'krig-video-block__login-prompt-actions';
  modal.appendChild(actions);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'krig-video-block__login-prompt-btn krig-video-block__login-prompt-btn--primary';
  confirmBtn.textContent = '前往 web view 登录';
  confirmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deps.onConfirm();
  });
  // mousedown 防 PM NodeSelection
  confirmBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  actions.appendChild(confirmBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'krig-video-block__login-prompt-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deps.onCancel();
  });
  cancelBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  actions.appendChild(cancelBtn);

  return {
    el: overlay,
    show() {
      overlay.style.display = 'flex';
    },
    hide() {
      overlay.style.display = 'none';
    },
    destroy() {
      overlay.remove();
    },
  };
}
