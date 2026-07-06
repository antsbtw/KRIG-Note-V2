/**
 * fit-controller — PDF「fit 意图」单一真源(2026-07-06 抽出)
 *
 * ## 为什么存在
 * pdfjs 的 `viewer.currentScaleValue` 一旦把 fit 关键字('page-fit' 等)解析成具体
 * 数值,**读值就退化成数字**(如 0.576)。于是「当前是不是 fit 模式」无法靠读它判断
 * —— 几何变更(resize/换屏/全屏)时会把 fit 模式误判成用户手选的绝对 scale 而跳过重算。
 *
 * 历史上这个「fit 意图」被摊在 canvas 的 10+ 个决策点(onPagesInit/setFitMode/Cmd+0/
 * wheel/键盘/setScale/首屏守卫/ResizeObserver/换屏…),每处各写一遍关键字判断与重设,
 * 任一处漏改就整体失效(真机 bug:程序化重设 page-fit 经 scalechanging 事件回流误清
 * 意图 → 后续 resize 全放行)。故收敛成本控制器,对外只三个动词:
 *
 *   setFit(mode)  设为某 fit 模式(存意图 + 应用关键字到 viewer)
 *   clearFit()    退出 fit(用户手选了绝对 scale)
 *   reflow()      几何变更时:若仍是 fit 模式,按当前真实容器宽高重算
 *
 * 所有决策点改调这三个动词,判断/重设逻辑只此一处。下次加新的适配触发点(比如新的
 * 全屏入口)只需在该触发点调 reflow(),无需再懂 currentScaleValue 退化这些坑。
 */

/** 受支持的 fit 关键字(pdfjs currentScaleValue 接受的 fit 语义值)。 */
export type PdfFitMode = 'page-fit' | 'page-width' | 'auto';

/** viewer 上本控制器需要的最小接口(便于测试 / 解耦具体 PDFViewer 类型)。 */
export interface FitControllableViewer {
  currentScaleValue: string;
  update(): void;
}

export interface PdfFitController {
  /**
   * 设为某 fit 模式并应用到 viewer。
   * 传 fit 关键字 → 记住意图 + 设 currentScaleValue;
   * 传数值串(如 '1.5')或非 fit 值 → 视为「用户手选绝对 scale」,清意图但仍应用该值。
   */
  setFit(value: string): void;
  /** 退出 fit 意图(用户手动缩放:wheel / Cmd± / toolbar 手输百分比 / setScale)。 */
  clearFit(): void;
  /**
   * 几何变更(resize / 换屏 / 全屏)后重算:若仍是 fit 模式,重设同一关键字逼 pdfjs
   * 按当前真实容器宽高重算,再 update() 补渲染;非 fit(用户手选 scale)则不动。
   */
  reflow(): void;
  /** 当前 fit 意图(fit 关键字 / null=用户手选绝对 scale)。诊断与守卫读取用。 */
  current(): PdfFitMode | null;
}

/** 判断字符串是否是受支持的 fit 关键字。 */
export function isFitMode(value: string): value is PdfFitMode {
  return value === 'page-fit' || value === 'page-width' || value === 'auto';
}

/**
 * 建 fit 控制器。
 *
 * @param getViewer 取当前 viewer(handle 变时 canvas 会换 viewer 实例,故传 accessor
 *                  而非实例;返回 null 表示尚未就绪 / 已卸载,本控制器所有动作静默跳过)。
 */
export function createFitController(
  getViewer: () => FitControllableViewer | null,
): PdfFitController {
  let intent: PdfFitMode | null = null;

  return {
    setFit(value: string): void {
      const viewer = getViewer();
      if (!viewer) return;
      viewer.currentScaleValue = value;
      intent = isFitMode(value) ? value : null;
    },
    clearFit(): void {
      intent = null;
    },
    reflow(): void {
      const viewer = getViewer();
      if (!viewer) return;
      if (intent) {
        // 重设同一关键字 → pdfjs 按当前真实宽高重算 fit;再 update() 补渲染。
        viewer.currentScaleValue = intent;
        viewer.update();
      }
      // intent=null(用户手选 scale)→ 不动,尊重用户明确选择。
    },
    current(): PdfFitMode | null {
      return intent;
    },
  };
}
