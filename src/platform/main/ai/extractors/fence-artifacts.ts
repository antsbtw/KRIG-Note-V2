/**
 * AI 回复 markdown 里的 SVG / HTML 代码块 → note 能直接显示的图 / 网页块(Gemini、ChatGPT 共用)
 *
 * 2026-11-05 从 gemini-full-extraction.ts 原样搬出:ChatGPT 回复里的 ```svg 代码块
 * 提取后在 note 里只显示成一大段源码,Gemini 早有这套转换,两家共用一份。
 */

/**
 * 把 turn markdown 里的 SVG / HTML 代码块 fence 转成 note 可渲染的形态:
 *   ```xml / ```svg(内容是 <svg>)→ prepareSvgForDom → mediaStore → ![](media://..svg)
 *     (note image NodeView 见 media://*.svg 自动 innerHTML 真渲染)
 *   ```html(含 <!DOCTYPE / <html)→ mediaStore → !html[](media://..html)
 *     (ResultParser 识别 !html[]() → htmlBlock,iframe 渲染)
 * 复用 Claude artifact 的同款 mediaStore 落盘逻辑。失败兜底:保留原 fence(至少有源码)。
 */
export async function convertFenceArtifacts(
  md: string,
  /** 落盘文件名前缀 + 日志标签(gemini / chatgpt)*/
  source: string,
): Promise<{ markdown: string; count: number }> {
  let count = 0;
  // ⚠️ 媒体存储一加载就读 Electron app.getPath:放到真要落盘时再加载,
  // 免得纯逻辑的 chatgpt-full-extraction 被连带拖进 Electron(单测里没有 app)
  // (prepareSvgForDom 所在的 claude-extract-turn 顶部也加载了媒体存储,同理)
  const { mediaStore } = await import('../../media/media-store-impl');
  const { prepareSvgForDom } = await import('./claude-extract-turn');
  // 匹配 ```lang\n...\n``` 代码块
  const fenceRe = /```([a-zA-Z0-9]*)\n([\s\S]*?)\n```/g;
  const replacements: Array<{ match: string; replacement: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(md)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const code = m[2];
    const isSvg = (lang === 'xml' || lang === 'svg') && /<svg[\s>]/i.test(code);
    const isHtml = lang === 'html' && /<!doctype|<html[\s>]/i.test(code);
    if (!isSvg && !isHtml) continue;
    try {
      if (isSvg) {
        const svgCode = prepareSvgForDom(code);
        const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgCode, 'utf-8').toString('base64')}`;
        const r = await mediaStore.putBase64(dataUrl, 'image/svg+xml', `${source}-svg.svg`);
        if (r.success && r.mediaUrl) {
          replacements.push({ match: m[0], replacement: `![](${r.mediaUrl})` });
          count++;
        }
      } else {
        const dataUrl = `data:text/html;base64,${Buffer.from(code, 'utf-8').toString('base64')}`;
        const r = await mediaStore.putBase64(dataUrl, 'text/html', `${source}-html.html`);
        if (r.success && r.mediaUrl) {
          replacements.push({ match: m[0], replacement: `!html[HTML 预览](${r.mediaUrl})` });
          count++;
        }
      }
    } catch (err) {
      console.warn(`[${source}-extract] fence artifact → media failed:`, err);
    }
  }
  let out = md;
  for (const { match, replacement } of replacements) {
    out = out.replace(match, replacement);
  }
  return { markdown: out, count };
}
