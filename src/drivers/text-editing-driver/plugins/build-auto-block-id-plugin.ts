/**
 * auto-block-id-plugin — L7 block 独立化 sub-phase Stage 1 Step 1.4
 *
 * 实施依据:
 * - decision 026 §5.1 用户敲 Enter 新建 paragraph 自动注入 ULID
 * - decision 026 §5.2 Copy/Paste 全部生成新 ULID(粘贴语义)
 * - decision 026 §5.3 Split 上半保留 / 下半新 ULID
 * - decision 026 §5.4 Merge 保留上方 ULID
 * - decision 026 §5.6 undo/redo PM history 精确回滚(history tr 不重新注入)
 * - 实施计划 §2.3 Step 1.4 / §2.4 EM1 验收第 5 条
 *
 * 关键防御(decision 026 §12.2 第 6 行 audit 拍板):
 * - tr.setMeta('addToHistory', false) — 沿 feedback_pm_internal_attr_write_must_mark_no_history
 *   id 注入是结构性 noise,不能进 undo stack(否则 Cmd+Z 一次撤销文本 + 一次撤销 id)
 * - tr.setMeta('skipOnChange', true) — 冷启动 race 防御
 *   旧 doc 装载完 appendTransaction 自动注入会触发 N atom 写入(每 block 一次 IPC 是浪费);
 *   Host.tsx onChange handler 检查 skipOnChange meta → true 不发 IPC,旧 doc 通过 Stage 6
 *   migration 一次性补 id,不依赖运行时 N 次写入(idempotent)
 *
 * 适用范围(decision 026 §3.1 拆分清单字面):
 * - 加 id:叶子 + 叶子级容器(group='block' 且非结构性容器)— 详 SHOULD_HAVE_ID
 * - 不加 id:结构性容器(table / tableRow / bulletList / orderedList / taskList / columnList)
 * - inline 节点不动(group='inline':hardBreak / fileLink / noteLink / mathInline / 等)
 *
 * 注:appendTransaction 默认对每个 transaction 都跑一遍 — 含 history transaction(undo/redo)。
 * undo 后 attrs.id 字面已被 PM history 精确回滚(decision 026 §5.6),plugin 检查"无 id"才
 * 注入 → undo/redo 触发不会重复注入(idempotent)。
 *
 * Copy/Paste 语义(decision 026 §5.2):
 * - 粘贴的 PM tr 内 node attrs.id 字面 = 来源 doc 的旧 ULID
 * - 但粘贴 paste tr 是 user transaction(非 history)→ 本 plugin 看到的 newState 含旧 id
 * - 直接简化:本 plugin **不区分**粘贴场景,**永远只为无 id 的 node 注入**
 *   → 粘贴的 node 字面保留来源 id(违反 §5.2 拍板"粘贴全部生成新 id")
 *   ⚠ 此偏差留 D-09 字面登记,Stage 7 测试 T5 验收 + 后续 commit 加 paste hook
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { generateUlid } from '@shared/ulid';

export const autoBlockIdKey = new PluginKey('auto-block-id');

/**
 * 结构性容器:用户从不单独引用,childOf 边跨层跳过,本 plugin 不注入 id。
 * 详 decision 026 §3.1.2。
 *
 * ⚠ 同步更新提示:未来引入新结构性容器 block 类型(如 grid / flexbox / layout 等)时,
 * 必须把节点 type.name 加入此 Set,否则 plugin 会错误地给容器注 id。
 * 同步登记到 decision 026 §13.8 硬编码扩展机制。
 */
const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'table',
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);

/**
 * 字面判断:此 node 是否应该有 attrs.id。
 * - inline node 一律否(group='inline')
 * - block 但属于结构性容器 → 否
 * - 其他 group='block' 节点 → 是(沿 decision 026 §3.1.1 字面清单)
 */
function shouldHaveId(node: PMNode): boolean {
  if (node.type.spec.group !== 'block') return false;
  if (STRUCTURAL_CONTAINER_TYPES.has(node.type.name)) return false;
  return true;
}

/**
 * L7 block atomization Stage 1.4 plugin。
 *
 * 工作原理:
 * - 每次 transaction 后扫描 doc 全树,发现 shouldHaveId(node) === true 且 attrs.id === null 的
 *   block,通过 setNodeMarkup 注入新 ULID
 * - 若有注入 → 整批 tr setMeta addToHistory:false + skipOnChange:true(防 history + 防 IPC)
 * - 若无注入 → 返回 null(PM 标准:不需要 appendTransaction 时返 null,避免空 tr 进 pipeline)
 */
export function buildAutoBlockIdPlugin(): Plugin {
  return new Plugin({
    key: autoBlockIdKey,
    appendTransaction(_transactions, _oldState, newState) {
      let tr = newState.tr;
      let modified = false;

      newState.doc.descendants((node, pos) => {
        if (!shouldHaveId(node)) return true; // descend into children(可能含需要 id 的子 node)
        if (node.attrs.id) return true;        // 已有 id,不重新生成(idempotent;undo 也走这条)

        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: generateUlid() });
        modified = true;
        return true; // 继续遍历(列表/单元格内可能嵌套需要 id 的 block)
      });

      if (!modified) return null;

      // decision 026 §5.6 + §12.2 第 6 行:id 注入是结构性 noise,不进 undo stack
      tr = tr.setMeta('addToHistory', false);
      // 冷启动 race 防御:Host onChange handler 检查 skipOnChange → true 不发 IPC
      tr = tr.setMeta('skipOnChange', true);
      return tr;
    },
  });
}
