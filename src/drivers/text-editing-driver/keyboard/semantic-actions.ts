/**
 * semantic-actions — 键盘语义原子动作(keyboard-system.md §三)
 *
 * Enter / Backspace 决策链最终都归结为这组原子动作。集中模块只实现这些动作 + 两条决策链。
 *
 * Phase 0(脚手架):动作签名 + 文档,实现为「未实现」桩(返回 false = 不处理 → 放行默认)。
 * Phase 1 填 Enter 侧动作,Phase 2 填 Backspace 侧动作。决策链按 keyboard-system.md §四。
 */

import type { EditorState, Transaction } from 'prosemirror-state';
import type { KeyboardContext } from './resolve-context';

/** 动作签名:与 PM Command 同形。dispatch 缺省 = dry-run(只问能否执行)。 */
export type KeyboardAction = (
  ctx: KeyboardContext,
  dispatch: ((tr: Transaction) => void) | undefined,
) => boolean;

const TODO: (state: EditorState) => boolean = () => false;

// ── Enter 侧(Phase 1 实现) ──

/** 拆当前块,新块继承 formatAttrs(keyboard-system §三 splitBlock)。 */
export const splitBlock: KeyboardAction = () => TODO(undefined as never);

/** 在当前块后插同级块(如 toggle 后建 toggle),继承 indent。 */
export const insertSiblingAfter: KeyboardAction = () => TODO(undefined as never);

/** 跳出容器,在容器后建正文段(Enter:caption/容器顶级)。 */
export const exitContainerForward: KeyboardAction = () => TODO(undefined as never);

/** 块内插换行不拆块(代码块 Enter / Shift-Enter)。 */
export const softBreak: KeyboardAction = () => TODO(undefined as never);

// ── Backspace 侧(Phase 2 实现) ──

/** 脱一层格式外壳:标题→正文 / 列表项→正文 / indent−1。 */
export const demoteFormat: KeyboardAction = () => TODO(undefined as never);

/** 上提对齐到上一级(空行换层级,不合并)。 */
export const liftAlign: KeyboardAction = () => TODO(undefined as never);

/** 退出容器,把块提到容器前/上方(逐块,空容器解散)。 */
export const exitContainerBackward: KeyboardAction = () => TODO(undefined as never);

/** 与上一块合并(joinBackward)。 */
export const mergePrev: KeyboardAction = () => TODO(undefined as never);

/** 删原子块(仅 NodeSelection / handle)。 */
export const deleteAtom: KeyboardAction = () => TODO(undefined as never);

/** 吃掉键、不动(保护 / 硬墙)。 */
export const noop: KeyboardAction = (_ctx, _dispatch) => true;
