/**
 * `web.dom` 数据模型(`06-data-model-and-interfaces.md` §3.3)
 */

/**
 * 预注册脚本 id —— ⭐ **`run` 只认这个,不认脚本字符串**。
 *
 * 这是 `project-x-inject-template-escape` 的**类型层面根治**:
 * 那次模板字面量吃掉 `\/` → 浏览器收到 `/^/` 非法正则 → 整段解析失败 →
 * **采集恒 0 一整天,而 tsc 和单测全绿**。
 *
 * 调用方给不了原始字符串,就拼不出坏脚本。
 */
export type ScriptId = string & { readonly __brand: 'web.dom.ScriptId' };

/** 锚点名(语义名,由 adapter 解释成 selector)*/
export type AnchorName = string & { readonly __brand: 'web.dom.AnchorName' };

/** 提取器 id(语义名,由 adapter 解释成一段提取逻辑)*/
export type ExtractId = string & { readonly __brand: 'web.dom.ExtractId' };

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type DomAnchor = {
  readonly anchor: AnchorName;
  readonly found: boolean;
  readonly rect?: Rect;
  readonly text?: string;
};

export type SelectionState = {
  readonly text: string;
  readonly html?: string;
  readonly rects: readonly Rect[];
};

/**
 * 脚本参数。**必须是可 JSON 序列化的值** ——
 * 它们会被 `JSON.stringify` 后作为**绑定值**注入,
 * ⚠️ **绝不拼进脚本文本**(那等于把洞留着,见 §5.1)。
 */
export type ScriptParams = Readonly<Record<string, unknown>>;

/**
 * 一个预注册脚本。
 *
 * `build(params)` 返回**完整可执行的脚本文本**。实现者有义务:
 *  - 参数一律走 `JSON.stringify`(有守卫扫)
 *  - 求值后必须是合法 JS(有守卫真 eval + parse)
 */
export type RegisteredScript = {
  readonly id: ScriptId;
  /** 人能读懂的用途,出问题时的第一条线索 */
  readonly purpose: string;
  readonly build: (params: ScriptParams) => string;
};
