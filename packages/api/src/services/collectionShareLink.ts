/**
 * Bộ nhớ đệm link chia sẻ của bộ sưu tập.
 *
 * ── Vì sao cache được ────────────────────────────────────────────────────────
 * Phase 2 của automation (mở lại màn Mua sắm → thẻ bộ sưu tập → Chia sẻ → Sao
 * chép liên kết → đọc clipboard) tốn ~22 giây mỗi job, nhưng KHÔNG có bước nào
 * phụ thuộc vào sản phẩm vừa gắn. Link lấy ra là URL công khai của *bộ sưu tập*,
 * không phải của sản phẩm. Gắn thêm sản phẩm làm đổi NỘI DUNG trang đó, không
 * làm đổi địa chỉ trang.
 *
 * Nói cách khác: 22 giây đó đang trả lại cùng một chuỗi ký tự ở mọi job.
 *
 * ── Vì sao vẫn an toàn nếu giả định trên sai ─────────────────────────────────
 * Đây là giả định về hành vi của YouTube, mà CLAUDE.md §8 có quy tắc rõ: không
 * kết luận bằng suy luận. Nên cache được thiết kế để tự sửa: khi bước trích link
 * affiliate thất bại với link lấy từ cache, tầng gọi xoá cache, lấy lại link
 * bằng Appium như cũ rồi thử lại một lần nữa (xem youtubeAutomation.ts).
 *
 * Hệ quả: nếu giả định đúng → tiết kiệm 22 giây/job. Nếu sai → job vẫn chạy
 * đúng, chỉ chậm hơn hiện tại một chút ở lần đầu phát hiện. Không có kịch bản
 * nào cache trả sai link cho người dùng, vì link sai thì không trích được sản
 * phẩm và pipeline sẽ ném lỗi chứ không đoán bừa (CLAUDE.md §10.7).
 *
 * ── Vì sao có TTL dù link được cho là vĩnh viễn ──────────────────────────────
 * Người dùng có thể xoá rồi tạo lại bộ sưu tập trùng tên, khi đó link đổi mà
 * không có sự kiện nào báo cho ta biết. TTL 7 ngày là chốt chặn cuối để một
 * mục cache hỏng không sống mãi.
 */
import { redis } from '../redis';

/** 7 ngày — đủ dài để gần như mọi job dùng lại, đủ ngắn để lỗi tự hết */
const SHARE_LINK_TTL_SECONDS = 7 * 24 * 3600;

function key(channelId: string, collectionName: string): string {
  return `yt:sharelink:${channelId}:${collectionName}`;
}

/**
 * Bỏ phần truy vấn trước khi lưu.
 *
 * Đo thật ngày 2026-08-16, hai lần "Sao chép liên kết" cách nhau vài phút trên
 * cùng một bộ sưu tập:
 *   .../shopcollection/SCUCNWkaKv5uJZkFrKH503EWIKyAPnZzfJZqg?si=0OUxO2JE4-xXGlzl
 *   .../shopcollection/SCUCNWkaKv5uJZkFrKH503EWIKyAPnZzfJZqg?si=_Yk-j3dx3AgSn6Lh
 *
 * Đường dẫn giống hệt — đó là bằng chứng cho giả định "link bộ sưu tập không
 * đổi". Riêng `si` là token phiên chia sẻ, đổi mỗi lần bấm.
 *
 * Vì sao phải bỏ chứ không chỉ mặc kệ: giữ lại thì mọi job về sau đều mở trang
 * với cùng một mã phiên chia sẻ, tức là gửi cho YouTube một tín hiệu đều đặn bất
 * thường. Đã kiểm chứng URL trần vẫn mở được và vẫn thấy đủ 5 link Shopee.
 */
function stripTrackingParams(shareUrl: string): string {
  try {
    const u = new URL(shareUrl);
    u.search = '';
    return u.toString();
  } catch {
    return shareUrl;
  }
}

export async function getCachedShareLink(
  channelId: string,
  collectionName: string,
): Promise<string | null> {
  if (!channelId || !collectionName) return null;
  try {
    return await redis.get(key(channelId, collectionName));
  } catch (err) {
    // Redis hỏng không được phép làm hỏng job — chỉ mất phần tăng tốc.
    console.warn('[ShareLinkCache] Không đọc được cache:', (err as Error).message);
    return null;
  }
}

export async function cacheShareLink(
  channelId: string,
  collectionName: string,
  shareUrl: string,
): Promise<void> {
  if (!channelId || !collectionName || !shareUrl) return;
  try {
    await redis.set(
      key(channelId, collectionName),
      stripTrackingParams(shareUrl),
      'EX',
      SHARE_LINK_TTL_SECONDS,
    );
  } catch (err) {
    console.warn('[ShareLinkCache] Không ghi được cache:', (err as Error).message);
  }
}

/** Xoá mục cache khi link tỏ ra không dùng được nữa */
export async function invalidateShareLink(
  channelId: string,
  collectionName: string,
): Promise<void> {
  if (!channelId || !collectionName) return;
  try {
    await redis.del(key(channelId, collectionName));
  } catch (err) {
    console.warn('[ShareLinkCache] Không xoá được cache:', (err as Error).message);
  }
}
