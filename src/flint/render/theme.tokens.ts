/**
 * 把 Flint 的 ThemeSpec 解析成后端无关的设计 token。
 *
 * ThemeSpec 里本来就有完整的 ink / type 信息(见 flint-chart 的 THEME_PRESETS),
 * 只是之前只有 Vega-Lite 组装器消费它。这里抽出 ECharts / Chart.js 也能用的
 * 最小集合:背景、文字、网格/轴、系列调色板、字体。
 *
 * 支持三种 theme_spec 写法(与 Flint 官方一致):
 *   "economist"                                  // 预设 id
 *   { extends: "economist", ink: {...覆盖} }      // 基于预设定制
 *   { ink: {...}, type: {...} }                  // 完全自定义
 */
import { THEME_PRESETS } from 'flint-chart';

export interface ThemeTokens {
  id: string;
  /** 画布背景色;未定义表示跟随宿主(我们默认白底) */
  background?: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  grid: string;
  axis: string;
  /** 类别型系列调色板;至少一个颜色 */
  palette: string[];
  fontFamily?: string;
}

const DEFAULT_TOKENS: Omit<ThemeTokens, 'id'> = {
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  grid: '#e5e7eb',
  axis: '#374151',
  palette: ['#4c78a8'],
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 颜色归一化:
 * - 8 位 hex(#RRGGBBAA)转成 rgba(),因为 ECharts/Chart.js 对 8 位 hex 的
 *   支持不一致(例如 nature 主题的网格是 #00000000 透明色);
 * - 其它合法写法原样返回。
 */
export function normalizeThemeColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const color = value.trim();
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(color);
  if (!match) return color;
  const alpha = Number.parseInt(match[2], 16) / 255;
  const red = Number.parseInt(match[1].slice(0, 2), 16);
  const green = Number.parseInt(match[1].slice(2, 4), 16);
  const blue = Number.parseInt(match[1].slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
}

/** 递归合并 ThemeSpec(数组整体替换) */
function mergeSpec(base: any, override: any): any {
  if (!isPlainObject(base)) return override;
  if (!isPlainObject(override)) return base;
  const merged: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key])
        ? mergeSpec(base[key], value)
        : value;
  }
  return merged;
}

function presetSpec(id: string): any | undefined {
  const preset = (THEME_PRESETS as Record<string, any>)[id];
  return preset?.spec;
}

/** 从 ThemeSpec 抽取 token */
function tokensFromSpec(spec: any): ThemeTokens {
  const ink = spec?.ink ?? {};
  const type = spec?.type ?? {};
  const series = ink.series ?? {};
  const categorical: unknown[] = Array.isArray(series.categorical)
    ? series.categorical
    : [];
  const palette = (categorical.length > 0 ? categorical : [series.single])
    .map(normalizeThemeColor)
    .filter((color): color is string => !!color);

  return {
    id: typeof spec?.id === 'string' ? spec.id : 'custom',
    background: normalizeThemeColor(ink.surface?.canvas),
    textPrimary: normalizeThemeColor(ink.text?.primary) ?? DEFAULT_TOKENS.textPrimary,
    textSecondary:
      normalizeThemeColor(ink.text?.secondary) ?? DEFAULT_TOKENS.textSecondary,
    textMuted: normalizeThemeColor(ink.text?.muted) ?? DEFAULT_TOKENS.textMuted,
    grid: normalizeThemeColor(ink.structure?.grid) ?? DEFAULT_TOKENS.grid,
    axis: normalizeThemeColor(ink.structure?.axis) ?? DEFAULT_TOKENS.axis,
    palette: palette.length > 0 ? palette : DEFAULT_TOKENS.palette,
    fontFamily: typeof type.headline?.family === 'string' ? type.headline.family : undefined,
  };
}

/**
 * 解析 theme_spec → token。
 * 无法解析(未知预设 id / 空对象)时返回 null,由调用方决定是否 warning。
 */
export function resolveThemeTokens(
  themeSpec: unknown,
  depth = 0,
): ThemeTokens | null {
  if (themeSpec == null || depth > 3) return null;

  if (typeof themeSpec === 'string') {
    const spec = presetSpec(themeSpec);
    return spec ? tokensFromSpec(spec) : null;
  }
  if (!isPlainObject(themeSpec)) return null;

  const extendsId = typeof themeSpec.extends === 'string' ? themeSpec.extends : undefined;
  let base: any = extendsId ? presetSpec(extendsId) : undefined;
  if (!base && extendsId) return null; // extends 指向未知预设
  const merged = mergeSpec(base ?? {}, themeSpec);
  // 没有 ink/type 的自定义对象也允许:会回落到默认 token
  return tokensFromSpec(merged);
}
