/**
 * ⭐ 用左边这条 —— 从地址认推文 id(用户 10-22:「看到一个帖子不错,我可以选择它,然后再由AI草拟留言」)
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ webContents: { fromId: () => null } }));
vi.mock('@storage/surreal/client', () => ({ getXDB: () => ({}) }));
vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: () => ({}) }));
vi.mock('@modules/x/x-save-page', () => ({ saveTweetPage: async () => undefined }));
import { tweetIdOfUrl } from '@modules/x/x-left-tweet';

describe('tweetIdOfUrl', () => {
  it('帖子页 / 带图片后缀 / twitter.com 都认', () => {
    expect(tweetIdOfUrl('https://x.com/shuxiasuxia/status/2112913797409341627')).toBe('2112913797409341627');
    expect(tweetIdOfUrl('https://x.com/a/status/123/photo/1')).toBe('123');
    expect(tweetIdOfUrl('https://twitter.com/a/status/456?s=20')).toBe('456');
  });
  it('主页 / 搜索页 / 别的站 → 不是帖子', () => {
    expect(tweetIdOfUrl('https://x.com/shuxiasuxia')).toBeNull();
    expect(tweetIdOfUrl('https://x.com/search?q=%2Fstatus%2F123')).toBeNull();
    expect(tweetIdOfUrl('https://evil.com/a/status/123')).toBeNull();
  });
});
