/**
 * download-store 单测(web 下载持久化收尾)
 *
 * 覆盖 add / list / remove + atomic 写落盘 + lazy load 回读。
 *
 * electron app.getPath 在测试环境无效 → mock 成临时目录(模块加载即读 userData,
 * 故 vi.mock('electron') 必须 hoisted module-level,先于 import download-store)。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TMP_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'krig-dl-test-'));

// hoisted module-level mock — app.getPath('userData') → 临时目录
vi.mock('electron', () => ({
  app: {
    getPath: () => TMP_USERDATA,
  },
}));

// mock 之后再 import(store 模块加载即计算 DOWNLOAD_DIR)
const { downloadStore } = await import(
  '../../src/platform/main/web-download/download-store'
);

const DOWNLOAD_FILE = path.join(TMP_USERDATA, 'krig-data', 'web', 'downloads.json');

function makeEntry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    filename: `file-${id}.zip`,
    url: `https://example.com/file-${id}.zip`,
    savePath: `/Users/x/Downloads/file-${id}.zip`,
    total: 1024,
    completedAt: Date.now(),
    state: 'completed' as const,
    ...overrides,
  };
}

afterAll(() => {
  fs.rmSync(TMP_USERDATA, { recursive: true, force: true });
});

describe('download-store', () => {
  it('add 落盘 + list 回读(按 completedAt 倒序)', async () => {
    await downloadStore.add(makeEntry('a', { completedAt: 100 }));
    await downloadStore.add(makeEntry('b', { completedAt: 200 }));

    const list = await downloadStore.list();
    expect(list.map((e) => e.id)).toEqual(['b', 'a']); // 倒序:最新在前

    // atomic 写真落了盘
    expect(fs.existsSync(DOWNLOAD_FILE)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(DOWNLOAD_FILE, 'utf-8'));
    expect(raw.version).toBe('1');
    expect(Object.keys(raw.entries).sort()).toEqual(['a', 'b']);
    // tmp 文件已 rename 掉,不残留
    expect(fs.existsSync(DOWNLOAD_FILE + '.tmp')).toBe(false);
  });

  it('add 同 id 覆盖(幂等)', async () => {
    await downloadStore.add(makeEntry('a', { filename: 'renamed.zip', completedAt: 300 }));
    const list = await downloadStore.list();
    const a = list.find((e) => e.id === 'a');
    expect(a?.filename).toBe('renamed.zip');
    // 仍是两条(a 覆盖,b 不变)
    expect(list).toHaveLength(2);
  });

  it('add 拒绝空 id', async () => {
    const res = await downloadStore.add(makeEntry('') as never);
    expect(res).toBeNull();
  });

  it('remove 删记录 + 落盘', async () => {
    await downloadStore.remove('a');
    const list = await downloadStore.list();
    expect(list.map((e) => e.id)).toEqual(['b']);

    const raw = JSON.parse(fs.readFileSync(DOWNLOAD_FILE, 'utf-8'));
    expect(Object.keys(raw.entries)).toEqual(['b']);
  });

  it('保留终态字段(state/url/savePath)', async () => {
    await downloadStore.add(
      makeEntry('c', { state: 'cancelled', savePath: '', completedAt: 400 }),
    );
    const list = await downloadStore.list();
    const c = list.find((e) => e.id === 'c');
    expect(c?.state).toBe('cancelled');
    expect(c?.savePath).toBe('');
    expect(c?.url).toBe('https://example.com/file-c.zip');
  });
});
