/**
 * 共享的“校验/编译/目录”核心逻辑(REST 与 MCP 共用)。
 *
 * 思路与官方 flint-chart-mcp 的 render/assemble.ts 一致,但做了三处本地化:
 * 1) 只接受内联 data.values(HTTP 服务默认不读服务器本地文件,安全默认);
 * 2) 直接复用后端 package.json 里同一个 flint-chart 版本,避免再引一份 SDK;
 * 3) 所有函数保持“纯函数 + 抛错”风格,由上层(REST 控制器 / MCP 工具)
 *    决定怎么转成响应,这一层不掺协议与 IO。
 */
import {
  THEME_PRESETS,
  assembleChartjs,
  assembleECharts,
  assembleVegaLite,
  cjsAllTemplateDefs,
  cjsGetTemplateDef,
  ecAllTemplateDefs,
  ecGetTemplateDef,
  listThemePresets,
  vlAllTemplateDefs,
  vlGetTemplateDef,
} from 'flint-chart';
import type {
  ChartAssemblyInput,
  ChartEncoding,
  ChartTemplateDef,
  ChartWarning,
} from 'flint-chart';
import {
  MAX_CANVAS_DIM,
  MAX_DATA_ROWS,
  RENDER_BACKENDS,
  type RenderBackend,
} from './render.types';
import { resolveThemeTokens } from './theme.tokens';
import { applyThemeToChartjs, applyThemeToECharts } from './theme-map';

/** MCP 后端 → Flint 编译器,集中在这里,避免散落各处 */
const ASSEMBLERS: Record<RenderBackend, (input: ChartAssemblyInput) => any> = {
  vegalite: assembleVegaLite,
  echarts: assembleECharts,
  chartjs: assembleChartjs,
};

/** MCP 后端 → 模板查表函数(用于校验通道是否写错/漏写) */
const TEMPLATE_LOOKUP: Record<
  RenderBackend,
  (chartType: string) => ChartTemplateDef | undefined
> = {
  vegalite: vlGetTemplateDef,
  echarts: ecGetTemplateDef,
  chartjs: cjsGetTemplateDef,
};

/** MCP 后端 → 完整模板注册表(用于 list_chart_types 目录) */
const REGISTRIES: Record<RenderBackend, ChartTemplateDef[]> = {
  vegalite: vlAllTemplateDefs,
  echarts: ecAllTemplateDefs,
  chartjs: cjsAllTemplateDefs,
};

/** assemble 的返回:原生 spec + 警告 + 布局尺寸(带 _ 私有键) */
export interface AssembleResult {
  spec: any;
  warnings: ChartWarning[];
  width?: number;
  height?: number;
}

/**
 * 主题适用后端。
 * - vegalite:由 Flint 组装器完整实现(布局 + 视觉);
 * - echarts / chartjs:由本模块映射视觉 token(调色板/背景/文字/网格/字体)。
 */
export const THEME_SUPPORTED_BACKENDS = ['vegalite', 'echarts', 'chartjs'] as const;

/** Waterfall 合计锚点的可识别写法:统一归一化成模板认识的 `end` */
const WATERFALL_TOTAL_ALIASES = new Set(['total', 'sum', '小计', '合计', '总计']);
/** 三个后端模板认识的锚点/符号值 */
const WATERFALL_KNOWN_ANCHORS = new Set(['start', 'end', 'increase', 'decrease']);

/**
 * 入口级的语义规范化 + 提示,不改变 Flint 编译器本身:
 * 1) Waterfall 的 `total`/中文合计 → `end`(修复"合计柱浮高自身高度");
 * 2) 无法识别的类型值 → warning(而不是静默按正负着色);
 * 3) 非 vegalite 后端收到 theme_spec → warning(而不是静默忽略)。
 */
function normalizeInputForBackend(
  input: unknown,
  backend: RenderBackend,
  warnings: ChartWarning[],
): unknown {
  if (input == null || typeof input !== 'object') return input;
  const chartInput = input as Record<string, any>;

  return normalizeWaterfallAnchors(chartInput, warnings);
}

/**
 * 把主题 token 注入 ECharts / Chart.js 的原生 spec。
 * Vega-Lite 由组装器自己处理;无法解析的 theme_spec 给出 warning 并跳过。
 */
function applyThemeMapping(
  backend: RenderBackend,
  spec: any,
  input: unknown,
  warnings: ChartWarning[],
): void {
  const themeSpec = (input as any)?.theme_spec;
  if (!themeSpec) return;
  const tokens = resolveThemeTokens(themeSpec);
  if (!tokens) {
    warnings.push({
      severity: 'warning',
      code: 'theme-unknown',
      message:
        `无法解析 theme_spec(${JSON.stringify(themeSpec).slice(0, 80)}),` +
        '已忽略;可用 list_themes 查看预设 id',
    } as ChartWarning);
    return;
  }
  if (backend === 'echarts') {
    applyThemeToECharts(spec, tokens);
  } else if (backend === 'chartjs') {
    applyThemeToChartjs(spec, tokens);
  }
}

/** 把 Waterfall 的合计标记归一化成 `end`,并对未知取值给出 warning */
function normalizeWaterfallAnchors(
  input: Record<string, any>,
  warnings: ChartWarning[],
): Record<string, any> {
  if (input.chart_spec?.chartType !== 'Waterfall Chart') return input;
  const color = input.chart_spec?.encodings?.color;
  const field = typeof color === 'string' ? color : color?.field;
  if (!field || !Array.isArray(input.data?.values)) return input;

  let aliasApplied = false;
  const unknownValues = new Set<string>();
  const values = input.data.values.map((row: any) => {
    if (!row || typeof row !== 'object') return row;
    const raw = row[field];
    if (typeof raw !== 'string') return row;
    const normalized = raw.trim().toLowerCase();
    if (WATERFALL_TOTAL_ALIASES.has(normalized)) {
      aliasApplied = true;
      return { ...row, [field]: 'end' };
    }
    if (!WATERFALL_KNOWN_ANCHORS.has(normalized)) {
      unknownValues.add(raw);
    }
    return row;
  });

  if (aliasApplied) {
    warnings.push({
      severity: 'info',
      code: 'waterfall-total-alias',
      message: 'Waterfall 的合计标记(total/合计等)已按 "end" 处理,合计柱锚定 0 轴',
      channel: 'color',
      field,
    } as ChartWarning);
  }
  if (unknownValues.size > 0) {
    warnings.push({
      severity: 'warning',
      code: 'waterfall-unknown-anchor',
      message:
        `Waterfall 类型列包含无法识别的取值:${[...unknownValues].join(', ')};` +
        '这些行将按数值正负着色(可识别值:start/end/increase/decrease/total)',
      channel: 'color',
      field,
    } as ChartWarning);
  }
  return aliasApplied ? { ...input, data: { ...input.data, values } } : input;
}

/**
 * 把 chart_spec.title / subtitle 映射到后端原生标题。
 *
 * Flint 的 Vega-Lite / Plotly 组装器会自己处理标题,但 ECharts 与 Chart.js
 * 的组装器完全丢弃这两个字段(体检报告 P1)。这里在编译产物上做一层补齐:
 * - ECharts: 注入 option.title,并把 grid.top 抬高给标题留空间;
 * - Chart.js: 注入 options.plugins.title,副标题作为第二行。
 * 只在后端没有原生 title 时注入,不覆盖组装器自己的东西。
 */
function applyTitleMapping(
  backend: RenderBackend,
  spec: any,
  input: unknown,
): void {
  if (!spec || typeof spec !== 'object') return;
  const chartSpec = (input as any)?.chart_spec;
  const title = typeof chartSpec?.title === 'string' ? chartSpec.title.trim() : '';
  const subtitle =
    typeof chartSpec?.subtitle === 'string' ? chartSpec.subtitle.trim() : '';
  if (!title && !subtitle) return;

  if (backend === 'echarts') {
    if (spec.title) return;
    spec.title = {
      text: title,
      subtext: subtitle,
      left: 'left',
      top: 4,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: '#111827' },
      subtextStyle: { fontSize: 11, color: '#6b7280' },
    };
    elevateGridTop(spec, subtitle ? 62 : 40);
    return;
  }

  if (backend === 'chartjs') {
    spec.options = spec.options ?? {};
    spec.options.plugins = spec.options.plugins ?? {};
    if (spec.options.plugins.title) return;
    spec.options.plugins.title = {
      display: true,
      position: 'top',
      align: 'start',
      text: subtitle ? [title, subtitle] : title,
      color: '#111827',
      font: { size: 13, weight: 'bold' },
      padding: { top: 4, bottom: 10 },
    };
  }
}

/** 把 ECharts 的 grid.top 抬到至少 minTop,给注入的标题留空间 */
function elevateGridTop(spec: any, minTop: number): void {
  const apply = (grid: any): void => {
    if (!grid || typeof grid !== 'object') return;
    if (typeof grid.top !== 'number' || grid.top < minTop) grid.top = minTop;
  };
  if (Array.isArray(spec.grid)) spec.grid.forEach(apply);
  else if (spec.grid && typeof spec.grid === 'object') apply(spec.grid);
  // 没有 grid 的图表(pie/radar 等)不强行创建,标题本身仍然可见
}

/**
 * 编译前统一校验,能给出比 Flint 编译器更友好的错误提示:
 * - 数据必须有内联 values;
 * - 行数/画布尺寸不超过安全上限;
 * - chartType 存在;
 * - encodings 里的通道是该模板支持的;
 * - 必填通道(x/y 或 KPI Card 的 metric/value)不能缺;
 * - 绑定的字段必须真实存在于数据行里。
 * 校验通过后原地(复制后)返回可编译的 ChartAssemblyInput。
 */
export function prepareInput(
  input: unknown,
  backend?: RenderBackend,
): ChartAssemblyInput {
  if (input == null || typeof input !== 'object') {
    throw new Error('input 必须是 ChartAssemblyInput 对象');
  }
  const chartInput = input as ChartAssemblyInput;
  const data = (chartInput as any).data;
  if (data == null || typeof data !== 'object') {
    throw new Error('input.data 是必填项,请提供 { values: [...] }');
  }
  if (typeof data.url === 'string' && data.url.trim()) {
    throw new Error(
      '本服务不接受 data.url 本地文件引用(HTTP 部署的安全默认);请把数据行直接放进 data.values',
    );
  }
  if (!Array.isArray(data.values)) {
    throw new Error('input.data 必须提供内联的 data.values(行对象数组)');
  }
  if (data.values.length > MAX_DATA_ROWS) {
    throw new Error(`data.values 有 ${data.values.length} 行,超过 ${MAX_DATA_ROWS} 行上限`);
  }
  if (data.values.length === 0) {
    throw new Error('data.values 至少需要一行数据');
  }
  for (let i = 0; i < data.values.length; i++) {
    const row = data.values[i];
    if (row == null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`data.values 第 ${i + 1} 行必须是对象`);
    }
    // 表格数据的单元格必须是标量;嵌套对象会被静默转成 "[object Object]"
    // 之类的无意义值,导致图能出来但内容是错的,所以直接拒绝。
    for (const [field, value] of Object.entries(row as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        throw new Error(
          `data.values 第 ${i + 1} 行的字段 "${field}" 是嵌套对象;` +
            '数据单元格只能是字符串/数字/布尔/null',
        );
      }
    }
  }

  const chartSpec: any = (chartInput as any).chart_spec;
  if (chartSpec == null || typeof chartSpec !== 'object') {
    throw new Error('input.chart_spec 是必填项');
  }
  if (typeof chartSpec.chartType !== 'string' || !chartSpec.chartType.trim()) {
    throw new Error('input.chart_spec.chartType 是必填项(例如 "Bar Chart")');
  }
  validateChartSpec(
    chartSpec,
    data.values as Record<string, unknown>[],
    backend,
  );

  for (const sizeField of ['baseSize', 'canvasSize'] as const) {
    const size = chartSpec[sizeField];
    if (size == null) continue;
    for (const dimension of ['width', 'height'] as const) {
      const value = size[dimension];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`chart_spec.${sizeField}.${dimension} 必须是数字`);
      }
      if (value < 1) {
        throw new Error(
          `chart_spec.${sizeField}.${dimension} 必须 >= 1(当前 ${value})`,
        );
      }
      if (value > MAX_CANVAS_DIM) {
        throw new Error(
          `chart_spec.${sizeField} 超过最大边长 ${MAX_CANVAS_DIM}px`,
        );
      }
    }
  }
  return chartInput;
}

/** 校验某个模板的通道绑定(内部函数,错误信息面向 LLM 可读) */
function validateChartSpec(
  chartSpec: any,
  rows: Record<string, unknown>[],
  backend?: RenderBackend,
): void {
  const encodings = chartSpec.encodings;
  if (encodings == null || typeof encodings !== 'object' || Array.isArray(encodings)) {
    throw new Error('input.chart_spec.encodings 必须是“通道 → 编码”对象');
  }
  const entries = Object.entries(encodings);
  if (entries.length === 0) {
    throw new Error('input.chart_spec.encodings 至少要绑定一个通道');
  }

  const template = backend ? TEMPLATE_LOOKUP[backend]?.(chartSpec.chartType) : undefined;
  if (template) {
    const allowed = new Set(template.channels ?? []);
    for (const [channel] of entries) {
      if (!allowed.has(channel)) {
        throw new Error(
          `通道 "${channel}" 不是 "${chartSpec.chartType}" 在 ${backend} 上支持的通道` +
            `(支持:${template.channels?.join(', ') ?? '无'})`,
        );
      }
    }
    for (const channel of requiredChannels(template)) {
      if (!hasEncodingBinding(encodings[channel])) {
        throw new Error(
          `"${chartSpec.chartType}" 必填通道 encodings.${channel} 未绑定字段`,
        );
      }
    }
  }

  const dataFields = new Set(rows.flatMap((row) => Object.keys(row)));
  for (const [channel, encoding] of entries) {
    for (const field of encodingFields(encoding)) {
      if (!dataFields.has(field)) {
        throw new Error(
          `encodings.${channel}.field "${field}" 在 data.values 中不存在`,
        );
      }
    }
  }
}

/** 简单推导必填通道:有 x+y 就要 x+y;KPI Card 特殊处理 */
function requiredChannels(template: ChartTemplateDef): string[] {
  const channels = template.channels ?? [];
  if (channels.includes('x') && channels.includes('y')) return ['x', 'y'];
  if (template.chart === 'KPI Card') return ['metric', 'value'];
  return [];
}

/** 判断一个通道编码是否真的绑定了字段 */
function hasEncodingBinding(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasEncodingBinding);
  if (value && typeof value === 'object') {
    const encoding = value as ChartEncoding;
    return (
      (typeof encoding.field === 'string' && encoding.field.trim().length > 0) ||
      encoding.aggregate === 'count'
    );
  }
  return false;
}

/** 取出一个通道编码里引用的全部字段名(用于数据行存在性校验) */
function encodingFields(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(encodingFields);
  if (value && typeof value === 'object') {
    const field = (value as ChartEncoding).field;
    return typeof field === 'string' && field.trim() ? [field] : [];
  }
  return [];
}

/**
 * 编译:先校验,再调用对应 assemble*(),并把 Flint 的私有元数据
 * (_warnings/_width/_height 等)拆出来,调用方按需决定是否暴露。
 */
export function assembleForBackend(
  backend: RenderBackend,
  input: unknown,
): AssembleResult {
  const assemble = ASSEMBLERS[backend];
  if (!assemble) {
    throw new Error(`不支持的 backend:"${backend}",可选:${RENDER_BACKENDS.join(', ')}`);
  }
  // 先做入口级规范化(Waterfall 锚点、主题范围提示),再校验/编译
  const shimWarnings: ChartWarning[] = [];
  const normalized = normalizeInputForBackend(input, backend, shimWarnings);
  const prepared = prepareInput(normalized, backend);
  const spec = assemble(prepared);
  applyTitleMapping(backend, spec, prepared);
  applyThemeMapping(backend, spec, prepared, shimWarnings);
  const warnings: ChartWarning[] = [
    ...shimWarnings,
    ...(Array.isArray(spec?._warnings) ? spec._warnings : []),
  ];
  const width = typeof spec?._width === 'number' ? spec._width : undefined;
  const height = typeof spec?._height === 'number' ? spec._height : undefined;
  return { spec, warnings, width, height };
}

/** 把顶层以 _ 开头的 Flint 私有键去掉,得到可交付给渲染器的原生 spec */
export function stripPrivateKeys<T extends Record<string, any>>(spec: T): T {
  for (const key of Object.keys(spec)) {
    if (key.startsWith('_')) {
      delete (spec as Record<string, any>)[key];
    }
  }
  return spec;
}

/** 供 compile_chart 工具使用:编译结果里带 chartType / computedSize */
export interface CompileToolResult {
  backend: RenderBackend;
  chartType: string;
  spec: any;
  warnings: ChartWarning[];
  computedSize?: { width: number; height: number };
}

export function compileForMcp(backend: RenderBackend, input: unknown): CompileToolResult {
  const { spec, warnings, width, height } = assembleForBackend(backend, input);
  stripPrivateKeys(spec);
  const chartType = (input as any)?.chart_spec?.chartType ?? '(unknown)';
  return {
    backend,
    chartType,
    spec,
    warnings,
    computedSize:
      typeof width === 'number' && typeof height === 'number'
        ? { width, height }
        : undefined,
  };
}

/** 供 validate_chart 工具使用:永远不抛错,失败也变成 errors 数组返回 */
export interface ValidateToolResult {
  backend: RenderBackend;
  chartType: string;
  valid: boolean;
  warnings: ChartWarning[];
  errors: ChartWarning[];
  computedSize?: { width: number; height: number };
}

export function validateForMcp(backend: RenderBackend, input: unknown): ValidateToolResult {
  const chartType = (input as any)?.chart_spec?.chartType ?? '(unknown)';
  try {
    const { warnings, width, height } = assembleForBackend(backend, input);
    const errors = warnings.filter((warning) => warning.severity === 'error');
    return {
      backend,
      chartType,
      valid: errors.length === 0,
      warnings,
      errors,
      computedSize:
        typeof width === 'number' && typeof height === 'number'
          ? { width, height }
          : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      backend,
      chartType,
      valid: false,
      warnings: [],
      errors: [{ severity: 'error', code: 'assembly_failed', message }],
    };
  }
}

/** 图表类型目录:每个模板 + 它支持的编码通道 */
export interface ChartTypeInfo {
  chartType: string;
  channels: string[];
}

export interface BackendCatalog {
  backend: RenderBackend;
  count: number;
  chartTypes: ChartTypeInfo[];
}

/** list_chart_types:枚举一个或全部后端的模板目录(按模板名排序) */
export function listChartTypesForMcp(backend?: RenderBackend): BackendCatalog[] {
  const backends: RenderBackend[] = backend
    ? [backend]
    : ([...RENDER_BACKENDS] as RenderBackend[]);
  return backends.map((id) => {
    const defs = REGISTRIES[id] ?? [];
    const chartTypes = defs
      .map((definition) => ({
        chartType: definition.chart,
        channels: definition.channels ?? [],
      }))
      .sort((a, b) => a.chartType.localeCompare(b.chartType));
    return { backend: id, count: chartTypes.length, chartTypes };
  });
}

/**
 * list_themes:不带 id 返回预设名列表;带 id 返回该主题的非 spec 元信息
 * (spec 太大且是编译器的活,icon 是选择器的活,都不适合塞给 LLM)。
 */
export function listThemesForMcp(id?: string): unknown {
  const supportedBackends = [...THEME_SUPPORTED_BACKENDS];
  const note =
    'vegalite 由 Flint 完整实现主题(布局+视觉);' +
    'echarts/chartjs 映射视觉 token(调色板/背景/文字/网格/字体)。';
  if (!id) {
    return {
      supportedBackends,
      note,
      themes: listThemePresets().map((theme) => ({ ...theme, supportedBackends })),
    };
  }
  const preset = (THEME_PRESETS as Record<string, any>)[id];
  if (!preset) {
    throw new Error(
      `未知主题 "${id}",可用主题:${Object.keys(THEME_PRESETS).join(', ')}`,
    );
  }
  const { spec: _spec, icon: _icon, ...rest } = preset;
  return { ...rest, supportedBackends, note };
}
