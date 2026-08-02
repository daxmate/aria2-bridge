// Aria2 Bridge 测试共享 fixtures：扩展 context + mock aria2 控制
import { test as base, chromium } from "playwright/test";

const EXT_PATH = process.env.EXT_PATH;
const MOCK_PORT = process.env.MOCK_PORT;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;

// 与 background.js 默认一致的下载后缀列表（storage 未配置时行为相同）
export const DEFAULT_DOWNLOAD_EXTS = [
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".zst",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".mp3",
  ".mp4",
  ".avi",
  ".mkv",
  ".mov",
  ".flv",
  ".wmv",
  ".webm",
  ".iso",
  ".dmg",
  ".exe",
  ".msi",
  ".apk",
  ".deb",
  ".rpm",
  ".torrent",
  ".nzb",
  ".csv",
  ".json",
  ".xml",
  ".psd",
  ".ai",
  ".skp",
  ".epub",
  ".mobi",
  ".cbr",
];

export const TEST_PAGE = `${MOCK_BASE}/`;

// 打开测试页并等待 content script 就绪。
// content script 是 document_idle 注入（load 事件之后），慢机器（CI）上
// domcontentloaded 后立即点击可能还没注入 → 点击不被拦截 → 无 Toast。
// 因此等 load 事件 + 固定缓冲后再交互。
export async function gotoTestPage(page) {
  await page.goto(TEST_PAGE, { waitUntil: "load" });
  await page.waitForTimeout(500);
}

// 读取当前 toast 的背景色（成功 #e8f5e9 / 回退 #fff3e0，均为硬编码，不依赖 i18n 文案）。
// toast 生命周期约 2s，用 poll 轮询读取，语言无关且原子。
export async function toastBackground(page) {
  const el = await page.$("#__aria2_bridge_toast");
  return el ? await el.evaluate((n) => n.style.background) : null;
}

// 扩展 context fixture（每次测试独立临时 profile）
export const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      headless: false,
      viewport: { width: 1600, height: 1000 },
      locale: "zh-CN", // 固定语言：content script 的 chrome.i18n 文案（toast 等）跟随浏览器语言，CI 与本地必须一致
      args: [
        "--headless=new",
        // 控制浏览器 UI 语言 → chrome.i18n 文案（toast/通知）跟随，CI 与本地必须一致
        "--lang=zh-CN",
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    await use(context);
    await context.close();
  },

  // 扩展 ID（从 service worker 解析）
  extensionId: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    await use(new URL(worker.url()).host);
  },

  // service worker（用于设置 chrome.storage / 调用扩展内部逻辑）
  sw: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    await use(worker);
  },

  // 把扩展配置指向 mock aria2（可覆盖任意字段）
  setupConfig: async ({ sw }, use) => {
    const apply = async (extra = {}) => {
      await sw.evaluate(
        ({ base, extra }) =>
          new Promise((resolve) => {
            chrome.storage.sync.set(
              {
                rpcUrl: base + "/jsonrpc",
                rpcSecret: "",
                enabled: true,
                bypassDomains: [],
                // 固定 zh_CN：Aria2I18n 在 locale 非 auto 时会直接加载
                // _locales/zh_CN/messages.json（不依赖浏览器 UI 语言的 chrome.i18n），
                // 保证 toast/菜单文案在 CI 与本地一致
                locale: "zh_CN",
                // 注意：不默认写入 downloadExts — 留空会让 content script
                // 读到空数组而完全不拦截。需要自定义后缀的用例通过 extra 传入。
                ...extra,
              },
              resolve
            );
          }),
        { base: MOCK_BASE, extra }
      );
      // 强制 SW 内存 config 与 storage 同步：loadConfig 是异步的，
      // storage.onChanged 可能晚于用例读取 config（SW 启动竞态）
      await sw.evaluate(() => loadConfig());
      await new Promise((r) => setTimeout(r, 100));
    };
    await use(apply);
  },

  // mock server 控制（设置失败模式/stopped 列表 / 读请求记录）
  mock: async ({}, use) => {
    const api = {
      config: (cfg) =>
        fetch(`${MOCK_BASE}/__mock/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cfg),
        }),
      requests: async () => (await fetch(`${MOCK_BASE}/__mock/requests`)).json(),
      reset: () => fetch(`${MOCK_BASE}/__mock/reset`, { method: "POST" }),
      // 只取 aria2.addUri 请求（避免被 SW 启动时的 tellStopped 干扰）
      addUris: async () => {
        const { requests } = await api.requests();
        return requests.filter((r) => r.method === "aria2.addUri");
      },
      base: MOCK_BASE,
    };
    await api.reset();
    await use(api);
    await api.reset();
  },
});

export { expect } from "playwright/test";
