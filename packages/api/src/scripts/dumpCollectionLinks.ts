/**
 * Liệt kê mọi link Shopee trên một trang bộ sưu tập, kèm ID sản phẩm bóc được.
 *
 * Dùng để trả lời một câu hỏi cụ thể: link affiliate YouTube sinh ra CÓ mang
 * theo ID sản phẩm gốc hay không. Đó là điều kiện để so khớp theo ID (chính xác
 * tuyệt đối) thay vì so mờ theo tên đọc bằng OCR.
 *
 *   npx ts-node src/scripts/dumpCollectionLinks.ts "<link bộ sưu tập>"
 */
import { chromium } from 'playwright';
import { extractOriginRef, formatRef } from '../automation/shopeeLink';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Thiếu tham số: đường dẫn trang bộ sưu tập');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) =>
      ['image', 'media', 'font'].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );

    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('a[href*="shopee"], a[href*="shp.ee"]', { timeout: 30000 });
    console.log(`Tải trang + thấy link Shopee: ${Date.now() - t0}ms\n`);

    const links = await page.$$eval('a[href]', (els) =>
      els.map((el) => ({
        href: (el as { href: string }).href,
        text: ((el as { innerText?: string }).innerText || '').trim().slice(0, 80),
      })),
    );

    const shopee = links.filter((l) => /shopee\.vn|shp\.ee/.test(l.href));
    console.log(`Tìm thấy ${shopee.length} link Shopee:\n`);

    for (const [i, l] of shopee.entries()) {
      const ref = extractOriginRef(l.href);
      console.log(`[${i + 1}] ${l.text || '(không có chữ)'}`);
      console.log(`    ID bóc được: ${ref ? formatRef(ref) : '❌ KHÔNG bóc được'}`);
      console.log(`    href: ${l.href.slice(0, 220)}`);
      console.log('');
    }

    const withId = shopee.filter((l) => extractOriginRef(l.href) !== null).length;
    console.log(`── Kết luận: ${withId}/${shopee.length} link mang ID sản phẩm bóc được ──`);
  } finally {
    await browser.close();
  }
}

main().then(() => process.exit(0));
