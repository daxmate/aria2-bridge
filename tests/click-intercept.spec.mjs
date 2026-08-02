// 点击拦截测试：content script 三档拦截策略 + Toast 反馈
import { test, expect, DEFAULT_DOWNLOAD_EXTS, gotoTestPage, TEST_PAGE, toastBackground } from "./fixtures.mjs";

const PAGE = TEST_PAGE;

test.describe("点击拦截", () => {
  test.beforeEach(async ({ page, setupConfig }) => {
    await setupConfig();
    await gotoTestPage(page);
  });

  test("左键点击 .zip 链接 → 拦截并发送到 aria2 + 绿色 Toast", async ({ page, mock }) => {
    await page.click("#link-zip");

    // 绿色 Toast（#e8f5e9）——颜色断言语言无关，poll 原子读取
    await expect.poll(() => toastBackground(page)).toContain("232, 245, 233");

    // mock aria2 收到 addUri，URL 正确
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);
    const add = (await mock.addUris())[0];
    expect(add.params[0][0]).toBe(`${PAGE}files/pack.zip`);
  });

  test("无后缀普通链接 → 不拦截，正常导航", async ({ page, mock }) => {
    await page.click("#link-plain");
    await expect(page).toHaveURL(/\/page$/);
    await expect(page.locator("h1")).toContainText("Plain Page");

    // 不应有任何 RPC 请求
    const { requests } = await mock.requests();
    expect(requests.length).toBe(0);
  });

  test("hash 链接 → 不拦截", async ({ page, mock }) => {
    await page.click("#link-hash");
    await expect(page).toHaveURL(/#section$/);
    expect(await page.locator("#__aria2_bridge_toast").count()).toBe(0);
    const { requests } = await mock.requests();
    expect(requests.length).toBe(0);
  });

  test("download 属性 + 无后缀 → 不拦截（交由页面 JS / onCreated 兜底）", async ({
    page,
    mock,
  }) => {
    await page.click("#link-dlattr");

    // content script 不拦截 → 无 Toast
    await page.waitForTimeout(600);
    expect(await page.locator("#__aria2_bridge_toast").count()).toBe(0);

    // 浏览器发起下载 → onCreated 兜底转发（带 Content-Disposition 文件名）
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);
    const add = (await mock.addUris())[0];
    const out = add.params[1] && add.params[1].out;
    expect(out).toBe("测试文件.pdf"); // filename*=UTF-8'' 解析
  });

  test("中键点击 download 属性 + .zip 链接 → 拦截", async ({ page, mock }) => {
    await page.click("#link-mid", { button: "middle" });

    await expect(page.locator("#__aria2_bridge_toast")).toBeVisible();
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);
    const add = (await mock.addUris())[0];
    expect(add.params[0][0]).toBe(`${PAGE}files/mid.zip`);
  });

  test("Ctrl+点击 → 不拦截（新标签页打开）", async ({ page, context, mock }) => {
    // macOS 上 Ctrl+点击是右键菜单：新标签页修饰键 macOS 用 Meta，Linux/Windows 用 Control
    const NEW_TAB_MOD = process.platform === "darwin" ? "Meta" : "Control";
    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      page.click("#link-plain", { modifiers: [NEW_TAB_MOD] }),
    ]);
    await expect(newPage).toHaveURL(/\/page$/);
    await newPage.close();

    expect(await page.locator("#__aria2_bridge_toast").count()).toBe(0);
    const { requests } = await mock.requests();
    expect(requests.length).toBe(0);
  });

  test("自定义 downloadExts → 仅拦截配置的后缀", async ({ page, mock, setupConfig }) => {
    // 只配置 .bin：/hold.bin 应被 content script 拦截（默认列表里没有 .bin）
    await setupConfig({ downloadExts: [".bin"] });
    await gotoTestPage(page);
    await page.click("#link-bin");

    await expect(page.locator("#__aria2_bridge_toast")).toBeVisible();
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);
    const add = (await mock.addUris())[0];
    expect(add.params[0][0]).toBe(`${PAGE}hold.bin`);
  });

  test("默认后缀列表：.bin 不在列表中 → content 不拦截（onCreated 兜底转发）", async ({
    page,
    mock,
  }) => {
    await page.click("#link-bin");

    // content 不拦截 → 无 Toast
    await page.waitForTimeout(600);
    expect(await page.locator("#__aria2_bridge_toast").count()).toBe(0);

    // 浏览器下载被 onCreated 兜底转发到 aria2（挂起下载保证 cancel 成功）
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);
    expect((await mock.addUris())[0]).toBeTruthy();
  });

  test("DEFAULT_DOWNLOAD_EXTS 与 content script 默认列表一致", () => {
    // 防止 product 代码改了默认列表而测试没跟上（一致性守卫）
    expect(DEFAULT_DOWNLOAD_EXTS).toContain(".zip");
    expect(DEFAULT_DOWNLOAD_EXTS).toContain(".pdf");
    expect(DEFAULT_DOWNLOAD_EXTS).toContain(".json");
    expect(DEFAULT_DOWNLOAD_EXTS).not.toContain(".bin");
  });
});
