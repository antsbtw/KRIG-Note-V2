/**
 * text-editing-driver Host — 主 React 组件
 *
 * 见 DESIGN.md v0.2.1 § 2 + § 3 + § 4 + § 5。
 *
 * 关键契约(P1.1):props.doc / onChange 全程 DriverSerialized 信封,
 * 不暴露 PMDoc 给 view。driver 内部封装/解包。
 */

import { useEffect, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import { buildSchema, deserializeDoc, serializeDoc } from './schema-builder';
import { buildEditorView } from './editor-view-builder';
import { instanceRegistry } from './instance-registry';
import { registerSelectionSource, emitSelectionChanged } from './capability-integrations/selection-source';
import { registerUndoScope } from './capability-integrations/undo-scope';
import { registerDropTargets } from './capability-integrations/dnd-targets';
import { registerInsertionSafeguards } from './capability-integrations/insertion-safeguards';
import { setupFloatingToolbarTrigger } from './floating-toolbar-source';
import { paragraphSpec } from './blocks/paragraph/spec';
import { headingSpec } from './blocks/heading/spec';
import { listItemSpec } from './blocks/list-item/spec';
import { bulletListSpec } from './blocks/bullet-list/spec';
import { orderedListSpec } from './blocks/ordered-list/spec';
import { taskListSpec, taskItemSpec } from './blocks/task-list/spec';
import { blockquoteSpec } from './blocks/blockquote/spec';
import { codeBlockSpec } from './blocks/code-block/spec';
import { horizontalRuleSpec } from './blocks/horizontal-rule/spec';
import { hardBreakSpec } from './blocks/hard-break/spec';
import { calloutSpec } from './blocks/callout/spec';
import { toggleListSpec } from './blocks/toggle-list/spec';
import { unknownSpec } from './blocks/unknown/spec';
import { imageSpec } from './blocks/image/spec';
import { mathBlockSpec } from './blocks/math-block/spec';
import { mathInlineSpec } from './blocks/math-inline/spec';
import { noteLinkSpec } from './blocks/note-link/spec';
import { fileBlockSpec } from './blocks/file-block/spec';
import { fileLinkSpec } from './blocks/file-link/spec';
import { externalRefSpec } from './blocks/external-ref/spec';
import { audioBlockSpec } from './blocks/audio-block/spec';
import { videoBlockSpec } from './blocks/video-block/spec';
import { tweetBlockSpec } from './blocks/tweet-block/spec';
import { htmlBlockSpec } from './blocks/html-block/spec';
import { mathVisualSpec } from './blocks/math-visual/spec';
import {
  tableSpec,
  tableRowSpec,
  tableCellSpec,
  tableHeaderSpec,
} from './blocks/table';
import { columnListSpec, columnSpec } from './blocks/column-list';
import type { TextEditingHostProps, BlockSpec } from './types';

// L5-B3.2:全部启用的 block 列表(paragraph + heading + 6 新类 + 2 项 list-item/task-item)
// L5-B3.3:+ hardBreak(inline)
// L5-B4.3.1:+ unknown(schema 缺失节点占位 — md-to-pm 等转换层用)
// L5-B3.5:+ image(图片 block,3 态:placeholder / 普通图 / SVG;mediaStore 集成)
// L5-B3.6:+ mathBlock / mathInline(KaTeX 渲染,块级 + 行内 atom)
// L5-B3.7:+ table 系列 4 节点(table/tableRow/tableHeader/tableCell;
//          走 prosemirror-tables 库:tableEditing + columnResizing + 自定义 keymap)
// L5-B3.12:+ noteLink(inline atom — `[[note-title]]` 双链 KRIG 知识图谱基础)
// L5-B3.14:+ fileBlock / fileLink / externalRef(文件附件三件套;前两者字节进 mediaStore,
//          externalRef 仅存 URL — KRIG Graph 外部引用关系)
const ENABLED_BLOCKS: BlockSpec[] = [
  paragraphSpec,
  headingSpec,
  listItemSpec,
  bulletListSpec,
  orderedListSpec,
  taskItemSpec,
  taskListSpec,
  blockquoteSpec,
  codeBlockSpec,
  horizontalRuleSpec,
  hardBreakSpec,
  calloutSpec,
  toggleListSpec,
  unknownSpec,
  imageSpec,
  mathBlockSpec,
  mathInlineSpec,
  tableSpec,
  tableRowSpec,
  tableCellSpec,
  tableHeaderSpec,
  columnListSpec,
  columnSpec,
  noteLinkSpec,
  fileBlockSpec,
  fileLinkSpec,
  externalRefSpec,
  audioBlockSpec,
  videoBlockSpec,
  tweetBlockSpec,
  htmlBlockSpec,
  mathVisualSpec,
];

export function Host(props: TextEditingHostProps) {
  const { config, doc, onChange } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // onChange 用 ref 避免每次渲染重建 EditorView
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  // 记录本 Host 最后一次 emit 出去的 doc JSON 字符串 — 用于识别"广播回来的是我们自己刚 emit
  // 的那个 doc",此时跳过 useEffect 的 replaceWith 避免:
  //   1. 用户输入产生 tr → dispatchTransaction → onChange → updateNote → DB → broadcast →
  //      useAllNotes setState → NoteView 重渲 → 新 doc prop → useEffect 触发 deserialize+eq;
  //   2. eq 比较若任何细微差异(默认 attrs 序列化丢失 / 派生 title 顺带改动等)失败,
  //      tr.replaceWith(0, ..., newDoc.content) 会替换 doc,selection 被 PM mapping 推到
  //      末尾或前面 → 视觉上光标"跳"。
  // 改成"指纹比较":emit 时记下 JSON;收到 prop 变化时,先看 JSON 是否字面等于上次 emit
  // 的,若是 → 这是 echo-back,跳过(用户实际 PM state 已是最新)。
  const lastEmittedJsonRef = useRef<string | null>(null);

  // 初始化 EditorView(每个 instanceId 一个)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const schema = buildSchema(ENABLED_BLOCKS);
    const initialDoc = deserializeDoc(doc, schema);
    if (!initialDoc) {
      console.error('[text-editing-driver] deserialize failed; falling back to empty doc');
      return;
    }

    const view = buildEditorView(
      container,
      schema,
      ENABLED_BLOCKS,
      initialDoc,
      (tr, v) => {
        // doc 变化:封装回 DriverSerialized,触发 onChange
        if (tr.docChanged) {
          const serialized = serializeDoc(v.state.doc);
          // 记下指纹 — 用于识别 useEffect 收到的是 echo-back(避免重复 dispatch replaceWith)
          lastEmittedJsonRef.current = JSON.stringify(serialized.payload);
          onChangeRef.current?.(serialized);
        }
        // selection 变化:emit 到 selection capability(带实例 source)
        // L5-B2:Snapshot diff 真变才 emit
        emitSelectionChanged(v, config.instanceId);
      },
      config.viewId,
      config.instanceId,
      config.plugins,
    );

    viewRef.current = view;

    // 注册到 instance-registry(让单例命令 handler 路由到本实例)
    instanceRegistry.set(config.instanceId, {
      view,
      workspaceId: config.instanceId, // L5-A:instanceId == workspaceId
    });

    // 实例级 capability 注册
    const unregisterSource = registerSelectionSource(config.instanceId);
    const unregisterUndo = registerUndoScope(config.undoScope);
    const unregisterDnd = registerDropTargets(config.instanceId);
    const unregisterInsertion = registerInsertionSafeguards(config.instanceId);
    // L5-B3.1:floating-toolbar 监听 selection capability
    const unregisterFt = setupFloatingToolbarTrigger(view, config.viewId, config.instanceId);

    return () => {
      unregisterSource();
      unregisterUndo();
      unregisterDnd();
      unregisterInsertion();
      unregisterFt();
      instanceRegistry.delete(config.instanceId);
      view.destroy();
      viewRef.current = null;
    };
    // 依赖 instanceId / undoScope —— 实例 ID 变化时必须重建(doc 在另一个 useEffect 处理)
  }, [config.instanceId, config.undoScope, config.viewId]);

  // 外部 doc 变化(view 切笔记)→ 替换 PM doc
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // 1. echo-back 快路径:对比 prop.doc 的 JSON 字符串与 Host 上一次 emit 的指纹,
    //    一致说明这次 prop 变化就是用户输入引发的"DB roundtrip 回来",PM state 已是
    //    最新,不需要 replaceWith(否则会触发 selection jump = 光标跳)。
    const incomingJson = JSON.stringify(doc.payload);
    if (incomingJson === lastEmittedJsonRef.current) return;
    // 2. 真外部更新(切笔记 / 别处更新同 note doc)→ deserialize 并比 + replaceWith
    const schema = view.state.schema;
    const newDoc = deserializeDoc(doc, schema);
    if (!newDoc) return;
    if (view.state.doc.eq(newDoc)) return;
    const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content);
    tr.setMeta('addToHistory', false); // 切笔记不记入 history
    view.dispatch(tr);
  }, [doc]);

  return (
    <div
      ref={containerRef}
      className={`krig-pm-host ${props.className ?? ''}`}
      data-instance-id={config.instanceId}
    />
  );
}
