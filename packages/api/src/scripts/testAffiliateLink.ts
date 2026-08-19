/**
 * Chẩn đoán link affiliate: mở link và ghi lại toàn bộ chuỗi chuyển hướng,
 * thử cả user-agent máy tính lẫn điện thoại để xem link có kén thiết bị không.
 *
 * Chạy: npx ts-node src/scripts/testAffiliateLink.ts "<url>"
 */
import { chromium, devices } from 'playwright';

const URL_ARG = process.argv[2];

async function probe(url: string, label: string, mobile: boolean) {
  console.log(`\n───────── ${label} ─────────`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    mobile ? { ...devices['Pixel 7'] } : {},
  );
  const page = await context.newPage();

  const chain: string[] = [];
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 300 && status < 400) {
      chain.push(`  ${status} → ${res.headers()['location'] ?? '(không có Location)'}`);
    }
  });

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    console.log(`  HTTP status cuối: ${response?.status()}`);
    if (chain.length > 0) {
      console.log('  Chuỗi chuyển hướng:');
      chain.forEach((c) => console.log(c));
    }
    console.log(`  URL cuối cùng: ${page.url()}`);
    const title = await page.title().catch(() => '');
    console.log(`  Tiêu đề trang: "${title}"`);

    const bodyText = (await page.innerText('body').catch(() => '')).slice(0, 300);
    console.log(`  Nội dung: ${bodyText.replace(/\s+/g, ' ').trim()}`);

    const isError =
      page.url().includes('error_page') || /cannot be found|Oops/i.test(bodyText);
    console.log(`  → ${isError ? '❌ TRANG LỖI' : '✅ Trang hợp lệ'}`);
  } catch (err: unknown) {
    console.log(`  ❌ Lỗi: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!URL_ARG) {
    console.error('Cần truyền URL. Ví dụ: npx ts-node src/scripts/testAffiliateLink.ts "https://..."');
    process.exit(1);
  }

  console.log('🔍 Chẩn đoán link affiliate');
  console.log(`URL: ${URL_ARG.slice(0, 120)}...`);

  // Tách origin_link để đối chiếu: đây là URL sản phẩm gốc nằm bên trong link affiliate
  try {
    const parsed = new URL(URL_ARG);
    const origin = parsed.searchParams.get('origin_link');
    if (origin) {
      console.log(`\n📦 origin_link bên trong: ${origin.slice(0, 150)}`);
    }
  } catch {
    // bỏ qua nếu không phải URL hợp lệ
  }

  await probe(URL_ARG, 'User-agent MÁY TÍNH', false);
  await probe(URL_ARG, 'User-agent ĐIỆN THOẠI', true);
}

main();
