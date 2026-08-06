// content script 加载自定义 locale 的测试
// 回归覆盖：MV3 中 content script fetch 扩展内资源受 web_accessible_resources 限制，
// _locales/ 不在白名单时 console 报 "Failed to load locale: Failed to fetch"（v1.8.0 已修）
import { test, expect, gotoTestPage } from "./fixtures.mjs";

test.describe("content script 自定义 locale 加载", () => {
  test("locale=en：成功加载 _locales/en/messages.json（无 fetch 报错）", async ({
    page,
    extensionId,
    setupConfig,
  }) => {
    // 非默认语言 → content script 的 Aria2I18n.init() 会 fetch _locales/en/messages.json
    await setupConfig({ locale: "en" });

    const warnings = [];
    page.on("console", (m) => {
      if (m.type() === "warning" && m.text().includes("Failed to load locale")) {
        warnings.push(m.text());
      }
    });

    await gotoTestPage(page);

    // W.A.R. 修复的直接证据：页面上下文（与 content script 同受限）能 fetch 到
    // chrome-extension://.../_locales/en/messages.json（修复前抛 Failed to fetch）
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(
            async (extId) =>
              (await fetch(`chrome-extension://${extId}/_locales/en/messages.json`)).ok,
            extensionId
          );
        } catch {
          return false;
        }
      })
      .toBe(true);

    // 等 content script 的 init() 跑完（若 fetch 失败会立即 console.warn）
    await page.waitForTimeout(800);
    expect(warnings).toEqual([]);
  });
});
