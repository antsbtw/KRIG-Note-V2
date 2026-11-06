/**
 * localfile:// —— note 里本机视频只记链接(用户 2026-11-05:「本地视频增加链接就可以了吧？不用添加到数据库。」)
 * 钉:renderer 写的地址 main 解得回同一个路径(含空格 / 中文 / #);只放行视频音频的绝对路径。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: {}, protocol: {} }));
const { fromLocalFileUrl } = await import('@platform/main/media/local-file-protocol');
const { localFileUrl } = await import('@capabilities/media-storage');

describe('localfile:// 往返', () => {
  it('⭐ renderer 编的地址 main 解得回原路径(空格 / 中文 / # / ?)', () => {
    for (const p of ['/Users/wenwu/Movies/a b.mp4', '/Users/wenwu/视频/教程 #1?.mov', '/Volumes/外接盘/x.webm']) {
      expect(fromLocalFileUrl(localFileUrl(p))).toBe(p);
    }
  });
  it('⭐ 不是视频音频 → 拒(网页 / 别人拼地址读不到本机别的文件)', () => {
    expect(fromLocalFileUrl(localFileUrl('/Users/wenwu/.ssh/id_rsa'))).toBeNull();
    expect(fromLocalFileUrl(localFileUrl('/etc/passwd'))).toBeNull();
  });
  it('相对路径 / 别的形状 → 拒', () => {
    expect(fromLocalFileUrl(localFileUrl('a.mp4'))).toBeNull();
    expect(fromLocalFileUrl('localfile://other/%2Fa.mp4')).toBeNull();
  });
});
