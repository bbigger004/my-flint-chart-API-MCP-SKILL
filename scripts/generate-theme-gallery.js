/**
 * 生成「3 后端 × 10 主题」对比图册。
 *
 * 用法(在 backend/ 目录):
 *   npm run build && node scripts/generate-theme-gallery.js
 *
 * 产物目录:examples/theme-gallery/
 *   <backend>/<theme>.svg|png   单张图(vegalite/echarts 同时给 SVG + PNG,chartjs 只有 PNG)
 *   index.html                  可直接打开的图册
 *   contact-sheet.png           全量拼版(10 主题 × 3 后端)
 *   contact-sheet-hero.png      汇报用精选拼版(5 主题 × 3 后端,大图)
 *   charts.json                 每张图的元数据
 *   README.md                   说明
 *
 * 依赖 backend/dist 的渲染核心,因此必须先 build。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { Resvg } = require('@resvg/resvg-js');
const { THEME_PRESETS } = require('flint-chart');
const { renderChart } = require('../dist/flint/render/render-core.js');

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'examples', 'theme-gallery');
const BACKENDS = ['vegalite', 'echarts', 'chartjs'];
const THEMES = Object.keys(THEME_PRESETS);
const HERO_THEMES = ['economist', 'swiss', 'powerbi-light', 'pop', 'cartoon'];

/** 演示数据:某咖啡店三品类 12 个月营业额(与前端 demo 同源,无随机) */
const MONTHS = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
const REVENUE_BY_CATEGORY = {
  咖啡: [12840, 12360, 14180, 15220, 15860, 16140, 16920, 16540, 15780, 16230, 14860, 17340],
  甜品: [5310, 4980, 5870, 6320, 6610, 6740, 7160, 7020, 6580, 6810, 6180, 7490],
  周边: [2220, 2010, 2650, 2980, 3360, 3740, 4220, 4560, 4680, 5120, 5480, 6240],
};

const ROWS = [];
for (const [category, values] of Object.entries(REVENUE_BY_CATEGORY)) {
  values.forEach((revenue, index) => ROWS.push({ month: MONTHS[index], category, revenue }));
}

const INPUT = {
  data: { values: ROWS },
  semantic_types: { month: 'YearMonth', category: 'Category', revenue: 'Amount' },
  field_display_names: { month: '月份', category: '品类', revenue: '营业额' },
  chart_spec: {
    chartType: 'Line Chart',
    title: '三个品类全年都在涨,咖啡仍是绝对主力',
    subtitle: '某咖啡店月度营业额 · 单位人民币',
    encodings: {
      x: { field: 'month' },
      y: { field: 'revenue' },
      color: { field: 'category' },
    },
    baseSize: { width: 640, height: 380 },
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** SVG → PNG(统一缩略图尺寸用) */
function rasterize(svg) {
  return Buffer.from(
    new Resvg(svg, {
      background: '#ffffff',
      font: { loadSystemFonts: true },
      fitTo: { mode: 'original' },
    })
      .render()
      .asPng(),
  );
}

/** 渲染单张图,返回 { svg?, png } */
async function renderOne(backend, theme) {
  if (backend === 'chartjs') {
    const result = await renderChart(backend, { ...INPUT, theme_spec: theme }, { format: 'png' });
    return { png: result.buffer, width: result.width, height: result.height, warnings: result.warnings.length };
  }
  const result = await renderChart(backend, { ...INPUT, theme_spec: theme }, { format: 'svg' });
  return {
    svg: result.svg,
    png: rasterize(result.svg),
    width: result.width,
    height: result.height,
    warnings: result.warnings.length,
  };
}

/** 画一张拼版:rows=主题, cols=后端 */
async function composeSheet(items, sheetPath, options) {
  const { cellWidth, cellHeight, title } = options;
  const margin = 32;
  const headerHeight = 74;
  const labelHeight = 26;
  const columns = BACKENDS.length;
  const width = margin * 2 + columns * cellWidth + (columns - 1) * 16;
  const height = margin * 2 + headerHeight + items.length * (cellHeight + labelHeight + 14);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(title, margin, margin + 26);
  ctx.fillStyle = '#6b7280';
  ctx.font = '14px sans-serif';
  ctx.fillText(
    '同一份数据 / 同一个 ChartAssemblyInput,仅更换 theme_spec;vegalite、echarts 为 SVG 渲染,chartjs 为 PNG。',
    margin,
    margin + 52,
  );

  const themeLabels = {
    nyt: 'NYT',
    economist: 'The Economist',
    swiss: 'Swiss',
    nature: 'Nature',
    mckinsey: 'McKinsey',
    datawrapper: 'Datawrapper',
    powerbi: 'Power BI',
    'powerbi-light': 'Power BI Light',
    pop: 'Pop',
    cartoon: 'Cartoon',
  };

  for (let row = 0; row < items.length; row++) {
    const theme = items[row].theme;
    const rowY = margin + headerHeight + row * (cellHeight + labelHeight + 14);
    for (let col = 0; col < columns; col++) {
      const backend = BACKENDS[col];
      const cellX = margin + col * (cellWidth + 16);
      const item = items[row].charts[backend];
      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(cellX, rowY, cellWidth, cellHeight);

      if (item?.png) {
        const image = await loadImage(item.png);
        const scale = Math.min(
          (cellWidth - 16) / image.width,
          (cellHeight - 16) / image.height,
        );
        const drawWidth = Math.round(image.width * scale);
        const drawHeight = Math.round(image.height * scale);
        ctx.drawImage(
          image,
          cellX + Math.round((cellWidth - drawWidth) / 2),
          rowY + Math.round((cellHeight - drawHeight) / 2),
          drawWidth,
          drawHeight,
        );
      }

      ctx.fillStyle = '#374151';
      ctx.font = '13px sans-serif';
      const backendLabel = backend === 'chartjs' ? 'chart.js' : backend;
      ctx.fillText(backendLabel, cellX, rowY + cellHeight + 18);
    }
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(
      `${themeLabels[theme] ?? theme}  (${theme})`,
      margin,
      rowY + cellHeight + 20,
    );
  }

  fs.writeFileSync(sheetPath, canvas.toBuffer('image/png'));
  return { width, height };
}

function writeReadme(sheetHero, sheetFull, chartCount) {
  const readme = `# Flint 主题对比图册(3 后端 × 10 主题)

同一份数据、同一个 \`ChartAssemblyInput\`,只更换 \`theme_spec\`,对比三个渲染后端的主题还原度:

- **vegalite**:Flint 完整主题实现(布局 + 视觉);
- **echarts / chartjs**:本项目的主题 token 映射(系列调色板、画布背景、
  文字/网格/轴颜色、字体)。

## 怎么用

- 直接打开 [index.html](./index.html) 浏览全部 ${chartCount} 张;
- 汇报用精选拼版:[contact-sheet-hero.png](./contact-sheet-hero.png)
  (${sheetHero.width}×${sheetHero.height},5 大主题 × 3 后端);
- 全量拼版:[contact-sheet.png](./contact-sheet.png)
  (${sheetFull.width}×${sheetFull.height},10 主题 × 3 后端);
- 单张文件在 \`<backend>/<theme>.svg|png\`;chartjs 只有 PNG(引擎没有 SVG 输出)。
- 元数据见 [charts.json](./charts.json)。

## 怎么重新生成

\`\`\`bash
cd backend
npm run build
node scripts/generate-theme-gallery.js
\`\`\`

## 数据与图表

- 数据:某咖啡店三品类(咖啡/甜品/周边)12 个月营业额,共 36 行,无随机;
- 图表:Line Chart,\`x=month\`、\`y=revenue\`、\`color=category\`;
- 主题:Flint 内置的 10 套预设(nyt / economist / swiss / nature / mckinsey /
  datawrapper / powerbi / powerbi-light / pop / cartoon)。
`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readme, 'utf8');
}

function writeIndex(items) {
  const backendTitle = { vegalite: 'Vega-Lite', echarts: 'ECharts', chartjs: 'Chart.js' };
  const themeCards = items
    .map((item) => {
      const cards = BACKENDS.map((backend) => {
        const file = item.charts[backend].relativePath;
        return `
        <figure>
          <img src="./${file}" alt="${backendTitle[backend]} / ${item.theme}" loading="lazy" />
          <figcaption>${backendTitle[backend]}</figcaption>
        </figure>`;
      }).join('');
      return `
      <section class="theme">
        <h2>${item.label} <code>${item.theme}</code></h2>
        <div class="grid">${cards}</div>
      </section>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flint 主题对比图册(3 后端 × 10 主题)</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 32px 80px; font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", Arial, sans-serif; color: #111827; background: #fff; }
  header { max-width: 1360px; margin: 0 auto 36px; }
  h1 { font-size: 28px; margin: 0 0 10px; }
  header p { margin: 4px 0; color: #4b5563; }
  .links a { color: #006ba2; margin-right: 16px; }
  .theme { max-width: 1360px; margin: 0 auto 44px; }
  .theme h2 { font-size: 19px; margin: 0 0 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
  .theme h2 code { font-size: 13px; color: #6b7280; font-weight: 400; margin-left: 6px; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  figure { margin: 0; background: #f9fafb; border: 1px solid #eef0f3; border-radius: 6px; padding: 10px; }
  figure img { width: 100%; height: auto; display: block; }
  figcaption { margin-top: 8px; font-size: 12px; color: #6b7280; text-align: center; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Flint 主题对比图册</h1>
  <p>同一份数据、同一个 <code>ChartAssemblyInput</code>,只更换 <code>theme_spec</code>;对比 3 个渲染后端 × 10 套主题。</p>
  <p>vegalite 为 Flint 完整主题实现;echarts / chartjs 为主题 token 映射(调色板、背景、文字/网格/轴、字体)。</p>
  <p class="links">
    <a href="./contact-sheet-hero.png">精选拼版(汇报用)</a>
    <a href="./contact-sheet.png">全量拼版</a>
    <a href="./charts.json">charts.json</a>
  </p>
</header>
${themeCards}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html, 'utf8');
}

async function main() {
  ensureDir(OUTPUT_DIR);
  for (const backend of BACKENDS) ensureDir(path.join(OUTPUT_DIR, backend));

  const items = [];
  for (const theme of THEMES) {
    const label = THEME_PRESETS[theme]?.label ?? theme;
    const charts = {};
    for (const backend of BACKENDS) {
      const rendered = await renderOne(backend, theme);
      if (rendered.svg) {
        const svgPath = path.join(OUTPUT_DIR, backend, `${theme}.svg`);
        fs.writeFileSync(svgPath, rendered.svg, 'utf8');
      }
      const pngName = `${theme}.png`;
      fs.writeFileSync(path.join(OUTPUT_DIR, backend, pngName), rendered.png);
      charts[backend] = {
        relativePath: `${backend}/${pngName}`,
        svgPath: rendered.svg ? `${backend}/${theme}.svg` : null,
        png: rendered.png,
        width: rendered.width,
        height: rendered.height,
        warnings: rendered.warnings,
        bytes: rendered.png.length,
      };
      process.stdout.write(`  ${backend}/${theme} (${rendered.width}×${rendered.height}, ${rendered.png.length}B)\n`);
    }
    items.push({ theme, label, charts });
  }

  const fullItems = items;
  const heroItems = items.filter((item) => HERO_THEMES.includes(item.theme));

  const sheetFull = await composeSheet(fullItems, path.join(OUTPUT_DIR, 'contact-sheet.png'), {
    cellWidth: 420,
    cellHeight: 300,
    title: 'Flint 主题对比 · 10 主题 × 3 后端',
  });
  const sheetHero = await composeSheet(heroItems, path.join(OUTPUT_DIR, 'contact-sheet-hero.png'), {
    cellWidth: 560,
    cellHeight: 380,
    title: 'Flint 主题对比(精选)· 5 主题 × 3 后端',
  });

  const metadata = {
    generatedAt: new Date().toISOString(),
    chart: INPUT.chart_spec.chartType,
    dataRows: ROWS.length,
    backends: BACKENDS,
    themes: THEMES,
    heroThemes: HERO_THEMES,
    sheets: {
      full: { file: 'contact-sheet.png', ...sheetFull },
      hero: { file: 'contact-sheet-hero.png', ...sheetHero },
    },
    charts: items.map((item) => ({
      theme: item.theme,
      label: item.label,
      files: Object.fromEntries(
        BACKENDS.map((backend) => [
          backend,
          {
            png: item.charts[backend].relativePath,
            svg: item.charts[backend].svgPath,
            width: item.charts[backend].width,
            height: item.charts[backend].height,
            bytes: item.charts[backend].bytes,
            warnings: item.charts[backend].warnings,
          },
        ]),
      ),
    })),
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'charts.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );

  writeIndex(items);
  writeReadme(sheetHero, sheetFull, items.length * BACKENDS.length);
  console.log(`\n完成:${items.length * BACKENDS.length} 张图 → ${OUTPUT_DIR}`);
  console.log(`拼版:contact-sheet.png ${sheetFull.width}×${sheetFull.height},contact-sheet-hero.png ${sheetHero.width}×${sheetHero.height}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
