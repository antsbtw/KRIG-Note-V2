/**
 * `web.input` 引擎的测试宿主 —— 用**真 DOM 求值**跑注入脚本
 *
 * ⭐ 关键设计:它不是「假装执行脚本、按参数返回预设值」的 mock,
 * 而是**真的把脚本文本喂给 JS 引擎**,在一个最小 DOM 上跑。
 * 这样「脚本写错了」「作用域没生效」「求值后不是合法 JS」都会被抓到。
 *
 * ⚠️ 仍然是 mock 的部分(接线时必须重验,见自查报告):
 *  - `osPaste`:真实现是 OS 级 sendInputEvent,这里只是把文本写进框
 *  - `setFileInputFiles`:真实现是 CDP,这里只是记账
 *  - 时钟:`sleep` 立刻返回,poll 靠可控时钟推进
 */
import type { InputHost, AnchorResolver } from '@platform/main/web-capability/input';
import type { PageId } from '@platform/main/web-capability/page';
import { type FakeDom, type FakeEl, evalInDom } from './fake-dom';

/** 锚点表:语义名 → selector。就是 adapter 该干的事(`01-contract.md` §14) */
export class MapAnchorResolver implements AnchorResolver {
  constructor(private readonly table: Record<string, string>) {}
  resolve(anchor: string): string | null {
    // ⚠️ 查不到返回 null 而不是原样返回 —— 「锚点名打错了」必须是明确失败,
    //    原样返回会让打错的名字变成一个查不到东西的 selector,表现为静默无效
    return this.table[anchor] ?? null;
  }
}

export type HostCall = { kind: string; detail?: unknown };

export class FakeInputHost implements InputHost {
  readonly calls: HostCall[] = [];
  /** 每次 evaluate 的脚本文本 —— 守卫用它验证「参数走了 JSON.stringify」 */
  readonly scripts: string[] = [];
  /** 注入的失败:设为非 null 时 evaluate 抛错(故障注入用) */
  evaluateThrows: string | null = null;
  /** 主路径开关:false 时合成 paste 不写入框(模拟站点改版把主路径打掉) */
  syntheticPasteWorks = true;
  /** OS 粘贴开关 */
  osPasteWorks = true;
  osPasteCalls = 0;
  fedFiles: string[][] = [];
  /** 喂完文件后要让哪个 selector 出现(模拟缩略图 / 转码完成) */
  onFeed?: () => void;
  setFileInputFilesThrows: string | null = null;

  constructor(
    private readonly dom: FakeDom,
    /** 主路径写入的目标:合成 paste 成功时把文本写进这个框 */
    private readonly pasteTarget?: FakeEl,
  ) {}

  async evaluate(_pageId: PageId, script: string): Promise<unknown> {
    this.scripts.push(script);
    if (this.evaluateThrows) throw new Error(this.evaluateThrows);
    const result = evalInDom(this.dom, script);
    // 合成 paste 的脚本在真浏览器里会由站点的 paste handler 把文本写进框;
    // fake DOM 没有站点代码,故在这里模拟「站点接住了」这一步。
    if (script.includes("ClipboardEvent('paste'") && this.syntheticPasteWorks && this.pasteTarget) {
      const evt = this.pasteTarget.events.find((e) => e.type === 'paste');
      if (evt) {
        const dt = (evt as { init?: { clipboardData?: { getData(t: string): string } } }).init
          ?.clipboardData;
        const text = dt?.getData('text/plain') ?? '';
        if (this.pasteTarget.value !== undefined) this.pasteTarget.value = text;
        else this.pasteTarget.textContent = text;
      }
    }
    return result;
  }

  async osPaste(_pageId: PageId, text: string): Promise<void> {
    this.osPasteCalls += 1;
    this.calls.push({ kind: 'osPaste', detail: text });
    if (!this.osPasteWorks) return; // 送达失败 —— 真环境里 webview 焦点隔离就是这个形态
    if (this.pasteTarget) {
      if (this.pasteTarget.value !== undefined) this.pasteTarget.value = text;
      else this.pasteTarget.textContent = text;
    }
  }

  async setFileInputFiles(
    _pageId: PageId,
    selector: string,
    files: readonly string[],
  ): Promise<void> {
    this.calls.push({ kind: 'setFileInputFiles', detail: { selector, files } });
    if (this.setFileInputFilesThrows) throw new Error(this.setFileInputFilesThrows);
    this.fedFiles.push([...files]);
    this.onFeed?.();
  }

  /** 测试里不真等 —— 但 poll 循环仍真的跑多轮(靠 Date.now 推进) */
  async sleep(_ms: number): Promise<void> {
    /* 立即返回 */
  }
}

export const PAGE = 'page-test-1' as PageId;
