/**
 * tweet DOM 提取脚本(L5-B3.18)
 *
 * V1 → V2 直迁:src/plugins/web/main/ipc-handlers.ts 中的 EXTRACT_TWEET_JS 字符串。
 *
 * 在隐藏 BrowserWindow 的 Twitter 页面 webContents 内 executeJavaScript 执行,
 * 基于 Twitter 官方 `data-testid` 属性提取作者 / 正文 / 时间 / 媒体 / metrics /
 * 引用 / inReplyTo。失败保护:多层 try/catch,任一字段提取失败不影响其他字段。
 *
 * ⚠️ 临时 DOM scraping 实现 — Phase D browser-capability 正式化后吸收(见 DESIGN.md)。
 *
 * 风险:Twitter SPA 反爬升级(改名 / 改结构)→ 选择器失效。本字符串可独立小补丁更新,
 * 不影响 fetcher.ts 主体逻辑。
 */

export const EXTRACT_TWEET_JS = `
(function() {
  const result = {};
  try {
    // 找到主推文 article
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const article = articles[0];
    if (!article) return result;

    // 作者信息
    try {
      const userNameEl = article.querySelector('[data-testid="User-Name"]');
      if (userNameEl) {
        const spans = userNameEl.querySelectorAll('span');
        for (const span of spans) {
          const text = span.textContent || '';
          if (text.startsWith('@')) result.authorHandle = text;
          else if (text.length > 1 && !text.startsWith('@') && !text.includes('·')) {
            if (!result.authorName) result.authorName = text;
          }
        }
      }
    } catch {}

    // 头像
    try {
      const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
      if (avatarImg) result.authorAvatar = avatarImg.src;
    } catch {}

    // 推文正文
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      if (tweetText) {
        result.text = tweetText.textContent || '';
        result.lang = tweetText.getAttribute('lang') || '';
      }
    } catch {}

    // 时间
    try {
      const timeEl = article.querySelector('time');
      if (timeEl) result.createdAt = timeEl.getAttribute('datetime') || '';
    } catch {}

    // 图片媒体
    try {
      const photos = article.querySelectorAll('[data-testid="tweetPhoto"] img');
      if (photos.length > 0) {
        result.media = [];
        photos.forEach(img => {
          result.media.push({ type: 'image', url: img.src });
        });
      }
    } catch {}

    // 视频媒体
    try {
      const videos = article.querySelectorAll('video');
      videos.forEach(v => {
        if (!result.media) result.media = [];
        result.media.push({ type: 'video', url: v.src || '', thumbUrl: v.poster || '' });
      });
    } catch {}

    // 互动数据
    try {
      const group = article.querySelector('[role="group"]');
      if (group) {
        const buttons = group.querySelectorAll('[data-testid]');
        const metrics = {};
        buttons.forEach(btn => {
          const testId = btn.getAttribute('data-testid') || '';
          const numSpan = btn.querySelector('span[data-testid]') || btn.querySelector('span');
          const numText = numSpan ? numSpan.textContent.trim() : '';
          const num = parseMetricNumber(numText);
          if (testId.includes('reply')) metrics.replies = num;
          if (testId.includes('retweet')) metrics.retweets = num;
          if (testId.includes('like')) metrics.likes = num;
        });
        // 浏览量
        try {
          const analyticsLink = article.querySelector('a[href*="/analytics"]');
          if (analyticsLink) {
            const viewSpan = analyticsLink.querySelector('span');
            if (viewSpan) metrics.views = parseMetricNumber(viewSpan.textContent.trim());
          }
        } catch {}
        if (Object.keys(metrics).length > 0) result.metrics = metrics;
      }
    } catch {}

    // 引用推文
    try {
      const quote = article.querySelector('[data-testid="quoteTweet"]');
      if (quote) {
        const link = quote.querySelector('a[href*="/status/"]');
        if (link) result.quotedTweet = link.href;
      }
    } catch {}

    // 回复上下文
    try {
      const social = article.querySelector('[data-testid="socialContext"]');
      if (social) {
        const link = social.querySelector('a[href*="/status/"]');
        if (link) result.inReplyTo = link.href;
      }
    } catch {}

  } catch {}
  return result;

  function parseMetricNumber(s) {
    if (!s) return 0;
    s = s.replace(/,/g, '');
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
})()
`;
