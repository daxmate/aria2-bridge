// downloads.onCreated 兜底测试：JS 触发下载 → 取消浏览器下载并转发 aria2
// 去重窗口、已删除任务防复活（本地记忆 + aria2 实时查询）
import { test, expect, gotoTestPage, TEST_PAGE } from "./fixtures.mjs";

const PAGE = TEST_PAGE;
const HOLD_URL = `${PAGE}hold.bin`;

test.describe("onCreated 兜底拦截", () => {
  test.beforeEach(async ({ page, setupConfig }) => {
    await setupConfig();
    await gotoTestPage(page);
  });

  test("JS 触发浏览器下载 → 取消浏览器下载并转发 aria2", async ({ page, mock }) => {
    // .bin 不在默认拦截列表 → content script 不拦 → 浏览器下载 → onCreated 兜底
    await page.click("#link-bin");

    // 转发成功即证明链路走通：cancel 失败会直接 return（不转发），
    // 因此 addUri 收到请求 = cancel + erase + 转发全部成功
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);
    const add = (await mock.addUris())[0];
    expect(add.params[0][0]).toBe(HOLD_URL);
  });

  test("同一 URL 30s 窗口内不重复转发（去重）→ 浏览器下载保留", async ({ page, mock, sw }) => {
    await page.click("#link-bin");
    // 等第一次转发完成
    await expect.poll(async () => (await mock.addUris()).length).toBeGreaterThanOrEqual(1);

    await page.click("#link-bin"); // 再次触发同一 URL

    // 等待可能的第二次转发（去重应将其拦截）
    await page.waitForTimeout(1200);
    expect((await mock.addUris()).length).toBe(1);

    // 结构性修复：去重命中时不再取消浏览器下载（第一次已取消+清除，第二次保持进行中）
    const inProgress = await sw.evaluate(
      async () =>
        (await chrome.downloads.search({})).filter((i) => i.state === "in_progress").length
    );
    expect(inProgress).toBe(1);
  });

  test("用户已删除的任务 → 不自动重新添加（本地记忆）", async ({ page, mock, sw }) => {
    // 预置：该 URL 已被用户删除过（markRemoved 是 background 内部函数）
    await sw.evaluate((url) => markRemoved(url), HOLD_URL);

    await page.click("#link-bin");
    await page.waitForTimeout(1200);

    expect((await mock.addUris()).length).toBe(0);

    // 结构性修复：黑名单命中时不再取消浏览器下载，保持原生下载
    const inProgress = await sw.evaluate(
      async () =>
        (await chrome.downloads.search({})).filter((i) => i.state === "in_progress").length
    );
    expect(inProgress).toBe(1);
  });

  test("aria2 中状态为 removed 的任务 → 实时查询拦截，不重加", async ({ page, mock }) => {
    // mock tellStopped 返回该 URL 的 removed 任务（模拟用户在 AriaNg 里删过）
    await mock.config({
      stopped: [
        {
          status: "removed",
          files: [{ uris: [{ uri: HOLD_URL }] }],
        },
      ],
    });

    await page.click("#link-bin");
    await page.waitForTimeout(1500);

    expect((await mock.addUris()).length).toBe(0);

    // 确实查询过 tellStopped（实时检查生效的证据）
    const { requests } = await mock.requests();
    const toldStopped = requests.filter((r) => r.method === "aria2.tellStopped");
    expect(toldStopped.length).toBeGreaterThanOrEqual(1);
  });

  test("aria2 队列已有同 URL 任务 → 跳过转发（isAlreadyInQueue 查重）", async ({
    page,
    mock,
    sw,
  }) => {
    // 模拟 aria2 队列里已有该 URL 的任务（active 中）
    await mock.config({
      active: [{ files: [{ uris: [{ uri: HOLD_URL }] }] }],
      waiting: [],
    });

    await page.click("#link-bin");
    await page.waitForTimeout(1500);

    // 查重命中 → 不产生新的 addUri
    expect((await mock.addUris()).length).toBe(0);

    // 确实查询过队列（tellActive/tellWaiting 被调用 = 查重逻辑生效的证据）
    const { requests } = await mock.requests();
    const queueChecks = requests.filter(
      (r) => r.method === "aria2.tellActive" || r.method === "aria2.tellWaiting"
    );
    expect(queueChecks.length).toBeGreaterThanOrEqual(1);

    // 结构性修复：队列查重命中时不再取消浏览器下载
    const inProgress = await sw.evaluate(
      async () =>
        (await chrome.downloads.search({})).filter((i) => i.state === "in_progress").length
    );
    expect(inProgress).toBe(1);
  });

  test("URL 带一次性签名 token（JWT 形状）→ 不拦截，浏览器原生下载", async ({ page, mock, sw }) => {
    // spa-download 无后缀 + Content-Disposition → 走 onCreated 兜底；
    // 带 ?t=eyJ...（JWT 形状一次性 token）→ 跳过转发，浏览器下载保持进行中
    await page.evaluate((href) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = "test.pdf";
      document.body.appendChild(a);
      a.click();
    }, `${PAGE}spa-download?t=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sig1.sig2`);

    await page.waitForTimeout(1200);

    // 不转发 aria2
    expect((await mock.addUris()).length).toBe(0);
    // 浏览器下载保持进行中（未被取消）
    const inProgress = await sw.evaluate(
      async () =>
        (await chrome.downloads.search({})).filter((i) => i.state === "in_progress").length
    );
    expect(inProgress).toBe(1);
  });

  test("URL 带 OSS 签名直链参数 → 不拦截，浏览器原生下载", async ({ page, mock, sw }) => {
    // 阿里云 OSS 签名直链特征：OSSAccessKeyId + Signature（如 jiaoyanyun 的
    // pdf-cdn.speiyou.com 直链）→ 跳过转发，浏览器下载保持进行中
    await page.evaluate((href) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = "test.pdf";
      document.body.appendChild(a);
      a.click();
    }, `${PAGE}spa-download?OSSAccessKeyId=testkey&Signature=abcd%3D&Expires=9999999999`);

    await page.waitForTimeout(1200);

    // 不转发 aria2
    expect((await mock.addUris()).length).toBe(0);
    // 浏览器下载保持进行中（未被取消）
    const inProgress = await sw.evaluate(
      async () =>
        (await chrome.downloads.search({})).filter((i) => i.state === "in_progress").length
    );
    expect(inProgress).toBe(1);
  });

  test("URL 域名命中内置签名站点列表（jiaoyanyun）→ 不拦截，浏览器原生下载", async ({
    page,
    mock,
    sw,
  }) => {
    // jiaoyanyun 的下载 URL 形态多样（不一定带 OSSAccessKeyId/Signature 参数），
    // 但域名命中内置列表 → 一律放行浏览器原生下载（2026-08-07：实测仅带
    // 参数检测会漏，浏览器下载被取消转发 aria2，用户误判失败重复点击浪费次数）
    const jyUrl = "https://xbresource.jiaoyanyun.com/exam-paper/pdf/noWaterMark/test_1.pdf";
    // 拦截真实网络请求：返回 attachment 响应强制浏览器下载
    // （跨源 <a download> 无 attachment 头会被浏览器当导航处理，不会产生下载项）
    await page.route("https://xbresource.jiaoyanyun.com/**", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="test.pdf"',
        },
        body: Buffer.from("%PDF-1.4 test"),
      })
    );
    await page.evaluate((href) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = "test.pdf";
      a.id = "jy-dl";
      a.textContent = "jy download";
      document.body.appendChild(a);
    }, jyUrl);
    await page.click("#jy-dl");

    await page.waitForTimeout(1200);

    // 不转发 aria2
    expect((await mock.addUris()).length).toBe(0);
    // 浏览器确实发起了下载（未被拦截 cancel 吞掉；可能已完成或进行中）
    const dl = await sw.evaluate(async () => (await chrome.downloads.search({})).length);
    expect(dl).toBeGreaterThanOrEqual(1);
  });

  test("hasSignedUrlToken：Referrer 命中内置站点列表（jiaoyanyun 页面下载第三方 CDN 文件）", async ({
    sw,
  }) => {
    // 下载 URL 是普通 CDN（无签名参数），但页面（referrer）在 jiaoyanyun 域名下
    const result = await sw.evaluate(() =>
      hasSignedUrlToken(
        "https://cdn.example.com/files/paper.pdf",
        "https://xbresource.jiaoyanyun.com/#/exampaperDetail?id=abc"
      )
    );
    expect(result).toBe(true);
    // 对照：无签名参数且非内置站点的 URL → 不命中
    const negative = await sw.evaluate(() =>
      hasSignedUrlToken("https://cdn.example.com/files/paper.pdf", "https://example.com/page")
    );
    expect(negative).toBe(false);
  });

  test("cleanupStaleDownloads：清理 USER_CANCELED/USER_SHUTDOWN 残留，保留其他中断", async ({
    sw,
  }) => {
    // 在 SW 环境里临时替换 chrome.downloads（每个测试独立 context，不影响其他用例）
    const erased = await sw.evaluate(async () => {
      self.__erased = [];
      const realSearch = chrome.downloads.search;
      const realErase = chrome.downloads.erase;
      chrome.downloads.search = async () => [
        { id: 1, interruptReason: "USER_CANCELED" },
        { id: 2, interruptReason: "USER_SHUTDOWN" },
        { id: 3, interruptReason: "FILE_FAILED" }, // 其他原因中断：不应被清理
      ];
      chrome.downloads.erase = async (id) => {
        self.__erased.push(id);
      };
      await cleanupStaleDownloads();
      chrome.downloads.search = realSearch;
      chrome.downloads.erase = realErase;
      return self.__erased;
    });

    expect(erased).toEqual([1, 2]);
  });
});
