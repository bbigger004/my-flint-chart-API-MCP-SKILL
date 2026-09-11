/**
 * NestJS 应用入口。
 * 职责:装配全局中间件/管道/CORS,并监听端口。
 * 前端 Vite 开发服务器会把 /api 代理到这里,因此本地开发无跨域问题。
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ArtifactService } from './flint/artifacts/artifact.service';
import { createMcpRouter } from './mcp/mcp-http';
import { MAX_BODY_BYTES, MCP_PATH } from './mcp/mcp-constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 允许跨域:如果前端不用 Vite 代理,而是直连后端,需要放开 CORS
  app.enableCors({ origin: true });

  // 全局路由前缀:所有接口都在 /api 之下
  app.setGlobalPrefix('api');

  // MCP 请求携带内联数据,body 上限放宽到与 /mcp 路由一致的 32MiB
  app.useBodyParser('json', { limit: MAX_BODY_BYTES });
  app.useBodyParser('urlencoded', { limit: MAX_BODY_BYTES, extended: true });

  // 挂载 MCP Streamable HTTP 端点:/mcp(不走 /api 前缀,
  // 因为客户端配置里写的就是固定 URL,例如 http://localhost:3000/mcp)
  app.use(MCP_PATH, createMcpRouter());

  // 全局参数校验:DTO 上的 class-validator 装饰器统一生效
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 剥离 DTO 之外的字段
      transform: true, // 把 plain object 转成 DTO 实例
    }),
  );

  // ConfigService 读到的值来自 .env.local / .env,其次才是 shell 环境变量
  const config = app.get(ConfigService);
  const artifacts = app.get(ArtifactService);
  const port = Number(config.get<string>('PORT') ?? 3000);
  await app.listen(port);
  const storeInfo =
    artifacts.storeKind === 'fs'
      ? `fs(${artifacts.settings.dir})`
      : `s3(bucket=${artifacts.settings.s3.bucket ?? '-'})`;
  console.log(
    `Flint backend listening on http://localhost:${port}/api` +
      `\nMCP (Streamable HTTP) endpoint: http://localhost:${port}${MCP_PATH}` +
      `\nArtifact delivery: ${artifacts.settings.defaultDelivery}` +
      ` | store: ${storeInfo}` +
      ` | ttl: ${artifacts.settings.ttlSeconds}s` +
      (artifacts.settings.authToken ? ' | auth: on' : ' | auth: off'),
  );
}

void bootstrap();
