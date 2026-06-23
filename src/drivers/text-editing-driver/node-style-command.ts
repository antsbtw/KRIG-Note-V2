/**
 * node-style-command — 对一个文字节点整 doc 应用 note 复用样式(L5-G5 / G5.4)
 *
 * 背景:画板文字节点平时只渲染成 SVG mesh(instance.doc = DriverSerialized),**没有
 * 挂载的 EditorView**(只有双击进编辑态才 mount Host + 注册 instanceRegistry)。所以
 * 不能像聚焦命令那样走 instanceRegistry.get(id).view —— 那对未编辑节点是空。
 *
 * 做法(headless,纯 doc 变换):
 *   DriverSerialized → deserializeDoc(用 ENABLED_BLOCKS 等价 schema)→ PMNode
 *   → 构一个无 view 的 EditorState → 整 doc 选中 → 跑命令(toggleMark/setMark/align/list)
 *   → serializeDoc(newState.doc) → DriverSerialized
 *
 * node-toolbar 不碰 PM:它只调 text-editing.runNodeStyleCommand(id, cmd),命令拿到
 * 新 doc 后由 view 走 canvas-rendering host.updateInstance(id,{doc}) 落地 + SVG 重渲染。
 * 全部 PM 机械都关在 driver 层(@drivers 允许 import prosemirror)。
 *
 * **只复用 note 既有 mark/命令**(bold/italic/underline/textColor/align/list),
 * 不含字号字体(那归 Type section instance 字段,不走 PM)。
 */

import { EditorState, AllSelection, TextSelection } from 'prosemirror-state';
import { toggleMark } from 'prosemirror-commands';
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { buildSchema, deserializeDoc, serializeDoc } from './schema-builder';
import { ENABLED_BLOCKS } from './enabled-blocks';
import type { DriverSerialized } from './types';

/** 整 doc 改样式命令(只含 note 原生能力,与 node-toolbar TextNodeStyleCommand 对齐) */
export type NodeStyleCommand =
  | { kind: 'toggleMark'; mark: 'bold' | 'italic' | 'underline' }
  | { kind: 'setTextColor'; color: string }
  | { kind: 'setAlign'; align: 'left' | 'center' | 'right' }
  | { kind: 'toggleList'; list: 'bullet' | 'ordered' };

// schema 与 Host 等价(同一 ENABLED_BLOCKS),lazy 构建一次复用
let cachedSchema: ReturnType<typeof buildSchema> | null = null;
function getSchema(): ReturnType<typeof buildSchema> {
  if (!cachedSchema) cachedSchema = buildSchema(ENABLED_BLOCKS);
  return cachedSchema;
}

/**
 * 对一个文字节点 doc 应用整 doc 样式命令,返回新 doc(无变化 / 失败返 null)。
 *
 * @param doc  当前 instance.doc(DriverSerialized,pm-doc-json)
 * @param cmd  样式命令
 * @returns 新 DriverSerialized,或 null(doc 不可解析 / 命令未产生变化)
 */
export function applyNodeStyleCommand(
  doc: DriverSerialized,
  cmd: NodeStyleCommand,
): DriverSerialized | null {
  const schema = getSchema();
  const pmDoc = deserializeDoc(doc, schema);
  if (!pmDoc) return null;

  const state = EditorState.create({ schema, doc: pmDoc });

  let nextDoc: PMNode | null = null;
  switch (cmd.kind) {
    case 'toggleMark':
      nextDoc = applyToggleMark(state, cmd.mark);
      break;
    case 'setTextColor':
      nextDoc = applyTextColor(state, cmd.color);
      break;
    case 'setAlign':
      nextDoc = applyAlign(state, cmd.align);
      break;
    case 'toggleList':
      nextDoc = applyToggleList(state, cmd.list);
      break;
  }

  if (!nextDoc) return null;
  return serializeDoc(nextDoc);
}

/** 整 doc 范围 [from,to](跳过 doc 边界,选所有可选内容) */
function fullRange(state: EditorState): { from: number; to: number } {
  const sel = new AllSelection(state.doc);
  return { from: sel.from, to: sel.to };
}

function applyToggleMark(
  state: EditorState,
  mark: 'bold' | 'italic' | 'underline',
): PMNode | null {
  const markType = state.schema.marks[mark];
  if (!markType) return null;
  // 整 doc 选中后 toggleMark:已全有则移除,否则补满(PM toggleMark 语义)
  const selState = state.apply(
    state.tr.setSelection(new AllSelection(state.doc)),
  );
  let captured: PMNode | null = null;
  toggleMark(markType)(selState, (tr) => {
    captured = selState.apply(tr).doc;
  });
  return captured;
}

function applyTextColor(state: EditorState, color: string): PMNode | null {
  const markType = state.schema.marks.textStyle;
  if (!markType) return null;
  const { from, to } = fullRange(state);
  if (from >= to) return null;
  const tr = state.tr;
  tr.removeMark(from, to, markType); // 先清旧色避免叠加
  if (color) tr.addMark(from, to, markType.create({ color }));

  // L5 一致性(用户拍板:着色应统一):文字 textStyle mark 之外,**带 color attr 的块**
  // (mathBlock 等,颜色是节点级 attr 而非 inline mark)也整 doc 同步设 attrs.color,
  // 否则节点上色时数学块不跟变(真机暴露)。color='' 清色 → attrs.color 设 null。
  // node-toolbar 整节点上色专用(graph),不影响 note 选区上色路径。
  const attrColor = color || null;
  state.doc.descendants((node, pos) => {
    if (node.attrs && 'color' in node.attrs && node.attrs.color !== attrColor) {
      tr.setNodeMarkup(pos, null, { ...node.attrs, color: attrColor });
    }
    return true;
  });

  return state.apply(tr).doc;
}

/**
 * 整 doc 每个支持 align 的顶层 block(paragraph / heading)设对齐。
 * 不支持 align 的 block(table / list 等)跳过。
 */
function applyAlign(
  state: EditorState,
  align: 'left' | 'center' | 'right',
): PMNode | null {
  const tr = state.tr;
  let changed = false;
  state.doc.forEach((node, offset) => {
    if (node.attrs?.align === undefined) return;
    if (node.attrs.align === align) return;
    tr.setNodeMarkup(offset, null, { ...node.attrs, align });
    changed = true;
  });
  return changed ? state.apply(tr).doc : null;
}

/**
 * 切换整 doc 为 列表 / 取消列表。
 *
 * - 若所有顶层块已是目标 list → 解列表(拆回内部 block)
 * - 否则 → 把每个顶层 paragraph/heading 包成 listItem,统一收进一个 list
 *
 * 复用 turnInto 的 wrap 语义(api.ts list 分支),但作用于整 doc 顶层。
 */
function applyToggleList(
  state: EditorState,
  list: 'bullet' | 'ordered',
): PMNode | null {
  const { schema } = state;
  const listName = list === 'bullet' ? 'bulletList' : 'orderedList';
  const listType = schema.nodes[listName];
  const itemType = schema.nodes.listItem;
  const paragraphType = schema.nodes.paragraph;
  if (!listType || !itemType || !paragraphType) return null;

  const topNodes: PMNode[] = [];
  state.doc.forEach((node) => topNodes.push(node));
  if (topNodes.length === 0) return null;

  const allTargetList = topNodes.every((n) => n.type.name === listName);

  const tr = state.tr;
  const fullFrom = 0;
  const fullTo = state.doc.content.size;

  if (allTargetList) {
    // 解列表:把每个 list 的 listItem 内部 block 提到顶层
    const lifted: PMNode[] = [];
    for (const listNode of topNodes) {
      listNode.forEach((item) => {
        item.forEach((inner) => lifted.push(inner));
      });
    }
    if (lifted.length === 0) return null;
    tr.replaceWith(fullFrom, fullTo, Fragment.fromArray(lifted));
  } else {
    // 包列表:仅 paragraph / heading 可入 listItem;其它顶层块原样保留
    const items: PMNode[] = [];
    let wrappedAny = false;
    for (const node of topNodes) {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        items.push(itemType.create(null, [node.copy(node.content)]));
        wrappedAny = true;
      }
    }
    if (!wrappedAny) return null;
    const listNode = listType.create(null, Fragment.fromArray(items));
    tr.replaceWith(fullFrom, fullTo, listNode);
  }

  // 选区归到文首,避免序列化携带无效 selection(headless 不关心光标)
  tr.setSelection(TextSelection.atStart(tr.doc));
  return state.apply(tr).doc;
}
