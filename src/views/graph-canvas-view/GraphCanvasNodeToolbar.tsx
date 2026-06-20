/**
 * GraphCanvasNodeToolbar — canvas view 侧的 node-toolbar 接入(L5-G5)
 *
 * 把 node-toolbar(view-agnostic 共享 capability)接到 canvas:
 * - 锚定:RAF 循环拉 host.getSelectedScreenAABB() 持续重定位浮条
 *   (一把覆盖 拖/缩/转节点 + pan/zoom,无需分别订阅各事件)
 * - 快照:把选中 instance 拍平成 view-agnostic NodeSnapshot,解析语义 kind
 *   (shape / line / text)给 registry match
 * - 落地:patchStyle/patchInstance → host.updateInstance;
 *         textCommand → text-editing.runNodeStyleCommand(G5.4 接)
 *
 * 单选才出浮条;多选 / 无选不出(design §7)。把 G5 接入从 GraphCanvasView 主体拆出,
 * 保主体 LOC 红线 + G5 wiring 收敛在一处。
 *
 * **W5 边界**:view 层,允许 requireCapabilityApi 各 capability;0 import three/PM。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CanvasHostHandle, Instance } from '@capabilities/canvas-rendering/types';
import type { ShapeLibraryApi } from '@capabilities/shape-library/types';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type {
  NodeToolbarApi,
  NodeSnapshot,
  NodeSemanticKind,
  NodeStyleOverrides,
  ToolbarAnchor,
  TextNodeStyleCommand,
  SystemFontInfo,
  SystemFontEmbedResult,
} from '@capabilities/node-toolbar';
import type {
  fontListSystem as FontListSystemFn,
  fontProbeSize as FontProbeSizeFn,
  fontEmbed as FontEmbedFn,
} from '@capabilities/font-storage';
import { showFontEmbedConfirm } from './font-embed-confirm-popup';

/** 8MB 体积守卫阈值(设计 §10 拍板);超阈值才弹"较大"警示 */
const FONT_EMBED_WARN_BYTES = 8 * 1024 * 1024;

/** font-storage capability api 形态(requireCapabilityApi 间接拿,W5) */
interface FontStorageApi {
  fontListSystem: typeof FontListSystemFn;
  fontProbeSize: typeof FontProbeSizeFn;
  fontEmbed: typeof FontEmbedFn;
}

interface Props {
  hostRef: React.RefObject<CanvasHostHandle | null>;
  /** 当前选中 id 列表(view 主体订阅 onSelectionChange 拿) */
  selectedIds: string[];
  /** patch 落地后通知 view 触发防抖保存 */
  onChanged: () => void;
}

const TEXT_NODE_REF = 'krig.text.label';

/** 解析 instance 的语义 kind(registry match 用) */
function resolveKind(inst: Instance, shapeApi: ShapeLibraryApi): NodeSemanticKind {
  if (inst.ref === TEXT_NODE_REF) return 'text';
  if (inst.type === 'shape') {
    const shape = shapeApi.shapes.get(inst.ref);
    if (shape?.category === 'line') return 'line';
  }
  return 'shape';
}

export function GraphCanvasNodeToolbar({ hostRef, selectedIds, onChanged }: Props): React.ReactElement | null {
  const { NodeToolbar } = useMemo(
    () => requireCapabilityApi<NodeToolbarApi>('node-toolbar'),
    [],
  );
  const shapeApi = useMemo(() => requireCapabilityApi<ShapeLibraryApi>('shape-library'), []);
  const textEditing = useMemo(() => requireCapabilityApi<TextEditingApi>('text-editing'), []);
  const fontStorage = useMemo(() => requireCapabilityApi<FontStorageApi>('font-storage'), []);

  const [anchor, setAnchor] = useState<ToolbarAnchor | null>(null);
  const [node, setNode] = useState<NodeSnapshot | null>(null);

  // 单选才出浮条(多选 / 无选不出)
  const singleId = selectedIds.length === 1 ? selectedIds[0] : null;

  // 快照:选中 id 变化时重建(样式实时更新靠 RAF 循环里 refresh)
  const buildSnapshot = useCallback(
    (id: string): NodeSnapshot | null => {
      const inst = hostRef.current?.getInstance(id);
      if (!inst) return null;
      return {
        id: inst.id,
        kind: resolveKind(inst, shapeApi),
        ref: inst.ref,
        style_overrides: inst.style_overrides as NodeSnapshot['style_overrides'],
        text_font: (inst as Instance & { text_font?: string }).text_font,
        text_size: (inst as Instance & { text_size?: number }).text_size,
      };
    },
    [hostRef, shapeApi],
  );

  // ── 锚定 + 快照刷新:RAF 循环,单选期间持续跑 ──
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!singleId) {
      setAnchor(null);
      setNode(null);
      return;
    }
    let lastKey = '';
    const tick = (): void => {
      const host = hostRef.current;
      if (host) {
        const aabb = host.getSelectedScreenAABB();
        // 只在变化时 setState(避免每帧 re-render)
        const key = aabb ? `${aabb.x | 0},${aabb.y | 0},${aabb.w | 0},${aabb.h | 0}` : 'null';
        if (key !== lastKey) {
          lastKey = key;
          setAnchor(aabb);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    setNode(buildSnapshot(singleId));
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [singleId, hostRef, buildSnapshot]);

  // ── 落地回调 ──
  const handlePatchStyle = useCallback(
    (patch: NodeStyleOverrides): void => {
      if (!singleId) return;
      hostRef.current?.updateInstance(singleId, { style_overrides: patch } as Partial<Instance>);
      setNode(buildSnapshot(singleId));
      onChanged();
    },
    [singleId, hostRef, buildSnapshot, onChanged],
  );

  const handlePatchInstance = useCallback(
    (patch: Partial<NodeSnapshot>): void => {
      if (!singleId) return;
      // 只透传画板专属字段(text_font/text_size);id/kind/ref/style 不经此路。
      // ★ 只挑 patch 里**真正出现**的 key,绝不补 undefined —— 否则只改字体时
      //   text_size=undefined 会被 updateInstance 的 {...current,...patch} 覆盖掉真值,
      //   导致"换字体把字号重置成默认 14"(bug 修复)。
      // NodeSnapshot.text_font 是 view-agnostic 的 string;Instance.text_font 是窄枚举,
      // 边界处收窄(下拉选项就是这几个值,运行时安全)。
      const next: Partial<Instance> = {};
      if ('text_font' in patch) next.text_font = patch.text_font as Instance['text_font'];
      if ('text_size' in patch) next.text_size = patch.text_size;
      if (Object.keys(next).length === 0) return;
      hostRef.current?.updateInstance(singleId, next);
      setNode(buildSnapshot(singleId));
      onChanged();
    },
    [singleId, hostRef, buildSnapshot, onChanged],
  );

  const handleTextCommand = useCallback(
    (cmd: TextNodeStyleCommand): void => {
      // ── runTextCommand view 落地契约(G5.4,family-tree 等接入照此四步)──
      // 1) 取 doc  2) 调 driver headless 纯函数  3) updateInstance 写回  4) 刷新浮条快照
      if (!singleId) return;
      const inst = hostRef.current?.getInstance(singleId);
      if (!inst?.doc) {
        console.warn('[node-toolbar] runTextCommand 跳过:节点无 doc', { id: singleId, cmd });
        return;
      }
      // G5.4:headless 整 doc 改 note mark/命令(画板文字节点平时无挂载 PM 实例)。
      // TextNodeStyleCommand 与 driver NodeStyleCommand 同形,直接透传。
      const nextDoc = textEditing.api.runNodeStyleCommand(
        inst.doc as Parameters<TextEditingApi['api']['runNodeStyleCommand']>[0],
        cmd as Parameters<TextEditingApi['api']['runNodeStyleCommand']>[1],
      );
      if (!nextDoc) {
        // 不写盘:命令无变化属正常;doc 不可解析属脏数据 —— fail loud 留痕便于排查
        console.warn('[node-toolbar] runTextCommand 无结果(命令无变化或 doc 不可解析)', { id: singleId, cmd });
        return;
      }
      hostRef.current?.updateInstance(singleId, { doc: nextDoc } as Partial<Instance>);
      setNode(buildSnapshot(singleId)); // 刷新浮条快照,漏了会"改了但浮条不更新"
      onChanged();                      // 触发防抖保存(与 patchStyle/patchInstance 一致,持久化文字色/对齐)
    },
    [singleId, hostRef, textEditing, buildSnapshot, onChanged],
  );

  // ── L5-G7:系统字体列表 + 嵌入(带 8MB 守卫 + license 确认弹窗)──
  const handleListSystemFonts = useCallback(
    (): Promise<SystemFontInfo[]> => fontStorage.fontListSystem(),
    [fontStorage],
  );

  const handleEmbedSystemFont = useCallback(
    async (font: SystemFontInfo): Promise<SystemFontEmbedResult | null> => {
      // 1) 预估体积(.ttc 抽出子字体的真实大小)→ 决定是否超 8MB 阈值
      const probe = await fontStorage.fontProbeSize(font.path, font.fontIndex);
      if (!probe.success) {
        // fail loud:该字体不可嵌入(格式不支持 / 抽取失败)
        console.warn('[font-embed] 该字体不可嵌入(probe 失败)', font.family);
        return null;
      }
      // 2) 确认弹窗(8MB 守卫 + license 提示);用户取消则不嵌
      const confirmed = await showFontEmbedConfirm({
        family: font.family,
        sizeKb: probe.sizeKb,
        overThreshold: probe.sizeKb * 1024 > FONT_EMBED_WARN_BYTES,
      });
      if (!confirmed) return null;
      // 3) 真嵌入 → 落盘 font:// → 返回 fontId
      const res = await fontStorage.fontEmbed(font.path, font.fontIndex, {
        family: font.family,
        style: font.style,
      });
      if (!res.success || !res.fontId) {
        console.warn('[font-embed] 嵌入失败', font.family, res.error);
        return null;
      }
      return { fontId: res.fontId, family: font.family };
    },
    [fontStorage],
  );

  if (!singleId || !anchor || !node) return null;

  return (
    <NodeToolbar
      anchor={anchor}
      node={node}
      onPatchStyle={handlePatchStyle}
      onPatchInstance={handlePatchInstance}
      onTextCommand={handleTextCommand}
      onListSystemFonts={handleListSystemFonts}
      onEmbedSystemFont={handleEmbedSystemFont}
    />
  );
}
