/**
 * 守卫:thought.sortOrder(同一标注下拖动排列的顺序)必须能写进去、读出来、不被别的更新冲掉。
 *
 * 为什么要有:thought 字段要在四处登记(ThoughtPayload / ThoughtInfo / atomToThoughtInfo /
 * updateThought 写 payload),漏任一处不报错、tsc 全绿,只是拖完一刷新顺序就回原样。
 * 只有走真 createThought → updateThought → getThought 往返才看得见。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mockStorage } from '../../mocks/storage-mock';
import {
  createThought,
  updateThought,
  getThought,
} from '../../../src/platform/main/thought/capability-impl';

const baseInfo = {
  type: 'thought' as const,
  resolved: false,
  pinned: false,
  doc: {
    format: 'pm-doc-json' as const,
    version: '0.1',
    payload: { type: 'doc', content: [{ type: 'paragraph' }] },
  },
  folderId: null,
  anchor: null,
};

describe('thought.sortOrder 往返', () => {
  beforeEach(() => mockStorage._reset());

  it('updateThought 写入 sortOrder 后 getThought 能读回', async () => {
    const t = await createThought(baseInfo);
    expect(t.sortOrder).toBeUndefined();
    await updateThought(t.id, { sortOrder: 1234.5 });
    const got = await getThought(t.id);
    expect(got?.sortOrder).toBe(1234.5);
  });

  it('只改别的字段时 sortOrder 保持不变', async () => {
    const t = await createThought(baseInfo);
    await updateThought(t.id, { sortOrder: 42 });
    await updateThought(t.id, { resolved: true });
    const got = await getThought(t.id);
    expect(got?.sortOrder).toBe(42);
    expect(got?.resolved).toBe(true);
  });
});
