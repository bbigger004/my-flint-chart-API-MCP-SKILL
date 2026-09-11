/**
 * FlintService:业务核心。
 *
 * 所有方法都只是把 flint-chart 的纯函数包装成 NestJS 可注入的服务,
 * 这样 controller 层保持薄,未来可以在这里加缓存、鉴权、审计、日志。
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  THEME_PRESETS,
  assembleChartjs,
  assembleECharts,
  assembleExcel,
  assemblePlotly,
  assembleVegaLite,
  cjsAllTemplateDefs,
  ecAllTemplateDefs,
  excelAllTemplateDefs,
  plAllTemplateDefs,
  vlAllTemplateDefs,
} from 'flint-chart';
import type { ChartAssemblyInput } from 'flint-chart';
import {
  FLINT_BACKENDS,
  type CompileResult,
  type FlintBackend,
} from './flint.types';
import {
  renderChart,
  type RenderOptions,
  type RenderResult,
} from './render/render-core';
import type { RenderBackend } from './render/render.types';

/** 后端 id → 编译器函数与展示名 */
const COMPILERS: Record<
  FlintBackend,
  { compiler: string; assemble: (input: ChartAssemblyInput) => unknown }
> = {
  'vega-lite': { compiler: 'assembleVegaLite', assemble: assembleVegaLite },
  echarts: { compiler: 'assembleECharts', assemble: assembleECharts },
  'chart.js': { compiler: 'assembleChartjs', assemble: assembleChartjs },
  plotly: { compiler: 'assemblePlotly', assemble: assemblePlotly },
  excel: { compiler: 'assembleExcel', assemble: assembleExcel },
};

/** 后端 id → 模板注册表数组(每个模板至少含 chart / channels) */
const TEMPLATE_REGISTRIES: Record<
  FlintBackend,
  { chart: string; channels: string[] }[]
> = {
  'vega-lite': vlAllTemplateDefs,
  echarts: ecAllTemplateDefs,
  'chart.js': cjsAllTemplateDefs,
  plotly: plAllTemplateDefs,
  excel: excelAllTemplateDefs,
};

@Injectable()
export class FlintService {
  /**
   * 编译一个完整的 ChartAssemblyInput。
   * 错误统一转成 400(BadRequest),因为多数错误来自“模板不存在/
   * 通道绑错/语义类型不支持”这类客户端问题。
   */
  compile(input: unknown, backend: FlintBackend): CompileResult {
    try {
      const { compiler, assemble } = COMPILERS[backend];
      const spec = assemble(input as ChartAssemblyInput) as unknown;

      // 编译器可能在产物上附加 _warnings(溢出截断等),带上它方便前端提示
      const warnings = (spec as { _warnings?: unknown[] })?._warnings;
      return { backend, compiler, spec, warnings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException({
        message: `Flint 编译失败(${COMPILERS[backend].compiler}):${message}`,
        backend,
      });
    }
  }

  /**
   * 渲染:编译 + 无头出图(SVG/PNG)。
   * 与 MCP 的 render_chart 共用同一份 render core,保证两条交付通道
   * 产出的图完全一致。存储/上传不在这里做——那是 artifact service 的职责。
   */
  async render(
    input: unknown,
    backend: RenderBackend,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    try {
      return await renderChart(backend, input, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException({
        message: `Flint 渲染失败(${backend}):${message}`,
        backend,
      });
    }
  }

  /** 返回模板清单(支持矩阵用);可指定单个后端 */
  listTemplates(backend?: FlintBackend): {
    backend: FlintBackend;
    templates: { chart: string; channels: string[] }[];
  }[] {
    const targets: FlintBackend[] = backend ? [backend] : [...FLINT_BACKENDS];
    return targets.map((id) => ({
      backend: id,
      templates: TEMPLATE_REGISTRIES[id].map(({ chart, channels }) => ({
        chart,
        channels,
      })),
    }));
  }

  /**
   * 返回主题预设清单(名字即 theme_spec 可用的字符串值)。
   * 带上 supportedBackends,避免调用方把主题用到不支持的后端上还以为是生效的。
   */
  listThemes(): { id: string; supportedBackends: string[] }[] {
    return Object.keys(THEME_PRESETS).map((id) => ({
      id,
      supportedBackends: ['vegalite', 'echarts', 'chartjs'],
    }));
  }
}
