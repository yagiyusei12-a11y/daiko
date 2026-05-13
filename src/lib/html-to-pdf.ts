import puppeteer from "puppeteer-core";
import type { Browser } from "puppeteer-core";

const executablePath = process.env.CHROMIUM_EXECUTABLE?.trim();
const timeoutMs = Math.min(
  Math.max(Number(process.env.DAIKO_PDF_TIMEOUT_MS ?? 120_000), 10_000),
  600_000,
);

let browser: Browser | null = null;
/** 同時 PDF でメモリが跳ねないよう直列化 */
let serialChain: Promise<unknown> = Promise.resolve();

export function isChromiumConfiguredForPdf(): boolean {
  return Boolean(executablePath);
}

async function getBrowser(): Promise<Browser> {
  if (!executablePath) {
    const e = new Error("CHROMIUM_EXECUTABLE が未設定です。");
    (e as NodeJS.ErrnoException).code = "PDF_CHROMIUM_MISSING";
    throw e;
  }
  if (browser?.connected) return browser;
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  return browser;
}

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const p = serialChain.then(fn);
  serialChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

/**
 * 完全な HTML 文書（DOCTYPE 付き）を A4 PDF にレンダリングする。
 * 帳票 HTML 内の @page / @media print を preferCSSPageSize で尊重する。
 */
export async function renderHtmlToPdf(fullHtml: string): Promise<Buffer> {
  if (!executablePath) {
    const e = new Error("CHROMIUM_EXECUTABLE が未設定です。");
    (e as NodeJS.ErrnoException).code = "PDF_CHROMIUM_MISSING";
    throw e;
  }
  return runSerialized(async () => {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      page.setDefaultNavigationTimeout(timeoutMs);
      page.setDefaultTimeout(timeoutMs);
      await page.setContent(fullHtml, { waitUntil: "load", timeout: timeoutMs });
      const buf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(buf);
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}
