/**
 * dev mode payload 浅层 typeof 校验
 *
 * 见 PROTOCOL.md 铁律 3 + DESIGN.md § 4.4。
 *
 * 设计:
 * - 仅 dev mode 生效(prod 0 开销)
 * - 浅层 typeof 检查(对象顶层字段)
 * - 不引入 zod 等运行时库(charter § 1.3)
 *
 * 用法(L5 view 真用时):
 *   shallowTypeCheck('note.selection.changed', payload, {
 *     from: 'number',
 *     to: 'number',
 *     text: 'string',
 *   });
 *
 * L3.5 阶段 stub — manifest 收集机制留 L5 view 注册时落地;
 * 当前导出函数本身,bus 启动时若有 manifest 自动调用。
 */

/** typeof 返回值 */
type PrimitiveTypeName =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'undefined'
  | 'function'
  | 'symbol'
  | 'bigint';

export type PayloadSchema = Record<string, PrimitiveTypeName>;

/**
 * 浅层校验 — payload 顶层字段类型对照 schema
 *
 * @returns true = 通过;false = 不通过(已 console.warn)
 */
export function shallowTypeCheck(
  name: string,
  payload: unknown,
  schema: PayloadSchema,
): boolean {
  if (
    typeof process === 'undefined' ||
    process.env?.NODE_ENV !== 'development'
  ) {
    return true; // prod 不校验
  }

  if (typeof payload !== 'object' || payload === null) {
    console.warn(`[bus][dev] '${name}' payload not object (got ${typeof payload})`);
    return false;
  }

  const obj = payload as Record<string, unknown>;
  let allOk = true;

  for (const [key, expected] of Object.entries(schema)) {
    const actual = typeof obj[key];
    if (actual !== expected) {
      console.warn(
        `[bus][dev] '${name}' field '${key}' expected ${expected}, got ${actual}`,
      );
      allOk = false;
    }
  }

  return allOk;
}
