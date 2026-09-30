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
  getBoundingClientRect(): {
    left: number; top: number; width: number; height: number;
    right: number; bottom: number;
  };
  /** 最近的匹配祖先(含自身)。⚠️ 真 DOM 语义:自身也算 */
  closest(sel: string): FakeEl | null;
  /** 渲染后文本。假 DOM 里等同 textContent,供脚本两种取法都能拿到 */
  innerText: string;
  focus(): void;
  click(): void;
  scrollIntoView(): void;
  dispatchEvent(evt: { type: string; detail?: unknown }): boolean;
};

/** 建一个元素。`props` 里可给 textContent / value / contentEditable */
/** 元素矩形 —— 给 `elementFromPoint` 命中判定用。**不给则不可命中**(见下) */
export type FakeRect = { left: number; top: number; width: number; height: number };

/**
 * ⭐ 「没有布局」的哨兵矩形 —— 远在坐标系之外且 0 面积。
 *
 * 任何正常坐标都命中不了它,任何合理的邻域回退(本仓脚本用 ±24 / ±240)
 * 也捞不到它。⚠️ 别改成 (0,0,*) 之类:那会在原点形成幻影命中区。
 */
const UNPOSITIONED_RECT: FakeRect = { left: -1e6, top: -1e6, width: 0, height: 0 };

export function el(
  tagName: string,
  attrs: Record<string, string> = {},
  props: Partial<Pick<FakeEl, 'textContent' | 'value' | 'contentEditable'>> & { rect?: FakeRect } = {},
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
      /**
       * ⚠️⚠️ **没给 rect 的元素必须不可命中** —— 2026-09-30 复核抓到:
       * 原来默认 `(0,0,100,20)`,于是**每个没给矩形的元素都在左上角形成幻影命中区**。
       * 实测点 `(50,10)` 会提取到一封声明在 `y=300` 的邮件,
       * 而真浏览器该报 `__noMail`。假 DOM 比被测代码更宽松 = 测试失去区分力。
       *
       * ⚠️ 第一次修成 `(0,0,0,0)` **仍然不够**:`elementFromPoint` 确实挡住了,
       * 但被测脚本的「±24px 纵向邻域回退」把坐标 (0,0) 附近的它**捞了回来**
       * (`y=10` 落在 `[0-24, 0+24]` 内)。0 面积 ≠ 不可达。
       *
       * ⭐ 改用一个**远在坐标系之外**的哨兵矩形:既不可能被 elementFromPoint 命中,
       * 也不可能落进任何合理的邻域回退。要参与命中的元素**必须显式给 rect** ——
       * 这正是我们要的:布局是测试的输入,不该由假 DOM 替你猜。
       */
      const r = props.rect ?? UNPOSITIONED_RECT;
      // ⚠️ right/bottom 必须算出来 —— 被测脚本普遍用它们做纵向邻域判定
      return { ...r, right: r.left + r.width, bottom: r.top + r.height };
    },
    /**
     * ⭐ 真 DOM 语义:**从自身开始**向上找第一个匹配的,找不到返回 null。
     * ⚠️ 不许"自身不算" —— 被测脚本依赖 `el.closest(sel)` 在点中容器本体时命中。
     */
    closest(sel) {
      let cur: FakeEl | null = this;
      while (cur) {
        for (const part of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
          if (matchesSimple(cur, part)) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
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
  // innerText 与 textContent 同源 —— 脚本常写 `innerText || textContent`,两者都要有
  Object.defineProperty(node, 'innerText', {
    get() { return node.textContent; },
    configurable: true,
  });
  for (const c of children) c.parentElement = node;
  /**
   * textContent 未显式给时,由**子节点的 textContent** 拼出来。
   *
   * ⚠️⚠️ 原实现读的是 `n.attrs['__text']` —— 而**全仓没有任何地方写这个属性**
   * (自 5ca8e99f 起的旧债,2026-09-30 复核抓到)。于是:
   * 「有子元素的节点」`textContent` **恒为空串**,新加的 `innerText` 同源也恒空。
   * ⭐ 后果:任何「取容器文字」的断言都在拿空串比空串 —— 绿得毫无意义。
   */
  if (props.textContent === undefined && children.length > 0) {
    Object.defineProperty(node, 'textContent', {
      get() {
        return node.children.map((c) => c.textContent).join('');
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
      /**
       * 属性 selector。⭐ 2026-09-30 补上 `*=` / `^=` / `$=` 三个算子 ——
       * mail 提取脚本用到 `span[title*="@"]` 与 `a[href^="mailto:"]`,
       * 原来只认 `=`,于是**整段脚本抛错**(而它抛得对:静默返回空会让测试假绿)。
       */
      const m = t.match(/^\[([\w-]+)(?:([*^$]?=)["']?([^\]"']*)["']?)?\]$/);
      if (!m) throw new Error(`[fake-dom] 不支持的属性 selector: ${t}`);
      const [, name, op, want] = m;
      const got = node.attrs[name];
      if (got === undefined) return false;     // 属性不存在 → 不匹配
      if (op === undefined) continue;           // `[attr]` 只要求存在
      if (op === '=' && got !== want) return false;
      // ⚠️ 真 DOM:`[attr*=""]` 匹配**零个**元素(空串不是有效子串匹配)。
      // `''.includes('')` 为 true,照写会变成"全匹配",与真 DOM 相反。
      if (op === '*=' && (want === '' || !got.includes(want))) return false;
      if (op === '^=' && !got.startsWith(want)) return false;
      if (op === '$=' && !got.endsWith(want)) return false;
    } else {
      if (node.tagName !== t.toUpperCase()) return false;
    }
  }
  return true;
}

/**
 * 在给定候选集合里跑一个 selector。
 *
 * ⭐ 2026-09-30 补上**逗号分隔多候选** —— 原来只拆空格(后代),
 * 于是 `'[email], [data-hovercard-id]'` 被当成**一整个片段**送去匹配,
 * 当场抛「不支持的 selector 片段」。
 * ⚠️ 这个抛是**对的**(静默返回空会让测试假绿),缺的是能力不是约束。
 */
function querySelectorAllIn(pool: FakeEl[], sel: string): FakeEl[] {
  if (sel.includes(',')) {
    const out: FakeEl[] = [];
    for (const one of sel.split(',').map((x) => x.trim()).filter(Boolean)) {
      for (const hit of querySelectorAllIn(pool, one)) {
        if (!out.includes(hit)) out.push(hit);
      }
    }
    // ⚠️ 真 DOM 的 querySelectorAll 按**文档顺序**返回,不按 selector 顺序
    return pool.filter((n) => out.includes(n));
  }
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
  /** 脚本里的 `location` —— 提取类脚本常把 `location.href` 写进结果做留痕 */
  location: { href: string };
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
    location: { href: 'https://fake.test/page' },
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
    /**
     * ⭐ 按矩形真做命中判定 —— 不是「返回预先塞好的那个」。
     *
     * ⚠️ 手写假 DOM 的教训(2026-09-30 独立复核抓到):
     * 我第一版让 `elementFromPoint` 返回一个**预先指定的下标**,
     * 于是它既不看 selector 也不看坐标 ——
     * 「closest 传错 selector」「带内回退永远取第一封」
     * 「把页面空白元素当成邮件」三种破坏**全都测不出来**。
     *
     * 真语义:命中点上**最靠后(最上层)**的那个元素;没有则 null。
     */
    elementFromPoint(x: number, y: number) {
      let hit: FakeEl | null = null;
      for (const n of all()) {
        if (n === root) continue;
        const r = n.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          hit = n;        // 后来的覆盖先前的 —— 近似「上层胜出」
        }
      }
      /**
       * ⭐ 点在空白处时真 DOM 返回 **`<body>`** 而不是 `null`
       * (只有点在视口外才是 null)。这个差异是有意义的:
       * 被测脚本写 `el && el.closest ? el.closest(sel) : null` ——
       * 返回 body 会走进 `closest` 分支(并正确地找不到),
       * 返回 null 则整个分支被跳过。两条路径不同,假 DOM 不该抹平它。
       */
      return hit ?? root;
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
    'location',
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
    dom.location,
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
