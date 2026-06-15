/**
 * x-test-commands — X Article「逐块底层测试」dev 命令(2026-06-14 总指挥架构原则)
 *
 * 诉求:每种块独立测通(图真上传、table 真有内容、块真落定)再组装整篇。每条命令独立驱动一个块,
 *   alert 显示「块数+N / landed / 内容验证」—— 一个块一个块跑到全绿。
 *
 * media 用**磁盘绝对路径**(main 走 driveMediaWithPath 绕 resolveMediaPath)→ 全自动,不用手动选文件。
 *
 * ★ 测试代码隔离:独立文件,由 views/x/index.ts import 触发注册;命令仅 dev 手动调,不进任何 UI 主流程。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi } from '@capabilities/x-extraction';
import type { ArticleInsertStep } from '@drivers/text-editing-driver/serializers/note-to-article-plan';

/** 各块的固定测试数据(每块一条命令独立驱动)。media 用绝对路径(总指挥提供)。 */
const TEST_DATA: Record<string, ArticleInsertStep> = {
  html: { kind: 'html', html: '<h6>六级标题测试</h6><p>这是正文段落 hello world。</p>' },
  latex: { kind: 'latex', latex: 'E = mc^2' },
  code: { kind: 'code', language: 'javascript', code: 'const sum = (a, b) => a + b;\nconsole.log(sum(1, 2));' },
  table: { kind: 'table', markdown: '| 序号 | 地区 | 出口数量 |\n| --- | --- | --- |\n| 1 | HK | 1 |\n| 2 | TW | 2 |' },
  divider: { kind: 'divider' },
  // posts:换成你的真实可嵌推文 URL
  posts: { kind: 'posts', tweetUrl: 'https://x.com/X/status/1234567890123456789' },
  // media:绝对路径(main 直喂,绕 resolveMediaPath)
  mediaImage: { kind: 'media', mediaUrl: '/Users/wenwu/Downloads/GRIG-NoteManner.png' },
  mediaVideo: { kind: 'media', mediaUrl: '/Users/wenwu/Downloads/yapmışız.mp4' },
};

interface TestDriveResult {
  ok: boolean;
  blockDelta: number;
  landed: boolean;
  contentOk: boolean;
  warning?: string;
  error?: string;
}

async function runTestStep(name: string, step: ArticleInsertStep): Promise<void> {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) {
    window.alert('[逐块测试] 无活跃 workspace');
    return;
  }
  const x = requireCapabilityApi<XExtractionApi>('x-extraction');
  const wcId = x.getXHostWcId(wsId);
  console.log(`[x-test] 驱动单块 [${name}]`, step);
  const r = (await window.electronAPI.xTestDriveStep('x', step, wcId ?? undefined)) as TestDriveResult;
  const msg =
    `[逐块测试 ${name}]\n` +
    `驱动 ok = ${r.ok}\n` +
    `块数增量 = ${r.blockDelta}\n` +
    `落定 landed = ${r.landed}\n` +
    `内容验证 contentOk = ${r.contentOk}` +
    (r.warning ? `\nwarning: ${r.warning}` : '') +
    (r.error ? `\nerror: ${r.error}` : '');
  console.log('[x-test] 结果:', r);
  window.alert(msg);
}

/** 注册逐块测试命令(每块一条 x-view.test-drive-<kind>)。 */
export function registerXTestCommands(): void {
  commandRegistry.register('x-view.test-drive-html', () => void runTestStep('html', TEST_DATA.html));
  commandRegistry.register('x-view.test-drive-latex', () => void runTestStep('latex', TEST_DATA.latex));
  commandRegistry.register('x-view.test-drive-code', () => void runTestStep('code', TEST_DATA.code));
  commandRegistry.register('x-view.test-drive-table', () => void runTestStep('table', TEST_DATA.table));
  commandRegistry.register('x-view.test-drive-divider', () => void runTestStep('divider', TEST_DATA.divider));
  commandRegistry.register('x-view.test-drive-posts', () => void runTestStep('posts', TEST_DATA.posts));
  commandRegistry.register('x-view.test-drive-media-image', () => void runTestStep('media-image', TEST_DATA.mediaImage));
  commandRegistry.register('x-view.test-drive-media-video', () => void runTestStep('media-video', TEST_DATA.mediaVideo));
}
