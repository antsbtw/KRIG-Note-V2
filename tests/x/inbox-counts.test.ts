/**
 * 侧栏徽章计数 —— 守「不许退回拉全量数 length」。
 *
 * 守的缺陷(2026-09-14 修):徽章数字原本是
 *   queryInbox({ ...VIEW_QUERY[v], limit: 5000 }).records.length
 * 算出来的 —— 为了显示一个整数,把最多 5000 行**完整推文**
 * (含 text/ai_verdict/translation 全文)拉过 IPC、过一遍
 * JSON.parse(JSON.stringify()),到 renderer 只读 .length 就丢弃。
 * 四个视图并发跑,每次点侧栏都重来一遍 —— 用户反馈「响应很慢」的直接原因。
 *
 * 附带的第二个缺陷:limit 5000 是个**静默天花板**,超过就把数字截在 5000
 * 且不报错(实测「漏判抽查」已到 4769,正在逼近)。
 *
 * 本测试钉三件事:
 *   1. 计数走 count() 而非拉行
 *   2. 列表与计数共用同一套 WHERE(否则徽章与点进去的内容对不上)
 *   3. 视图不再用「大 limit 数 length」这个手法
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/tweet-inbox-repo.ts'),
  'utf-8',
);
const VIEW = readFileSync(
  resolve(__dirname, '../../src/views/x-inbox/XInboxView.tsx'),
  'utf-8',
);

/** 取 countInbox 函数体 */
function countInboxBody(): string {
  const start = REPO.indexOf('export async function countInbox');
  expect(start).toBeGreaterThan(-1);
  return REPO.slice(start, REPO.indexOf('\n}', start));
}

describe('countInbox —— 数数不拉行', () => {
  it('⭐用 count() 聚合,不是 SELECT *', () => {
    const body = countInboxBody();
    expect(body).toContain('count() AS c');
    expect(body).not.toContain('SELECT *');
  });

  it('⭐用 GROUP ALL —— 少了它 count() 会按行返回而不是聚合成一个数', () => {
    expect(countInboxBody()).toContain('GROUP ALL');
  });

  it('⭐计数语句里不得有 LIMIT —— 有上限就会静默截断(原 5000 的坑)', () => {
    expect(countInboxBody()).not.toMatch(/\bLIMIT\b/);
  });

  it('⭐条件与 queryInbox 共用 buildInboxWhere —— 否则徽章与列表对不上账', () => {
    expect(countInboxBody()).toContain('buildInboxWhere');
    // ⚠️ 从函数体起点切,不能从签名起点切:queryInbox 的签名是多行的
    //    (InboxFilter & { … }),从签名起点找第一个 '\n}' 会停在**参数对象**的
    //    右括号上,切出来的「函数体」只有签名 —— 测试会假红。
    const qStart = REPO.indexOf('export async function queryInbox');
    const qBodyStart = REPO.indexOf('): Promise<TweetInboxRecord[]> {', qStart);
    expect(qBodyStart).toBeGreaterThan(-1);
    const qBody = REPO.slice(qBodyStart, REPO.indexOf('\n}', qBodyStart));
    expect(qBody).toContain('buildInboxWhere');
  });

  it('多切片的绑定变量互不覆盖(加下标前缀)', () => {
    const body = countInboxBody();
    // $status → $status_0：必须有按下标改写变量名这一步
    expect(body).toMatch(/\$\{name\}_\$\{i\}|_\$\{i\}/);
  });
});

describe('XInboxView 徽章', () => {
  it('⭐不得再用大 limit 拉全量来数 length', () => {
    expect(VIEW).not.toContain('limit: 5000');
    // 「拿 records.length 当计数」这个手法本身也不该再出现
    expect(VIEW).not.toMatch(/records\?\.length\s*\?\?\s*0/);
  });

  it('徽章改走 countInbox', () => {
    expect(VIEW).toContain('countInbox');
  });

  it('⭐列表与徽章都要带 wsId —— 否则标题写着 ws-2、数字却是全局的', () => {
    const start = VIEW.indexOf('const loadPage');
    const body = VIEW.slice(start, VIEW.indexOf('const loadStats', start));
    // queryInbox 与 countInbox 两处都必须传
    const wsIdCount = (body.match(/wsId:\s*workspaceId/g) ?? []).length;
    expect(wsIdCount).toBeGreaterThanOrEqual(2);
  });

  it('「全部」独立计数,不再拿三个视图相加', () => {
    expect(VIEW).not.toMatch(/counts\['pending'\][\s\S]{0,80}counts\['confirmed'\]/);
  });
});
