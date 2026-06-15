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

// ───────────────────────────────────────────────────────
// §1.5  「块完成确认」原语(★ 2026-06-14 实测:X Article = DraftJS,块模型铁证)
//   X 正文是 DraftJS:容器 [data-contents="true"],每块 [data-block="true"](有唯一 data-offset-key)。
//   块落定 = [data-block="true"] 计数增加(文字/标题+1、divider+2、table+1、媒体每个+1)。
//   核心架构原则(总指挥):每块必须确认「完整内容真正落进文档」再进下一块,杜绝 fire-and-forget。
// ───────────────────────────────────────────────────────

/** DraftJS 块判据(默认)。未来跨平台:由 profile 提供各自的块 selector(见 blockSelectorOf)。 */
const DEFAULT_BLOCK_SELECTOR = '[data-contents="true"] [data-block="true"]';

/** 取本服务的块 selector(profile 可覆盖;缺省走 DraftJS 默认)。 */
function blockSelectorOf(art: XArticleSelectors): string {
  return art.blockSelector || DEFAULT_BLOCK_SELECTOR;
}

/**
 * 数正文里的块数(DraftJS [data-block="true"])。找不到块容器 → 回退全文档 [data-block="true"]。
 * @returns 块数;查询异常 → -1(表示「数不到」,confirmBlockLanded 据此判不可验)。
 */
function getDataBlockCount(wc: Electron.WebContents, art: XArticleSelectors): Promise<number> {
  const sel = blockSelectorOf(art);
  const script = `
    (function(){
      try {
        var n = document.querySelectorAll(${JSON.stringify(sel)}).length;
        if (n === 0) {
          // 容器没匹配到 → 回退数全文档的 data-block(防 selector 偏差)
          var fb = document.querySelectorAll('[data-block="true"]').length;
          return fb;
        }
        return n;
      } catch(e){ return -1; }
    })();
  `;
  return wc.executeJavaScript(script).then((v) => (typeof v === 'number' ? v : -1)).catch(() => -1);
}

interface ConfirmBlockOpts {
  /** step 执行前的块数基线(getDataBlockCount 取) */
  beforeCount: number;
  /** 期望至少新增几块(文字/latex/code/posts/table+1;divider+2;media+1) */
  minDelta: number;
  /** poll 超时;media 上传慢,放宽 12000 */
  timeoutMs?: number;
  /** 块类型标签(warning 文案用) */
  label: string;
  /** 可选「有内容」验证(table 验 cell 非空 / media 验末块含 img·video)。块数够了但内容没过会续 poll。 */
  verifyContent?: (wc: Electron.WebContents, art: XArticleSelectors) => Promise<boolean>;
}

/**
 * poll 等「块真落定」:块数 ≥ before+minDelta,且(若给)verifyContent 通过。
 * ★ 免疫「waitForSelectorGone 假成功」陷阱:要求计数**真涨上去**;数不到块(-1)→ landed=false(不抛)。
 * @returns { landed, delta, contentOk } —— landed=块数够;contentOk=内容验证过(无验证则随 landed)。
 */
async function confirmBlockLanded(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  opts: ConfirmBlockOpts,
): Promise<{ landed: boolean; delta: number; contentOk: boolean }> {
  const timeout = opts.timeoutMs ?? DEFAULT_WAIT_MS;
  const start = Date.now();
  let lastDelta = -1;
  while (Date.now() - start < timeout) {
    const cur = await getDataBlockCount(wc, art);
    if (cur >= 0) {
      lastDelta = cur - opts.beforeCount;
      if (lastDelta >= opts.minDelta) {
        if (!opts.verifyContent) return { landed: true, delta: lastDelta, contentOk: true };
        const ok = await opts.verifyContent(wc, art).catch(() => false);
        if (ok) return { landed: true, delta: lastDelta, contentOk: true };
        // 块到了但内容没验过(异步渲染)→ 续 poll
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { landed: lastDelta >= opts.minDelta, delta: lastDelta, contentOk: false };
}

/** 内容验证:正文里最后一个 <table> 至少有一个 cell 非空(验"有内容"而非空表)。 */
function verifyTableContent(wc: Electron.WebContents, _art: XArticleSelectors): Promise<boolean> {
  void _art;
  return wc
    .executeJavaScript(`
      (function(){
        try {
          var ts = document.querySelectorAll('table');
          if (!ts.length) return false;
          var t = ts[ts.length-1];
          var cells = t.querySelectorAll('td, th');
          for (var i=0;i<cells.length;i++){ if ((cells[i].textContent||'').trim().length>0) return true; }
          return false;
        } catch(e){ return false; }
      })();
    `)
    .then((v) => !!v)
    .catch(() => false);
}

/** 内容验证:正文末块(data-block)真含 img/video 且 src 非空(验"图块真落进文档")。 */
function verifyMediaContent(wc: Electron.WebContents, art: XArticleSelectors): Promise<boolean> {
  const sel = blockSelectorOf(art);
  return wc
    .executeJavaScript(`
      (function(){
        try {
          var blocks = document.querySelectorAll(${JSON.stringify(sel)});
          if (!blocks.length) return false;
          // 末块或其后若干块里找媒体(媒体块后常自动补空文字块,故扫末尾几块)
          for (var i=blocks.length-1; i>=0 && i>=blocks.length-3; i--){
            var m = blocks[i].querySelector('img, video');
            if (m){ var s = m.src || m.currentSrc || ''; if (s) return true; }
          }
          return false;
        } catch(e){ return false; }
      })();
    `)
    .then((v) => !!v)
    .catch(() => false);
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
 * 完整人工鼠标序列点一个 selector(X 表格网格按钮等需 hover+full mouse 序列才提交,光 .click() 不行)。
 * 在元素中心派发 pointerover→…→pointerdown→mousedown→pointerup→mouseup→click。
 */
function mouseClickSelector(wc: Electron.WebContents, selector: string): Promise<boolean> {
  const script = `
    (function() {
      var sel = ${JSON.stringify(selector)};
      var parts = sel.split(',').map(function(s){return s.trim();}).filter(Boolean);
      var el = null;
      for (var i=0;i<parts.length;i++){ try { el = document.querySelector(parts[i]); } catch(e){} if (el) break; }
      if (!el) return false;
      try { el.scrollIntoView({block:'center'}); } catch(e){}
      var r = el.getBoundingClientRect(), cx = r.left+r.width/2, cy = r.top+r.height/2;
      ['pointerover','mouseover','mouseenter','mousemove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){
        try { el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,clientX:cx,clientY:cy,button:0})); } catch(e){}
      });
      return true;
    })();
  `;
  return wc.executeJavaScript(script).then((v) => !!v).catch(() => false);
}

/**
 * 在 menuItem/容器列表里按**可见文本**匹配并点击(纯 CSS 选不中文本)。
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
  // ★★ 嵌入块边界修(2026-06-14 实机截图铁证):正文末尾若是**嵌入块**(table/figure/img/hr/Mermaid 图卡),
  //   collapse(false) 把光标落进了那个嵌入块**内部**末尾 → 下一段 html 粘进嵌入块里(表格内容泄漏出框)、
  //   或紧贴嵌入块致首块 <h?> 标题被 X 并进上一块(标题被吞/降级正文)。三个症状(五级标题降级/六级标题消失/
  //   七级标题降级+表格文字泄漏)同源。修法:像人一样在文末「按一次回车」起一个**正文顶层空段落**,让光标落在
  //   嵌入块之后的独立段落里,下一段从干净的顶层块开始。仅当末块是非段落嵌入块时补,避免累积空行。
  await ensureTrailingParagraph(wc, art);
}

/**
 * 确保正文末尾是一个**正文顶层空段落**(光标落在其中),而非嵌入块内部。
 *
 * ★ 2026-06-14 重写(六级标题被吞 bug 根治):X = DraftJS,正文每块是 `[data-block="true"]`,
 *   顶层 wrapper 永远是 `<div>`(块类型在内层)。旧版用 `lastElementChild` 下钻 + `/^(P|H1..H6)$/`
 *   判据**永久失配**(DraftJS 不用裸 <p><h6>),误判末块、累积空行、紧跟媒体块的标题被吞。
 *   新判据:直接取最后一个 `[data-block="true"]`;**仅当末块是嵌入块**(SECTION 或内部含
 *   img/video/table/hr/svg/figure)才补一次空段;文字块(空或非空)一律不补 → 媒体块后另起干净段落,
 *   后续标题从顶层落,不被吞。
 */
async function ensureTrailingParagraph(wc: Electron.WebContents, art: XArticleSelectors): Promise<void> {
  const blockSel = blockSelectorOf(art);
  const needNewline = (await wc
    .executeJavaScript(`
      (function(){
        try {
          var blocks = document.querySelectorAll(${JSON.stringify(blockSel)});
          if (!blocks.length) {
            // 没找到 DraftJS 块 → 回退全文档
            blocks = document.querySelectorAll('[data-block="true"]');
          }
          if (!blocks.length) return false; // 真没块 → 不补(避免乱补)
          var last = blocks[blocks.length-1];
          // 末块是嵌入块(媒体/表/分割线):tagName SECTION,或内部含 img/video/table/hr/svg/figure → 需补空段
          var isEmbed = last.tagName === 'SECTION'
            || !!last.querySelector('img, video, table, hr, svg, figure');
          // 文字块(DIV/含文本,空或非空)→ 不补:粘下一块由 driveHtml 的 <p><br></p> 分隔另起
          return isEmbed;
        } catch(e){ return false; }
      })();
    `)
    .catch(() => false)) as boolean;
  if (!needNewline) return;
  // 文末模拟「按回车」:先确保光标在 body 末尾,再 dispatch Enter keydown(X 的编辑器据此另起顶层段落)。
  await wc.executeJavaScript(`
    (function(){
      try {
        var el = document.querySelector(${JSON.stringify(art.body)});
        if (!el) return false;
        el.focus();
        var range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        var target = (sel.anchorNode && sel.anchorNode.nodeType===1 ? sel.anchorNode : el);
        ['keydown','keypress','keyup'].forEach(function(t){
          el.dispatchEvent(new KeyboardEvent(t,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
        });
        return true;
      } catch(e){ return false; }
    })();
  `).catch(() => false);
  await sleep(200);
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
  labelCandidates?: readonly string[],
): Promise<string | null> {
  void _modalInputSelector;
  // 确认按钮文案:默认 modalButtonLabels.update(="Insert");个别模态文案不同可传 labelCandidates
  //   覆盖(★ 实测:Table 的 Markdown 模态底部按钮是 "Update" 不是 "Insert" → 表格传 ['Update','Insert'])。
  const labels = labelCandidates ?? [art.modalButtonLabels.update];
  // 点确认 + 等模态关。⚠️ 可靠性:点一次没关(点空/Insert 钮还没 enable)→ **重试一次**再判失败,
  //   避免「点 Insert 那一下偶发没命中」造成的假失败(时好时坏)。
  for (let attempt = 0; attempt < 2; attempt++) {
    let clicked = false;
    for (const lb of labels) {
      if (await clickByText(wc, art.modalButton, lb, 'Add Media')) { clicked = true; break; }
    }
    if (!clicked) {
      if (attempt === 0) {
        await sleep(300); // 等确认钮 enable 再重试
        continue;
      }
      return `确认按钮(${labels.join('/')})未点中`;
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
  //   若光标在上一块行尾,粘进来的首块会**并进那一行** → 标题黏一起。修法:前置一个分隔段落。
  // ★★ 标题失格修(2026-06-14 实机 __xtest 铁证):前缀**不能用空段落 `<p><br></p>`** —— X(DraftJS)
  //   把空段落和紧跟的 `<h1>/<h2>` 合并,丢掉 heading 格式降级成正文。实测:前缀必须是「有内容的 `<p>`」
  //   才让标题另起块成 Heading(`<p>前置正文</p><h1>X</h1>` ✅ 大标题;`<p><br></p><h1>X</h1>` ❌ 降级)。
  //   故前缀用**零宽字符段落**(U+200B):对 X 是有内容真段落(标题不被并),视觉不可见(不留空行)。
  const ZW_SEP = '<p>' + String.fromCharCode(0x200b) + '</p>'; // 零宽空格占位段落(用 charCode 避免源码不可见字符)
  const plain = '\n' + htmlToPlainText(html);
  const htmlWithSep = ZW_SEP + html;
  // 诊断(table/divider 丢失排查):打印这段 html 的长度 / 是否含 table / 前 80 字。
  console.log(
    `[x-article-driver] driveHtml: len=${html.length} hasTable=${html.includes('<table')} ` +
      `preview="${html.slice(0, 80).replace(/\n/g, ' ')}"`,
  );
  const before = await getDataBlockCount(wc, art);
  const ok = await pasteTextToWebview(wc, art.body, plain, htmlWithSep);
  console.log(`[x-article-driver] driveHtml paste ${ok ? '成功' : '失败'}`);
  if (!ok) return { ok: false, warning: '正文文字段落粘贴未落地' };
  // 块落地后验:html 段至少新增 1 块(可能 +N,minDelta=1 即算落地;免 paste 返成功但 DraftJS 没收进)。
  const landed = await confirmBlockLanded(wc, art, { beforeCount: before, minDelta: 1, label: 'html' });
  if (!landed.landed) return { ok: true, warning: 'X块[html]粘贴后块数未增(内容可能丢失,请在 X 手动核对)' };
  return { ok: true };
}

/** LaTeX:Insert→LaTeX→填 latex→Update。 */
async function driveLatex(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  latex: string,
): Promise<StepResult> {
  const before = await getDataBlockCount(wc, art);
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
  // 块落地后验:模态关 ≠ 公式块真插入。
  const landed = await confirmBlockLanded(wc, art, { beforeCount: before, minDelta: 1, label: 'latex' });
  if (!landed.landed) return { ok: true, warning: 'X块[latex]模态已关但块数未增(公式可能未插入,请在 X 手动核对)' };
  return { ok: true };
}

/** Code:Insert→Code→填语言+代码→Update。 */
async function driveCode(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  language: string,
  code: string,
): Promise<StepResult> {
  const before = await getDataBlockCount(wc, art);
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
  // 块落地后验:模态关 ≠ 代码块真插入。
  const landed = await confirmBlockLanded(wc, art, { beforeCount: before, minDelta: 1, label: 'code' });
  if (!landed.landed) return { ok: true, warning: 'X块[code]模态已关但块数未增(代码可能未插入,请在 X 手动核对)' };
  return { ok: true };
}

/**
 * 解析 markdown 表格 → 行数/列数(数据行含表头;列数取最大列)。用于点 X 的 N×M 网格按钮。
 * X 网格上限 10×10,本函数不夹取(由调用方夹),空表/无效返回 0。
 */
function parseTableSize(markdown: string): { rows: number; cols: number } {
  const lines = markdown.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const dataLines = lines.filter((l) => !/^\|[\s:|-]+\|$/.test(l)); // 去分隔行 | --- |
  const rows = dataLines.length;
  const cols = dataLines.reduce(
    (m, l) => Math.max(m, l.replace(/^\||\|$/g, '').split('|').length),
    0,
  );
  return { rows, cols };
}

/** CSS attribute 值转义(用于 [aria-label="..."],转义引号/反斜杠)。 */
function cssAttrEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/**
 * Table(★★ 2026-06-14 实机【完整链路验证】最终确认正解 —— 见 delivery 文档):
 * X 的 Insert→Table 弹的是**网格模态**(N×M 选行列),**不是** markdown 模态。真正的 markdown
 * 输入口在「插入空表后,点表格的铅笔 Edit block」弹出的**编辑模态**里。完整链路:
 *   ① Insert→Table → ② 点 N×M 网格按钮(插空表,预览态)→ ③ 点新表格的铅笔 Edit block
 *   → ④ 弹出 Markdown 编辑模态(textarea placeholder=""/Markdown·Preview tab)
 *   → ⑤ 覆盖写整段 markdown(原生 value setter+input)→ ⑥ 点 Update。
 * X 据此渲原生表格 + **进文档模型(退出重进不丢)**。
 *
 * 旧坑(已弃):逐格 humanClick 直写 cell.textContent —— DOM 直写不进文档模型 → 退出丢失。
 *
 * ★ 多表格安全:文档可能已有 N 个表格。用 `<table>` 总数 N→N+1 确认新表插入;铅笔/校验都**定位
 *   到最后一个 table**(刚插的那个),不会误点之前已填好的表格。
 */
async function driveTable(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  markdown: string,
): Promise<StepResult> {
  const md = markdown.trim();
  if (!md) return { ok: false, warning: '表格插入失败:markdown 为空' };
  const { rows, cols } = parseTableSize(md);
  if (!rows || !cols) return { ok: false, warning: '表格插入失败:解析不到行列' };
  const GRID_MAX = 10;
  const r = Math.min(rows, GRID_MAX);
  const c = Math.min(cols, GRID_MAX);
  const truncated = rows > GRID_MAX || cols > GRID_MAX;

  console.log(`[x-article-driver] driveTable 开始: ${r}×${c}, md ${md.length} 字`);

  // —— ① 记录插表前的 <table> 数(多表格定位用)——
  const tableCount = (): Promise<number> =>
    wc.executeJavaScript(`document.querySelectorAll('table').length`).then((v) => Number(v) || 0).catch(() => 0);
  const before = await tableCount();

  // —— ② Insert→Table 开网格模态 → 点 N×M 网格按钮插空表 ——
  const opened = await openInsertItem(wc, art, art.menuLabels.table);
  if (opened) return { ok: false, warning: `表格插入失败:${opened}` };
  // 网格按钮 aria-label = "Insert a {rows} by {cols} table"。⚠️ N/M 朝向待定,两向都试。
  const labelRC = art.tableGridCellLabel.replace('{rows}', String(r)).replace('{cols}', String(c));
  const labelCR = art.tableGridCellLabel.replace('{rows}', String(c)).replace('{cols}', String(r));
  const gridSel = `[aria-label="${cssAttrEscape(labelRC)}"], [aria-label="${cssAttrEscape(labelCR)}"]`;
  if (!(await waitForSelector(wc, gridSel, 4000))) {
    await dumpModalControls(wc, 'Table');
    return { ok: false, warning: `表格插入失败:网格按钮 "${labelRC}" 未出现(已 dump DOM 供 spike)` };
  }
  await sleep(STEP_SETTLE_MS);
  if (!(await mouseClickSelector(wc, gridSel))) {
    return { ok: false, warning: '表格插入失败:网格按钮点击未命中' };
  }
  await waitForSelectorGone(wc, art.modalOpenMarker, 3000); // 网格模态关
  // 等 <table> 数 +1(空表落入正文)
  let inserted = false;
  for (let i = 0; i < 15 && !inserted; i++) { await sleep(200); inserted = (await tableCount()) > before; }
  if (!inserted) return { ok: false, warning: '表格插入失败:点网格后正文未多出表格' };
  console.log(`[x-article-driver] driveTable: 空表已插, table ${before}→${before + 1}`);

  // —— ③ 点【最后一个 table】的铅笔 Edit block → 弹 Markdown 编辑模态 ——
  //   多表格安全:激活+找铅笔都只针对最后一个 table(刚插的)。
  if (!(await clickLastTablePencil(wc))) {
    return { ok: false, warning: '表格插入失败:未能点开新表格的 Edit block 铅笔(进不了 Markdown 模态)' };
  }

  // —— ④ 等 Markdown 模态 textarea(模态内、非标题框)——
  if (!(await waitForSelector(wc, art.tableInput, 4000))) {
    await dumpModalControls(wc, 'TableEdit');
    return { ok: false, warning: '表格插入失败:点铅笔后 Markdown 编辑框未出现(已 dump DOM 供 spike)' };
  }

  // —— ⑤ 覆盖写整段 markdown(原生 value setter+input;直接 setter.call 即覆盖旧 | | | | 模板)——
  if (!(await fillModalInput(wc, art.tableInput, md))) {
    return { ok: false, warning: '表格插入失败:markdown 未写入编辑框' };
  }
  console.log('[x-article-driver] driveTable: markdown 已写入,点 Update');
  await sleep(STEP_SETTLE_MS);

  // —— ⑥ 点 Update(模态文案是 "Update";"Insert" 兜底)——
  const confirmed = await confirmModal(wc, art, art.tableInput, ['Update', 'Insert']);
  if (confirmed) return { ok: false, warning: `表格插入失败:${confirmed}` };

  // —— ⑦ 内容验证:确认表格真有内容(非空表)。Update 后 X 渲 markdown 进表格需点时间,verifyTableContent 内部 poll。
  if (!(await verifyTableContent(wc, art))) {
    // 给 X 渲染一点时间再验一次(markdown→table 异步)。
    await sleep(500);
    if (!(await verifyTableContent(wc, art))) {
      return { ok: true, warning: 'X块[table]已插入但未检测到 cell 内容(markdown 格式可能非法,请在 X 手动核对)' };
    }
  }

  if (truncated) {
    return { ok: true, warning: `表格超 10×10 已夹到 ${r}×${c}(X 网格上限),部分行列丢失,请在 X 手动补` };
  }
  return { ok: true };
}

/**
 * 点【正文里最后一个 table】的铅笔(Edit block)进编辑态 —— 多表格安全:先激活最后一个 table 让
 * 其铅笔出现,再点**该 table 关联的** Edit block 按钮(非全局第一个,避免误点前面已填好的表格)。
 */
function clickLastTablePencil(wc: Electron.WebContents): Promise<boolean> {
  const editLabel = 'Edit block';
  return wc
    .executeJavaScript(`
      (function(){
        try {
          var tables = document.querySelectorAll('table');
          if (!tables.length) return false;
          var t = tables[tables.length-1]; // 刚插的那个
          // 激活:完整鼠标序列点 table 中心,让它的工具按钮(铅笔)显示
          var tr = t.getBoundingClientRect(), tcx = tr.left+tr.width/2, tcy = tr.top+tr.height/2;
          ['pointerover','mouseover','mousemove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(tp){
            try { t.dispatchEvent(new MouseEvent(tp,{bubbles:true,cancelable:true,view:window,clientX:tcx,clientY:tcy,button:0})); } catch(e){}
          });
          // 找这个 table 的「Edit block」铅笔:从 table 往上找它所在的块容器,在容器内找按钮;
          //   找不到再退而取全局最后一个可见 Edit block(嵌入块工具条通常紧邻其块,取最后一个 = 新表的)。
          var pencil = null;
          var block = t.closest('[role="group"], figure, [data-block], div');
          var scopes = [];
          // 往上几层都作为候选作用域(X 块结构未知,逐层找)
          var p = t;
          for (var k=0;k<5 && p;k++){ scopes.push(p); p = p.parentElement; }
          for (var s=0;s<scopes.length && !pencil;s++){
            var btns = scopes[s].querySelectorAll('button[aria-label=${JSON.stringify(editLabel)}], [role="button"][aria-label=${JSON.stringify(editLabel)}]');
            if (btns.length) pencil = btns[btns.length-1];
          }
          if (!pencil) {
            var all = document.querySelectorAll('button[aria-label=${JSON.stringify(editLabel)}], [role="button"][aria-label=${JSON.stringify(editLabel)}]');
            var vis = Array.prototype.filter.call(all, function(b){ return b.offsetParent !== null; });
            if (vis.length) pencil = vis[vis.length-1]; // 全局最后一个可见铅笔 = 新表
          }
          if (!pencil) return false;
          var pr = pencil.getBoundingClientRect(), pcx = pr.left+pr.width/2, pcy = pr.top+pr.height/2;
          ['pointerover','mouseover','mousemove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(tp){
            try { pencil.dispatchEvent(new MouseEvent(tp,{bubbles:true,cancelable:true,view:window,clientX:pcx,clientY:pcy,button:0})); } catch(e){}
          });
          return true;
        } catch(e){ return false; }
      })();
    `)
    .then((v) => !!v)
    .catch(() => false);
}

/** Posts:Insert→Posts→填 tweetUrl→(自动嵌或 Update)。 */
async function drivePosts(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  tweetUrl: string,
): Promise<StepResult> {
  const before = await getDataBlockCount(wc, art);
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
  // 块落地后验:框消失 ≠ 推文块落地(URL 无效时框也会收起但无块)。嵌推卡片异步抓取,timeout 放宽。
  const landed = await confirmBlockLanded(wc, art, { beforeCount: before, minDelta: 1, timeoutMs: 8000, label: 'posts' });
  if (!landed.landed) return { ok: true, warning: 'X块[posts]URL 框已关但块数未增(URL 可能被拒,请在 X 手动核对)' };
  return { ok: true };
}

/** Divider:Insert→Divider(仅点击,无模态)。 */
async function driveDivider(
  wc: Electron.WebContents,
  art: XArticleSelectors,
): Promise<StepResult> {
  console.log('[x-article-driver] driveDivider 开始');
  const before = await getDataBlockCount(wc, art);
  const opened = await openInsertItem(wc, art, art.menuLabels.divider, false); // 不弹模态
  if (opened) {
    console.log(`[x-article-driver] driveDivider 失败: ${opened}`);
    return { ok: false, warning: `分割线插入失败:${opened}` };
  }
  // 块落地后验:分割线落定 = 块数 +2(分割线块 + X 自动补的空文字块,实测)。菜单收起 ≠ 真插入。
  const landed = await confirmBlockLanded(wc, art, { beforeCount: before, minDelta: 2, label: 'divider' });
  if (!landed.landed) {
    return { ok: true, warning: 'X块[divider]菜单已收但块数未+2(分割线可能未插入,请在 X 手动核对)' };
  }
  console.log('[x-article-driver] driveDivider 成功');
  return { ok: true };
}

/** Media:Insert→Media→喂文件(网页内 Crop media)。生产入口:media:// → 磁盘路径 → driveMediaWithPath。 */
async function driveMedia(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  mediaUrl: string,
): Promise<StepResult> {
  const filePath = resolveMediaPath(mediaUrl);
  if (!filePath) {
    return { ok: false, warning: `图插入失败:media:// 解析不到本地文件(${mediaUrl})` };
  }
  return driveMediaWithPath(wc, art, filePath);
}

/**
 * Media 主体(喂文件 → 等 Crop 弹 → Save → 等模态关 → 确认块落定)。
 * ★ 入参是**磁盘绝对路径**(不是 media://)—— 生产经 driveMedia 解析后调;测试可直喂绝对路径调
 *   (绕过 resolveMediaPath,实现喂任意本地文件全自动测试)。两路共用此主体,逻辑不漂移。
 *
 * ★ 完成确认(2026-06-14 总指挥架构原则,根治 fire-and-forget):
 *   ① 喂文件后**先等 Crop 模态弹出**再点 Save(旧版盲点 Save,模态没弹就点空);
 *   ② 点 Save 后等模态关(Crop 流程走完);
 *   ③ confirmBlockLanded 等**块数 +1 且末块真含 img/video**(块真落进文档,非 fire-and-forget)。
 */
export async function driveMediaWithPath(
  wc: Electron.WebContents,
  art: XArticleSelectors,
  filePath: string,
): Promise<StepResult> {
  const before = await getDataBlockCount(wc, art);
  const opened = await openInsertItem(wc, art, art.menuLabels.media);
  if (opened) return { ok: false, warning: `图插入失败:${opened}` };
  // 等文件 input 出现(网页内 Crop media,非 OS 框)。
  if (!(await waitForSelector(wc, art.mediaFileInput, 4000))) {
    return { ok: false, warning: '图插入失败:Media 文件 input 未出现(可能弹了 OS 框?待实机)' };
  }
  // 喂文件(CDP setFileInputFiles,绝对路径)。ok 只代表文件喂进 input,落地由下游块确认。
  const fed = await feedFilesToInput(wc, art.mediaFileInput, [filePath]);
  if (!fed.ok) {
    return { ok: false, warning: `图插入失败:${fed.error || '喂文件失败'}` };
  }
  // ① 点 Save 前**先确认 Crop 模态真弹出**(避免盲点空)。没弹 → 可能 X 直接落图,不点 Save,交给 ③ 判。
  if (await waitForSelector(wc, art.modalOpenMarker, 4000)) {
    await clickByText(wc, art.modalButton, art.modalButtonLabels.save, 'Add Media');
    // ② 等 Crop 模态关(落图链路走完)。
    await waitForSelectorGone(wc, art.modalOpenMarker, 8000);
  }
  // ③ 终判:块数 +1 且末块真含 img/video(块真落进文档)。media 上传慢,timeout 放宽。
  const landed = await confirmBlockLanded(wc, art, {
    beforeCount: before,
    minDelta: 1,
    timeoutMs: 12000,
    label: 'media',
    verifyContent: verifyMediaContent,
  });
  if (!landed.landed) {
    return { ok: true, warning: `X块[media]未确认落进正文(块数未增,delta=${landed.delta};可能仍在上传,请在 X 手动确认)` };
  }
  if (!landed.contentOk) {
    return { ok: true, warning: 'X媒体块已落但未确认含图(src 验证未过,请在 X 手动核对)' };
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
/**
 * 准备 Article 驱动上下文:定位 wc + 取 art selector + 打开/确认编辑器就绪。
 * driveArticlePlan 与逐块测试模块(test-drivers.ts)共用,避免重复定位逻辑。
 */
export async function prepareArticleContext(
  serviceId: XServiceId,
  targetWcId?: number,
): Promise<{ wc: Electron.WebContents; art: XArticleSelectors } | { error: string }> {
  const got = await requireXWebContents(serviceId, targetWcId);
  if ('error' in got) return { error: got.error };
  const wc = got.wc;
  const profile = getXServiceProfile(serviceId);
  const art = profile.selectors.article;
  if (!art) return { error: 'X Article selector 未配置(需 spike 后填入 profile)' };
  const ready = await openArticleEditor(wc, art);
  if (!ready) {
    return { error: '该 X 账号可能没有 Article(文章)发布权限,或 X 改版 —— 请确认账号有发文章权限' };
  }
  return { wc, art };
}

/** 测试模块复用:单块驱动 + 干净态 + 块计数,均 export(测试代码隔离在 test-drivers.ts)。 */
export { ensureCleanState, driveStep, getDataBlockCount, confirmBlockLanded, verifyMediaContent, verifyTableContent };
export type { StepResult };

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
