import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadArtifactConfigFrom } from './artifacts/artifact.config';
import { ArtifactService, getArtifactService } from './artifacts/artifact.service';
import { FlintController } from './flint.controller';
import { FlintService } from './flint.service';
import { RenderController } from './render.controller';

@Module({
  controllers: [FlintController, RenderController],
  providers: [
    FlintService,
    // ArtifactService 用进程级单例:MCP 的 stateless server 与 Nest DI 共用同一实例。
    // 注入 ConfigService 保证 @nestjs/config 先把 .env 读进来,再构造存储配置。
    {
      provide: ArtifactService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        getArtifactService(loadArtifactConfigFrom((key) => config.get<string>(key))),
    },
  ],
  exports: [FlintService, ArtifactService],
})
export class FlintModule {}
