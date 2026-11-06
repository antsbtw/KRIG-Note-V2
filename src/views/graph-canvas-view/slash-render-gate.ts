/**
 * graph 编辑态 slash/turn-into 渲染态闸 —— 薄包装
 *
 * 实现已挪到 lib/atom-serializers/svg/slash-render-gate.ts(2026-11-06,math-visual 说明卡片共用)。
 * 这里保留原导出名,画板注册处与既有单测不用改。画板额外屏蔽 toggleList 的规则也在共用文件里
 * (GRAPH_SLASH_DENY_ATOM_TYPES,作为缺省 deny)。
 */
export {
  isSlashItemRenderable,
  filterSlashItemsToRenderable,
  SLASH_TURN_COMMAND_TO_ATOM_TYPE,
  SLASH_INSERT_COMMAND_TO_ATOM_TYPE,
  GRAPH_SLASH_DENY_ATOM_TYPES,
} from '../../lib/atom-serializers/svg/slash-render-gate';
