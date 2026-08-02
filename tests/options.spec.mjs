// 设置页测试：默认值回显、自动保存、字段格式化、enabled → Badge、语言切换
import { test, expect } from "./fixtures.mjs";

test.describe("设置页", () => {
  test.beforeEach(async ({ page, setupConfig, extensionId }) => {
    await setupConfig();
    await page.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: "domcontentloaded",
    });
    // 等 settings 加载完成（DOMContentLoaded 异步 loadSettings）
    await expect(page.locator("#rpcUrl")).toHaveValue("http://127.0.0.1:18951/jsonrpc", {
      timeout: 15000,
    });
  });

  test("默认值回显（未配置时）", async ({ page, sw, extensionId }) => {
    // 清空 storage 配置 → 重新打开选项页应回显代码默认值
    await sw.evaluate(() => chrome.storage.sync.clear());
    await page.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#rpcUrl")).toHaveValue("http://localhost:6800/jsonrpc", {
      timeout: 15000,
    });
    await expect(page.locator("#enabled")).toBeChecked();
    await expect(page.locator("#interceptMagnet")).toBeChecked();
  });

  test("interceptMagnet 开关 → change 自动保存到 storage", async ({ page, sw }) => {
    await page.locator("#interceptMagnet").uncheck();
    await expect
      .poll(async () => {
        const data = await sw.evaluate(() => chrome.storage.sync.get("interceptMagnet"));
        return data.interceptMagnet;
      })
      .toBe(false);

    // 重新勾选 → 恢复 true
    await page.locator("#interceptMagnet").check();
    await expect
      .poll(async () => {
        const data = await sw.evaluate(() => chrome.storage.sync.get("interceptMagnet"));
        return data.interceptMagnet;
      })
      .toBe(true);
  });

  test("修改 RPC 地址/密钥 → change 自动保存到 storage", async ({ page, sw }) => {
    await page.fill("#rpcUrl", "http://192.168.1.10:6800/jsonrpc");
    await page.fill("#rpcSecret", "s3cret");
    await page.locator("#rpcSecret").blur();

    await expect
      .poll(async () => {
        const data = await sw.evaluate(() => chrome.storage.sync.get(["rpcUrl", "rpcSecret"]));
        return data;
      })
      .toEqual({
        rpcUrl: "http://192.168.1.10:6800/jsonrpc",
        rpcSecret: "s3cret",
      });
  });

  test("downloadExts 保存：自动小写、补点、过滤空行", async ({ page, sw }) => {
    await page.fill("#downloadExts", "ZIP\npdf\n\n.exe");
    await page.locator("#downloadExts").blur();

    await expect
      .poll(async () => {
        const data = await sw.evaluate(() => chrome.storage.sync.get("downloadExts"));
        return data.downloadExts;
      })
      .toEqual([".zip", ".pdf", ".exe"]);
  });

  test("bypassDomains 保存：去空格、过滤空行", async ({ page, sw }) => {
    await page.fill("#bypassDomains", " example.com \ncdn.test.org\n\n");
    await page.locator("#bypassDomains").blur();

    await expect
      .poll(async () => {
        const data = await sw.evaluate(() => chrome.storage.sync.get("bypassDomains"));
        return data.bypassDomains;
      })
      .toEqual(["example.com", "cdn.test.org"]);
  });

  test("取消启用 → 工具栏 Badge 显示 OFF", async ({ page, sw }) => {
    await page.uncheck("#enabled");

    await expect
      .poll(async () => {
        const text = await sw.evaluate(() => chrome.action.getBadgeText({}));
        return text;
      })
      .toBe("OFF");
  });

  test("语言切换 zh_CN → en → 界面即时更新", async ({ page, setupConfig, extensionId }) => {
    await setupConfig({ locale: "zh_CN" });
    await page.goto(`chrome-extension://${extensionId}/options.html`, {
      waitUntil: "domcontentloaded",
    });
    // 中文界面
    await expect(page.locator("h2")).toContainText("设置", { timeout: 15000 });

    await page.selectOption("#localeSelect", "en");

    // 标题与 RPC 地址 label 变英文
    await expect(page.locator("h2")).toContainText("Settings");
    await expect(page.locator('label[for="rpcUrl"]')).toHaveText("Aria2 RPC URL");
  });
});
