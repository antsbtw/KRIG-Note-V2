/**
 * lexrank — 字典序排位键(Lexicographic Rank)
 *
 * Decision 028 §2.3:文档块的同级顺序(原 nextSibling 边)改用每块自带的 `order`
 * 属性表达 —— 一个**字符串**,字符串字典序 (`<`) 天然有序。
 *
 * 三个核心操作:
 *  - `initialRanks(n)`     —— dissect 初次按顺序给 n 个块分配递增 rank
 *  - `rankBetween(a, b)`   —— 在 a、b 之间取一个 rank(中插,O(1),不动其它块)
 *  - `rankAfter(a)`        —— 在 a 之后追加(末尾追加)
 *
 * 算法(base-N 数字串中点法,不退化):
 *  - rank 是 `DIGITS` 字符集内的字符串,字典序比较 = 字符逐位比较。
 *  - 约束:rank **不以最小数字结尾**(末位非 `DIGITS[0]`),保证任意两个相邻 rank
 *    之间总能再插一个(中点法可无限细分,只是字符串变长)。
 *  - 取中点:逐位求两串的"数字均值";若整数位无空隙(a、b 仅差 1),则在 a 末尾
 *    追加一位中点数字 —— 字符串加长但永不撞、永不退化。
 *
 * 为什么不用整数序号:整数中插要把后续全部 +1(写放大 N 块);字典序中插只写 1 块。
 * 为什么不用浮点 fractional index:浮点有精度上限(连续中插 ~50 次后失真);
 * 字符串无精度上限(代价是偶尔变长,base-62 下增长极慢)。
 */

/**
 * 数字字符集(base-62,字典序即数值序:0-9 < A-Z < a-z 的 ASCII 顺序成立)。
 * 注:ASCII 中 '0'(48) < 'A'(65) < 'a'(97),且组内连续,故此串本身就是升序排列,
 * 直接用 indexOf/charAt 当 base-62 数字表。
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length; // 62

/** 单字符 → 数值(0..61);非法字符 throw(fail loud,见 §6 排查规范)。 */
function digitVal(ch: string): number {
  const v = DIGITS.indexOf(ch);
  if (v < 0) {
    throw new Error(`[lexrank] invalid digit '${ch}' (not in base-${BASE} charset)`);
  }
  return v;
}

/** 数值(0..61)→ 单字符。 */
function valDigit(v: number): string {
  if (v < 0 || v >= BASE) {
    throw new Error(`[lexrank] digit value ${v} out of range [0, ${BASE})`);
  }
  return DIGITS[v];
}

/**
 * 取 a、b 严格之间的一个 rank(a < result < b,字典序)。
 * a / b 可为 null:
 *  - a=null → 取 b 之前(b 与"虚拟最小"之间)
 *  - b=null → 取 a 之后(a 与"虚拟最大"之间)
 *  - 都 null → 返回一个居中起始 rank
 *
 * @throws 若 a >= b(顺序矛盾,fail loud)
 */
export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`[lexrank] rankBetween requires a < b, got a='${a}' b='${b}'`);
  }

  // 逐位扫描,构造一个介于 a、b 之间的串。
  // lo / hi 为当前位的数字值(a 用 MIN_DIGIT=0 兜底缺位,b 用 BASE(超界)兜底缺位)。
  let result = '';
  let i = 0;
  for (;;) {
    const lo = a !== null && i < a.length ? digitVal(a[i]) : 0;
    const hi = b !== null && i < b.length ? digitVal(b[i]) : BASE;

    if (lo === hi) {
      // 本位无空隙 — 复制该位,继续看下一位
      result += valDigit(lo);
      i++;
      continue;
    }

    const mid = Math.floor((lo + hi) / 2);
    if (mid > lo) {
      // 本位有整数中点 — 用它,结束(末位 mid>0 因 lo>=0,且 mid<hi<=BASE 合法)
      return result + valDigit(mid);
    }

    // mid === lo(lo、hi 相邻,如 lo=3 hi=4)— 取 lo 这一位,然后在更深一层细分:
    // 继续往后,把 a 的剩余位当下界、b 视为"无上界"(因为已比 b 同位小 1,后续任意 < BASE 都 < b)。
    result += valDigit(lo);
    i++;
    // 进入"a 之后、无上界"的细分循环
    for (;;) {
      const loNext = a !== null && i < a.length ? digitVal(a[i]) : 0;
      // 上界变 BASE(无约束):中点 = (loNext + BASE)/2
      const midNext = Math.floor((loNext + BASE) / 2);
      if (midNext > loNext) {
        return result + valDigit(midNext);
      }
      // loNext 已接近 BASE(如 60),midNext===loNext — 复制后继续更深
      result += valDigit(loNext);
      i++;
    }
  }
}

/** 在 a 之后追加(末尾)— a=null 表示空序列的第一个。 */
export function rankAfter(a: string | null): string {
  return rankBetween(a, null);
}

/** 在 b 之前插入(开头)— b=null 表示空序列的第一个。 */
export function rankBefore(b: string | null): string {
  return rankBetween(null, b);
}

/**
 * 给 n 个块按顺序分配递增 rank(dissect 初次拆解用)。
 *
 * 用等距整数桶:把 [0, BASE^width) 均匀切 n+1 份,取内部 n 个点,各编码成定宽 base-62 串。
 * width 取足够大保证 n 个点互不相同且末位非 0(满足"不以最小数字结尾"约束 → 后续可中插)。
 * n 个 rank 严格升序、彼此留足空隙,后续中插不会立即退化。
 */
export function initialRanks(n: number): string[] {
  if (n <= 0) return [];
  // 串行用 rankAfter 逐个追加最简单且绝不退化(每次在末尾取新中点);
  // n 个块 O(n),每个 rank 长度 ~O(1)(末尾追加每步基本恒长)。
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const r = rankAfter(prev);
    out.push(r);
    prev = r;
  }
  return out;
}
