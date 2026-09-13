/**
 * mind 语义面(note tab)的编辑菜单 —— 独立 viewId
 *
 * ⚠️⚠️ **为什么必须独立 viewId**(用户质疑「是不是阉割了 note 编辑器」时查出来的):
 *
 * plugin 我一个都没关(config 里没写 `plugins`,走 driver 默认全开)。
 * 但 slash / handle / floating-toolbar 的**菜单内容是按 viewId 注册的** ——
 * 每个 item 带 `view: <viewId>`,registry 按它过滤。
 *
 * ⭐ 而 `graph-canvas-view` 已注册的那套是给**画布文字节点**用的,只有 6 项,
 * 且 slash 被一道**渲染态闸**筛过(见 slash-render-gate.ts):
 * > 不变量:graph 编辑态能插的块 ⊆ 渲染态(atomsToSvg)能渲的块
 * > 否则插了渲不出的块 → Esc 后渲成灰字占位 / 丢内容(「功能黑洞」)
 *
 * ⚠️ 那道闸对画布节点是**必要**的(节点内容要 atomsToSvg 渲成 mesh),
 * 但 **note tab 不经过 atomsToSvg** —— 它就是普通 note 编辑器,渲的是 DOM。
 * 两者需求相反,**共用 viewId 就只能二选一**:
 *   放开 → 画布节点出功能黑洞;不放开 → note tab 残废。
 *
 * ⭐ 解法(用户拍板 A):note tab 用**自己的 viewId**,注册完整一套。
 * 链路已核实:`config.viewId` → editor-view-builder → buildBlockHandlePlugin(viewId)
 * → handleMenuController.open(viewId) → handleRegistry.getItemsForBlock(viewId)。
 * registry 对 viewId 无白名单,任意字符串都认。
 *
 * ⚠️ note 业务专属项(外部引用 / AI 同步 / 7 业务插入)**不注册** ——
 * 它们依赖 note 的数据模型,在导图语境下没有落点。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';
import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';
import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { buildDefSkeleton, nextDefAlias } from '@capabilities/diglot-model/def-block';

/**
 * ⭐ 语义面专属 viewId —— 与 `graph-canvas-view`(画布节点)刻意区分。
 * 导出给 MindSemanticPane 的 `config.viewId` 用,两处必须一致。
 */
export const MIND_SEMANTIC_VIEW_ID = 'mind-semantic';

/** `/def` 的命令 id —— ⚠️ mind 专属,不进 text-editing 共用命令表。 */
export const MIND_DEF_COMMAND = 'diglot-mind.insert-def-block';

/**
 * 扫出该文档已用的别名(`id: X` 行)。
 *
 * ⚠️ 用**宽松正则**扫全文,不重建一遍解析器 —— 这里只为「别撞车」:
 * 多扫到几个(正文里恰好写了 `id: A`)只会让新别名更靠后,**不会出错**;
 * ⭐ 漏扫才危险(会发出撞车的别名),故宁可宽。
 */
function collectUsedAliases(text: string): string[] {
  const out: string[] = [];
  const re = /^\s*id\s*:\s*(\S+)\s*$/gm;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.push(m[1]);
  return out;
}

let registered = false;

/**
 * 注册语义面的完整编辑菜单。
 * ⚠️ 幂等:多个导图共用同一套注册(菜单按 viewId 不按文档),重复注册会堆重复项。
 */
export function registerMindSemanticMenus(): void {
  if (registered) return;
  registered = true;

  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui;
  const V = MIND_SEMANTIC_VIEW_ID;

  // ── ⭐⭐ `/def` 图定义块(`00 §2.5.7`)──
  //
  // ⚠️ 光有 `+++` 记号不够:**用户不知道要写什么**(`id:` 还是 `ID:`?
  //   `-.->` 还是 `-->`?)。slash 一敲给骨架,并**自动分配别名** ——
  //   方案丙「系统兜底」的自然落点。
  //
  // ⭐⭐ **名字只有一个,入口可以很多**(用户 2026-09-13):
  //   文档与代码只认 `def`,但 `/meta`、`/图元`、`/graphmeta` 都搜得到同一项。
  //
  // ⚠️ 注册在**本模块**(mind 专属 viewId),不进 text-editing 的共用命令表 ——
  //   def 块是图种语义,不该渗进 note 本体。
  commandRegistry.register(MIND_DEF_COMMAND, () => {
    const te = requireCapabilityApi<TextEditingApi>('text-editing');
    const instanceId = te.instanceRegistry.getFocusedInstanceId();
    if (!instanceId) {
      // ⚠️ fail loud:静默 return 的话用户「点了没反应」且无从排查
      console.error('[mind] /def:没有聚焦的编辑器,已跳过');
      return;
    }
    te.api.clearSlashTrigger(instanceId);
    // ⭐ 别名躲开该文档已用的(nextDefAlias 取第一个没被占的)
    const md = te.api.getDocMarkdown(instanceId);
    te.api.insertJsonNodeAtSelection(
      instanceId,
      buildDefSkeleton(nextDefAlias(collectUsedAliases(md.markdown))),
    );
  });

  slashRegistry.register([
    {
      id: `${V}.slash.def`,
      label: 'Graph Definition',
      command: MIND_DEF_COMMAND,
      // ⭐ 多入口:用户按自己的说法搜,都命中同一项
      keywords: ['def', 'graphdef', 'meta', 'graphmeta', 'diagram', '定义', '图元', 'gd'],
      view: V,
      group: 'advanced',
      icon: 'share-2',
      hint: '+++',
      order: 150,
    },
  ]);

  // ── slash:块类型转换 + 数学 / mermaid / html 块 ──
  // ⭐ 不经渲染态闸:note tab 渲的是 DOM,不是 atomsToSvg
  slashRegistry.register([
    ...ui.slashMenu.createTurnIntoItems(V),
    ui.slashMenu.createMathBlockItem(V),
    ui.slashMenu.createMermaidBlockItem(V),
    ui.slashMenu.createHtmlBlockItem(V),
    ui.slashMenu.createMathVisualBlockItem(V),
  ]);

  // ── ⋮⋮ handle 菜单:转换 / 颜色 / 格式 / 折叠 / 块操作 ──
  // ⚠️ 这一整块 graph-canvas-view **一项都没注册**,所以之前点手柄是空的
  handleRegistry.register([
    ui.handleMenu.createTurnIntoContainer(V),
    ui.handleMenu.createColorContainer(V),
    ui.handleMenu.createFormatContainer(V),
    ...ui.handleMenu.createTurnIntoSubmenu(V),
    ui.handleMenu.createHeadingCollapseItem(V),
    ...ui.handleMenu.createBlockActions(V),
  ]);

  // ── 选中文字的浮动工具条 ──
  floatingToolbarRegistry.register([
    ...ui.floatingToolbar.createMarkButtons(V),
    ui.floatingToolbar.createMathButton(V),
    ui.floatingToolbar.createLinkButton(V),
    ui.floatingToolbar.createColorButton(V),
  ]);
}
