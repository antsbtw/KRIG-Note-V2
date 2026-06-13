/**
 * X Articles 发布 — 驱动 X 原生 Insert 菜单(终态方案,2026-06-13)。
 *
 * 缘起(总指挥逐项实测 Insert 菜单后定终态,见
 *  docs/tasks/2026-06-13-x-articles-native-insert-impl-prompt.md §0):
 * X Article **原生支持 LaTeX / Table / Code / Posts / Media**,交互模式高度统一
 * (点 Insert → 选项 → 弹模态 → 填文本框 → 点 Update)。所以发长文 = **驱动 X 自己的原生
 * Insert**,几乎不渲图(质量最高、保真、可搜索可复制)。
 *
 * 本文件是 main 侧**驱动器**:消费 renderer 传来的 ArticleInsertStep[] 计划(纯数据,
 * note 侧已用 buildArticlePlan 产好),逐步驱动 X Article 编辑器 DOM。
 *
 * 底座复用(铁律 1:不重新造注入/点击/查询原语):
 * - executeJavaScript 查/点/填 X DOM(同 x-drag-drop / ai extractors 范式)
 * - pasteTextToWebview / focusInputBox(合成 paste,认 X 富文本)
 * - feedFilesToInput(CDP 喂图,2.5-b 同款)
 * - requireXWebContents(按 ws 定向)
 *
 * ⚠️⚠️ 写方向最高红线:**驱动完绝不程序点 Publish。** 只插内容,用户在 X 编辑器里看成品、
 *   调整、手动点 Publish。本文件全程不碰任何 publish/发布按钮。
 *
 * fail loud(铁律 4):单 step 驱动失败(selector 失效 / 模态没出现 / 填值没落地)→
 *   记 warning,**继续下一个 step**(不中断整篇),最后汇总返回。selector 未配置 → 直接 fail。
 *
 * ⚠️ 所有 selector「待总指挥实机 spike」(见 x-service-types.ts ARTICLE selector 注释)。
 *   本驱动器的 DOM 交互/时序判据也待实机校:模态出现/关闭判据、各步等待阈值。
 */

import {
  getXServiceProfile,
  type XServiceId,
  type XArticleSelectors,
} from '@shared/types/x-service-types';
import { pasteTextToWebview } from '../web-service-base';
import { feedFilesToInput } from '../web-service-base';
import { requireXWebContents } from './x-webcontents';
import { resolveMediaPath } from '../media/media-store-impl';
import type { ArticleInsertStep } from '@drivers/text-editing-driver/serializers/note-to-article-plan';

/** 驱动一个 step 的结果(成功 / 失败带原因)。 */
interface StepResult {
  ok: boolean;
  /** 失败/降级原因(汇总给用户,fail loud)。 */
  warning?: string;
}

export interface DriveArticleResult {
  success: boolean;
  /** 整体失败原因(无 webContents / selector 未配置 / 标题填充失败等阻断性问题)。 */
  error?: string;
  /** 成功驱动的 step 数。 */
  drivenSteps?: number;
  /** 单 step 降级/失败的汇总提示(非空 = 部分块没成功,用户需在 X 手动补;fail loud)。 */
  warnings?: string[];
}

// ═══════════════════════════════════════════════════════
// §1  通用 DOM 驱动原语(executeJavaScript 包装)
// ═══════════════════════════════════════════════════════

const DEFAULT_WAIT_MS = 6000;
const POLL_INTERVAL_MS = 150;
/** 每步操作间的喘息(等 X 动画/异步渲染;待实机校准)。 */
const STEP_SETTLE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 取第一个非空 selector 候选并 JSON 安全注入。 */
function selExists(wc: Electron.WebContents, selector: string): Promise<boolean> {
  const script = `
    (function() {
      var sel = ${JSON.stringify(selector)};
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      for (var i=0;i<parts.length;i++){ try { if (document.querySelector(parts[i])) return true; } catch(e){} }
      return false;
    })();
  `;
  return wc.executeJavaScript(script).then((v) => !!v).catch(() => false);
}

/** poll 等 selector 出现(模态弹出 / 块插入)。 */
async function waitForSelector(
  wc: Electron.WebContents,
  selector: string,
  timeoutMs = DEFAULT_WAIT_MS,
): Promise<boolean> {
  if (!selector) return false;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await selExists(wc, selector)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/** poll 等 selector 消失(模态关闭判据)。selector 空 → 直接视为已关闭。 */
async function waitForSelectorGone(
  wc: Electron.WebContents,
  selector: string,
  timeoutMs = DEFAULT_WAIT_MS,
): Promise<boolean> {
  if (!selector) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await selExists(wc, selector))) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/** 点 selector 命中的第一个元素(多候选顺序尝试)。返回是否点到。 */
function clickSelector(wc: Electron.WebContents, selector: string): Promise<boolean> {
  const script = `
    (function() {
      var sel = ${JSON.stringify(selector)};
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      for (var i=0;i<parts.length;i++){
        try {
          var el = document.querySelector(parts[i]);
          if (el) { el.scrollIntoView({block:'center'}); el.click(); return true; }
        } catch(e){}
      }
      return false;
    })();
  `;
  return wc.executeJavaScript(script).then((v) => !!v).catch(() => false);
}

/**
 * 在 menuItem/button 容器列表里按**可见文本**匹配并点击(纯 CSS 选不中文本)。
 * 用 textContent trim 后大小写不敏感「包含」匹配 label。
 */
function clickByText(
  wc: Electron.WebContents,
  containerSelector: string,
  label: string,
): Promise<boolean> {
  const script = `
    (function() {
      var sel = ${JSON.stringify(containerSelector)};
      var label = ${JSON.stringify(label)}.toLowerCase();
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      var seen = [];
      for (var i=0;i<parts.length;i++){
        var list;
        try { list = document.querySelectorAll(parts[i]); } catch(e){ continue; }
        for (var j=0;j<list.length;j++){
          var el = list[j];
          if (seen.indexOf(el) !== -1) continue;
          seen.push(el);
          var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          // 精确或包含匹配(菜单项文本短,包含足够;避免 "Code" 命中 "Add code here" 这类长文本:
          // 限定文本长度接近 label,或完全相等)。
          if (txt === label || (txt.indexOf(label) !== -1 && txt.length <= label.length + 4)) {
            el.scrollIntoView({block:'center'});
            el.click();
            return true;
          }
        }
      }
      return false;
    })();
  `;
  return wc.executeJavaScript(script).then((v) => !!v).catch(() => false);
}

// ═══════════════════════════════════════════════════════
// §2  Insert 模态统一编排:点 Insert → 选项 → 等模态 → 填 → Update → 等关闭
// ═══════════════════════════════════════════════════════

/** 打开 Insert 菜单并点某项。失败返回原因。 */
async function openInsertItem(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  menuLabel: string,
): Promise<string | null> {
  // 1. 点 Insert 触发钮
  if (!(await clickSelector(wc, art.insertTrigger))) {
    return 'Insert 触发钮未点中(selector 失效?)';
  }
  // 2. 等菜单项出现
  if (!(await waitForSelector(wc, art.menuItem, 3000))) {
    return 'Insert 菜单未弹出';
  }
  // 3. 按文本点对应项
  if (!(await clickByText(wc, art.menuItem, menuLabel))) {
    return `Insert 菜单项「${menuLabel}」未找到/未点中`;
  }
  return null;
}

/** 点模态 Update 并等模态(以输入框 selector 为判据)关闭。 */
async function confirmModal(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  modalInputSelector: string,
): Promise<string | null> {
  if (!(await clickByText(wc, art.modalButton, art.modalButtonLabels.update))) {
    return 'Update 按钮未点中';
  }
  // 模态关闭判据:输入框消失
  if (!(await waitForSelectorGone(wc, modalInputSelector, 4000))) {
    return 'Update 后模态未关闭(可能内容非法 / 按钮 disabled)';
  }
  return null;
}

/**
 * 打开 X Article 空白编辑器并等就绪（总指挥实机确认：composeUrl 直达编辑器，无需点「新建」）。
 *
 * - 已在 Article compose 页（URL 含 /compose/articles）则不重载，直接 poll 编辑器就绪；
 * - 否则 loadURL(composeUrl) 再 poll。
 * - 就绪判据：**正文编辑区 + Insert 按钮都出现**（两者齐 = 空白编辑器渲染完 + 有发文章权限）。
 *
 * ⚠️ 红线：loadURL 进的是 draft 编辑器（非发布），不碰写方向红线。
 * @returns true = 编辑器就绪；false = 导航后超时仍等不到（大概率无 Article 权限 / X 改版）。
 */
async function openArticleEditor(
  wc: Electron.WebContents,
  art: XArticleSelectors,
): Promise<boolean> {
  const onArticlePage = (() => {
    try {
      return wc.getURL().includes('/compose/articles');
    } catch {
      return false;
    }
  })();
  if (!onArticlePage) {
    try {
      wc.loadURL(art.composeUrl);
    } catch {
      return false;
    }
  }
  // 等编辑器就绪：正文区 + Insert 按钮都在场。给足超时（SPA 加载 + 渲染较重）。
  // 任一等不到都判失败（无权限账号该 URL 进不了编辑器，正文/Insert 永不出现）。
  const EDITOR_READY_MS = 12000;
  const bodyReady = await waitForSelector(wc, art.body, EDITOR_READY_MS);
  if (!bodyReady) return false;
  const insertReady = await waitForSelector(wc, art.insertTrigger, 4000);
  return insertReady;
}

// ═══════════════════════════════════════════════════════
// §3  各 step 驱动
// ═══════════════════════════════════════════════════════

/** 极简 HTML→纯文本(供合成 paste 的 text/plain 兜底 + 落地校验片段)。 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>(?!$)/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 文字段落:在正文合成 paste 一段 X 支持的 HTML(富格式)。 */
async function driveHtml(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  html: string,
): Promise<StepResult> {
  // 复用底座 pasteTextToWebview(合成 paste,认 DraftJS):传 text/plain(兜底+校验片段)
  // + text/html(富格式,X Article 正文认富文本粘贴 —— 实测 #7)。底座扩了 htmlText 参,
  // 不在驱动器里重造合成 paste。⚠️ 富格式是否保留待实机(见交付说明)。
  const plain = htmlToPlainText(html);
  const ok = await pasteTextToWebview(wc, art.body, plain, html);
  if (!ok) return { ok: false, warning: '正文文字段落粘贴未落地' };
  return { ok: true };
}

/** LaTeX:Insert→LaTeX→填 latex→Update。 */
async function driveLatex(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  latex: string,
): Promise<StepResult> {
  const opened = await openInsertItem(wc, art, art.menuLabels.latex);
  if (opened) return { ok: false, warning: `公式插入失败:${opened}` };
  if (!(await waitForSelector(wc, art.latexInput, 4000))) {
    return { ok: false, warning: '公式插入失败:LaTeX 模态输入框未出现' };
  }
  if (!(await pasteTextToWebview(wc, art.latexInput, latex))) {
    return { ok: false, warning: '公式插入失败:latex 未填入' };
  }
  const confirmed = await confirmModal(wc, art, art.latexInput);
  if (confirmed) return { ok: false, warning: `公式插入失败:${confirmed}` };
  return { ok: true };
}

/** Code:Insert→Code→填语言+代码→Update。 */
async function driveCode(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  language: string,
  code: string,
): Promise<StepResult> {
  const opened = await openInsertItem(wc, art, art.menuLabels.code);
  if (opened) return { ok: false, warning: `代码插入失败:${opened}` };
  if (!(await waitForSelector(wc, art.codeInput, 4000))) {
    return { ok: false, warning: '代码插入失败:Code 模态未出现' };
  }
  // 语言:有则填语言搜索框(可空 —— X 找不到语言就无高亮,非阻断)。
  if (language && (await selExists(wc, art.codeLangInput))) {
    await pasteTextToWebview(wc, art.codeLangInput, language);
    await sleep(STEP_SETTLE_MS); // 等语言下拉过滤
    // ⚠️ 待实机:语言可能需从下拉选中(再点一下首选项)。本期只填搜索框,选中待 spike。
  }
  if (!(await pasteTextToWebview(wc, art.codeInput, code))) {
    return { ok: false, warning: '代码插入失败:源码未填入' };
  }
  const confirmed = await confirmModal(wc, art, art.codeInput);
  if (confirmed) return { ok: false, warning: `代码插入失败:${confirmed}` };
  return { ok: true };
}

/** Table:Insert→Table→填 markdown→Update。 */
async function driveTable(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  markdown: string,
): Promise<StepResult> {
  const opened = await openInsertItem(wc, art, art.menuLabels.table);
  if (opened) return { ok: false, warning: `表格插入失败:${opened}` };
  if (!(await waitForSelector(wc, art.tableInput, 4000))) {
    return { ok: false, warning: '表格插入失败:Table 模态(markdown 输入框)未出现' };
  }
  if (!(await pasteTextToWebview(wc, art.tableInput, markdown))) {
    return { ok: false, warning: '表格插入失败:markdown 未填入' };
  }
  const confirmed = await confirmModal(wc, art, art.tableInput);
  if (confirmed) return { ok: false, warning: `表格插入失败:${confirmed}` };
  return { ok: true };
}

/** Posts:Insert→Posts→填 tweetUrl→(自动嵌或 Update)。 */
async function drivePosts(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  tweetUrl: string,
): Promise<StepResult> {
  const opened = await openInsertItem(wc, art, art.menuLabels.posts);
  if (opened) return { ok: false, warning: `嵌推插入失败:${opened}` };
  if (!(await waitForSelector(wc, art.postsUrlInput, 4000))) {
    return { ok: false, warning: '嵌推插入失败:Posts 模态(URL 输入框)未出现' };
  }
  if (!(await pasteTextToWebview(wc, art.postsUrlInput, tweetUrl))) {
    return { ok: false, warning: '嵌推插入失败:URL 未填入' };
  }
  // ⚠️ 待实机:Posts 可能填 URL 后自动嵌(无 Update),也可能要点确认。先等 URL 框消失;
  //   消失即视为嵌入完成;没消失则尝试点 Update(兜底)。
  if (!(await waitForSelectorGone(wc, art.postsUrlInput, 3000))) {
    await clickByText(wc, art.modalButton, art.modalButtonLabels.update);
    if (!(await waitForSelectorGone(wc, art.postsUrlInput, 3000))) {
      return { ok: false, warning: '嵌推插入失败:模态未关闭(URL 格式被拒?)' };
    }
  }
  return { ok: true };
}

/** Divider:Insert→Divider(仅点击,无填值)。 */
async function driveDivider(
  wc: Electron.WebContents,
  art: XArticleSelectors,
): Promise<StepResult> {
  const opened = await openInsertItem(wc, art, art.menuLabels.divider);
  if (opened) return { ok: false, warning: `分割线插入失败:${opened}` };
  return { ok: true };
}

/** Media:Insert→Media→喂文件(网页内 Crop media)。 */
async function driveMedia(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  mediaUrl: string,
): Promise<StepResult> {
  const filePath = resolveMediaPath(mediaUrl);
  if (!filePath) {
    return { ok: false, warning: `图插入失败:media:// 解析不到本地文件(${mediaUrl})` };
  }
  const opened = await openInsertItem(wc, art, art.menuLabels.media);
  if (opened) return { ok: false, warning: `图插入失败:${opened}` };
  // 等文件 input 出现(网页内 Crop media,非 OS 框 —— 实测 §6)。
  if (!(await waitForSelector(wc, art.mediaFileInput, 4000))) {
    return { ok: false, warning: '图插入失败:Media 文件 input 未出现(可能弹了 OS 框?待实机)' };
  }
  const fed = await feedFilesToInput(wc, art.mediaFileInput, [filePath], art.mediaInsertedThumb);
  if (!fed.ok) {
    return { ok: false, warning: `图插入失败:${fed.error || '喂文件失败'}` };
  }
  // ⚠️ 待实机:Crop media 界面是否需点 Save 落图。若需,这里 clickByText(modalButton, save)。
  //   本期先尝试点 Save(若没有该按钮 clickByText 返 false,不阻断)。
  await clickByText(wc, art.modalButton, art.modalButtonLabels.save);
  return { ok: true };
}

/** 分发一个 step。 */
async function driveStep(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  step: ArticleInsertStep,
): Promise<StepResult> {
  switch (step.kind) {
    case 'html':
      return driveHtml(wc, art, step.html);
    case 'latex':
      return driveLatex(wc, art, step.latex);
    case 'code':
      return driveCode(wc, art, step.language, step.code);
    case 'table':
      return driveTable(wc, art, step.markdown);
    case 'posts':
      return drivePosts(wc, art, step.tweetUrl);
    case 'divider':
      return driveDivider(wc, art);
    case 'media':
      return driveMedia(wc, art, step.mediaUrl);
    default:
      return { ok: false, warning: `未知 step 类型` };
  }
}

// ═══════════════════════════════════════════════════════
// §4  入口:驱动整篇计划
// ═══════════════════════════════════════════════════════

export interface ArticlePlanPayload {
  title: string;
  steps: ArticleInsertStep[];
}

/**
 * 驱动 X Article 编辑器，按计划逐 step 插入内容（用户随后在 X 里检查 + 手动 Publish）。
 *
 * @param serviceId  X 服务 id（'x'）
 * @param plan       note 侧 buildArticlePlan 产的计划（title + 有序 steps）
 * @param targetWcId 注入目标 guest wc（本活跃 ws 的 X）
 *
 * ⚠️ 写方向红线：全程只插内容，**绝不点 Publish**。
 * fail loud：单 step 失败 → 记 warning 继续；阻断性问题（无 wc / selector 未配置）→ 直接 fail。
 */
export async function driveArticlePlan(
  serviceId: XServiceId,
  plan: ArticlePlanPayload,
  targetWcId?: number,
): Promise<DriveArticleResult> {
  if (!plan || !Array.isArray(plan.steps)) {
    return { success: false, error: '无效的 Article 计划' };
  }

  const got = await requireXWebContents(serviceId, targetWcId);
  if ('error' in got) return { success: false, error: got.error };
  const wc = got.wc;

  const profile = getXServiceProfile(serviceId);
  const art = profile.selectors.article;
  if (!art) {
    return { success: false, error: 'X Article selector 未配置(需 spike 后填入 profile)' };
  }

  // ── 先打开 Article 编辑器（总指挥实机确认：composeUrl 直达空白编辑器，无需点「新建」）──
  // 导航到 Article compose 页，再 poll 等空白编辑器就绪（正文区 + Insert 按钮都出现）。
  // 给足超时（页面加载 + Article SPA 渲染较重，参考发推 loadURL 后 8s 量级，这里放宽到 12s）。
  // ⚠️ 红线：loadURL 进的是 **draft 编辑器（非发布）**，不碰写方向红线。
  const ready = await openArticleEditor(wc, art);
  if (!ready) {
    // 导航后等不到编辑器 = 大概率无 Article 发布权限（该 URL 无权限进不去），或 X 改版 selector 失效。
    return {
      success: false,
      error:
        '该 X 账号可能没有 Article(文章)发布权限,或 X 改版 —— 请确认账号有发文章权限',
    };
  }

  const warnings: string[] = [];

  // 1. 标题：note isTitle → Article 标题字段（有标题且标题框在场才填；失败仅 warn 不阻断）。
  if (plan.title && (await selExists(wc, art.titleInput))) {
    const ok = await pasteTextToWebview(wc, art.titleInput, plan.title);
    if (!ok) warnings.push('标题未能填入 Article 标题框(请手动填)');
  } else if (plan.title) {
    warnings.push('未定位到 Article 标题框,标题未填(请手动填)');
  }

  // 2. 正文：逐 step 驱动。单 step 失败 fail loud 记 warning，继续下一个（不中断整篇）。
  let driven = 0;
  for (const step of plan.steps) {
    let res: StepResult;
    try {
      res = await driveStep(wc, art, step);
    } catch (err) {
      res = { ok: false, warning: `驱动异常:${String(err)}` };
    }
    if (res.ok) {
      driven++;
      // 降级标记的 step（如 mermaid 退普通代码块）虽然驱动成功，也提示用户。
      if (step.degraded) warnings.push('有内容以降级形式插入(如 Mermaid 以源码代码块插入,非图)');
    } else if (res.warning) {
      warnings.push(res.warning);
    }
    await sleep(STEP_SETTLE_MS); // 每步喘息，等 X 异步渲染/光标复位（待实机校准）
  }

  // 红线：到此为止。绝不点 Publish —— 用户在 X 编辑器里看成品、调整、手动发布。
  return {
    success: true,
    drivenSteps: driven,
    warnings: warnings.length ? warnings : undefined,
  };
}
