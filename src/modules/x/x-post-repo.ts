/**
 * ⭐ 发推记录 x_post 的读写(发推第③期,2026-10-27)—— 设计 x-posting-design.md §4
 *
 * 一份草稿一行(id = 草稿 id):fill 时建(filled),cancel / publish 时改成结局。
 * 「发过没」按内容哈希查(同一段字再发先提醒,只提醒不拦 —— 用户 10-21「有问题提示就好了」)。
 * ⚠️ option 字段不传 null(记忆 project-surreal-none-vs-null);用 UPSERT type::record(记忆 upsert-where-writes-nothing)。
 */
import { createHash } from 'node:crypto';
import { getXDB } from '@storage/surreal/client';
import type { PostForm } from './x-post-compose';

export type PostStatus = 'filled' | 'cancelled' | 'sent' | 'unseen' | 'failed';

/** 内容哈希:去掉空白再算(X 编辑器分段后没有换行,和 sameText 同一规则) */
export const contentHash = (text: string): string => createHash('sha256').update(text.replace(/\s/g, '')).digest('hex').slice(0, 32);

export async function recordFilled(r: {
  draftId: string; account: string; handle: string; wsId: string; noteId?: string; form: PostForm; text: string; caller: string;
}): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    `UPSERT type::record('x_post', $id) CONTENT {
      account: $account, handle: $handle, ws_id: $ws, note_id: $note, form: $form, text: $text,
      content_hash: $hash, status: 'filled', caller: $caller, filled_at: time::now()
    }`,
    { id: r.draftId, account: r.account, handle: r.handle, ws: r.wsId, note: r.noteId, form: r.form, text: r.text, hash: contentHash(r.text), caller: r.caller },
  );
  if (!rows || rows.length !== 1) throw new Error(`[x.post] 发推记录没建上(${r.draftId})`);
}

export async function recordEnded(draftId: string, e: {
  status: Exclude<PostStatus, 'filled'>; detail?: string; tweetId?: string; sentText?: string; editedOnX?: boolean;
}): Promise<void> {
  const [rows] = await getXDB().query<[unknown[]]>(
    `UPDATE type::record('x_post', $id) MERGE {
      status: $status, detail: $detail, tweet_id: $tweet, sent_text: $sent, edited_on_x: $edited, ended_at: time::now()
    }`,
    { id: draftId, status: e.status, detail: e.detail, tweet: e.tweetId, sent: e.sentText, edited: e.editedOnX },
  );
  if (!rows || rows.length !== 1) throw new Error(`[x.post] 发推记录没更新上(${draftId} → ${e.status}):这份草稿没有记录行`);
}

export type PostedBefore = {
  readonly draftId: string; readonly handle: string; readonly status: 'sent' | 'unseen';
  readonly tweetId?: string; readonly endedAt: string; readonly noteId?: string;
};

/** SDK 给的时间可能是 Date 也可能是它自己的 DateTime —— 都有 toISOString */
const isoOf = (v: unknown): string =>
  (v && typeof (v as { toISOString?: unknown }).toISOString === 'function' ? (v as Date).toISOString() : String(v ?? ''));

/** 这段字以前发过的(发出去 / 点了发布没核对上的都算),新的在前 */
export async function findPosted(account: string, text: string, limit = 5): Promise<PostedBefore[]> {
  const [rows] = await getXDB().query<[Array<{
    id: { id?: unknown } | string; handle: string; status: 'sent' | 'unseen'; tweet_id?: string; ended_at?: unknown; note_id?: string;
  }>]>(
    `SELECT id, handle, status, tweet_id, ended_at, note_id FROM x_post
      WHERE account = $a AND content_hash = $h AND status IN ['sent', 'unseen'] ORDER BY ended_at DESC LIMIT $n`,
    { a: account, h: contentHash(text), n: limit },
  );
  return (rows ?? []).map((r) => ({
    draftId: typeof r.id === 'string' ? r.id.replace(/^x_post:/, '') : String(r.id?.id ?? ''),
    handle: r.handle, status: r.status, tweetId: r.tweet_id, noteId: r.note_id,
    endedAt: isoOf(r.ended_at),
  }));
}
