import { IsIn, IsOptional } from 'class-validator';
import { FLINT_BACKEND_CHOICES } from '../flint.types';

/** GET /api/flint/templates?backend=... 的查询参数 */
export class TemplatesQueryDto {
  /** 不传则返回全部后端;传了则只返回该后端 */
  @IsOptional()
  @IsIn([...FLINT_BACKEND_CHOICES], {
    message: `backend 必须是 ${FLINT_BACKEND_CHOICES.join(' / ')} 之一`,
  })
  backend?: string;
}
