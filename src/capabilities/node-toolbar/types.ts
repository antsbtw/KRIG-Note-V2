/**
 * node-toolbar capability — 对外类型(L5-G5)
 *
 * Graph 节点浮条:选中画板节点 → 选中框正下方居中浮出 pill 工具条 → 按节点类型
 * 注册声明哪几个属性面板(Fill / Line / Text / Type)→ 改属性节点实时更新。
 *
 * ★ view-agnostic:section 只认 SectionContext(node 快照 + 回调),完全不知道自己
 *   跑在 canvas 还是 family-tree。任何 Graph view 都能复用本浮条。
 *
 * **W5 严格态 A 边界**:本 capability 0 直接 import three / prosemirror / @drivers 运行时。
 * 改 instance 走 view 注入的 patchStyle/patchInstance(view 端落地到 canvas-rendering host);
 * 改文字 mark 走 runTextCommand(view 端落地到 text-editing.runNodeStyleCommand)。
 *
 * 详见 docs/RefactorV2/stages/L5G5-node-floating-toolbar-design.md v0.3。
 */

import type { FC, ReactNode } from 'react';
import type { FillStyle, LineStyle, ArrowStyle } from '@capabilities/shape-library/types';

// ─────────────────────────────────────────────────────────
// 节点快照(view → 浮条,view-agnostic)
// ─────────────────────────────────────────────────────────

/**
 * style_overrides 形态(对齐 canvas-rendering Instance.style_overrides;此处独立声明
 * 以免 node-toolbar 反向依赖 canvas-rendering 内部 Instance 类型).
 */
export interface NodeStyleOverrides {
  fill?: Partial<FillStyle>;
  line?: Partial<LineStyle>;
  arrow?: Partial<ArrowStyle>;
}

/**
 * 浮条要展示的语义节点种类(由 view 解析后填进快照;node-toolbar 不查 shape-library).
 * - 'shape':普通几何形(矩形/圆/…)→ Fill + Line
 * - 'line' :线条(无 Fill,有箭头端点)→ Line + Arrow
 * - 'text' :文字节点 → Fill + Text + Type
 * - 其它(family-tree person 等):view 自定义,registry 自行 match
 */
export type NodeSemanticKind = 'shape' | 'line' | 'text' | (string & {});

/**
 * 节点快照 — view 把选中节点拍平成这个 view-agnostic 形态喂给浮条.
 * section 只读这个,不读具体 view / instance.
 */
export interface NodeSnapshot {
  /** instance / 节点 id */
  id: string;
  /** 语义种类(view 解析,registry 据此 match) */
  kind: NodeSemanticKind;
  /** 引用的 shape/substance ref(registry 进一步细分时可用) */
  ref: string;
  /** 当前样式覆盖(Fill/Line section 读它显示当前值) */
  style_overrides?: NodeStyleOverrides;
  /** 画板专属:字体族(Type section;undefined = auto 自动选) */
  text_font?: string;
  /** 画板专属:字号 pt(Type section;undefined = 默认) */
  text_size?: number;
}

// ─────────────────────────────────────────────────────────
// 文字命令(Text section → view → text-editing.runNodeStyleCommand)
// ─────────────────────────────────────────────────────────

/**
 * 对一个文字节点整 doc 应用的 note 复用命令(只含 note 原生 mark/命令,无字号字体).
 * view 端转发到 text-editing.runNodeStyleCommand(instanceId, cmd).
 */
export type TextNodeStyleCommand =
  | { kind: 'toggleMark'; mark: 'bold' | 'italic' | 'underline' }
  | { kind: 'setTextColor'; color: string }
  | { kind: 'setAlign'; align: 'left' | 'center' | 'right' }
  | { kind: 'toggleList'; list: 'bullet' | 'ordered' };

// ─────────────────────────────────────────────────────────
// registry 三件套(SectionDef + SectionContext + NodeBinding)
// ─────────────────────────────────────────────────────────

/**
 * 一条可选系统字体(L5-G7;view 注入 listSystemFonts 时回传)。
 * 形态与 main 进程 SystemFontEntry / IPC DTO 同形,此处独立声明保 view-agnostic。
 */
export interface SystemFontInfo {
  family: string;
  style: string;
  path: string;
  fontIndex: number;
  format: 'ttf' | 'otf' | 'ttc';
  supported: boolean;
}

/**
 * 容器给 section 的上下文(section 只认这个,不认具体 view).
 */
export interface SectionContext {
  /** view-agnostic 节点快照 */
  node: NodeSnapshot;
  /** 改 fill/line/arrow(走 view 注入 → canvas-rendering host.updateInstance) */
  patchStyle: (patch: NodeStyleOverrides) => void;
  /** 改 text_font/text_size 等画板专属字段(走 view 注入 → host.updateInstance) */
  patchInstance: (patch: Partial<NodeSnapshot>) => void;
  /** 改文字 mark(走 view 注入 → text-editing.runNodeStyleCommand;Text section 用) */
  runTextCommand: (cmd: TextNodeStyleCommand) => void;
  /** 收起当前面板 */
  close: () => void;
  /**
   * L5-G7b:列本机系统字体(view 注入,走 font-storage capability IPC)。
   * 未注入 = 该 view 不支持系统字体,Text section 只显「默认」。
   * 记名方案:选一个 → 直接 patchInstance({ text_font: 'sysname:<family>' }),**不嵌入**
   * (本机渲染按名读 buffer,对方没装回退打包字体,唯导出时 outline 进产物)。
   */
  listSystemFonts?: () => Promise<SystemFontInfo[]>;
}

/**
 * 一个 section 的纯声明(不绑定具体节点).
 */
export interface SectionDef {
  /** 'fill' | 'line' | 'arrow' | 'text' | 'type' | 插件自定义 */
  id: string;
  /** 短标题(无障碍 / tooltip) */
  title: string;
  /** trigger 视觉(可读当前值预览,如 Fill 显示当前填充色圆点) */
  icon: (ctx: SectionContext) => ReactNode;
  /** 展开面板 */
  Panel: FC<SectionContext>;
  /** 运行时再过滤(如 arrow 选中才显) */
  visibleWhen?: (ctx: SectionContext) => boolean;
}

/**
 * 节点类型 → 它要哪几个 section(注册式组合核心,数量无上限).
 */
export interface NodeBinding {
  /** 命中判定(view-agnostic:只读 NodeSnapshot) */
  match: (node: NodeSnapshot) => boolean;
  /** 命中后展示的 section id 列表(按声明顺序排布;数量无上限) */
  sections: string[];
}

// ─────────────────────────────────────────────────────────
// 容器锚点 + 对外 API
// ─────────────────────────────────────────────────────────

/** 选中框在容器内的 CSS 像素矩形(view 通过 host.getSelectedScreenAABB 拿) */
export interface ToolbarAnchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** NodeToolbar 组件 props(view 控数据 + 落地回调) */
export interface NodeToolbarProps {
  /** 选中框锚点;null = 不渲染浮条(无选中 / 多选不出) */
  anchor: ToolbarAnchor | null;
  /** 选中节点快照;null = 不渲染 */
  node: NodeSnapshot | null;
  /** 落地:改 style_overrides */
  onPatchStyle: (patch: NodeStyleOverrides) => void;
  /** 落地:改画板专属字段(text_font/text_size) */
  onPatchInstance: (patch: Partial<NodeSnapshot>) => void;
  /** 落地:改文字 mark */
  onTextCommand: (cmd: TextNodeStyleCommand) => void;
  /** L5-G7b:列系统字体(可选;不传 = Text section 只显「默认」)。选了直接记名,无嵌入步骤。 */
  onListSystemFonts?: () => Promise<SystemFontInfo[]>;
}

/**
 * node-toolbar capability 对外 API(view 通过 requireCapabilityApi('node-toolbar') 拿).
 */
export interface NodeToolbarApi {
  /** 浮条容器组件(view 挂在画板顶层) */
  NodeToolbar: FC<NodeToolbarProps>;
  /** section 注册(插件 / 其它 view 扩展用) */
  registerSection: (def: SectionDef) => void;
  /** 节点类型 → section 绑定注册(插件 / 其它 view 扩展用) */
  registerNodeBinding: (binding: NodeBinding) => void;
  /** 按节点快照解析出应展示的 SectionDef[](容器内部用;暴露便于测试 / 其它 view) */
  resolveSections: (node: NodeSnapshot) => SectionDef[];
}
