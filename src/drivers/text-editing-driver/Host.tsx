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
import { textBlockSpec } from './blocks/text-block/spec';
import { listItemSpec } from './blocks/list-item/spec';
import { bulletListSpec } from './blocks/bullet-list/spec';
import { orderedListSpec } from './blocks/ordered-list/spec';
import { taskListSpec, taskItemSpec } from './blocks/task-list/spec';
import { blockquoteSpec } from './blocks/blockquote/spec';
import { codeBlockSpec } from './blocks/code-block/spec';
import { horizontalRuleSpec } from './blocks/horizontal-rule/spec';
import type { TextEditingHostProps, BlockSpec } from './types';

// L5-B3.2:全部启用的 block 列表(textBlock + 6 新类 + 2 项 list-item/task-item)
const ENABLED_BLOCKS: BlockSpec[] = [
  textBlockSpec,
  listItemSpec,
  bulletListSpec,
  orderedListSpec,
  taskItemSpec,
  taskListSpec,
  blockquoteSpec,
  codeBlockSpec,
  horizontalRuleSpec,
];

export function Host(props: TextEditingHostProps) {
  const { config, doc, onChange } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // onChange 用 ref 避免每次渲染重建 EditorView
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

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
          onChangeRef.current?.(serialized);
        }
        // selection 变化:emit 到 selection capability(带实例 source)
        // L5-B2:Snapshot diff 真变才 emit
        emitSelectionChanged(v, config.instanceId);
      },
      config.viewId,
      config.instanceId,
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
    const schema = view.state.schema;
    const newDoc = deserializeDoc(doc, schema);
    if (!newDoc) return;
    // 比较当前 doc 跟新 doc,不同才替换(避免循环)
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
