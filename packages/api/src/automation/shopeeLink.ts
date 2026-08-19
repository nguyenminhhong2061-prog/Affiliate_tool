/**
 * Nhận dạng sản phẩm Shopee theo ID, dùng để so khớp ở bước trích link affiliate.
 *
 * ── Vấn đề đang giải ─────────────────────────────────────────────────────────
 * Trước đây bước trích link chọn sản phẩm bằng cách so TÊN: OCR đọc tên sản phẩm
 * trong app (tốn ~2,6 giây), rồi so mờ với tiêu đề trên trang bộ sưu tập theo tỉ
 * lệ từ trùng nhau, lấy ngưỡng 0,5. Cách đó vừa chậm vừa không chắc — OCR đọc
 * lệch vài ký tự là điểm tụt, mà hai sản phẩm cùng dòng ("Tai nghe Bluetooth
 * Sony WH-1000XM4" và "...XM5") lại rất dễ vượt ngưỡng của nhau.
 *
 * ── Cách làm đúng hơn ────────────────────────────────────────────────────────
 * CLAUDE.md §5 ghi lại cách người dùng đã dùng để tự kiểm chứng job ngày
 * 2026-08-16: link affiliate YouTube sinh ra mang theo tham số `origin_link`,
 * giải mã ra đúng `shopee.vn/product/1274547388/28130046415` — tức là chính
 * sản phẩm của link rút gọn đầu vào.
 *
 * Nếu ID sản phẩm nằm sẵn trong link affiliate thì so khớp theo ID được: chính
 * xác tuyệt đối, không cần OCR, không cần ngưỡng, không có vùng xám.
 *
 * ── Vì sao vẫn giữ đường so theo tên ─────────────────────────────────────────
 * Việc `origin_link` LUÔN có mặt mới chỉ được quan sát một lần, chưa phải kết
 * luận. CLAUDE.md §4.6 để lại bài học rằng lớp bảo vệ dựa trên một dấu hiệu chọn
 * sai còn nguy hiểm hơn không có lớp nào. Nên ở đây so theo ID là đường CHÍNH,
 * so theo tên vẫn còn nguyên làm đường lui, và log nói rõ đường nào đã thắng để
 * sau vài lần chạy thật có căn cứ quyết định bỏ hẳn OCR (xem
 * AUTOMATION_SKIP_PRODUCT_OCR trong env.ts).
 */

export interface ShopeeProductRef {
  sellerId: string;
  productId: string;
}

/**
 * Hai định dạng URL sản phẩm công khai của Shopee Việt Nam:
 *   /ten-san-pham-i.SELLER.PRODUCT
 *   /product/SELLER/PRODUCT
 */
const PRODUCT_PATTERNS = [
  /-i\.(\d{4,})\.(\d{4,})/,
  /\/product\/(\d{4,})\/(\d{4,})/,
];

/** Bóc {sellerId, productId} từ một URL Shopee dạng đầy đủ. Null nếu không phải. */
export function parseProductRef(url: string): ShopeeProductRef | null {
  for (const pattern of PRODUCT_PATTERNS) {
    const m = url.match(pattern);
    if (m) return { sellerId: m[1], productId: m[2] };
  }
  return null;
}

export function sameProduct(a: ShopeeProductRef, b: ShopeeProductRef): boolean {
  return a.productId === b.productId && a.sellerId === b.sellerId;
}

export function formatRef(ref: ShopeeProductRef): string {
  return `${ref.sellerId}/${ref.productId}`;
}

/**
 * Giải mã một chuỗi có thể đã được URL-encode nhiều lớp.
 * Link affiliate hay lồng URL trong tham số, và tuỳ đường sinh ra mà bị encode
 * một hoặc hai lớp — thử giải tới khi không đổi nữa, tối đa 3 lượt để không lặp
 * vô hạn với chuỗi chứa '%' thật.
 */
function deepDecode(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i++) {
    if (!current.includes('%')) break;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      break; // chuỗi có '%' nhưng không phải escape hợp lệ
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Bóc ID sản phẩm gốc ra khỏi link affiliate do YouTube Shopping sinh ra.
 *
 * Thử theo thứ tự: tham số `origin_link` (đường đã quan sát được), rồi tới bất
 * kỳ tham số nào chứa URL sản phẩm Shopee, rồi tới quét cả chuỗi đã giải mã.
 * Ba tầng vì ta chỉ mới thấy MỘT mẫu link thật — cấu trúc có thể khác ở link
 * khác, và tầng sau không tốn gì khi tầng trước đã trúng.
 */
export function extractOriginRef(affiliateUrl: string): ShopeeProductRef | null {
  // Tầng 1: đúng tham số đã biết
  try {
    const parsed = new URL(affiliateUrl);
    const origin = parsed.searchParams.get('origin_link');
    if (origin) {
      const ref = parseProductRef(deepDecode(origin));
      if (ref) return ref;
    }

    // Tầng 2: tham số khác cũng có thể mang URL gốc
    for (const [, value] of parsed.searchParams) {
      if (!value.includes('shopee') && !value.includes('%2F')) continue;
      const ref = parseProductRef(deepDecode(value));
      if (ref) return ref;
    }
  } catch {
    // URL không parse được thì rơi xuống tầng 3
  }

  // Tầng 3: quét cả chuỗi
  return parseProductRef(deepDecode(affiliateUrl));
}

/**
 * Đưa link đầu vào của người dùng về {sellerId, productId}.
 *
 * Link rút gọn (shope.ee/..., s.shopee.vn/...) không chứa ID nào, phải đi theo
 * chuyển hướng mới biết nó trỏ tới sản phẩm nào.
 *
 * KHÔNG ném lỗi: trả null khi không giải được. Đây là bước tăng độ chắc chắn,
 * không phải bước bắt buộc — giải được thì so khớp theo ID, không giải được thì
 * pipeline vẫn còn đường so theo tên như cũ.
 */
export async function resolveProductRef(
  url: string,
  /**
   * Hạn rộng rãi CÓ CHỦ ĐÍCH. Bản thân request chỉ tốn ~1,4 giây (đo thật), nhưng
   * hàm này được gọi song song với Phase 1 — mà Phase 1 chạy `execSync` để gọi adb,
   * và execSync CHẶN CỨNG event loop của Node. Trong lúc bị chặn, request không
   * nhích được, còn AbortController thì đếm theo đồng hồ treo tường; loop vừa được
   * giải phóng là timer quá hạn nổ ngay và huỷ một request vốn hoàn toàn khoẻ mạnh.
   *
   * Đã quan sát thật: hạn 8 giây, job huỷ request giữa lúc tạo session Appium mất
   * 42 giây, và bước trích link mất luôn đường so khớp theo ID.
   *
   * Hạn dài không làm chậm gì: kết quả chỉ cần tới ở Phase 3, vốn xảy ra sau đó rất lâu.
   */
  timeoutMs = 45000,
): Promise<ShopeeProductRef | null> {
  const direct = parseProductRef(url);
  if (direct) return direct;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Shopee trả trang khác (hoặc chặn) với user-agent mặc định của Node
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });

    // URL cuối sau chuyển hướng thường đã là trang sản phẩm đầy đủ
    const fromUrl = parseProductRef(res.url);
    if (fromUrl) return fromUrl;

    // Một số link rút gọn dừng ở trang trung gian mang ID trong nội dung
    const body = await res.text();
    return parseProductRef(body);
  } catch (err) {
    console.warn(
      `[ShopeeLink] Không giải được link rút gọn "${url}": ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        `Sẽ so khớp sản phẩm theo tên thay vì theo ID.`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
