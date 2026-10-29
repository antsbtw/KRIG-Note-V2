/**
 * 发推前把 X 显示不了的块画成图(第④期剩下的,2026-10-28)—— 渲染进程(画图要 DOM)
 *
 * 哪些块要画:x-post-compose 的 needsImage(排版和这里用同一个判断,画的和认的对得上)。
 * 怎么画:text-editing 能力的 renderBlockImage(深色卡片 PNG)→ media-storage 存进图片库 → media:// 地址。
 * 画好的标在块的 attrs.xImage 上,画不出来标 attrs.xImageError(原因给人看)—— 排版据此当图附上 / 挡住不让填。
 *
 * 同样的块只画一次(按块内容记住结果);note 改了内容才重画。
 */
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { MediaStorageApi } from '@capabilities/media-storage/types';
import { imageSections, needsImage, sectionsOffered, type PmNode } from './x-post-compose';

type Shot = { readonly src: string } | { readonly error: string };

/** 块内容 → 画好的结果(进行中的是 Promise) */
const shots = new Map<string, Shot | Promise<Shot>>();
const SHOTS_MAX = 200;

/** 记住结果用的 key:块本身(去掉块 id 和我们自己标的结果 —— 同样的公式挪个位置不用重画) */
function keyOf(n: PmNode): string {
  const attrs = { ...(n.attrs ?? {}) } as Record<string, unknown>;
  for (const k of ['id', 'xImage', 'xImageError', 'xSectionImage', 'xSectionImageError']) delete attrs[k];
  return JSON.stringify({ t: n.type, a: attrs, c: n.content ?? null });
}

/** 画好的取回来;没画过就开始画(进行中的是 Promise) */
function cached(key: string, draw: () => Promise<Shot>): Shot | Promise<Shot> {
  let got = shots.get(key);
  if (got === undefined) {
    if (shots.size >= SHOTS_MAX) shots.clear();
    const p = draw().then((r) => { shots.set(key, r); return r; });
    shots.set(key, p);
    got = p;
  }
  return got;
}

async function shoot(what: string, draw: (te: TextEditingApi) => Promise<{ dataUrl: string }>): Promise<Shot> {
  try {
    const te = requireCapabilityApi<TextEditingApi>('text-editing');
    const img = await draw(te);
    const media = requireCapabilityApi<MediaStorageApi>('media-storage');
    const put = await media.mediaPutBase64(img.dataUrl, 'image/png', 'x-post-render.png');
    if (!put.success || !put.mediaUrl) return { error: `存进图片库没成:${put.error ?? '?'}` };
    return { src: put.mediaUrl };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.warn(`[x-post] ${what} 转图没成:${why}`);
    return { error: why };
  }
}

/**
 * 给要画的块标上结果(已画好的直接标;没画好的先不标、开始画)。
 * 返回标好的内容 + 还在画的那些(画完调用方再排一次版)。
 */
export function annotateImages(content: readonly PmNode[]): { nodes: PmNode[]; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  const walk = (n: PmNode): PmNode => {
    if (needsImage(n) !== null) {
      const got = cached(keyOf(n), () => shoot(n.type, (te) => te.renderBlockImage(n)));
      if (got instanceof Promise) { pending.push(got); return n; }
      return { ...n, attrs: { ...(n.attrs ?? {}), ...('src' in got ? { xImage: got.src } : { xImageError: got.error }) } };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return { nodes: content.map(walk), pending };
}

/**
 * 整篇转图(10-29):给这个选项时(sectionsOffered:有转图块 / 推串太长),把整篇(imageSections,现在整篇一张)画成图,标在第一个块的
 * attrs.xSectionImage / xSectionImageError 上。不够多就原样返回(那个选项不给,不白画)。
 */
export function annotateSections(content: readonly PmNode[]): { nodes: PmNode[]; pending: Promise<unknown>[] } {
  const nodes = [...content];
  const pending: Promise<unknown>[] = [];
  if (!sectionsOffered(content)) return { nodes, pending };
  for (const idx of imageSections(content)) {
    const sec = idx.map((k) => content[k]);
    const got = cached(`section:${sec.map(keyOf).join('\n')}`, () => shoot('整篇转图一节', (te) => te.renderBlocksImage(sec)));
    if (got instanceof Promise) { pending.push(got); continue; }
    const head = nodes[idx[0]];
    nodes[idx[0]] = { ...head, attrs: { ...(head.attrs ?? {}), ...('src' in got ? { xSectionImage: got.src } : { xSectionImageError: got.error }) } };
  }
  return { nodes, pending };
}
