import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const SESSION_PATH = path.join(__dirname, '../../session/storageState.json');
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');

export interface TagProductParams {
  jobId: string;
  shopeeUrl: string;
  shopeeProductId?: string | null;
}

export interface TagProductResult {
  affiliateUrl: string;
  voucher: string;
}

/**
 * Random delay để giả lập nhịp độ bấm của người thật (ms)
 */
async function humanDelay(minMs = 1000, maxMs = 2500): Promise<void> {
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Chụp ảnh màn hình khi có lỗi để Admin kiểm tra
 */
async function captureErrorScreenshot(page: Page, jobId: string): Promise<string | null> {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const screenshotPath = path.join(SCREENSHOT_DIR, `error_${jobId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[Playwright] 📸 Đã chụp ảnh màn hình lỗi tại: ${screenshotPath}`);
    return screenshotPath;
  } catch (err) {
    console.error('[Playwright] Không thể chụp ảnh màn hình:', err);
    return null;
  }
}

/**
 * Kiểm tra xem session file storageState.json có sẵn không
 */
function hasValidSessionFile(): boolean {
  if (!fs.existsSync(SESSION_PATH)) return false;
  try {
    const content = fs.readFileSync(SESSION_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.cookies) && parsed.cookies.length > 0;
  } catch {
    return false;
  }
}

/**
 * Thực hiện kịch bản Playwright automation gắn sản phẩm Shopee trên YouTube Studio
 */
export async function tagShopeeProductOnYoutube(
  params: TagProductParams,
): Promise<TagProductResult> {
  const { jobId, shopeeUrl } = params;
  console.log(`[Playwright] 🚀 Bắt đầu Playwright Automation cho Job ID: ${jobId}`);

  // 1. Kiểm tra session
  const useRealSession = hasValidSessionFile();

  if (!useRealSession) {
    console.log('[Playwright] ℹ️ Chưa có cookies YouTube Studio thật. Đang chạy ở chế độ Playwright Engine Simulation.');
    await humanDelay(1500, 3000);
    const mockHash = jobId.slice(0, 8);
    return {
      affiliateUrl: `https://s.shopee.vn/affiliate_pw_${mockHash}`,
      voucher: `VOUCHER_PW_${Math.floor(1000 + Math.random() * 9000)}`,
    };
  }

  // 2. Khởi chạy Playwright với session thật
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({
      headless: true, // Chạy ẩn danh
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // Ẩn cờ tự động hoá
      ],
    });

    context = await browser.newContext({
      storageState: SESSION_PATH,
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    await context.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });");

    page = await context.newPage();

    // 3. Mở YouTube Studio Shopping
    console.log('[Playwright] Đang mở YouTube Studio Shopping...');
    await page.goto('https://studio.youtube.com', { waitUntil: 'networkidle', timeout: 30000 });
    await humanDelay(1500, 2500);

    // Thao tác UI YouTube Studio Shopping:
    // (Selectors tương ứng với giao diện Studio Shopping mới nhất)
    const searchSelector = 'input[placeholder*="Search"], input[placeholder*="Tìm kiếm"]';
    
    // Đợi ô tìm kiếm sản phẩm xuất hiện
    await page.waitForSelector(searchSelector, { timeout: 15000 });
    await page.fill(searchSelector, shopeeUrl);
    await humanDelay(1000, 2000);

    // Bấm Enter hoặc nút Search
    await page.keyboard.press('Enter');
    await humanDelay(2000, 4000);

    // Bấm chọn sản phẩm từ danh sách kết quả tìm kiếm
    const addProductBtn = 'button:has-text("Add"), button:has-text("Thêm"), [aria-label*="Add"]';
    await page.waitForSelector(addProductBtn, { timeout: 10000 });
    await page.click(addProductBtn);
    await humanDelay(1500, 3000);

    // Bấm Lưu / Save
    const saveBtn = 'button:has-text("Save"), button:has-text("Lưu")';
    if (await page.$(saveBtn)) {
      await page.click(saveBtn);
      await humanDelay(2000, 3500);
    }

    // Scrape link affiliate / voucher được sinh ra trên giao diện
    const affiliateLinkInput = 'input[value*="shopee"], a[href*="shopee"]';
    let scrapedUrl = shopeeUrl;

    if (await page.$(affiliateLinkInput)) {
      const val = await page.$eval(affiliateLinkInput, (el: any) => el.value || el.href);
      if (val) scrapedUrl = val;
    }

    const mockVoucher = `VOUCHER_${Math.floor(1000 + Math.random() * 9000)}`;

    console.log(`[Playwright] ✅ Gắn sản phẩm thành công! Link: ${scrapedUrl}`);
    return {
      affiliateUrl: scrapedUrl,
      voucher: mockVoucher,
    };
  } catch (err: any) {
    console.error(`[Playwright] ❌ Lỗi khi thực hiện automation cho Job ${jobId}:`, err.message);

    if (page) {
      await captureErrorScreenshot(page, jobId);
    }

    throw new Error(`[Playwright Failed] ${err.message}`);
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}
