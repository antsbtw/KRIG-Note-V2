/**
 * Mail View 命令注册(阶段 0)
 *
 * 核心命令 mail-view.extract:右键邮箱 webview → 主进程抓单封邮件字段 →
 * 走 content-ingest + import-orchestrator 落成一条 note。
 *
 * ## ⚠️ 铁律:命令型广播模块级单订阅
 *
 * MAIL_EXTRACT_REQUEST 是宿主 webContents 广播。若在每个并存 MailView 实例的
 * useEffect 里订阅 → 一次右键触发 N 次提取(N = 并存 ws 数)。故订阅提升到模块级
 * (registerMailCommands 由 renderer/index.tsx 在 wsId 就绪时只调一次),
 * 命令体内用 ctx.wsId 定向到活跃 ws。
 * 见 memory「宿主广播×多ws扇出」。
 *
 * ## 归档链路:不造第四个转换器
 *
 * 邮件正文 → markdown → content-ingest.markdownToAtoms → import-orchestrator。
 * 对齐 markdown-import-unify 的既定方向(AI 提取/网页剪藏/Word 已有三套转换器,
 * 用户拍板方向是统一成「产 markdown → 同一导入入口」,不再新增)。
 * 阶段 0 邮件正文是纯文本,故 markdown 化只需最小处理;阶段 3 接 HTML 富文本时
 * 走 Defuddle 清洗后仍汇入这同一条链路。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { registerWsCommand } from '@slot/command-registry/register-ws-command';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getCapabilityApi, requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MailServiceApi, MailExtractData } from '@capabilities/mail-service';
// ⚠️ 用**真实**类型,不手写「最小接口」—— 曾因手写 Lite 接口(把 async 的
// markdownToAtoms 写成同步、把 { atoms, warnings } 写成裸数组)绕开类型检查,
// 结果把一个 Promise 塞进 IPC → 运行时 "An object could not be cloned"。
// 类型只有对齐真源才拦得住这类错。
import type { ContentIngestApi } from '@capabilities/content-ingest/types';
import type { ImportOrchestratorApi } from '@capabilities/import-orchestrator/types';

/** 模块级单订阅句柄(防重复注册) */
let extractUnsub: (() => void) | null = null;

/**
 * 邮件字段 → markdown。
 *
 * 阶段 0 正文是纯文本(innerText),故这里只做:主题作 H1、发件人/来源作元信息行、
 * 正文原样。**不做**富文本解析 —— 那是阶段 3 的活,且要走 Defuddle 而非手写。
 */
function mailToMarkdown(data: MailExtractData): string {
  const lines: string[] = [];
  const subject = (data.subject ?? '').trim() || '(无主题)';
  lines.push(`# ${subject}`);
  lines.push('');

  const meta: string[] = [];
  if (data.from) meta.push(`**发件人**:${data.from}`);
  if (data.sourceUrl) meta.push(`**来源**:${data.sourceUrl}`);
  if (meta.length > 0) {
    lines.push(meta.join(' · '));
    lines.push('');
  }

  lines.push((data.bodyText ?? '').trim());
  return lines.join('\n');
}

export function registerMailCommands(wsId: string): void {
  /**
   * 提取右键点中的那一封邮件 → 落成一条独立 note。
   *
   * 注意语义与 X 不同:X 的 extract-tweet 要求「先打开 Note」并把 tweetBlock 追加进去
   * (语义 = 把这条推接到我正在写的笔记)。邮件是**独立实体**(设计方案 D4),
   * 故落成一条**新 note**,不要求当前有 note 在场。
   */
  registerWsCommand('mail-view.extract', () => wsId, async (ctx, arg) => {
    const p = (arg ?? {}) as { serviceId?: unknown; x?: unknown; y?: unknown };
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
    const serviceId = typeof p.serviceId === 'string' ? p.serviceId : 'gmail';

    const mail = requireCapabilityApi<MailServiceApi>('mail-service');
    // 按活跃 ws 定向取本 ws 的 Mail Host wcId(治多实例串扰:内置浏览器也可能开着 Gmail)
    const result = await mail.extractMail(
      serviceId as never,
      p.x,
      p.y,
      mail.getMailHostWcId(ctx.wsId),
    );

    if (!result.success || !result.data) {
      // fail loud:明确告知失败原因,不静默产空 note
      window.alert(`邮件提取失败:${result.error || '未知错误'}`);
      return;
    }

    const ingest = requireCapabilityApi<ContentIngestApi>('content-ingest');
    const orchestrator = requireCapabilityApi<ImportOrchestratorApi>('import-orchestrator');

    const md = mailToMarkdown(result.data);
    const titleHint = (result.data.subject ?? '').trim() || '(无主题邮件)';

    // ⚠️ markdownToAtoms 是 async 且返 { atoms, warnings } —— 必须 await + 解构。
    // 直接把返回值当数组传下去 = 把 Promise 塞进 IPC,结构化克隆会抛
    // "An object could not be cloned"(已踩)。
    //
    // **不传 titleHint** —— mailToMarkdown 已经把主题写成首行 `# 主题`,
    // 再传会让 markdownToAtoms 在同一个首块上重复施加 isTitle 语义。
    // titleHint 只给下面的 batch item(那是 note 的显示名,另一回事)。
    const { atoms, warnings } = await ingest.markdownToAtoms(md);
    if (warnings.length > 0) {
      console.warn('[mail-extract] markdownToAtoms warnings:', warnings);
    }
    if (atoms.length === 0) {
      window.alert('邮件提取成功但转换后为空,已中止(未创建笔记)');
      return;
    }

    const importResult = await orchestrator.importDraftsToNotes(
      [{ atoms, folderId: null, titleHint }],
      { logTag: 'mail-extract' },
    );

    if (importResult.failures.length > 0) {
      console.error('[mail-extract] 落库失败:', importResult.failures);
    }
    if (importResult.noteIds.length === 0) {
      window.alert('邮件已提取,但落库失败 —— 请查看控制台日志');
      return;
    }

    // 打开新 note —— 对照布局:mail 钉 left,note 开 right(左看原邮件、右看提取稿)。
    // 与网页剪藏(content-extraction import-pipeline)同款收尾。
    //
    // ⚠️ 为什么必须打开:邮件落成的是**新 note**(设计 D4 邮件是独立实体),不像 X 那样
    // 插进当前 note 立刻可见。不打开 = 用户点了菜单什么都没发生,和失败长得一模一样
    // —— 成功也必须看得见(reliability-charter「故障必须响」的一体两面)。
    const noteId = importResult.noteIds[0];
    console.log('[mail-extract] mail → note', noteId, `(${atoms.length} atoms)`);
    commandRegistry.execute('mail-view.pin-left');
    commandRegistry.execute('note-view.set-active-in-right', noteId);
  });

  /**
   * 把 Mail 钉到左栏(提取后腾出右栏给 note 的对照布局用)。
   * 照搬 web-view.pin-left:若 mail 当前在 right 则腾出 right,否则只设 left。
   */
  registerWsCommand('mail-view.pin-left', () => wsId, (ctx) => {
    const ws = workspaceManager.get(ctx.wsId);
    if (!ws) return;
    if (ws.slotBinding.left === 'mail-view') return; // 已在 left
    const right = ws.slotBinding.right === 'mail-view' ? null : ws.slotBinding.right;
    workspaceManager.update(ctx.wsId, {
      slotBinding: { ...ws.slotBinding, left: 'mail-view', right },
    });
  });

  // ── 右键「提取此邮件到笔记」(MAIL_EXTRACT_REQUEST 广播)模块级单订阅 ──
  // ⚠️ 不进 view 组件 useEffect,否则多 ws 并存时一次右键触发 N 次提取。
  if (!extractUnsub) {
    const mail = getCapabilityApi<MailServiceApi>('mail-service');
    if (mail) {
      extractUnsub = mail.onExtractRequest((payload) => {
        void commandRegistry.execute('mail-view.extract', {
          serviceId: payload.serviceId,
          x: payload.x,
          y: payload.y,
        });
      });
    }
  }
}
