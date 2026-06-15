/**
 * test-drivers — X Article 「逐块底层测试模块」(2026-06-14 总指挥架构原则)
 *
 * 诉求:每种块驱动配一个能**独立运行、自我验证「完整内容真正落进 X 文档」**的测试入口,
 *   一个块一个块测通(图真上传完、table 真有内容),再组装整篇。
 *
 * 本模块对真实 X webview 跑**单块驱动**(区别于 tests/x 的纯逻辑单测),复用 x-article-driver 的
 *   prepareArticleContext + ensureCleanState + driveStep + confirmBlockLanded,**不重写驱动逻辑**。
 *
 * media 特例:resolveMediaPath 只认 media://,拒裸绝对路径。测试要喂任意本地文件(/Users/.../x.png),
 *   故 media 走 driveMediaWithPath(直喂绝对路径,绕 resolveMediaPath)→ 全自动,不用手动选文件。
 *
 * ★ 测试代码隔离:独立文件 + 独立 registerXTestHandlers(可 dev-only gate / 随时摘除),不污染生产驱动。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { XServiceId } from '@shared/types/x-service-types';
import type { ArticleInsertStep } from '@drivers/text-editing-driver/serializers/note-to-article-plan';

/** X serviceId 守卫(本期唯一服务 'x';与 handlers.ts 同款 local guard)。 */
function isXServiceId(v: unknown): v is XServiceId {
  return v === 'x';
}
import {
  prepareArticleContext,
  ensureCleanState,
  driveStep,
  driveMediaWithPath,
  getDataBlockCount,
  confirmBlockLanded,
  verifyMediaContent,
  verifyTableContent,
} from './x-article-driver';

export interface TestDriveStepResult {
  /** step 驱动本身是否成功(driveStep 的 ok) */
  ok: boolean;
  /** 实测块数增量(after - before) */
  blockDelta: number;
  /** 块数是否达到预期(confirmBlockLanded.landed) */
  landed: boolean;
  /** 内容验证是否通过(table 有内容 / media 含图;无验证则随 landed) */
  contentOk: boolean;
  /** 驱动器 warning(降级/未确认落定等) */
  warning?: string;
  /** 阻断性错误(无 wc / 编辑器没开 / 无权限) */
  error?: string;
}

/** 各 kind 的落定预期:minDelta + 可选内容验证(与 x-article-driver 加固保持一致)。 */
function landingSpec(kind: ArticleInsertStep['kind']): {
  minDelta: number;
  timeoutMs?: number;
  verify?: typeof verifyMediaContent;
} {
  switch (kind) {
    case 'divider':
      return { minDelta: 2 }; // 分割线块 + 自动补的空文字块
    case 'media':
      return { minDelta: 1, timeoutMs: 12000, verify: verifyMediaContent };
    case 'table':
      return { minDelta: 1, verify: verifyTableContent };
    default:
      return { minDelta: 1 }; // html/latex/code/posts
  }
}

/**
 * 独立驱动**一个块** + 自我验证「完整内容落定」。
 *
 * @param step 单个 ArticleInsertStep。media 的 mediaUrl 可以是**磁盘绝对路径**(测试用,绕 resolveMediaPath)。
 */
export async function testDriveStep(
  serviceId: XServiceId,
  step: ArticleInsertStep,
  targetWcId?: number,
): Promise<TestDriveStepResult> {
  const ctx = await prepareArticleContext(serviceId, targetWcId);
  if ('error' in ctx) return { ok: false, blockDelta: 0, landed: false, contentOk: false, error: ctx.error };
  const { wc, art } = ctx;

  await ensureCleanState(wc, art); // 干净态进入(同整篇驱动每步前)
  const before = await getDataBlockCount(wc, art);

  // media 特例:绝对路径直喂(绕 resolveMediaPath);其余走标准 driveStep。
  const isAbsPath = step.kind === 'media' && typeof step.mediaUrl === 'string' && step.mediaUrl.startsWith('/');
  const res =
    isAbsPath && step.kind === 'media'
      ? await driveMediaWithPath(wc, art, step.mediaUrl)
      : await driveStep(wc, art, step);

  const after = await getDataBlockCount(wc, art);
  const blockDelta = before >= 0 && after >= 0 ? after - before : -1;

  // 复算一次干净的落定/内容验证(driveStep 内部可能已确认过,这里给测试入口拿明确结果)。
  const spec = landingSpec(step.kind);
  const confirm = await confirmBlockLanded(wc, art, {
    beforeCount: before,
    minDelta: spec.minDelta,
    timeoutMs: spec.timeoutMs,
    label: step.kind,
    verifyContent: spec.verify,
  });

  return {
    ok: res.ok,
    blockDelta,
    landed: confirm.landed,
    contentOk: confirm.contentOk,
    warning: res.warning,
  };
}

/** 注册逐块测试 IPC(独立于 registerXHandlers,便于隔离/dev-only gate)。 */
export function registerXTestHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.X_TEST_DRIVE_STEP, async (_e, payload: unknown) => {
    const p = payload as { serviceId?: unknown; step?: unknown; targetWcId?: unknown } | null;
    if (!p || !isXServiceId(p.serviceId)) {
      return { ok: false, blockDelta: 0, landed: false, contentOk: false, error: 'invalid test-drive payload' };
    }
    const step = p.step as ArticleInsertStep | undefined;
    if (!step || typeof step !== 'object' || typeof (step as { kind?: unknown }).kind !== 'string') {
      return { ok: false, blockDelta: 0, landed: false, contentOk: false, error: 'invalid step(缺 kind)' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : undefined;
    return testDriveStep(p.serviceId, step, targetWcId);
  });
}
