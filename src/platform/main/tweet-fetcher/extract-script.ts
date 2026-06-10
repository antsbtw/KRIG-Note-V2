/**
 * tweet DOM 提取脚本(L5-B3.18)
 *
 * V1 → V2 直迁:src/plugins/web/main/ipc-handlers.ts 中的 EXTRACT_TWEET_JS 字符串。
 *
 * 在 Twitter 页面 webContents 内 executeJavaScript 执行,基于 Twitter 官方
 * `data-testid` 属性提取作者 / 正文 / 时间 / 媒体 / metrics / 引用 / inReplyTo。
 * 失败保护:多层 try/catch,任一字段提取失败不影响其他字段。
 *
 * X 集成 阶段 1(铁律 1:复用而非复制):字段抽取逻辑提成「给定根 article 元素」上运行的
 * 函数体 TWEET_SCRAPE_FN_BODY,由两个消费者共享:
 * - tweet-fetcher(EXTRACT_TWEET_JS):隐藏窗口里抓页面第一个 article(旧路径,临时能力)。
 * - X 提取(x-extract-tweet.ts):前台 X webview 里抓用户右键命中的那个 article。
 *
 * 风险:Twitter SPA 反爬升级(改名 / 改结构)→ 选择器失效。本字符串可独立小补丁更新。
 */

/**
 * 推文字段抽取「函数体」字符串。
 *
 * 在 guest 端被包进 IIFE 后,提供两个全局可用函数:
 * - `scrapeTweetArticle(article)` → 返回推文字段对象(从给定 article 根元素抓)。
 * - `parseMetricNumber(s)` → "1.2K" / "3M" → 数字。
 *
 * 注:此处只「定义函数」,不「调用」。各消费者自己决定如何拿到 article 根元素后调用,
 * 这样同一套字段选择器既服务「页面首个 article」也服务「坐标命中的 article」。
 */
export const TWEET_SCRAPE_FN_BODY = `
  function parseMetricNumber(s) {
    if (!s) return 0;
    s = s.replace(/,/g, '');
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }

  function scrapeTweetArticle(article) {
    var result = {};
    if (!article) return result;

    // 作者信息
    try {
      var userNameEl = article.querySelector('[data-testid="User-Name"]');
      if (userNameEl) {
        var spans = userNameEl.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          var text = spans[i].textContent || '';
          if (text.startsWith('@')) result.authorHandle = text;
          else if (text.length > 1 && !text.startsWith('@') && !text.includes('·')) {
            if (!result.authorName) result.authorName = text;
          }
        }
      }
    } catch (e) {}

    // 头像
    try {
      var avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img');
      if (avatarImg) result.authorAvatar = avatarImg.src;
    } catch (e) {}

    // 推文正文
    try {
      var tweetText = article.querySelector('[data-testid="tweetText"]');
      if (tweetText) {
        result.text = tweetText.textContent || '';
        result.lang = tweetText.getAttribute('lang') || '';
      }
    } catch (e) {}

    // 时间 + 推文链接 / id(time 外层 a 的 href 含 /status/<id>)
    try {
      var timeEl = article.querySelector('time');
      if (timeEl) {
        result.createdAt = timeEl.getAttribute('datetime') || '';
        var timeLink = timeEl.closest('a[href*="/status/"]');
        if (timeLink && timeLink.href) {
          result.tweetUrl = timeLink.href;
          var m = timeLink.href.match(/\\/status\\/(\\d+)/);
          if (m) result.tweetId = m[1];
        }
      }
    } catch (e) {}

    // 图片媒体
    try {
      var photos = article.querySelectorAll('[data-testid="tweetPhoto"] img');
      if (photos.length > 0) {
        result.media = result.media || [];
        for (var p = 0; p < photos.length; p++) {
          result.media.push({ type: 'image', url: photos[p].src });
        }
      }
    } catch (e) {}

    // 视频媒体
    try {
      var videos = article.querySelectorAll('video');
      for (var v = 0; v < videos.length; v++) {
        result.media = result.media || [];
        result.media.push({ type: 'video', url: videos[v].src || '', thumbUrl: videos[v].poster || '' });
      }
    } catch (e) {}

    // 互动数据
    try {
      var group = article.querySelector('[role="group"]');
      if (group) {
        var buttons = group.querySelectorAll('[data-testid]');
        var metrics = {};
        for (var b = 0; b < buttons.length; b++) {
          var btn = buttons[b];
          var testId = btn.getAttribute('data-testid') || '';
          var numSpan = btn.querySelector('span[data-testid]') || btn.querySelector('span');
          var numText = numSpan ? (numSpan.textContent || '').trim() : '';
          var num = parseMetricNumber(numText);
          if (testId.includes('reply')) metrics.replies = num;
          if (testId.includes('retweet')) metrics.retweets = num;
          if (testId.includes('like')) metrics.likes = num;
        }
        // 浏览量
        try {
          var analyticsLink = article.querySelector('a[href*="/analytics"]');
          if (analyticsLink) {
            var viewSpan = analyticsLink.querySelector('span');
            if (viewSpan) metrics.views = parseMetricNumber((viewSpan.textContent || '').trim());
          }
        } catch (e) {}
        if (Object.keys(metrics).length > 0) result.metrics = metrics;
      }
    } catch (e) {}

    // 引用推文
    try {
      var quote = article.querySelector('[data-testid="quoteTweet"]');
      if (quote) {
        var qlink = quote.querySelector('a[href*="/status/"]');
        if (qlink) result.quotedTweet = qlink.href;
      }
    } catch (e) {}

    // 回复上下文
    try {
      var social = article.querySelector('[data-testid="socialContext"]');
      if (social) {
        var slink = social.querySelector('a[href*="/status/"]');
        if (slink) result.inReplyTo = slink.href;
      }
    } catch (e) {}

    return result;
  }
`;

/**
 * 旧 tweet-fetcher 路径:隐藏窗口里抓「页面第一个 article」。
 * 复用 TWEET_SCRAPE_FN_BODY 的字段抽取,只负责定位根元素 = articles[0]。
 */
export const EXTRACT_TWEET_JS = `
(function() {
  ${TWEET_SCRAPE_FN_BODY}
  try {
    var articles = document.querySelectorAll('article[data-testid="tweet"]');
    return scrapeTweetArticle(articles[0]);
  } catch (e) {
    return {};
  }
})()
`;
