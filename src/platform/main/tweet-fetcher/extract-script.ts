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
  /**
   * ⭐⭐ 把这条推里的「Show more」点开 —— 用户 2026-09-22 定的原则:
   *
   * > 「不管长文短文,如果折叠起来就应该 show all,然后获取完整的内容,就像人一样」
   *
   * ⚠️ 为什么非点不可:折叠时 [data-testid="tweetText"] 里**只有开头**,
   * 剩下的正文根本不在 DOM 里(不是 display:none,是压根没渲染)。
   * 所以「读 textContent」拿到的必然是截断版 —— 这是采集一直「零碎」的真因之一。
   *
   * ⚠️ 只点**站内展开**,绝不点外链/媒体:
   * X 的展开按钮是 <button data-testid="tweet-text-show-more-link">,
   * 兜底才按文案找,且**必须排除 a 标签**(那些是外链,点了会导航走)。
   *
   * @returns 点开了几个(0 = 这条本来就是全的)
   */
  function expandTweetText(article) {
    if (!article) return 0;
    var n = 0;
    try {
      // ① X 的正式按钮 —— 有 testid,最稳
      var btns = article.querySelectorAll('button[data-testid="tweet-text-show-more-link"]');
      for (var i = 0; i < btns.length; i++) { btns[i].click(); n++; }
      if (n > 0) return n;
      // ② 兜底:按文案找**按钮**(绝不匹配 a —— 那是外链,点了会离开页面)
      var cands = article.querySelectorAll('button, [role="button"]');
      for (var j = 0; j < cands.length; j++) {
        var el = cands[j];
        if (el.tagName === 'A' || el.closest('a')) continue;
        var txt = (el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (/^(Show more|显示更多|さらに表示|더 보기|Показать ещё)$/i.test(txt)) {
          el.click(); n++;
        }
      }
    } catch (e) {}
    return n;
  }

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

    // ⭐ 蓝V —— 用户 2026-09-18 实机验证指出缺这项
    //
    // ⚠️ selector 全仓**没有实测记录**,所以这里用**宽判据**:
    //    X 的认证徽章在 User-Name 区域里,历史上用过
    //    data-testid=icon-verified 与带 aria-label 的 svg 两种形态。
    //    ⚠️ 本注释在模板字符串里,**不能用反引号** —— 会提前闭合模板,整段语法崩。
    //    两个都试,并且**把实际看到的证据带回来**(verifiedEvidence)——
    //    这样面板上能看见「是靠哪一条判出来的」,判错了也查得到,
    //    而不是只给一个 true/false 让人猜。
    try {
      var unEl = article.querySelector('[data-testid="User-Name"]');
      if (unEl) {
        var byTestid = unEl.querySelector('[data-testid="icon-verified"]');
        var evidence = null;
        if (byTestid) {
          evidence = 'testid:icon-verified';
        } else {
          // 回退:找 aria-label 里含 Verified/已认证 的元素
          var marked = unEl.querySelectorAll('svg[aria-label], [aria-label]');
          for (var vi = 0; vi < marked.length; vi++) {
            var al = marked[vi].getAttribute('aria-label') || '';
            if (/verified|认证/i.test(al)) { evidence = 'aria-label:' + al.slice(0, 40); break; }
          }
        }
        if (evidence) {
          result.isBlueVerified = true;
          result.verifiedEvidence = evidence;
        } else {
          // ⚠️ 没找到徽章 → false(「看过了,没有」),不是 undefined(「没查」)
          result.isBlueVerified = false;
        }
      }
    } catch (e) {}

    // ⭐⭐ 关注状态 + 作者数字 id —— **2026-09-18 实机实测得来**
    //
    // 来源:用户在采集验证面板上点了「关注/取关」,操作流记下了 testid:
    //   1640251786476023808-follow     ← 未关注(按钮写 Follow)
    //   1640251786476023808-unfollow   ← 已关注(按钮写 Following,点了才是取关)
    // 前缀那串数字就是作者的 rest_id(改名不变,比 handle 稳)。
    //
    // ⚠️ 仓里此前**零条**关注按钮的记录 —— 这是第一次有实测依据。
    // ⚠️ 这个按钮**只在悬浮卡/主页上才有**,时间线推文卡片上没有;
    //    读不到时保持 undefined(「没看到按钮」),**不要写 false**
    //    (那是「看到了,是未关注」)—— 两者含义相反。
    try {
      var followBtn = article.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
      if (followBtn) {
        var ftid = followBtn.getAttribute('data-testid') || '';
        result.iFollow = /-unfollow$/.test(ftid);
        var restId = ftid.replace(/-(un)?follow$/, '');
        if (/^\d+$/.test(restId)) result.authorRestId = restId;
        result.followEvidence = ftid;
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

    // 回复上下文 —— 「这条是回复谁的」
    //
    // ⚠️ 曾经取的是 [data-testid="socialContext"],**那是错的**:
    //    socialContext 是「xx 转推了 / 已置顶」这条横幅,不是回复关系。
    //
    // ⚠️⚠️ 2026-09-06 二次订正:我一度以为下面这段也「没命中」——
    //    依据是「search 采的 3782 条只有 48 条有值」。**那个推断是错的**:
    //    用户打开其中一条的详情页,X 上根本没有 "Replying to" 那一行 ——
    //    **它本来就是独立推**,字段为空是正确数据,不是选择器坏了。
    //    教训:低填充率 ≠ 提取器坏了,先确认样本里到底有没有那个现象
    //    (同 feedback-check-sample-contains-phenomenon)。
    //
    // X 的回复卡片在正文上方有一行「Replying to @xxx」/「回复 @xxx」,
    // 它是个链接指向被回复者主页(不是 /status/),所以这里
    // **抓 handle 而不是 status 链接**;父推 id 走载荷层补(见 x-timeline-harvester)。
    try {
      var blocks = article.querySelectorAll('div[dir]');
      for (var bi = 0; bi < blocks.length; bi++) {
        var bt = blocks[bi].textContent || '';
        if (bt.indexOf('Replying to') === 0 || bt.indexOf('回复 @') === 0
            || bt.indexOf('回复\u0020@') === 0) {
          var rlink = blocks[bi].querySelector('a[href^="/"]');
          if (rlink) {
            var rh = rlink.getAttribute('href') || '';
            // href = /someone → 取 handle
            // ⚠️ 反斜杠必须写 \\/ —— 这整段在**模板字面量**里,
            //    写 \/ 会被求值吃掉,浏览器收到 /^/(...)$/ —— 非法正则,
            //    整个脚本解析失败 → executeJavaScript 每次都抛 → fetched 恒为 0。
            //    实测后果:采集整整一天报「0 条」,日志里只看到
            //    「注入失败(多半撞上导航)」—— 那句话把真因盖掉了。
            //    参照同文件 line 79 的 \\/status\\/ 才是对的写法。
            var rm = rh.match(/^\\/([A-Za-z0-9_]{1,15})$/);
            if (rm) result.inReplyToUser = rm[1];
          }
          result.isReply = true;
          break;
        }
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
