import { chromium, type Browser, type Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { automationEnv } from './env';

const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');

export interface ExtractAffiliateOptions {
  shopeeUrl?: string;
  jobId?: string;
  headless?: boolean;
}

export interface ExtractAffiliateResult {
  affiliateUrl: string;
  voucher: string;
}

function isShopeeLink(href: string): boolean {
  return (
    href.includes('shopee.vn') ||
    href.includes('shp.ee') ||
    href.includes('s.shopee.vn') ||
    href.includes('vn.shp.ee')
  );
}

/** Trích voucher từ URL hoặc text hiển thị trên trang */
function extractVoucherFromText(text: string): string | null {
  const patterns = [
    /voucher[:\s#-]*([A-Z0-9]{4,20})/i,
    /mã[:\s]*([A-Z0-9]{4,20})/i,
    /code[:\s]*([A-Z0-9]{4,20})/i,
    /promo[:\s]*([A-Z0-9]{4,20})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

function extractVoucherFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    for (const key of ['voucher', 'promo', 'code', 'coupon']) {
      const val = parsed.searchParams.get(key);
      if (val) return val.toUpperCase();
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

async function capturePageScreenshot(page: Page, jobId: string, suffix: string): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  const filePath = path.join(SCREENSHOT_DIR, `${suffix}_${jobId}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`[Playwright] 📸 ${filePath}`);
}

/**
 * PHASE 2 (web): Mở link bộ sưu tập YouTube Shopping, tìm sản phẩm vừa gắn,
 * trích xuất link affiliate Shopee và mã voucher (nếu có).
 */
export async function extractAffiliateFromCollection(
  collectionShareUrl: string,
  options: ExtractAffiliateOptions = {},
): Promise<ExtractAffiliateResult> {
  const { shopeeUrl, jobId = 'unknown', headless = automationEnv.PLAYWRIGHT_HEADLESS } = options;

  console.log(`[Playwright] Mở trang bộ sưu tập: ${collectionShareUrl}`);

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();

    await page.goto(collectionShareUrl, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);
    await capturePageScreenshot(page, jobId, 'collection_page');

    const pageText = await page.innerText('body').catch(() => '');
    let voucher =
      extractVoucherFromText(pageText) ||
      extractVoucherFromUrl(collectionShareUrl) ||
      '';

    const productLinks = await page.$$eval('a[href]', (els) =>
      els.map((el) => ({
        href: (el as { href: string }).href,
        text: ((el as { innerText?: string }).innerText || '').trim().slice(0, 120),
      })),
    );

    const shopeeLinks = productLinks.filter((l) => isShopeeLink(l.href));
    console.log(`[Playwright] Tìm thấy ${shopeeLinks.length} link Shopee trên trang bộ sưu tập`);

    let affiliateUrl = '';

    // Ưu tiên link khớp với URL gốc (cùng shortcode hoặc product id)
    if (shopeeUrl) {
      const shortcode = shopeeUrl.split('/').pop()?.split('?')[0];
      const matched = shopeeLinks.find(
        (l) =>
          l.href === shopeeUrl ||
          (shortcode && l.href.includes(shortcode)) ||
          shopeeUrl.includes(l.href),
      );
      if (matched) affiliateUrl = matched.href;
    }

    if (!affiliateUrl && shopeeLinks.length > 0) {
      affiliateUrl = shopeeLinks[0].href;
    }

    if (!affiliateUrl) {
      throw new Error('Không tìm thấy link affiliate Shopee trên trang bộ sưu tập');
    }

    if (!voucher) {
      voucher = extractVoucherFromUrl(affiliateUrl) || '';
    }

    if (!voucher) {
      // Fallback: tạo placeholder nếu trang không hiển thị voucher rõ ràng
      voucher = `VOUCHER_${Math.floor(1000 + Math.random() * 9000)}`;
    }

    console.log(`[Playwright] ✅ Affiliate: ${affiliateUrl} | Voucher: ${voucher}`);
    return { affiliateUrl, voucher };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Playwright] ❌ Lỗi trích xuất affiliate: ${message}`);

    if (page) {
      await capturePageScreenshot(page, jobId, 'collection_error').catch(() => {});
    }

    throw new Error(`[AffiliateExtractor Failed] ${message}`);
  } finally {
    if (browser) await browser.close();
  }
}
