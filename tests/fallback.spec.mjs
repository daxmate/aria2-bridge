// 回退测试：aria2 不可用（RPC error / HTTP 500）时自动回退浏览器原生下载
import { test, expect } from "./fixtures.mjs";

const PAGE = `http://127.0.0.1:${process.env.MOCK_PORT}/`;
const ZIP_URL = `${PAGE}files/pack.zip`;

// 在 SW 里 patch chrome.downloads.download，记录回退调用
// （Playwright 的 download 事件在扩展上下文不可靠，直接用调用记录断言）
async function watchFallbackDownloads(sw) {
  await sw.evaluate(() => {
    globalThis.__fallbackDownloads = [];
    const orig = chrome.downloads.download;
    chrome.downloads.download = (opts) => {
      globalThis.__fallbackDownloads.push(opts);
      return orig(opts);
    };
  });
}

async function fallbackDownloads(sw) {
  return sw.evaluate(() => globalThis.__fallbackDownloads || []);
}

test.describe("aria2 不可用 → 浏览器回退", () => {
  test.beforeEach(async ({ page, setupConfig }) => {
    await setupConfig();
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  });

  test("点击拦截路径：RPC 返回 error → 橙色 Toast + 浏览器原生下载", async ({
    page,
    sw,
    mock,
  }) => {
    await mock.config({ failMode: "error", errorMessage: "RPC secret mismatch" });
    await watchFallbackDownloads(sw);

    await page.click("#link-zip");

    // 失败 Toast（橙色样式）
    const toast = page.locator("#__aria2_bridge_toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("回退");
    const bg = await toast.evaluate((el) => el.style.background);
    expect(bg).toContain("255, 243, 224"); // #fff3e0 橙色系

    // 浏览器原生下载被重新发起（同一 URL）
    await expect
      .poll(async () => (await fallbackDownloads(sw)).length)
      .toBeGreaterThanOrEqual(1);
    const calls = await fallbackDownloads(sw);
    expect(calls[0].url).toBe(ZIP_URL);
  });

  test("点击拦截路径：HTTP 500 → 回退浏览器下载", async ({ page, sw, mock }) => {
    await mock.config({ failMode: "http500" });
    await watchFallbackDownloads(sw);

    await page.click("#link-zip");

    await expect(page.locator("#__aria2_bridge_toast")).toContainText("回退");
    await expect
      .poll(async () => (await fallbackDownloads(sw)).length)
      .toBeGreaterThanOrEqual(1);
    const calls = await fallbackDownloads(sw);
    expect(calls[0].url).toBe(ZIP_URL);
  });

  test("onCreated 兜底路径：aria2 失败 → 重新发起浏览器下载", async ({
    page,
    sw,
    mock,
  }) => {
    await mock.config({ failMode: "error" });
    await watchFallbackDownloads(sw);

    // 触发浏览器原生下载（.bin 不在默认拦截列表 → content 不拦，走 onCreated）
    await page.click("#link-bin");

    // 兜底转发失败后，扩展用 downloads.download 重新下载同一 URL
    await expect
      .poll(async () => (await fallbackDownloads(sw)).length)
      .toBeGreaterThanOrEqual(1);
    const calls = await fallbackDownloads(sw);
    expect(calls[0].url).toBe(`${PAGE}hold.bin`);

    // 无 Toast（onCreated 路径没有 toast 反馈）
    await page.waitForTimeout(400);
    expect(await page.locator("#__aria2_bridge_toast").count()).toBe(0);
  });
});
