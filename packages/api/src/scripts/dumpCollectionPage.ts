/**
 * Dump toàn bộ link Shopee kèm text trên trang bộ sưu tập YouTube.
 * Dùng để chẩn đoán vì sao bước khớp tên sản phẩm thất bại.
 *
 * Chạy: npx ts-node src/scripts/dumpCollectionPage.ts "<url bộ sưu tập>"
 */
import { chromium } from 'playwright';

const URL_ARG = process.argv[2];

async function main() {
  if (!URL_ARG) {
    console.error('Cần truyền URL bộ sưu tập');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`Mở: ${URL_ARG}\n`);
    await page.goto(URL_ARG, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);

    const count = async () =>
      (await page.$$eval('a[href]', (els) =>
        els.filter((e) => /shopee\.vn|shp\.ee/.test((e as unknown as { href: string }).href)).length,
      ));

    console.log(`Trước khi cuộn: ${await count()} link Shopee`);

    // Trang này lazy-load: phải cuộn tới cuối nhiều lần cho tới khi số link
    // không tăng nữa. Thử nhiều cách vì trang có thể cuộn ở container riêng
    // chứ không phải body.
    let previous = -1;
    for (let round = 0; round < 25 && previous !== (await count()); round++) {
      previous = await count();

      await page.keyboard.press('End');
      await page.evaluate(`(() => {
        const root = document.scrollingElement || document.documentElement;
        root.scrollTop = root.scrollHeight;
        document.querySelectorAll('*').forEach((e) => {
          if (e.scrollHeight > e.clientHeight + 100) e.scrollTop = e.scrollHeight;
        });
      })()`);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(1500);
      console.log(`  vòng ${round + 1}: ${await count()} link`);
    }
    await page.waitForTimeout(2000);
    console.log(`\nSau khi cuộn:   ${await count()} link Shopee\n`);

    const links = await page.$$eval('a[href]', (els) =>
      els
        .map((el) => {
          const e = el as unknown as { href: string; innerText?: string };
          return {
            href: e.href,
            text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 130),
          };
        })
        .filter((l) => /shopee\.vn|shp\.ee/.test(l.href)),
    );

    console.log(`Chi tiết ${links.length} link:`);
    links.forEach((l, i) => {
      console.log(`\n[${i + 1}] text = "${l.text}"`);
      console.log(`    href = ${l.href.slice(0, 90)}...`);
    });
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exitCode = 1;
});
