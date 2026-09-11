/**
 * 构造 Flint 的 MCP Server(工具 + 技能资源 + 提示词)。
 *
 * 这里的 server 是“无状态的”:每次 HTTP 请求都会新建一个 McpServer,
 * 通过 StreamableHTTPServerTransport 挂到当前请求上,响应完就关闭。
 * 好处是天然可横向扩展、没有会话内存泄漏(实现见 mcp-http.ts)。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  compileForMcp,
  listChartTypesForMcp,
  listThemesForMcp,
  validateForMcp,
} from '../flint/render/flint-assemble';
import {
  getArtifactService,
  type ArtifactRecord,
} from '../flint/artifacts/artifact.service';
import { renderChart, type RenderResult } from '../flint/render/render-core';
import {
  RENDER_BACKEND_CHOICES,
  normalizeRenderBackend,
  type RenderBackend,
} from '../flint/render/render.types';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './mcp-constants';
import { buildAssemblyInputShape, toAssemblyInput } from './mcp-schemas';

/** 技能资源 URI(客户端可以主动读取,帮助模型学会写 spec) */
export const AGENT_SKILL_RESOURCE_URI = 'flint://agent-skill';
export const THEME_SKILL_RESOURCE_URI = 'flint://theme-skill';

/** 资源文件名 → 相对 assets 的路径 */
const SKILL_FILES = {
  [AGENT_SKILL_RESOURCE_URI]: join('skills', 'flint-chart-author.SKILL.md'),
  [THEME_SKILL_RESOURCE_URI]: join('skills', 'flint-theme-author.SKILL.md'),
} as const;

/**
 * 定位 assets 下的资源文件。
 * 源码在 src/mcp、编译后在 dist/mcp,目录深度不同,因此从当前模块
 * 向上逐层找 assets/skills,和 render-fonts.ts 的字体查找同一套思路。
 */
function findAsset(relativePath: string): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'assets', relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), 'assets', relativePath);
}

function readSkill(uri: string): string {
  return readFileSync(findAsset(SKILL_FILES[uri]), 'utf8');
}

/** MCP 文本内容的标准形状(内容数组可选带 isError) */
type ToolResponse = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

function jsonResult(value: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

/** 后端参数的 enum(用元组断言满足 zod v4 的 tuple 类型要求) */
function backendEnumSchema() {
  return z
    .enum([...RENDER_BACKEND_CHOICES] as [string, ...string[]])
    .describe(
      '渲染后端。推荐短名 vegalite / echarts / chartjs;' +
        '同时兼容 Flint 正式 id vega-lite / chart.js。',
    );
}

/** 归一化工具入参里的 backend;未知取值给出明确错误(而不是静默失败) */
function requireRenderBackend(value: unknown): RenderBackend {
  const backend = normalizeRenderBackend(value);
  if (!backend) {
    throw new Error(
      `不支持的 backend "${String(value)}";可渲染后端:vegalite / echarts / chartjs` +
        '(也接受 vega-lite / chart.js)',
    );
  }
  return backend;
}

/** 把渲染结果转成可落存储的字节(svg 走 UTF-8 编码) */
function artifactBytes(result: RenderResult): Buffer {
  return result.format === 'svg'
    ? Buffer.from(result.svg ?? '', 'utf8')
    : (result.buffer ?? Buffer.alloc(0));
}

/**
 * 创建 MCP Server。
 *
 * 工具面保持精简(5 个),和官方 flint-chart-mcp 同构:
 * - 先 list_chart_types / list_themes 发现能力;
 * - 再 validate_chart 检查 spec;
 * - compile_chart 拿原生 spec JSON;
 * - render_chart 拿最终 SVG/PNG。
 * 对 agent 来说,少而稳定的工具比“每个图表类型一个工具”好教得多。
 */
export interface CreateFlintMcpServerOptions {
  /** 当前请求推导出的对外 base URL(反向代理后由 x-forwarded-* 修正) */
  baseUrl?: string;
}

export function createFlintMcpServer(
  options: CreateFlintMcpServerOptions = {},
): McpServer {
  const artifacts = getArtifactService();
  const requestBaseUrl = options.baseUrl;
  const assemblyInputShape = buildAssemblyInputShape();
  const backendEnum = backendEnumSchema();

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        '你是 Flint 图表助手。Flint 把“一份语义化图表描述(ChartAssemblyInput)”' +
        '编译成 Vega-Lite / ECharts / Chart.js 的原生 spec,并能在本地渲染成 SVG/PNG。\n' +
        '工作流建议:先 list_chart_types 选模板、list_themes 选主题;写完后先 ' +
        'validate_chart 再 render_chart。数据只能通过 data.values 内联传入,' +
        '不要使用 data.url。动手前可读取 flint://agent-skill 资源,' +
        '里面有完整的 ChartAssemblyInput 编写规范。' +
        '需要把图展示给用户或别的系统时,render_chart 传 delivery="url",' +
        '工具会返回可下载的产物链接(以及可直接渲染的 Markdown 图片行);' +
        'inline 模式会把图片/SVG 正文放进上下文,只在客户端明确需要时使用。' +
        'English: pick a chart type with list_chart_types, a theme with list_themes, ' +
        'validate before render; always inline data in data.values. ' +
        'Use render_chart delivery="url" when you need a shareable artifact link.',
    },
  );

  // ---- render_chart:最终产物 ------------------------------------------
  server.registerTool(
    'render_chart',
    {
      title: '渲染图表',
      description:
        '把一份 Flint spec 编译并渲染成图片。delivery 决定交付形态:' +
        'inline=只回内联内容;url=把产物存到服务端并回可下载链接;both=两者都给。' +
        '生产环境建议 url:聊天客户端能通过 Markdown 图片行直接显示,链接也能贴给别人。' +
        'chartjs 后端只支持 png。渲染在本机进程内完成。',
      inputSchema: {
        ...assemblyInputShape,
        backend: backendEnum,
        format: z
          .enum(['png', 'svg'])
          .optional()
          .describe('输出格式,默认 svg;chartjs 只支持 png。'),
        scale: z
          .number()
          .min(0.5)
          .max(4)
          .optional()
          .describe('PNG 像素倍率,1=设计尺寸,2=Retina;SVG 忽略。默认 1。'),
        background: z
          .string()
          .optional()
          .describe('背景色(CSS 颜色),默认 #ffffff。'),
        delivery: z
          .enum(['inline', 'url', 'both'])
          .optional()
          .describe(
            '交付模式:inline=只回内联内容;url=只回产物链接;both=两者都回。' +
              '默认取服务端 FLINT_ARTIFACT_DELIVERY(未配置时为 inline)。',
          ),
        artifact_id: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .optional()
          .describe(
            '可选产物短名(字母/数字/下划线/连字符,1-64 位);不传则按内容哈希自动生成。',
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe('同名不同内容是否允许覆盖,默认 false。'),
      },
    },
    async (args: any) => {
      try {
        const backend = requireRenderBackend(args.backend);
        const delivery = (args.delivery ?? artifacts.settings.defaultDelivery) as
          | 'inline'
          | 'url'
          | 'both';
        const result = await renderChart(backend, toAssemblyInput(args), {
          format: args.format,
          scale: args.scale,
          background: args.background,
        });
        const warnings = result.warnings ?? [];
        const summary =
          `${result.backend} · ${result.format} · ${result.width}×${result.height}px` +
          (warnings.length ? ` · ${warnings.length} 条警告` : '');

        // delivery=url/both 时把产物写入存储,拿到可下载链接
        let record: ArtifactRecord | null = null;
        let url: string | null = null;
        let storeNote = '';
        if (delivery !== 'inline') {
          if (!artifacts.enabled) {
            storeNote = '产物存储已关闭(FLINT_ARTIFACT_WRITE=0),已回退为内联返回。';
          } else {
            try {
              record = await artifacts.put(
                artifactBytes(result),
                {
                  mimeType: result.mimeType,
                  extension: result.format === 'svg' ? 'svg' : 'png',
                  width: result.width,
                  height: result.height,
                  warnings,
                },
                { artifactId: args.artifact_id, overwrite: args.overwrite },
              );
              url = await artifacts.buildUrl(record, requestBaseUrl);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              storeNote = `产物存储失败,已回退为内联返回:${message}`;
            }
          }
        }

        const content: any[] = [
          {
            type: 'text' as const,
            text: storeNote ? `${summary}\n${storeNote}` : summary,
          },
        ];
        if (url && record) {
          content.push({ type: 'text' as const, text: `![chart](${url})` });
          content.push({
            type: 'text' as const,
            text:
              `产物链接:${url}\n` +
              `artifactId: ${record.id}\n` +
              `mimeType: ${record.mimeType}\n` +
              `expiresAt: ${record.expiresAt}`,
          });
        }

        // delivery=url 且存储成功时不回内联正文(避免 SVG 标签灌进模型上下文);
        // 其余情况(含存储失败回退)都回内联内容。
        if (delivery !== 'url' || !url) {
          if (result.format === 'svg') {
            content.push({ type: 'text' as const, text: result.svg as string });
          } else {
            content.push({
              type: 'image' as const,
              data: result.base64 as string,
              mimeType: result.mimeType,
            });
          }
        }
        return { content };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- compile_chart:只要 spec JSON,不渲染 ---------------------------
  server.registerTool(
    'compile_chart',
    {
      title: '编译图表 spec',
      description:
        '把 Flint spec 编译成目标后端的原生 spec(Vega-Lite / ECharts / Chart.js)' +
        'JSON,不渲染。返回 spec、装配警告和计算出的布局尺寸。',
      inputSchema: { ...assemblyInputShape, backend: backendEnum },
    },
    async (args: any) => {
      try {
        return jsonResult(
          compileForMcp(requireRenderBackend(args.backend), toAssemblyInput(args)),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- validate_chart:渲染前体检 -------------------------------------
  server.registerTool(
    'validate_chart',
    {
      title: '校验图表 spec',
      description:
        '不渲染,只检查一份 Flint spec 是否合法:返回 valid、全部警告/错误,' +
        '以及计算后的布局尺寸。写 spec 之后、渲染之前建议先调用。',
      inputSchema: { ...assemblyInputShape, backend: backendEnum },
    },
    async (args: any) => {
      try {
        return jsonResult(
          validateForMcp(requireRenderBackend(args.backend), toAssemblyInput(args)),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- list_chart_types:能力目录 --------------------------------------
  server.registerTool(
    'list_chart_types',
    {
      title: '列出图表类型',
      description:
        '列出某个后端(或不指定时全部后端)支持的图表模板与各自的编码通道,' +
        '用于挑选 chart_spec.chartType。',
      inputSchema: { backend: backendEnum.optional() },
    },
    async (args: any) => {
      try {
        const backend =
          args?.backend === undefined || args?.backend === null
            ? undefined
            : requireRenderBackend(args.backend);
        return jsonResult(listChartTypesForMcp(backend));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- list_themes:主题目录 -------------------------------------------
  server.registerTool(
    'list_themes',
    {
      title: '列出视觉主题',
      description:
        '列出 Flint 内置视觉主题(theme_spec 可用的预设 id,如 "economist")。' +
        '传 id 可获取该主题的专属编写指导。',
      inputSchema: { id: z.string().optional() },
    },
    async (args: any) => {
      try {
        return jsonResult(listThemesForMcp(args?.id as string | undefined));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- 技能资源 + 提示词 ----------------------------------------------
  server.registerResource(
    'agent-skill',
    AGENT_SKILL_RESOURCE_URI,
    {
      title: 'Flint 图表编写技能',
      description: '生成合法 ChartAssemblyInput 的完整编写规范,建议工具调用前读取。',
      mimeType: 'text/markdown',
      annotations: { audience: ['assistant'], priority: 1 },
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: readSkill(AGENT_SKILL_RESOURCE_URI),
        },
      ],
    }),
  );

  server.registerResource(
    'theme-skill',
    THEME_SKILL_RESOURCE_URI,
    {
      title: 'Flint 主题编写技能',
      description: '创建/定制 ThemeSpec 的规范,深度定制主题时读取。',
      mimeType: 'text/markdown',
      annotations: { audience: ['assistant'], priority: 1 },
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: readSkill(THEME_SKILL_RESOURCE_URI),
        },
      ],
    }),
  );

  server.registerPrompt(
    'author_flint_chart',
    {
      title: '编写 Flint 图表',
      description:
        '在生成/校验/编译/渲染 Flint 图表前加载官方图表编写技能,避免产出非法 spec。',
    },
    async () => ({
      description: '先加载 Flint chart-author 技能,再按规范生成图表。',
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'resource' as const,
            resource: {
              uri: AGENT_SKILL_RESOURCE_URI,
              mimeType: 'text/markdown',
              text: readSkill(AGENT_SKILL_RESOURCE_URI),
            },
          },
        },
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              '请严格按照上述 Flint 编写规范生成 ChartAssemblyInput,' +
              '先 validate 再 render。',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'author_flint_theme',
    {
      title: '编写 Flint 主题',
      description: '创建/翻译/精修/校验 ThemeSpec 前加载官方主题技能。',
    },
    async () => ({
      description: '先加载 Flint theme-author 技能,再产出合法 ThemeSpec。',
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'resource' as const,
            resource: {
              uri: THEME_SKILL_RESOURCE_URI,
              mimeType: 'text/markdown',
              text: readSkill(THEME_SKILL_RESOURCE_URI),
            },
          },
        },
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              '请按照 theme-author 规范创建/定制 ThemeSpec,只返回可复用的主题对象。',
          },
        },
      ],
    }),
  );

  // ---- 产物资源模板(可选增强)---------------------------------------
  // 无状态 server 每个请求都会重新注册模板;客户端 resources/read 时从
  // artifact service 读取,不会出现"动态注册的资源在另一个实例 404"。
  server.registerResource(
    'flint-artifact',
    new ResourceTemplate('flint://artifacts/{id}', { list: undefined }),
    {
      title: 'Flint 渲染产物',
      description: '按 artifactId 读取渲染产物(PNG/SVG 二进制内容)。',
      mimeType: 'application/octet-stream',
    },
    async (uri, variables) => {
      const id = String((variables as Record<string, unknown>).id ?? '');
      const stored = await getArtifactService().get(id);
      if (!stored) {
        throw new Error(`产物不存在或已过期:${id}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: stored.record.mimeType,
            blob: stored.bytes.toString('base64'),
          },
        ],
      };
    },
  );

  return server;
}
