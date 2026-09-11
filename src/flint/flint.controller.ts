import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { CompileChartDto } from './dto/compile-chart.dto';
import { TemplatesQueryDto } from './dto/templates-query.dto';
import { FlintService } from './flint.service';
import {
  FLINT_BACKEND_CHOICES,
  normalizeFlintBackend,
  type CompileResult,
} from './flint.types';

/**
 * REST 控制器。
 * 所有路由挂在全局前缀 /api 下:
 *   POST /api/flint/compile
 *   GET  /api/flint/templates
 *   GET  /api/flint/themes
 */
@Controller('flint')
export class FlintController {
  constructor(private readonly flint: FlintService) {}

  @Post('compile')
  @HttpCode(200) // 编译是“查询性质”的 POST,返回 200 更符合语义
  compile(@Body() dto: CompileChartDto): CompileResult {
    return this.flint.compile(dto.input, this.requireBackend(dto.backend));
  }

  @Get('templates')
  templates(@Query() query: TemplatesQueryDto) {
    const backend =
      query.backend === undefined ? undefined : this.requireBackend(query.backend);
    return this.flint.listTemplates(backend);
  }

  @Get('themes')
  themes() {
    return this.flint.listThemes();
  }

  /** 归一化后端写法(接受 vegalite/chartjs 等别名) */
  private requireBackend(value: string) {
    const backend = normalizeFlintBackend(value);
    if (!backend) {
      throw new BadRequestException(
        `不支持的 backend "${value}";可选:${FLINT_BACKEND_CHOICES.join(' / ')}`,
      );
    }
    return backend;
  }
}
