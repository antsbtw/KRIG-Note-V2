/**
 * Unit test: STRUCTURAL_CONTAINER_TYPES (5B Stage 1-2 拍板硬契约)
 *
 * 验证:
 *  - 字面 5 项 {tableRow, bulletList, orderedList, taskList, columnList}
 *  - 字面**不**含 'table' (5A 拍板 table 是 atom,5B §7.3.1 收敛)
 */
import { describe, it, expect } from 'vitest';
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';

describe('STRUCTURAL_CONTAINER_TYPES (semantic SSOT)', () => {
  it('字面包含 5 项硬契约', () => {
    expect(STRUCTURAL_CONTAINER_TYPES.has('tableRow')).toBe(true);
    expect(STRUCTURAL_CONTAINER_TYPES.has('bulletList')).toBe(true);
    expect(STRUCTURAL_CONTAINER_TYPES.has('orderedList')).toBe(true);
    expect(STRUCTURAL_CONTAINER_TYPES.has('taskList')).toBe(true);
    expect(STRUCTURAL_CONTAINER_TYPES.has('columnList')).toBe(true);
  });

  it('字面不含 table (5A 拍板 table 是 atom)', () => {
    expect(STRUCTURAL_CONTAINER_TYPES.has('table')).toBe(false);
  });

  it('集合 size 恰好 5', () => {
    expect(STRUCTURAL_CONTAINER_TYPES.size).toBe(5);
  });
});
