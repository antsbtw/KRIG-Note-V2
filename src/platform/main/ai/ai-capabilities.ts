/**
 * ⭐⭐ AI 网页一问一答 —— 能力(Module5-04 第 6 步,2026-10-26)
 *
 *   ai.web.ask    给某个 workspace 开着的 AI 网页(claude / chatgpt / gemini)发一个问题,等完整回答带回来
 *   ai.web.pages  现在开着哪些 AI 网页(服务 / wcId / 网址 / 分区)—— 排查用
 *
 * 原来 askAI 只有 IPC 入口:要界面先查出本 ws 的 AI 网页 wcId(renderer 的 ai-host-registry)再传进来,
 * 后台 / 收件箱 / AI 够不着。现在主进程自己按 ws 找 —— 同一 ws 的网页共用浏览分区 `persist:webview-<ws>`
 * (AI / X / 内置浏览器同名),按「分区 + 网址是这个服务」认。
 * 找不到 / 一个 ws 开着两个同服务的页 → refused,不猜(多实例串扰那一族,见 webview-registry 的 fail loud)。
 *
 * kind = control(我的判断):会在你自己的 AI 对话里多一条,但不发到公开平台,不算对外动作 —— AI / 收件箱都能调。
 * 打开 AI 网页要界面(slot 在 renderer),这里不开;没开就说先开。
 */
import { session, webContents, type WebContents } from 'electron';
import { capFailed, defineCapability } from '../capability/capability';
import { detectAIServiceByUrl, type AIServiceId } from '@shared/types/ai-service-types';
import { askAI } from './ask-orchestrator';

const SERVICES: readonly AIServiceId[] = ['claude', 'chatgpt', 'gemini'];

type AIPage = { readonly wcId: number; readonly service: AIServiceId; readonly url: string; readonly wc: WebContents };

function aiPages(): AIPage[] {
  return webContents.getAllWebContents()
    .filter((wc) => !wc.isDestroyed() && wc.getType() === 'webview')
    .flatMap((wc) => {
      const url = wc.getURL();
      const service = detectAIServiceByUrl(url)?.id;
      return service ? [{ wcId: wc.id, service, url, wc }] : [];
    });
}

/** 分区名在 session 上读不到,只能拿 fromPartition 的同一个对象比(同名分区 Electron 只建一份) */
const inWs = (wc: WebContents, wsId: string): boolean => wc.session === session.fromPartition(`persist:webview-${wsId}`);

type O = Record<string, unknown>;
type AskIn = { wsId: string; service: AIServiceId; prompt: string; wcId?: number; timeoutMs: number };

let registered = false;

export function registerAICapabilities(): void {
  if (registered) return;
  registered = true;

  defineCapability<Record<string, never>, Array<{ wcId: number; service: AIServiceId; url: string }>>({
    id: 'ai.web.pages', kind: 'input',
    describe: '现在开着哪些 AI 网页(claude / chatgpt / gemini):服务、wcId、网址',
    inputDoc: {},
    parse: () => ({}),
    run: async () => aiPages().map(({ wcId, service, url }) => ({ wcId, service, url })),
  });

  defineCapability<AskIn, { markdown: string; service: AIServiceId; wcId: number; ms: number }, { wcId: number }>({
    id: 'ai.web.ask', kind: 'control',
    describe: '给这个 workspace 开着的 AI 网页(已登录的 Claude / ChatGPT / Gemini)发一个问题,等它答完,带回完整回答(markdown)。会在你的 AI 对话里多一条',
    inputDoc: {
      wsId: '哪个 workspace(用它的 AI 网页)',
      service: 'claude / chatgpt / gemini',
      prompt: '问什么',
      wcId: '可选:这个 ws 开着两个同服务的页时,指定问哪个(ai.web.pages 看)',
      timeoutMs: '可选:最多等多久,10 秒–10 分钟,默认 2 分钟',
    },
    parse: (raw) => {
      const o = (raw ?? {}) as O;
      if (typeof o.wsId !== 'string' || o.wsId === '') return '要 wsId';
      if (!SERVICES.includes(o.service as AIServiceId)) return `service 只认 ${SERVICES.join(' / ')}`;
      if (typeof o.prompt !== 'string' || o.prompt.trim() === '') return '要 prompt';
      if (o.wcId !== undefined && !Number.isInteger(o.wcId)) return 'wcId 要整数';
      const t = o.timeoutMs ?? 120_000;
      if (!Number.isInteger(t) || (t as number) < 10_000 || (t as number) > 600_000) return 'timeoutMs 要 10000–600000';
      return { wsId: o.wsId, service: o.service as AIServiceId, prompt: o.prompt, wcId: o.wcId as number | undefined, timeoutMs: t as number };
    },
    prepare: async (i) => {
      const mine = aiPages().filter((p) => p.service === i.service && inWs(p.wc, i.wsId));
      const pick = i.wcId === undefined ? mine : mine.filter((p) => p.wcId === i.wcId);
      if (pick.length === 0) {
        return { refused: i.wcId === undefined
          ? `${i.wsId} 没开 ${i.service} 网页 —— 先在这个 workspace 打开 ${i.service}(要已登录)`
          : `wc#${i.wcId} 不是 ${i.wsId} 的 ${i.service} 网页(ai.web.pages 看开着哪些)` };
      }
      if (pick.length > 1) {
        return { refused: `${i.wsId} 开着 ${pick.length} 个 ${i.service} 网页(${pick.map((p) => `wc#${p.wcId}`).join(' / ')}),不知道问哪个 —— 用 wcId 指定` };
      }
      const wcId = pick[0].wcId;
      return { needs: [{ resource: `ai:${wcId}`, purpose: `问 ${i.service}:${i.prompt.slice(0, 20)}`, label: `${i.service} 网页` }], ctx: { wcId } };
    },
    run: async (i, { prep }) => {
      const t0 = Date.now();
      const r = await askAI(i.service, i.prompt, prep.wcId, i.timeoutMs);
      if (!r.success || !r.markdown) throw capFailed(`没问成:${r.error ?? '没拿到回答'}`);
      return { markdown: r.markdown, service: i.service, wcId: prep.wcId, ms: Date.now() - t0 };
    },
    summarize: (o) => ({ service: o.service, wcId: o.wcId, ms: o.ms, chars: o.markdown.length, head: o.markdown.slice(0, 80) }),
  });
}
