/**
 * Stage 9 vitest 全局 setup
 *
 * 关键纪律 (prompt §节 5 风险点):
 *  1. vi.mock 字面 hoisted — module-level (不在 beforeEach 内)
 *  2. mock '@storage/index' 整模块: storage 单例 + initStorage / shutdownStorage 全 noop
 *  3. mock '@platform/main/note/broadcast' 字面 noop — 测试环境无 BrowserWindow
 *  4. mock '@capabilities/text-editing/converters/md-to-pm' — 走真路径,
 *     但需 stub mediaPutBase64 capability registry (markdownToAtoms 字面调).
 *     测试样本不含 base64 image,避开此路径.
 *  5. 每 test 前调 mockStorage._reset() 清状态 (单例 mock 跨 test 共享内存)
 */
import { beforeEach, vi } from 'vitest';
import { mockStorage, mockBroadcastNoteListChanged, mockBroadcastNoteDocContentChanged } from './mocks/storage-mock';

// (1) storage 单例 mock — hoisted module-level
vi.mock('@storage/index', () => {
  return {
    storage: mockStorage,
    initStorage: vi.fn(async () => {}),
    shutdownStorage: vi.fn(async () => {}),
    shutdownStorageSync: vi.fn(),
  };
});

// (2) broadcast mock — 测试环境无 BrowserWindow,字面 noop
vi.mock('@platform/main/note/broadcast', () => {
  return {
    broadcastNoteListChanged: mockBroadcastNoteListChanged,
    broadcastNoteDocContentChanged: mockBroadcastNoteDocContentChanged,
  };
});

// (3) migrations 023 waitForTitleBackfill — 测试环境无 migration runner,
//     字面立即 resolve (capability-impl listNoteTitles 字面调)
vi.mock('@storage/migrations/023-note-title-cache', () => {
  return {
    waitForTitleBackfill: vi.fn(async () => {}),
  };
});

// (4) capability registry mock — markdownToProseMirror 字面调 mediaPutBase64
//     (内部经 capability-registry).测试样本字面不含 base64 image,
//     mediaPutBase64 永远不会被调用;但 import 链路必须能解析.
vi.mock('@slot/capability-registry/get-capability-api', () => {
  return {
    getCapabilityApi: vi.fn(() => undefined),
    requireCapabilityApi: vi.fn((id: string) => {
      if (id === 'media-storage') {
        return {
          mediaPutBase64: vi.fn(async () => {
            throw new Error(
              `[test] mediaPutBase64 called — sample contains base64 image which Stage 9 字面 skips`,
            );
          }),
        };
      }
      throw new Error(`[test] capability '${id}' not stubbed`);
    }),
  };
});

// 每 test 前清状态
beforeEach(() => {
  mockStorage._reset();
  mockBroadcastNoteListChanged.mockClear();
  mockBroadcastNoteDocContentChanged.mockClear();
});
