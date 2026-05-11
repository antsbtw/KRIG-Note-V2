/**
 * 字体资源入口
 *
 * Vite 的 ?url 后缀返回静态资源的 URL 字符串。dev 模式直接返回 dev server 路径，
 * build 模式会被复制到 dist/assets/ 并加 hash。
 *
 * opentype.js 通过 fetch(url).arrayBuffer() 加载后调用 parse()。
 *
 * v1.3 § 4.4.1 字体清单：
 * - Inter Regular / Bold / Italic（西文）
 * - Noto Sans SC Regular / Bold（中文）
 * - JetBrains Mono Regular（等宽，inline code）
 */
import interRegularUrl from './Inter-Regular.ttf?url';
import interBoldUrl from './Inter-Bold.ttf?url';
import interItalicUrl from './Inter-Italic.ttf?url';
import notoSansScRegularUrl from './NotoSansSC-Regular.ttf?url';
import notoSansScBoldUrl from './NotoSansSC-Bold.ttf?url';
import jetBrainsMonoUrl from './JetBrainsMono-Regular.ttf?url';

export const FONT_URLS = {
  inter: interRegularUrl,
  interBold: interBoldUrl,
  interItalic: interItalicUrl,
  notoSansSc: notoSansScRegularUrl,
  notoSansScBold: notoSansScBoldUrl,
  jetBrainsMono: jetBrainsMonoUrl,
};

export type FontKey = keyof typeof FONT_URLS;
