/**
 * 服务端字体管理:让 SVG/PNG 里的文字宽度与浏览器预览一致。
 *
 * 背景:
 * Vega 在浏览器里用真实 DOM 测文字宽度;在 Node 里没有 DOM,它只能
 * 用内置估算,遇到中文标题或长副标题容易把轴/标题空间算窄。
 * 这里的做法(来自官方 flint-chart-mcp):
 * 1) 用 @napi-rs/canvas 的 2D context 接管 vega.textMetrics.width,
 *    按每个文字 item 的 CSS font 精确测量;
 * 2) 把 Liberation Sans(与 Arial 度量兼容)注册成 Arial/Helvetica/sans-serif,
 *    让测宽和最终绘制(无论是浏览器还是 resvg)落在同一套字体上;
 * 3) resvg 出 PNG 时也显式带上这些字体文件,并允许加载系统字体,
 *    这样中文可以回退到 macOS/Win/Linux 本机 CJK 字体。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as napiCanvas from '@napi-rs/canvas';

/** 默认兜底字体(与 Arial 度量一致),系统里没有 Arial 时用它 */
export const DEFAULT_FONT_FAMILY = 'Liberation Sans';

/** 图表文字的字体栈:浏览器优先 Arial,服务端回退到打包的 Liberation Sans */
export const CHART_FONT_FAMILY =
  "Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', Roboto, sans-serif";

/** 需要被“别名到 Arial 度量字体”的通用/平台字体名 */
const SANS_ALIASES = ['sans-serif', 'Arial', 'Helvetica', 'Helvetica Neue', 'Liberation Sans'];

/** Arial 度量主字体(普通/粗体) */
const SANS_FONTS = [
  { file: 'LiberationSans-Regular.ttf', weight: 'normal' as const },
  { file: 'LiberationSans-Bold.ttf', weight: 'bold' as const },
];

/** 宽字符回退字体(中文等,注册为自己的族名,由 resvg 按需选用) */
const FALLBACK_FONTS = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'];

const FONT_FILES = [...SANS_FONTS.map((f) => f.file), ...FALLBACK_FONTS];

let fontDirCache: string | null = null;

/**
 * 定位 assets/fonts 目录。
 * 源码在 src/mcp,编译后在 dist/mcp,两者深度不同,所以从当前模块向上
 * 逐层找,直到发现 LiberationSans-Regular.ttf 为止。
 */
export function getFontDir(): string {
  if (fontDirCache) return fontDirCache;
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'assets', 'fonts', FONT_FILES[0]))) {
      fontDirCache = join(dir, 'assets', 'fonts');
      return fontDirCache;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  fontDirCache = join(process.cwd(), 'assets', 'fonts');
  return fontDirCache;
}

/** 实际存在的字体文件绝对路径列表(供 resvg 使用) */
export function getFontFiles(): string[] {
  const dir = getFontDir();
  return FONT_FILES.map((file) => join(dir, file)).filter((path) => existsSync(path));
}

let napiRegistered = false;

/** 把字体注册进 @napi-rs/canvas,幂等,可重复调用 */
export function registerNapiFonts(): void {
  if (napiRegistered || !napiCanvas.GlobalFonts?.registerFromPath) return;
  const dir = getFontDir();
  for (const alias of SANS_ALIASES) {
    for (const { file } of SANS_FONTS) {
      const fontPath = join(dir, file);
      if (!existsSync(fontPath)) continue;
      try {
        napiCanvas.GlobalFonts.registerFromPath(fontPath, alias);
      } catch {
        // 单个字体注册失败不阻塞整体渲染
      }
    }
  }
  for (const file of FALLBACK_FONTS) {
    const fontPath = join(dir, file);
    if (!existsSync(fontPath)) continue;
    try {
      napiCanvas.GlobalFonts.registerFromPath(fontPath, 'DejaVu Sans');
    } catch {
      // 同上
    }
  }
  napiRegistered = true;
}

let vegaTextMetricsInstalled = false;

/**
 * 用 @napi-rs/canvas 接管 Vega 的文本测量。
 * vega 暴露了 textMetrics.width 作为官方扩展点;注册一次后,后续所有
 * Vega 布局都会用精确的 CSS 字体宽度而不是内置估算。
 */
export function installVegaTextMetrics(vega: Record<string, any>): void {
  if (vegaTextMetricsInstalled || !napiCanvas.createCanvas) return;
  registerNapiFonts();
  const ctx = napiCanvas.createCanvas(64, 64).getContext('2d');
  // Vega 暴露 textMetrics 作为官方覆盖点;只改 width 一个方法即可
  vega.textMetrics.width = (item: unknown, text: string): number => {
    ctx.font = vega.font(item);
    return ctx.measureText(String(text ?? '')).width;
  };
  vegaTextMetricsInstalled = true;
}

/** resvg 出 PNG 时的字体配置:打包字体 + 允许加载系统字体(中文关键) */
export function resvgFontOption(): {
  fontFiles: string[];
  loadSystemFonts: boolean;
  defaultFontFamily: string;
} {
  return {
    fontFiles: getFontFiles(),
    loadSystemFonts: true,
    defaultFontFamily: DEFAULT_FONT_FAMILY,
  };
}
