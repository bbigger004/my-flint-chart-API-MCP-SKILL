/**
 * 前后端共享的“后端”枚举。
 * 前端把 ChartAssemblyInput + backend 发给编译接口;
 * 服务端据此调用对应的 assemble*()。
 */
export const FLINT_BACKENDS = [
  'vega-lite',
  'echarts',
  'chart.js',
  'plotly',
  'excel',
] as const;

export type FlintBackend = (typeof FLINT_BACKENDS)[number];

/**
 * 编译接口允许的后端写法。
 * 官方 id 之外,额外接受渲染侧常用的短名(vegalite/chartjs),
 * 避免同一个后端在 compile 与 render 两个端点要用两种名字。
 */
export const FLINT_BACKEND_CHOICES = [
  'vega-lite',
  'echarts',
  'chart.js',
  'plotly',
  'excel',
  'vegalite',
  'chartjs',
] as const;

const FLINT_BACKEND_ALIASES: Record<string, FlintBackend> = {
  'vega-lite': 'vega-lite',
  vegalite: 'vega-lite',
  echarts: 'echarts',
  'chart.js': 'chart.js',
  chartjs: 'chart.js',
  plotly: 'plotly',
  excel: 'excel',
};

/** 归一化编译后端写法;未知取值返回 undefined */
export function normalizeFlintBackend(value: unknown): FlintBackend | undefined {
  if (typeof value !== 'string') return undefined;
  return FLINT_BACKEND_ALIASES[value.trim().toLowerCase()];
}

/** 编译接口返回的响应体结构 */
export interface CompileResult {
  backend: FlintBackend;
  /** 实际调用的编译函数,方便前端展示 */
  compiler: string;
  /** 编译产物:Vega-Lite spec / ECharts option / Chart.js config / Plotly figure / Excel artifact */
  spec: unknown;
  /** 布局溢出等警告(编译器可能没有该字段) */
  warnings?: unknown[];
}
