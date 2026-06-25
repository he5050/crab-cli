/**
 * 浏览器生命周期管理 — 延迟启动 Puppeteer，管理 Page 池，自动清理。
 *
 * 职责:
 *   - 延迟启动 Puppeteer
 *   - 管理 Page 池
 *   - 自动检测浏览器路径
 *   - 空闲超时自动清理
 *   - 支持 WSL 环境
 *
 * 模块功能:
 *   - BrowserManager: 浏览器管理器单例
 *   - newPage: 创建新页面
 *   - isAvailable: 检查可用性
 *   - 自动浏览器路径检测
 *   - Page 池管理
 *
 * 使用场景:
 *   - 网页搜索
 *   - 网页抓取
 *   - 需要浏览器渲染的场景
 *   - 动态内容获取
 *
 * 边界:
 *   1. Puppeteer 作为可选依赖
 *   2. 加载失败时自动降级
 *   3. 支持 Chrome/Edge/Chromium
 *   4. 支持 WSL 环境
 *   5. 空闲 60 秒自动关闭
 *   6. 最大并发 5 个 Page
 *
 * 流程:
 *   1. 检查 Puppeteer 可用性
 *   2. 检测浏览器路径
 *   3. 延迟启动浏览器
 *   4. 从 Page 池分配或创建
 *   5. 使用完成后回收
 *   6. 空闲超时关闭
 */

import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:os";
import { execSync } from "node:child_process";
import { createLogger } from "@/core/logging/logger";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("tool:websearch:browser");

// ─── 类型定义(Puppeteer lazy 加载)────────────────────────
// Puppeteer 是可选依赖，类型可能不存在，使用 any 作为回退

// @ts-ignore — puppeteer 是可选依赖
type Browser = import("puppeteer").Browser;
// @ts-ignore — puppeteer 是可选依赖
type Page = import("puppeteer").Page;

// ─── 浏览器管理器 ──────────────────────────────────────────

/** BrowserManager */
export class BrowserManager {
  private static instance: BrowserManager | null = null;

  private browser: Browser | null = null;
  private executablePath: string | null = null;
  private puppeteerModule: any = null;
  private _available: boolean | null = null;
  private activePages = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeout = 60_000; // 60 秒无活动则关闭浏览器
  private readonly maxConcurrentPages = 5; // 最大并发 Page 数
  private pageQueue: {
    resolve: (page: Page) => void;
    reject: (error: Error) => void;
  }[] = [];
  /** 启动 Promise 缓存，确保并发调用只启动一个浏览器实例 */
  private browserLaunchPromise: Promise<Browser> | null = null;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Puppeteer 是否可用(已加载成功)。
   * 首次调用时尝试加载 Puppeteer 并缓存结果。
   */
  isAvailable(): boolean {
    if (this._available !== null) {
      return this._available;
    }

    // 同步检测 puppeteer 是否可加载(不实际加载，仅检测)
    try {
      require.resolve("puppeteer");
      this._available = true;
      log.info("Puppeteer 检测到，浏览器搜索模式可用");
    } catch {
      this._available = false;
      log.info("Puppeteer 未安装，将使用 HTTP fetch 搜索模式");
    }

    return this._available;
  }

  /** 异步加载 puppeteer 模块(首次使用时调用) */
  async ensureLoaded(): Promise<boolean> {
    if (this.puppeteerModule) {
      return true;
    }
    if (!this._available) {
      return false;
    }
    try {
      this.puppeteerModule = await import("puppeteer");
      return true;
    } catch {
      this._available = false;
      return false;
    }
  }

  /**
   * 获取或启动浏览器实例。
   * 如果浏览器已关闭或断开则重新启动。
   * 使用 browserLaunchPromise 缓存确保并发调用只启动一个浏览器实例。
   */
  async getBrowser(): Promise<Browser> {
    // 浏览器已就绪，直接返回
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    // 已有启动 Promise 正在执行，复用该 Promise 避免并发启动多个实例
    if (this.browserLaunchPromise) {
      return this.browserLaunchPromise;
    }

    if (!this.puppeteerModule) {
      throw createInternalError("INTERNAL_ERROR", "Puppeteer 不可用");
    }

    const executablePath = this.resolveExecutablePath();

    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-component-extensions-with-background-pages",
      "--disable-file-url",
    ];

    const launchPromise = (async () => {
      try {
        this.browser = await this.puppeteerModule.launch({
          args: launchArgs,
          executablePath: executablePath || undefined,
          headless: true,
          userDataDir: this.getUserDataDir(),
        });

        log.debug("浏览器已启动", {
          payload: { path: executablePath || "bundled chromium" },
        });

        return this.browser!;
      } catch (error) {
        throw createInternalError(
          "INTERNAL_ERROR",
          `浏览器启动失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        this.browserLaunchPromise = null;
      }
    })();

    this.browserLaunchPromise = launchPromise;
    return launchPromise;
  }

  /**
   * 创建新 Page(设置 UA、视口)。
   * 自动追踪活跃 Page 数量用于空闲管理。
   * 支持并发控制:超过最大限制时排队等待。
   */
  async newPage(): Promise<Page> {
    // 并发控制:如果已达到最大并发数，加入队列等待
    if (this.activePages >= this.maxConcurrentPages) {
      log.debug(`Page 并发达到上限 (${this.maxConcurrentPages})，加入等待队列`);
      return new Promise<Page>((resolve, reject) => {
        this.pageQueue.push({ reject, resolve });
      });
    }

    return this.createPageInternal();
  }

  /**
   * 内部创建 Page 的方法。
   */
  private async createPageInternal(): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await page.setViewport({ height: 800, width: 1280 });

    this.activePages++;
    this.cancelIdleTimer();

    // Page 关闭时递减计数，并处理队列
    const originalClose = page.close.bind(page);
    page.close = async () => {
      this.activePages = Math.max(0, this.activePages - 1);

      // 处理等待队列
      this.processQueue();

      if (this.activePages === 0) {
        this.scheduleIdleClose();
      }
      return originalClose();
    };

    return page;
  }

  /**
   * 处理等待队列中的请求。
   */
  private processQueue(): void {
    if (this.pageQueue.length === 0) {
      return;
    }
    if (this.activePages >= this.maxConcurrentPages) {
      return;
    }

    const next = this.pageQueue.shift();
    if (next) {
      this.createPageInternal().then(next.resolve).catch(next.reject);
    }
  }

  /**
   * 关闭浏览器实例。
   */
  async closeBrowser(): Promise<void> {
    this.cancelIdleTimer();
    this.browserLaunchPromise = null;
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // 忽略关闭错误
      }
      this.browser = null;
    }
  }

  /**
   * 获取当前活跃 Page 数量。
   */
  getActivePageCount(): number {
    return this.activePages;
  }

  // ─── 私有方法 ──────────────────────────────────────────

  private resolveExecutablePath(): string | null {
    if (this.executablePath) {
      return this.executablePath;
    }

    // Puppeteer 自带 Chromium 优先
    try {
      if (this.puppeteerModule) {
        const bundled = this.puppeteerModule.executablePath();
        if (bundled && existsSync(bundled)) {
          this.executablePath = bundled;
          return bundled;
        }
      }
    } catch {
      // Bundled chromium 不存在
    }

    // 检测系统浏览器
    const systemBrowser = findBrowserExecutable();
    if (systemBrowser) {
      this.executablePath = systemBrowser;
      return systemBrowser;
    }

    return null;
  }

  private getUserDataDir(): string {
    const suffix = Math.random().toString(36).slice(2, 10);
    return join(tmpdir(), `crab-browser-${process.pid}-${suffix}`);
  }

  private scheduleIdleClose(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.activePages === 0) {
        log.debug("浏览器空闲超时，自动关闭");
        this.closeBrowser().catch(() => {
          /* 浏览器关闭失败不影响主流程 */
        });
      }
    }, this.idleTimeout);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ─── 浏览器检测工具 ────────────────────────────────────────

/**
 * 检测是否运行在 WSL 环境中。
 */
/** isWSL 的实现 */
export function isWSL(): boolean {
  try {
    if (existsSync("/proc/version")) {
      const version = readFileSync("/proc/version", "utf8").toLowerCase();
      return version.includes("microsoft") || version.includes("wsl");
    }
    if (process.env["WSL_DISTRO_NAME"] || process.env["WSL_INTEROP"]) {
      return true;
    }
  } catch {
    // Ignore
  }
  return false;
}

/**
 * 检测系统已安装的 Chrome/Edge/Chromium 路径。
 */
/** findBrowserExecutable 的实现 */
export function findBrowserExecutable(): string | null {
  const os = platform();
  const paths: string[] = [];

  if (os === "win32") {
    paths.push(
      String.raw`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
      String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
      String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
      `${process.env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe`,
    );
  } else if (os === "darwin") {
    paths.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    // Linux
    const binPaths = ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"];
    for (const bin of binPaths) {
      try {
        const p = execSync(`which ${bin}`, { encoding: "utf8" }).trim();
        if (p) {
          return p;
        }
      } catch {
        // Continue
      }
    }
  }

  for (const p of paths) {
    if (p && existsSync(p)) {
      return p;
    }
  }

  return null;
}
