/**
 * 把主题 token 注入 ECharts / Chart.js 的原生 spec。
 *
 * 能力边界(有意为之):这里只映射视觉 token(调色板、背景、文字、网格/轴、
 * 字体)。主题里与布局/几何相关的部分由各后端自己的布局引擎决定,不做跨后端
 * 强行对齐,避免把图改坏。
 */
import type { ThemeTokens } from './theme.tokens';

/** 把颜色转成带透明度的 rgba();已是 rgba()/其它写法时原样返回 */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex.split('').map((char) => char + char).join('');
  }
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** 已有的颜色定义(字符串/数组)按主题调色板重着色,未定义则用主色 */
function recolor(existing: unknown, palette: string[], primary: string): string | string[] {
  if (Array.isArray(existing) && existing.length > 0) {
    return existing.map((_, index) => palette[index % palette.length]);
  }
  return primary;
}

/** ECharts:注入系列调色板 + 背景 + 文字/网格/轴/图例颜色 */
export function applyThemeToECharts(spec: any, tokens: ThemeTokens): void {
  if (!spec || typeof spec !== 'object') return;
  spec.color = tokens.palette;
  if (tokens.background) spec.backgroundColor = tokens.background;
  spec.textStyle = {
    ...(spec.textStyle ?? {}),
    color: tokens.textPrimary,
    ...(tokens.fontFamily ? { fontFamily: tokens.fontFamily } : {}),
  };

  const titles = Array.isArray(spec.title) ? spec.title : spec.title ? [spec.title] : [];
  for (const title of titles) {
    if (!title || typeof title !== 'object') continue;
    title.textStyle = {
      fontSize: 14,
      fontWeight: 'bold',
      ...(title.textStyle ?? {}),
      color: tokens.textPrimary,
      ...(tokens.fontFamily ? { fontFamily: tokens.fontFamily } : {}),
    };
    title.subtextStyle = {
      fontSize: 11,
      ...(title.subtextStyle ?? {}),
      color: tokens.textSecondary,
      ...(tokens.fontFamily ? { fontFamily: tokens.fontFamily } : {}),
    };
  }

  for (const key of ['xAxis', 'yAxis'] as const) {
    const axes = Array.isArray(spec[key]) ? spec[key] : spec[key] ? [spec[key]] : [];
    for (const axis of axes) {
      if (!axis || typeof axis !== 'object') continue;
      axis.axisLine = {
        ...(axis.axisLine ?? {}),
        lineStyle: { ...(axis.axisLine?.lineStyle ?? {}), color: tokens.axis },
      };
      axis.axisLabel = {
        ...(axis.axisLabel ?? {}),
        color: tokens.textSecondary,
        ...(tokens.fontFamily ? { fontFamily: tokens.fontFamily } : {}),
      };
      axis.splitLine = {
        ...(axis.splitLine ?? {}),
        lineStyle: { ...(axis.splitLine?.lineStyle ?? {}), color: tokens.grid },
      };
      if (axis.name) {
        axis.nameTextStyle = { ...(axis.nameTextStyle ?? {}), color: tokens.textSecondary };
      }
    }
  }

  const legends = Array.isArray(spec.legend) ? spec.legend : spec.legend ? [spec.legend] : [];
  for (const legend of legends) {
    if (!legend || typeof legend !== 'object') continue;
    legend.textStyle = {
      ...(legend.textStyle ?? {}),
      color: tokens.textSecondary,
      ...(tokens.fontFamily ? { fontFamily: tokens.fontFamily } : {}),
    };
  }

  // 组装器会给 series 写死默认色(itemStyle.color),必须一起覆盖,
  // 否则 spec.color 调色板根本轮不到生效(实测 Bar Chart 就是这样)。
  const palette = tokens.palette.length > 0 ? tokens.palette : ['#4c78a8'];
  const seriesList = Array.isArray(spec.series) ? spec.series : spec.series ? [spec.series] : [];
  seriesList.forEach((series: any, index: number) => {
    if (!series || typeof series !== 'object') return;
    const primary = palette[index % palette.length];
    series.itemStyle = { ...(series.itemStyle ?? {}), color: primary };
    if (series.lineStyle) {
      series.lineStyle = { ...series.lineStyle, color: primary };
    }
    if (series.areaStyle) {
      series.areaStyle = { ...series.areaStyle, color: withAlpha(primary, 0.15) };
    }

    // 饼图/环图/玫瑰图/漏斗等:颜色挂在每个数据片上
    if (Array.isArray(series.data)) {
      const sliceTypes = new Set(['pie', 'doughnut', 'rose', 'funnel', 'sunburst', 'treemap']);
      const looksLikeSlices =
        sliceTypes.has(series.type) ||
        series.data.some((item: any) => item && typeof item === 'object' && 'value' in item);
      if (looksLikeSlices) {
        series.data = series.data.map((item: any, sliceIndex: number) => {
          const color = palette[sliceIndex % palette.length];
          if (item && typeof item === 'object') {
            return { ...item, itemStyle: { ...(item.itemStyle ?? {}), color } };
          }
          return { value: item, itemStyle: { color } };
        });
        // 逐片颜色优先于 series 级颜色
        if (series.itemStyle) delete series.itemStyle.color;
      }
    }
  });

  // 连续色带(热力图等):用主题调色板作为 stops
  const visualMaps = Array.isArray(spec.visualMap)
    ? spec.visualMap
    : spec.visualMap
      ? [spec.visualMap]
      : [];
  for (const visualMap of visualMaps) {
    if (!visualMap || typeof visualMap !== 'object') continue;
    visualMap.inRange = { ...(visualMap.inRange ?? {}), color: palette };
  }
}

/** Chart.js:注入数据集颜色 + 背景 + 刻度/网格/图例/标题颜色 */
export function applyThemeToChartjs(spec: any, tokens: ThemeTokens): void {
  if (!spec || typeof spec !== 'object') return;
  const palette = tokens.palette.length > 0 ? tokens.palette : ['#4c78a8'];

  spec.options = spec.options ?? {};
  spec.options.color = tokens.textSecondary;
  if (tokens.fontFamily) {
    spec.options.font = { ...(spec.options.font ?? {}), family: tokens.fontFamily };
  }

  const defaultType =
    typeof spec.type === 'string' ? spec.type : (spec.data?.datasets?.[0]?.type ?? 'bar');
  const datasets: any[] = Array.isArray(spec.data?.datasets) ? spec.data.datasets : [];
  datasets.forEach((dataset, index) => {
    if (!dataset || typeof dataset !== 'object') return;
    const primary = palette[index % palette.length];
    const datasetType = dataset.type ?? defaultType;

    if (datasetType === 'line') {
      dataset.borderColor = primary;
      dataset.pointBackgroundColor = primary;
      dataset.pointBorderColor = primary;
      dataset.backgroundColor = withAlpha(primary, 0.15);
      return;
    }
    if (datasetType === 'pie' || datasetType === 'doughnut' || datasetType === 'polarArea') {
      const count = Array.isArray(dataset.data) ? dataset.data.length : palette.length;
      dataset.backgroundColor = Array.from(
        { length: Math.max(count, 1) },
        (_, sliceIndex) => palette[sliceIndex % palette.length],
      );
      dataset.borderColor = tokens.background ?? '#ffffff';
      return;
    }
    dataset.backgroundColor = recolor(dataset.backgroundColor, palette, primary);
    dataset.borderColor = recolor(dataset.borderColor, palette, primary);
  });

  const scales = spec.options.scales ?? {};
  for (const scale of Object.values(scales)) {
    if (!scale || typeof scale !== 'object') continue;
    const axis = scale as Record<string, any>;
    axis.grid = { ...(axis.grid ?? {}), color: tokens.grid };
    axis.ticks = { ...(axis.ticks ?? {}), color: tokens.textSecondary };
    axis.border = { ...(axis.border ?? {}), color: tokens.axis };
    if (axis.title) axis.title = { ...axis.title, color: tokens.textSecondary };
    if (axis.pointLabels) {
      axis.pointLabels = { ...axis.pointLabels, color: tokens.textSecondary };
    }
  }

  spec.options.plugins = spec.options.plugins ?? {};
  const legend = spec.options.plugins.legend;
  if (legend && typeof legend === 'object') {
    legend.labels = { ...(legend.labels ?? {}), color: tokens.textSecondary };
  }
  const title = spec.options.plugins.title;
  if (title && typeof title === 'object') {
    title.color = tokens.textPrimary;
  }
  const tooltip = spec.options.plugins.tooltip;
  if (tooltip && typeof tooltip === 'object') {
    tooltip.titleColor = tokens.textPrimary;
    tooltip.bodyColor = tokens.textSecondary;
    tooltip.backgroundColor = tokens.background ?? '#ffffff';
  }
}
