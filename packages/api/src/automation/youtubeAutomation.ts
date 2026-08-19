import { AppiumYoutubeStudio, disposeSharedAppiumSession } from './appiumYoutubeStudio';
import {
  extractAffiliateFromCollection,
} from './collectionAffiliateExtractor';
import { resolveProductRef } from './shopeeLink';
import { listConnectedDevices } from './adb';
import { automationEnv } from './env';
import { metrics } from './metrics';
import { laLoiDauVao, coNenHuySession } from './errors';
import { getCheckpoint, markPublished, clearCheckpoint } from '../services/jobCheckpoint';
import {
  getCachedShareLink,
  cacheShareLink,
  invalidateShareLink,
} from '../services/collectionShareLink';

export interface TagProductParams {
  jobId: string;
  shopeeUrl: string;
  shopeeProductId?: string | null;
  /** true = chạy hết luồng nhưng KHÔNG bấm "Đăng" (kiểm thử an toàn) */
  dryRun?: boolean;
  /**
   * Lần thử thứ mấy của BullMQ (1 = lần đầu). Dùng cho van an toàn khi quyết
   * định huỷ session: hỏng lại ở lần thử ≥ 2 thì huỷ bất kể lỗi gì (`errors.ts`).
   */
  lanThu?: number;
}

export interface TagProductResult {
  affiliateUrl: string;
  voucher: string;
}

function buildSimulationResult(jobId: string): TagProductResult {
  const mockHash = jobId.slice(0, 8);
  return {
    affiliateUrl: `https://s.shopee.vn/affiliate_sim_${mockHash}`,
    voucher: `VOUCHER_SIM_${Math.floor(1000 + Math.random() * 9000)}`,
  };
}

async function shouldUseSimulation(): Promise<boolean> {
  if (automationEnv.AUTOMATION_MODE === 'simulation') return true;
  if (automationEnv.AUTOMATION_MODE !== 'appium') return true;

  const devices = await listConnectedDevices();
  if (devices.length === 0) {
    console.warn('[Automation] Không có thiết bị Android — chuyển sang chế độ simulation');
    return true;
  }
  return false;
}

/**
 * Lấy link chia sẻ bằng Appium (Phase 2 thật) rồi ghi vào cache.
 * Tách hàm vì có hai nơi gọi: lần đầu chưa có cache, và lần chữa cháy khi link
 * trong cache tỏ ra không dùng được.
 */
async function fetchAndCacheShareLink(
  studio: AppiumYoutubeStudio,
  channelId: string,
  collectionName: string,
): Promise<string> {
  const shareUrl = await studio.getCollectionShareLink();

  if (!shareUrl || !shareUrl.startsWith('http')) {
    throw new Error(`Link chia sẻ bộ sưu tập không hợp lệ: ${shareUrl}`);
  }

  await cacheShareLink(channelId, collectionName, shareUrl);
  return shareUrl;
}


/**
 * Pipeline đầy đủ theo automation.md:
 * 1. Appium — gắn sản phẩm Shopee vào Tuyển tập trên YouTube Studio app
 * 2. Appium — lấy link chia sẻ bộ sưu tập
 * 3. HTTP fetch — tải HTML trang bộ sưu tập, trích xuất affiliate + voucher
 */
export async function tagShopeeProductOnYoutube(
  params: TagProductParams,
): Promise<TagProductResult> {
  const { jobId, shopeeUrl, dryRun = false, lanThu = 1 } = params;
  console.log(`[Automation] 🚀 Bắt đầu Job ID: ${jobId}`);

  if (await shouldUseSimulation()) {
    console.log('[Automation] ℹ️ Chế độ simulation — trả kết quả mock');
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    return buildSimulationResult(jobId);
  }

  const studio = new AppiumYoutubeStudio();
  studio.setJobId(jobId);
  metrics.start();

  const channelId = automationEnv.YT_CHANNEL_ID;

  // ── Hai việc KHÔNG cần điện thoại → chạy song song với Phase 1 ──────────────
  // Cả hai đều là tối ưu thuần: hỏng thì trả null và pipeline đi đường cũ. Không
  // await ở đây, chỉ giữ promise lại tới lúc thực sự cần kết quả.
  //
  // 1. Giải link rút gọn Shopee → ID sản phẩm, để bước trích link so khớp theo
  //    ID thay vì so mờ theo tên (xem shopeeLink.ts).
  const targetRefPromise = resolveProductRef(shopeeUrl).catch(() => null);

  // Đoạn code nạp trước trình duyệt đã bị gỡ bỏ do Phase 3 chuyển sang dùng HTTP fetch.
  // Fetch rất nhanh nên không cần duy trì tài nguyên nền.
  let disposeSessionOnExit = false;

  try {
    console.log('[Automation] [1/4] Kết nối Appium + thiết bị Android...');
    await studio.init();

    // Nếu lần chạy trước đã Đăng thành công rồi mới lỗi, tuyệt đối KHÔNG gắn lại
    // sản phẩm — nếu không, mỗi lần BullMQ retry sẽ thêm một bản sao vào bộ sưu tập.
    const checkpoint = await getCheckpoint(jobId);
    let collectionName: string;
    let productName: string;

    if (checkpoint) {
      console.log(
        `[Automation] [2/4] ⏭  BỎ QUA gắn sản phẩm — lần chạy trước đã Đăng lúc ${checkpoint.publishedAt}. ` +
          `Chạy tiếp từ bước lấy link.`,
      );
      collectionName = checkpoint.collectionName;
      productName = checkpoint.productName;
      studio.resumeAfterPublish(collectionName, productName);
    } else {
      console.log('[Automation] [2/4] Gắn sản phẩm vào bộ sưu tập (Appium)...');
      collectionName = await studio.addProductToCollection(shopeeUrl, {
        collectionName: automationEnv.YT_COLLECTION_NAME || undefined,
        dryRun,
      });

      if (dryRun) {
        throw new Error('[Dry run] Đã dừng trước bước "Đăng" — không tạo link affiliate.');
      }

      productName = studio.getAddedProductName();

      if (studio.wasAlreadyInCollection()) {
        // Sản phẩm đã có sẵn: KHÔNG ghi checkpoint.
        //
        // Checkpoint nghĩa là "lần chạy này đã ĐĂNG thành công, đừng gắn lại" —
        // ở đây ta chưa đăng gì cả. Ghi vào là nói dối trạng thái, và lần retry
        // đọc thấy nó sẽ bỏ qua Phase 1 dựa trên một tiền đề sai.
        //
        // Không ghi cũng không sao: lần chạy lại sẽ đi lại đúng đường này, phát
        // hiện sản phẩm đã có, rồi lại sang Phase 3 — kết quả giống hệt.
        console.log(
          '[Automation] ℹ️  Sản phẩm đã có sẵn trong bộ sưu tập — bỏ qua bước gắn, ' +
            'lấy link của sản phẩm đã có.',
        );
      } else {
        // Ghi checkpoint NGAY sau khi Đăng — mọi lỗi sau điểm này không được phép
        // dẫn tới việc gắn lại sản phẩm.
        await markPublished(jobId, collectionName, productName);
      }
    }

    metrics.mark('phase-1-gan-san-pham');

    console.log('[Automation] [3/4] Lấy link chia sẻ bộ sưu tập...');
    const cachedShareUrl = await getCachedShareLink(channelId, collectionName);
    let collectionShareUrl: string;

    if (cachedShareUrl) {
      console.log(`[Automation]   ⚡ Dùng link chia sẻ đã lưu (bỏ ~22s Appium): ${cachedShareUrl}`);
      collectionShareUrl = cachedShareUrl;
    } else {
      collectionShareUrl = await fetchAndCacheShareLink(studio, channelId, collectionName);
    }
    metrics.mark('phase-2-lay-link-chia-se');

    console.log('[Automation] [4/4] Trích xuất link affiliate (HTTP fetch)...');
    const targetRef = await targetRefPromise;

    let extracted: Awaited<ReturnType<typeof extractAffiliateFromCollection>>;
    try {
      extracted = await extractAffiliateFromCollection(collectionShareUrl, {
        shopeeUrl,
        jobId,
        productName,
        targetRef,
      });
    } catch (err) {
      // Link lấy trực tiếp từ máy mà vẫn hỏng thì đó là lỗi thật — ném tiếp.
      if (!cachedShareUrl) throw err;

      // Link từ cache hỏng: có thể bộ sưu tập đã bị xoá/tạo lại, hoặc giả định
      // "link không đổi" sai. Không đoán — xoá cache, lấy lại bằng Appium như
      // trước giờ vẫn làm, rồi thử đúng một lần nữa. Nếu link mới cũng hỏng thì
      // nguyên nhân nằm chỗ khác và lỗi được ném ra bình thường.
      console.warn(
        `[Automation] ⚠️ Link chia sẻ từ cache không dùng được ` +
          `(${err instanceof Error ? err.message : String(err)}). Lấy lại bằng Appium...`,
      );
      await invalidateShareLink(channelId, collectionName);
      collectionShareUrl = await fetchAndCacheShareLink(studio, channelId, collectionName);

      // Lần thử lại dùng trình duyệt mới tinh: trang nạp trước vừa lỗi có thể
      // đang ở trạng thái dở dang, mà đây là cơ hội cuối trước khi job hỏng —
      // không đáng tiết kiệm 300ms để đổi lấy một biến số nữa.
      extracted = await extractAffiliateFromCollection(collectionShareUrl, {
        shopeeUrl,
        jobId,
        productName,
        targetRef,
      });
    }

    const { affiliateUrl, voucher } = extracted;
    metrics.mark('phase-3-trich-link-affiliate');

    // Job xong trọn vẹn, không còn khả năng retry → dọn checkpoint
    await clearCheckpoint(jobId);

    console.log(`[Automation] ✅ Hoàn thành Job ${jobId}`);
    return { affiliateUrl, voucher };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Automation] ❌ Job ${jobId} thất bại: ${message}`);

    // Có huỷ session Appium dùng chung không — quyết định ở `errors.ts`.
    //
    // Câu hỏi đúng KHÔNG phải "job có hỏng không", mà là "lỗi này nói về KÊNH
    // ĐIỀU KHIỂN hay về MÀN HÌNH". Huỷ session chỉ giúp khi kênh hỏng; với một
    // bước giao diện trượt thì nó bắt JOB KẾ TIẾP trả 11-12 giây dựng lại vì một
    // lỗi chẳng liên quan gì tới nó (đo thật 2026-08-19: 23,3 s/lô 5 job).
    //
    // An toàn vì trạng thái app không đến từ session mà từ `force-stop`, và
    // `init()` của job sau luôn force-stop trừ khi XÁC MINH DƯƠNG TÍNH là màn
    // Mua sắm đang sạch. Xem lý lẽ đầy đủ trong `errors.ts`.
    //
    // Huỷ ở `finally` chứ không phải ngay đây: đóng session trước khi
    // `studio.close()` chạy sẽ khiến close() gọi deleteSession lần thứ hai lên
    // một session đã chết, sinh cảnh báo WebDriverError gây nhiễu log.
    const loiDauVao = laLoiDauVao(err);
    const quyetDinh = coNenHuySession(err, lanThu);
    disposeSessionOnExit = quyetDinh.huy;
    console.log(
      `[Automation] ${quyetDinh.huy ? '🔌 Huỷ' : 'ℹ️  Giữ'} session Appium — ${quyetDinh.lyDo}.`,
    );

    // Lỗi ĐẦU VÀO ném nguyên văn, không bọc tiền tố kỹ thuật: thông báo này đi
    // thẳng tới người dùng qua `error_message`, và "[Automation Failed]" chỉ làm
    // họ tưởng hệ thống hỏng trong khi thật ra link của họ mới là vấn đề.
    // Lớp worker nhận diện nó để KHÔNG retry và KHÔNG đếm vào cầu chì (xem errors.ts).
    if (loiDauVao) {
      throw err;
    }

    if (message.includes('ECONNREFUSED') || message.includes('connect')) {
      throw new Error(
        '[Appium Failed] Không kết nối được Appium server. Hãy chạy: appium --port 4723',
      );
    }

    throw new Error(`[Automation Failed] ${message}`);
  } finally {
    await studio.close();
    if (disposeSessionOnExit) await disposeSharedAppiumSession();

    // In bảng chi phí ở CẢ nhánh lỗi: job hỏng ở giây thứ 80 cũng cho biết 80
    // giây đó tiêu vào đâu, và đó thường là lúc cần biết nhất.
    metrics.finish();
  }
}
