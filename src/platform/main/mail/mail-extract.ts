/**
 * 单封邮件提取(阶段 0)— 按 guest viewport 坐标定位 + 抓主题/正文/发件人
 *
 * ## 边界:这是「用户显式动作」,不是数据同步
 *
 * 阶段 0 的 DOM 提取**只服务于「用户右键点了这一封」**。批量拉取是阶段 1 的 IMAP
 * 的活 —— 从 DOM 里滚动抓几百封是噩梦(懒加载、虚拟列表回收、无稳定 id),
 * 且 Gemma 需要的结构化字段(线程、UID、flags、附件)DOM 里根本拿不全。
 * 见 docs/10-business-design/mail/module-design.md §1。
 *
 * 故本文件**刻意不做**:列表遍历、翻页、增量、去重。只有「这一封」。
 *
 * ## 流程
 *
 * 1. 按活跃 ws 定向取该 ws 的 Mail Host webContents(fail loud,不回退全局)
 * 2. executeJavaScript:elementFromPoint(x,y) 向上 closest 到 mailElement,
 *    命中后按 profile selector 抓主题/正文;正文取 innerText(保留换行,
 *    不取 innerHTML —— 阶段 0 产纯文本,富文本转换是阶段 3 归档链路的活)
 * 3. 没点中邮件 / 抓到空 → fail loud,renderer 侧 toast 提示,不静默产空 note
 *
 * ## selector 失效怎么办
 *
 * 网页版邮箱 DOM 是编译产物,改版会让 selector 失效。此时表现为「没点中邮件」,
 * 用户会看到明确的失败提示(而非拿到一个空 note)。修法是更新 profile 的
 * selectors 多候选。影响面被限制在本功能 —— 阶段 1 之后数据层走 IMAP,不受影响。
 */

import { requireMailWebContents } from './mail-webcontents';
import {
  getMailServiceProfile,
  type MailServiceId,
} from '@shared/types/mail-service-types';

/** 抓到的邮件字段(阶段 0 只做纯文本,不含附件/线程 —— 那些要 IMAP) */
export interface MailExtractData {
  /** 邮件主题;抓不到时由正文首行兜底 */
  subject?: string;
  /** 正文纯文本(innerText,保留换行) */
  bodyText?: string;
  /** 发件人显示名 / 地址(尽力抓,网页版结构差异大) */
  from?: string;
  /** 收件日期(原样保留网页上的显示文本,不做解析 —— 各家格式不一,阶段 1 的 IMAP 才有真 datetime) */
  date?: string;
  /** 提取时该邮箱页的 URL(诊断 + 归档时留痕) */
  sourceUrl?: string;
}

export interface MailExtractResult {
  success: boolean;
  data?: MailExtractData;
  error?: string;
}

/**
 * 构造在邮箱 webContents 内执行的脚本。
 *
 * 返回值约定(供主进程区分失败原因,对齐 X 的 __noTweet 模式):
 * - { __noMail: true }  点中位置向上找不到邮件容器
 * - 字段对象           命中容器,字段尽力抓(可能部分为空)
 */
export function buildExtractScript(
  x: number,
  y: number,
  mailSelector: string,
  bodySelector: string | undefined,
  subjectSelector: string | undefined,
): string {
  const sel = JSON.stringify(mailSelector);
  const bodySel = JSON.stringify(bodySelector ?? '');
  const subjSel = JSON.stringify(subjectSelector ?? '');
  /**
   * ⭐ 2026-09-30:坐标改走**绑定值**(L2 收口第 3 批)。
   *
   * 原来是 `elementFromPoint(${'${x}'}, ${'${y}'})` —— 裸插进脚本文本,
   * 与 `project-x-inject-template-escape` 同族(求值后的样子与源码所见不同,
   * 而 tsc 与单测都发现不了)。selector 三个本来就 stringify 过,坐标漏了。
   *
   * ⚠️ **只改绑定,不改逻辑** —— ① 段的回退语义(只在 ±24 带内找、
   * 取「中心距最近」)与 `web.dom` 的 `ordinal-by-point`
   * (带外也找、取「边缘距最近」+ maxDy 240)**不一样**,
   * 合并会改行为。收口批次不许顺手改语义,否则出问题分不清是谁带来的。
   */
  /**
   * ⚠️⚠️ **`JSON.stringify` 不是坏数字的安全网** —— 2026-09-30 复核实测:
   * `JSON.stringify(NaN)` / `JSON.stringify(Infinity)` 都给 **`null`**,
   * 而浏览器把 `elementFromPoint(null, null)` 当成 `(0, 0)` ——
   * 于是**悄悄提取最左边那封邮件,不报任何错**。
   *
   * ⭐ 这是我这次改绑定**引入的回归**:改之前 NaN 原样进脚本、
   * 浏览器当场报错、用户看得见失败。「从报错变成静默取错」比原来更坏。
   *
   * ⭐ 挡坏数字只能靠**校验**,不能靠序列化。同 `dom/locate-scripts.ts`
   * 的 `requireNumber`。
   */
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(
      `[mail-extract] 坐标必须是有限数字,收到 x=${String(x)} y=${String(y)}`
      + ' —— 拒绝构造脚本(NaN/Infinity 会被浏览器当成 0,静默提取错的那封)',
    );
  }
  const bindX = JSON.stringify(x);
  const bindY = JSON.stringify(y);
  return `
(function() {
  try {
    var sel = ${sel};
    var bodySel = ${bodySel};
    var subjSel = ${subjSel};
    var X = ${bindX};
    var Y = ${bindY};

    // ① 坐标 → 邮件容器(命中优先,间隙回退纵向 ±24px 最近的)
    var el = document.elementFromPoint(X, Y);
    var box = el && el.closest ? el.closest(sel) : null;
    if (!box) {
      var list = Array.prototype.slice.call(document.querySelectorAll(sel));
      var best = null, bestDist = Infinity;
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (Y >= r.top - 24 && Y <= r.bottom + 24) {
          var d = Math.abs((r.top + r.bottom) / 2 - Y);
          if (d < bestDist) { bestDist = d; best = list[i]; }
        }
      }
      box = best;
    }
    if (!box) return { __noMail: true };

    function textOf(node) {
      if (!node) return '';
      var t = node.innerText || node.textContent || '';
      return t.replace(/\\u00a0/g, ' ').trim();
    }
    // selector 支持逗号分隔多候选,querySelector 本身即按文档顺序返回首个匹配,
    // 故顺序命中是天然的(与 web-service-base/webview-input 同约定)。
    /**
     * ⚠️⚠️ **已知风险,刻意未改(2026-09-30 复核提出,待单独立项)**
     *
     * root.querySelector(s) || document.querySelector(s) —— 容器内找不到就
     * **退到整页找**。在 Gmail 会话视图(一屏多封展开)里,这可能取到
     * **别封邮件的正文**,而且**不报错**:结果看起来完整,内容是错的。
     *
     * ⚠️ 注意本注释**在模板字面量内部** —— 不许写反引号,
     * 否则会提前终止字符串、把后面的 JS 当 TS 解析
     * (feedback-comment-breaks-what-it-documents:注释弄坏它所注释的代码)。
     *
     * ⭐ 为什么不顺手修:改掉它会**改变提取行为**(某些邮箱可能正依赖这条兜底
     * 才能拿到正文),要真机逐家验证(Gmail/Outlook/QQ/163)才能定。
     * 本批次是「收口注入 + 补守卫」,不含行为变更 —— 混在一起出问题分不清来源。
     *
     * 立项时的判据:Gmail 会话视图展开两封,右键第二封,
     * 取到的正文必须是第二封的。
     */
    function pick(root, s) {
      if (!s) return null;
      try { return root.querySelector(s) || document.querySelector(s); }
      catch (e) { return null; }
    }

    // ② 正文:优先 bodySelector,miss 退整个容器
    var bodyNode = pick(box, bodySel);
    var bodyText = textOf(bodyNode || box);

    // ③ 主题:优先 subjectSelector,miss 由正文首行兜底(下面在 main 侧做)
    var subject = textOf(pick(box, subjSel));

    // ④ 发件人:网页版结构差异大,按通用信号尽力抓(email 属性 → mailto → 无)
    var from = '';
    var fromNode = box.querySelector('[email], [data-hovercard-id], span[title*="@"], a[href^="mailto:"]');
    if (fromNode) {
      from = fromNode.getAttribute('email')
        || fromNode.getAttribute('data-hovercard-id')
        || fromNode.getAttribute('title')
        || textOf(fromNode);
      if (from && from.indexOf('mailto:') === 0) from = from.slice(7);
    }

    // ⑤ 日期:网页版通常放在 title 属性里(hover 显示完整时间),文本是缩写
    var date = '';
    var dateNode = box.querySelector('span[title*=":"], span[data-tooltip*=":"], time');
    if (dateNode) {
      date = dateNode.getAttribute('title')
        || dateNode.getAttribute('data-tooltip')
        || textOf(dateNode);
    }

    return {
      subject: subject || '',
      bodyText: bodyText || '',
      from: (from || '').trim(),
      date: (date || '').trim(),
      sourceUrl: location.href,
    };
  } catch (e) {
    return { __error: String(e && e.message ? e.message : e) };
  }
})()
`;
}

/**
 * 提取右键点中的那一封邮件。
 *
 * @param serviceId  邮箱服务(决定用哪套 selector)
 * @param x          guest viewport x
 * @param y          guest viewport y
 * @param targetWcId 本活跃 ws 的 Mail Host guest wcId(renderer 侧取出后透传,
 *                   按 ws 定向治多实例串扰);缺失 → fail loud,不回退全局
 */
export async function extractMail(
  serviceId: MailServiceId,
  x: number,
  y: number,
  targetWcId?: number | null,
): Promise<MailExtractResult> {
  const resolved = await requireMailWebContents(targetWcId);
  if ('error' in resolved) {
    return { success: false, error: resolved.error };
  }

  let profile;
  try {
    profile = getMailServiceProfile(serviceId);
  } catch {
    return { success: false, error: `未知邮箱服务:${serviceId}` };
  }

  let script: string;
  try {
    script = buildExtractScript(
      x,
      y,
      profile.selectors.mailElement,
      profile.selectors.mailBody,
      profile.selectors.mailSubject,
    );
  } catch (e) {
    // ⭐ 坐标非法在这里变成一个**说得出原因**的失败,而不是静默取错那封
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  let raw: unknown;
  try {
    raw = await resolved.wc.executeJavaScript(script, true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `邮件提取脚本执行失败:${msg}` };
  }

  if (!raw || typeof raw !== 'object') {
    return { success: false, error: '邮件提取无返回(页面可能尚未加载完)' };
  }

  const r = raw as {
    __noMail?: boolean;
    __error?: string;
    subject?: string;
    bodyText?: string;
    from?: string;
    date?: string;
    sourceUrl?: string;
  };

  if (r.__error) {
    return { success: false, error: `邮件提取出错:${r.__error}` };
  }
  if (r.__noMail) {
    // fail loud:明确告诉用户没点中,而不是产一个空 note。
    // 若用户确实点在邮件上却报这个,多半是 profile selector 随改版失效了。
    return {
      success: false,
      error: '没有定位到邮件 —— 请右键点在邮件正文或列表行上(若持续失败,可能是邮箱改版导致选择器失效)',
    };
  }

  const bodyText = (r.bodyText ?? '').trim();
  if (!bodyText) {
    return { success: false, error: '定位到邮件但正文为空(可能尚未展开该邮件)' };
  }

  // 主题兜底:selector 没抓到就取正文首行(截断到合理长度)
  let subject = (r.subject ?? '').trim();
  if (!subject) {
    const firstLine = bodyText.split('\n').find((l) => l.trim().length > 0) ?? '';
    subject = firstLine.trim().slice(0, 120);
  }

  return {
    success: true,
    data: {
      subject,
      bodyText,
      from: (r.from ?? '').trim() || undefined,
      date: (r.date ?? '').trim() || undefined,
      sourceUrl: r.sourceUrl,
    },
  };
}
