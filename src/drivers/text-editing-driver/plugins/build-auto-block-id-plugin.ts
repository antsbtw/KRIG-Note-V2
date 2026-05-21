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
 * Split / Paste 语义(decision 026 §5.2 + §5.3,Stage 2 EM2 触发 dup-id 根因后修):
 * - PM split(用户按 Enter 拆 paragraph)字面**继承上方 attrs**(含 attrs.id)→ 下半 id 跟上半重复
 * - PM paste 字面把 clipboard 内 PM JSON(含原 id)插回 doc → 粘贴段携带来源 id,可能跟当前 doc 已有 id 重复
 * - 本 plugin 字面**一遍扫描去重**:descendants 内维护 seen Set,
 *   首次遇到某 id 字面保留(对齐 §5.3"上半保留"),后续重复出现字面重新生成新 ULID
 * - 与 attrs.id === null 注入路径合并到同一逻辑(needRegen = !id || seen.has(id))
 *
 * 历史 D-09 字面登记:Stage 1 提交时本 plugin 仅处理 (A) null → 注入;Stage 2 EM2 用户
 * 测试触发 split 字面 dup-id throw 后(2026-05-21),合并增加 (B) 重复检测 → 重生成。
 * Stage 7 T5 测试场景字面验收 paste 语义。
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

      // 一遍扫描:同时处理
      //   (A) attrs.id === null → 注入新 ULID
      //   (B) attrs.id 已存在 但在 doc 内**重复出现** → 给后出现的节点重生成新 ULID
      //
      // (B) 必要性(decision 026 §5.3 split + §5.2 paste 字面拍板):
      // - PM split 默认行为字面**继承**上方 node 的所有 attrs(含 attrs.id)
      //   → 下半字面有非 null id 但跟上半重复 → 必须**给下半**重生成(保上半 id,§5.3 字面)
      // - PM paste 字面把 clipboard 内的 PM JSON(含原 id)插回 doc
      //   → 粘贴段字面携带来源 id;若来源 id 已在当前 doc → 重生成(§5.2 字面"粘贴全部生成新 ULID")
      // - 同一遍扫描内"先出现保留 / 后出现新生成" 字面对齐 §5.3 split"上半保留"
      const seen = new Set<string>();

      newState.doc.descendants((node, pos) => {
        if (!shouldHaveId(node)) return true; // descend(列表/单元格内可能嵌套需要 id 的 block)

        const currentId = node.attrs.id as string | null;
        const needRegen =
          !currentId || // (A) null → 新建
          seen.has(currentId); // (B) 重复 → split 下半 / paste 复用 → 重生成

        if (!needRegen) {
          seen.add(currentId);
          return true;
        }

        const newId = generateUlid();
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newId });
        seen.add(newId);
        modified = true;
        return true;
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
