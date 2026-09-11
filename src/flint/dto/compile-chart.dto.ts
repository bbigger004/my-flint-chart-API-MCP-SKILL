import { IsIn, IsObject } from 'class-validator';
import { FLINT_BACKEND_CHOICES } from '../flint.types';

/**
 * POST /api/flint/compile 的请求体。
 *
 * input 是完整 ChartAssemblyInput(结构见 flint-chart 文档):
 *   { data, semantic_types, chart_spec, theme_spec?, options? }
 * 这里不展开成深层的 class,因为 spec 是高度灵活的 JSON;
 * 我们只做顶层校验,深层业务校验交给 flint-chart 编译时抛错。
 */
export class CompileChartDto {
  /** 完整的 Flint 输入对象(前端从它的 src/data/specs.ts 里发出) */
  @IsObject({ message: 'input 必须是 ChartAssemblyInput 对象' })
  input!: Record<string, unknown>;

  /** 目标渲染后端 */
  @IsIn([...FLINT_BACKEND_CHOICES], {
    message: `backend 必须是 ${FLINT_BACKEND_CHOICES.join(' / ')} 之一`,
  })
  backend!: string;
}
