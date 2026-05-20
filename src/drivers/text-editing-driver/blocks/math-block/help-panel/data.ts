/**
 * latex help-panel data — LaTeX 公式模板数据
 *
 * 1:1 迁自 V1 `src/plugins/note/help-panel/latex/latex-data.ts`。
 * 16 大分类:Fraction / Script / Radical / Integral / Large Op / Bracket /
 * Function / Accent / Limit / Matrix / Greek / Operators / Relations /
 * Arrows / Misc / Letters。
 *
 * 每个模板:
 * - label:KaTeX 渲染预览的 LaTeX(展示用,可能含 a/b/x 占位符)
 * - latex:点 Insert 时插入到 mathBlock / mathInline 的文本
 * - cursorOffset:插入后光标偏移(预留;V2 当前简化实现先不消费,只插字符串)
 */

export interface MathTemplate {
  /** 显示标签(KaTeX 渲染预览) */
  label: string;
  /** 插入的 LaTeX 文本 */
  latex: string;
  /** 插入后光标偏移(默认末尾) */
  cursorOffset?: number;
}

export interface MathCategory {
  id: string;
  name: string;
  icon: string;
  templates: MathTemplate[];
}

/** 简单符号(label = latex) */
function sym(latex: string): MathTemplate {
  const insert = latex + ' ';
  return { label: latex, latex: insert, cursorOffset: insert.length };
}

/** 带占位符的模板 */
function tmpl(label: string, latex: string, cursorOffset: number): MathTemplate {
  return { label, latex, cursorOffset };
}

export const MATH_CATEGORIES: MathCategory[] = [
  // ─── Structures ───
  {
    id: 'fraction',
    name: 'Fraction',
    icon: '⁄',
    templates: [
      tmpl('\\frac{a}{b}', '\\frac{}{}', 6),
      tmpl('\\dfrac{a}{b}', '\\dfrac{}{}', 7),
      tmpl('\\tfrac{a}{b}', '\\tfrac{}{}', 7),
      tmpl('\\cfrac{a}{b}', '\\cfrac{}{}', 7),
      tmpl('\\binom{n}{k}', '\\binom{}{}', 7),
      sym('a/b'),
    ],
  },
  {
    id: 'script',
    name: 'Script',
    icon: 'x²',
    templates: [
      tmpl('x^{a}', '^{}', 2),
      tmpl('x_{a}', '_{}', 2),
      tmpl('x^{a}_{b}', '^{}_{}', 2),
      tmpl('\\sqrt{x}', '\\sqrt{}', 6),
      tmpl('\\sqrt[n]{x}', '\\sqrt[]{}', 6),
      tmpl('\\hat{x}', '\\hat{}', 5),
      tmpl('\\bar{x}', '\\bar{}', 5),
      tmpl('\\vec{x}', '\\vec{}', 5),
      tmpl('\\tilde{x}', '\\tilde{}', 7),
      tmpl('\\dot{x}', '\\dot{}', 5),
      tmpl('\\ddot{x}', '\\ddot{}', 6),
    ],
  },
  {
    id: 'radical',
    name: 'Radical',
    icon: '√',
    templates: [
      tmpl('\\sqrt{x}', '\\sqrt{}', 6),
      tmpl('\\sqrt[n]{x}', '\\sqrt[]{}', 6),
      tmpl('\\sqrt[3]{x}', '\\sqrt[3]{}', 9),
      tmpl('\\sqrt[4]{x}', '\\sqrt[4]{}', 9),
    ],
  },
  {
    id: 'integral',
    name: 'Integral',
    icon: '∫',
    templates: [
      sym('\\int'),
      tmpl('\\int_{a}^{b}', '\\int_{}^{} ', 6),
      sym('\\iint'),
      sym('\\iiint'),
      sym('\\oint'),
      tmpl('\\int_{0}^{\\infty}', '\\int_{0}^{\\infty} ', 18),
      tmpl('\\int_{-\\infty}^{\\infty}', '\\int_{-\\infty}^{\\infty} ', 24),
    ],
  },
  {
    id: 'large-operator',
    name: 'Large Op',
    icon: '∑',
    templates: [
      sym('\\sum'),
      tmpl('\\sum_{i=1}^{n}', '\\sum_{i=1}^{n} ', 15),
      tmpl('\\sum_{i=0}^{\\infty}', '\\sum_{i=0}^{\\infty} ', 20),
      sym('\\prod'),
      tmpl('\\prod_{i=1}^{n}', '\\prod_{i=1}^{n} ', 16),
      sym('\\coprod'),
      sym('\\bigcup'),
      sym('\\bigcap'),
      sym('\\bigoplus'),
      sym('\\bigotimes'),
      sym('\\bigvee'),
      sym('\\bigwedge'),
      sym('\\bigsqcup'),
      sym('\\biguplus'),
    ],
  },
  {
    id: 'bracket',
    name: 'Bracket',
    icon: '⟨⟩',
    templates: [
      tmpl('\\left( \\right)', '\\left(  \\right)', 7),
      tmpl('\\left[ \\right]', '\\left[  \\right]', 7),
      tmpl('\\left\\{ \\right\\}', '\\left\\{  \\right\\}', 8),
      tmpl('\\left| \\right|', '\\left|  \\right|', 7),
      tmpl('\\left\\| \\right\\|', '\\left\\|  \\right\\|', 8),
      tmpl('\\langle \\rangle', '\\langle  \\rangle', 9),
      tmpl('\\lfloor \\rfloor', '\\lfloor  \\rfloor', 9),
      tmpl('\\lceil \\rceil', '\\lceil  \\rceil', 8),
    ],
  },
  {
    id: 'function',
    name: 'Function',
    icon: 'sin',
    templates: [
      sym('\\sin'), sym('\\cos'), sym('\\tan'),
      sym('\\sec'), sym('\\csc'), sym('\\cot'),
      sym('\\arcsin'), sym('\\arccos'), sym('\\arctan'),
      sym('\\sinh'), sym('\\cosh'), sym('\\tanh'),
      sym('\\ln'), sym('\\log'),
      tmpl('\\log_{b}', '\\log_{} ', 6),
      sym('\\exp'),
      sym('\\min'), sym('\\max'),
      sym('\\det'), sym('\\dim'), sym('\\gcd'),
      sym('\\deg'), sym('\\hom'), sym('\\ker'),
      sym('\\arg'),
    ],
  },
  {
    id: 'accent',
    name: 'Accent',
    icon: 'â',
    templates: [
      tmpl('\\hat{a}', '\\hat{}', 5),
      tmpl('\\check{a}', '\\check{}', 7),
      tmpl('\\tilde{a}', '\\tilde{}', 7),
      tmpl('\\acute{a}', '\\acute{}', 7),
      tmpl('\\grave{a}', '\\grave{}', 7),
      tmpl('\\dot{a}', '\\dot{}', 5),
      tmpl('\\ddot{a}', '\\ddot{}', 6),
      tmpl('\\breve{a}', '\\breve{}', 7),
      tmpl('\\bar{a}', '\\bar{}', 5),
      tmpl('\\vec{a}', '\\vec{}', 5),
      tmpl('\\widehat{ab}', '\\widehat{}', 9),
      tmpl('\\widetilde{ab}', '\\widetilde{}', 11),
      tmpl('\\overline{ab}', '\\overline{}', 10),
      tmpl('\\underline{ab}', '\\underline{}', 11),
      tmpl('\\overbrace{ab}', '\\overbrace{}', 11),
      tmpl('\\underbrace{ab}', '\\underbrace{}', 12),
      tmpl('\\overrightarrow{ab}', '\\overrightarrow{}', 16),
      tmpl('\\overleftarrow{ab}', '\\overleftarrow{}', 15),
    ],
  },
  {
    id: 'limit',
    name: 'Limit',
    icon: 'lim',
    templates: [
      sym('\\lim'),
      tmpl('\\lim_{x \\to a}', '\\lim_{x \\to } ', 12),
      tmpl('\\lim_{x \\to 0}', '\\lim_{x \\to 0} ', 15),
      tmpl('\\lim_{x \\to \\infty}', '\\lim_{x \\to \\infty} ', 20),
      tmpl('\\lim_{n \\to \\infty}', '\\lim_{n \\to \\infty} ', 20),
      sym('\\limsup'), sym('\\liminf'),
      sym('\\sup'), sym('\\inf'),
    ],
  },
  {
    id: 'matrix',
    name: 'Matrix',
    icon: '▦',
    templates: [
      {
        label: '\\begin{pmatrix}\\end{pmatrix}',
        latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
        cursorOffset: 17,
      },
      {
        label: '\\begin{bmatrix}\\end{bmatrix}',
        latex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}',
        cursorOffset: 17,
      },
      {
        label: '\\begin{vmatrix}\\end{vmatrix}',
        latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}',
        cursorOffset: 17,
      },
      {
        label: '\\begin{Bmatrix}\\end{Bmatrix}',
        latex: '\\begin{Bmatrix} a & b \\\\ c & d \\end{Bmatrix}',
        cursorOffset: 17,
      },
      {
        label: '\\begin{cases}\\end{cases}',
        latex: '\\begin{cases} a & \\text{if } b \\\\ c & \\text{if } d \\end{cases}',
        cursorOffset: 15,
      },
      {
        label: '\\begin{aligned}\\end{aligned}',
        latex: '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
        cursorOffset: 17,
      },
    ],
  },

  // ─── Symbols ───
  {
    id: 'greek',
    name: 'Greek',
    icon: 'αβ',
    templates: [
      sym('\\alpha'), sym('\\beta'), sym('\\gamma'), sym('\\delta'),
      sym('\\epsilon'), sym('\\varepsilon'), sym('\\zeta'), sym('\\eta'),
      sym('\\theta'), sym('\\vartheta'), sym('\\iota'), sym('\\kappa'),
      sym('\\lambda'), sym('\\mu'), sym('\\nu'), sym('\\xi'),
      sym('\\omicron'), sym('\\pi'), sym('\\varpi'), sym('\\rho'),
      sym('\\varrho'), sym('\\sigma'), sym('\\varsigma'), sym('\\tau'),
      sym('\\upsilon'), sym('\\phi'), sym('\\varphi'), sym('\\chi'),
      sym('\\psi'), sym('\\omega'),
      sym('\\Gamma'), sym('\\Delta'), sym('\\Theta'), sym('\\Lambda'),
      sym('\\Xi'), sym('\\Pi'), sym('\\Sigma'), sym('\\Upsilon'),
      sym('\\Phi'), sym('\\Psi'), sym('\\Omega'),
    ],
  },
  {
    id: 'operator',
    name: 'Operators',
    icon: '±',
    templates: [
      sym('\\pm'), sym('\\mp'), sym('\\times'), sym('\\div'),
      sym('\\cdot'), sym('\\ast'), sym('\\star'), sym('\\circ'),
      sym('\\bullet'), sym('\\oplus'), sym('\\ominus'), sym('\\otimes'),
      sym('\\oslash'), sym('\\odot'), sym('\\dagger'), sym('\\ddagger'),
      sym('\\amalg'),
      sym('\\cup'), sym('\\cap'), sym('\\sqcup'), sym('\\sqcap'),
      sym('\\uplus'), sym('\\setminus'), sym('\\smallsetminus'),
      sym('\\vee'), sym('\\wedge'), sym('\\neg'), sym('\\lnot'),
    ],
  },
  {
    id: 'relation',
    name: 'Relations',
    icon: '≤',
    templates: [
      sym('='), sym('\\neq'), sym('\\equiv'), sym('\\not\\equiv'),
      sym('\\sim'), sym('\\simeq'), sym('\\cong'), sym('\\approx'),
      sym('\\doteq'), sym('\\propto'),
      sym('<'), sym('>'), sym('\\leq'), sym('\\geq'),
      sym('\\ll'), sym('\\gg'), sym('\\leqslant'), sym('\\geqslant'),
      sym('\\prec'), sym('\\succ'), sym('\\preceq'), sym('\\succeq'),
      sym('\\subset'), sym('\\supset'), sym('\\subseteq'), sym('\\supseteq'),
      sym('\\subsetneq'), sym('\\supsetneq'),
      sym('\\sqsubset'), sym('\\sqsupset'),
      sym('\\sqsubseteq'), sym('\\sqsupseteq'),
      sym('\\in'), sym('\\ni'), sym('\\notin'),
      sym('\\vdash'), sym('\\dashv'), sym('\\models'),
      sym('\\mid'), sym('\\parallel'), sym('\\perp'),
      sym('\\smile'), sym('\\frown'), sym('\\asymp'),
      sym('\\bowtie'),
    ],
  },
  {
    id: 'arrow',
    name: 'Arrows',
    icon: '→',
    templates: [
      sym('\\leftarrow'), sym('\\rightarrow'), sym('\\uparrow'), sym('\\downarrow'),
      sym('\\leftrightarrow'), sym('\\updownarrow'),
      sym('\\Leftarrow'), sym('\\Rightarrow'), sym('\\Uparrow'), sym('\\Downarrow'),
      sym('\\Leftrightarrow'), sym('\\Updownarrow'),
      sym('\\longleftarrow'), sym('\\longrightarrow'), sym('\\longleftrightarrow'),
      sym('\\Longleftarrow'), sym('\\Longrightarrow'), sym('\\Longleftrightarrow'),
      sym('\\mapsto'), sym('\\longmapsto'),
      sym('\\hookleftarrow'), sym('\\hookrightarrow'),
      sym('\\leftharpoonup'), sym('\\leftharpoondown'),
      sym('\\rightharpoonup'), sym('\\rightharpoondown'),
      sym('\\rightleftharpoons'),
      sym('\\nearrow'), sym('\\searrow'), sym('\\swarrow'), sym('\\nwarrow'),
      sym('\\leadsto'), sym('\\to'),
      sym('\\gets'),
      sym('\\iff'),
      sym('\\implies'),
    ],
  },
  {
    id: 'misc',
    name: 'Misc',
    icon: '∞',
    templates: [
      sym('\\forall'), sym('\\exists'), sym('\\nexists'),
      sym('\\therefore'), sym('\\because'),
      sym('\\partial'), sym('\\nabla'), sym('\\infty'),
      sym('\\ldots'), sym('\\cdots'), sym('\\vdots'), sym('\\ddots'),
      sym('\\angle'), sym('\\measuredangle'),
      sym('\\triangle'), sym('\\square'),
      sym('\\diamond'),
      sym('\\aleph'), sym('\\beth'),
      sym('\\hbar'), sym('\\ell'),
      sym('\\wp'), sym('\\Re'), sym('\\Im'),
      sym('\\complement'),
      sym('\\emptyset'), sym('\\varnothing'),
      sym('\\degree'),
      sym('\\%'),
      sym('\\quad'), sym('\\qquad'),
    ],
  },
  {
    id: 'letter-style',
    name: 'Letters',
    icon: '𝒜',
    templates: [
      tmpl('\\mathcal{A}', '\\mathcal{}', 9),
      tmpl('\\mathcal{B}', '\\mathcal{B} ', 12),
      tmpl('\\mathcal{C}', '\\mathcal{C} ', 12),
      tmpl('\\mathcal{F}', '\\mathcal{F} ', 12),
      tmpl('\\mathcal{H}', '\\mathcal{H} ', 12),
      tmpl('\\mathcal{L}', '\\mathcal{L} ', 12),
      tmpl('\\mathcal{N}', '\\mathcal{N} ', 12),
      tmpl('\\mathcal{O}', '\\mathcal{O} ', 12),
      tmpl('\\mathcal{P}', '\\mathcal{P} ', 12),
      tmpl('\\mathbb{R}', '\\mathbb{R} ', 11),
      tmpl('\\mathbb{Z}', '\\mathbb{Z} ', 11),
      tmpl('\\mathbb{N}', '\\mathbb{N} ', 11),
      tmpl('\\mathbb{Q}', '\\mathbb{Q} ', 11),
      tmpl('\\mathbb{C}', '\\mathbb{C} ', 11),
      tmpl('\\mathbb{E}', '\\mathbb{E} ', 11),
      tmpl('\\mathbb{P}', '\\mathbb{P} ', 11),
      tmpl('\\mathbb{1}', '\\mathbb{1} ', 11),
      tmpl('\\mathfrak{A}', '\\mathfrak{}', 10),
      tmpl('\\mathfrak{g}', '\\mathfrak{g} ', 13),
      tmpl('\\mathfrak{h}', '\\mathfrak{h} ', 13),
      tmpl('\\mathfrak{S}', '\\mathfrak{S} ', 13),
      tmpl('\\mathscr{A}', '\\mathscr{}', 9),
      tmpl('\\mathscr{B}', '\\mathscr{B} ', 12),
      tmpl('\\mathscr{H}', '\\mathscr{H} ', 12),
      tmpl('\\mathscr{L}', '\\mathscr{L} ', 12),
      tmpl('\\mathbf{A}', '\\mathbf{}', 8),
      tmpl('\\mathbf{x}', '\\mathbf{x} ', 11),
      tmpl('\\mathrm{d}x', '\\mathrm{d}', 9),
      tmpl('\\text{text}', '\\text{}', 6),
    ],
  },
];
