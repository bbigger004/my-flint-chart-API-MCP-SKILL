/**
 * MCP 工具入参的 zod schema。
 *
 * Flint 的 ChartAssemblyInput 是一个嵌套对象;直接让 LLM 按嵌套结构拼
 * 很容易把 chart_spec 和 theme_spec 的位置搞混。这里像官方 MCP server
 * 一样把五六个字段“拍平”成顶层参数,每个字段的 description 都写清楚,
 * 这样客户端拿到的 JSON Schema 本身就是给模型看的说明文档。
 */
import { z } from 'zod';

/**
 * data 的 schema。HTTP 部署安全默认:不接受 data.url(服务器读本地文件
 * 意味着任何能调用工具的客户端都能读服务器文件),只接受内联 values。
 * description 里把这条规则直接写出来,引导模型一次写对。
 */
export const dataSchema = z
  .object({
    values: z
      .array(z.record(z.string(), z.any()))
      .nullish()
      .describe(
        '内联数据行(每行是字段名→值的对象),等价于 Vega-Lite data.values。' +
          '本服务唯一支持的数据传入方式,必须提供。',
      ),
    url: z
      .string()
      .nullish()
      .describe(
        '本服务已禁用 data.url(不读取服务器本地文件,远程 URL 也不会抓取);' +
          '请把数据直接放在 values 里。',
      ),
  })
  .describe('数据源。请通过 values 内联提供行数据。');

/** chart_spec:告诉模型“画什么” */
export const chartSpecSchema = z
  .object({
    chartType: z
      .string()
      .describe(
        '图表模板名,例如 "Bar Chart"、"Scatter Plot"、"Heatmap"、"Line Chart"。' +
          '可用 list_chart_types 查看某个后端支持的全部模板。',
      ),
    title: z
      .string()
      .nullish()
      .describe(
        '标题(一句话结论)。强烈建议填写:很多设计语言会去掉轴标题,' +
          '全靠标题说明指标含义。',
      ),
    subtitle: z
      .string()
      .nullish()
      .describe(
        '副标题(说明统计口径),例如 “各区域 2024 年销售额,单位人民币”。',
      ),
    encodings: z
      .record(z.string(), z.any())
      .describe(
        '通道→编码映射,例如 { x: { field: "region" }, y: { field: "revenue" } }。' +
          '也可以直接写字符串简写: { x: "region" }。',
      ),
    baseSize: z
      .object({ width: z.number(), height: z.number() })
      .nullish()
      .describe(
        '目标画布尺寸 px,默认 400×320。Flint 的布局模型会围绕该基准拉伸。',
      ),
    canvasSize: z
      .object({ width: z.number(), height: z.number() })
      .nullish()
      .describe(
        '可选硬上限 px(默认是 baseSize × 最大拉伸倍数,通常 2 倍)。',
      ),
    chartProperties: z
      .record(z.string(), z.any())
      .nullish()
      .describe('模板专属属性,例如柱状图圆角、是否显示数值标签等。'),
  })
  .describe('画什么。');

/**
 * 把 ChartAssemblyInput 拍平成工具顶层参数。
 * 返回的 shape 可以直接展开进 registerTool 的 inputSchema。
 */
export function buildAssemblyInputShape(): Record<string, z.ZodTypeAny> {
  return {
    data: dataSchema,
    semantic_types: z
      .record(z.string(), z.any())
      .nullish()
      .describe(
        '字段名→语义类型映射,例如 { revenue: "Quantity", region: "Category" }。' +
          '语义类型可以决定轴/比例尺/聚合行为,强烈建议填写。',
      ),
    chart_spec: chartSpecSchema,
    theme_spec: z
      .union([z.string(), z.record(z.string(), z.any())])
      .nullish()
      .describe(
        '视觉主题。优先用 list_themes 返回的预设 id(如 "economist")。' +
          'vegalite 由 Flint 完整实现;echarts/chartjs 会映射视觉 token' +
          '(调色板/背景/文字/网格/字体)。' +
          '要改品牌色时,可传 { extends: "economist", id: "my-brand", ...覆盖项 }。',
      ),
    options: z
      .record(z.string(), z.any())
      .nullish()
      .describe('编译器选项,例如 { addTooltips: true } 或布局相关开关。'),
    field_display_names: z
      .record(z.string(), z.string())
      .nullish()
      .describe('字段名→展示名,用于轴标题/图例文字。'),
  };
}

/**
 * 去掉对象里的 null/undefined 键。
 * 只用于顶层与 chart_spec 这一层,不会递归进 data.values——
 * 数据行里的 null 是合法单元格值,不能动。
 */
function dropNullish<T extends Record<string, any>>(value: T | null | undefined): T {
  const output = {} as Record<string, any>;
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (entry !== null && entry !== undefined) output[key] = entry;
  }
  return output as T;
}

/**
 * 把拍平的 MCP 参数重新组装成 ChartAssemblyInput。
 * 可选字段显式传 null 时按"未提供"处理:LLM 客户端习惯把字段列全,
 * 用 null 表示空值,不应该因此被 schema 拒绝。
 */
export function toAssemblyInput(args: Record<string, any>): unknown {
  return {
    data: args.data,
    semantic_types: args.semantic_types ?? undefined,
    chart_spec: dropNullish(args.chart_spec),
    theme_spec: args.theme_spec ?? undefined,
    options: args.options ?? undefined,
    field_display_names: args.field_display_names ?? undefined,
  };
}
