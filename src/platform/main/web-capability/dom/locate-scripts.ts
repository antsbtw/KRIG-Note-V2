/**
 * 「按坐标定位第几条」的**唯一**实现 —— `web.dom` 预注册脚本(L2 收口第 2 批)
 *
 * ── 要治的病 ──
 *
 * 同一段逻辑在三家 AI extractor 里**各写了一遍**:
 *   `chatgpt-extract-turn.ts` / `claude-extract-turn.ts` —— 逐字节相同,只差 selector 常量
 *   `gemini-extract-turn.ts`  —— 同一件事的简化版
 *
 * ⚠️ 三份都把坐标**直接插进脚本文本**(`${x}` / `${y}`),
 * 正是 `project-x-inject-template-escape` 那一类:
 * 求值后的样子和源码里看到的不一样,而 **tsc 与单测都发现不了**。
 *
 * ⭐ 收进这里之后:参数一律走 `JSON.stringify` **绑定值**,
 * 调用方拿不到脚本字符串,也就拼不出坏脚本(`script-registry.ts` 的两道防线之一)。
 *
 * ── 为什么不复用 `web-service-base/buildHitTestScript` ──
 *
 * 那个只回 boolean(「点中了没有」),这里要的是 **ordinal + preview**
 * (「点中的是第几条 + 它的文字」)—— 提取器靠 ordinal 去对话树里取对应那一轮。
 * 两者用途不同,不是重复。
 */

import type { RegisteredScript, ScriptId, ScriptParams } from './types';
import type { ScriptRegistry } from './script-registry';

export const LOCATE_SCRIPTS = {
  /** 按坐标定位「第几条容器」,返 { ordinal, preview } */
  ordinalByPoint: 'dom.ordinal-by-point' as ScriptId,
} as const;

/** 缺参数就抛,不静默用默认值(那会把「忘了传」变成静默错误) */
function requireNumber(params: ScriptParams, key: string): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`[web.dom] 脚本参数 ${key} 必须是有限数字,收到 ${typeof v}: ${String(v)}`);
  }
  return v;
}

function requireString(params: ScriptParams, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`[web.dom] 脚本参数 ${key} 必须是非空 string,收到 ${typeof v}`);
  }
  return v;
}

/**
 * 邻域回退的两个阈值 —— 三家原实现写死的是同一组值(24 / 240),这里如实保留。
 *
 * ⚠️ 不趁机"优化"成参数:本批是**收口**不是改行为,
 * 阈值一变就分不清「收口出的问题」和「调参出的问题」。
 */
const BAND_PX = 24;
const MAX_DY_PX = 240;

/**
 * 生成脚本:`elementFromPoint(x,y)` → `closest(selector)` → 它在同类节点中的序号。
 *
 * ⭐ 多候选 selector(逗号分隔)按**主选择器优先**合并:
 * 次选择器只补不与主匹配重叠(祖先/后代)的节点,并按 DOM 顺序插入 ——
 * 这段是从 ChatGPT/Claude 两份逐字搬来的,**一个字没改**。
 *
 * ⚠️ 所有外部值都经 `JSON.stringify` 绑定,脚本文本里**没有拼接**。
 */
function buildOrdinalByPoint(params: ScriptParams): string {
  const x = requireNumber(params, 'x');
  const y = requireNumber(params, 'y');
  const selector = requireString(params, 'selector');
  // 可选:命中块上「消息 id」所在的属性名(多个);给了就把命中块(含后代)上这些属性的值收集回去。
  // 空格分隔的多值属性(如 ChatGPT 的 data-chatgpt-search-message-ids)会拆开。
  const idAttrs = params.idAttrs === undefined ? [] : params.idAttrs;
  if (!Array.isArray(idAttrs) || idAttrs.some((a) => typeof a !== 'string' || !/^[\w-]+$/.test(a))) {
    throw new Error('[web.dom] 脚本参数 idAttrs 必须是属性名数组');
  }
  return `(function() {
    var sel = ${JSON.stringify(selector)};
    var ID_ATTRS = ${JSON.stringify(idAttrs)};
    var X = ${JSON.stringify(x)};
    var Y = ${JSON.stringify(y)};
    var BAND = ${JSON.stringify(BAND_PX)};
    var MAXDY = ${JSON.stringify(MAX_DY_PX)};
    var parts = sel.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    // 主选择器匹配优先;次选择器只补不与主匹配重叠(祖先/后代)的节点,按 DOM 顺序插入
    var list = Array.prototype.slice.call(document.querySelectorAll(parts[0]));
    for (var j = 1; j < parts.length; j++) {
      var extra = document.querySelectorAll(parts[j]);
      for (var k = 0; k < extra.length; k++) {
        var dup = false;
        for (var p = 0; p < list.length; p++) {
          if (list[p].contains(extra[k]) || extra[k].contains(list[p])) { dup = true; break; }
        }
        if (dup) continue;
        var inserted = false;
        for (var p2 = 0; p2 < list.length; p2++) {
          if (list[p2].compareDocumentPosition(extra[k]) & Node.DOCUMENT_POSITION_PRECEDING) {
            list.splice(p2, 0, extra[k]); inserted = true; break;
          }
        }
        if (!inserted) list.push(extra[k]);
      }
    }
    var el = document.elementFromPoint(X, Y);
    var hit = null;
    if (list.length === 0) el = null;
    for (var i = 0; i < parts.length && !hit; i++) {
      hit = el && el.closest ? el.closest(parts[i]) : null;
    }
    if (!hit) {
      // 点落在容器间隙:纵向邻域内找最近的那个
      var best = null;
      for (var n = 0; n < list.length; n++) {
        var rect = list[n].getBoundingClientRect();
        var dy = 0;
        if (Y < rect.top) dy = rect.top - Y;
        else if (Y > rect.bottom) dy = Y - rect.bottom;
        var insideBand = Y >= rect.top - BAND && Y <= rect.bottom + BAND;
        if (!insideBand && dy > MAXDY) continue;
        if (!best || dy < best.dy) best = { node: list[n], dy: dy };
      }
      hit = best ? best.node : null;
    }
    if (!hit) {
      // 没点中:把现场带回去(各选择器命中数 + 坐标处元素往上 8 层),否则「页面改版」和「点偏了」分不清
      var counts = parts.map(function(s){ return s + '=' + document.querySelectorAll(s).length; });
      var chain = [];
      for (var c = document.elementFromPoint(X, Y), d = 0; c && c.nodeType === 1 && d < 14; c = c.parentElement, d++) {
        var desc = c.tagName.toLowerCase();
        if (c.id) desc += '#' + c.id;
        var cls = typeof c.className === 'string' ? c.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
        if (cls) desc += '.' + cls;
        for (var a = 0; a < c.attributes.length; a++) {
          var an = c.attributes[a].name;
          if (an.indexOf('data-') === 0 || an === 'role') desc += '[' + an + '=' + String(c.attributes[a].value).slice(0, 40) + ']';
        }
        chain.push(desc);
      }
      return { ordinal: -1, preview: '', miss: { counts: counts, chain: chain, x: X, y: Y, vw: window.innerWidth, vh: window.innerHeight } };
    }
    var text = (hit.innerText || hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    var ids = [];
    for (var ia = 0; ia < ID_ATTRS.length; ia++) {
      var holders = [hit].concat(Array.prototype.slice.call(hit.querySelectorAll('[' + ID_ATTRS[ia] + ']')));
      for (var h = 0; h < holders.length; h++) {
        var raw = holders[h].getAttribute(ID_ATTRS[ia]);
        if (!raw) continue;
        var vs = raw.split(/\\s+/);
        for (var q = 0; q < vs.length; q++) if (vs[q] && ids.indexOf(vs[q]) < 0) ids.push(vs[q]);
      }
    }
    return { ordinal: list.indexOf(hit), preview: text, ids: ids };
  })()`;
}

export const LOCATE_SCRIPT_DEFINITIONS: readonly RegisteredScript[] = [
  {
    id: LOCATE_SCRIPTS.ordinalByPoint,
    purpose: '按 guest 坐标定位「点中的是第几条容器」,返 { ordinal, preview }(三家 AI 提取器共用)',
    build: buildOrdinalByPoint,
  },
];

/** 把本表登记进脚本注册表(由 `wiring/runtime.ts` 在启动时调一次)*/
export function registerLocateScripts(registry: ScriptRegistry): void {
  for (const def of LOCATE_SCRIPT_DEFINITIONS) {
    registry.register(def);
  }
}
