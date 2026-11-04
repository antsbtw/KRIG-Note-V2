/**
 * 推串手动排的三个动作(用户 10-29:「在预览里调排版…不如让用户自己拖动合并」)—— 纯函数
 *
 * 只动「哪条放哪几件」(x-post-compose 的 ThreadEdit.posts),不动字;结果交回 composePost(nodes, layout) 排出来,
 * 字数超了 / 一条超过 4 张图由 fillBlock 说(X 本身装不下,只能挡)。
 */
import type { ThreadItem, ThreadLayout } from './x-post-compose';

type Posts = readonly (readonly number[])[];

const drop = (posts: number[][]): number[][] => posts.filter((p) => p.length > 0);

/** 第 k 条和下一条合成一条(字在前、图在后,顺序不变) */
export function mergeNext(key: string, items: readonly ThreadItem[], posts: Posts, k: number): ThreadLayout {
  if (k < 0 || k + 1 >= posts.length) return { key, posts };
  const all = [...posts[k], ...posts[k + 1]];
  const merged = [...all.filter((i) => items[i].k === 'text'), ...all.filter((i) => items[i].k === 'media')];
  return { key, posts: [...posts.slice(0, k), merged, ...posts.slice(k + 2)] };
}

/** 在第 k 条的某段字前面分开:这段字和后面的字 + 这条的图成新的一条 */
export function splitBefore(key: string, items: readonly ThreadItem[], posts: Posts, k: number, item: number): ThreadLayout {
  const post = posts[k];
  const texts = post.filter((i) => items[i].k === 'text');
  const at = texts.indexOf(item);
  if (at <= 0) return { key, posts };
  const media = post.filter((i) => items[i].k === 'media');
  return { key, posts: [...posts.slice(0, k), texts.slice(0, at), [...texts.slice(at), ...media], ...posts.slice(k + 1)] };
}

/** 把一张图挪到第 to 条(放在那条图的最后);挪空了的那条去掉 */
export function moveMedia(key: string, posts: Posts, item: number, to: number): ThreadLayout {
  if (to < 0 || to >= posts.length || posts[to].includes(item)) return { key, posts };
  return { key, posts: drop(posts.map((p, k) => (k === to ? [...p, item] : p.filter((i) => i !== item)))) };
}
