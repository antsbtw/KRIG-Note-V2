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
 * 阶段 0 正文是纯文本(innerText),故这里只做:主题作 H1、元信息作引用块、正文清洗。
 * **不做**富文本解析 —— 那是阶段 3 的活,且要走 Defuddle 而非手写。
 *
 * ## 排版取舍(2026-08-26 实测后调整)
 *
 * 首版把「发件人 · 来源」挤成一行粗体塞在正文顶部,实测很难读:长 URL 折行断在中间,
 * 和正文首段黏在一起分不清哪是元信息。改为:
 * - 元信息走 **markdown 引用块**(`> `),视觉上与正文分离,且天然可折叠/可跳过
 * - 每项**独占一行**,不再用 ` · ` 挤在一起
 * - **不放 sourceUrl** —— Gmail 的 hash 路由 URL 又长又脆(换设备/换账号未必回得去),
 *   占掉两行版面却几乎没用。留在 MailExtractData 里供诊断,只是不进正文。
 *
 * ⚠️ 更彻底的解法是给邮件专有块格式(mailBlock),但那要等阶段 1 IMAP 落地、
 * 字段形态稳定后再立项 —— 现在为 DOM 抓来的半成品设计块结构大概率要重做。
 * 见 memory「邮件在 note 里的专有格式」。
 */
function mailToMarkdown(data: MailExtractData): string {
  const lines: string[] = [];
  const subject = (data.subject ?? '').trim() || '(无主题)';
  lines.push(`# ${subject}`);
  lines.push('');

  // 元信息:引用块,每项独占一行。sourceUrl 刻意不放(见文件头注释)。
  const meta: string[] = [];
  if (data.from) meta.push(`> **发件人**:${data.from}`);
  if (data.date) meta.push(`> **日期**:${data.date}`);
  if (meta.length > 0) {
    lines.push(...meta);
    lines.push('');
  }

  lines.push(normalizeBody(data.bodyText ?? ''));
  return lines.join('\n');
}

/**
 * 正文清洗(阶段 0 最小处理)。
 *
 * innerText 抓下来的正文常带模板排版噪音:HTML 邮件(尤其 Google/新闻简报这类)靠
 * 表格布局,innerText 会在每个单元格间插空行,导致一句话被拆成好几段。
 * 这里只做**最保守**的压缩:连续 3 行以上空行压成 1 行、去掉行尾空白。
 *
 * ⚠️ 刻意**不做**更激进的合并(如把相邻短行接成一段)—— 那会把本就该分行的
 * 列表/署名/地址也合并掉,弊大于利。真正的结构化要等 IMAP 拿到 HTML 正文后
 * 走 Defuddle 清洗(阶段 3 归档链路),不是在这里手写规则。
 */
function normalizeBody(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
   * SlotPicker 视图切换 — 在 right slot 打开选中的 view。
   *
   * 与 note-view / ai-view / social-view 的同名命令**完全一致**(同一 SlotPickerPopup
   * 回调契约)。铁律:同功能同逻辑 —— 不自造 toggle,右栏能开什么由 viewTypeRegistry
   * 动态决定,新增 view 自动出现在列表里,不用回来改这里。
   *
   * commandArg:
   *   - string:目标 viewId('note-view' / 'ebook-view' / 'web-view' / …)
   *   - { viewId, subId }:带子项的 view(AI / Social / Mail → 具体服务)
   */
  registerWsCommand('mail-view.open-right-slot', () => wsId, (ctx, arg: unknown) => {
    const bus = workspaceManager.getBus(ctx.wsId);
    if (!bus) return;
    if (typeof arg === 'string') {
      bus.slot.openRight(arg);
    } else if (arg && typeof arg === 'object' && 'viewId' in arg) {
      const { viewId, subId } = arg as { viewId: string; subId: string };
      bus.slot.openRight(viewId, { subId });
    }
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
