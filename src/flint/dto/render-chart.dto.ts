import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { RENDER_BACKEND_CHOICES } from '../render/render.types';

/**
 * POST /api/flint/render 的请求体。
 *
 * 与 MCP 的 render_chart 参数一一对应;差别只有命名风格:
 * REST 用 camelCase(artifactId),MCP 用 snake_case(artifact_id)。
 */
export class RenderChartDto {
  /** 完整 ChartAssemblyInput;深层校验交给渲染核心 */
  @IsObject({ message: 'input 必须是 ChartAssemblyInput 对象' })
  input!: Record<string, unknown>;

  /** 可服务端渲染的后端 */
  @IsIn([...RENDER_BACKEND_CHOICES], {
    message: `backend 必须是 ${RENDER_BACKEND_CHOICES.join(' / ')} 之一`,
  })
  backend!: string;

  /** 输出格式,png 便于直接展示,svg 便于再编辑 */
  @IsOptional()
  @IsIn(['png', 'svg'], { message: 'format 必须是 png 或 svg' })
  format?: 'png' | 'svg';

  /** PNG 像素倍率 */
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(4)
  scale?: number;

  /** 背景色(CSS 颜色) */
  @IsOptional()
  @IsString()
  background?: string;

  /**
   * 交付模式:REST 只支持 inline(直接回二进制)与 url(回产物 URL);
   * 默认 url(存储可用时),存储关闭时回退 inline。
   */
  @IsOptional()
  @IsIn(['inline', 'url'], { message: 'delivery 必须是 inline 或 url' })
  delivery?: 'inline' | 'url';

  /** 可选自定义短名;不给则由内容哈希生成 */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'artifactId 只能包含字母、数字、下划线、连字符,长度 1-64',
  })
  artifactId?: string;

  /** 同名不同内容是否允许覆盖,默认 false */
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}
