/**
 * 守卫:无人值守路径不得依赖「界面开着」。
 *
 * 2026-09-03 Windows 部署实测:/health 全绿、鉴权正常,但首次 POST /refresh
 * 返回 503「当前 workspace 的 X 实例未就绪(未登记 wc id)」。
 *
 * 根因:X 的 wcId 由 SocialView **挂载时登记、卸载时清除**(SocialView.tsx:132)。
 * 而 /refresh 是外部随时敲进来的,那台机器上不会有人一直守着 X 页面 ——
 * 界面一切走,登记表就空了,而 X webview 其实还活着。
 *
 * 这类「本地手点能过、无人值守就挂」的问题,只有部署到真实场景才暴露,
 * 故用守卫钉死:后台路径必须能自己找到 X webContents。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');
const wcSrc = read('src/platform/main/x/x-webcontents.ts');
const article = read('src/platform/main/x/x-article-replies.ts');

describe('无人值守取 webContents', () => {
  it('⭐ 提供不依赖登记表的解析器', () => {
    expect(wcSrc).toContain('export function resolveAnyXWebContents');
  });

  it('⭐ 它必须遍历存活 webContents,而不是只查登记表', () => {
    const fn = wcSrc.slice(wcSrc.indexOf('export function resolveAnyXWebContents'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toContain('getAllWebContents');
    expect(body).toContain('detectXServiceByUrl');
  });

  it('有显式 wcId 时仍优先用它(交互路径定向更准,多 ws 不会抓错窗口)', () => {
    const fn = wcSrc.slice(wcSrc.indexOf('export function resolveAnyXWebContents'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toMatch(/preferWcId\s*!=\s*null/);
  });

  it('⭐ 文章抓取(campaign 路径)必须用无人值守版本', () => {
    const fn = article.slice(article.indexOf('export async function fetchArticleReplies'));
    const body = fn.slice(0, fn.indexOf('\n  const url'));
    expect(body).toContain('resolveAnyXWebContents');
  });

  it('找不到时给可操作的提示,不是空错误', () => {
    const fn = wcSrc.slice(wcSrc.indexOf('export function resolveAnyXWebContents'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toMatch(/error:.*x\.com/);
  });
});
