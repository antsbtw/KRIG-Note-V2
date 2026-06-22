/**
 * graph 编辑态 slash/turn-into 渲染态闸(L5 编辑↔渲染一致性专项 E1)
 *
 * 不变量:**graph 编辑态能插的块 ⊆ graph 渲染态(atomsToSvg)能渲的块**。
 * 否则用户在画板节点 slash 插了渲染态渲不出的块(divider/task/toggle/…)→ Esc 退出
 * 编辑后渲成灰字占位 / 丢内容(prompt §1「功能黑洞」)。
 *
 * 机制(发现 B):canvas slash 在 [graph-canvas-view/index.ts] 注册处用 createTurnIntoItems
 * 返回扁平 SlashItem[],本模块在注册前 `.filter()` 掉「目标块渲染态不支持」的 item。
 * 零 driver 改动、零跨 capability 影响(只动 graph view 自己的注册)。
 *
 * inputRules **不在此闸**(发现 C):它 schema 驱动、只产范围内块(heading/list/quote/hr/
 * task/code),E4 补 hr/task/toggle 渲染后即全覆盖,无需 per-instance 限制。
 *
 * 维护:E4 补 horizontalRule/taskList/toggleList 渲染器时,RENDERABLE_ATOM_TYPES
 * (svg/index.ts 单一真源)追加它们 → 本闸自动放开对应 slash item。
 */
import { RENDERABLE_ATOM_TYPES } from '../../lib/atom-serializers/svg';
import type { SlashItem } from '@slot/interaction-registries/slash-registry/slash-types';

/**
 * slash-turn 命令 → 该命令落地的块 atom.type(camelCase,对齐 atomsToSvg dispatch)。
 *
 * 命令→TurnTarget 权威源:register-pm-commands.ts registerSlashTurn(...);
 * TurnTarget(kebab)→ atom.type(camel)在此显式登记,避免散落字符串。
 * paragraph/h1-h3 都落 paragraph|heading(渲染态 renderTextBlock),恒可渲。
 */
const SLASH_TURN_COMMAND_TO_ATOM_TYPE: Readonly<Record<string, string>> = {
  'text-editing.slash-turn-paragraph': 'paragraph',
  'text-editing.slash-turn-h1': 'heading',
  'text-editing.slash-turn-h2': 'heading',
  'text-editing.slash-turn-h3': 'heading',
  'text-editing.slash-turn-bullet': 'bulletList',
  'text-editing.slash-turn-ordered': 'orderedList',
  'text-editing.slash-turn-task': 'taskList',
  'text-editing.slash-turn-quote': 'blockquote',
  'text-editing.slash-turn-code': 'codeBlock',
  'text-editing.slash-turn-divider': 'horizontalRule',
  'text-editing.slash-turn-callout': 'callout',
  'text-editing.slash-turn-toggle': 'toggleList',
};

/**
 * 某 slash item 的目标块是否渲染态可渲。
 *
 * - turn-into item(在映射表内):查目标 atom.type 是否 ∈ RENDERABLE_ATOM_TYPES。
 * - 非 turn-into item(如 math-block,命令不在表内):放行 — 这些块本身就在渲染态支持内
 *   (mathBlock ∈ RENDERABLE_ATOM_TYPES),且不属本闸过滤对象。**未来若注册了
 *   渲染态不支持的非 turn-into 块,需在此显式登记其 atom.type 再判**(fail loud:
 *   宁可未来加一行,不静默放行黑洞)。
 */
export function isSlashItemRenderable(item: SlashItem): boolean {
  const atomType = SLASH_TURN_COMMAND_TO_ATOM_TYPE[item.command];
  if (atomType === undefined) {
    // 非 turn-into item(math-block 等);当前注册的此类项目标块均可渲,放行。
    return true;
  }
  return RENDERABLE_ATOM_TYPES.has(atomType);
}

/** 过滤掉渲染态渲不出的 slash item(守「编辑 ⊆ 渲染」不变量)。 */
export function filterSlashItemsToRenderable(items: SlashItem[]): SlashItem[] {
  return items.filter(isSlashItemRenderable);
}

/** 单测用:导出映射表(断言「graph 可插块 ⊆ 渲染态可渲块」时对照)。 */
export { SLASH_TURN_COMMAND_TO_ATOM_TYPE };
