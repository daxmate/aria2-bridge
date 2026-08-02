// AriaNg 管理面板测试：buildAriaNgUrl（secret → hash 路由）、页面渲染、fix 脚本生效
import { test, expect } from "./fixtures.mjs";

test.describe("AriaNg 管理面板", () => {
  test("无 secret → buildAriaNgUrl 返回基础页面地址", async ({ sw, setupConfig }) => {
    await setupConfig({ rpcSecret: "" });
    const url = await sw.evaluate(() => buildAriaNgUrl());
    expect(url).toMatch(/chrome-extension:\/\/[^/]+\/aria-ng\/index\.html$/);
    expect(url).not.toContain("#!/settings/rpc/set");
  });

  test("有 secret → hash 路由携带 RPC 参数（URL-safe base64 无 padding）", async ({
    sw,
    setupConfig,
  }) => {
    await setupConfig({
      rpcUrl: "http://localhost:6800/jsonrpc",
      rpcSecret: "MySecret",
    });
    const url = await sw.evaluate(() => buildAriaNgUrl());

    // MySecret → base64 "TXlTZWNyZXQ=" → URL-safe 去 padding "TXlTZWNyZXQ"
    expect(url).toContain("#!/settings/rpc/set/http/localhost/6800/jsonrpc/TXlTZWNyZXQ");
  });

  test("带特殊字符 secret → base64url 转义（+/ 替换、去 =）", async ({ sw, setupConfig }) => {
    await setupConfig({ rpcSecret: "a+b/c==" });
    const url = await sw.evaluate(() => buildAriaNgUrl());

    // a+b/c== → base64 "YStiL2M9PQ==" → URL-safe "YStiL2M9PQ"
    expect(url).toContain("#!/settings/rpc/set/");
    expect(url).toContain("YStiL2M9PQ");
    // 不应有裸 +、/、= 残留
    const decoded = decodeURIComponent(url);
    expect(decoded).not.toContain("+");
    expect(decoded).not.toMatch(/YStiL2M9PQ[^/]*=/);
  });

  test("AriaNg 页面可打开并正常渲染（aria-ng-fix.js 生效）", async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/aria-ng/index.html`, {
      waitUntil: "domcontentloaded",
    });

    // AngularJS 渲染出 AriaNg 界面（logo + 侧边栏菜单）
    await expect(page.locator(".logo-lg-title")).toHaveText("AriaNg", { timeout: 20000 });
    await expect(page.locator('a[href^="#!/downloading"]')).toBeVisible();

    // aria-ng-fix.js：ng-href 不应被 $sce 标记为 unsafe:
    const unsafeLinks = await page.evaluate(
      () => document.querySelectorAll('a[href^="unsafe:"], link[href^="unsafe:"]').length
    );
    expect(unsafeLinks).toBe(0);
  });
});
