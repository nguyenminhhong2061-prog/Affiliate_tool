import * as path from 'path';
import * as fs from 'fs';
import { metrics } from './metrics';
import {
  extractOriginRef,
  parseProductRef,
  resolveProductRef,
  sameProduct,
  formatRef,
  type ShopeeProductRef,
} from './shopeeLink';

const ERROR_DUMPS_DIR = path.join(__dirname, '../../logs/error_dumps');

export interface ExtractAffiliateOptions {
  shopeeUrl?: string;
  jobId?: string;
  headless?: boolean; // Không còn dùng nhưng giữ cho tương thích interface cũ
  /** Tên sản phẩm vừa gắn (đọc bằng OCR trong app) — đường lui khi không so được ID */
  productName?: string;
  /** ID sản phẩm đầu vào đã giải sẵn — đường so khớp chính, chính xác tuyệt đối */
  targetRef?: ShopeeProductRef | null;
}

/** Bỏ dấu + hạ chữ thường để so khớp tên sản phẩm chịu được sai lệch OCR */
function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Điểm tương đồng giữa tên đọc từ app và tiêu đề sản phẩm trên trang bộ sưu tập.
 */
function similarity(a: string, b: string): number {
  const aw = new Set(normalizeForMatch(a).split(' ').filter((w) => w.length > 2));
  const bw = new Set(normalizeForMatch(b).split(' ').filter((w) => w.length > 2));
  if (aw.size === 0 || bw.size === 0) return 0;
  let shared = 0;
  for (const w of aw) if (bw.has(w)) shared++;
  return shared / Math.min(aw.size, bw.size);
}

export interface ExtractAffiliateResult {
  affiliateUrl: string;
  voucher: string;
}


// ─── Dò voucher trong TEXT của trang: ĐÃ BỎ, và không được dựng lại ─────────
//
// Từng có `extractVoucherFromText()` quét cả trang bằng những mẫu lỏng như
// `/code[:\s]*([A-Z0-9]{4,20})/i`. Hồi còn Playwright nó soi `innerText` nên
// tương đối vô hại; từ khi Phase 3 chuyển sang `fetch`, nó soi **HTML thô 780 KB
// kèm toàn bộ mã JS** — và bắt đầu bịa ra dữ liệu.
//
// Bắt tại trận 2026-08-19, job `226149c6` trả về người dùng:
//
//     "voucher": "URICOMPONENT"        ← bóc ra từ chữ `decodeURIComponent`
//
// Đúng loại lỗi §10.7 xếp nguy hiểm nhất, và là lần thứ NĂM của dự án. Nó lọt
// được vì không ai đọc trường `voucher` (app không hiển thị) — y hệt vụ mock
// trong `services/shopee.ts` ở §10.7 mục 4: **dữ liệu bịa nằm im không gây
// triệu chứng cho tới lúc có người đọc nó.**
//
// §1.1 đã chốt bằng quan sát thật: KHÔNG tồn tại mã voucher dạng chuỗi riêng.
// Ưu đãi nhúng sẵn trong link và tự áp khi mở. Vậy nên dò theo văn bản không
// thể đúng — nó chỉ có hai kết cục: rỗng, hoặc rác. Giữ lại đúng
// `extractVoucherFromUrl`: đọc tham số truy vấn CÓ TÊN, không đoán được bậy.

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

async function saveHtmlSnapshot(html: string, jobId: string, suffix: string): Promise<void> {
  if (!fs.existsSync(ERROR_DUMPS_DIR)) {
    fs.mkdirSync(ERROR_DUMPS_DIR, { recursive: true });
  }
  const filePath = path.join(ERROR_DUMPS_DIR, `${suffix}_${jobId}.html`);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`[Fetch] 📸 Lưu dump HTML: ${filePath}`);
}

// ─── Nạp trước trang bộ sưu tập: ĐÃ BỎ HẲN ──────────────────────────────────
//
// Prewarm sinh ra để giấu ~10 giây tải trang nguội của Chromium ra khỏi đường
// găng. Phase 3 nay chỉ là một lệnh `fetch` tốn ~0,3-2 s, nên không còn gì để
// giấu — và một dummy trả `null` chỉ khiến người đọc sau tưởng cơ chế vẫn còn.
// Cùng lý do: cờ `PLAYWRIGHT_PREWARM` đã gỡ khỏi `env.ts`.

interface PageLink {
  href: string;
  text: string;
}

/**
 * Gỡ escape của một URL lấy ra từ HTML thô, trả về dạng dùng được.
 *
 * Trang bộ sưu tập nhúng link trong `ytInitialData` — một chuỗi JS nằm trong
 * <script>. Ở đó dấu `&` được ghi thành `&`, và khi khối JSON bị lồng thêm
 * một tầng nữa thì thành `\\u0026`; dấu `/` cũng có thể là `\/` hoặc `\\/`.
 * Lượng tử `{1,2}` gỡ gọn cả hai tầng trong một lượt.
 *
 * Bước cuối cắt dấu `\` thừa ở đuôi: URL nằm trong chuỗi JSON nên ký tự đóng là
 * `"`, và ngay trước nó có thể còn một `\` của escape `\"` — dấu đó thuộc về cú
 * pháp JSON chứ không thuộc về URL.
 */
function unescapeEmbeddedUrl(raw: string): string {
  return raw
    .replace(/\\{1,2}u0026/gi, '&')
    .replace(/\\{1,2}\//g, '/')
    .replace(/\\+$/, '');
}

/**
 * Trích xuất link Shopee từ HTML thô bằng RegEx.
 */
function readShopeeLinksFromHtml(html: string): PageLink[] {
  const links: PageLink[] = [];

  // ⚠️ Lớp ký tự KHÔNG được loại trừ dấu `\` — đọc hết đoạn này trước khi sửa.
  //
  // Bản trước dùng `[^"'\\\s<>]+`, tức dừng ngay khi gặp `\`. Nhưng trong HTML
  // thật, URL có dạng:
  //
  //     https://s.shopee.vn/an_redir?affiliate_id=17104820001&origin_link=...
  //
  // nên MỌI link đều bị cắt cụt đúng tại dấu escape đầu tiên — mất sạch phần
  // `origin_link`, tức mất ID sản phẩm, thứ DUY NHẤT so khớp được (§4.8).
  //
  // Tệ hơn nữa: cả 6 lần xuất hiện trên trang đều cụt thành CÙNG một chuỗi, nên
  // `new Set` gộp lại còn 1. Trang 3 sản phẩm trông như chỉ có 1 link vô dụng,
  // và mọi job đều rơi vào vòng chờ 45 giây rồi báo "sản phẩm không xuất hiện
  // trên trang bộ sưu tập" — thông báo trỏ hoàn toàn sai hướng, vì sản phẩm CÓ
  // trên trang, chỉ là bộ trích không đọc nổi.
  //
  // URL nằm trong chuỗi JSON nên `"` mới là dấu kết thúc thật. `\` là ký tự hợp
  // lệ BÊN TRONG url: phải nuốt vào rồi gỡ escape sau (`unescapeEmbeddedUrl`).
  //
  // Mốc kiểm chứng (2026-08-19), đối chiếu với trình duyệt thật qua
  // `dumpCollectionLinks.ts`: cùng một trang cho 3/3 link mang ID ở cả hai đường.
  const regex = /https:(?:\/|\\\/)+(?:s\.shopee\.vn|shp\.ee|shopee\.vn|vn\.shp\.ee)[^"'\s<>]+/g;
  const rawHrefs = [...new Set([...html.matchAll(regex)].map((m) => m[0]))];

  for (const raw of rawHrefs) {
    const href = unescapeEmbeddedUrl(raw);
    let text = '';
    const blockIndex = html.indexOf(raw);
    if (blockIndex !== -1) {
       const chunk = html.substring(Math.max(0, blockIndex - 1000), blockIndex + 500);
       const titleMatch = chunk.match(/"title"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"/);
       if (titleMatch) {
         text = titleMatch[1];
       } else {
         text = chunk; 
       }
    }
    
    links.push({ href, text: text.slice(0, 150) });
  }
  return links;
}

/** Link mang đúng ID sản phẩm cần tìm — so khớp tuyệt đối, không có ngưỡng */
function findLinkByRef(links: PageLink[], ref: ShopeeProductRef): PageLink | undefined {
  return links.find((l) => {
    const found = extractOriginRef(l.href);
    return found !== null && sameProduct(found, ref);
  });
}

/** Tải lại trang tới khi thấy sản phẩm cần tìm, hoặc hết hạn */
async function waitForProductOnPage(
  collectionShareUrl: string,
  ref: ShopeeProductRef,
  timeoutMs: number,
): Promise<{ matched: PageLink; allLinks: PageLink[]; html: string } | null> {
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL_MS = 1500;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    
    let html = '';
    try {
      const res = await metrics.time('fetch-tai-trang', () => 
        fetch(collectionShareUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept-Language': 'vi,en;q=0.9',
          },
        })
      );
      html = await res.text();
    } catch (e) {
      console.warn(`[Fetch] ⚠️ Lỗi khi tải lại trang: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const links = readShopeeLinksFromHtml(html);
    const hit = findLinkByRef(links, ref);
    if (hit) {
      console.log(`[Fetch] ✅ Sản phẩm ${formatRef(ref)} đã lên trang (${links.length} link)`);
      return { matched: hit, allLinks: links, html };
    }
    console.log(`[Fetch] … vẫn chưa thấy (${links.length} link), tải lại`);
  }

  return null;
}

export async function extractAffiliateFromCollection(
  collectionShareUrl: string,
  options: ExtractAffiliateOptions = {},
): Promise<ExtractAffiliateResult> {
  const {
    shopeeUrl,
    jobId = 'unknown',
    productName,
  } = options;

  console.log(`[Fetch] Mở trang bộ sưu tập bằng HTTP Fetch: ${collectionShareUrl}`);

  let targetRef = options.targetRef ?? null;
  if (!targetRef && shopeeUrl) {
    targetRef = await resolveProductRef(shopeeUrl);
  }
  if (targetRef) {
    console.log(`[Fetch] Sản phẩm cần tìm: ${formatRef(targetRef)}`);
  }

  let html = '';
  try {
    const res = await metrics.time('fetch-tai-trang', () =>
      fetch(collectionShareUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept-Language': 'vi,en;q=0.9',
        },
      })
    );
    html = await res.text();

    let voucher = extractVoucherFromUrl(collectionShareUrl) || '';

    let shopeeLinks = readShopeeLinksFromHtml(html);
    console.log(`[Fetch] Tìm thấy ${shopeeLinks.length} link Shopee trên trang bộ sưu tập`);

    let affiliateUrl = '';
    let matchReason = '';

    if (targetRef) {
      const PRODUCT_APPEAR_TIMEOUT_MS = 45000;
      let matched = findLinkByRef(shopeeLinks, targetRef);

      if (!matched) {
        console.log(
          `[Fetch] ⏳ Sản phẩm ${formatRef(targetRef)} chưa có trên trang ` +
            `(${shopeeLinks.length} link). Trang công khai cập nhật chậm hơn thao tác trong app — tải lại...`,
        );
        const pollResult = await waitForProductOnPage(collectionShareUrl, targetRef, PRODUCT_APPEAR_TIMEOUT_MS);
        if (pollResult) {
           matched = pollResult.matched;
           shopeeLinks = pollResult.allLinks;
           html = pollResult.html; 
        }
      }

      if (!matched) {
        throw new Error(
          `Sản phẩm ${formatRef(targetRef)} không xuất hiện trên trang bộ sưu tập sau ` +
            `${PRODUCT_APPEAR_TIMEOUT_MS / 1000}s chờ (trang có ${shopeeLinks.length} link Shopee). ` +
            `Sản phẩm ĐÃ được gắn và đăng thành công trong app, nhưng trang công khai chưa cập nhật. ` +
            `Từ chối trả link để tránh đưa nhầm sản phẩm cho người dùng.`,
        );
      }

      affiliateUrl = matched.href;
      matchReason = `khớp ID sản phẩm trong origin_link (${formatRef(targetRef)})`;
    } else {
      console.warn(
        '[Fetch] ⚠️ Không có ID sản phẩm để đối chiếu — phải so theo shortcode/tên. ' +
          'Độ tin cậy thấp hơn nhiều so với so theo ID.',
      );

      if (shopeeUrl) {
        const shortcode = shopeeUrl.split('/').pop()?.split('?')[0];
        const matched = shopeeLinks.find(
          (l) =>
            l.href === shopeeUrl ||
            (shortcode && shortcode.length > 4 && l.href.includes(shortcode)),
        );
        if (matched) {
          affiliateUrl = matched.href;
          matchReason = 'khớp shortcode URL gốc';
        }
      }

      if (!affiliateUrl && productName) {
        const ranked = shopeeLinks
          .map((l) => ({ link: l, score: similarity(productName, l.text) }))
          .sort((a, b) => b.score - a.score);

        const best = ranked[0];
        const runnerUp = ranked[1];

        const clearWinner =
          best && best.score >= 0.6 && (!runnerUp || best.score - runnerUp.score >= 0.2);

        if (clearWinner) {
          affiliateUrl = best.link.href;
          matchReason = `khớp tên sản phẩm (${Math.round(best.score * 100)}%, ` +
            `cách ứng viên nhì ${Math.round((best.score - (runnerUp?.score ?? 0)) * 100)} điểm)`;
        } else if (best) {
          console.warn(
            `[Fetch] Ứng viên tốt nhất theo tên chỉ đạt ${Math.round(best.score * 100)}%` +
              (runnerUp ? `, nhì ${Math.round(runnerUp.score * 100)}% — quá sát nhau` : ''),
          );
        }
      }

      if (!affiliateUrl) {
        throw new Error(
          `Không xác định được sản phẩm vừa gắn trên trang bộ sưu tập ` +
            `(tên cần tìm: "${productName || '(không có)'}"). ` +
            `Trang có ${shopeeLinks.length} link Shopee nhưng không cái nào khớp đủ tin cậy. ` +
            `Từ chối trả link để tránh đưa nhầm sản phẩm cho người dùng.`,
        );
      }
    }

    console.log(`[Fetch] Chọn link theo: ${matchReason}`);

    if (!voucher) {
      voucher = extractVoucherFromUrl(affiliateUrl) || '';
    }

    if (!voucher) {
      // Đường bình thường, không phải thiếu sót: §1.1 xác nhận ưu đãi nhúng sẵn
      // trong link chứ không có mã rời. Rỗng ở đây là ĐÚNG.
      console.log('[Fetch] Không có mã voucher rời (đúng như mong đợi — ưu đãi nằm trong link)');
    }

    console.log(`[Fetch] ✅ Affiliate: ${affiliateUrl} | Voucher: ${voucher}`);
    return { affiliateUrl, voucher };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Fetch] ❌ Lỗi trích xuất affiliate: ${message}`);

    if (html) {
      await saveHtmlSnapshot(html, jobId, 'collection_error').catch(() => {});
    }

    throw new Error(`[AffiliateExtractor Failed] ${message}`);
  }
}

export { parseProductRef };
