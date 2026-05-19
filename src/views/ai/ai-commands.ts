/**
 * AI View 命令注册
 *
 * 命令字符串引用机制(charter § 1.2 注册原则):
 * - 跨 view 调用走 commandRegistry.execute('ai-view.<action>', ...args)
 * - 其他 view (Note / Thought) 走 'ai-view.ask' 把选中文字发给 AI
 *
 * Phase 3:仅注册基础命令(ask / switch-service)。Phase 4 加 Note 集成路径。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { getCapabilityApi, requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { AIConversationApi } from '@capabilities/ai-conversation/types';
import type { ThoughtCapabilityApi } from '@capabilities/thought/types';
import { aiMarkdownToNoteDoc, wrapAITurnsInToggle } from '@shared/ai-markdown-parser';
import { setAIServiceId, getAIWsState } from './data-model';
import { getAIServiceProfile, type AIServiceId } from '@shared/types/ai-service-types';

function isServiceId(v: unknown): v is AIServiceId {
  return v === 'chatgpt' || v === 'claude' || v === 'gemini';
}

export function registerAICommands(): void {
  /**
   * 把当前 ws 的活跃 AI 服务切到 serviceId。
   */
  commandRegistry.register('ai-view.switch-service', (idArg: unknown) => {
    if (!isServiceId(idArg)) return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    setAIServiceId(wsId, idArg);
  });

  /**
   * SlotToggle dropdown — 在 right slot 打开指定 view(空白,无 payload)。
   * commandArg = 目标 viewId(e.g. 'note-view' / 'thought-view')。
   * 仿 note-view.open-right-slot 模式,本地版本服务 AI View 自身 toolbar SlotToggle。
   */
  commandRegistry.register('ai-view.open-right-slot', (viewId: unknown) => {
    if (typeof viewId !== 'string' || !viewId) return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const bus = workspaceManager.getBus(wsId);
    if (!bus) return;
    bus.slot.openRight(viewId);
  });

  /**
   * 关 right slot。SlotToggle 再次点击已激活项时触发。
   */
  commandRegistry.register('ai-view.close-right-slot', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const bus = workspaceManager.getBus(wsId);
    if (!bus) return;
    bus.slot.closeRight();
  });

  /**
   * 提取整页对话 → 创建 type='ai-response' thought atom → 切右槽到 Thought View。
   *
   * 本期简化版:从 SSE 缓存取"最新一次 AI 完整回复"作为 thought 内容。
   * - 优点:零依赖 V1 重型 extractor(~1800 行),立即可用
   * - 限制:只能拿最新一条 AI 回复(SSECaptureManager.getLatestResponse);
   *   多轮对话场景丢历史(仅记最近一次)
   * - 后续 sub-phase 接 V1 chatgpt-content-extractor / claude-api-extractor 等
   *   做完整 conversation 抓取(含所有 turn / artifact)
   */
  commandRegistry.register('ai-view.extract-conversation', async () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const aiState = ws.pluginStates['ai'] as { currentServiceId?: AIServiceId } | undefined;
    const serviceId = aiState?.currentServiceId;

    const ai = requireCapabilityApi<AIConversationApi>('ai-conversation');

    // Phase 10.B 主路径:整页对话提取(Claude:多 turn + artifact 真 API;
    // ChatGPT/Gemini:Phase 10.B.2/3 待补,目前回退 SSE 单 turn)
    if (!serviceId) {
      window.alert('AI 服务未指定');
      return;
    }
    const extraction = await ai.extractFull(serviceId);
    if (!extraction.success || !extraction.markdown) {
      window.alert(
        `提取失败:${extraction.error || '未知错误'}\n\n` +
        '- 请确保 AI Web 已加载到对话页(claude.ai/chat/xxx)\n' +
        '- 并已登录;然后再试一次',
      );
      return;
    }

    // ── ai-sync 组合分支:左 AI + 右 Note → 整页 markdown 落入当前 Note ──
    // 用户预期:右槽 Note 是当前工作面,提取按钮应"把对话整页 dump 进 Note",
    // 而不是抢走右槽切到 Thoughts(那是用户没开 Note 时的 fallback)。
    //
    // 整页 markdown 已含多 turn + ## 用户 / ## AI heading 分隔,直接转 PM doc 插入,
    // 不再用 ❓+🔀 单 turn 包装(那是 ai-sync 增量同步专用)。
    //
    // 插入位置:走 driver insertNodesAtCursorOrEnd —
    //   - PM 编辑器 hasFocus()=true(用户点过 Note 里面)→ 光标所在 block 之后
    //   - hasFocus()=false → 文末
    // 走 note-view.append-pm-nodes 命令(cross-view 标准入口),不直依赖 note 模块。
    if (ws.slotBinding.left === 'ai-view' && ws.slotBinding.right === 'note-view') {
      const envelope = aiMarkdownToNoteDoc(extraction.markdown);
      const pmDoc = envelope.payload as { content?: unknown[] };
      const rawNodes = Array.isArray(pmDoc.content) ? pmDoc.content : [];
      // 每轮 AI 回答外套 toggleList(label="回答 (服务名)");用户提问 / 顶部元数据 / hr 不动
      const serviceName = getAIServiceProfile(serviceId).name;
      const nodes = wrapAITurnsInToggle(rawNodes, serviceName);
      if (nodes.length === 0) {
        console.warn('[ai-view.extract] 整页 markdown 转空 doc,回退 Thought 链路');
      } else {
        const ok = commandRegistry.execute('note-view.append-pm-nodes', {
          nodes,
          mode: 'cursor-or-end',
        });
        if (!ok) {
          console.warn('[ai-view.extract] append-pm-nodes returned false, 回退 Thought 链路');
          // PM 实例未挂(罕见,note 还没加载?)— 回退老链路避免提取丢失
        } else {
          return; // ai-sync 路径完成,不走 Thought
        }
      }
    }

    const thought = requireCapabilityApi<ThoughtCapabilityApi>('thought');
    // Phase 10.A:走 ResultParser + extractedBlocksToPmDoc 无损渲染
    // (不再 markdown.split('\n\n'):标题/数学/代码/表格/列表/引用/inline marks 全保留)
    const doc = aiMarkdownToNoteDoc(extraction.markdown);

    // 路径分支:有 pending(场景 A:Note Ask AI)→ update 已 preCreate 的 atom
    //         无 pending(场景 B:独立 AI 聊天)→ createNew 独立 atom
    const pendingThoughtId = serviceId ? ai.consumePendingAIThought(serviceId) : null;
    let thoughtIdToActivate: string;
    if (pendingThoughtId) {
      const updated = await thought.updateThought(pendingThoughtId, { doc });
      if (!updated) {
        // pending atom 已被外部删了(罕见):回退创新
        console.warn('[ai-view.extract] pending thought gone, fallback createNew');
        const created = await thought.createThought({
          type: 'ai-response',
          resolved: false,
          pinned: false,
          serviceId,
          doc,
          folderId: null,
          anchor: null,
        });
        thoughtIdToActivate = created.id;
      } else {
        thoughtIdToActivate = pendingThoughtId;
      }
    } else {
      const created = await thought.createThought({
        type: 'ai-response',
        resolved: false,
        pinned: false,
        serviceId,
        doc,
        folderId: null,
        anchor: null,
      });
      thoughtIdToActivate = created.id;
    }

    const bus = workspaceManager.getBus(wsId);
    if (bus) {
      bus.slot.openRight('thought-view');
      bus.channels.emit('thought.activate', { thoughtId: thoughtIdToActivate });
    }
  });

  /**
   * 端到端 askAI:给当前 ws 的活跃 AI 服务发 prompt,等回复(broadcast 自动推 onAIResponseReady)。
   *
   * Phase 6 改"问 AI"为对话式(开 AI Web + paste + 用户主导)后,本命令保留作为
   * "静默 askAI"路径(供测试 / 程序化调用),不被 UI 直接触发。
   *
   * 调用方式:
   *   commandRegistry.execute('ai-view.ask', '请总结这段话')
   *   commandRegistry.execute('ai-view.ask', { prompt: '...', serviceId: 'chatgpt' })
   */
  commandRegistry.register('ai-view.ask', async (arg: unknown) => {
    const ai = getCapabilityApi<AIConversationApi>('ai-conversation');
    if (!ai) {
      console.warn('[ai-view.ask] ai-conversation capability not registered');
      return;
    }
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const wsState = getAIWsState(ws);

    let prompt: string;
    let serviceId: AIServiceId = wsState.currentServiceId;
    if (typeof arg === 'string') {
      prompt = arg;
    } else if (arg && typeof arg === 'object') {
      const a = arg as { prompt?: unknown; serviceId?: unknown };
      if (typeof a.prompt !== 'string' || !a.prompt) return;
      prompt = a.prompt;
      if (isServiceId(a.serviceId)) serviceId = a.serviceId;
    } else {
      return;
    }
    // fire-and-forget — 结果通过 onAIResponseReady / onAIError 广播
    void ai.askAI(serviceId, prompt);
  });
}
