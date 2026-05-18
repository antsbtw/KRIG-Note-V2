/**
 * math-visual help-panel data — 函数图形参考数据
 *
 * 1:1 迁自 V1 `src/plugins/note/help-panel/math-visual/math-visual-data.ts`。
 * 8 大分类 × 多模板:基础 / 三角 / 指数对数 / 参数方程 / 极坐标 / 特殊 / 参数化 / 语法。
 *
 * 每个模板:
 * - label:显示标题
 * - desc:简要说明
 * - code:可插入的 mathjs 表达式(点 Insert 注入到 active math-visual 函数行)
 * - preview:KaTeX 预览公式(默认用 code)
 */

export interface MathVisualTemplate {
  label: string;
  desc: string;
  code: string;
  preview?: string;
}

export interface MathVisualCategory {
  id: string;
  name: string;
  templates: MathVisualTemplate[];
}

export const MATH_VISUAL_CATEGORIES: MathVisualCategory[] = [
  // ─── 基础函数 ───
  {
    id: 'basic',
    name: 'Basic',
    templates: [
      { label: 'Linear', desc: 'y = ax + b', code: 'a*x + b', preview: 'y = ax + b' },
      { label: 'Quadratic', desc: 'y = ax² + bx + c', code: 'a*x^2 + b*x + c', preview: 'y = ax^2 + bx + c' },
      { label: 'Cubic', desc: 'y = x³', code: 'x^3', preview: 'y = x^3' },
      { label: 'Square Root', desc: 'y = √x', code: 'sqrt(x)', preview: 'y = \\sqrt{x}' },
      { label: 'Absolute Value', desc: 'y = |x|', code: 'abs(x)', preview: 'y = |x|' },
      { label: 'Reciprocal', desc: 'y = 1/x', code: '1/x', preview: 'y = \\frac{1}{x}' },
      { label: 'Power', desc: 'y = x^n', code: 'x^n', preview: 'y = x^n' },
    ],
  },

  // ─── 三角函数 ───
  {
    id: 'trig',
    name: 'Trig',
    templates: [
      { label: 'Sine', desc: 'y = sin(x)', code: 'sin(x)', preview: 'y = \\sin(x)' },
      { label: 'Cosine', desc: 'y = cos(x)', code: 'cos(x)', preview: 'y = \\cos(x)' },
      { label: 'Tangent', desc: 'y = tan(x)', code: 'tan(x)', preview: 'y = \\tan(x)' },
      { label: 'Arcsine', desc: 'y = arcsin(x)', code: 'asin(x)', preview: 'y = \\arcsin(x)' },
      { label: 'Arccosine', desc: 'y = arccos(x)', code: 'acos(x)', preview: 'y = \\arccos(x)' },
      { label: 'Arctangent', desc: 'y = arctan(x)', code: 'atan(x)', preview: 'y = \\arctan(x)' },
      { label: 'Amplitude', desc: 'y = A sin(Bx + C)', code: 'A*sin(B*x + C)', preview: 'y = A\\sin(Bx + C)' },
    ],
  },

  // ─── 指数/对数 ───
  {
    id: 'exp-log',
    name: 'Exp/Log',
    templates: [
      { label: 'Exponential', desc: 'y = e^x', code: 'exp(x)', preview: 'y = e^x' },
      { label: 'Exp base a', desc: 'y = a^x', code: 'a^x', preview: 'y = a^x' },
      { label: 'Natural Log', desc: 'y = ln(x)', code: 'log(x)', preview: 'y = \\ln(x)' },
      { label: 'Log base 10', desc: 'y = log₁₀(x)', code: 'log10(x)', preview: 'y = \\log_{10}(x)' },
      { label: 'Log base 2', desc: 'y = log₂(x)', code: 'log2(x)', preview: 'y = \\log_2(x)' },
      { label: 'Logistic', desc: 'S-curve', code: '1 / (1 + exp(-x))', preview: 'y = \\frac{1}{1+e^{-x}}' },
    ],
  },

  // ─── 参数方程 ───
  {
    id: 'parametric',
    name: 'Parametric',
    templates: [
      { label: 'Circle', desc: 'x² + y² = r²', code: 'r*cos(t); r*sin(t)', preview: '\\begin{cases} x = r\\cos t \\\\ y = r\\sin t \\end{cases}' },
      { label: 'Ellipse', desc: 'a, b semi-axes', code: 'a*cos(t); b*sin(t)', preview: '\\begin{cases} x = a\\cos t \\\\ y = b\\sin t \\end{cases}' },
      { label: 'Lissajous', desc: 'Frequency ratio A:B', code: 'sin(A*t); sin(B*t)', preview: '\\begin{cases} x = \\sin(At) \\\\ y = \\sin(Bt) \\end{cases}' },
      { label: 'Spiral', desc: 'Expanding spiral', code: 't*cos(t); t*sin(t)', preview: '\\begin{cases} x = t\\cos t \\\\ y = t\\sin t \\end{cases}' },
      { label: 'Cycloid', desc: 'Rolling circle', code: 't - sin(t); 1 - cos(t)', preview: '\\begin{cases} x = t - \\sin t \\\\ y = 1 - \\cos t \\end{cases}' },
    ],
  },

  // ─── 极坐标 ───
  {
    id: 'polar',
    name: 'Polar',
    templates: [
      { label: 'Circle', desc: 'r = a (constant)', code: 'a', preview: 'r = a' },
      { label: 'Cardioid', desc: 'Heart shape', code: '1 + cos(theta)', preview: 'r = 1 + \\cos\\theta' },
      { label: 'Rose 3-petal', desc: 'Three petals', code: 'sin(3*theta)', preview: 'r = \\sin(3\\theta)' },
      { label: 'Rose 4-petal', desc: 'Four petals', code: 'sin(2*theta)', preview: 'r = \\sin(2\\theta)' },
      { label: 'Lemniscate', desc: 'Figure-eight', code: 'sqrt(abs(2*cos(2*theta)))', preview: 'r = \\sqrt{|2\\cos 2\\theta|}' },
      { label: 'Spiral', desc: 'Archimedean spiral', code: 'theta', preview: 'r = \\theta' },
    ],
  },

  // ─── 特殊函数 ───
  {
    id: 'special',
    name: 'Special',
    templates: [
      { label: 'Step (floor)', desc: 'Greatest integer', code: 'floor(x)', preview: 'y = \\lfloor x \\rfloor' },
      { label: 'Ceiling', desc: 'Smallest integer ≥ x', code: 'ceil(x)', preview: 'y = \\lceil x \\rceil' },
      { label: 'Sign', desc: 'y = sgn(x)', code: 'sign(x)', preview: 'y = \\text{sgn}(x)' },
      { label: 'Gaussian', desc: 'Bell curve', code: 'exp(-x^2)', preview: 'y = e^{-x^2}' },
      { label: 'Sinc', desc: 'sin(x)/x', code: 'sin(x)/x', preview: 'y = \\frac{\\sin x}{x}' },
      { label: 'Hyperbolic sin', desc: 'y = sinh(x)', code: 'sinh(x)', preview: 'y = \\sinh(x)' },
      { label: 'Hyperbolic cos', desc: 'y = cosh(x)', code: 'cosh(x)', preview: 'y = \\cosh(x)' },
    ],
  },

  // ─── 参数与交互 ───
  {
    id: 'params',
    name: 'Parameters',
    templates: [
      { label: 'Slider demo', desc: 'Drag a to see change', code: 'a*x^2 + 1', preview: 'y = ax^2 + 1' },
      { label: 'Phase shift', desc: 'Shift with parameter', code: 'sin(x + a)', preview: 'y = \\sin(x + a)' },
      { label: 'Frequency', desc: 'Change frequency', code: 'sin(a*x)', preview: 'y = \\sin(ax)' },
      { label: 'Damped wave', desc: 'Decay oscillation', code: 'exp(-a*x)*sin(b*x)', preview: 'y = e^{-ax}\\sin(bx)' },
      { label: 'Vertical line', desc: 'x = constant', code: 'x = 3', preview: 'x = 3' },
    ],
  },

  // ─── 语法参考 ───
  {
    id: 'syntax',
    name: 'Syntax',
    templates: [
      { label: 'Operators', desc: '+ - * / ^', code: '', preview: '+ \\;\\; - \\;\\; * \\;\\; / \\;\\; \\hat{}' },
      { label: 'Parentheses', desc: 'Group with ()', code: '', preview: '(a + b) \\cdot c' },
      { label: 'Parameter', desc: 'Auto slider for a, b, k...', code: '', preview: 'f(x) = ax^2 \\;\\Rightarrow\\; \\text{slider } a' },
      { label: 'Parametric', desc: 'x(t); y(t) with semicolon', code: '', preview: '\\texttt{cos(t); sin(t)}' },
      { label: 'Polar', desc: 'Set plotType to polar', code: '', preview: '\\texttt{r(}\\theta\\texttt{)}, \\; \\text{e.g. } 1+\\cos\\theta' },
      { label: 'Constants', desc: 'pi, e', code: '', preview: '\\pi = 3.14\\ldots \\;\\; e = 2.71\\ldots' },
      { label: 'Functions', desc: 'sin cos tan log exp sqrt abs floor ceil', code: '', preview: '\\text{sin, cos, tan, log, exp, sqrt, abs, ...}' },
    ],
  },
];
