/**
 * 共享渲染层的后端枚举与安全上限。
 *
 * 命名说明:
 * - 这里用官方 flint-chart-mcp 的短名 `vegalite / echarts / chartjs`(),
 *   因为它们既面向 LLM(MCP 工具),也面向 REST 渲染接口;
 * - REST 编译接口沿用 Flint 正式 id `vega-lite / chart.js`(FlintBackend),
 *   两者通过 RENDER_TO_FLINT 映射,不要在调用点手写字符串转换。
 */

/** 可服务端渲染的后端(plotly/excel 只能编译,不能在此渲染) */
export const RENDER_BACKENDS = ['vegalite', 'echarts', 'chartjs'] as const;
export type RenderBackend = (typeof RENDER_BACKENDS)[number];

/**
 * 允许出现在接口参数里的后端写法。
 * 渲染侧用短名(vegalite/chartjs),但调用方常按 Flint 正式 id 写成
 * vega-lite/chart.js;两种都收,内部统一归一化成 RenderBackend。
 */
export const RENDER_BACKEND_CHOICES = [
  'vegalite',
  'echarts',
  'chartjs',
  'vega-lite',
  'chart.js',
] as const;

const RENDER_BACKEND_ALIASES: Record<string, RenderBackend> = {
  vegalite: 'vegalite',
  'vega-lite': 'vegalite',
  echarts: 'echarts',
  chartjs: 'chartjs',
  'chart.js': 'chartjs',
};

/** 归一化后端写法;不认识的取值返回 undefined,由调用方给明确报错 */
export function normalizeRenderBackend(value: unknown): RenderBackend | undefined {
  if (typeof value !== 'string') return undefined;
  return RENDER_BACKEND_ALIASES[value.trim().toLowerCase()];
}

/** 渲染短名 → Flint 编译器正式 id */
export const RENDER_TO_FLINT: Record<
  RenderBackend,
  'vega-lite' | 'echarts' | 'chart.js'
> = {
  vegalite: 'vega-lite',
  echarts: 'echarts',
  chartjs: 'chart.js',
};

/**
 * 安全护栏(来自官方 flint-chart-mcp 的默认值):
 * 内联数据行数、画布最大边长,防止一次调用把服务打爆。
 */
export const MAX_DATA_ROWS = 100_000;
export const MAX_CANVAS_DIM = 4000;

/** ECharts / Chart.js 在拿不到 _width/_height 时的兜底画布尺寸 */
export const DEFAULT_CHART_WIDTH = 400;
export const DEFAULT_CHART_HEIGHT = 320;
