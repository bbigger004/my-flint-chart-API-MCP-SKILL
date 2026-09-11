/**
 * 把本目录下的 HTML 架构图渲染成同名的 1920×1080 PNG。
 *
 * 用法(在仓库任意位置执行都可以,脚本按自身所在目录找 HTML):
 *
 *   node backend/docs/diagrams/screenshot.mjs
 *
 * 依赖:playwright-core + chromium headless shell
 *
 *   npm i -D playwright-core
 *   npx playwright install chromium-headless-shell
 *
 * 查找顺序:
 *   1) 环境变量 PLAYWRIGHT_CORE 指向 playwright-core 的绝对路径
 *   2) 直接 require('playwright-core')(项目里装了就用它)
 *   3) 本机 dashi-ppt skill 自带的 playwright-core(存在时)
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
    path.join(os.homedir(), '.codex', 'skills', 'dashi-ppt', 'project', 'node_modules', 'playwright-core'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // 试下一个
    }
  }
  throw new Error(
    '未找到 playwright-core。请执行 npm i -D playwright-core,' +
      '或用 PLAYWRIGHT_CORE=<绝对路径> 指定。',
  );
}

/** 在 Playwright 的浏览器缓存里找 chromium headless shell */
function headlessShellPath() {
  const root = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(root)) {
    throw new Error(
      `未找到 Playwright 浏览器缓存:${root};请先执行 npx playwright install chromium-headless-shell`,
    );
  }
  for (const entry of readdirSync(root).filter((name) => name.startsWith('chromium_headless_shell-'))) {
    const revisionDir = path.join(root, entry);
    for (const platformDir of readdirSync(revisionDir)) {
      for (const binary of ['chrome-headless-shell', 'headless_shell']) {
        const candidate = path.join(revisionDir, platformDir, binary);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error('未找到 chromium headless shell,请执行 npx playwright install chromium-headless-shell');
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: headlessShellPath(), headless: true });

const targets = readdirSync(HERE).filter((file) => file.endsWith('.html'));
for (const file of targets) {
  const name = file.replace(/\.html$/, '');
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.goto(`file://${path.join(HERE, file)}`, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(HERE, '..', 'images', `${name}.png`), fullPage: false });
  await page.close();
  console.log('shot', name);
}

await browser.close();
