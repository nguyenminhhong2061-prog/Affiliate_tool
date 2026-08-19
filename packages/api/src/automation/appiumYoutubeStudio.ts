/**
 * Automation app YouTube Studio (Android) bằng Appium.
 *
 * ── Vì sao code này không dùng selector theo text ────────────────────────────
 * App YouTube Studio vẽ phần lớn chữ bằng canvas, không đưa vào accessibility
 * tree (khảo sát thực tế: màn Tổng quan 6/91 node có nhãn, Kiếm tiền 4/90,
 * Mua sắm 4/85). Mọi selector kiểu `text("Kiếm tiền")` đều không bao giờ khớp.
 * Vì vậy lớp `Screen` định vị theo 3 tầng: accessibility → OCR → cấu trúc.
 *
 * ── Luồng thật (đã kiểm chứng trên thiết bị) ─────────────────────────────────
 * PHASE 1 — gắn sản phẩm:
 *   deep link Mua sắm → thẻ bộ sưu tập → menu ⋮ → Chỉnh sửa → Thêm
 *   → dán link Shopee → Người bán → Shopee → chọn sản phẩm → Xong → Đăng
 * PHASE 2 — lấy link chia sẻ:
 *   về Mua sắm → thẻ bộ sưu tập → Chia sẻ → Sao chép liên kết → đọc clipboard
 */
import { remote, attach } from 'webdriverio';
import { luuSession, docSession, xoaSession } from '../services/appiumSessionStore';
import { automationEnv } from './env';
import { getDeviceClipboard, runAdbArgs } from './adb';
import { preflightCheck } from './deviceHealth';
import { Screen, humanDelay } from './screen';
import { readScreen } from './ocr';
import { metrics } from './metrics';
import { centerOf, tapAt, normalizeText, parseNodes, type UiNode } from './uiFinder';
import { parseProductRef } from './shopeeLink';
import { LoiDauVao } from './errors';

const YT_STUDIO_PKG = 'com.google.android.apps.youtube.creator';
const YT_STUDIO_ACTIVITY = 'com.google.android.apps.youtube.creator.main.MainActivity';

/**
 * Mức "chờ app rảnh" của UiAutomator2 khi đọc cây a11y — xem `setIdleWait()`.
 *
 * FAST dùng cho các vòng chờ (đọc hụt thì lượt sau bắt được).
 * SAFE dùng cho chỗ ĐẾM nút phục vụ chốt §4.7 (đọc hụt cho ra số sai, nguy hiểm).
 * SAFE giữ đúng mặc định của UiAutomator2 để hành vi ở đó không đổi chút nào.
 */
const FAST_IDLE_MS = 100;

/**
 * Mức chờ cho đường đọc tin cậy. HẠ TỪ 10000 xuống 1500 (2026-08-17).
 *
 * 10000 là mặc định của UiAutomator2, và nó khiến lần đọc ngay sau bước lọc Shopee
 * treo tới 10 giây vì app đang tải kết quả — người dùng thấy màn hình đứng hình.
 *
 * Nay việc "chờ danh sách render xong" do `readNodesReliably` lo bằng cách so hai
 * lần đọc liên tiếp, chặt hơn hẳn việc đoán qua thời gian rảnh của app. Giá trị
 * này chỉ còn hai nhiệm vụ: cho app một nhịp ngắn để ổn định, và (vì khác
 * FAST_IDLE_MS) tắt `ignoreUnimportantViews` để đọc cây đầy đủ.
 */
const SAFE_IDLE_MS = 1500;

/** Nhãn của các nút điều khiển đi kèm dải bộ sưu tập — không phải bộ sưu tập */
const NOT_A_COLLECTION = [
  'tạo bộ sưu tập',
  'xem thêm',
  'kết nối cửa hàng',
  'tiếp tục',
  'action menu',
];

/**
 * Chờ cứng. Được đo riêng trong metrics dưới tên `delay-cung` vì đây là khoản
 * chi đáng ngờ nhất: mỗi lần chờ cứng là một lần ta đoán app cần bao lâu thay vì
 * hỏi app đã xong chưa. §8 đo được 39,9 giây qua 14 lần gọi ở phiên bản trước.
 */
/**
 * Nhãn của các nút trên màn kết quả tìm sản phẩm — dùng để so khớp CHÍNH XÁC.
 *
 * ── Vì sao bắt buộc phải khớp chính xác, không được khớp chứa ────────────────
 * Cây a11y của màn này (dump thật, CLAUDE.md §8) chứa đồng thời:
 *     "Chọn sản phẩm"          ← nút "+" cần bấm
 *     "Bỏ chọn sản phẩm"       ← nút GỠ sản phẩm đã có trong bộ sưu tập
 *     "Xem sản phẩm đã chọn"   ← nút xem danh sách
 *     "Xoá người bán đã chọn"  ← nút xoá bộ lọc, xuất hiện ngay khi lọc Shopee
 *
 * Cả bốn đều chứa cụm con của nhau. Khớp kiểu "chứa" biến chúng thành một, và
 * đó là gốc của ba lỗi độc lập được sửa cùng lúc ở đây — xem selectMatchingProduct.
 */
const LABEL_ADD_PRODUCT = 'Chọn sản phẩm';
const LABEL_REMOVE_PRODUCT = 'Bỏ chọn sản phẩm';

/** Node có nhãn khớp CHÍNH XÁC (sau chuẩn hoá NFC + hạ chữ thường) */
function hasExactLabel(node: UiNode, label: string): boolean {
  return normalizeText(node.desc) === normalizeText(label);
}

const delay = (ms: number): Promise<void> =>
  metrics.time('delay-cung', () => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** Nghỉ giữa hai lượt hỏi trong vòng lặp chờ — đo tách khỏi chờ cứng */
const pollSleep = (ms: number): Promise<void> =>
  metrics.time('cho-vong-lap', () => new Promise<void>((resolve) => setTimeout(resolve, ms)));

export interface AddProductOptions {
  /** Tên bộ sưu tập cần gắn vào. Bỏ trống = dùng bộ sưu tập đầu tiên. */
  collectionName?: string;
  /** true = dừng ngay trước khi bấm "Đăng" (dùng để kiểm thử an toàn) */
  dryRun?: boolean;
}

/**
 * Session Appium dùng chung giữa các job.
 *
 * Tạo session tốn 10,5 giây đo thật (CLAUDE.md §8) — khoản chi lớn nhất còn lại
 * sau khi các bước khác đã được cắt. §8 từng xếp việc tái dùng lại vì `init()`
 * phải `force-stop` app để bắt đầu sạch, mà giữ session nghĩa là mất đảm bảo đó.
 *
 * Nhưng hai thứ đó tách rời được: 10,5 giây kia là bắt tay với UiAutomator2 trên
 * thiết bị, còn trạng thái sạch của APP đến từ `force-stop` — và `force-stop`
 * vẫn được gọi ở đầu mỗi job như cũ. Cái được giữ lại chỉ là kênh điều khiển.
 *
 * Hai chốt an toàn:
 *   1. Trước khi dùng lại, gọi thử một lệnh để chắc session còn sống.
 *   2. Job THẤT BẠI thì huỷ session (youtubeAutomation.ts gọi
 *      disposeSharedAppiumSession) — lần retry bắt đầu hoàn toàn mới, đúng chỗ
 *      cần sự sạch sẽ nhất.
 */
let sharedDriver: WebdriverIO.Browser | null = null;
let sharedSerial = '';

/** Đóng hẳn session dùng chung. Gọi khi job hỏng và lúc tắt tiến trình. */
export async function disposeSharedAppiumSession(): Promise<void> {
  // Xoá bản ghi TRƯỚC: giữ lại một bản ghi trỏ tới session vừa bị xoá chỉ khiến
  // lần khởi động sau tốn một vòng nối lại chắc chắn trượt.
  await xoaSession();
  if (!sharedDriver) return;
  const drv = sharedDriver;
  sharedDriver = null;
  sharedSerial = '';
  await drv.deleteSession().catch(() => {});
}

/**
 * Nhả session khi TẮT TIẾN TRÌNH mà KHÔNG xoá nó trên Appium server.
 *
 * Khác `disposeSharedAppiumSession` đúng một điều, và điều đó là cả mục đích:
 * session vẫn sống trên server, nên lần khởi động sau `init()` nối lại được và
 * bỏ hẳn 11-14 giây dựng mới. Bản ghi trong Redis được giữ nguyên.
 *
 * An toàn vì `newCommandTimeout` 3600s vẫn là lưới cuối: tiến trình không bao
 * giờ quay lại thì session tự chết sau 1 giờ. Thiết bị này chuyên dụng cho hệ
 * thống nên một session nằm chờ không cản trở ai.
 */
export function nhaSessionGiuTrenServer(): void {
  sharedDriver = null;
  sharedSerial = '';
}

/**
 * Nhịp ping giữ session Appium sống.
 *
 * `newCommandTimeout` là 3600 giây: không nhận lệnh nào trong 1 giờ thì Appium tự
 * đóng session, và job kế tiếp phải trả lại 10-15 giây dựng lại. Ở lưu lượng thấp
 * — đúng giai đoạn hiện nay — khoảng nghỉ hơn 1 giờ là chuyện bình thường.
 *
 * 15 phút cho biên an toàn gấp 4 lần, và mỗi lần chỉ tốn một lệnh `getWindowSize`.
 */
const KEEPALIVE_MS = 15 * 60 * 1000;
let keepaliveTimer: NodeJS.Timeout | null = null;

function startKeepalive(): void {
  if (keepaliveTimer) return;

  keepaliveTimer = setInterval(async () => {
    if (!sharedDriver) return;
    try {
      await sharedDriver.getWindowSize();
    } catch {
      // Session chết trong lúc rảnh (Appium restart, máy rớt USB...). Dọn tham
      // chiếu ngay thay vì để job sau phát hiện — nó vẫn xử lý được, nhưng dọn
      // sớm giúp log nói đúng chuyện gì đã xảy ra và lúc nào.
      console.warn('[Appium] Session dùng chung đã chết lúc rảnh — job sau sẽ dựng lại.');
      await disposeSharedAppiumSession();
    }
  }, KEEPALIVE_MS);

  // Đừng giữ tiến trình sống chỉ vì cái timer này.
  keepaliveTimer.unref?.();
}

/**
 * Khoá đảm bảo chỉ có MỘT lượt dựng session tại một thời điểm.
 *
 * Cần vì có hai nguồn cùng muốn dựng: hâm nóng lúc khởi động server, và job đầu
 * tiên. Chạy song song thì UiAutomator2 nhận hai lệnh tạo session trên cùng một
 * thiết bị — cái sau đá cái trước và cả hai cùng hỏng khó hiểu.
 *
 * ⚠️ Khoá này CHỈ được đặt bên trong khối dựng session của `init()`, tuyệt đối
 * không bao quanh cả `init()`. Bản đầu tiên (2026-08-17) đặt nó trong
 * `warmUpAppiumSession` bao quanh lời gọi `init()`, mà `init()` lại `await` chính
 * nó → **tự chờ chính mình, deadlock vĩnh viễn**. Job đứng im ở `processing`
 * không log thêm dòng nào, và chỉ lộ ra khi nhìn vào DB.
 */
let dangDungSession: Promise<void> | null = null;

/**
 * Hâm nóng session Appium ngay khi worker khởi động.
 *
 * Không giảm thời gian dựng session, mà chuyển nó RA KHỎI đường chờ của người
 * dùng: thay vì người đầu tiên trong ngày phải chờ thêm 10-15 giây, server tự trả
 * khoản đó lúc chưa ai yêu cầu gì.
 *
 * Không bao giờ ném lỗi: thiếu thiết bị hay Appium chưa chạy thì chỉ là mất phần
 * hâm nóng, job vẫn tự dựng session khi cần.
 */
export async function warmUpAppiumSession(): Promise<void> {
  if (automationEnv.AUTOMATION_MODE !== 'appium') return;
  if (!automationEnv.APPIUM_REUSE_SESSION) return;
  if (sharedDriver) return;

  try {
    const studio = new AppiumYoutubeStudio();
    studio.setJobId('khoi-dong');
    await studio.init();
    await studio.close(); // giữ session dùng chung, chỉ buông tham chiếu
    console.log('[Appium] ⚡ Đã hâm nóng session — job đầu tiên không phải chờ dựng.');
  } catch (err) {
    console.warn(
      `[Appium] Không hâm nóng được session (${
        err instanceof Error ? err.message.split('\n')[0] : String(err)
      }) — job đầu sẽ tự dựng.`,
    );
  }
}

export class AppiumYoutubeStudio {
  private driver: WebdriverIO.Browser | null = null;
  private screen: Screen | null = null;
  private deviceSerial = '';
  private jobId = 'manual';
  /** Tên bộ sưu tập đã thao tác — Phase 2 cần để mở đúng thẻ lấy link chia sẻ */
  private usedCollection = '';
  /** Tên sản phẩm vừa gắn — dùng để đối chiếu khi trích link affiliate ở bước sau */
  private addedProductName = '';

  /**
   * Sản phẩm người dùng gửi ĐÃ nằm sẵn trong bộ sưu tập từ trước.
   *
   * Không phải lỗi: người dùng muốn LINK, mà link đó đã tồn tại. Khi cờ này bật,
   * Phase 1 dừng lại không gắn gì thêm (bấm tiếp sẽ GỠ sản phẩm ra — §4.7), và
   * pipeline đi thẳng sang Phase 3 để trích link của chính sản phẩm đã có.
   */
  private daCoSanTrongBoSuuTap = false;

  /** Tên sản phẩm đã gắn (đọc bằng OCR lúc chọn). Rỗng nếu không đọc được. */
  getAddedProductName(): string {
    return this.addedProductName;
  }

  /** true = sản phẩm đã có sẵn trong bộ sưu tập, Phase 1 không gắn gì thêm */
  wasAlreadyInCollection(): boolean {
    return this.daCoSanTrongBoSuuTap;
  }

  /**
   * Khôi phục trạng thái để chạy thẳng Phase 2 mà không gắn lại sản phẩm.
   * Dùng khi BullMQ retry một job đã Đăng thành công ở lần chạy trước
   * (xem services/jobCheckpoint.ts).
   */
  resumeAfterPublish(collectionName: string, productName: string): void {
    this.usedCollection = collectionName;
    this.addedProductName = productName;
  }

  setJobId(jobId: string) {
    this.jobId = jobId;
    this.screen?.setJobId(jobId);
  }

  get ui(): Screen {
    if (!this.screen) throw new Error('Appium chưa khởi động. Gọi init() trước.');
    return this.screen;
  }

  private get drv(): WebdriverIO.Browser {
    if (!this.driver) throw new Error('Appium chưa khởi động. Gọi init() trước.');
    return this.driver;
  }

  /**
   * Gọi adb trên thiết bị của job này.
   *
   * Nhận MẢNG tham số, không phải chuỗi shell. Lý do đầy đủ ở đầu `adb.ts`; điểm
   * cần nhớ khi sửa: phần nào phải tới tay shell TRÊN MÁY như một chuỗi liền
   * (ví dụ cả cụm `am start ... -d '<url>' ...`) thì gom vào một phần tử mảng.
   */
  private adb(args: string[]): Promise<string> {
    return runAdbArgs(args, this.deviceSerial, 30000);
  }

  async init(deviceSerial?: string): Promise<void> {
    // Kiểm tra thiết bị TRƯỚC khi tạo session: máy rớt kết nối hoặc màn hình
    // khoá sẽ khiến mọi bước sau trượt một cách khó hiểu.
    const status = await preflightCheck(deviceSerial);
    this.deviceSerial = status.serial;
    console.log(`  → Thiết bị: ${this.deviceSerial}`);
    console.log(`  → Appium: ${automationEnv.APPIUM_HOST}:${automationEnv.APPIUM_PORT}`);

    if (automationEnv.APPIUM_REUSE_SESSION && sharedDriver && sharedSerial === this.deviceSerial) {
      try {
        // Gọi một lệnh rẻ để chắc session còn sống. Appium có thể đã tự đóng vì
        // newCommandTimeout, hoặc server đã restart giữa hai job.
        await sharedDriver.getWindowSize();
        this.driver = sharedDriver;
        console.log('  ⚡ Dùng lại session Appium đang có (bỏ ~10,5s khởi tạo)');
      } catch {
        console.log('  ℹ️ Session cũ không còn dùng được — tạo session mới');
        await disposeSharedAppiumSession();
      }
    }

    // Không có session trong RAM — thử NỐI LẠI session mà tiến trình trước để lại.
    //
    // Đây là đường đi sau mỗi lần khởi động lại tiến trình (ts-node-dev nạp lại
    // khi sửa file, crash, triển khai bản mới). Session vẫn sống nguyên trên
    // Appium server; dựng mới là trả 11-14 giây cho một thứ đang tồn tại.
    //
    // Bản ghi trong Redis chỉ là GỢI Ý: vẫn phải qua đúng chốt `getWindowSize()`
    // như đường tái dùng thường. Sai/cũ thì xoá rồi dựng mới như cũ.
    if (!this.driver && automationEnv.APPIUM_REUSE_SESSION) {
      const luu = await docSession();
      if (luu && luu.serial === this.deviceSerial) {
        try {
          const noiLai = await attach({
            sessionId: luu.sessionId,
            capabilities: luu.capabilities as WebdriverIO.Capabilities,
            requestedCapabilities: luu.capabilities as WebdriverIO.Capabilities,
            hostname: automationEnv.APPIUM_HOST,
            port: automationEnv.APPIUM_PORT,
            logLevel: 'warn',
          } as never);
          await noiLai.getWindowSize();
          this.driver = noiLai;
          sharedDriver = noiLai;
          sharedSerial = this.deviceSerial;
          startKeepalive();
          console.log('  ⚡ Nối lại session của tiến trình trước (bỏ ~11-14s dựng mới)');
        } catch {
          console.log('  ℹ️ Session của tiến trình trước đã chết — tạo session mới');
          await xoaSession();
        }
      }
    }

    // ── Bắt đầu từ trạng thái sạch ──────────────────────────────────────────
    //
    // `force-stop` + khởi động lại tốn 3,5 giây (đo thật 2026-08-17: mở màn Mua
    // sắm mất 3552 ms sau force-stop, so với 432 ms khi app đã ở sẵn đó). Nhưng
    // KHÔNG được bỏ nó một cách vô điều kiện: nguyên tắc §4.6 là mỗi job phải bắt
    // đầu từ trạng thái biết chắc, không phải trạng thái hy vọng.
    //
    // Nên ở đây KIỂM CHỨNG DƯƠNG TÍNH thay vì giả định: chỉ bỏ qua force-stop khi
    // đọc được cây a11y và thấy đúng chữ ký của màn Mua sắm sạch. Bất kỳ dấu hiệu
    // nào của sheet/menu còn mở, hoặc đọc không được, đều rơi về force-stop.
    //
    // Chi phí của phép kiểm là một lần đọc cây (~300 ms) để đổi lấy 3,5 giây.
    if (this.driver && (await this.dangOManMuaSamSach())) {
      console.log('  ⚡ App đang ở màn Mua sắm sạch — bỏ qua force-stop (bỏ ~3,1s)');
    } else {
      await this.adb(['shell', 'am', 'force-stop', YT_STUDIO_PKG]);
    }

    // Có ai khác đang dựng session thì chờ họ xong, rồi dùng lại kết quả của họ
    // thay vì dựng cái thứ hai. Khoá đặt Ở ĐÂY chứ không bao quanh init() — xem
    // ghi chú tại `dangDungSession`.
    while (!this.driver && dangDungSession) {
      await dangDungSession.catch(() => undefined);
      if (
        automationEnv.APPIUM_REUSE_SESSION &&
        sharedDriver &&
        sharedSerial === this.deviceSerial
      ) {
        this.driver = sharedDriver;
        console.log('  ⚡ Dùng session vừa được dựng xong bởi lượt khác');
      }
    }

    if (!this.driver) {
      let xong!: () => void;
      dangDungSession = new Promise<void>((r) => {
        xong = r;
      });

      try {
        this.driver = await metrics.time('appium-tao-session', () =>
          remote({
          hostname: automationEnv.APPIUM_HOST,
          port: automationEnv.APPIUM_PORT,
          logLevel: 'warn',
          capabilities: {
            platformName: 'Android',
            'appium:deviceName': this.deviceSerial,
            'appium:udid': this.deviceSerial,
            'appium:automationName': 'UiAutomator2',
            'appium:appPackage': YT_STUDIO_PKG,
            'appium:appActivity': YT_STUDIO_ACTIVITY,
            'appium:noReset': true,

            // Giữ session sống lâu hơn nhiều so với mặc định 300s.
            //
            // Session tái dùng tiết kiệm trọn ~4,4s, nhưng chỉ khi job sau tới
            // TRƯỚC khi Appium tự đóng session vì hết newCommandTimeout. Ở mức
            // 300s thì mọi job cách nhau quá 5 phút đều phải dựng lại từ đầu —
            // tức là gần như mọi job khi lưu lượng còn thấp, đúng giai đoạn hiện
            // nay. Nới lên 1 giờ để phần tiết kiệm đó là thật chứ không chỉ đúng
            // trên giấy.
            //
            // An toàn vì init() luôn kiểm tra session còn sống bằng getWindowSize()
            // trước khi dùng lại, và dựng session mới nếu nó đã chết.
            'appium:newCommandTimeout': 3600,

            // ── ĐÃ THỬ VÀ GỠ BỎ: skipDeviceInitialization + disableWindowAnimation
            //
            // Đo cô lập 2026-08-17 rất hấp dẫn — tạo session 9032ms → 4408ms:
            //   hiện tại                        9032ms
            //   + skipDeviceInitialization      5467ms
            //   + disableWindowAnimation        4408ms
            //
            // NHƯNG chạy luồng thật thì sinh ra hai kiểu lỗi chưa từng thấy:
            //   [chon-chinh-sua] tap 3 lần mà sheet không mở (a11y 52 lần/22,6s,
            //       chờ vòng lặp 41 lần/16,8s — bão retry, job 65,3s)
            //   [cho-ket-qua-tim-kiem-tho] chờ 20s không thấy kết quả tìm kiếm
            //
            // Giả thuyết: `skipDeviceInitialization` bỏ đúng bước Appium cài và
            // cấu hình app trợ giúp `io.appium.settings`, mà `disableWindowAnimation`
            // lại phải nhờ chính app đó mới tắt được animation. Hai cờ đánh nhau.
            //
            // Bài học lặp lại lần thứ N của dự án này: **đo cô lập một thao tác
            // KHÔNG chứng minh được nó an toàn trong luồng thật.** 4,6 giây tiết
            // kiệm không đáng đổi lấy một luồng chập chờn ở đúng bước mở sheet
            // chỉnh sửa — nơi thất bại nghĩa là job hỏng giữa chừng.
            //
            // Muốn thử lại: bật TỪNG cờ một, mỗi lần chạy tối thiểu 5 lượt dry-run
            // liên tiếp và đòi hỏi 5/5 thành công, chứ đừng đo mỗi thời gian.

            // Đừng để việc không đổi được `hidden_api_policy` giết cả session.
            //
            // Appium cố chạy `settings put/delete global hidden_api_policy*` ở đầu
            // và cuối mỗi session. Trên máy Xiaomi, lệnh đó cần quyền
            // WRITE_SECURE_SETTINGS, vốn đến từ tuỳ chọn nhà phát triển riêng
            // "Gỡ lỗi USB (Cài đặt bảo mật)" — và tuỳ chọn này TỰ TẮT sau mỗi lần
            // khởi động lại máy. Gặp thật 2026-08-17: mọi session chết ngay với
            //   `SecurityException: Permission denial, must have one of:
            //    [android.permission.WRITE_SECURE_SETTINGS]`
            // dù trước đó cùng ngày vẫn chạy bình thường.
            //
            // Cờ này bảo Appium bỏ qua lỗi đó. An toàn ở đây vì luồng không dùng
            // hidden API nào: ta chỉ đọc cây a11y, tap toạ độ và bắn intent.
            'appium:ignoreHiddenApiPolicyError': true,

            'appium:androidInstallTimeout': 180000,
            'appium:adbExecTimeout': 60000,
            'appium:adbExecPath': automationEnv.ADB_PATH,
            },
          } as any),
        );
        sharedDriver = this.driver;
        sharedSerial = this.deviceSerial;
        startKeepalive();

        // Ghi nhớ để lần KHỞI ĐỘNG LẠI TIẾN TRÌNH sau nối lại được thay vì dựng
        // mới (xem services/appiumSessionStore.ts). Không await: mất bản ghi chỉ
        // tốn 11 giây lần sau, không đáng để job hiện tại phải chờ Redis.
        void luuSession({
          sessionId: this.driver.sessionId,
          serial: this.deviceSerial,
          capabilities: this.driver.capabilities as Record<string, unknown>,
        });

        console.log('  ✅ Appium session khởi động thành công');
      } finally {
        // Nhả khoá dù thành công hay hỏng — kẹt khoá ở đây làm mọi job sau đứng im.
        dangDungSession = null;
        xong();
      }
    }

    await this.setIdleWait(FAST_IDLE_MS);
    this.screen = new Screen(this.driver, this.jobId, this.deviceSerial);
  }

  /**
   * Đặt mức "chờ app rảnh" của UiAutomator2 trước khi nó trả lời getPageSource.
   *
   * VÌ SAO ĐÁNG LÀM: đo thật `getPageSource` tốn **193 ms** khi màn hình đứng yên
   * nhưng **~520-650 ms** trong job. Chênh lệch đó KHÔNG phải chi phí dump XML mà
   * là quãng UiAutomator2 tự chờ app ngừng render. Với 27-36 lần gọi mỗi job, đây
   * là khoản đơn lẻ lớn nhất còn lại (18,7 s, 36% một job 51,6 s).
   *
   * VÌ SAO AN TOÀN Ở PHẦN LỚN CHỖ: mọi chỗ đọc cây đều nằm trong vòng chờ và sẽ
   * hỏi lại nếu chưa thấy. Đọc phải màn hình render dở chỉ làm lượt đó trượt, rồi
   * lượt sau bắt được — tức là đổi "chờ chắc chắn" lấy "hỏi nhiều lần, rẻ hơn".
   *
   * VÌ SAO KHÔNG AN TOÀN Ở MỘT CHỖ: `selectMatchingProduct` ĐẾM số nút
   * "Bỏ chọn sản phẩm" để thực thi chốt §4.7. Ở đó, đọc thiếu không làm lượt này
   * trượt rồi thử lại — nó cho ra một CON SỐ SAI mà code tin là đúng, và hậu quả
   * là cú tap gỡ sản phẩm khỏi bộ sưu tập thật lọt qua. Vì vậy chỗ đó phải khôi
   * phục mức chờ đầy đủ trước khi đọc (xem `readNodesReliably`).
   *
   * Đây cũng là lý do dùng SETTING (updateSettings, đặt sau khi session đã dựng)
   * chứ không phải capability: `skipDeviceInitialization`/`disableWindowAnimation`
   * đã làm luồng chập chờn hôm 2026-08-17 vì can thiệp vào bước khởi tạo thiết bị.
   * Setting không đụng tới bước đó.
   */
  private async setIdleWait(ms: number): Promise<void> {
    const nhanh = ms === FAST_IDLE_MS;
    try {
      await this.drv.updateSettings({
        waitForIdleTimeout: ms,

        // ── ignoreUnimportantViews: cắt cây a11y xuống còn phần thật sự cần ──
        //
        // Đo thật 2026-08-17 ở màn kết quả tìm sản phẩm:
        //   TẮT: 331 ms/lần, 59 KB, 22 nhãn
        //   BẬT: 115 ms/lần, 13 KB,  9 nhãn
        //
        // 13 nhãn biến mất ĐỀU thuộc màn hình NỀN phía sau sheet (`24/04`,
        // `SP 6M-8M`, `Mua sắm`, `Tạo bộ sưu tập`…) — chính phần rác rò vào cây.
        //
        // Nhưng "vắng ở màn A" KHÔNG kết luận được cho màn B, nên đã kiểm TỪNG
        // MÀN (7 màn của luồng), và mọi màn đều giữ đủ nhãn của chính nó:
        //   dải thẻ bộ sưu tập  11 → 11 nhãn, còn nguyên "24/04", "SP 6M-8M"…
        //   menu ngữ cảnh        1 →  1 nhãn, còn "Nút kéo"
        //   kết quả đã lọc      21 →  8 nhãn, còn "Chọn sản phẩm",
        //                             "Bỏ chọn sản phẩm", "Xoá người bán đã chọn"
        //
        // Nhãn cuối cùng là thứ nuôi chốt §4.7 — đã kiểm riêng bằng một link sản
        // phẩm ĐÃ nằm trong bộ sưu tập, và nó vẫn còn khi bật cờ.
        //
        // Vẫn TẮT ở đường đọc tin cậy (readNodesReliably) — xem ghi chú ở đó.
        ignoreUnimportantViews: nhanh,
      });
    } catch (err) {
      // Không chặn job: đây là tối ưu, hỏng thì chạy như cũ.
      console.warn(
        `  ⚠ Không đặt được waitForIdleTimeout=${ms}: ` +
          `${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      );
    }
  }

  /**
   * Chờ kết quả tìm kiếm, và NHẬN RA SỚM khi app báo không có gì.
   *
   * ── Vấn đề của cách chờ cũ ──────────────────────────────────────────────────
   * `waitFor(['Chọn sản phẩm'], 20-30s)` chỉ biết "chưa thấy", không biết "sẽ không
   * bao giờ thấy". Khi app đã hiện banner rỗng thì chờ thêm 20-30 giây là vô ích,
   * và cuối cùng người dùng nhận một thông báo kỹ thuật vô nghĩa với họ.
   *
   * ── Vì sao phải OCR ─────────────────────────────────────────────────────────
   * Hai banner rỗng đều VẼ CANVAS, không vào cây a11y (dò thật 2026-08-17):
   *
   *   "Không tìm thấy kết quả nào"
   *   "Sản phẩm không có trong chương trình tiếp thị liên kết của YouTube Shopping"
   *
   * Ở trạng thái thứ nhất, cây a11y chỉ còn 6 nhãn và KHÔNG có "Chọn sản phẩm" —
   * tức là không có cách nào biết bằng cây.
   *
   * ── Vì sao chỉ OCR MỘT LẦN, sau một nhịp ân hạn ─────────────────────────────
   * OCR đắt (~1-2 giây) nên không thể hỏi mỗi lượt. Nhưng banner rỗng khi đã hiện
   * thì không tự biến mất, nên hỏi một lần là đủ. Nhịp ân hạn để không kết luận
   * "rỗng" lúc app còn đang tải — đó là lỗi ngược lại, và tệ hơn.
   */
  private async waitForKetQuaTimKiem(stepName: string, timeoutMs: number): Promise<void> {
    const AN_HAN_MS = 4000;
    const batDau = Date.now();
    const deadline = batDau + timeoutMs;
    let daKiemRong = false;

    for (;;) {
      const nodes = await this.ui.nodes();
      const coKetQua = nodes.some(
        (n) =>
          n.clickable &&
          (hasExactLabel(n, LABEL_ADD_PRODUCT) || hasExactLabel(n, LABEL_REMOVE_PRODUCT)),
      );
      if (coKetQua) return;

      if (!daKiemRong && Date.now() - batDau >= AN_HAN_MS) {
        daKiemRong = true;
        const shot = await this.ui.snap(`ERROR_${stepName}_rong`);
        const lyDo = await this.docLyDoManHinhRong(shot);
        if (lyDo) {
          console.error(`  [chi tiết] app báo màn hình rỗng ở bước ${stepName}. Ảnh: ${shot}`);
          throw new LoiDauVao(lyDo);
        }
      }

      if (Date.now() >= deadline) {
        const shot = await this.ui.snap(`ERROR_wait_${stepName}`);
        const visible = await this.ui.describeScreen();
        throw new Error(
          `[${stepName}] Chờ ${timeoutMs / 1000}s vẫn không thấy kết quả tìm kiếm.\n` +
            `  Ảnh: ${shot}\n  Nội dung đọc được: ${visible}`,
        );
      }

      await pollSleep(400);
    }
  }

  /**
   * Đọc banner "màn hình rỗng" và dịch sang câu người dùng hiểu được.
   * Trả null nếu không nhận ra banner nào — khi đó nơi gọi cứ chờ tiếp như cũ.
   *
   * Trả null cả khi OCR hỏng: thà chờ thêm rồi báo lỗi chung còn hơn khẳng định
   * sai một lý do cụ thể cho người dùng (§10.7).
   */
  private async docLyDoManHinhRong(shotPath: string): Promise<string | null> {
    try {
      const ocr = await readScreen(shotPath);
      const toanVan = normalizeText(ocr.lines.map((l) => l.text).join(' '));

      if (toanVan.includes(normalizeText('không tìm thấy kết quả nào'))) {
        return (
          'Sản phẩm này không nằm trong diện được nhận voucher — YouTube Shopping ' +
          'không tìm thấy nó. Hãy thử một sản phẩm Shopee khác.'
        );
      }

      if (
        toanVan.includes(normalizeText('không có trong chương trình')) ||
        toanVan.includes(normalizeText('chương trình tiếp thị liên kết'))
      ) {
        return (
          'Sản phẩm này không có trong chương trình tiếp thị liên kết của YouTube Shopping, ' +
          'nên không áp được voucher. Hãy thử một sản phẩm Shopee khác.'
        );
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Màn hình có đang hiện thông báo "sản phẩm không có trong chương trình tiếp thị
   * liên kết" không? Đọc bằng OCR vì dòng này vẽ canvas, không vào cây a11y.
   *
   * So khớp trên chuỗi đã GHÉP LẠI của mọi dòng OCR: app xuống dòng giữa câu
   * ("...chương trình tiếp" / "thị liên kết của YouTube Shopping"), nên tìm theo
   * từng dòng riêng lẻ sẽ trượt.
   *
   * Trả false khi OCR hỏng — thà báo thông báo chung chung còn hơn khẳng định sai
   * một lý do cụ thể cho người dùng (§10.7).
   */
  private async manHinhBaoKhongCoTiepThiLienKet(shotPath: string): Promise<boolean> {
    try {
      const ocr = await readScreen(shotPath);
      const toanVan = normalizeText(ocr.lines.map((l) => l.text).join(' '));
      return (
        toanVan.includes(normalizeText('không có trong chương trình')) ||
        toanVan.includes(normalizeText('chương trình tiếp thị liên kết'))
      );
    } catch {
      return false;
    }
  }

  /**
   * App có đang ở màn Mua sắm SẠCH không (không sheet, không menu đang mở)?
   *
   * Dùng để quyết định có bỏ qua `force-stop` đầu job hay không. Đây là phép kiểm
   * chứng DƯƠNG TÍNH, không phải giả định: phải thấy đúng chữ ký mong đợi mới trả
   * true; đọc không được, hoặc thấy bất kỳ dấu hiệu nào của sheet/menu, đều trả
   * false để nơi gọi force-stop như cũ.
   *
   * Các nhãn "bẩn" lấy từ dump thật (CLAUDE.md §8):
   *   "Nút kéo"               — thanh kéo của MỌI bottom sheet (menu ngữ cảnh,
   *                             sheet chỉnh sửa, sheet thêm sản phẩm)
   *   "Chỉnh sửa bộ sưu tập"  — sheet chỉnh sửa
   *   "Tìm sản phẩm" / "Xong" — sheet thêm sản phẩm
   *
   * `"Nút kéo"` một mình đã đủ bắt cả ba loại sheet, nhưng liệt kê thêm cho chắc:
   * chi phí bằng không vì cùng một lần đọc cây.
   */
  private async dangOManMuaSamSach(): Promise<boolean> {
    const BAN = ['Nút kéo', 'Chỉnh sửa bộ sưu tập', 'Tìm sản phẩm', 'Xong', 'Thêm sản phẩm'];
    try {
      // Đọc thẳng từ driver chứ không qua `this.ui`: lớp Screen chỉ được tạo ở
      // cuối init(), mà phép kiểm này phải chạy TRƯỚC lúc quyết định force-stop.
      const nodes = parseNodes(await this.drv.getPageSource());
      const nhan = nodes.map((n) => normalizeText(n.text || n.desc)).filter(Boolean);

      const coMuaSam = nhan.some((x) => x === normalizeText('Mua sắm'));
      if (!coMuaSam) return false;

      const banNao = BAN.find((b) => nhan.some((x) => x === normalizeText(b)));
      if (banNao) {
        console.log(`  ℹ️ Màn hình còn "${banNao}" từ lần chạy trước — force-stop cho sạch.`);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Vân tay danh sách kết quả: toạ độ y của mọi nút chọn/bỏ chọn, đã sắp xếp */
  private resultFingerprint(nodes: UiNode[]): string {
    return nodes
      .filter(
        (n) =>
          n.clickable &&
          (hasExactLabel(n, LABEL_ADD_PRODUCT) || hasExactLabel(n, LABEL_REMOVE_PRODUCT)),
      )
      .map((n) => n.bounds.y1)
      .sort((a, b) => a - b)
      .join(',');
  }

  /**
   * Đọc danh sách kết quả khi nó đã ĐỨNG YÊN — dùng cho chỗ đếm nút của chốt §4.7.
   *
   * ── Vì sao không dùng "chờ app rảnh" nữa ─────────────────────────────────────
   * Bản trước đặt `waitForIdleTimeout = 10000` rồi đọc một lần. Ngay sau khi áp bộ
   * lọc Shopee, app đang tải kết quả mới nên UiAutomator2 chờ tới 10 giây cho app
   * rảnh — đó là quãng màn hình đứng hình mà người dùng nhìn thấy.
   *
   * ── Vì sao cách mới CHẶT HƠN chứ không chỉ nhanh hơn ─────────────────────────
   * "App rảnh trong X ms" là bằng chứng gián tiếp và có thể sai cả hai chiều: app
   * bận vì lý do khác thì ta chờ oan, còn app rảnh giữa hai đợt render thì ta đọc
   * phải danh sách dở dang. Hai lần đọc liên tiếp cho cùng một vân tay là bằng
   * chứng TRỰC TIẾP rằng danh sách đã render xong — đúng kỹ thuật đã dùng cho dải
   * thẻ bộ sưu tập, nơi nó sửa được lỗi tap trượt vì toạ độ đọc lúc còn trôi.
   *
   * Vẫn TẮT `ignoreUnimportantViews` (qua SAFE_IDLE_MS) ở đây: đã kiểm chứng cờ đó
   * không nuốt nhãn "Bỏ chọn sản phẩm", nhưng một lần đọc đầy đủ mỗi job là cái giá
   * rẻ để lớp bảo vệ quan trọng nhất không phụ thuộc vào một cờ tối ưu.
   *
   * Hết giờ vẫn TRẢ VỀ những gì đọc được thay vì ném lỗi: nơi gọi có đủ thông tin
   * để phán xét (không có kết quả? đã có sẵn? chỉ có kết quả tương tự?) và ném ra
   * thông báo đúng bản chất, còn ném ở đây chỉ làm mất thông tin đó.
   */
  private async readNodesReliably(timeoutMs = 8000): Promise<UiNode[]> {
    await this.setIdleWait(SAFE_IDLE_MS);
    try {
      const deadline = Date.now() + timeoutMs;
      let truoc: string | null = null;
      let nodes = await this.ui.nodes();

      for (;;) {
        const vanTay = this.resultFingerprint(nodes);
        // Chỉ coi là ổn định khi danh sách KHÔNG rỗng: rỗng có thể là "chưa render
        // xong" chứ chưa chắc là "không có kết quả", và phân biệt hai thứ đó là
        // việc của nơi gọi sau khi đã chờ đủ.
        if (vanTay !== '' && vanTay === truoc) return nodes;
        if (Date.now() >= deadline) return nodes;
        truoc = vanTay;
        await pollSleep(300);
        nodes = await this.ui.nodes();
      }
    } finally {
      await this.setIdleWait(FAST_IDLE_MS);
    }
  }

  /** Mở thẳng màn Mua sắm bằng deep link — bỏ qua 2 bước điều hướng dễ gãy */
  async openShoppingScreen(): Promise<void> {
    const channelId = automationEnv.YT_CHANNEL_ID;
    if (!channelId) {
      throw new Error('Thiếu YT_CHANNEL_ID trong cấu hình — cần để mở deep link Mua sắm');
    }

    await this.adb([
      'shell',
      // Cả cụm này là MỘT tham số: adb chuyển nguyên văn cho shell trên máy, và
      // dấu nháy đơn quanh URL là để shell đó không cắt chuỗi ở ký tự đặc biệt.
      `am start -a android.intent.action.VIEW ` +
        `-d 'https://studio.youtube.com/channel/${channelId}/monetization/shopping' ` +
        `-p ${YT_STUDIO_PKG}`,
    ]);
    // ĐÍNH CHÍNH 2026-08-17 — ghi chú cũ ở đây dựa trên một tiền đề SAI.
    //
    // Bản trước giữ `delay(3000)` với lý do: "nhãn 'Mua sắm' có mặt ở cả thanh
    // điều hướng dưới nên waitFor có thể khớp trên màn CŨ". Dump thật hai đầu
    // (logs/ui-dumps/waits) cho thấy điều đó không đúng:
    //
    //   A. trước deep link (màn mặc định sau khi mở app): Tạo | Thông báo | Tài khoản
    //   B. sau deep link  (màn Mua sắm)                 : Di chuyển lên | Mua sắm |
    //                                                     Tự động gắn thẻ cho sản phẩm...
    //
    // Thanh điều hướng dưới KHÔNG chứa "Mua sắm". Nhãn này vắng mặt trước thao
    // tác và có mặt sau — thoả đúng §4.6, nên `waitFor` ngay dưới đủ sức đảm bảo
    // đã sang màn mới, không cần đệm 3 giây.
    //
    // Vì sao lần thử 2026-08-16 đo được "0 giây": lúc đó `waitFor` hỏi lại mỗi
    // 1500 ms và mỗi lượt còn kèm OCR, nên bỏ chờ cứng cũng chẳng nhanh hơn. Nay
    // vòng chờ là tree-only nhịp 400 ms nên phần tiết kiệm mới hiện ra.
    //
    // ĐO LẠI 2026-08-17 — và kết quả là GIỮ quãng chờ này, chỉ hạ nhẹ.
    //
    // Thử bỏ hẳn (còn 300ms) rồi để vòng chờ thẻ bộ sưu tập tự lo: 5/5 lượt vẫn
    // đúng, nhưng tổng thời gian KHÔNG giảm — trung bình 50,3s so với 49,4s, tức
    // là hơi tệ hơn. Lý do: dải thẻ thật sự cần ~3 giây để vẽ xong, nên 3 giây kia
    // quay lại nguyên vẹn dưới dạng các lượt hỏi trong vòng chờ, mà mỗi lượt hỏi
    // còn tốn thêm một lần đọc cây a11y (~380ms) mà một quãng ngủ thì không.
    //
    // Bài học: **chờ cứng không phải lúc nào cũng lãng phí.** Khi thời gian cần
    // chờ là ổn định và đã biết, ngủ đúng chừng ấy RẺ HƠN hỏi liên tục. Chờ theo
    // điều kiện thắng khi thời gian chờ *biến động* hoặc *chưa biết* — không phải
    // luôn luôn.
    //
    // Hạ 3000 → 2500 vì phần đuôi đã có vòng chờ thẻ ở bước sau lo nốt, an toàn.
    //
    // ĐÃ THỬ NÂNG LÊN 4500 VÀ BỎ (2026-08-17). Giả thuyết: dải thẻ cần ~10-11 giây
    // kể từ deep link, mà vòng chờ phía sau đang chạy 10-11 lượt × ~870 ms (500 ms
    // ngủ + một lần đọc cây a11y), nên ngủ thẳng sẽ rẻ hơn — đúng bài học lever 2.
    //
    // Đo thật 3 lượt mỗi bên: tổng 47,7 s (2500) so với 47,1 s (4500) — nằm trong
    // nhiễu, mà `delay-cung` lại TĂNG 8,3 → 10,3 s. Mấu chốt: ngủ thêm 2 giây mà
    // SỐ LƯỢT HỎI KHÔNG GIẢM (11 → 10-11).
    //
    // Suy ra thời điểm thẻ sẵn sàng KHÔNG phụ thuộc thời gian trôi từ deep link.
    // Nghi do lever 1: `waitForIdleTimeout=100` khiến getPageSource trả về cây
    // đang render dở thay vì chờ app rảnh, nên vòng chờ phải hỏi nhiều lượt hơn —
    // một tương tác giữa hai tối ưu, không phải tính chất của app. Ai muốn đụng vào
    // vòng chờ này nên bắt đầu từ đó, đừng chỉnh con số ngủ.
    await delay(2500);
    // treeOnly: "Mua sắm" có trong cây a11y (dump flow_01_shopping và B_sau_deeplink),
    // và VẮNG MẶT ở màn trước đó (dump A_truoc_deeplink) — thoả §4.6.
    await this.ui.waitFor(['Mua sắm'], 'mo-man-mua-sam', 40000, { treeOnly: true });
  }

  /**
   * Tìm dải thẻ bộ sưu tập trên màn Mua sắm.
   * Khác với hầu hết màn hình khác, các thẻ này CÓ nhãn trong accessibility tree,
   * nên chọn được theo tên thay vì đoán vị trí.
   */
  private findCollectionCards(nodes: UiNode[]): UiNode[] {
    const candidates = nodes.filter(
      (n) =>
        n.clickable &&
        n.desc &&
        n.bounds.y1 > 300 &&
        n.bounds.y2 < 2200 &&
        !NOT_A_COLLECTION.some((bad) => normalizeText(bad) === normalizeText(n.desc)),
    );
    if (candidates.length === 0) return [];

    // Thẻ cùng một dải carousel có cùng toạ độ y — lấy dải đông thẻ nhất
    const byRow = new Map<number, UiNode[]>();
    for (const c of candidates) {
      const row = byRow.get(c.bounds.y1) ?? [];
      row.push(c);
      byRow.set(c.bounds.y1, row);
    }
    const widest = [...byRow.values()].sort((a, b) => b.length - a.length)[0];
    return widest.length >= 2 ? widest.sort((a, b) => a.bounds.x1 - b.bounds.x1) : [];
  }

  /** Cuộn màn Mua sắm tới khi thấy dải bộ sưu tập, rồi mở menu của thẻ mục tiêu */
  async openCollectionMenu(collectionName?: string): Promise<string> {
    let cards: UiNode[] = [];

    // ── DẢI THẺ NẰM DƯỚI MÀN HÌNH ĐẦU TIÊN — BẮT BUỘC PHẢI CUỘN ────────────────
    //
    // Bằng chứng (dump thật, logs/ui-dumps):
    //   flow_01_shopping          : Di chuyển lên | Mua sắm | Tự động gắn thẻ…
    //   flow_02_shopping_scrolled : … | 24/04 | SP 6M-8M | SP 5M-6M | SP 4M-5M | …
    //
    // Thẻ KHÔNG phải "chưa render" mà là "ngoài tầm nhìn". Phân biệt hai thứ đó là
    // mấu chốt, và nhầm chúng đã gây một lỗi tốn 6 giây MỖI JOB:
    //
    // Bản 2026-08-17 (lever 2) tách làm hai giai đoạn — "chờ render, tuyệt đối chưa
    // cuộn" rồi mới "cuộn đi tìm" — vì tưởng thẻ chỉ chưa vẽ xong. Nhưng giai đoạn
    // chờ đó KHÔNG BAO GIỜ có thể thành công: thẻ nằm ngoài màn, chờ bao lâu cũng
    // vô ích. Nó đốt trọn 6 giây deadline ở mọi job rồi mới cuộn. Đó chính là
    // `delay-cung` 11 lần / 8,3 s trong bảng chi phí.
    //
    // Điều kiện dừng vẫn phải là "thấy ĐÚNG thẻ cần tìm", không phải "thấy thẻ nào
    // đó": lô 9 job cho thấy dải thẻ render DẦN sau khi cuộn, có thời điểm đã có
    // 2-3 thẻ mà thẻ mục tiêu chưa hiện → 2/9 job hỏng.
    //
    // Còn nỗi lo "cuộn khi màn chưa sẵn sàng" thì đã được lo ở chỗ khác: `delay(2500)`
    // + `waitFor(['Mua sắm'])` ngay trước khi vào hàm này đảm bảo màn Mua sắm đã hiện.
    const wantsName = collectionName ? normalizeText(collectionName) : null;
    const daThayMucTieu = (found: UiNode[]): boolean =>
      found.length > 0 &&
      (!wantsName || found.some((c) => normalizeText(c.desc).includes(wantsName)));

    /**
     * Toạ độ thẻ chỉ dùng được khi danh sách đã ĐỨNG YÊN.
     *
     * Sau `scrollDown` danh sách còn trôi theo quán tính, nên toạ độ đọc lúc đó đã
     * cũ vào thời điểm tap — cú tap rơi vào khoảng trống và menu ngữ cảnh không mở.
     * Gặp thật 2026-08-17: bỏ quãng chờ sau cuộn làm 3/4 lượt hỏng ở bước 3, có
     * lượt còn đọc thiếu thẻ ("24/04", "SP 6M-8M") vì đọc giữa lúc đang trôi.
     *
     * Đòi hỏi hai lần đọc liên tiếp cho cùng một toạ độ y: đó là bằng chứng trực
     * tiếp rằng danh sách đã dừng, thay vì đoán bằng một quãng ngủ cố định.
     */
    const doiThayOnDinh = async (): Promise<UiNode[] | null> => {
      const lan1 = this.findCollectionCards(await this.ui.nodes());
      if (!daThayMucTieu(lan1)) return null;
      await delay(250);
      const lan2 = this.findCollectionCards(await this.ui.nodes());
      if (!daThayMucTieu(lan2)) return null;

      const y1 = lan1.find((c) => !wantsName || normalizeText(c.desc).includes(wantsName))!.bounds.y1;
      const y2 = lan2.find((c) => !wantsName || normalizeText(c.desc).includes(wantsName))!.bounds.y1;
      return y1 === y2 ? lan2 : null;
    };

    // Mỗi vòng: chờ thẻ mục tiêu xuất hiện VÀ đứng yên; không thấy thì cuộn tiếp.
    //
    // Lượt 0 chờ ngắn vì nó chỉ để bắt trường hợp màn hình tình cờ đã ở đúng chỗ;
    // các lượt sau cần thời gian cho cú cuộn dừng lại rồi thẻ mới render.
    const MAX_SCROLLS = 8;
    for (let i = 0; i <= MAX_SCROLLS; i++) {
      const deadline = Date.now() + (i === 0 ? 600 : 3500);
      for (;;) {
        const onDinh = await doiThayOnDinh();
        if (onDinh) {
          cards = onDinh;
          break;
        }
        if (Date.now() >= deadline) break;
        await delay(300);
      }
      if (daThayMucTieu(cards)) break;
      if (i < MAX_SCROLLS) {
        await this.ui.scrollDown();
        // Cho quán tính cuộn tắt bớt trước lượt đọc đầu tiên — rẻ hơn là đọc rồi
        // phát hiện chưa ổn định và phải đọc lại.
        await delay(700);
      }
    }

    if (cards.length === 0) {
      const shot = await this.ui.snap('ERROR_khong-thay-bo-suu-tap');
      throw new Error(`Không tìm thấy bộ sưu tập nào trên màn Mua sắm. Ảnh: ${shot}`);
    }

    const names = cards.map((c) => c.desc);
    console.log(`  Bộ sưu tập hiện có: ${names.map((n) => `"${n}"`).join(', ')}`);

    const target = collectionName
      ? cards.find((c) => normalizeText(c.desc).includes(normalizeText(collectionName)))
      : cards[0];
    if (!target) {
      throw new Error(
        `Không thấy bộ sưu tập tên "${collectionName}". Hiện có: ${names.join(', ')}`,
      );
    }

    console.log(`  → Mở bộ sưu tập "${target.desc}"`);
    const c = centerOf(target);
    await tapAt(this.drv, c.x, c.y);
    // Không chờ cứng: cả hai nơi gọi hàm này đều waitFor ngay sau đó cho mục
    // menu ngữ cảnh ("Chỉnh sửa" ở Phase 1, "Chia sẻ" ở Phase 2). Hai nhãn đó
    // KHÔNG có trên màn Mua sắm trước khi tap, nên không thể khớp nhầm màn cũ.
    return target.desc;
  }

  /**
   * PHASE 1: gắn sản phẩm Shopee vào bộ sưu tập.
   * Trả về tên bộ sưu tập đã dùng.
   */
  async addProductToCollection(
    shopeeUrl: string,
    options: AddProductOptions = {},
  ): Promise<string> {
    const { collectionName, dryRun = false } = options;
    console.log('\n  ═══ PHASE 1: GẮN SẢN PHẨM VÀO BỘ SƯU TẬP ═══');

    console.log('  [1/9] Mở màn Mua sắm (deep link)...');
    await this.openShoppingScreen();
    await this.ui.snapStep('01_shopping');

    console.log('  [2/9] Chọn bộ sưu tập...');
    this.usedCollection = await this.openCollectionMenu(collectionName);
    await this.ui.snapStep('02_context_menu');

    console.log('  [3/9] Menu ngữ cảnh → "Chỉnh sửa"...');
    // Chờ menu bung ra bằng nhãn a11y DUY NHẤT mà nó có, thay vì OCR tìm "Chỉnh sửa".
    //
    // Dump `flow_04_context_menu.xml`: cả menu chỉ có ĐÚNG MỘT nhãn a11y là
    // "Nút kéo" (thanh kéo của bottom sheet) — mọi mục menu đều vẽ canvas. Còn màn
    // Mua sắm ngay trước đó KHÔNG có nhãn này (dump `B_sau_deeplink`:
    // `Di chuyển lên | Mua sắm | Tự động gắn thẻ…`). Vắng mặt trước, có mặt sau —
    // đúng yêu cầu §4.6, và tra được bằng cây nên không tốn ảnh chụp lẫn OCR.
    //
    // Trước đây chỗ này chờ nhãn "Chỉnh sửa" qua find(), tức là MỖI LƯỢT hỏi đều
    // chụp ảnh + OCR ở nhịp 1500ms, chỉ để biết một điều mà cây a11y trả lời được
    // trong ~380ms. Phần OCR vẫn còn ở cú TAP ngay dưới (bắt buộc, vì mục menu là
    // canvas) — cái cắt được ở đây là phần CHỜ.
    await this.ui.waitFor(['Nút kéo'], 'cho-menu-ngu-canh', 15000, { treeOnly: true });
    // Dùng nhãn DÀI "Chỉnh sửa bộ sưu tập" chứ không phải "Chỉnh sửa": so khớp là
    // "node chứa nhãn cần tìm", nên mục menu ngắn "Chỉnh sửa" không thể khớp chuỗi
    // dài này — tránh lặp lại lỗi §4.6 (chờ một dấu hiệu đã có sẵn từ trước khi tap).
    //
    // KHÔNG bật useRememberedPoint ở đây: đây chính là menu có "Xoá" nằm cạnh
    // "Chỉnh sửa", mà xác minh sau khi tap không hoàn tác được một lần xoá.
    //
    // ĐÍNH CHÍNH 2026-08-17: bản trước ghi "mục menu vốn có nhãn trong cây a11y
    // nên cũng chẳng tốn OCR" — SAI. Dump `flow_04_context_menu.xml` cho thấy cả
    // menu ngữ cảnh chỉ có ĐÚNG MỘT nhãn trong cây a11y là "Nút kéo"; toàn bộ
    // "Chỉnh sửa"/"Chia sẻ"/"Xoá" đều vẽ bằng canvas. Nghĩa là bước này BẮT BUỘC
    // tốn OCR, và nó là khoản OCR đắt nhất còn lại của luồng. Đừng "tối ưu" nó
    // bằng cách chuyển sang tree-only — sẽ không bao giờ khớp.
    await this.ui.tapUntilVisible(
      ['Chỉnh sửa'],
      ['Chỉnh sửa bộ sưu tập'],
      'chon-chinh-sua',
      { guardInTreeOnly: true },
    );
    await this.ui.snapStep('03_collection_edit');
    metrics.mark('mo-sheet-chinh-sua');

    console.log('  [4/9] Tap "Thêm" để mở sheet thêm sản phẩm...');
    // Dấu hiệu xác minh phải là thứ CHỈ có trên sheet "Thêm sản phẩm": ô tìm kiếm
    // và bộ lọc người bán. Tuyệt đối không dùng nhãn "Thêm sản phẩm" — chính nút
    // vừa bấm mang nhãn đó, nên chờ nó là tự đánh lừa mình (xem tapUntilVisible).
    //
    // guardInTreeOnly: đã chứng minh bằng dump a11y hai đầu (2026-08-17):
    //   flow_05_collection_edit (TRƯỚC khi tap): KHÔNG có "Tìm sản phẩm"
    //   flow_06_add_product     (SAU khi tap):   CÓ "Tìm sản phẩm"
    // Nên nhãn này vừa thoả yêu cầu §4.6 (vắng mặt trước thao tác) vừa tra được
    // bằng cây a11y. Trước đây lớp chặn này chạy qua find() nên MỌI job đều trả
    // giá một lần chụp ảnh + một lần OCR (~1,6s) chỉ để nhận về đúng cái kết quả
    // "chưa có" đã biết trước — xem mục "Còn lại" trong CLAUDE.md §8.
    // Lưu ý: "Người bán" KHÔNG có trong cây a11y ở trạng thái này, nên nó chỉ còn
    // giá trị làm nhãn dự phòng khi tra bằng OCR, không dùng cho tree-only.

    // ── §4.10: chờ ĐÚNG nút mà bước này sẽ chạm, không tin dấu hiệu của bước trước ──
    //
    // Bước [3/9] xác minh sheet đã mở bằng nhãn "Chỉnh sửa bộ sưu tập" — đó là
    // TIÊU ĐỀ sheet, hiện ngay khi sheet bắt đầu bung ra. Nhưng nút "＋ Thêm" nằm
    // DƯỚI danh sách sản phẩm của bộ sưu tập, nên nó render sau, đôi khi sau khá lâu.
    //
    // Khe hở đó có sẵn từ lâu nhưng chỉ mới nổ ngày 2026-08-19, khi bộ sưu tập
    // tăng từ 3 lên 6 sản phẩm: danh sách dài hơn thì phần dưới render muộn hơn.
    // Quan sát thật — ảnh lỗi cho thấy sheet ĐANG hiện đủ, và cây a11y lúc báo lỗi
    // CÓ nhãn "Thêm sản phẩm"; nó chỉ chưa có vào đúng mili-giây mà find() hỏi.
    //
    // Đây chính là mô-típ §4.10 lặp lại, chỉ khác nút: lần đó là "Đăng" sau khi
    // bấm "Xong", lần này là "＋ Thêm" sau khi mở sheet chỉnh sửa. Cùng một bài
    // học: **trên giao diện render dần, "tương đương về mặt logic" không có nghĩa
    // là "sẵn sàng cùng lúc".**
    //
    // Không ném lỗi khi hết giờ: `seenWithin` chỉ trả boolean. Hết 10 giây mà chưa
    // thấy thì vẫn đi tiếp và để `tapUntilVisible` xử lý như cũ — thêm một đường
    // hỏng mới ở đây sẽ tệ hơn chính lỗi đang sửa.
    await this.ui.seenWithin(['Thêm sản phẩm'], 10000, { treeOnly: true });

    // Tìm theo nhãn ĐẦY ĐỦ trước, rồi mới lui về "Thêm".
    //
    // `content-desc` thật của nút là "Thêm sản phẩm" (xác nhận bằng dump, §4.6),
    // nên nhãn dài khớp CHÍNH XÁC và không thể trúng liên kết mồi "Tìm hiểu thêm".
    // Giữ "Thêm" làm nhãn thứ hai vì OCR đọc nút đó ra chữ "Thêm" (ảnh lỗi:
    // `Sản phẩm -L- Thêm`), tức đường lui OCR vẫn cần nó.
    await this.ui.tapUntilVisible(
      ['Thêm sản phẩm', 'Thêm'],
      ['Tìm sản phẩm'],
      'mo-them-san-pham',
      { guardInTreeOnly: true },
    );
    await this.ui.snapStep('04_add_product_sheet');

    console.log(`  [5/9] Dán link Shopee: ${shopeeUrl}`);
    // Chỉ đích danh ô tìm kiếm. Lấy "ô nhập đầu tiên" sẽ trúng ô Tiêu đề của
    // sheet chỉnh sửa nằm bên dưới và ghi đè tên bộ sưu tập của người dùng.
    await this.ui.typeIntoLabeledInput(['Tìm sản phẩm'], shopeeUrl, 'dan-link-shopee');

    // Chờ tới khi chữ vừa gõ THỰC SỰ vào cây a11y, thay vì chờ cứng 1200ms.
    //
    // Trần vẫn đúng 1200ms như bản cũ và KHÔNG ném lỗi khi hết giờ, nên thay đổi
    // này chỉ có thể nhanh hơn hoặc bằng — không thêm đường hỏng nào. Đây là cách
    // xử lý khi CHƯA có dump chứng minh dấu hiệu: đặt nó làm đường tắt, giữ nguyên
    // hành vi cũ làm đường lui, thay vì đoán một con số nhỏ hơn rồi hy vọng.
    //
    // Dùng đuôi URL làm dấu hiệu: ô tìm kiếm hiển thị nguyên link, và phần đuôi
    // (`-i.<seller>.<product>`) là duy nhất nên không đụng nhãn nào khác trên màn.
    const urlTail = shopeeUrl.split('/').pop()?.split('?')[0] ?? '';
    if (urlTail.length >= 8) {
      await this.ui.seenWithin([urlTail], 1200, { treeOnly: true });
    } else {
      await delay(1200);
    }

    await this.drv.pressKeyCode(66); // Enter — gửi tìm kiếm

    // Chờ kết quả tìm kiếm render xong thay vì chờ cứng 4 giây.
    //
    // "Chọn sản phẩm" là nhãn của nút "+" trên mỗi thẻ kết quả và CÓ trong cây
    // a11y (xác nhận bằng dump ở CLAUDE.md §8), nên không tốn OCR. Nó vắng mặt
    // trước khi bấm Enter vì lúc đó chưa có thẻ kết quả nào — đúng yêu cầu §4.6
    // về dấu hiệu xác minh. Kết quả lúc này chưa lọc người bán, gồm cả hàng của
    // sàn khác; việc lọc là bước ngay sau.
    //
    // ⚠️ Điều kiện "vắng mặt trước khi bấm Enter" CHỈ ĐÚNG với thứ tự hiện tại
    // (gõ trước, lọc sau). Đã thử đảo thứ tự (lọc trước) và phải bỏ — xem §8.
    //
    // Dùng `waitForKetQuaTimKiem` chứ không phải `waitFor` thuần: nó nhận ra banner
    // "Không tìm thấy kết quả nào" (vẽ canvas) và dừng ngay thay vì chờ hết 20 giây
    // rồi ném lỗi kỹ thuật.
    await this.waitForKetQuaTimKiem('cho-ket-qua-tim-kiem-tho', 20000);
    await this.ui.snapStep('05_link_entered');
    metrics.mark('dan-link-va-tim');

    // Chỉ dán link là chưa đủ — phải lọc người bán Shopee thì sản phẩm mới hiện
    console.log('  [6/9] Lọc "Người bán" → "Shopee"...');
    await this.applySellerFilter();
    await this.ui.snapStep('06_seller_filtered');
    metrics.mark('loc-nguoi-ban-shopee');

    console.log('  [7/9] Chọn sản phẩm khớp...');
    await this.selectMatchingProduct(shopeeUrl);

    // Sản phẩm đã nằm sẵn trong bộ sưu tập → không có gì để gắn, cũng không được
    // bấm "Xong"/"Đăng" (không thay đổi gì thì đăng lại là thao tác thừa lên dữ
    // liệu thật). Dừng Phase 1 tại đây, Phase 3 sẽ trích link của chính nó.
    if (this.daCoSanTrongBoSuuTap) {
      metrics.mark('chon-san-pham');
      console.log('  ⏭  Bỏ qua bước "Xong"/"Đăng" — bộ sưu tập không đổi.');
      return this.usedCollection;
    }

    await this.ui.snapStep('07_product_selected');
    // Mốc riêng: trước đây bước này không có mốc nên thời gian của nó bị gộp vào
    // `tap-xong`, che mất quãng đứng hình 10 giây của lần đọc chờ-app-rảnh.
    metrics.mark('chon-san-pham');

    console.log('  [8/9] Tap "Xong"...');
    // Dấu hiệu này đã được KIỂM CHỨNG bằng dump cây a11y hai đầu (2026-08-16):
    //   trước khi tap: [Nút kéo | Thêm sản phẩm | Quay lại | ... | Xong]
    //   sau khi tap:   [Nút kéo | Chỉnh sửa bộ sưu tập | Đóng | ... | Đăng]
    // Toàn bộ nhãn của sheet chỉnh sửa vắng mặt trước khi tap — sheet nằm dưới
    // KHÔNG rò vào cây a11y khi sheet thêm sản phẩm đang mở. Nên vừa dùng được
    // làm dấu hiệu, vừa tra được bằng cây a11y mà không cần OCR.
    //
    // ── VÌ SAO CHỜ "Đăng" CHỨ KHÔNG PHẢI "Chỉnh sửa bộ sưu tập" (2026-08-17) ──
    //
    // Cả hai đều chứng minh sheet thêm sản phẩm đã đóng. Nhưng chúng KHÔNG xuất
    // hiện cùng lúc: "Chỉnh sửa bộ sưu tập" là tiêu đề, hiện ngay khi sheet bắt
    // đầu bung ra, còn "Đăng" là nút ở cuối, render sau. Xác minh bằng tiêu đề rồi
    // bước [9/9] đi tìm nút — nút chưa có → `[tap-dang] Không tìm thấy [Đăng]`,
    // job hỏng với màn hình dừng ở sheet chỉnh sửa. Đã xảy ra thật (job 71e87fea).
    //
    // Khe hở này vốn bị `humanDelay` (0,9-1,8 giây) che mất; tắt humanDelay làm nó
    // lộ ra. Đó là một đường hỏng CÓ SẴN chứ không phải do tắt humanDelay sinh ra
    // — cùng mô-típ §4.8: bỏ một quãng chờ làm lộ thứ mà nó đang vô tình che.
    //
    // → Quy tắc: **xác minh bằng ĐÚNG phần tử mà bước sau sẽ dùng.** Chờ một dấu
    //   hiệu "tương đương về mặt logic" là chưa đủ khi giao diện render dần.
    //
    // Chỉ truyền MỘT nhãn: `waitFor` trả về ở nhãn khớp ĐẦU TIÊN, nên thêm
    // "Chỉnh sửa bộ sưu tập" vào danh sách sẽ đưa đúng khe hở này quay lại.
    await this.ui.tapUntilVisible(
      ['Xong'],
      ['Đăng'],
      'tap-xong',
      { guardInTreeOnly: true },
    );
    await this.ui.snapStep('08_after_done');
    metrics.mark('tap-xong');

    if (dryRun) {
      console.log('  ⏸  DRY RUN — dừng trước khi bấm "Đăng". Chưa có gì được xuất bản.');
      return this.usedCollection;
    }

    console.log('  [9/9] Tap "Đăng"...');
    await this.ui.tap(['Đăng'], 'tap-dang');

    // Thay chờ cứng 5 giây bằng chờ sheet ĐÓNG LẠI. Vừa nhanh hơn vừa chặt hơn:
    // 5 giây chỉ chứng minh 5 giây đã trôi qua, còn nhãn "Chỉnh sửa bộ sưu tập"
    // biến mất là bằng chứng sheet đã đóng — tức là bản nháp đã được đăng chứ
    // không phải vẫn đang mở dở.
    await this.ui.waitForGone(['Chỉnh sửa bộ sưu tập'], 'cho-dang-xong', 25000);
    await this.ui.snapStep('09_after_publish');
    metrics.mark('tap-dang');

    console.log('  ✅ Đã gắn sản phẩm vào bộ sưu tập');
    return this.usedCollection;
  }

  /**
   * Mở bộ lọc "Người bán" rồi chọn "Shopee", và xác minh bộ lọc ĐÃ áp.
   *
   * Vì sao cần cả cụm chứ không phải hai cú tap rời:
   *   - Cú mở dropdown không có dấu hiệu riêng nào để chờ. CLAUDE.md §8 đã bác
   *     bỏ `waitFor(['Shopee'])` vì chữ "Shopee" nằm sẵn trên thẻ sản phẩm (dòng
   *     tên người bán) từ trước khi dropdown mở.
   *   - Nhưng bộ lọc áp xong thì SINH RA nhãn "Xoá người bán đã chọn" — nhãn này
   *     có trong cây a11y (dump §8) và không thể tồn tại khi chưa chọn người bán
   *     nào. Đó là dấu hiệu đúng nghĩa cho cả cụm.
   *
   * Nên xác minh đặt ở cuối cụm, và khi cụm hỏng thì quên luôn toạ độ đã nhớ của
   * bước mở dropdown — nó là nghi phạm mà bản thân nó không tự kiểm tra được.
   */
  private async applySellerFilter(): Promise<void> {
    const MAX_ROUNDS = 2;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      await this.ui.tapRememberedOrFind(['Người bán'], 'mo-loc-nguoi-ban');

      // Chờ dropdown MỞ THẬT thay vì chờ cứng 2,5 giây.
      //
      // ĐÍNH CHÍNH cho ghi chú ở trên (2026-08-17): "dropdown không có dấu hiệu
      // riêng nào để chờ" là KẾT LUẬN SAI, rút ra từ việc chỉ thử đúng một nhãn
      // ("Shopee") rồi suy rằng không còn nhãn nào khác. Diff hai dump thật:
      //
      //   flow_07_after_enter   (dropdown ĐÓNG): không có "Người bán"
      //   flow_08_seller_filter (dropdown MỞ):   CÓ "Người bán"
      //                                          CÓ "Mở URL đến trang của người bán"
      //
      // Chữ "Người bán" trên chip lọc là canvas nên không vào cây a11y; nhưng khi
      // dropdown bung ra thì tiêu đề của nó là node a11y thật. Vắng mặt trước, có
      // mặt sau — đúng yêu cầu §4.6, và tra được bằng cây nên không tốn OCR.
      //
      // Không dùng nhãn "Shopee" ở đây: nó nằm sẵn trên thẻ sản phẩm từ trước, đó
      // vẫn là cái bẫy mà ghi chú cũ cảnh báo đúng.
      await this.ui.waitFor(
        ['Mở URL đến trang của người bán', 'Người bán'],
        'cho-dropdown-nguoi-ban',
        8000,
        { treeOnly: true },
      );

      try {
        await this.ui.tapUntilVisible(
          ['Shopee'],
          ['Xoá người bán đã chọn'],
          'chon-nguoi-ban-shopee',
          { guardInTreeOnly: true, useRememberedPoint: true, attempts: 2 },
        );
        return;
      } catch (err) {
        if (round === MAX_ROUNDS) throw err;
        console.warn(
          `  ⚠ Lọc người bán chưa ăn ở lượt ${round}/${MAX_ROUNDS} — ` +
            `nghi cú mở dropdown trượt, quên toạ độ đã nhớ rồi thử lại.`,
        );
        await this.ui.forgetStep('mo-loc-nguoi-ban');
      }
    }
  }

  /**
   * Chọn đúng sản phẩm Shopee khớp link.
   *
   * Màn kết quả xếp: [sản phẩm khớp] → mốc "Các kết quả tương tự" → [gợi ý khác
   * từ Lazada/sàn khác]. Chỉ được chọn nút "Chọn sản phẩm" nằm TRÊN mốc đó,
   * nếu không sẽ gắn nhầm sản phẩm của sàn khác.
   */
  private async selectMatchingProduct(shopeeUrl = ''): Promise<void> {
    // Sau khi áp bộ lọc Shopee, danh sách có thể rỗng hẳn (app hiện "Không tìm thấy
    // kết quả nào"). Vòng chờ này nhận ra và dừng ngay thay vì đợi hết 30 giây.
    await this.waitForKetQuaTimKiem('cho-ket-qua-tim-kiem', 30000);

    // Đọc với mức chờ ĐẦY ĐỦ, không dùng đường nhanh: dưới đây là chỗ ĐẾM nút để
    // thực thi chốt §4.7. Đọc phải cây render dở sẽ cho số đếm thiếu, và số đếm
    // thiếu ở đây nghĩa là một cú tap GỠ sản phẩm khỏi bộ sưu tập thật lọt qua —
    // khác hẳn các chỗ khác, nơi đọc hụt chỉ làm một lượt chờ trượt rồi thử lại.
    const nodes = await this.readNodesReliably();
    const addButtons = nodes
      .filter((n) => n.clickable && hasExactLabel(n, LABEL_ADD_PRODUCT))
      .sort((a, b) => a.bounds.y1 - b.bounds.y1);

    // Mốc phân cách: mọi thứ dưới nó là gợi ý của sàn khác
    const similarMarker = nodes.find((n) =>
      normalizeText(n.desc).includes(normalizeText('các kết quả tương tự')),
    );
    const cutoffY = similarMarker ? similarMarker.bounds.y1 : Number.MAX_SAFE_INTEGER;

    // LỖI ĐÃ SỬA — sản phẩm đã nằm sẵn trong bộ sưu tập.
    //
    // Hàng của sản phẩm đã có mang nút "Bỏ chọn sản phẩm" thay cho "Chọn sản phẩm".
    // Bản trước lọc ứng viên bằng `.includes('chọn sản phẩm')`, mà "Bỏ chọn sản phẩm"
    // CHỨA đúng cụm đó — nên nút gỡ lọt vào danh sách ứng viên và cú tap trở thành
    // lệnh GỠ sản phẩm khỏi bộ sưu tập thật của người dùng.
    //
    // Ở đây từ chối thay vì đoán: khi vùng kết quả khớp đã có sản phẩm được chọn,
    // ta không phân biệt được hàng nào là sản phẩm người dùng vừa gửi, nên chọn
    // bất kỳ hàng nào còn lại đều có nguy cơ thêm nhầm sản phẩm khác (§10.7).
    const alreadySelected = nodes.filter(
      (n) => n.clickable && hasExactLabel(n, LABEL_REMOVE_PRODUCT) && n.bounds.y1 < cutoffY,
    );
    if (alreadySelected.length > 0) {
      // KHÔNG phải lỗi — người dùng muốn LINK, và link đó đã tồn tại sẵn.
      //
      // Trước đây chỗ này ném lỗi "Sản phẩm này đã có trong bộ sưu tập rồi", buộc
      // người dùng tự đi tìm link cũ. Nhưng mục tiêu của họ là lấy link, còn việc
      // sản phẩm đã nằm đó chỉ là chi tiết triển khai. Nay dừng Phase 1 tại đây và
      // để Phase 3 trích link của chính sản phẩm đã có.
      //
      // Tuyệt đối KHÔNG tap tiếp: hàng đó đang mang nút "Bỏ chọn sản phẩm", bấm
      // vào là GỠ sản phẩm khỏi bộ sưu tập thật (§4.7).
      this.daCoSanTrongBoSuuTap = true;
      this.addedProductName = '';
      console.log(
        `  ℹ️  Sản phẩm đã có sẵn trong bộ sưu tập (hàng y=${alreadySelected[0].bounds.y1} mang nút ` +
          `"${LABEL_REMOVE_PRODUCT}") — bỏ qua bước gắn, lấy luôn link của nó ở Phase 3.`,
      );
      return;
    }

    // ── Không có nút "Chọn sản phẩm" nào ────────────────────────────────────
    //
    // Kiểm tra này phải nằm SAU chốt "đã có sẵn" ở trên. Bản trước để nó trước và
    // sinh ra thông báo sai: khi sản phẩm đã nằm trong bộ sưu tập, hàng của nó
    // mang nhãn "Bỏ chọn sản phẩm" nên `addButtons` = 0, và người dùng nhận được
    // "không tìm thấy sản phẩm" trong khi sự thật là "đã có rồi" — chốt đúng thì
    // nằm phía dưới và không bao giờ chạy tới.
    //
    // Tới được đây nghĩa là: đã lọc người bán Shopee, đã chờ danh sách render
    // xong, không có hàng nào đang được chọn, mà vẫn không có nút "+" nào. Nguyên
    // nhân thường gặp nhất là sản phẩm không tham gia chương trình tiếp thị liên
    // kết của YouTube Shopping.
    if (addButtons.length === 0) {
      const shot = await this.ui.snap('ERROR_khong-thay-san-pham');
      console.error(
        `  [chi tiết] không có nút "${LABEL_ADD_PRODUCT}" nào sau khi lọc Shopee ` +
          `(cũng không có nút "${LABEL_REMOVE_PRODUCT}"). Ảnh: ${shot}`,
      );
      throw new LoiDauVao(
        'Sản phẩm này không nằm trong chương trình tiếp thị liên kết nên không gắn được. ' +
          'Hãy thử một sản phẩm Shopee khác.',
      );
    }

    const exactMatches = addButtons.filter((b) => b.bounds.y1 < cutoffY);
    if (exactMatches.length === 0) {
      const shot = await this.ui.snap('ERROR_chi-co-ket-qua-tuong-tu');
      console.error(
        `  [chi tiết] chỉ có kết quả DƯỚI mốc "Các kết quả tương tự" (y=${cutoffY}) — ` +
          `toàn hàng của sàn khác. Từ chối gắn để tránh sai sản phẩm (§4.3). Ảnh: ${shot}`,
      );

      // App NÓI THẲNG lý do — dùng lời của nó thay vì tự suy đoán.
      //
      // Dò thật 2026-08-17 với một link ID không tồn tại: app hiện dòng
      //   "Sản phẩm không có trong chương trình tiếp thị liên kết của YouTube Shopping"
      // rồi vẫn liệt kê "Các kết quả tương tự" của sàn khác bên dưới. Vì phần dưới
      // có nút "Chọn sản phẩm" nên cây a11y trông y hệt trường hợp "tìm được hàng
      // tương tự" — không phân biệt được bằng cây.
      //
      // Dòng thông báo vẽ bằng canvas nên bắt buộc phải OCR. Chỉ tốn ~1-2 giây và
      // chỉ chạy trên nhánh LỖI, nên không ảnh hưởng đường thành công.
      if (await this.manHinhBaoKhongCoTiepThiLienKet(shot)) {
        throw new LoiDauVao(
          'Sản phẩm này không có trong chương trình tiếp thị liên kết của YouTube Shopping, ' +
            'nên không áp được voucher. Hãy thử một sản phẩm Shopee khác.',
        );
      }

      throw new LoiDauVao(
        'Không tìm thấy đúng sản phẩm này trên Shopee — chỉ có sản phẩm tương tự từ nơi khác. ' +
          'Hãy kiểm tra lại link.',
      );
    }

    const chosen = exactMatches[0];
    // Mốc so sánh cho bước xác minh. Đếm trên TOÀN màn hình chứ không chỉ vùng
    // trên mốc: sau khi chọn, danh sách có thể xô đẩy đôi chút, mà điều ta cần
    // chứng minh chỉ là "xuất hiện thêm một nút Bỏ chọn so với trước khi tap".
    const removeCountBefore = this.countRemoveButtons(nodes);
    console.log(
      `  → Chọn sản phẩm tại y=${chosen.bounds.y1} (mốc "kết quả tương tự" ở y=${cutoffY}), ` +
        `hiện có ${exactMatches.length} nút "+" khớp, ${removeCountBefore} nút "Bỏ chọn"`,
    );

    // Đọc tên sản phẩm TRƯỚC khi tap. Tên này dùng để đối chiếu ở bước trích
    // link affiliate — không có nó, ta không thể chắc lấy đúng sản phẩm trên
    // trang bộ sưu tập (một bộ sưu tập có hàng chục sản phẩm).
    // Tên sản phẩm CHỈ còn được dùng khi bước trích link không giải được ID
    // (collectionAffiliateExtractor: có targetRef thì so theo ID và KHÔNG có đường
    // lui nào theo tên). Nên khi ID đã nằm sẵn trong chính URL người dùng gửi, OCR
    // ở đây là ~2 giây trả cho một giá trị chắc chắn không ai đọc tới.
    //
    // Dùng `parseProductRef` chứ không phải `resolveProductRef`: bản này thuần
    // regex, không gọi mạng, nên không thêm độ trễ nào. Link RÚT GỌN trả null —
    // đúng nhánh mà tên sản phẩm là lưới an toàn duy nhất, và ở đó ta vẫn OCR như
    // cũ. Nói cách khác: bỏ đúng chỗ thừa, giữ nguyên chỗ cần.
    const idFromUrl = shopeeUrl ? parseProductRef(shopeeUrl) : null;

    if (automationEnv.AUTOMATION_SKIP_PRODUCT_OCR) {
      this.addedProductName = '';
      console.log(
        '  ⏭  Bỏ OCR đọc tên sản phẩm (AUTOMATION_SKIP_PRODUCT_OCR=1) — ' +
          'bước trích link sẽ so khớp theo ID trong origin_link',
      );
    } else if (idFromUrl) {
      this.addedProductName = '';
      console.log(
        `  ⏭  Bỏ OCR đọc tên sản phẩm (~2s) — ID đã bóc thẳng từ link: ` +
          `${idFromUrl.sellerId}/${idFromUrl.productId}. Bước trích link so theo ID.`,
      );
    } else {
      this.addedProductName = await this.readProductTitle(chosen.bounds.y1, cutoffY);
      if (this.addedProductName) {
        console.log(`  → Tên sản phẩm: "${this.addedProductName}"`);
      } else {
        console.warn('  ⚠️ Không đọc được tên sản phẩm — bước trích link sẽ kém chắc chắn');
      }
    }

    // Tap rồi XÁC MINH. Cú tap vào nút "+" đôi khi không ăn (danh sách vừa render
    // xong, chưa nhận sự kiện chạm). Trước đây code tap xong là đi tiếp luôn, nên
    // job vẫn bấm "Xong" → "Đăng" và báo thành công dù KHÔNG thêm được gì.
    const c = centerOf(chosen);
    const MAX_TAP_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_TAP_ATTEMPTS; attempt++) {
      await tapAt(this.drv, c.x, c.y);

      // Hỏi lại nhịp dày thay vì ngồi đủ 2,5 giây rồi mới hỏi một lần. Cú tap
      // thường ăn ngay, mà mỗi lần hỏi cây a11y chỉ ~180ms — không có lý do gì
      // để chờ tiếp sau khi đã thấy sản phẩm được chọn. Hạn chờ tối đa vẫn giữ
      // nguyên 2,5 giây nên kết luận "trượt" không hề vội hơn trước.
      if (await this.waitProductSelected(removeCountBefore, 2500)) {
        console.log(`  ✅ Xác nhận đã chọn sản phẩm (lần tap ${attempt})`);
        await humanDelay();
        return;
      }

      console.warn(
        `  ⚠️ Tap lần ${attempt} chưa ăn — nút "+" vẫn chưa chuyển sang đã chọn`,
      );
      await delay(1500);
    }

    const shot = await this.ui.snap('ERROR_tap-chon-san-pham-khong-an');
    throw new Error(
      `Đã tap nút "+" ${MAX_TAP_ATTEMPTS} lần nhưng sản phẩm không được chọn. ` +
        `Dừng lại để không đăng một bộ sưu tập không có gì thay đổi. Ảnh: ${shot}`,
    );
  }

  /**
   * Kiểm tra sản phẩm đã thực sự được chọn chưa.
   *
   * Sau khi chọn, nút "+" của dòng đó đổi trạng thái nên số node mang nhãn
   * "Chọn sản phẩm" giảm đi một; đồng thời xuất hiện nhãn dạng "Bỏ chọn"/"Đã chọn".
   * Chấp nhận bất kỳ dấu hiệu nào trong hai dấu hiệu đó.
   */
  /** Số nút "Bỏ chọn sản phẩm" đang có — mỗi nút ứng với một sản phẩm đang được chọn */
  private countRemoveButtons(nodes: UiNode[]): number {
    return nodes.filter((n) => n.clickable && hasExactLabel(n, LABEL_REMOVE_PRODUCT)).length;
  }

  /** Hỏi lại tới khi sản phẩm được chọn, hoặc hết hạn. Không ném lỗi. */
  private async waitProductSelected(
    removeCountBefore: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.isProductSelected(removeCountBefore)) return true;
      if (Date.now() >= deadline) return false;
      await pollSleep(300);
    }
  }

  /**
   * Kiểm tra cú tap đã thực sự chọn thêm một sản phẩm chưa.
   *
   * ── LỚP BẢO VỆ NÀY TRƯỚC ĐÂY VÔ HIỆU HOÀN TOÀN ──────────────────────────────
   * Bản cũ chấp nhận thành công khi `stillSelectable < selectableBefore` HOẶC
   * `hasDeselect`. Cả hai vế đều hỏng:
   *
   *   • `hasDeselect` quét cả màn hình tìm cụm "đã chọn" — nhưng nhãn
   *     "Xoá người bán đã chọn" xuất hiện ngay từ lúc lọc Shopee, tức là TRƯỚC
   *     khi tap. Vế này vì thế luôn đúng, và hàm luôn trả về true.
   *   • `stillSelectable` đếm bằng `.includes('chọn sản phẩm')`, mà nút sau khi
   *     chọn đổi thành "Bỏ chọn sản phẩm" — vẫn chứa cụm đó. Số đếm không giảm,
   *     nên vế này không bao giờ đúng.
   *
   * Hệ quả: mọi dòng log "✅ Xác nhận đã chọn sản phẩm" từ trước tới nay là một
   * khẳng định rỗng — nó báo thành công y hệt kể cả khi cú tap trượt hoàn toàn.
   * Đúng điều CLAUDE.md §4.6 cảnh báo: lớp bảo vệ chọn sai dấu hiệu còn nguy
   * hiểm hơn không có lớp nào, vì nó tạo cảm giác an toàn giả.
   *
   * ── Dấu hiệu đúng ───────────────────────────────────────────────────────────
   * So số nút mang nhãn CHÍNH XÁC "Bỏ chọn sản phẩm" với mốc chụp ngay trước khi
   * tap. Mỗi sản phẩm đang được chọn có đúng một nút như vậy, nên số đếm tăng là
   * bằng chứng trực tiếp rằng có thêm một sản phẩm được chọn: không bị nhãn khác
   * trên màn hình làm nhiễu (nhờ khớp chính xác), và không thể đúng sẵn từ trước
   * (nhờ so với mốc chụp trước thao tác).
   */
  private async isProductSelected(removeCountBefore: number): Promise<boolean> {
    const nodes = await this.ui.nodes();
    return this.countRemoveButtons(nodes) > removeCountBefore;
  }

  /**
   * Đọc tên sản phẩm bằng OCR trong vùng thẻ sản phẩm khớp.
   * Tên sản phẩm được vẽ bằng canvas nên không có trong accessibility tree.
   */
  private async readProductTitle(rowY: number, cutoffY: number): Promise<string> {
    const shotPath = await this.ui.snap('06b_product_row');
    try {
      const ocr = await readScreen(shotPath);
      // Lấy các dòng nằm trong vùng thẻ sản phẩm, bỏ dòng giá / hoa hồng / tên sàn
      const lines = ocr.lines
        .filter(
          (l) =>
            l.confidence >= 55 &&
            l.bbox.y0 >= rowY - 260 &&
            l.bbox.y1 <= cutoffY &&
            l.text.trim().length > 8 &&
            !/^\s*(shopee|lazada|tiki)\b/i.test(l.text) &&
            !/hoa hồng|\d[\d.,]*\s*đ\b/i.test(l.text),
        )
        .sort((a, b) => a.bbox.y0 - b.bbox.y0);

      return lines.map((l) => l.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }

  /**
   * PHASE 2: lấy link chia sẻ của bộ sưu tập.
   * Về màn Mua sắm → mở menu thẻ → Chia sẻ → Sao chép liên kết → đọc clipboard.
   */
  async getCollectionShareLink(): Promise<string> {
    console.log('\n  ═══ PHASE 2: LẤY LINK CHIA SẺ ═══');

    console.log('  [1/3] Quay lại màn Mua sắm...');
    await this.openShoppingScreen();

    console.log(`  [2/3] Mở menu bộ sưu tập "${this.usedCollection}"...`);
    await this.openCollectionMenu(this.usedCollection || undefined);
    // Cùng lý do như bước 3 của Phase 1: "Nút kéo" là nhãn a11y duy nhất của menu
    // ngữ cảnh và vắng mặt trên màn Mua sắm, nên chờ nó rẻ hơn OCR tìm "Chia sẻ".
    await this.ui.waitFor(['Nút kéo'], 'cho-menu-chia-se', 15000, { treeOnly: true });
    await this.ui.snapStep('10_share_menu');

    console.log('  [3/3] Chia sẻ → Sao chép liên kết...');
    const COPY_LABELS = ['Sao chép liên kết', 'Sao chép đường liên kết', 'Copy link'];

    // Chờ bảng chia sẻ mở thay vì chờ cứng 3 giây. Dấu hiệu là chính mục sẽ bấm
    // tiếp theo — nó chỉ tồn tại khi bảng chia sẻ đã mở, nên thoả yêu cầu §4.6.
    // KHÔNG bật useRememberedPoint: "Chia sẻ" nằm cùng menu với "Xoá".
    await this.ui.tapUntilVisible(['Chia sẻ'], COPY_LABELS, 'tap-chia-se');
    await this.ui.snapStep('11_share_sheet');

    await this.ui.tap(COPY_LABELS, 'tap-sao-chep-lien-ket');

    // Đọc lại clipboard tới khi có URL thay vì chờ cứng 2 giây rồi đọc một lần:
    // hệ thống ghi clipboard gần như tức thì, nhưng thỉnh thoảng chậm hơn 2 giây
    // và khi đó bản cũ trả về chuỗi rỗng rồi ném lỗi oan.
    const clip = await this.readClipboardUntilUrl(8000);
    const match = clip.match(/(https?:\/\/[^\s]+)/);
    if (!match) {
      const shot = await this.ui.snap('ERROR_clipboard-rong');
      throw new Error(
        `Không đọc được link từ clipboard (nội dung: "${clip}"). Ảnh: ${shot}`,
      );
    }

    console.log(`  ✅ Link chia sẻ: ${match[1]}`);
    return match[1];
  }

  /**
   * Đọc clipboard của thiết bị.
   *
   * Ưu tiên API của Appium (đi qua app io.appium.settings): trên Android 10+
   * ứng dụng nền không được đọc clipboard, và `adb shell cmd clipboard get`
   * không tồn tại trên nhiều bản Android mới (Android 16 báo "No shell command
   * implementation"). Vẫn giữ đường adb làm phương án dự phòng cho máy cũ.
   */
  /**
   * Đọc lại clipboard tới khi thấy một URL, hoặc hết hạn.
   * Trả về nội dung đọc được lần cuối để tầng gọi đưa vào thông báo lỗi.
   */
  private async readClipboardUntilUrl(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const clip = await this.readClipboard();
      if (/https?:\/\//.test(clip)) return clip;
      if (Date.now() >= deadline) return clip;
      await pollSleep(400);
    }
  }

  private async readClipboard(): Promise<string> {
    try {
      const base64 = await this.drv.getClipboard();
      const text = Buffer.from(base64, 'base64').toString('utf8').trim();
      if (text) return text;
      console.warn('  ⚠️ Clipboard qua Appium rỗng — thử đường adb');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ⚠️ Không đọc được clipboard qua Appium (${msg}) — thử đường adb`);
    }

    try {
      return await getDeviceClipboard(this.deviceSerial);
    } catch {
      return '';
    }
  }

  /**
   * Rời khỏi session.
   *
   * Khi đang bật tái dùng, KHÔNG đóng session — chỉ buông tham chiếu để job sau
   * dùng lại. Session chỉ thực sự bị đóng bởi disposeSharedAppiumSession(): lúc
   * job thất bại, và lúc tiến trình tắt.
   */
  async close(): Promise<void> {
    if (!this.driver) return;

    if (automationEnv.APPIUM_REUSE_SESSION && this.driver === sharedDriver) {
      this.driver = null;
      this.screen = null;
      return;
    }

    await this.driver.deleteSession().catch(() => {});
    this.driver = null;
    this.screen = null;
  }
}
