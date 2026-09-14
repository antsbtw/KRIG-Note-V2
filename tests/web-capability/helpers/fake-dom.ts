/**
 * 给 `web.input` 注入脚本用的**最小真 DOM** —— 让脚本真的跑一遍
 *
 * ── 为什么不 mock 一个假 querySelector ──
 * `project-x-inject-template-escape`(采集停摆一整天)的形态是
 * **源码里是对的,求值之后才是错的**:模板字面量吃掉 `\/`,浏览器收到非法正则。
 * 只断言「脚本文本里包含某某字符串」对这类缺陷**零区分力**。
 * 所以这里用 `new Function` 真的求值,并给它一个**行为接近真 DOM** 的对象:
 * `querySelector` / `querySelectorAll` / `getBoundingClientRect` / 事件派发都真的做事。
 *
 * ⚠️ 这不是完整 DOM 实现,只支持被测脚本真正用到的那些:
 * `#id` / `.class` / `tag` / `[attr="v"]` / `tag.class` 组合、逗号分隔多候选、后代空格。
 * 支持不了的写法会**抛错**,不会静默返回空 —— 静默返回空会让测试"绿得毫无意义"。
 */

export type FakeEl = {
  tagName: string;
  attrs: Record<string, string>;
  children: FakeEl[];
  parentElement: FakeEl | null;
  textContent: string;
  value?: string;
  contentEditable?: string;
  /** 派发到这个元素上的事件类型序列 —— 断言「真的点了 / 真的粘了」的依据 */
  events: Array<{ type: string; detail?: unknown }>;
  focused?: boolean;
  scrolled?: boolean;
  clicked?: number;
  getAttribute(name: string): string | null;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  focus(): void;
  click(): void;
  scrollIntoView(): void;
  dispatchEvent(evt: { type: string; detail?: unknown }): boolean;
};

/** 建一个元素。`props` 里可给 textContent / value / contentEditable */
export function el(
  tagName: string,
  attrs: Record<string, string> = {},
  props: Partial<Pick<FakeEl, 'textContent' | 'value' | 'contentEditable'>> = {},
  children: FakeEl[] = [],
): FakeEl {
  const node: FakeEl = {
    tagName: tagName.toUpperCase(),
    attrs,
    children,
    parentElement: null,
    textContent: props.textContent ?? '',
    value: props.value,
    contentEditable: props.contentEditable,
    events: [],
    clicked: 0,
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
    querySelector(sel) {
      return querySelectorAllIn(descendants(this), sel)[0] ?? null;
    },
    querySelectorAll(sel) {
      return querySelectorAllIn(descendants(this), sel);
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 20 };
    },
    focus() {
      this.focused = true;
    },
    click() {
      this.clicked = (this.clicked ?? 0) + 1;
      this.events.push({ type: 'click' });
    },
    scrollIntoView() {
      this.scrolled = true;
    },
    dispatchEvent(evt) {
      this.events.push(evt);
      return true;
    },
  };
  for (const c of children) c.parentElement = node;
  // textContent 未显式给时,由子孙拼出来(贴近真 DOM,contains 校验要用)
  if (props.textContent === undefined && children.length > 0) {
    Object.defineProperty(node, 'textContent', {
      get() {
        return descendants(node).filter((n) => n !== node).map((n) => n.attrs['__text'] ?? '').join('');
      },
      configurable: true,
    });
  }
  return node;
}

function descendants(root: FakeEl): FakeEl[] {
  const out: FakeEl[] = [root];
  for (const c of root.children) out.push(...descendants(c));
  return out;
}

/**
 * 极简 selector 匹配。⚠️ 不支持的语法**抛错** —— 静默返回空会让测试假绿。
 */
function matchesSimple(node: FakeEl, part: string): boolean {
  // 形如 `div.box[data-x="1"]#id` 的组合;后代选择器由调用方拆
  const tokens = part.match(/^[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]/g);
  if (!tokens || tokens.join('') !== part) {
    throw new Error(`[fake-dom] 不支持的 selector 片段: ${part}(测试要扩展 fake-dom,不要绕过)`);
  }
  for (const t of tokens) {
    if (t.startsWith('.')) {
      const classes = (node.attrs['class'] ?? '').split(/\s+/);
      if (!classes.includes(t.slice(1))) return false;
    } else if (t.startsWith('#')) {
      if (node.attrs['id'] !== t.slice(1)) return false;
    } else if (t.startsWith('[')) {
      const m = t.match(/^\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]$/);
      if (!m) throw new Error(`[fake-dom] 不支持的属性 selector: ${t}`);
      const [, name, want] = m;
      const got = node.attrs[name];
      if (got === undefined) return false;
      if (want !== undefined && got !== want) return false;
    } else {
      if (node.tagName !== t.toUpperCase()) return false;
    }
  }
  return true;
}

/** 在给定候选集合里跑一个(可能带后代空格的)selector */
function querySelectorAllIn(pool: FakeEl[], sel: string): FakeEl[] {
  const parts = sel.trim().split(/\s+/);
  let current = pool;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) {
      current = current.filter((n) => matchesSimple(n, part));
    } else {
      // 后代:在上一轮命中的元素的子孙里找
      const next: FakeEl[] = [];
      for (const anc of current) {
        for (const d of descendants(anc)) {
          if (d !== anc && matchesSimple(d, part) && !next.includes(d)) next.push(d);
        }
      }
      current = next;
    }
  }
  return current;
}

export type FakeDom = {
  root: FakeEl;
  /** 脚本里的 `document` */
  document: Record<string, unknown>;
  /** 脚本里的 `window` */
  window: Record<string, unknown>;
  /** `document.execCommand` 被调用的记录 —— 兜底路径的证据 */
  execCommands: Array<{ name: string; value: unknown }>;
  activeElement: FakeEl | null;
};

/** 用一组顶层元素造一个可求值的 DOM 环境 */
export function makeDom(topLevel: FakeEl[]): FakeDom {
  const root = el('body', {}, {}, topLevel);
  const all = () => descendants(root);
  const execCommands: FakeDom['execCommands'] = [];

  const dom: FakeDom = {
    root,
    execCommands,
    activeElement: null,
    document: {},
    window: {},
  };

  dom.document = {
    body: root,
    get activeElement() {
      return dom.activeElement;
    },
    querySelector(sel: string) {
      return querySelectorAllIn(all(), sel)[0] ?? null;
    },
    querySelectorAll(sel: string) {
      return querySelectorAllIn(all(), sel);
    },
    createRange() {
      return { selectNodeContents() {}, collapse() {} };
    },
    execCommand(name: string, _showUi: boolean, value: unknown) {
      execCommands.push({ name, value });
      return true;
    },
  };

  // 元素的 focus 要能反映到 document.activeElement(press 脚本依赖它)
  for (const node of all()) {
    const orig = node.focus.bind(node);
    node.focus = () => {
      orig();
      dom.activeElement = node;
    };
  }

  dom.window = {
    HTMLTextAreaElement: { prototype: { __kind: 'textarea' } },
    HTMLInputElement: { prototype: { __kind: 'input' } },
    getSelection() {
      return { removeAllRanges() {}, addRange() {} };
    },
  };

  return dom;
}

/**
 * 真求值一段注入脚本。
 *
 * ⚠️ 用 `new Function` —— **脚本文本必须先被 JS 引擎解析**,
 * 于是「求值后不是合法 JS」这类缺陷(那次转义事故)在这里就会当场抛。
 */
export function evalInDom(dom: FakeDom, script: string): unknown {
  const fn = new Function(
    'document',
    'window',
    'DataTransfer',
    'ClipboardEvent',
    'Event',
    'InputEvent',
    'MouseEvent',
    'KeyboardEvent',
    'Object',
    // ⚠️ 必须加括号:脚本文本以换行开头,写成 `return\n(function...)` 会被 ASI
    // 在 return 后插分号 —— 结果恒 undefined 而**不报错**,测试会「绿得毫无意义」。
    // (与 dom-script-eval.test.ts 的 `return (${...});` 同一手法)
    `return (${script});`,
  );
  return fn(
    dom.document,
    dom.window,
    FakeDataTransfer,
    FakeClipboardEvent,
    FakeEvent,
    FakeInputEvent,
    FakeMouseEvent,
    FakeKeyboardEvent,
    makeObjectShim(dom),
  );
}

/**
 * `Object` 的 shim —— 只为 `getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')`
 * 这一处。native value setter 那条兜底路径靠它工作,必须真的能被拿到并调用。
 */
function makeObjectShim(dom: FakeDom): typeof Object {
  const shim = Object.create(Object) as typeof Object;
  (shim as unknown as Record<string, unknown>).getOwnPropertyDescriptor = (
    target: unknown,
    prop: string,
  ) => {
    const kind = (target as { __kind?: string })?.__kind;
    if (kind && prop === 'value') {
      return {
        set(this: FakeEl, v: string) {
          this.value = v;
          dom.activeElement = this;
        },
      };
    }
    return Object.getOwnPropertyDescriptor(target as object, prop);
  };
  return shim;
}

class FakeDataTransfer {
  data: Record<string, string> = {};
  setData(type: string, value: string) {
    this.data[type] = value;
  }
  getData(type: string) {
    return this.data[type] ?? '';
  }
}

class FakeEvent {
  type: string;
  constructor(type: string, public init?: Record<string, unknown>) {
    this.type = type;
  }
}
class FakeInputEvent extends FakeEvent {}
class FakeMouseEvent extends FakeEvent {}
class FakeKeyboardEvent extends FakeEvent {
  key?: string;
  constructor(type: string, init?: Record<string, unknown>) {
    super(type, init);
    this.key = init?.key as string | undefined;
  }
}
class FakeClipboardEvent extends FakeEvent {
  clipboardData?: FakeDataTransfer;
  constructor(type: string, init?: Record<string, unknown>) {
    super(type, init);
    this.clipboardData = init?.clipboardData as FakeDataTransfer | undefined;
  }
}
