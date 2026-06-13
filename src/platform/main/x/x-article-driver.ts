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
import { pasteTextToWebview, focusInputBox } from '../web-service-base';
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
 * @param excludeAria 命中的元素若 aria-label 等于此值则跳过(用于排除「Insert 触发钮」aria="Add Media"
 *   与模态确认钮文本同为 "Insert" 的碰撞 —— 确认模态时排掉工具栏那个触发钮)。
 */
function clickByText(
  wc: Electron.WebContents,
  containerSelector: string,
  label: string,
  excludeAria?: string,
): Promise<boolean> {
  const script = `
    (function() {
      var sel = ${JSON.stringify(containerSelector)};
      var label = ${JSON.stringify(label)}.toLowerCase();
      var excludeAria = ${JSON.stringify(excludeAria ?? '')}.toLowerCase();
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      // ⚠️⚠️ 写方向最高红线硬守卫:绝不点任何含「发布/Publish/Post」语义的按钮。
      //   X Article 编辑器里 "Publish" 按钮与模态确认钮同在 DOM(spike 实测),
      //   本守卫确保无论传入什么 label,带发布语义文本/aria 的元素一律跳过(双保险)。
      var FORBIDDEN = ['publish','发布','post','发推','tweet'];
      function isForbidden(el, txt){
        var aria = (el.getAttribute('aria-label') || '').toLowerCase();
        for (var k=0;k<FORBIDDEN.length;k++){
          if (txt === FORBIDDEN[k] || aria === FORBIDDEN[k]) return true;
        }
        return false;
      }
      var seen = [];
      for (var i=0;i<parts.length;i++){
        var list;
        try { list = document.querySelectorAll(parts[i]); } catch(e){ continue; }
        for (var j=0;j<list.length;j++){
          var el = list[j];
          if (seen.indexOf(el) !== -1) continue;
          seen.push(el);
          var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (isForbidden(el, txt)) continue; // 红线:跳过发布类按钮
          if (excludeAria) {
            var ea = (el.getAttribute('aria-label') || '').toLowerCase();
            if (ea === excludeAria) continue; // 排除工具栏 Insert 触发钮(aria="Add Media")
          }
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

/**
 * 往**模态里的纯 textarea/input**直接填值(实机日志显示合成 paste 在这些框上不落地、走慢兜底
 * 甚至抛错 → 这些是普通受控 textarea/input,不是 DraftJS;用 React 兼容的 native value setter
 * 直填 + dispatch input 事件最稳)。focus + 设值 + 派发 input/change,React 受控组件能接住。
 */
function fillModalInput(
  wc: Electron.WebContents,
  selector: string,
  text: string,
): Promise<boolean> {
  const script = `
    (function() {
      var sel = ${JSON.stringify(selector)};
      var text = ${JSON.stringify(text)};
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      var el = null;
      for (var i=0;i<parts.length;i++){ try { el = document.querySelector(parts[i]); } catch(e){} if (el) break; }
      if (!el) return false;
      try {
        el.focus();
        var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return (el.value === text);
      } catch(e) { return false; }
    })();
  `;
  return wc.executeJavaScript(script).then((v) => !!v).catch(() => false);
}

// ═══════════════════════════════════════════════════════
// §2  Insert 模态统一编排:点 Insert → 选项 → 等模态 → 填 → Update → 等关闭
// ═══════════════════════════════════════════════════════

/**
 * 打开 Insert 菜单并点某项,**等模态真打开**(以 modalOpenMarker 出现为判据)。失败返回原因。
 * ⚠️ 时序可靠性(2026-06-13 实机修「时好时坏」):全程用 poll 等实际状态,不靠固定 sleep
 *   —— X 异步快慢不定,固定等待赌不准。
 */
/**
 * ★ 串行可靠性根治(2026-06-13 实机:操作时好时坏):**每个 step 前确保「干净态」**。
 *
 * 根因:某 step 中途失败(如模态没关)→ 下一 step 在脏态(模态还开着 / 菜单还弹着)上启动 →
 *   点 Insert 打不开新菜单、填值填错地方 → **级联失败**(前面成、后面一连串崩)。
 *
 * 本守卫:step 开始前,若发现有残留模态(modalOpenMarker 在场)或残留菜单(menuItem 在场),
 *   先关掉(点 app-bar-close,兜底合成 Escape),等其消失,再让 step 开干。让每步从干净态启动、
 *   彼此独立,一步失败不拖垮后面。
 */
async function ensureCleanState(wc: Electron.WebContents, art: XArticleSelectors): Promise<void> {
  // 残留模态 → 关
  if (await selExists(wc, art.modalOpenMarker)) {
    await clickSelector(wc, art.modalOpenMarker); // 点关闭按钮
    if (!(await waitForSelectorGone(wc, art.modalOpenMarker, 2500))) {
      // 兜底:合成 Escape(往 body 派发)
      await wc.executeJavaScript(`
        (function(){
          try {
            var el = document.querySelector(${JSON.stringify(art.body)}) || document.body;
            ['keydown','keyup'].forEach(function(t){
              el.dispatchEvent(new KeyboardEvent(t, { key:'Escape', code:'Escape', keyCode:27, which:27, bubbles:true, cancelable:true }));
            });
          } catch(e){}
        })();
      `).catch(() => {});
      await waitForSelectorGone(wc, art.modalOpenMarker, 2000);
    }
  }
  // 残留菜单 → 点正文收起
  if (await selExists(wc, art.menuItem)) {
    await focusInputBox(wc, art.body);
    await waitForSelectorGone(wc, art.menuItem, 1500);
  }
  // ★ 光标归位(2026-06-13:table 等块插入后光标可能卡在 cell 内 → 后面文字插进表格里/黏连)。
  //   每步前把光标移到**正文最外层末尾**,确保下一块从正文顶层开始,不卡在上一个块(表格/引用)里。
  await wc.executeJavaScript(`
    (function(){
      try {
        var el = document.querySelector(${JSON.stringify(art.body)});
        if (!el) return false;
        el.focus();
        var range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        return true;
      } catch(e){ return false; }
    })();
  `).catch(() => false);
}

async function openInsertItem(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  menuLabel: string,
  expectModal = true,
): Promise<string | null> {
  // 1. 聚焦正文（X 工具栏/Insert 钮通常需正文有焦点才激活）。
  await focusInputBox(wc, art.body);
  // 2. 点 Insert 触发钮
  if (!(await clickSelector(wc, art.insertTrigger))) {
    return 'Insert 触发钮未点中(selector 失效?)';
  }
  // 3. 等菜单项出现(poll,菜单真弹出才点项)
  if (!(await waitForSelector(wc, art.menuItem, 4000))) {
    return 'Insert 菜单未弹出';
  }
  // 4. 按文本点对应项
  if (!(await clickByText(wc, art.menuItem, menuLabel))) {
    return `Insert 菜单项「${menuLabel}」未找到/未点中`;
  }
  // 5. 弹模态的项(LaTeX/Table/Code/Posts/Media)→ 等模态真打开(modalOpenMarker 出现);
  //    不弹模态的项(Divider 直接插)→ 等菜单收起即可。均 poll,不靠固定 sleep。
  if (expectModal) {
    if (await waitForSelector(wc, art.modalOpenMarker, 4000)) return null;
    // ⚠️ 可靠性:点菜单项偶发没命中(菜单动画/重渲)→ 模态没开。**重开一次**:重点 Insert→菜单项。
    if (await clickSelector(wc, art.insertTrigger)) {
      if (await waitForSelector(wc, art.menuItem, 3000)) {
        await clickByText(wc, art.menuItem, menuLabel);
        if (await waitForSelector(wc, art.modalOpenMarker, 4000)) return null;
      }
    }
    return `点了「${menuLabel}」但模态未打开`;
  }
  await waitForSelectorGone(wc, art.menuItem, 3000); // 菜单收起 = Divider 已插
  return null;
}

/**
 * 点模态确认按钮(★ 实测文本是 "Insert"，不是 "Update")并等模态关闭。
 *
 * ⚠️ 碰撞处理:工具栏 Insert 触发钮文本也是 "Insert"(aria="Add Media")→ 确认时
 *   excludeAria="Add Media" 排掉它,只点模态底部那个真正的确认 "Insert"。
 */
async function confirmModal(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  _modalInputSelector: string,
): Promise<string | null> {
  void _modalInputSelector;
  // 点确认 + 等模态关。⚠️ 可靠性:点一次没关(点空/Insert 钮还没 enable)→ **重试一次**再判失败,
  //   避免「点 Insert 那一下偶发没命中」造成的假失败(时好时坏)。
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await clickByText(wc, art.modalButton, art.modalButtonLabels.update, 'Add Media'))) {
      if (attempt === 0) {
        await sleep(300); // 等 Insert 钮 enable 再重试
        continue;
      }
      return '确认按钮(Insert)未点中';
    }
    // 模态关闭判据:modalOpenMarker(app-bar-close)消失(可靠:模态关了关闭按钮就没了)。
    if (await waitForSelectorGone(wc, art.modalOpenMarker, 4000)) return null;
    // 没关 → 再试一次(可能上次 click 落空)
    await sleep(300);
  }
  return '确认后模态未关闭(可能内容非法 / 按钮 disabled)';
}

/**
 * 编辑器就绪判据：**正文区在场**（编辑器的定义性特征）。
 *
 * ⚠️ 故意只 gate 正文区、不 gate Insert 按钮：body/insertTrigger 都是 待spike 猜测 selector，
 *   若 insertTrigger 猜错而强行 gate 它，有权限账号也会被卡在「打开编辑器」这步误判无权限
 *   （这次实机的 false negative 教训）。Insert 按钮真缺 → 留给逐 step 驱动 fail-loud 暴露，
 *   不在「开编辑器」这步一票否决整篇。Insert 在场则记一条 ✓（不影响就绪判定）。
 */
async function articleEditorReady(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  bodyTimeoutMs: number,
): Promise<boolean> {
  return waitForSelector(wc, art.body, bodyTimeoutMs);
}

/**
 * 打开 X Article 空白编辑器并等就绪。
 *
 * ⚠️ 实机修正（2026-06-13，总指挥实测有权限账号被误判无权限）：`/compose/articles` 行为不稳定 ——
 *   **有时直达空白编辑器，有时落 Articles 列表页**（"Drafts/Published/Your drafts live here"，
 *   右上角铅笔=「新建文章」）。原逻辑只等编辑器、等不到就判无权限 → 落列表页时 false negative。
 *
 * 修正流程：
 *  1. 已在 /compose/articles 页则不重载；否则 loadURL(composeUrl)。
 *  2. 先等编辑器就绪（较短窗口 8s）。直达编辑器 → 成功返回。
 *  3. 没直达（落列表页）→ 找「新建文章」按钮（newArticleButton）点它 → 再等编辑器就绪。
 *  4. **只有**「编辑器没出现 **且** 新建按钮也没有」才判无权限（无权限账号既进不了编辑器、
 *     也没有写文章入口）。
 *
 * ⚠️ 红线：loadURL / 点新建 进的都是 draft 编辑器（非发布），不碰写方向红线。
 * @returns true = 编辑器就绪；false = 编辑器 + 新建按钮都没有（大概率无 Article 权限 / X 改版）。
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

  // 2. 先等编辑器直达就绪（较短窗口，留时间给「落列表页→点新建」分支）。
  if (await articleEditorReady(wc, art, 8000)) return true;

  // 3. 没直达 → 大概率落了 Articles 列表页。找「新建文章」按钮点它进编辑器。
  if (await clickSelector(wc, art.newArticleButton)) {
    // 点了新建 → 再等编辑器就绪（这次是从列表页进编辑器）。
    if (await articleEditorReady(wc, art, 8000)) return true;
  }

  // 4. 编辑器没出现、新建按钮也没有/点了也没进。
  //    ★ 诊断（铁律：别猜、看真实数据）：把列表页右上角的候选「可点元素」属性 dump 到日志，
  //    让一次真实运行就暴露那个铅笔的真实 selector（newArticleButton 待 spike，靠这个收敛）。
  await dumpTopRightClickables(wc);
  return false;
}

/**
 * 诊断：dump 当前页右上角（视口右上 1/3 宽、上 1/4 高）的可点元素（button/link/role=button）
 * 的关键属性到主进程日志。用于 spike「新建文章」铅笔的真实 selector（不改任何 DOM，纯读）。
 */
async function dumpTopRightClickables(wc: Electron.WebContents): Promise<void> {
  const script = `
    (function() {
      try {
        var vw = window.innerWidth, vh = window.innerHeight;
        var nodes = document.querySelectorAll('button, a, [role="button"], [role="link"]');
        var out = [];
        for (var i=0;i<nodes.length;i++){
          var el = nodes[i];
          var r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // 只取右上角区域（铅笔在那）
          if (r.left < vw * 0.66 || r.top > vh * 0.25) continue;
          out.push({
            tag: el.tagName.toLowerCase(),
            testid: el.getAttribute('data-testid') || null,
            aria: el.getAttribute('aria-label') || null,
            href: el.getAttribute('href') || null,
            role: el.getAttribute('role') || null,
            text: (el.innerText || el.textContent || '').trim().slice(0, 24) || null,
          });
        }
        return JSON.stringify(out);
      } catch(e) { return '[]'; }
    })();
  `;
  try {
    const raw = (await wc.executeJavaScript(script)) as string;
    console.warn(
      '[x-article-driver] 未找到「新建文章」按钮。Articles 列表页右上角候选可点元素（spike 用，挑铅笔那个把真实 selector 填进 profile.article.newArticleButton）：\n' +
        raw,
    );
  } catch (err) {
    console.warn('[x-article-driver] dumpTopRightClickables 失败:', String(err));
  }
}

/**
 * 诊断：模态没等到输入框时，dump 当前页所有 textarea/input/可点按钮的属性到日志。
 * 用于 spike 各模态(LaTeX/Table/Code/Posts)的真实输入框 placeholder + Update 钮（纯读不改）。
 */
async function dumpModalControls(wc: Electron.WebContents, which: string): Promise<void> {
  const script = `
    (function() {
      try {
        var els = document.querySelectorAll('textarea, input, button, [role="button"]');
        var out = [];
        for (var i=0;i<els.length;i++){
          var el = els[i];
          var r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          out.push({
            tag: el.tagName.toLowerCase(),
            testid: el.getAttribute('data-testid') || null,
            aria: el.getAttribute('aria-label') || null,
            ph: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || null,
            text: (el.innerText || el.textContent || '').trim().slice(0, 24) || null,
          });
        }
        return JSON.stringify(out);
      } catch(e) { return '[]'; }
    })();
  `;
  try {
    const raw = (await wc.executeJavaScript(script)) as string;
    console.warn(
      `[x-article-driver] ${which} 模态输入框未找到。当前页 textarea/input/button 候选(spike 用，挑该模态的输入框/Update 钮把真实 selector 填进 profile.article)：\n` +
        raw,
    );
  } catch (err) {
    console.warn('[x-article-driver] dumpModalControls 失败:', String(err));
  }
}

/**
 * 诊断:dump 正文里最后一个 table 的真实结构(tag / role / cell 标签 / contenteditable),
 * 用于 spike X 表格 cell 的真实 selector(填格失败时调用,纯读不改)。
 */
async function dumpTableStructure(wc: Electron.WebContents): Promise<void> {
  const script = `
    (function() {
      try {
        var tables = document.querySelectorAll('table, [role="table"]');
        if (!tables.length) return JSON.stringify({ noTable: true });
        var t = tables[tables.length - 1];
        // 取表格内前若干可能是 cell 的元素的标签/role/ce 特征
        var sample = [];
        var kids = t.querySelectorAll('*');
        var seen = {};
        for (var i=0;i<kids.length && sample.length<12;i++){
          var el = kids[i];
          var key = el.tagName.toLowerCase() + '|' + (el.getAttribute('role')||'') + '|' + (el.getAttribute('contenteditable')||'');
          if (seen[key]) continue; seen[key] = 1;
          sample.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role')||null, ce: el.getAttribute('contenteditable')||null, testid: el.getAttribute('data-testid')||null, text:(el.innerText||'').trim().slice(0,12)||null });
        }
        return JSON.stringify({ tableTag: t.tagName.toLowerCase(), tableRole: t.getAttribute('role')||null, tableHtml: t.outerHTML.slice(0, 600), distinctChildren: sample });
      } catch(e){ return JSON.stringify({ err: String(e) }); }
    })();
  `;
  try {
    const raw = (await wc.executeJavaScript(script)) as string;
    console.warn(
      '[x-article-driver] 表格 cell 未就绪/结构不符。正文最后一个 table 真实结构(spike 用,挑 cell 的真实 selector)：\n' +
        raw,
    );
  } catch (err) {
    console.warn('[x-article-driver] dumpTableStructure 失败:', String(err));
  }
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
  // ★ 段落黏连修(2026-06-13 实机:相邻 html 段/标题被黏成一坨):X 把 HTML 粘到正文**当前光标处**,
  //   若光标在上一块行尾,粘进来的首块会**并进那一行** → 标题黏一起。
  //   修法:**把空段落分隔直接拼进同一次 paste**(text/html 前置 `<p><br></p>`,text/plain 前置 `\n`),
  //   X 收到时先起新块再放正文 → 不黏连。**单次 paste**(不再双 paste 抢焦点,那会扰乱时序 = 可靠性问题)。
  const plain = '\n' + htmlToPlainText(html);
  const htmlWithSep = '<p><br></p>' + html;
  // 诊断(table/divider 丢失排查):打印这段 html 的长度 / 是否含 table / 前 80 字。
  console.log(
    `[x-article-driver] driveHtml: len=${html.length} hasTable=${html.includes('<table')} ` +
      `preview="${html.slice(0, 80).replace(/\n/g, ' ')}"`,
  );
  const ok = await pasteTextToWebview(wc, art.body, plain, htmlWithSep);
  console.log(`[x-article-driver] driveHtml paste ${ok ? '成功' : '失败'}`);
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
    await dumpModalControls(wc, 'LaTeX');
    return { ok: false, warning: '公式插入失败:LaTeX 模态输入框未出现(已 dump DOM 到日志供 spike)' };
  }
  if (!(await fillModalInput(wc, art.latexInput, latex))) {
    return { ok: false, warning: '公式插入失败:latex 未填入' };
  }
  await sleep(STEP_SETTLE_MS);
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
    await dumpModalControls(wc, 'Code');
    return { ok: false, warning: '代码插入失败:Code 模态未出现(已 dump DOM 到日志供 spike)' };
  }
  // 语言:有则填语言搜索框(可空 —— X 找不到语言就无高亮,非阻断)。
  if (language && (await selExists(wc, art.codeLangInput))) {
    await fillModalInput(wc, art.codeLangInput, language);
    await sleep(STEP_SETTLE_MS); // 等语言下拉过滤
    // ⚠️ 待实机:语言可能需从下拉选中(再点一下首选项)。本期只填搜索框,选中待 spike。
  }
  if (!(await fillModalInput(wc, art.codeInput, code))) {
    return { ok: false, warning: '代码插入失败:源码未填入' };
  }
  await sleep(STEP_SETTLE_MS);
  const confirmed = await confirmModal(wc, art, art.codeInput);
  if (confirmed) return { ok: false, warning: `代码插入失败:${confirmed}` };
  return { ok: true };
}

/**
 * 解析 markdown 表格 → 行数/列数 + 单元格文本(去掉分隔行 `| --- |`)。
 * 行数 = 数据行（含表头）数；列数 = 最大列数。X 网格上限 10×10,超出夹到 10 并标警告。
 */
function parseMarkdownTable(markdown: string): { rows: number; cols: number; cells: string[][] } {
  const lines = markdown.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  // 去掉分隔行(全是 --- / : / | / 空白)
  const dataLines = lines.filter((l) => !/^\|[\s:|-]+\|$/.test(l));
  const cells = dataLines.map((l) =>
    l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()),
  );
  const rows = cells.length;
  const cols = cells.reduce((m, r) => Math.max(m, r.length), 0);
  return { rows, cols, cells };
}

/**
 * Table(★ 实测:不是填 markdown,是网格选行列):Insert→Table→点 "Insert a {rows} by {cols} table"
 * 网格按钮 → X 在正文插入对应尺寸空表 → 逐格 Tab+paste 填内容(best-effort)。
 */
async function driveTable(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  markdown: string,
): Promise<StepResult> {
  const { rows, cols, cells } = parseMarkdownTable(markdown);
  if (rows === 0 || cols === 0) return { ok: false, warning: '表格插入失败:解析不到行列' };
  const GRID_MAX = 10;
  const r = Math.min(rows, GRID_MAX);
  const c = Math.min(cols, GRID_MAX);
  const truncated = rows > GRID_MAX || cols > GRID_MAX;

  const opened = await openInsertItem(wc, art, art.menuLabels.table);
  if (opened) return { ok: false, warning: `表格插入失败:${opened}` };

  // 网格按钮 aria-label: "Insert a {rows} by {cols} table"。⚠️ "N by M" 的 N/M 究竟是
  //   行×列还是列×行待实机 —— 故两种朝向都试(先 r×c 后 c×r),命中即点。
  const labelRC = art.tableGridCellLabel.replace('{rows}', String(r)).replace('{cols}', String(c));
  const labelCR = art.tableGridCellLabel.replace('{rows}', String(c)).replace('{cols}', String(r));
  if (!(await waitForSelector(wc, `[aria-label="${cssEscape(labelRC)}"], [aria-label="${cssEscape(labelCR)}"]`, 4000))) {
    await dumpModalControls(wc, 'Table');
    return { ok: false, warning: `表格插入失败:Table 网格未出现 / 无 "${labelRC}" 格(已 dump DOM 供 spike)` };
  }
  if (!(await clickSelector(wc, `[aria-label="${cssEscape(labelRC)}"], [aria-label="${cssEscape(labelCR)}"]`))) {
    return { ok: false, warning: `表格插入失败:网格 "${labelRC}" 未点中` };
  }
  // 等模态关闭(网格点完模态就关)+ 等正文里表格真出现 —— 不靠固定 sleep。
  await waitForSelectorGone(wc, art.modalOpenMarker, 5000);
  if (!(await waitForSelector(wc, 'table, [role="table"]', 5000))) {
    return { ok: true, warning: '表格网格已点但正文未见表格(请在 X 手动核对)' };
  }
  // ⚠️ 表格出现 ≠ 单元格渲染好:再 poll 等「表格里出现可编辑 cell」(X 异步建 cell),否则填空。
  if (!(await waitForSelector(wc, 'table td, table th, [role="table"] [role="cell"], [role="table"] [contenteditable="true"]', 4000))) {
    await dumpTableStructure(wc); // dump 真实 cell DOM 供 spike
    return { ok: true, warning: '表格已插入但单元格未就绪/结构不符(已 dump DOM 到日志供 spike,请在 X 手动填)' };
  }
  await sleep(300); // 给 cell 渲染稳定

  // 逐格填内容:定位正文里刚插入的表格各 cell 直填(best-effort,失败只 warn)。
  const filled = await fillTableCells(wc, cells);
  if (truncated) {
    return { ok: true, warning: `表格超 10×10 已夹到 ${r}×${c}(X 网格上限),部分行列丢失,请在 X 手动补` };
  }
  if (!filled) {
    return { ok: true, warning: '表格已插入但单元格内容可能未全填入,请在 X 手动核对' };
  }
  return { ok: true };
}

/** CSS attribute 值转义(用于 [aria-label="..."]，转义引号/反斜杠)。 */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/**
 * 逐格填表内容:**定位正文里最后一个插入的 table 的各 cell**(td/th/[role=cell]),按行主序
 * 把文本写进每个 cell 的 contenteditable —— 比「焦点+Tab+合成paste」稳(实机那条 paste 不落地)。
 *
 * 每 cell:聚焦 → 把光标放进去 → execCommand insertText(contenteditable 友好) + 直写 textContent 兜底。
 * @returns 实际填到的 cell 数 ≥ 期望数则 true(best-effort,X cell DOM 待实机,失败只 warn)。
 */
async function fillTableCells(
  wc: Electron.WebContents,
  cells: string[][],
): Promise<boolean> {
  // 把二维 cells 拍平成行主序文本数组(空串也占位,保持 cell 对位)。
  const flat: string[] = [];
  for (const row of cells) for (const cell of row) flat.push(cell);
  const script = `
    (function() {
      var texts = ${JSON.stringify(flat)};
      // 取正文里最后一个 table(刚插入的那个)。多候选:table / [role=table]。
      var tables = document.querySelectorAll('table, [role="table"]');
      if (!tables.length) return { ok:false, reason:'no-table', filled:0 };
      var table = tables[tables.length - 1];
      // cell 候选:td/th 优先,其次 role=cell/gridcell,再次 contenteditable 叶子。
      var cells = table.querySelectorAll('td, th, [role="cell"], [role="gridcell"]');
      if (!cells.length) cells = table.querySelectorAll('[contenteditable="true"]');
      var n = Math.min(cells.length, texts.length);
      var filled = 0;
      for (var i=0;i<n;i++){
        var text = texts[i];
        if (!text) { filled++; continue; }
        var cell = cells[i];
        // 真正可编辑的目标:cell 自身或其内的 contenteditable
        var editable = (cell.getAttribute('contenteditable') === 'true') ? cell
                      : (cell.querySelector('[contenteditable="true"]') || cell);
        try {
          editable.focus();
          // 光标置入
          var range = document.createRange(); range.selectNodeContents(editable); range.collapse(false);
          var selc = window.getSelection(); selc.removeAllRanges(); selc.addRange(range);
          var done = false;
          try { done = document.execCommand('insertText', false, text); } catch(e){}
          if (!done || (editable.innerText||'').trim() === '') {
            // 兜底:合成 paste(DraftJS cell 认)+ 直写
            try {
              var dt = new DataTransfer(); dt.setData('text/plain', text);
              editable.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles:true, cancelable:true }));
            } catch(e){}
            if ((editable.innerText||'').trim() === '') { editable.textContent = text; editable.dispatchEvent(new Event('input',{bubbles:true})); }
          }
          filled++;
        } catch(e) {}
      }
      return { ok: filled >= n, filled: filled, cells: cells.length, want: texts.length };
    })();
  `;
  try {
    const res = (await wc.executeJavaScript(script)) as { ok: boolean; filled?: number; cells?: number; want?: number; reason?: string };
    if (!res?.ok) {
      console.warn(`[x-article-driver] 表格填格不全/失败:`, JSON.stringify(res));
    }
    return !!res?.ok;
  } catch (err) {
    console.warn('[x-article-driver] fillTableCells 异常:', String(err));
    return false;
  }
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
    await dumpModalControls(wc, 'Posts');
    return { ok: false, warning: '嵌推插入失败:Posts 模态(URL 输入框)未出现(已 dump DOM 到日志供 spike)' };
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

/** Divider:Insert→Divider(仅点击,无模态)。 */
async function driveDivider(
  wc: Electron.WebContents,
  art: XArticleSelectors,
): Promise<StepResult> {
  console.log('[x-article-driver] driveDivider 开始');
  const opened = await openInsertItem(wc, art, art.menuLabels.divider, false); // 不弹模态
  if (opened) {
    console.log(`[x-article-driver] driveDivider 失败: ${opened}`);
    return { ok: false, warning: `分割线插入失败:${opened}` };
  }
  console.log('[x-article-driver] driveDivider 成功');
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
  // 喂文件。⚠️ 不传 thumb selector(传 undefined):X Article 喂图后走「网页内 Crop media」
  //   流程,图不会立刻以 <figure>/<img> 落进正文 → 用发推那套缩略图判据会误判失败(实机暴露
  //   "uploadedMediaThumb 失效")。这里只让 CDP 把文件喂进 input(setFileInputFiles 成功即文件已交),
  //   落图校验改由下面的 Crop→Save + 软校验处理。
  const fed = await feedFilesToInput(wc, art.mediaFileInput, [filePath]);
  if (!fed.ok) {
    return { ok: false, warning: `图插入失败:${fed.error || '喂文件失败'}` };
  }
  // Crop media 界面:点 Save 落图 → **等模态(app-bar-close)关闭**(确保落图完才下一步,不靠固定 sleep)。
  await clickByText(wc, art.modalButton, art.modalButtonLabels.save, 'Add Media');
  if (!(await waitForSelectorGone(wc, art.modalOpenMarker, 8000))) {
    // 模态没关:可能 Save selector 待校 / Crop 界面没收 → warn 不阻断(文件已喂进)。
    return { ok: true, warning: '图已喂入但 Crop 界面未关闭(请在 X 手动确认 Save / 缩略图判据待实机校)' };
  }
  // 软校验:正文里是否出现图。
  if (art.mediaInsertedThumb && !(await selExists(wc, art.mediaInsertedThumb))) {
    return { ok: true, warning: '图已喂入但未确认落进正文(缩略图判据待实机校)' };
  }
  return { ok: true };
}

/** 分发一个 step（执行）。 */
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

  // 2. 正文：逐 step 驱动。
  //    ⚠️ 架构回退(2026-06-13:正文计数/指纹验证信号不可靠 —— measureBody 量不准 X 的异步/虚拟
  //    渲染正文,执行明明成功也判失败 → 白重试 3 次 + 重复插。坏验证比不验更糟,故撤掉「正文验证
  //    重试闭环」)。保留**可靠的部分**:`ensureCleanState`(防残留模态级联)+ 模态开/关的局部重试
  //    (基于 modalOpenMarker 这个可靠信号,不依赖正文验证)。每步失败 fail loud,不中断整篇。
  let driven = 0;
  for (const step of plan.steps) {
    let res: StepResult;
    try {
      await ensureCleanState(wc, art); // 干净态进入,防上一步残留拖垮这步
      res = await driveStep(wc, art, step);
    } catch (err) {
      res = { ok: false, warning: `驱动异常:${String(err)}` };
    }
    if (res.ok) {
      driven++;
      if (step.degraded) warnings.push('有内容以降级形式插入(如 Mermaid 以源码代码块插入,非图)');
      if (res.warning) warnings.push(res.warning);
    } else if (res.warning) {
      warnings.push(res.warning);
    }
    await sleep(STEP_SETTLE_MS);
  }

  // 红线：到此为止。绝不点 Publish —— 用户在 X 编辑器里看成品、调整、手动发布。
  return {
    success: true,
    drivenSteps: driven,
    warnings: warnings.length ? warnings : undefined,
  };
}
