/**
 * 服务端渲染管线:把 Flint 编译出的原生 spec 变成 SVG/PNG。
 *
 * 支持的组合:
 * - vegalite → vega-lite 编译成 vega,vega 无头 View 输出 SVG;
 * - echarts  → ECharts SSR(ssr:true + svg renderer)直接输出 SVG;
 * - chartjs  → Chart.js 引擎只有 canvas 输出,用 @napi-rs/canvas 出 PNG。
 * PNG 统一由 @resvg/resvg-js 把 SVG 光栅化(vegalite/echarts 两条路共用)。
 *
 * 整个过程不需要浏览器、不需要外部渲染服务,数据只在本进程内流转。
 */
import {
  injectCanvasFurnitureSVG,
  readCanvasFurniture,
} from 'flint-chart';
import { Resvg } from '@resvg/resvg-js';
import * as ChartJsAuto from 'chart.js/auto';
import { importEsm } from './esm-loader';
import {
  CHART_FONT_FAMILY,
  installVegaTextMetrics,
  registerNapiFonts,
  resvgFontOption,
} from './render-fonts';
import {
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_WIDTH,
  MAX_CANVAS_DIM,
  type RenderBackend,
} from './render.types';
import type { ChartWarning } from 'flint-chart';
import { assembleForBackend, stripPrivateKeys } from './flint-assemble';
import { resolveThemeTokens } from './theme.tokens';

/** 输出格式:png 适合聊天窗口直接展示,svg 适合再编辑/矢量落地 */
export type RenderFormat = 'png' | 'svg';

export interface RenderOptions {
  /** 输出格式,默认 svg(本服务优先保证“拿得到可复制的矢量文本”) */
  format?: RenderFormat;
  /** PNG 的像素倍率,1=设计尺寸,2=Retina;SVG 忽略此参数 */
  scale?: number;
  /** 背景色(CSS 颜色),默认白色 */
  background?: string;
}

export interface RenderResult {
  backend: RenderBackend;
  format: RenderFormat;
  mimeType: string;
  /** PNG 原始字节(仅 format=png) */
  buffer?: Buffer;
  /** PNG base64(仅 format=png,用于 MCP ImageContent) */
  base64?: string;
  /** SVG 字符串(仅 format=svg) */
  svg?: string;
  /** 逻辑尺寸(CSS px,不含 scale) */
  width: number;
  height: number;
  warnings: ChartWarning[];
}

/**
 * 从 SVG 字符串里解析根节点宽高。
 * Vega 的 View.width/height 只表示绘图区,不含轴/图例,所以以 SVG 根尺寸为准。
 */
function readSvgDimension(svg: string, attribute: 'width' | 'height'): number | undefined {
  const match = svg.match(new RegExp(`<svg[^>]*\\s${attribute}="([^"]+)"`, 'i'));
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

/** 常见 CSS 颜色名(够覆盖背景色的实际用法,避免引入重量级校验库) */
const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
  'gray', 'grey', 'pink', 'brown', 'cyan', 'magenta', 'lime', 'navy',
  'teal', 'olive', 'maroon', 'silver', 'gold', 'beige', 'ivory', 'khaki',
  'coral', 'salmon', 'crimson', 'indigo', 'violet', 'turquoise', 'transparent',
]);

const CSS_COLOR_PATTERN =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;

/** 背景色校验:支持 #hex / rgb() / hsl() / 常见颜色名 */
export function isValidCssColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return CSS_COLOR_PATTERN.test(trimmed) || NAMED_COLORS.has(trimmed.toLowerCase());
}

/** 读取调用方给的 baseSize(用于画布兜底与下限判断) */
function readBaseSize(input: unknown): { width: number; height: number } | undefined {
  const base = (input as any)?.chart_spec?.baseSize;
  if (!base || typeof base !== 'object') return undefined;
  const width = Number(base.width);
  const height = Number(base.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return { width, height };
}

/**
 * 计算最终画布尺寸。
 *
 * 两条规则:
 * 1) baseSize 作为目标下限:个别模板(如 echarts Calendar Heatmap)的组装器
 *    会给出与 baseSize 无关的退化尺寸(96×230);这里取 max(组装器尺寸, baseSize),
 *    保证"用户指定的画布尺寸"对这类模板也有意义,同时不压缩需要拉伸的密集数据。
 * 2) 输出上限:输入侧只校验 baseSize/canvasSize ≤ 4000,但组装/分面会把
 *    输出放大(实测 echarts Bar 输入 4000 → 输出 4097)。这里对最终尺寸等比
 *    缩放到 4000 以内并给出 warning。
 */
function resolveCanvasSize(
  resolvedWidth: number | undefined,
  resolvedHeight: number | undefined,
  baseSize: { width: number; height: number } | undefined,
  warnings: ChartWarning[],
): { width: number; height: number } {
  let width = resolvedWidth ?? baseSize?.width ?? DEFAULT_CHART_WIDTH;
  let height = resolvedHeight ?? baseSize?.height ?? DEFAULT_CHART_HEIGHT;
  if (baseSize) {
    width = Math.max(width, baseSize.width);
    height = Math.max(height, baseSize.height);
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));

  const factor = Math.min(1, MAX_CANVAS_DIM / width, MAX_CANVAS_DIM / height);
  if (factor < 1) {
    const clampedWidth = Math.max(1, Math.round(width * factor));
    const clampedHeight = Math.max(1, Math.round(height * factor));
    warnings.push({
      severity: 'warning',
      code: 'output-clamped',
      message:
        `输出尺寸 ${width}×${height}px 超过 ${MAX_CANVAS_DIM}px 上限,` +
        `已等比缩放到 ${clampedWidth}×${clampedHeight}px`,
    } as ChartWarning);
    width = clampedWidth;
    height = clampedHeight;
  }
  return { width, height };
}

/** 改写 SVG 根节点的 width/height;保留 viewBox 以便内容等比缩放 */
function constrainSvgSize(svg: string, width: number, height: number): string {
  const originalWidth = readSvgDimension(svg, 'width') ?? width;
  const originalHeight = readSvgDimension(svg, 'height') ?? height;
  const hasViewBox = /\sviewBox="/i.test(svg);
  let output = svg
    .replace(/(<svg[^>]*\swidth=")[^"]*(")/i, `$1${width}$2`)
    .replace(/(<svg[^>]*\sheight=")[^"]*(")/i, `$1${height}$2`);
  if (!hasViewBox) {
    output = output.replace(
      /<svg/i,
      `<svg viewBox="0 0 ${originalWidth} ${originalHeight}"`,
    );
  }
  return output;
}

/** SVG → RenderResult;svg 原样返回,png 交给 resvg 光栅化 */
async function svgToResult(
  svg: string,
  options: {
    backend: RenderBackend;
    format: RenderFormat;
    scale: number;
    background: string;
    width: number;
    height: number;
  },
): Promise<Omit<RenderResult, 'warnings'>> {
  if (options.format === 'svg') {
    return {
      backend: options.backend,
      format: 'svg',
      mimeType: 'image/svg+xml',
      svg,
      width: options.width,
      height: options.height,
    };
  }
  const resvg = new Resvg(svg, {
    background: options.background,
    font: resvgFontOption(),
    fitTo:
      options.scale === 1
        ? { mode: 'original' }
        : { mode: 'zoom', value: options.scale },
  });
  const buffer = Buffer.from(resvg.render().asPng());
  return {
    backend: options.backend,
    format: 'png',
    mimeType: 'image/png',
    buffer,
    base64: buffer.toString('base64'),
    width: options.width,
    height: options.height,
  };
}

/**
 * 渲染 Vega-Lite spec(Flint 的 assembleVegaLite 产物)。
 * 流程:compile(vl→vega) → parse → 无头 View.runAsync → toSVG。
 * vega/vega-lite 是 ESM-only,因此用 importEsm 原生加载。
 */
async function renderVegaLite(
  spec: any,
  options: {
    format: RenderFormat;
    scale: number;
    background: string;
    width?: number;
    height?: number;
    baseSize?: { width: number; height: number };
    warnings: ChartWarning[];
  },
): Promise<Omit<RenderResult, 'warnings'>> {
  // vega/vega-lite 的 CJS 类型声明路径在 node10 解析下不可达,这里按 any 用;
  // 真正的运行时加载由 importEsm 完成(见 esm-loader.ts 的说明)
  const vega = await importEsm('vega');
  const vegaLite = await importEsm('vega-lite');

  // 先安装文本测量,再开始布局,否则标题/轴标签的宽度都是估算值
  installVegaTextMetrics(vega);

  // 显式把字体栈写进 config,让导出和浏览器预览用同一套字体
  const vlSpec = {
    ...spec,
    config: {
      ...(spec.config ?? {}),
      font: spec.config?.font ?? CHART_FONT_FAMILY,
    },
  };

  const compiled = vegaLite.compile(vlSpec as any).spec;
  const runtime = vega.parse(compiled as any, { background: options.background } as any);
  const view = new vega.View(runtime, { renderer: 'none' });
  view.logLevel(vega.Error);
  await view.runAsync();

  // 主题的“画布级家具”(如 Economist 的红色报头色块)要画在绘图区之外,
  // Vega-Lite 表达不了,只能渲染后注入 SVG;PNG 也会带上它
  const svg = injectCanvasFurnitureSVG(
    await view.toSVG(),
    readCanvasFurniture(spec),
  );
  view.finalize();

  const actualWidth =
    readSvgDimension(svg, 'width') ?? options.width ?? DEFAULT_CHART_WIDTH;
  const actualHeight =
    readSvgDimension(svg, 'height') ?? options.height ?? DEFAULT_CHART_HEIGHT;
  const target = resolveCanvasSize(
    actualWidth,
    actualHeight,
    options.baseSize,
    options.warnings,
  );
  const finalSvg =
    target.width === actualWidth && target.height === actualHeight
      ? svg
      : constrainSvgSize(svg, target.width, target.height);
  return svgToResult(finalSvg, {
    backend: 'vegalite',
    format: options.format,
    scale: options.scale,
    background: options.background,
    width: target.width,
    height: target.height,
  });
}

/**
 * 渲染 ECharts option(Flint 的 assembleECharts 产物)。
 * 用 echarts.init(null, null, { ssr: true, renderer: 'svg' }) 的服务端模式,
 * 不需要 DOM。动画必须关掉,否则 SSR 会报错或拿到首帧空图。
 */
async function renderECharts(
  option: any,
  options: {
    format: RenderFormat;
    scale: number;
    background: string;
    width: number;
    height: number;
  },
): Promise<Omit<RenderResult, 'warnings'>> {
  const echarts = (await import('echarts')) as any;
  const width = options.width || DEFAULT_CHART_WIDTH;
  const height = options.height || DEFAULT_CHART_HEIGHT;

  const mergedOption = { ...option, animation: false };
  if (!mergedOption.backgroundColor) {
    mergedOption.backgroundColor = options.background;
  }

  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width,
    height,
  });
  chart.setOption(mergedOption);
  const svg = chart.renderToSVGString();
  chart.dispose();

  return svgToResult(svg, {
    backend: 'echarts',
    format: options.format,
    scale: options.scale,
    background: options.background,
    width,
    height,
  });
}

/**
 * 渲染 Chart.js config(Flint 的 assembleChartjs 产物)。
 * Chart.js 没有 SVG 引擎,只有 PNG;因此这里强制 PNG。
 * @napi-rs/canvas 提供无头 canvas,canvas.style 需要补一个空对象,
 * 因为 Chart.js 会探测它。
 */
async function renderChartjs(
  config: any,
  options: {
    scale: number;
    background: string;
    width: number;
    height: number;
  },
): Promise<Omit<RenderResult, 'warnings'>> {
  const napiCanvas = (await import('@napi-rs/canvas')) as any;
  registerNapiFonts();
  // Chart.js 在模块加载期静态引入:依赖缺失/路径错误会在服务启动时立刻暴露,
  // 而不是等用户第一次渲染 chartjs 时才炸(见体检报告建议 8)。
  const Chart: any =
    (ChartJsAuto as any).default ?? (ChartJsAuto as any).Chart ?? ChartJsAuto;

  const width = options.width || DEFAULT_CHART_WIDTH;
  const height = options.height || DEFAULT_CHART_HEIGHT;
  const scale = options.scale > 0 ? options.scale : 1;

  const canvas = napiCanvas.createCanvas(Math.round(width * scale), Math.round(height * scale));
  canvas.style = {}; // Chart.js 会读 canvas.style,无头 canvas 没有,补一个

  const merged = {
    ...config,
    options: {
      ...(config.options ?? {}),
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: scale,
    },
  };

  const chart = new Chart(canvas, merged);
  chart.draw();

  // Chart.js 每次绘制前会 clearRect,预先填的背景会被擦掉(导出的 PNG 背景透明,
  // 深色主题如 powerbi 会直接丢失画布色)。因此绘制完成后再合成到一张不透明
  // 画布上,保证主题背景真正进入产物;注意必须先合成再 destroy(),
  // 因为 destroy() 会清空 canvas。
  const output = napiCanvas.createCanvas(canvas.width, canvas.height);
  const outputCtx = output.getContext('2d');
  outputCtx.fillStyle = options.background;
  outputCtx.fillRect(0, 0, output.width, output.height);
  outputCtx.drawImage(canvas, 0, 0);
  const buffer = Buffer.from(output.toBuffer('image/png'));
  chart.destroy();

  return {
    backend: 'chartjs',
    format: 'png',
    mimeType: 'image/png',
    buffer,
    base64: buffer.toString('base64'),
    width,
    height,
  };
}

/** 渲染主入口:校验 → 编译 → 取尺寸 → 交给对应后端渲染器 */
export async function renderChart(
  backend: RenderBackend,
  input: unknown,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const format: RenderFormat = options.format ?? 'svg';
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  // 主题自带画布色时(swiss/powerbi/pop/cartoon)作为默认背景;调用方显式传入优先
  const themeTokens = resolveThemeTokens((input as any)?.theme_spec);
  const background = options.background ?? themeTokens?.background ?? '#ffffff';

  if (backend === 'chartjs' && format === 'svg') {
    throw new Error(
      'chartjs 后端只支持 png(引擎没有 SVG 输出);请把 format 改为 "png"',
    );
  }
  if (!isValidCssColor(background)) {
    throw new Error(
      `background "${background}" 不是合法 CSS 颜色(支持 #hex / rgb() / hsl() / 常见颜色名)`,
    );
  }

  const { spec, warnings, width, height } = assembleForBackend(backend, input);
  // spec.width 可能是 Vega-Lite 的 {step:N} 对象,只接受数字型尺寸
  const specWidth = typeof spec?.width === 'number' ? spec.width : undefined;
  const specHeight = typeof spec?.height === 'number' ? spec.height : undefined;
  const baseSize = readBaseSize(input);
  const canvas = resolveCanvasSize(
    width ?? specWidth,
    height ?? specHeight,
    baseSize,
    warnings,
  );
  // PNG 像素总量同样受 4000px 上限约束(scale=2 的大图也不会越界)
  const pixelScale = Math.min(
    scale,
    MAX_CANVAS_DIM / canvas.width,
    MAX_CANVAS_DIM / canvas.height,
  );
  if (pixelScale < scale) {
    warnings.push({
      severity: 'warning',
      code: 'scale-clamped',
      message: `像素倍率 ${scale} 会使产物超过 ${MAX_CANVAS_DIM}px 上限,已降到 ${pixelScale.toFixed(2)}`,
    } as ChartWarning);
  }
  stripPrivateKeys(spec);

  let artifact: Omit<RenderResult, 'warnings'>;
  if (backend === 'vegalite') {
    artifact = await renderVegaLite(spec, {
      format,
      scale: pixelScale,
      background,
      width: canvas.width,
      height: canvas.height,
      baseSize,
      warnings,
    });
  } else if (backend === 'echarts') {
    artifact = await renderECharts(spec, {
      format,
      scale: pixelScale,
      background,
      width: canvas.width,
      height: canvas.height,
    });
  } else {
    artifact = await renderChartjs(spec, {
      scale: pixelScale,
      background,
      width: canvas.width,
      height: canvas.height,
    });
  }

  return { ...artifact, warnings };
}
