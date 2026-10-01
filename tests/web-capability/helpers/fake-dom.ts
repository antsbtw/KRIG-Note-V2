/**
 * 给注入脚本测试用的 DOM 环境 —— ⭐ **CSS 语义交给 jsdom**,这里只补 jsdom 没有的
 *
 * ── 为什么从手写引擎换成 jsdom(2026-09-30,用户拍板)──
 *
 * 原实现自己写了一个极简 selector 引擎。**五轮独立复核,每一轮都在它里面
 * 抓到语义错,而且每轮修复又引入新错**:
 *
 *  1 轮:`elementFromPoint` 不看 selector / 不看坐标(手写假 DOM 的必然结果)
 *  2 轮:没给 rect 的元素默认占 (0,0,100,20) → **幻影命中区**
 *  3 轮:派生 `textContent` 读一个全仓没人写的 `__text` → 恒空串
 *  4 轮:`el.querySelector` 返回自身;`^=""` / `$=""` 全匹配
 *  5 轮:修 4 轮时引入 —— `[attr=""]` 被一起毙掉;
 *        **Gmail 的 `div[data-message-id] div.ii` 返回 null**(踩中真实业务路径)
 *
 * ⭐ 判断:错**全部**出在「自己实现 CSS 语义」这件事上,而我们还没开始碰
 * Outlook / QQ / 163 的 selector。继续手写 = 继续按轮次出错。
 * → CSS 匹配、后代组合、属性算子、`closest`、文档顺序,**一律交给 jsdom**。
 *
 * ── 这里仍然自己做的三件(jsdom 没有 / 不够)──
 *
 *  ① **几何**:jsdom 的 `getBoundingClientRect` 恒返回全 0、没有
 *     `elementFromPoint`。被测脚本靠几何做命中与邻域回退,必须自己给。
 *     ⭐ 并保留「**没给 rect 就抛错**」—— 编造默认矩形正是幻影命中区的由来。
 *  ② **事件留痕**:`el.events` / `clicked` / `focused` / `scrolled` ——
 *     断言「真的点了 / 真的粘了」的依据,jsdom 不记录这些。
 *  ③ **求值入口**:`evalInDom` 用 `return (${script});` 包住 ——
 *     脚本文本以换行开头,不加括号会被 ASI 切断、**恒返回 undefined 且不报错**。
 *
 * ⚠️ API 一字未改(`el` / `makeDom` / `evalInDom` / `FakeEl` 的字段),
 * 五个测试文件、86 处 `el()` 调用无需改动 —— 换的是引擎不是接口。
 */

import { JSDOM } from 'jsdom';

/** 元素矩形 —— 给 `elementFromPoint` 命中判定用。**不给则读几何即抛**(见下) */
export type FakeRect = { left: number; top: number; width: number; height: number };

/**
 * 测试里持有的元素句柄。
 *
 * ⚠️ 它**包装**一个真的 jsdom `Element`(`node`),CSS 相关的一切走 jsdom;
 * 这里只额外暴露测试要断言的留痕字段。
 */
export type FakeEl = {
  /** 真的 jsdom 元素 —— selector / closest / 文档顺序都由它负责 */
  readonly node: Element;
  readonly tagName: string;
  readonly attrs: Record<string, string>;
  readonly children: FakeEl[];
  parentElement: FakeEl | null;
  textContent: string;
  innerText: string;
  value?: string;
  contentEditable?: string;
  /** 派发到这个元素上的事件类型序列 —— 断言「真的点了 / 真的粘了」的依据 */
  events: Array<{ type: string; detail?: unknown }>;
  focused?: boolean;
  scrolled?: boolean;
  clicked?: number;
  /** ⭐ 是否显式给了 rect —— `elementFromPoint` 只考虑给了的 */
  readonly hasRect: boolean;
  getAttribute(name: string): string | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  getBoundingClientRect(): {
    left: number; top: number; width: number; height: number;
    right: number; bottom: number;
  };
  closest(sel: string): FakeEl | null;
  focus(): void;
  click(): void;
  scrollIntoView(): void;
  dispatchEvent(evt: { type: string; detail?: unknown }): boolean;
};

/** 每个 jsdom 元素 → 它的 FakeEl 句柄。脚本拿到的是 jsdom 元素,断言拿 FakeEl */
const handles = new WeakMap<Element, FakeEl>();

/** 当前焦点元素 —— 由 `.focus()` 维护,`document.activeElement` 读它 */
let activeEl: Element | null = null;

/** 当前活跃的 jsdom 文档 —— `el()` 要用它建元素,`makeDom()` 时重建 */
/**
 * ⚠️ 必须给 `url` —— 不给的话 origin 是 opaque,
 * 任何碰 `localStorage` 的代码会抛 `SecurityError`(实测踩到)。
 */
let activeDoc: Document = makeJsdomDoc();

/** 当前 jsdom window —— `evalInDom` 要从它取 HTMLInputElement 等构造器 */
function activeWin(): Window & typeof globalThis {
  const w = activeDoc.defaultView;
  if (!w) throw new Error('[fake-dom] jsdom window 不见了');
  return w as unknown as Window & typeof globalThis;
}

/**
 * 建一个 jsdom 文档,并**接管 `getBoundingClientRect`**。
 *
 * ⚠️⚠️ 必须接管:jsdom 原生实现**恒返回全 0**(没有布局引擎)。
 * 不接管的话,脚本通过 `document.querySelectorAll` 拿到的元素几何全是 0 ——
 * 于是 `y >= top-24 && y <= bottom+24` 在 y 较小时恒成立,
 * **幻影命中区会换个形式回来**(实测:间隙回退用例与「没 rect 该抛」用例同时失败)。
 *
 * ⭐ 接管后:给了 rect 的返我们的几何,没给的**抛错** ——
 * 与「布局是测试的输入」这条原则一致,且脚本侧与测试侧看到的是同一套语义。
 */
function makeJsdomDoc(): Document {
  const win = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://fake.test/page',
  }).window;
  const proto = win.Element.prototype as unknown as {
    getBoundingClientRect(): unknown;
  };
  proto.getBoundingClientRect = function getRect(this: Element) {
    const h = handles.get(this);
    // body 等非 el() 建的元素:给一个明确的「整页」矩形,不抛
    if (!h) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
    return h.getBoundingClientRect();   // ⭐ 没 rect 时它会抛,这是有意的
  };
  return win.document;
}

/**
 * 没给 `rect` 的元素:**读几何直接抛**,而不是给一个编造的矩形。
 *
 * ── 演进过程(记下来免得有人改回去)──
 *  · 初版 `(0,0,100,20)` → **幻影命中区**:未布局元素都挤在左上角,
 *    实测点 (50,10) 提取到了声明在别处的邮件
 *  · 改 `(0,0,0,0)` → 仍不够:被测脚本的 ±24px 邻域回退把原点附近的它捞回来
 *    (**0 面积 ≠ 不可达**)
 *  · 改远处哨兵 `(-1e6,…)` → 当下无假阴,但「按 top 升序取第一个」
 *    「取最上方」「top<0 判断」这些写法以后都会被它带偏
 *  · ⭐ 终版:**抛错** —— 与「不支持的写法就抛」同一条原则。
 *    要参与几何的元素**必须显式给 rect**:布局是测试的输入,不该由假 DOM 替你猜。
 */
function noRectError(tag: string): never {
  throw new Error(
    `[fake-dom] <${tag}> 没有 rect 却被读取几何 —— 要参与命中/布局判定的元素`
    + '必须显式传 { rect: { left, top, width, height } }。'
    + '(编造一个默认矩形会形成幻影命中区,曾让「点空白处」误提取到别的元素)',
  );
}

/** 建一个元素。`props` 里可给 textContent / value / contentEditable / rect */
export function el(
  tagName: string,
  attrs: Record<string, string> = {},
  props: Partial<Pick<FakeEl, 'textContent' | 'value' | 'contentEditable'>> & { rect?: FakeRect } = {},
  children: FakeEl[] = [],
): FakeEl {
  const node = activeDoc.createElement(tagName);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.appendChild(c.node);
  // ⚠️ 显式 textContent 要在挂子节点**之后**设,否则会被 appendChild 的内容覆盖/反之
  if (props.textContent !== undefined) node.textContent = props.textContent;
  if (props.value !== undefined) node.setAttribute('value', props.value);
  if (props.contentEditable !== undefined) {
    node.setAttribute('contenteditable', props.contentEditable);
    /**
     * ⚠️ jsdom 不把 `contenteditable` **属性**映射成 `el.contentEditable` **性质**
     * (它没实现这个 reflected property)。而被测脚本写的是
     * `el.contentEditable === 'true'`(`input-scripts.ts:115`)——
     * 不补这一步,所有 contenteditable 路径会被判成"既非 input 也非 contenteditable"。
     */
    Object.defineProperty(node, 'contentEditable', {
      value: props.contentEditable, writable: true, configurable: true,
    });
  }

  const handle: FakeEl = {
    node,
    tagName: tagName.toUpperCase(),
    attrs,
    children,
    parentElement: null,
    events: [],
    clicked: 0,
    hasRect: props.rect !== undefined,
    value: props.value,
    contentEditable: props.contentEditable,
    get textContent() { return node.textContent ?? ''; },
    set textContent(v: string) { node.textContent = v; },
    /** innerText 与 textContent 同源 —— 脚本常写 `innerText || textContent` */
    get innerText() { return node.textContent ?? ''; },
    set innerText(v: string) { node.textContent = v; },
    getAttribute(name) { return node.getAttribute(name); },
    // ⭐ selector 全部走 jsdom:后代组合、属性算子、文档顺序都由它保证
    querySelector(sel) { return wrap(node.querySelector(sel)); },
    querySelectorAll(sel) { return Array.from(node.querySelectorAll(sel)).map((n) => mustWrap(n)); },
    closest(sel) { return wrap(node.closest(sel)); },
    getBoundingClientRect() {
      const r = props.rect ?? noRectError(tagName);
      // ⚠️ right/bottom 必须算出来 —— 被测脚本普遍用它们做纵向邻域判定
      return { ...r, right: r.left + r.width, bottom: r.top + r.height };
    },
    focus() { handle.focused = true; activeEl = node; },
    click() { handle.clicked = (handle.clicked ?? 0) + 1; handle.events.push({ type: 'click' }); },
    scrollIntoView() { handle.scrolled = true; },
    dispatchEvent(evt) { handle.events.push(evt); return true; },
  };
  handles.set(node, handle);

  /**
   * ⭐⭐ 在**真 jsdom 节点**上接管四个动作,把留痕记进句柄。
   *
   * ⚠️ 换 jsdom 后脚本拿到的是真元素,它调的是 `node.dispatchEvent(...)`
   * 而不是句柄的方法 —— 不接管的话 `el.events` / `clicked` / `focused`
   * 全程为空,而那是「真的点了 / 真的粘了」的唯一依据
   * (实测:11 条 input 测试同时失败)。
   *
   * ⭐ 仍然调用 jsdom 原生实现(`Reflect.apply`),所以真实的事件传播、
   * `preventDefault`、监听器全都照常工作 —— 只是**顺带记一笔**。
   */
  const nodeAny = node as unknown as Record<string, unknown>;
  const origDispatch = nodeAny.dispatchEvent as (e: unknown) => boolean;
  nodeAny.dispatchEvent = function tracked(this: unknown, e: { type?: string }): boolean {
    handle.events.push({ type: String(e?.type ?? '') });
    return Reflect.apply(origDispatch, this, [e]) as boolean;
  };
  const origFocus = nodeAny.focus as () => void;
  nodeAny.focus = function tracked(this: unknown): void {
    handle.focused = true;
    // ⚠️ jsdom 的 activeElement 不随 .focus() 变(无真实焦点系统),
    // 而脚本写 `document.activeElement || document.body`(input-scripts.ts:310)——
    // 不同步的话 press 会派发到 body 而不是刚 focus 的框。
    activeEl = node;
    Reflect.apply(origFocus, this, []);
  };
  const origClick = nodeAny.click as () => void;
  nodeAny.click = function tracked(this: unknown): void {
    handle.clicked = (handle.clicked ?? 0) + 1;
    handle.events.push({ type: 'click' });
    Reflect.apply(origClick, this, []);
  };
  nodeAny.scrollIntoView = function tracked(): void { handle.scrolled = true; };

  for (const c of children) c.parentElement = handle;
  return handle;
}

function wrap(n: Element | null): FakeEl | null {
  return n ? handles.get(n) ?? null : null;
}

/**
 * ⚠️ jsdom 元素必须有对应句柄 —— 没有说明它不是 `el()` 建的。
 * **抛错不返回 null**:静默跳过会让「脚本查到了东西但测试看不见」。
 */
function mustWrap(n: Element): FakeEl {
  const h = handles.get(n);
  if (!h) throw new Error(`[fake-dom] <${n.tagName}> 不是 el() 建的,没有句柄`);
  return h;
}

export type FakeDom = {
  root: FakeEl;
  /** 脚本里的 `document` */
  document: Record<string, unknown>;
  /** 脚本里的 `window` */
  window: Record<string, unknown>;
  /** `document.execCommand` 被调用的记录 —— 兜底路径的证据 */
  execCommands: Array<{ name: string; value: unknown }>;
  /** 脚本里的 `location` —— 提取类脚本常把 `location.href` 写进结果做留痕 */
  location: { href: string };
  activeElement: FakeEl | null;
};

/** 用一组顶层元素造一个可求值的 DOM 环境 */
export function makeDom(topLevel: FakeEl[]): FakeDom {
  const jsdomDoc = activeDoc;
  const body = jsdomDoc.body;
  while (body.firstChild) body.removeChild(body.firstChild);
  for (const n of topLevel) body.appendChild(n.node);

  const rootHandle = handles.get(body) ?? el('body');
  handles.set(body, rootHandle);

  const execCommands: FakeDom['execCommands'] = [];
  const dom: FakeDom = {
    root: rootHandle,
    execCommands,
    activeElement: null,
    document: {},
    window: {},
    location: { href: 'https://fake.test/page' },
  };

  dom.document = {
    body,
    get activeElement() { return dom.activeElement?.node ?? activeEl; },
    // ⭐ 全部转给 jsdom
    querySelector: (sel: string) => jsdomDoc.querySelector(sel),
    querySelectorAll: (sel: string) => Array.from(jsdomDoc.querySelectorAll(sel)),
    /**
     * ⭐ 按矩形真做命中判定(jsdom 没有这个 API)。
     *
     * ⚠️ **只考虑显式给了 rect 的元素** —— 没给的直接跳过,
     * 既不编造矩形(幻影命中区),也不因为读几何而抛错。
     * ⭐ 真 DOM 语义:点在空白处返回 `<body>` 而不是 null
     * (被测脚本写 `el && el.closest ? … : null`,两条路径不同,不该抹平)。
     */
    elementFromPoint: (x: number, y: number): Element => {
      let hit: Element | null = null;
      for (const n of Array.from(jsdomDoc.body.querySelectorAll('*'))) {
        const h = handles.get(n);
        if (!h?.hasRect) continue;
        const r = h.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = n;
      }
      return hit ?? body;
    },
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    execCommand: (name: string, _ui?: boolean, value?: unknown) => {
      execCommands.push({ name, value });
      return true;
    },
  };
  const win = activeWin();
  dom.window = {
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    /**
     * ⚠️ 脚本读的是 **`window.HTMLTextAreaElement.prototype`**
     * (`input-scripts.ts:182`),不是裸全局 —— 必须挂在这里。
     * ⭐ 用 jsdom 的真构造器:它真的有 `value` 的 descriptor
     * (手写时代要专门做 Object shim)。
     */
    HTMLInputElement: win.HTMLInputElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
  };
  return dom;
}

/**
 * 真的求值一段注入脚本。
 *
 * ⚠️⚠️ **必须加括号** —— 脚本文本以换行开头,写成 `return\n(function…)`
 * 会被 ASI 在 return 后插分号 → **恒返回 undefined 而不报错**,
 * 测试会「绿得毫无意义」。
 */
export function evalInDom(dom: FakeDom, script: string): unknown {
  const win = activeWin();
  const fn = new Function(
    'document', 'window', 'location',
    'DataTransfer', 'ClipboardEvent', 'Event', 'InputEvent', 'MouseEvent', 'KeyboardEvent',
    'Node', 'Object', 'HTMLInputElement', 'HTMLTextAreaElement',
    `return (${script});`,
  );
  return fn(
    dom.document, dom.window, dom.location,
    FakeDataTransfer, FakeClipboardEvent, FakeEvent, FakeInputEvent, FakeMouseEvent, FakeKeyboardEvent,
    // ⭐ 脚本里用 Node.DOCUMENT_POSITION_* 做文档顺序比较
    win.Node,
    Object,
    /**
     * ⭐ native value setter 那条兜底路径要
     * `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')` ——
     * 用 jsdom 的真构造器,它真的有这个 descriptor(手写时代要专门 shim)。
     */
    win.HTMLInputElement,
    win.HTMLTextAreaElement,
  );
}

class FakeDataTransfer {
  private data: Record<string, string> = {};
  setData(type: string, value: string): void { this.data[type] = value; }
  getData(type: string): string { return this.data[type] ?? ''; }
}

class FakeEvent {
  type: string;
  constructor(type: string, _init?: unknown) { this.type = type; }
}
class FakeInputEvent extends FakeEvent {}
class FakeMouseEvent extends FakeEvent {}
class FakeKeyboardEvent extends FakeEvent {}
class FakeClipboardEvent extends FakeEvent {
  clipboardData: FakeDataTransfer;
  constructor(type: string, init?: { clipboardData?: FakeDataTransfer }) {
    super(type);
    this.clipboardData = init?.clipboardData ?? new FakeDataTransfer();
  }
}
