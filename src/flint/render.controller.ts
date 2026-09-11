/**
 * REST 交付通道:渲染接口 + 产物下载接口。
 *
 * 为什么单独一个 controller:
 * - FlintController 负责"编译"(五后端 spec),这里负责"渲染 + 产物交付";
 * - MCP 与 REST 共用同一份 render core 和 artifact service,行为一致。
 *
 * 路由(全局前缀 /api):
 *   POST /api/flint/render          渲染,delivery=inline 回二进制 / delivery=url 回 URL
 *   GET  /api/flint/artifacts/:id   取产物(支持 Bearer 或 HMAC 签名 URL)
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ArtifactService,
  ArtifactStoreError,
  type ArtifactRecord,
} from './artifacts/artifact.service';
import { requestBaseUrl } from './artifacts/public-url';
import { RenderChartDto } from './dto/render-chart.dto';
import { FlintService } from './flint.service';
import type { RenderResult } from './render/render-core';
import { normalizeRenderBackend } from './render/render.types';

@Controller('flint')
export class RenderController {
  constructor(
    private readonly flint: FlintService,
    private readonly artifacts: ArtifactService,
  ) {}

  /**
   * 渲染并交付。
   * - delivery=inline:直接返回 image/png / image/svg+xml(适合脚本、PPT、<img>)。
   * - delivery=url:产物落存储,返回 { artifactId, url, ... }(生产默认)。
   */
  @Post('render')
  @HttpCode(200) // 渲染是查询性质的 POST,200 比 201 更符合语义
  async render(
    @Body() dto: RenderChartDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.artifacts.checkBearer(req.headers.authorization)) {
      throw new UnauthorizedException('缺少或错误的 Authorization: Bearer <token>');
    }

    const backend = normalizeRenderBackend(dto.backend);
    if (!backend) {
      throw new BadRequestException(
        `不支持的 backend "${dto.backend}";可渲染后端:vegalite / echarts / chartjs`,
      );
    }
    const delivery = dto.delivery ?? (this.artifacts.enabled ? 'url' : 'inline');
    const result = await this.flint.render(dto.input, backend, {
      format: dto.format,
      scale: dto.scale,
      background: dto.background,
    });

    if (delivery === 'inline') {
      this.sendInline(res, result);
      return;
    }

    const record = await this.storeResult(result, dto);
    res.setHeader('x-flint-delivery', 'url');
    res.json({
      artifactId: record.id,
      url: await this.artifacts.buildUrl(record, requestBaseUrl(req)),
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
      size: record.size,
      expiresAt: record.expiresAt,
      warnings: record.warnings ?? [],
    });
  }

  /**
   * 产物下载。
   * 鉴权二选一:Bearer token(程序调用)或 URL 上的 exp+sig(HMAC 签名,
   * 等价于对象存储预签名 URL,供浏览器/PPT/IM 直接打开)。
   */
  @Get('artifacts/:id')
  async artifact(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const bearerOk = this.artifacts.checkBearer(req.headers.authorization);
    const signatureOk = this.artifacts.checkSignature(id, exp, sig);
    if (!bearerOk && !signatureOk) {
      throw new UnauthorizedException('产物链接缺少有效签名,或 Bearer token 不正确');
    }

    const stored = await this.artifacts.get(id);
    if (!stored) {
      throw new NotFoundException(`产物不存在或已过期:${id}`);
    }

    res.setHeader('Content-Type', stored.record.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('ETag', `"sha256-${stored.record.sha256.slice(0, 32)}"`);
    if (stored.record.mimeType === 'image/svg+xml') {
      // SVG 可能含脚本;同域直出时用 sandbox 隔离,避免 XSS
      res.setHeader('Content-Security-Policy', 'sandbox');
    }
    if (download === '1' || download === 'true') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${stored.record.id}.${stored.record.extension}"`,
      );
    }
    res.send(stored.bytes);
  }

  /* ------------------------------ 内部实现 ------------------------------ */

  /** inline 交付:二进制或 SVG 文本直出 */
  private sendInline(res: Response, result: RenderResult): void {
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('x-flint-delivery', 'inline');
    if (result.format === 'svg') {
      res.setHeader('Content-Security-Policy', 'sandbox');
      res.send(result.svg);
      return;
    }
    res.send(result.buffer);
  }

  /** 把渲染结果写入 artifact service,错误统一转成 400 */
  private async storeResult(
    result: RenderResult,
    dto: RenderChartDto,
  ): Promise<ArtifactRecord> {
    const bytes =
      result.format === 'svg'
        ? Buffer.from(result.svg ?? '', 'utf8')
        : (result.buffer ?? Buffer.alloc(0));
    try {
      return await this.artifacts.put(
        bytes,
        {
          mimeType: result.mimeType,
          extension: result.format === 'svg' ? 'svg' : 'png',
          width: result.width,
          height: result.height,
          warnings: result.warnings,
        },
        { artifactId: dto.artifactId, overwrite: dto.overwrite },
      );
    } catch (error) {
      if (error instanceof ArtifactStoreError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
