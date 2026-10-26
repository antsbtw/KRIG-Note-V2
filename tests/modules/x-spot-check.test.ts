/**
 * ⭐⭐ 抽查:右键「查库」(2026-10-16)
 * 用户:「在左边x的原图增加关联方法,增加一个右键菜单,由用户抽查好了…如果没有,代表着没有成功采集」
 */
import { describe, it, expect, vi } from 'vitest';
import { capBlock, ipcHandles } from './_x-ipc-wiring';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: true }, Menu: {}, clipboard: {}, webContents: { fromId: () => null } }));

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('抽查', async () => {
  const { X_DOM_SCRIPTS, X_SCRIPTS } = await import('@modules/x/x-dom-scripts');
  const { spotKindOfUrl } = await import('@modules/x/x-spot-check');

  it('⭐⭐ 页面脚本真编译得过(推文 / 人两种参数)—— 防转义被吃(project-x-inject-template-escape)', () => {
    const sc = X_DOM_SCRIPTS.find((s) => s.id === X_SCRIPTS.spotTarget)!;
    for (const kind of ['tweet', 'person']) {
      const src = sc.build({ x: 120, y: 340, kind });
      expect(() => new Function(src)).not.toThrow();
      expect(src).toContain('/\\/([A-Za-z0-9_]{1,15})\\/status\\/(\\d+)/');
      expect(src).not.toMatch(/__X__|__Y__|__KIND__/);
    }
    /** 恶意参数不能拼出代码 */
    const evil = sc.build({ x: '1);alert(1', y: 2, kind: "x'); alert(1); ('" });
    expect(() => new Function(evil)).not.toThrow();
    expect(evil).toContain('var x = null');
  });

  it('名单页查人,其余查推文(按这一页采的是什么,不按点在哪)', () => {
    expect(spotKindOfUrl('https://x.com/antsBTW/followers')).toBe('person');
    expect(spotKindOfUrl('https://x.com/antsBTW/following')).toBe('person');
    expect(spotKindOfUrl('https://x.com/antsBTW/verified_followers')).toBe('person');
    expect(spotKindOfUrl('https://x.com/search?q=%23a&f=live')).toBe('tweet');
    expect(spotKindOfUrl('https://x.com/antsBTW/with_replies')).toBe('tweet');
    expect(spotKindOfUrl('https://x.com/antsBTW')).toBe('tweet');
  });

  it('⭐ 平台的右键扩展口不认识 X;X 经扩展口注册(删 X 目录这一项就没了)', () => {
    const H = read('src/platform/main/web-context-menu/handler.ts');
    expect(H).not.toMatch(/modules\/x|x\.com|X 网页查库/);
    expect(H).toMatch(/for \(const ext of extensions\)/);
    expect(read('src/modules/x/main.ts')).toMatch(/registerSpotCheckMenu\(\);/);
    expect(read('src/modules/x/x-spot-check.ts')).toMatch(/registerWebContextMenuExtension\(/);
  });

  it('接线:X 网页轮询 → 打开运营;运营面板挂卡片;IPC 两个 op', () => {
    expect(read('src/modules/x/XWebView.tsx')).toMatch(/op: 'spotCheckPoll', wsId: workspaceId, after/);
    expect(read('src/modules/x/XWebView.tsx')).toMatch(/bus\.slot\.openRight\(X_OPS_VIEW_ID\)/);
    expect(read('src/modules/x/XOpsView.tsx')).toMatch(/<XSpotCard wsId=\{workspaceId\} \/>/);
    const IPC = read('src/modules/x/x-data-ipc.ts');
    /** 2026-10-24 两个都迁到能力 x.spot.poll / x.spot.lookup */
    expect(ipcHandles(IPC, 'spotCheckPoll')).toBe(true);
    expect(ipcHandles(IPC, 'spotCheckLookup')).toBe(true);
    expect(capBlock('x.spot.lookup')).toMatch(/lookupSpot\(\(await readWsAccount\(i\.wsId\)\)\?\.restId \?\? '', \{ kind: i\.kind, tweetId: i\.tweetId, handle: i\.handle \}\)/);
  });
});

describe('⭐⭐ X 网页被普通浏览菜单排除 —— 扩展项必须仍能弹出(10-16 真机:X 网页右键什么都没有)', () => {
  it('handler:被排除的网页有扩展项就只弹扩展项;扩展项在 shouldHandle 判断之前收集', () => {
    const H = readFileSync(join(process.cwd(), 'src/platform/main/web-context-menu/handler.ts'), 'utf8');
    const body = H.slice(H.indexOf("guest.on('context-menu'"));
    const collect = body.indexOf('for (const ext of extensions)');
    const gate = body.indexOf('if (!shouldHandle(guest))');
    expect(collect).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(collect);
    expect(body.slice(gate, gate + 200)).toMatch(/if \(extItems\.length > 0\) Menu\.buildFromTemplate\(extItems\)\.popup/);
  });
});
