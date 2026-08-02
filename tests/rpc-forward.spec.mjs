// RPC 转发细节测试：请求格式、rpc-secret、headers（UA/Referer/Cookie）、文件名提取
import { test, expect } from "./fixtures.mjs";

const PAGE = `http://127.0.0.1:${process.env.MOCK_PORT}/`;

async function clickZip(page) {
  await page.click("#link-zip");
  await expect(page.locator("#__aria2_bridge_toast")).toBeVisible();
}

async function addUriRequests(mock) {
  await expect
    .poll(async () => (await mock.addUris()).length)
    .toBeGreaterThanOrEqual(1);
  return mock.addUris();
}

test.describe("RPC 转发", () => {
  test.beforeEach(async ({ page, setupConfig }) => {
    await setupConfig();
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  });

  test("addUri 请求体符合 aria2 JSON-RPC 规范", async ({ page, mock }) => {
    await clickZip(page);
    const [add] = await addUriRequests(mock);

    expect(add.body.jsonrpc).toBe("2.0");
    expect(add.body.method).toBe("aria2.addUri");
    expect(typeof add.body.id).toBe("string");
    expect(add.body.id).toMatch(/^bridge_/);
    // params[0] = URL 数组
    expect(Array.isArray(add.params[0])).toBe(true);
    expect(add.params[0][0]).toBe(`${PAGE}files/pack.zip`);
  });

  test("配置 rpcSecret → 请求带 token: 前缀参数", async ({ page, mock, setupConfig }) => {
    await setupConfig({ rpcSecret: "MySecret" });
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await clickZip(page);

    const [add] = await addUriRequests(mock);
    expect(add.params[0]).toBe("token:MySecret");
    expect(add.params[1][0]).toBe(`${PAGE}files/pack.zip`);
  });

  test("未配置 secret → 不带 token 参数", async ({ page, mock }) => {
    await clickZip(page);
    const [add] = await addUriRequests(mock);
    expect(add.params[0][0]).toBe(`${PAGE}files/pack.zip`);
  });

  test("透传 User-Agent / Referer / Cookie 头部", async ({ page, mock, context }) => {
    // 给 mock 域种一个 cookie（模拟登录态下载）
    await context.addCookies([
      { name: "sid", value: "abc123", url: PAGE },
    ]);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    await clickZip(page);

    const [add] = await addUriRequests(mock);
    const headers = add.params[1].header;
    expect(Array.isArray(headers)).toBe(true);

    // UA：与浏览器一致（取页面真实 UA，断言前缀即可）
    const pageUA = await page.evaluate(() => navigator.userAgent);
    const ua = headers.find((h) => h.startsWith("User-Agent: "));
    expect(ua).toBeTruthy();
    expect(ua).toContain(pageUA.split(" ")[0]);

    // Referer：当前页面 URL
    expect(headers).toContain(`Referer: ${PAGE}`);

    // Cookie：种下的 sid 透传
    expect(headers).toContain("Cookie: sid=abc123");
  });

  test("URL 带文件名 → options.out 提取文件名", async ({ page, mock }) => {
    await clickZip(page);
    const [add] = await addUriRequests(mock);
    expect(add.params[1].out).toBe("pack.zip");
  });
});
