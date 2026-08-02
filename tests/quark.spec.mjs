// 夸克网盘下载测试：fiber 提取 → 直链接口 → content script 批量推送 aria2
import { test, expect, toastBackground } from "./fixtures.mjs";

const MOCK_PORT = process.env.MOCK_PORT;
const QUARK_PAGE = `http://127.0.0.1:${MOCK_PORT}/quark`;
// 与 plugin/quark.js 一致：mock 环境下 API 指向 /quark-api（同源，无 CORS）
const QUARK_BASE = `http://127.0.0.1:${MOCK_PORT}/quark-api`;
const QUARK_API = `${QUARK_BASE}/file/download?pr=ucpro&fr=pc`;
const QUARK_TOKEN_API = `${QUARK_BASE}/share/sharepage/token?pr=ucpro&fr=pc`;
const QUARK_SHARE_DETAIL_API = `${QUARK_BASE}/share/sharepage/detail`;
const QUARK_SAVE_API = `${QUARK_BASE}/share/sharepage/save?pr=ucpro&fr=pc`;
const QUARK_TASK_API = `${QUARK_BASE}/task?pr=ucpro&fr=pc`;
const QUARK_SORT_API = `${QUARK_BASE}/file/sort?pr=ucpro&fr=pc&uc_param_str=&pdir_fid=`;
const QUARK_CREATE_API = `${QUARK_BASE}/file?pr=ucpro&fr=pc`;

// 打开夸克模拟页面（noselect=1 表示未勾选文件；share=1 走 /s/ 分享页路径）
async function openQuarkPage(page, noselect = false, share = false) {
  const path = share ? `/s/share123` : `/quark`;
  await page.goto(`http://127.0.0.1:${MOCK_PORT}${path}${noselect ? "?noselect=1" : ""}`, {
    waitUntil: "load",
  });
  // 等 quark.js 加载 + fiber 构造完成（fiber 在页面脚本里设置）
  await page.waitForFunction(() => typeof window.getSelectedQuarkFiles === "function", null, {
    timeout: 5000,
  });
  await page.waitForTimeout(300);
}

// mock 接口：默认由 mock-server 的 /quark-api 路由提供（同源无 CORS）。
// 错误场景用 page.route 覆盖 /quark-api/file/download 返回指定错误。
// mode: 'ok'(默认) | 'error'(业务错误码) | 'http500' | 'network' | 'empty'
async function mockQuarkApi(page, { mode = "ok", failCode = null } = {}) {
  if (mode === "ok" && failCode === null) return; // 走 mock-server 默认
  await page.route(`${QUARK_API}*`, (route) => {
    if (mode === "network") {
      route.abort("failed");
      return;
    }
    if (mode === "http500") {
      route.fulfill({ status: 500, contentType: "text/html", body: "<html>500</html>" });
      return;
    }
    if (failCode !== null) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: failCode, message: "mock error" }),
      });
      return;
    }
    // empty
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, data: [] }),
    });
  });
}
// 覆盖 token 接口返回失败（走 mock-server 默认时返回成功 stoken）
async function mockQuarkToken(page, { failCode = null } = {}) {
  if (failCode === null) return; // 默认成功，走 mock-server
  await page.route(`${QUARK_TOKEN_API}*`, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: failCode, message: "token error" }),
    });
  });
}

// 覆盖 sort 接口让转存后无新文件（第二次查 folder-share 仍为空）
async function mockShareTransfer(page, { empty = false } = {}) {
  if (!empty) return;
  await page.route(`${QUARK_SORT_API}*`, (route) => {
    const pdir = new URL(route.request().url()).searchParams.get("pdir_fid");
    if (pdir === "folder-share") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: { list: [] }, metadata: { _total: 0 } }),
      });
    } else {
      route.continue();
    }
  });
}

test.describe("夸克网盘下载", () => {
  test("选中文件 → 提取直链 → 批量推送到 aria2（out 文件名 + referer）", async ({
    page,
    mock,
    setupConfig,
  }) => {
    await setupConfig();
    await mockQuarkApi(page);
    await openQuarkPage(page);

    // 模拟 content script 发指令（真实场景由右键菜单 → tabs.sendMessage 触发）
    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    // 2 个直链都被推送（fid-1/fid-2 被选中）
    await expect.poll(async () => (await mock.addUris()).length).toBe(2);
    const adds = await mock.addUris();

    // out 用 API 返回的 file_name（直链 URL 无后缀，用 out 匹配）
    const report = adds.find((a) => a.params[1]?.out === "report.pdf");
    expect(report).toBeTruthy();
    expect(report.params[1].out).toBe("report.pdf");
    // referer 通过 header 数组传给 aria2（与现有下载链路一致）
    expect(report.params[1].header).toContain(`Referer: ${QUARK_PAGE}`);
    // 直链 URL 原样转发
    expect(report.params[0][0]).toBe("https://mock-cdn.quark.cn/dl/report.pdf?sign=abc");

    const data = adds.find((a) => a.params[0][0].includes("data.zip"));
    expect(data).toBeTruthy();
    expect(data.params[1].out).toBe("data.zip");

    // 绿色 Toast（成功）
    await expect.poll(() => toastBackground(page)).toContain("232, 245, 233");
  });

  test("未勾选文件 → 橙色 Toast 提示，不推送", async ({ page, mock, setupConfig }) => {
    await setupConfig();
    await mockQuarkApi(page);
    await openQuarkPage(page, true); // noselect

    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    // 橙色 Toast（未选中警告）
    await expect.poll(() => toastBackground(page)).toContain("255, 243, 224");
    // 无任何 addUri 请求
    await page.waitForTimeout(500);
    expect((await mock.addUris()).length).toBe(0);
  });

  test("直链接口返回错误 → 橙色 Toast，不推送", async ({ page, mock, setupConfig }) => {
    await setupConfig();
    await mockQuarkApi(page, { failCode: 31001 }); // 未登录错误码
    await openQuarkPage(page);

    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    await expect.poll(() => toastBackground(page)).toContain("255, 243, 224");
    await page.waitForTimeout(500);
    expect((await mock.addUris()).length).toBe(0);
  });

  test("网络层失败（fetch reject）→ 橙色 Toast，不推送", async ({ page, mock, setupConfig }) => {
    await setupConfig();
    await mockQuarkApi(page, { mode: "network" }); // 断网/连接被拒
    await openQuarkPage(page);

    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    await expect.poll(() => toastBackground(page)).toContain("255, 243, 224");
    await page.waitForTimeout(500);
    expect((await mock.addUris()).length).toBe(0);
  });

  test("HTTP 500（非 JSON 响应体）→ 橙色 Toast，不推送", async ({ page, mock, setupConfig }) => {
    await setupConfig();
    await mockQuarkApi(page, { mode: "http500" });
    await openQuarkPage(page);

    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    await expect.poll(() => toastBackground(page)).toContain("255, 243, 224");
    await page.waitForTimeout(500);
    expect((await mock.addUris()).length).toBe(0);
  });

  test("接口返回空 data → 橙色 Toast，不推送", async ({ page, mock, setupConfig }) => {
    await setupConfig();
    await mockQuarkApi(page, { mode: "empty" });
    await openQuarkPage(page);

    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    await expect.poll(() => toastBackground(page)).toContain("255, 243, 224");
    await page.waitForTimeout(500);
    expect((await mock.addUris()).length).toBe(0);
  });

  test("DNR 规则已注册：夸克 PC 客户端 API 改写为夸克客户端 UA", async ({ sw }) => {
    // 夸克客户端 API 校验 UA（非客户端 UA → 404），fetch 无法设置 UA，
    // 必须靠 declarativeNetRequest 在网络层改写 —— 验证规则已注册
    const rules = await sw.evaluate(async () => {
      return chrome.declarativeNetRequest.getDynamicRules();
    });
    const rule = rules.find((r) => r.id === 1001);
    expect(rule).toBeTruthy();
    expect(rule.action.type).toBe("modifyHeaders");
    const uaHeader = rule.action.requestHeaders.find((h) => h.header === "user-agent");
    expect(uaHeader).toBeTruthy();
    expect(uaHeader.operation).toBe("set");
    expect(uaHeader.value).toContain("quark-cloud-drive");
    expect(rule.condition.urlFilter).toContain("drive-pc.quark.cn");
    expect(rule.condition.resourceTypes).toContain("xmlhttprequest");
  });

  test("分享页（/s/xxx）→ 下载当前目录全部文件 → 推送到 aria2", async ({
    page,
    mock,
    setupConfig,
  }) => {
    await setupConfig();
    await mockQuarkToken(page);
    await mockQuarkApi(page);
    await openQuarkPage(page, false, true); // 分享页路径 /s/share123

    // 分享页不依赖勾选：直接下载当前目录全部文件
    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    // 分享页走 API 链路：token → detail(当前目录) → download → 推送到 aria2
    await expect.poll(async () => (await mock.addUris()).length).toBe(2);
    const adds = await mock.addUris();
    expect(adds[0].params[0][0]).toContain("mock-cdn.quark.cn");
    // 当前目录文件（fid-1 → report.pdf, fid-2 → data.zip）作为 out
    const outs = adds.map((a) => a.params[1]?.out);
    expect(outs).toContain("report.pdf");
    expect(outs).toContain("data.zip");

    // 绿色 Toast（成功）
    await expect.poll(() => toastBackground(page)).toContain("232, 245, 233");
  });

  test("分享页 token 获取失败 → 橙色 Toast，不推送", async ({ page, mock, setupConfig }) => {
    await setupConfig();
    await mockQuarkToken(page, { failCode: 31001 }); // 未登录/提取码错误
    await mockQuarkApi(page);
    await openQuarkPage(page, false, true);

    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    await expect.poll(() => toastBackground(page)).toContain("255, 243, 224");
    await page.waitForTimeout(500);
    expect((await mock.addUris()).length).toBe(0);
  });

  test("分享页当前目录无文件 → 橙色 Toast，不推送", async ({ page, mock, setupConfig }) => {
    await setupConfig();
    await mockQuarkToken(page);
    // detail 返回空列表（当前目录只有文件夹或为空）
    await page.route(`${QUARK_SHARE_DETAIL_API}*`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: { list: [] }, metadata: { _total: 0 } }),
      });
    });
    await mockQuarkApi(page);
    await openQuarkPage(page, false, true);

    await page.evaluate(() => window.postMessage({ type: "FETCH_QUARK_LINKS" }, "*"));

    await expect.poll(() => toastBackground(page)).toContain("255, 243, 224");
    await page.waitForTimeout(500);
    expect((await mock.addUris()).length).toBe(0);
  });
});
