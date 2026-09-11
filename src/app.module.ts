import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FlintModule } from './flint/flint.module';
import { HealthController } from './health.controller';

/**
 * 根模块:目前只有两个职责——
 *  1) 健康检查(HealthController)
 *  2) Flint 编译业务(FlintModule)
 * 以后加用户/图表管理等新域,就在这挂新 Module。
 *
 * ConfigModule 放在 imports 第一位:启动时自动加载 .env.local / .env,
 * 并把配置注入全局(FLINT_*、PORT、S3_* 等都不用在命令行手写)。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // 后面的文件不覆盖前面的值:.env.local 优先级最高
      envFilePath: ['.env.local', '.env'],
      // 让 shell 里已有的环境变量优先于 .env(便于临时覆盖)
      ignoreEnvVars: false,
    }),
    FlintModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
