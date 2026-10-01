/**
 * `renderer → web.dom` 的 IPC 接线 —— **唯一**把 web.dom 暴露给 renderer 的地方
 *
 * ⭐ 为什么放在 `wiring/`:本目录是能力层**唯一允许碰 Electron** 的地方
 * (`page-boundary-guard` 钉着「除 wiring/ 外零处 Electron」)。
 * `ipcMain.handle` 放进 `dom/` 会当场撞守卫 —— 那是对的。
 *
 * ── 必要性(设计见 docs/handoff/web-dom-ipc-surface-design.md §〇)──
 *
 * renderer 侧 18 处裸注入的四个实测缺陷:26 处静默吞异常零日志 /
 * 对占位符做 regex 文本替换、把运行时值塞进脚本源码(已咬过一次) /
 * 9 处运行时值拼进脚本 / 零留痕。
 * ⭐ 而「社区论坛自动化」会让这四条**随每个新站点线性增长**。
 *
 * ── 三条设计红线 ──
 *
 * 1. ⚠️⚠️ **不暴露 `runDynamic`** —— 求值任意脚本的口子不对 renderer 开。
 *    `channel-names.ts` 里控制台时代那条注释写得很清楚:
 *    「刻意一能力一通道,不做求值任意脚本的万能通道:
 *    　那等于把 web.dom 费力关掉的注入口重新打开」。
 * 2. ⭐ **pageRef 由 renderer 给,main 侧绝不猜**(不用 activeWs /
 *    不用「最后 navigate 的那个」)—— `page-registry.ts:15` 的血泪。
 * 3. ⭐ **失败如实回三态**,不静默吞 —— 这正是本层要替换掉的那个病。
 */

import { ipcMain, webContents, type WebContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  WebDomInvoke,
  WebDomPageRef,
  WebDomResult,
} from '@shared/ipc/web-dom-types';
import { domRunner, pageRegistry, scriptRegistry, listPageNames } from './runtime';
import { bindPageHost } from './page-hosts';
import type { PageId } from '../page/types';
import type { ScriptId } from '../dom/types';

/** wcId → pageId。⚠️ 同一个 wc 只登记一次,否则每次调用都新增一条页面记录 */
const pageIdByWcId = new Map<number, PageId>();

/**
 * 把 renderer 给的 `wcId` 解析成「真 webContents + 底座认识的 pageId」。
 *
 * ⚠️ 拿不到就**如实失败**,不兜底到别的页面 ——
 * 兜底会让「指认错了」表现成「操作没生效」,排查方向完全相反。
 */
function resolve(ref: WebDomPageRef): { wc: WebContents; pageId: PageId } | { error: string } {
  if (!ref || typeof ref.wcId !== 'number' || !Number.isInteger(ref.wcId)) {
    return { error: `[web.dom ipc] pageRef.wcId 非法: ${String(ref?.wcId)}` };
  }
  const wc = webContents.fromId(ref.wcId);
  if (!wc || wc.isDestroyed()) {
    return { error: `[web.dom ipc] wc#${ref.wcId} 不存在或已销毁(页面关了?)` };
  }

  const cached = pageIdByWcId.get(ref.wcId);
  if (cached) return { wc, pageId: cached };

  /**
   * ⭐ `register` 与 `bindPageHost` **必须成对** —— 只登记不绑定的话,
   * 引擎拿不到 wc,会回一个诚实但误导的 Failed「没有对应的渲染目标(已关闭?)」,
   * 看起来像页面关了,实际是没接线(见 `page-hosts.ts` 的告诫)。
   */
  const facts = pageRegistry.register({
    window: 'main',
    ws: 'renderer-dom',
    slot: 'left',
    partition: readPartition(wc),
    owner: 'renderer-dom',
    url: wc.getURL(),
    state: 'complete',
  });
  bindPageHost(facts.pageId, wc);
  pageIdByWcId.set(ref.wcId, facts.pageId);
  wc.once('destroyed', () => pageIdByWcId.delete(ref.wcId));
  return { wc, pageId: facts.pageId };
}

/**
 * 读 partition —— 与 `ai/interceptor.ts:350` 同款。
 * ⚠️ `PageFacts.partition` 必填且底座**不猜**(`prepare` 要挂 webRequest)。
 */
function readPartition(wc: WebContents): string {
  try {
    const p = wc.session.storagePath;
    return p ? `persist:${p.split('/').pop()}` : 'persist:webview';
  } catch {
    return 'persist:webview';
  }
}

/**
 * ⭐ 失败一律**在主进程也打一行** —— 2026-10-01 加。
 *
 * ⚠️ 起因:步 2b 真机失败时,调用方的 `console.warn` 打在 **renderer 进程**,
 * 只存在于那个 webview 的 DevTools 里;而人看的是终端。
 * 于是「我加了日志」与「人能看到日志」是两回事 ——
 * 正是 `feedback-maintainability-over-feature-completion` 说的
 * 「**你不记录如何做验证**」的同一种形态:记了,但记在人看不到的地方。
 *
 * ⭐ 主进程这一行让真因直接出现在启动终端里,不必让人去翻 DevTools。
 */
function failed(reason: string): WebDomResult {
  console.warn('[web.dom ipc] ' + reason);
  return { status: 'failed', reason, retryable: false };
}

/** 把能力层的 Result 原样转成 IPC 形状(两者同构,只是跨了分层边界) */
function toIpc(r: { status: string; [k: string]: unknown }): WebDomResult {
  if (r.status === 'ok') return { status: 'ok', value: r.value };
  if (r.status === 'degraded') {
    return { status: 'degraded', value: r.value, missing: (r.missing as string[]) ?? [] };
  }
  const reason = String(r.reason ?? '(未给原因)');
  // ⚠️ 这条路径此前**不出声** —— 能力层回的 Failed(如「未注册的脚本 id」)
  //    只回给 renderer,主进程终端一个字都没有。
  console.warn('[web.dom ipc] ' + reason);
  return { status: 'failed', reason, retryable: Boolean(r.retryable) };
}

/** 注册 IPC handler。由 `main/index.ts` 在启动时调一次 */
export function registerWebDomIpc(): void {
  /**
   * ⭐ 启动时报一次「登记了哪些脚本」—— 2026-10-01 加。
   *
   * ⚠️ 起因:步 2b 真机失败,我查了四轮静态证据(链路实跑通过、
   * handler 注册时机对、preload 暴露了、脚本进了 bundle)仍定不了因,
   * 卡在「拿不到那一行报错」上。
   *
   * ⭐ 而最可能的一种真因 ——「脚本没登记上」—— 本来**启动时就能看出来**,
   * 只是没人说。这一行让它变成启动自检:
   * 数量不对或名字不对,终端里直接能看见,不必等到用户点翻译。
   *
   * 这正是用户定的「成功路径也要留痕」:
   * 不是等出事才查,而是**平时就把判断依据摆出来**。
   */
  /**
   * ⭐ 一并报「谁注册了语义页面表」—— 2026-10-01 加。
   *
   * ⚠️ 起因:X 模块在**模块加载期**自注册并打日志,结果那行被埋在启动最开头、
   * `[storage] initialized` 之前,用户翻日志自然截不到 → 「没看到」。
   * ⭐⭐ 这是 feedback-log-where-the-human-looks 的**第二种形态**:
   * 上次是「打错了进程」,这次是「**打早了时机**」——
   * 判据同一条:**这行会出现在人看的那块屏幕上吗?** 位置对还不够,时机也要对。
   *
   * ⭐ 由**底座**报而不是让业务方报:底座本来就知道有哪些 owner,
   * 而让业务方报就得让宿主多调一个函数 —— 那会破坏
   * 「宿主只有一行 `import '@modules/x'`」的原则(守卫会红)。
   */
  const pageTables = listPageNames();
  if (pageTables.length > 0) {
    for (const t of pageTables) {
      console.log(`[web.page] 语义页面表 owner=${t.owner} —— ${t.names.length} 个: ${t.names.join(', ')}`);
    }
  } else {
    console.log('[web.page] ⚠️ 没有任何语义页面表注册 —— goto 语义名必然失败');
  }

  const ids = scriptRegistry.list().map((x) => x.id);
  const rendererIds = ids.filter((id) => String(id).startsWith('renderer.'));
  console.log(
    `[web.dom ipc] 已就绪 —— 脚本表共 ${ids.length} 个,其中 renderer.* ${rendererIds.length} 个: `
    + (rendererIds.join(', ') || '(⚠️ 一个都没有 —— renderer 侧调用必然全失败)'),
  );

  ipcMain.handle(
    IPC_CHANNELS.WEB_DOM_INVOKE,
    async (_e, payload: unknown): Promise<WebDomResult> => {
      const p = payload as WebDomInvoke | null;
      if (!p || typeof p !== 'object' || typeof p.op !== 'string') {
        return failed('[web.dom ipc] 入参非法:缺 op');
      }

      const got = resolve(p.pageRef);
      if ('error' in got) return failed(got.error);
      const { wc, pageId } = got;

      try {
        switch (p.op) {
          case 'run':
            if (!p.scriptId) return failed('[web.dom ipc] run 缺 scriptId');
            return toIpc(await domRunner.run(wc, pageId, p.scriptId as ScriptId, p.params));
          /**
           * ⚠️ 只有 `run` —— `read`/`query`/`text`/`selection` 在 `WebDom` 接口里
           * 声明了但**全仓零实现**(只有 `ElectronDomRunner.run` 落地)。
           * ⭐ 开出去就是空头承诺:调了必然失败,而原因是「底座没实现」,
           * 会把排查方向完全带偏。等真实现了再加 op。
           */
          default:
            /**
             * ⚠️ 未知 op **如实报**,不静默当某个默认操作 ——
             * 静默会让「renderer 发错了」表现成「操作没效果」。
             * ⭐ 尤其:`runDynamic` 会走到这里被拒,这是刻意的。
             */
            return failed(`[web.dom ipc] 不支持的 op: ${String((p as { op: unknown }).op)}`);
        }
      } catch (err) {
        // ⚠️ 不静默 —— 这正是本层要替换掉的那个病(.catch(() => {}))
        return failed(`[web.dom ipc] ${p.op} 抛异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
