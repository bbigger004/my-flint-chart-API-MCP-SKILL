import { vlAllTemplateDefs, ecAllTemplateDefs, cjsAllTemplateDefs, plAllTemplateDefs, excelAllTemplateDefs, THEME_PRESETS } from 'flint-chart';
import fs from 'fs';

const slim = (arr) => arr.map((d) => ({ chart: d.chart, channels: d.channels }));

const out = {
  themes: Object.keys(THEME_PRESETS),
  templates: {
    vegalite: slim(vlAllTemplateDefs),
    echarts: slim(ecAllTemplateDefs),
    chartjs: slim(cjsAllTemplateDefs),
    plotly: slim(plAllTemplateDefs),
    excel: slim(excelAllTemplateDefs),
  },
};

fs.writeFileSync('/tmp/flint_registry.json', JSON.stringify(out, null, 2));
console.log('themes:', JSON.stringify(out.themes));
for (const [k, v] of Object.entries(out.templates)) console.log(k, v.length);
console.log('--- sample def (vegalite[0]) ---');
console.log(JSON.stringify(vlAllTemplateDefs[0], null, 2).slice(0, 1500));
