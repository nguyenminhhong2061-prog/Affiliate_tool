/**
 * Hồi quy cho bộ trích link affiliate (Phase 3, bản HTTP fetch).
 * **KHÔNG cần điện thoại, KHÔNG đổi dữ liệu** — chỉ đọc trang bộ sưu tập.
 *
 *   npx ts-node src/scripts/checkCollectionExtractor.ts "<link bộ sưu tập>"
 *
 * ── Vì sao script này tồn tại ───────────────────────────────────────────────
 * Ngày 2026-08-19, Phase 3 chuyển từ Playwright sang `fetch` + RegEx. Lớp ký tự
 * của RegEx loại trừ dấu `\`, mà URL trong `ytInitialData` lại chứa `&`,
 * nên MỌI link bị cắt cụt ngay trước `origin_link` — tức mất ID sản phẩm. Hệ
 * quả: không job nào trích được link, tất cả chờ 45 giây rồi báo "sản phẩm
 * không xuất hiện trên trang".
 *
 * Lỗi đó qua được `npm run typecheck` mà không để lại dấu vết, vì nó không phải
 * lỗi kiểu — nó là lỗi *ngữ nghĩa của dữ liệu ngoài*. Chỉ một phép chạy thật
 * trên HTML thật mới thấy. Đó chính là khoảng trống script này lấp.
 *
 * ── Ba ca ───────────────────────────────────────────────────────────────────
 *  1. ĐỌC ĐỦ    — số link đọc được phải > 0 và mỗi link phải giải ra ID
 *  2. DƯƠNG TÍNH — mỗi sản phẩm CÓ trên trang phải trích ra đúng link của nó
 *  3. ÂM TÍNH   — ID không tồn tại phải bị TỪ CHỐI, kể cả khi có tên mồi nhử
 *                 trùng sản phẩm thật (§4.8 / §10.7 — thà lỗi còn hơn sai)
 *
 * Ca 3 tốn ~45 giây vì phải chờ hết deadline — đó là hành vi đúng, không phải treo.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

import { extractAffiliateFromCollection } from '../automation/collectionAffiliateExtractor';
import { extractOriginRef, formatRef, type ShopeeProductRef } from '../automation/shopeeLink';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let failures = 0;

function report(ok: boolean, label: string, detail: string) {
  console.log(`${ok ? '✅' : '❌'} ${label} — ${detail}`);
  if (!ok) failures++;
}

/**
 * Mốc chuẩn lấy TỪ CHÍNH TRANG, không hard-code: dò mọi link Shopee rồi giải ID.
 * Nhờ vậy script không lạc hậu khi bộ sưu tập đổi nội dung.
 */
async function readGroundTruth(url: string): Promise<ShopeeProductRef[]> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'vi,en;q=0.9' } });
  const html = await res.text();

  // Cố ý dò RỘNG hơn bộ trích thật (chỉ cần thấy host + origin_link), để nếu bộ
  // trích thật bỏ sót thì script vẫn có mốc mà đối chiếu.
  const refs: ShopeeProductRef[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/origin_link=([^"'\s<>&\\]+)/g)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    const ref = extractOriginRef(`https://x/?origin_link=${encodeURIComponent(decoded)}`);
    if (ref && !seen.has(formatRef(ref))) {
      seen.add(formatRef(ref));
      refs.push(ref);
    }
  }
  return refs;
}

async function positiveCase(url: string, ref: ShopeeProductRef) {
  const t = Date.now();
  try {
    const out = await extractAffiliateFromCollection(url, { targetRef: ref, jobId: 'check-pos' });
    const back = extractOriginRef(out.affiliateUrl);
    const ok = back !== null && back.sellerId === ref.sellerId && back.productId === ref.productId;
    report(
      ok,
      `DƯƠNG TÍNH ${formatRef(ref)}`,
      `${((Date.now() - t) / 1000).toFixed(1)}s, link trả về giải ngược ra ` +
        `${back ? formatRef(back) : '(không giải được)'}`,
    );
  } catch (e) {
    report(false, `DƯƠNG TÍNH ${formatRef(ref)}`, `ném lỗi: ${(e as Error).message.slice(0, 120)}`);
  }
}

async function negativeCase(url: string, decoyName: string) {
  const t = Date.now();
  try {
    const bad = await extractAffiliateFromCollection(url, {
      targetRef: { sellerId: '9999999999', productId: '8888888888' },
      productName: decoyName, // mồi nhử: tên gần trùng một sản phẩm THẬT trên trang
      jobId: 'check-neg',
    });
    report(false, 'ÂM TÍNH', `lẽ ra phải từ chối, nhưng trả về ${bad.affiliateUrl.slice(0, 70)}`);
  } catch (e) {
    report(
      true,
      'ÂM TÍNH',
      `từ chối đúng sau ${((Date.now() - t) / 1000).toFixed(1)}s: ` +
        `${(e as Error).message.slice(0, 90)}…`,
    );
  }
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Thiếu tham số: đường dẫn trang bộ sưu tập');
    console.error('  npx ts-node src/scripts/checkCollectionExtractor.ts "<link bộ sưu tập>"');
    process.exit(1);
  }

  console.log(`Trang: ${url}\n`);

  const truth = await readGroundTruth(url);
  report(
    truth.length > 0,
    'ĐỌC ĐỦ',
    truth.length > 0
      ? `${truth.length} sản phẩm trên trang: ${truth.map(formatRef).join(', ')}`
      : 'KHÔNG đọc được sản phẩm nào — trang đổi cấu trúc, hoặc bộ dò đã hỏng',
  );

  if (truth.length === 0) {
    console.log('\n💥 Dừng: không có mốc chuẩn để đối chiếu.');
    process.exit(1);
  }

  for (const ref of truth) await positiveCase(url, ref);
  await negativeCase(url, 'Điện Thoại Samsung Galaxy A17 LTE 8GB/128GB');

  console.log(failures === 0 ? '\n🎉 TẤT CẢ ĐỀU ĐẠT' : `\n💥 ${failures} ca HỎNG`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
