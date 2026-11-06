/**
 * ② 显示:doc → SVG(文字转路径的独立 SVG)+ 实际尺寸
 * 与画板文字节点同一个渲染器(lib/atom-serializers/svg)。
 */

import { atomsToSvg } from '../../lib/atom-serializers/svg';
import type { NoteDoc, NoteNode } from './types';

export async function renderSvg(
  doc: NoteDoc | NoteNode[],
  opts: { width: number; color?: string },
): Promise<{ svg: string; width: number; height: number }> {
  const nodes = Array.isArray(doc) ? doc : doc.payload.content;
  const svg = await atomsToSvg(nodes, { width: opts.width, defaultTextColor: opts.color });
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error('[note-card] 渲染结果没有 viewBox,量不出卡片尺寸');
  return { svg, width: Number(m[1]), height: Number(m[2]) };
}
