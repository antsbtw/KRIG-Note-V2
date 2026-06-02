/**
 * defuddle-script — 生成注入到网页的整页提取脚本
 *
 * 注入脚本**逐字搬自** mirro fullpage-capture.ts generateDefuddleScript()
 * (懒加载图激活 / 非正文移除 / 代码块·表格·admonition 保护 / __PRELOADED_STATE__
 * 音频 / 补充 image·video 收集 / Schema.org)。
 *
 * 在 main 进程 guest.executeJavaScript(script) 执行,返回 JSON 字符串。
 * 唯一改动:bundle 来源改用本模块的 getDefuddleBundle()(路径解析见 defuddle-bundle.ts)。
 */

import { getDefuddleBundle } from './defuddle-bundle';

/**
 * 生成注入到网页的整页提取脚本
 * 执行后返回 JSON 字符串
 */
export function generateDefuddleScript(): string {
  const bundle = getDefuddleBundle();

  return `
    (function() {
      try {
        // 注入 Defuddle UMD bundle(暴露为局部变量)
        var _defuddleModule = {};
        (function(module, exports) {
          ${bundle}
        })(_defuddleModule, _defuddleModule);

        var DefuddleClass = _defuddleModule.exports || _defuddleModule;
        // UMD 可能直接导出 class,也可能导出 { default: class }
        if (DefuddleClass.default) DefuddleClass = DefuddleClass.default;

        // 预处理:激活懒加载图片,确保 Defuddle 能提取到真实 URL
        // 很多网站使用 data-src / data-srcset / <noscript> 中的 <img> 等懒加载方案
        (function fixLazyImages() {
          document.querySelectorAll('img').forEach(function(img) {
            // data-src → src
            if (!img.src || img.src === '' || img.src.includes('data:image/gif') || img.src.includes('data:image/svg') || img.src.includes('placeholder')) {
              var dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src');
              if (dataSrc) img.src = dataSrc;
            }
            // data-srcset → srcset(取第一个高质量 URL)
            if (!img.src || img.src === '') {
              var dataSrcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
              if (dataSrcset) {
                var firstUrl = dataSrcset.split(',')[0].trim().split(/\\s+/)[0];
                if (firstUrl) img.src = firstUrl;
              }
            }
          });

          // <picture> → 提取 <source> 中的最佳图片 URL 赋给 <img>
          // 修复:WIRED 等站点的 <img> src 被设为页面 URL 而非图片 URL
          document.querySelectorAll('picture').forEach(function(pic) {
            var img = pic.querySelector('img');
            if (!img) return;
            var sources = pic.querySelectorAll('source');
            var bestUrl = '';
            var bestWidth = 0;
            for (var i = 0; i < sources.length; i++) {
              var srcset = sources[i].getAttribute('srcset');
              if (!srcset) continue;
              // 解析 srcset 中所有 URL,选择中等分辨率的(640w-1200w)
              var entries = srcset.split(',');
              for (var j = 0; j < entries.length; j++) {
                var parts = entries[j].trim().split(/\\s+/);
                var url = parts[0];
                var w = parseInt(parts[1]) || 0;
                if (url && url.match(/\\.(jpg|jpeg|png|gif|webp|avif|svg)/i)) {
                  if ((w >= 640 && w <= 1200) || (!bestUrl && url.startsWith('http'))) {
                    bestUrl = url;
                    bestWidth = w;
                  }
                }
              }
            }
            // 如果没找到中等分辨率,取第一个 http 开头的
            if (!bestUrl) {
              for (var i = 0; i < sources.length; i++) {
                var srcset = sources[i].getAttribute('srcset');
                if (srcset) {
                  var url = srcset.split(',')[0].trim().split(/\\s+/)[0];
                  if (url && url.startsWith('http')) { bestUrl = url; break; }
                }
              }
            }
            if (bestUrl) {
              img.src = bestUrl;
              img.setAttribute('src', bestUrl);
            }
          });

          // 确保所有 <img> 的 src 属性是绝对 URL
          // img.src(DOM property)自动返回绝对 URL,但 getAttribute('src') 返回原始值
          // Defuddle/Turndown 可能使用 getAttribute,所以需要显式设置
          document.querySelectorAll('img').forEach(function(img) {
            if (img.src && !img.getAttribute('src').match(/^(https?:|data:|blob:)/)) {
              img.setAttribute('src', img.src);
            }
            // 检测 img.src 是页面 URL 而非图片 URL(WIRED 等站点的 bug)
            // 页面 URL 不会以图片扩展名结尾
            var currentSrc = img.getAttribute('src') || '';
            if (currentSrc.startsWith('http') && !currentSrc.match(/\\.(jpg|jpeg|png|gif|webp|avif|svg|ico)(\\?|$)/i)) {
              // src 不像图片 URL,尝试从 srcset 获取真实图片 URL
              var srcset = img.getAttribute('srcset');
              if (srcset) {
                var firstUrl = srcset.split(',')[0].trim().split(/\\s+/)[0];
                if (firstUrl && firstUrl.match(/\\.(jpg|jpeg|png|gif|webp|avif|svg)/i)) {
                  img.src = firstUrl;
                  img.setAttribute('src', firstUrl);
                }
              }
            }
          });

          // <noscript> 中的 <img> — 部分网站把真实图片放在 noscript 中
          document.querySelectorAll('noscript').forEach(function(ns) {
            var html = ns.textContent || ns.innerHTML;
            if (!html || !html.includes('<img')) return;
            var tmp = document.createElement('div');
            tmp.innerHTML = html;
            var noscriptImg = tmp.querySelector('img');
            if (noscriptImg && noscriptImg.src) {
              // 找到 noscript 前面的占位 img,替换其 src
              var prevImg = ns.previousElementSibling;
              if (prevImg && prevImg.tagName === 'IMG') {
                prevImg.src = noscriptImg.src;
              }
            }
          });
        })();

        // 预处理:移除非正文区域(推荐文章、相关阅读、页脚等)
        // Defuddle 的评分系统有时会把这些误判为正文
        (function removeNonContent() {
          // 1. 移除 base64 内联图片(避免巨量文本进入 Markdown)
          document.querySelectorAll('img').forEach(function(img) {
            var src = img.getAttribute('src') || '';
            if (src.startsWith('data:image/') && src.length > 500) {
              img.remove();
            }
          });

          // 2. 移除常见的非正文区域
          var nonContentSelectors = [
            // 推荐/相关文章
            '[class*="related"]', '[class*="recommended"]', '[class*="read-next"]',
            '[class*="read-more"]', '[class*="more-stories"]', '[class*="suggested"]',
            '[class*="trending"]', '[class*="popular"]',
            // 社交/分享
            '[class*="share-"]', '[class*="social-"]', '[class*="follow-"]',
            // 评论
            '[class*="comment"]', '[id*="comment"]', '[class*="disqus"]',
            // 广告/推广
            '[class*="advert"]', '[class*="promo"]', '[class*="sponsor"]',
            // 通用页脚/侧栏
            '[class*="sidebar"]', '[class*="newsletter"]', '[class*="subscribe"]',
            // 特定站点
            '.zn-body__read-all',  // CNN
            '.post-nav-links',     // WordPress
          ].join(', ');

          document.querySelectorAll(nonContentSelectors).forEach(function(el) {
            // 只移除不在 article/main 正文容器内的,或明确是推荐区域的
            // 保守策略:只移除位于正文之后的区域(不误删正文中的相关链接)
            var isInArticle = el.closest('article, [role="article"], main, [role="main"]');
            var isLargeBlock = el.querySelectorAll('a').length > 3 && el.textContent.length < 500;
            if (isLargeBlock || !isInArticle) {
              el.remove();
            }
          });
        })();

        // 预处理:保护代码块不被 Defuddle 的评分/清理系统丢弃
        // 策略:将 <pre><code> 原地替换为 <div data-preserved-code>,
        //        内容是 Markdown 围栏格式的纯文本。
        //        Defuddle 会把它当作普通正文段落保留,最终输出为文本。
        var fence = String.fromCharCode(96,96,96);
        (function preserveCodeBlocks() {
          // 先清理 copy 按钮噪音
          document.querySelectorAll('.code-header, .copy-to-clipboard, .btn-copy, .copy-success').forEach(function(el) {
            el.remove();
          });

          document.querySelectorAll('pre').forEach(function(pre) {
            var code = pre.querySelector('code');
            var text = code ? code.textContent : pre.textContent;
            if (!text || !text.trim() || text.trim().length < 5) return;
            var skip = pre.closest('nav, header, footer, aside, [class*="sidebar"]');
            if (skip) return;

            // 提取语言
            var lang = '';
            if (code) {
              var langMatch = (code.className || '').match(/language-(\\w+)/);
              if (langMatch) lang = langMatch[1].toLowerCase();
              if (!lang) {
                var dataLang = code.getAttribute('data-lang') || code.getAttribute('data-language');
                if (dataLang) lang = dataLang.toLowerCase();
              }
            }

            // 替换为包含 Markdown 围栏的 <pre><code>(标准格式,Defuddle 能正确转换)
            var newPre = document.createElement('pre');
            var newCode = document.createElement('code');
            if (lang) {
              newCode.setAttribute('data-lang', lang);
              newCode.className = 'language-' + lang;
            }
            newCode.textContent = text.trim();
            newPre.appendChild(newCode);

            // 替换整个容器(listingblock 等外层包装)
            var container = pre.closest('.listingblock') || pre.parentElement;
            if (container && container !== document.body && container.querySelector('pre') === pre) {
              container.parentNode.replaceChild(newPre, container);
            } else {
              pre.parentNode.replaceChild(newPre, pre);
            }
          });
        })();

        // 预处理:将各种 admonition/callout 格式标准化为 Defuddle 能识别的格式
        // Asciidoc: div.admonitionblock.note, Docusaurus: div.admonition, Hugo: div.notice
        (function standardizeAdmonitions() {
          var selectors = '.admonitionblock, .admonition, div[class*="notice"], div[class*="alert-"], div[class*="callout"]';
          document.querySelectorAll(selectors).forEach(function(el) {
            // 提取类型(note, warning, tip, caution, important)
            var type = 'note';
            var classes = el.className || '';
            var typeMatch = classes.match(/\\b(note|warning|caution|tip|important|danger|info|error)\\b/i);
            if (typeMatch) type = typeMatch[1].toLowerCase();

            // 提取内容(跳过标题/图标区域)
            var contentEl = el.querySelector('.content, .admonition-content, td:last-child, .body');
            var content = contentEl ? contentEl.innerHTML : el.innerHTML;

            // 替换为 blockquote[data-callout](Defuddle 标准格式)
            var blockquote = document.createElement('blockquote');
            blockquote.setAttribute('data-callout', type);
            blockquote.innerHTML = content;
            el.parentNode.replaceChild(blockquote, el);
          });
        })();

        // 预处理:保护表格不被 Defuddle 清理系统丢弃
        // 1. 将 <table> 从非标准容器中提升到正文层级
        // 2. 移除 colspan/rowspan 使 Defuddle 输出 Markdown 表格而非 HTML
        (function preserveTables() {
          document.querySelectorAll('table').forEach(function(table) {
            var skip = table.closest('nav, header, footer, aside, [class*="sidebar"]');
            if (skip) return;

            // 移除 colspan/rowspan → 迫使 Defuddle 走简单表格路径(输出 Markdown)
            table.querySelectorAll('td[colspan], th[colspan], td[rowspan], th[rowspan]').forEach(function(cell) {
              cell.removeAttribute('colspan');
              cell.removeAttribute('rowspan');
            });

            // 将 table 从非标准容器中提升
            var wrapper = table.closest('.tableblock, .table-wrapper, .table-responsive, [class*="table-container"]');
            if (wrapper && wrapper !== document.body) {
              wrapper.parentNode.replaceChild(table, wrapper);
            }
          });
        })();

        // 预处理:从 JS 变量中提取隐藏的音频 URL
        // WIRED/Condé Nast 等站点将音频链接嵌入 window.__PRELOADED_STATE__
        var extractedAudioUrl = null;
        try {
          var pState = window['__PRELOADED_STATE__'];
          if (pState) {
            var sStr = typeof pState === 'string' ? pState : JSON.stringify(pState);
            // 搜索所有 http URL,过滤出音频相关的
            // 提取所有 http(s) URL(用 indexOf 循环,避免正则在模板字面量中的转义问题)
            var searchStart = 0;
            while (searchStart < sStr.length) {
              var httpIdx = sStr.indexOf('http', searchStart);
              if (httpIdx < 0) break;
              // 找到 URL 结尾(引号、空白、反斜杠)
              var uEnd = httpIdx;
              while (uEnd < sStr.length && sStr[uEnd] !== '"' && sStr[uEnd] !== ' ' && sStr[uEnd] !== "'" && sStr[uEnd] !== '\\\\') uEnd++;
              var u = sStr.slice(httpIdx, uEnd);
              searchStart = uEnd + 1;
              if (u.length < 15 || u.length > 500) continue;
              // 匹配音频文件扩展名
              var lowerU = u.toLowerCase();
              if (lowerU.indexOf('.mp3') > 0 || lowerU.indexOf('.m4a') > 0 || lowerU.indexOf('.ogg') > 0 || lowerU.indexOf('.wav') > 0 || lowerU.indexOf('.aac') > 0) {
                extractedAudioUrl = u;
                break;
              }
              // 匹配音频平台/关键词(WIRED 使用 cnevids.com/narrated)
              if ((lowerU.indexOf('audio') > 0 || lowerU.indexOf('narrated') > 0 || lowerU.indexOf('podcast') > 0) &&
                  lowerU.indexOf('.js') < 0 && lowerU.indexOf('.css') < 0 && lowerU.indexOf('.png') < 0 && lowerU.indexOf('.jpg') < 0) {
                extractedAudioUrl = u;
                break;
              }
            }
          }
        } catch(e) { /* ignore */ }
        if (extractedAudioUrl) {
          var artEl = document.querySelector('article, [role="main"], main') || document.body;
          var audEl = document.createElement('audio');
          audEl.setAttribute('src', extractedAudioUrl);
          audEl.setAttribute('title', 'Listen to this article');
          audEl.setAttribute('controls', '');
          artEl.insertBefore(audEl, artEl.firstChild);
        }

        var result = new DefuddleClass(document, {
          url: window.location.href,
          markdown: true,
        }).parse();

        // 补充提取:如果 Defuddle 输出不含图片,从正文 DOM 中独立收集
        var contentImages = [];
        var markdownContent = result.content || '';
        var hasImages = /!\\[[^\\]]*\\]\\([^)]+\\)/.test(markdownContent) || /<img[^>]+src/i.test(markdownContent);

        if (!hasImages) {
          var article = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('.post-content, .article-content, .entry-content, main');
          var searchRoot = article || document.body;

          // 辅助函数:从 <picture> 或 <img> 获取真实图片 URL
          function getRealImageUrl(img) {
            // 优先从 <picture><source> 中获取
            var pic = img.closest('picture');
            if (pic) {
              var sources = pic.querySelectorAll('source');
              for (var si = 0; si < sources.length; si++) {
                var srcset = sources[si].getAttribute('srcset');
                if (srcset) {
                  var entries = srcset.split(',');
                  for (var ei = 0; ei < entries.length; ei++) {
                    var url = entries[ei].trim().split(/\\s+/)[0];
                    if (url && url.match(/\\.(jpg|jpeg|png|gif|webp|avif|svg)/i)) return url;
                  }
                }
              }
            }
            // 从 img 自身获取
            var src = img.src || img.getAttribute('data-src') || '';
            // 检查 src 是否像图片 URL(而非页面 URL)
            if (src && src.match(/\\.(jpg|jpeg|png|gif|webp|avif|svg)(\\?|$)/i)) return src;
            // 尝试 srcset
            var imgSrcset = img.getAttribute('srcset');
            if (imgSrcset) {
              var url = imgSrcset.split(',')[0].trim().split(/\\s+/)[0];
              if (url) return url;
            }
            return src; // 返回原始 src 作为 fallback
          }

          searchRoot.querySelectorAll('img').forEach(function(img) {
            var src = getRealImageUrl(img);
            if (!src || src.startsWith('data:')) return;
            // 过滤非图片 URL(如页面 URL)
            if (src.startsWith('http') && !src.match(/\\.(jpg|jpeg|png|gif|webp|avif|svg)/i) && !src.match(/media\\.|image|photo|img/i)) return;
            var w = img.naturalWidth || img.width || 0;
            var h = img.naturalHeight || img.height || 0;
            if (w > 0 && w < 100 && h > 0 && h < 100) return;
            var parent = img.closest('nav, header, footer, aside, [class*="sidebar"], [class*="advert"], [class*="promo"], [class*="Rollover"]');
            if (parent) return;
            var alt = img.alt || '';
            contentImages.push({ src: src, alt: alt, w: w, h: h });
          });
        }

        // 补充提取:从 DOM 中收集 Defuddle 遗漏的视频
        // Defuddle 的 Turndown 没有 <video> 的 Markdown 对应语法,会直接丢弃
        var contentVideos = [];
        var hasVideoInMarkdown = /<(video|iframe)\\s/i.test(markdownContent);

        // ISO 8601 duration → 秒
        function parseDuration(iso) {
          if (!iso) return 0;
          var m = iso.match(/PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?/);
          if (!m) return 0;
          return (parseInt(m[1]||'0',10)*3600) + (parseInt(m[2]||'0',10)*60) + (parseInt(m[3]||'0',10));
        }
        var pageDomain = window.location.hostname.replace(/^www\\./, '');

        if (!hasVideoInMarkdown) {
          var videoSearchRoot = document.querySelector('article') || document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
          var seenSrc = {};

          // 1. 原生 <video> 元素
          videoSearchRoot.querySelectorAll('video').forEach(function(video) {
            var skip = video.closest('nav, header, footer, aside, [class*="sidebar"], [class*="advert"]');
            if (skip) return;
            var src = video.src || video.getAttribute('src') || '';
            if (!src) {
              var source = video.querySelector('source');
              if (source) src = source.src || source.getAttribute('src') || '';
            }
            if (!src || seenSrc[src]) return;
            seenSrc[src] = true;
            var title = video.getAttribute('title') || '';
            if (!title) {
              var fig = video.closest('figure');
              if (fig) {
                var cap = fig.querySelector('figcaption');
                if (cap) title = cap.textContent.trim();
              }
            }
            contentVideos.push({
              src: src,
              title: title || 'Video',
              poster: video.getAttribute('poster') || '',
              w: video.videoWidth || video.width || 0,
              h: video.videoHeight || video.height || 0,
              domain: pageDomain,
            });
          });

          // 2. <iframe> 嵌入视频(任何 https:// 的 iframe,不维护域名白名单)
          videoSearchRoot.querySelectorAll('iframe').forEach(function(iframe) {
            var skip = iframe.closest('nav, header, footer, aside, [class*="sidebar"], [class*="advert"]');
            if (skip) return;
            var src = iframe.src || iframe.getAttribute('src') || '';
            if (!src || !src.startsWith('https://') || seenSrc[src]) return;
            seenSrc[src] = true;
            var title = iframe.getAttribute('title') || '';
            contentVideos.push({
              src: src,
              title: title || 'Video',
              poster: '',
              w: iframe.width || 0,
              h: iframe.height || 0,
              domain: pageDomain,
            });
          });

          // 3. og:video meta 标签(页面级视频 URL)
          var ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]');
          if (ogVideo) {
            var ogSrc = ogVideo.getAttribute('content') || '';
            if (ogSrc && !seenSrc[ogSrc]) {
              seenSrc[ogSrc] = true;
              var ogTitle = '';
              var ogTitleMeta = document.querySelector('meta[property="og:title"]');
              if (ogTitleMeta) ogTitle = ogTitleMeta.getAttribute('content') || '';
              var ogPoster = '';
              var ogImageMeta = document.querySelector('meta[property="og:image"]');
              if (ogImageMeta) ogPoster = ogImageMeta.getAttribute('content') || '';
              contentVideos.push({
                src: ogSrc,
                title: ogTitle || 'Video',
                poster: ogPoster,
                w: 0,
                h: 0,
                domain: pageDomain,
              });
            }
          }

          // 4. JSON-LD VideoObject(Brightcove、JW Player 等 JS 播放器常用此方式声明视频)
          if (contentVideos.length === 0) {
            try {
              var ldScriptsForVideo = document.querySelectorAll('script[type="application/ld+json"]');
              for (var li = 0; li < ldScriptsForVideo.length; li++) {
                var ldText = ldScriptsForVideo[li].textContent || '';
                if (ldText.indexOf('VideoObject') < 0 && ldText.indexOf('embedUrl') < 0 && ldText.indexOf('contentUrl') < 0) continue;
                var ldData = JSON.parse(ldText);
                // 可能是单个对象或数组
                var ldItems = Array.isArray(ldData) ? ldData : [ldData];
                // 也检查 @graph 数组
                if (ldData['@graph']) ldItems = ldItems.concat(ldData['@graph']);
                for (var lj = 0; lj < ldItems.length; lj++) {
                  var item = ldItems[lj];
                  if (!item || (item['@type'] !== 'VideoObject' && item['@type'] !== 'Video')) continue;
                  var videoUrl = item.contentUrl || item.embedUrl || '';
                  if (!videoUrl || seenSrc[videoUrl]) continue;
                  seenSrc[videoUrl] = true;
                  var pubName = '';
                  if (item.author) pubName = item.author.name || (typeof item.author === 'string' ? item.author : '');
                  if (!pubName && item.publisher) pubName = item.publisher.name || '';
                  contentVideos.push({
                    src: videoUrl,
                    title: item.name || item.headline || 'Video',
                    poster: item.thumbnailUrl || '',
                    w: 0,
                    h: 0,
                    description: item.description || '',
                    author: pubName,
                    publishedAt: item.uploadDate || item.datePublished || '',
                    duration: parseDuration(item.duration),
                    domain: pageDomain,
                  });
                }
              }
            } catch(e) { /* ignore JSON parse errors */ }
          }
        }

        // Extract Schema.org data from page (JSON-LD)
        var schemaOrgData = null;
        try {
          var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
          if (ldScripts.length > 0) {
            schemaOrgData = JSON.parse(ldScripts[0].textContent || '{}');
          }
        } catch(e) { /* ignore parse errors */ }

        return JSON.stringify({
          success: true,
          url: window.location.href,
          title: result.title || document.title || '',
          author: result.author || null,
          published: result.published || null,
          description: result.description || null,
          content: markdownContent,
          extractedAudioUrl: extractedAudioUrl || null,
          wordCount: result.wordCount || 0,
          domain: result.domain || window.location.hostname,
          favicon: result.favicon || null,
          image: result.image || null,
          contentImages: contentImages,
          contentVideos: contentVideos,
          site: result.site || null,
          schemaOrgData: schemaOrgData,
          extractorType: result.extractorType || null,
          language: document.documentElement.lang || null,
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err.message || String(err),
          url: window.location.href,
          title: document.title || '',
        });
      }
    })();
  `;
}
