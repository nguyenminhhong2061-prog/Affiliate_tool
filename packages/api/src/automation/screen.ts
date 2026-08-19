/**
 * Lớp điều khiển màn hình cho app YouTube Studio.
 *
 * Kết hợp ba cơ chế định vị, theo thứ tự ưu tiên:
 *   1. Accessibility tree  — nhanh & chính xác nhất, nhưng app chỉ expose rất ít nhãn
 *   2. OCR                 — đọc chữ vẽ bằng canvas như mắt người (chậm hơn ~2-4s)
 *   3. Cấu trúc / toạ độ   — dự phòng cuối, dùng resource-id và vị trí tương đối
 *
 * Nguyên tắc xuyên suốt: KHÔNG nuốt lỗi. Mỗi thao tác thất bại đều ném lỗi kèm
 * ảnh chụp màn hình, để pipeline dừng ngay thay vì tap mù sang màn hình sai —
 * đây chính là lỗi khiến bản automation trước chạy sai toàn bộ luồng.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  parseNodes,
  findNodeByLabel,
  centerOf,
  tapAt,
  normalizeText,
  type UiNode,
} from './uiFinder';
import { readScreen, locateLabel, type OcrResult } from './ocr';
import { metrics } from './metrics';
import { automationEnv } from './env';
import {
  buildDeviceKey,
  getCachedPoint,
  rememberPoint,
  forgetPoint,
  type CachedPoint,
} from './labelCache';

const SHOT_DIR = path.join(__dirname, '../../logs/screenshots/appium');

/**
 * Có chụp ảnh mốc trên đường thành công hay không.
 *
 * Ảnh mốc (01_shopping, 02_context_menu, ...) chỉ phục vụ gỡ rối, nhưng mỗi tấm
 * tốn ~600ms qua Appium (đo thật trên thiết bị) — 11 tấm là gần 7 giây mỗi job,
 * trả giá trên MỌI job kể cả khi không ai xem tới.
 *
 * Mặc định tắt. Ảnh ở nhánh LỖI vẫn luôn được chụp, nên khi hỏng vẫn có bằng
 * chứng. Bật lại bằng AUTOMATION_CHECKPOINT_SHOTS=1 khi cần soi luồng, và
 * DRY_RUN tự bật vì dry-run tồn tại chính để quan sát.
 */
const CHECKPOINT_SHOTS =
  process.env.AUTOMATION_CHECKPOINT_SHOTS === '0'
    ? false // tắt tường minh — thắng cả DRY_RUN, dùng khi cần đo tốc độ thật
    : process.env.AUTOMATION_CHECKPOINT_SHOTS === '1' || process.env.DRY_RUN === '1';

export interface FindResult {
  x: number;
  y: number;
  via: 'a11y' | 'ocr';
  matched: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Chờ giữa hai lượt hỏi trong vòng lặp chờ — tách khỏi humanDelay để đo riêng */
const pollWait = (ms: number): Promise<void> => metrics.time('cho-vong-lap', () => sleep(ms));

/**
 * Nhãn của các thao tác phá huỷ. Menu ngữ cảnh của bộ sưu tập đặt "Xoá" ngay
 * cạnh "Chỉnh sửa"/"Chia sẻ", nên một lần OCR đọc lệch có thể xoá mất bộ sưu tập
 * của người dùng. Chặn cứng: không bao giờ tap vào nhãn nằm trong danh sách này.
 */
const DESTRUCTIVE_LABELS = ['xoá', 'xóa', 'delete', 'remove', 'gỡ', 'huỷ đăng', 'hủy đăng'];

function isDestructive(text: string): boolean {
  // Bắt buộc dùng normalizeText: chuỗi từ Android ở dạng NFD, so sánh trực tiếp
  // với literal NFC trong mã nguồn sẽ luôn trượt và vô hiệu hoá lớp bảo vệ này.
  const t = normalizeText(text);
  return DESTRUCTIVE_LABELS.some(
    (bad) => t === normalizeText(bad) || t.startsWith(`${normalizeText(bad)} `),
  );
}

/**
 * Độ trễ ngẫu nhiên giữa các thao tác — tránh nhịp máy móc đều đặn (CLAUDE.md §10.5).
 *
 * Đo riêng trong metrics dưới tên `human-delay` chứ không gộp vào `cho-vong-lap`:
 * đây là chi phí CÓ CHỦ ĐÍCH để giảm rủi ro tài khoản, không phải lãng phí cần
 * cắt. Tách ra để khi đọc bảng chi phí không nhầm nó với chờ chết.
 *
 * TẮT MẶC ĐỊNH từ 2026-08-17 theo quyết định của chủ dự án — lý do và cái giá ghi
 * đầy đủ ở `automationEnv.AUTOMATION_HUMAN_DELAY`. Bật lại: AUTOMATION_HUMAN_DELAY=1.
 *
 * Vẫn nhường một nhịp event loop khi tắt: các nơi gọi đang dựa vào humanDelay như
 * một điểm ngắt giữa "vừa tap xong" và "đọc lại màn hình". Trả về Promise đã xong
 * ngay lập tức sẽ gộp hai thao tác vào cùng một lượt microtask và làm app chưa kịp
 * bắt đầu render — đó là loại lỗi §4.5 (tap thành công nhưng chưa có hiệu lực).
 */
export function humanDelay(minMs = 900, maxMs = 1800): Promise<void> {
  if (!automationEnv.AUTOMATION_HUMAN_DELAY) return sleep(0);
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return metrics.time('human-delay', () => sleep(ms));
}

export class Screen {
  constructor(
    private driver: WebdriverIO.Browser,
    private jobId = 'manual',
    private deviceSerial = '',
  ) {}

  setJobId(jobId: string) {
    this.jobId = jobId;
  }

  private deviceKeyPromise: Promise<string> | null = null;

  /**
   * Khoá cho cache toạ độ: serial thiết bị + độ phân giải màn hình.
   *
   * Hỏi kích thước màn hình đúng một lần cho cả phiên. Trả chuỗi rỗng nếu không
   * hỏi được — khi đó cache tự tắt và mọi thứ chạy như trước, vì toạ độ tuyệt
   * đối mà không biết mình thuộc màn hình nào thì không được phép tin.
   */
  private deviceKey(): Promise<string> {
    if (!this.deviceKeyPromise) {
      this.deviceKeyPromise = this.driver
        .getWindowSize()
        .then(({ width, height }) => buildDeviceKey(this.deviceSerial, width, height))
        .catch(() => '');
    }
    return this.deviceKeyPromise;
  }

  /** Chụp màn hình vào logs/screenshots/appium, trả về đường dẫn file */
  async snap(name: string): Promise<string> {
    if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
    const filePath = path.join(SHOT_DIR, `${this.jobId}_${name}.png`);
    await metrics.time('screenshot', () => this.driver.saveScreenshot(filePath));
    return filePath;
  }

  /**
   * Chụp ảnh mốc để gỡ rối — không làm gì khi CHECKPOINT_SHOTS tắt.
   * Dùng cho các mốc trên đường THÀNH CÔNG; ảnh ở nhánh lỗi phải gọi snap().
   */
  async snapStep(name: string): Promise<void> {
    if (!CHECKPOINT_SHOTS) return;
    await this.snap(name);
  }

  /** Toàn bộ node của màn hình hiện tại */
  async nodes(): Promise<UiNode[]> {
    const xml = await metrics.time('a11y-tree', () => this.driver.getPageSource());
    return parseNodes(xml);
  }

  // Bộ nhớ đệm OCR theo nội dung ảnh — xem readScreenCached()
  private lastShotHash: string | null = null;
  private lastOcr: OcrResult | null = null;

  /**
   * OCR có nhớ: nếu ảnh chụp lần này giống hệt lần trước TỪNG BYTE thì kết quả
   * OCR chắc chắn không đổi, bỏ qua được ~2 giây.
   *
   * Vì sao dùng được: trong vòng lặp chờ (waitFor, tapUntilVisible) màn hình
   * thường đứng yên giữa hai lần kiểm tra. Đo thật trên thiết bị: hai lần chụp
   * liên tiếp cách 1,2 giây của một màn hình tĩnh cho ra file y hệt nhau.
   *
   * An toàn vì so khớp là byte-to-byte: chỉ cần một điểm ảnh đổi (đồng hồ trên
   * thanh trạng thái, con trỏ nhấp nháy, animation) là hash khác và OCR chạy lại.
   * Không có khả năng dùng nhầm kết quả cũ cho một màn hình đã đổi.
   */
  private async readScreenCached(shotPath: string): Promise<OcrResult> {
    const buf = await fs.promises.readFile(shotPath);
    const hash = crypto.createHash('md5').update(buf).digest('hex');

    if (hash === this.lastShotHash && this.lastOcr) {
      console.log('  ⚡ Màn hình không đổi — dùng lại kết quả OCR (bỏ ~2s)');
      return this.lastOcr;
    }

    const ocr = await readScreen(shotPath);
    this.lastShotHash = hash;
    this.lastOcr = ocr;
    return ocr;
  }

  /**
   * Hỏi lại tới khi thấy nhãn. Trả null nếu hết hạn.
   *
   * ĐÃ THỬ, KẾT QUẢ KHÔNG KẾT LUẬN ĐƯỢC (2026-08-16): hỏi cây a11y với nhịp
   * dày 400ms, cứ 4 lượt mới đụng OCR, kỳ vọng né ~2 giây OCR mỗi vòng. Một
   * lần đo cho +1,9 giây, nhưng sau đó phát hiện dao động giữa các lần chạy
   * tới ±4 giây, nên con số đó vô nghĩa. Đã trả về nhịp cũ vì không chứng minh
   * được lợi ích — không phải vì chứng minh được có hại.
   *
   * Nếu thử lại: phải chạy lặp nhiều lần lấy trung bình, và đo riêng chi phí
   * `getPageSource()` lúc màn hình ĐANG chuyển cảnh (UiAutomator2 chờ app rảnh
   * mới trả về, nên 177ms đo trên màn hình đứng yên không đại diện).
   */
  private async pollFor(
    labels: string[],
    timeoutMs: number,
    intervalMs: number,
    treeOnly = false,
  ): Promise<FindResult | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = treeOnly ? await this.findInTree(labels) : await this.find(labels);
      if (hit) return hit;
      await pollWait(intervalMs);
    }
    return null;
  }

  /**
   * Chỉ tìm trong accessibility tree — rẻ (~180ms đo thật), không đụng OCR.
   * Dùng cho vòng lặp chờ, nơi gọi OCR mỗi lượt là quá đắt.
   */
  private async findInTree(labels: string[]): Promise<FindResult | null> {
    const nodes = await this.nodes();
    for (const label of labels) {
      const node = findNodeByLabel(nodes, label);
      if (node) {
        const c = centerOf(node);
        return { x: c.x, y: c.y, via: 'a11y', matched: node.text || node.desc };
      }
    }
    return null;
  }

  /**
   * Tìm nhãn trên màn hình hiện tại: thử accessibility tree trước, rồi OCR.
   * Trả về null nếu không thấy (để caller quyết định cuộn tiếp hay báo lỗi).
   */
  async find(labels: string[]): Promise<FindResult | null> {
    const inTree = await this.findInTree(labels);
    if (inTree) return inTree;

    const shotPath = await this.snap(`_ocr_${Date.now()}`);
    try {
      const ocr = await this.readScreenCached(shotPath);
      for (const label of labels) {
        const hit = locateLabel(ocr, label);
        if (hit) {
          return { x: hit.x, y: hit.y, via: 'ocr', matched: hit.matched };
        }
      }
    } finally {
      fs.promises.unlink(shotPath).catch(() => {});
    }

    return null;
  }

  /**
   * Tìm nhãn, cuộn dần xuống nếu chưa thấy. Dùng cho mục nằm dưới màn hình
   * (ví dụ "Tuyển tập" nằm dưới phần "Nhà bán hàng liên kết").
   */
  async findWithScroll(
    labels: string[],
    maxScrolls = 6,
  ): Promise<FindResult | null> {
    const hit = await this.find(labels);
    if (hit) return hit;

    for (let i = 0; i < maxScrolls; i++) {
      await this.scrollDown();
      await humanDelay(700, 1200);
      const found = await this.find(labels);
      if (found) return found;
    }
    return null;
  }

  /** Cuộn xuống một đoạn bằng thao tác vuốt */
  async scrollDown(): Promise<void> {
    const { width, height } = await this.driver.getWindowSize();
    const x = Math.round(width / 2);
    await this.driver.performActions([
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y: Math.round(height * 0.72) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 120 },
          { type: 'pointerMove', duration: 550, x, y: Math.round(height * 0.28) },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
    await this.driver.releaseActions();
  }

  /**
   * Tìm rồi tap. Ném lỗi kèm ảnh chụp nếu không tìm thấy — pipeline phải dừng,
   * không được đi tiếp mù quáng.
   */
  async tap(labels: string[], stepName: string, opts: { scroll?: boolean } = {}): Promise<FindResult> {
    const hit = opts.scroll
      ? await this.findWithScroll(labels)
      : await this.find(labels);

    if (!hit) {
      const shot = await this.snap(`ERROR_${stepName}`);
      const visible = await this.describeScreen();
      throw new Error(
        `[${stepName}] Không tìm thấy [${labels.join(' | ')}].\n` +
          `  Ảnh màn hình lỗi: ${shot}\n` +
          `  Nội dung đọc được: ${visible}`,
      );
    }

    // Chốt an toàn: nếu phần tử khớp lại là một thao tác phá huỷ (OCR đọc lệch,
    // hoặc menu đổi bố cục) thì dừng ngay thay vì tap.
    if (isDestructive(hit.matched)) {
      const shot = await this.snap(`ABORT_${stepName}`);
      throw new Error(
        `[${stepName}] TỪ CHỐI TAP: phần tử khớp là thao tác phá huỷ "${hit.matched}" ` +
          `(đang tìm [${labels.join(' | ')}]). Ảnh: ${shot}`,
      );
    }

    await tapAt(this.driver, hit.x, hit.y);
    await humanDelay();
    return hit;
  }

  /**
   * Chờ tới khi một trong các nhãn xuất hiện. Màn hình phụ thuộc mạng (danh sách
   * bộ sưu tập, kết quả tìm sản phẩm) có thể mất vài giây mới render xong, nên
   * kiểm tra một lần rồi kết luận là quá vội.
   */
  async waitFor(
    labels: string[],
    stepName: string,
    timeoutMs = 25000,
    opts: {
      /**
       * Nhãn chờ nằm CHẮC CHẮN trong cây a11y — chỉ bật khi đã xác nhận bằng dump
       * thật (xem CLAUDE.md §8), vì bật nhầm thì vòng chờ không bao giờ khớp và
       * bước này sẽ hết giờ thay vì rơi về OCR.
       *
       * Đổi được hai thứ cùng lúc: bỏ hẳn chụp ảnh + OCR mỗi lượt hỏi, và vì một
       * lượt hỏi chỉ còn ~385ms thay vì ~2s nên hỏi dày hơn được — cắt phần lớn
       * quãng chết giữa lúc màn hình sẵn sàng và lúc ta phát hiện ra.
       */
      treeOnly?: boolean;
    } = {},
  ): Promise<FindResult> {
    const { treeOnly = false } = opts;
    const hit = await this.pollFor(labels, timeoutMs, treeOnly ? 400 : 1500, treeOnly);
    if (hit) return hit;

    const shot = await this.snap(`ERROR_wait_${stepName}`);
    const visible = await this.describeScreen();
    throw new Error(
      `[${stepName}] Chờ ${timeoutMs / 1000}s vẫn không thấy ` +
        `[${labels.join(' | ')}].\n  Ảnh: ${shot}\n  Nội dung đọc được: ${visible}`,
    );
  }

  /**
   * Chờ nhãn xuất hiện nhưng KHÔNG ném lỗi khi hết giờ — trả về true/false.
   *
   * Dùng để thay một quãng chờ cứng bằng chờ theo điều kiện mà không thêm rủi ro:
   * đặt trần đúng bằng quãng chờ cũ, thấy dấu hiệu thì đi tiếp sớm, không thấy thì
   * hết trần vẫn đi tiếp y như bản cũ. Nhờ vậy đây là thay đổi chỉ có thể nhanh
   * hơn hoặc bằng, không thể chậm hơn hay hỏng thêm.
   *
   * Khác `waitFor` ở chỗ waitFor coi "không thấy" là lỗi và dừng pipeline — đúng
   * cho dấu hiệu bắt buộc, nhưng sai cho những chỗ mà quãng chờ vốn chỉ là đệm.
   */
  async seenWithin(
    labels: string[],
    timeoutMs: number,
    opts: { treeOnly?: boolean } = {},
  ): Promise<boolean> {
    const { treeOnly = false } = opts;
    const hit = await this.pollFor(labels, timeoutMs, treeOnly ? 200 : 1000, treeOnly);
    return hit !== null;
  }

  /**
   * Chờ tới khi một nhãn BIẾN MẤT khỏi màn hình.
   *
   * Dùng để xác nhận một sheet đã đóng — ví dụ sau khi bấm "Đăng" thì nhãn
   * "Chỉnh sửa bộ sưu tập" phải biến mất. Đây là dấu hiệu chặt hơn hẳn chờ cứng
   * 5 giây, vì nó chứng minh đúng điều ta cần biết (sheet đã đóng = đã đăng),
   * thay vì chỉ chứng minh rằng 5 giây đã trôi qua.
   *
   * CHỈ hỏi accessibility tree, cố ý không dùng OCR: OCR không đọc thấy một chữ
   * KHÔNG chứng minh chữ đó vắng mặt — có thể chỉ là đọc trượt. Vắng mặt trong
   * cây a11y mới là bằng chứng dùng được. Vì vậy chỉ được truyền vào đây những
   * nhãn đã biết chắc có trong cây a11y (xem dump ở CLAUDE.md §8).
   */
  async waitForGone(labels: string[], stepName: string, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.findInTree(labels))) return;
      await pollWait(700);
    }

    const shot = await this.snap(`ERROR_van_hien_${stepName}`);
    const visible = await this.describeScreen();
    throw new Error(
      `[${stepName}] Chờ ${timeoutMs / 1000}s mà [${labels.join(' | ')}] vẫn còn trên màn hình ` +
        `— thao tác trước đó chưa có hiệu lực.\n  Ảnh: ${shot}\n  Nội dung đọc được: ${visible}`,
    );
  }

  /**
   * Tap vào toạ độ đã học được từ lần chạy trước, bỏ qua bước OCR.
   * Trả về điểm đã tap, hoặc null nếu không có/không dùng được cache.
   *
   * Lớp chặn tại đây: toạ độ là của lần trước, màn hình là của lần này. Trước
   * khi chạm phải hỏi cây a11y xem điểm đó BÂY GIỜ là cái gì — rơi vào một node
   * mang nhãn phá huỷ thì bỏ cache chứ không tap. Xác minh sau khi tap không
   * hoàn tác được một cú tap nhầm vào "Xoá".
   */
  private async tapRemembered(
    deviceKey: string,
    stepName: string,
  ): Promise<CachedPoint | null> {
    if (!deviceKey) return null;

    const point = getCachedPoint(deviceKey, stepName);
    if (!point) return null;

    const covering = (await this.nodes()).filter(
      (n) =>
        point.x >= n.bounds.x1 &&
        point.x <= n.bounds.x2 &&
        point.y >= n.bounds.y1 &&
        point.y <= n.bounds.y2,
    );
    const danger = covering.find((n) => isDestructive(n.text) || isDestructive(n.desc));
    if (danger) {
      console.warn(
        `  ⚠ [${stepName}] Toạ độ nhớ sẵn (${point.x},${point.y}) nay rơi vào ` +
          `"${danger.text || danger.desc}" — bỏ cache, định vị lại từ đầu.`,
      );
      forgetPoint(deviceKey, stepName);
      return null;
    }

    console.log(`  ⚡ [${stepName}] Dùng toạ độ đã nhớ (${point.x},${point.y}) — bỏ qua OCR`);
    await tapAt(this.driver, point.x, point.y);
    await humanDelay();
    return point;
  }

  /**
   * Tap có nhớ toạ độ, dành cho bước mà việc xác minh diễn ra ở BƯỚC SAU.
   *
   * Ví dụ duy nhất hiện nay: mở dropdown "Người bán". Bản thân cú mở dropdown
   * không có dấu hiệu riêng nào để chờ (CLAUDE.md §8 đã bác bỏ `waitFor(['Shopee'])`
   * vì chữ "Shopee" có sẵn trên thẻ sản phẩm), nhưng bước ngay sau — chọn Shopee
   * rồi kiểm tra bộ lọc đã áp — xác minh giúp cả hai. Nơi gọi có trách nhiệm gọi
   * `forgetStep()` khi bước sau thất bại.
   */
  async tapRememberedOrFind(labels: string[], stepName: string): Promise<void> {
    const deviceKey = await this.deviceKey();
    if (await this.tapRemembered(deviceKey, stepName)) return;

    const hit = await this.tap(labels, stepName);
    if (deviceKey) rememberPoint(deviceKey, stepName, hit);
  }

  /** Quên toạ độ đã nhớ của một bước — gọi khi bước sau cho thấy tap không ăn */
  async forgetStep(stepName: string): Promise<void> {
    const deviceKey = await this.deviceKey();
    if (deviceKey) forgetPoint(deviceKey, stepName);
  }

  /**
   * Tap một nút rồi chờ dấu hiệu RIÊNG của màn hình mới xuất hiện.
   *
   * VÌ SAO CẦN HÀM RIÊNG thay vì tap() rồi waitFor(): dấu hiệu đem ra chờ phải là
   * thứ chỉ xuất hiện SAU thao tác. Bản trước tap nút "Thêm" rồi chờ nhãn
   * "Thêm sản phẩm" — nhưng chính nút vừa bấm mang nhãn đó, nên waitFor khớp lại
   * đúng cái nút cũ và báo thành công dù sheet chưa hề mở. Pipeline đi tiếp và gõ
   * link Shopee vào ô Tiêu đề của bộ sưu tập người dùng.
   *
   * Lớp chặn ở đây: dấu hiệu chờ phải VẮNG MẶT trước khi tap. Nếu nó đã có sẵn
   * thì nó không chứng minh được điều gì → dừng ngay, coi như lỗi lập trình.
   */
  async tapUntilVisible(
    tapLabels: string[],
    expectLabels: string[],
    stepName: string,
    opts: {
      attempts?: number;
      timeoutMs?: number;
      guardInTreeOnly?: boolean;
      /**
       * Cho phép tap bằng toạ độ đã học thay vì OCR lại. Mặc định TẮT.
       *
       * Chỉ bật ở những bước (a) thực sự phải OCR mới tìm được nhãn, và (b) không
       * có thao tác phá huỷ nào nằm cạnh trên cùng màn hình. Menu ngữ cảnh của bộ
       * sưu tập không thoả (b) vì "Xoá" nằm ngay đó, mà xác minh sau khi tap thì
       * không hoàn tác được một lần xoá.
       */
      useRememberedPoint?: boolean;
    } = {},
  ): Promise<void> {
    const {
      attempts = 3,
      timeoutMs = 8000,
      guardInTreeOnly = false,
      useRememberedPoint = false,
    } = opts;
    const deviceKey = useRememberedPoint ? await this.deviceKey() : '';

    // `guardInTreeOnly` chỉ được bật khi dấu hiệu chờ CHẮC CHẮN nằm trong cây
    // a11y (đã xác nhận bằng dump thật, xem CLAUDE.md §8). Khi đó lớp chặn này
    // tốn 177ms thay vì 2,6 giây — mà trường hợp bình thường là "chưa có", tức
    // là ta đang trả tiền OCR để nhận về đúng cái kết quả đã biết trước.
    const alreadyThere = guardInTreeOnly
      ? await this.findInTree(expectLabels)
      : await this.find(expectLabels);
    if (alreadyThere) {
      const shot = await this.snap(`ERROR_${stepName}_dau-hieu-co-san`);
      throw new Error(
        `[${stepName}] Dấu hiệu chờ [${expectLabels.join(' | ')}] đã hiện diện TRƯỚC khi tap ` +
          `(khớp "${alreadyThere.matched}" qua ${alreadyThere.via}). Không thể dùng nó để xác minh ` +
          `thao tác có hiệu lực — hãy chọn nhãn chỉ xuất hiện sau khi tap. Ảnh: ${shot}`,
      );
    }

    for (let i = 1; i <= attempts; i++) {
      let tapped: { x: number; y: number; matched: string } | null = null;

      // Lần trước tap mà dấu hiệu không xuất hiện → toạ độ nhớ sẵn (nếu có dùng)
      // là nghi phạm đầu tiên. Quên nó đi và định vị lại bằng OCR.
      if (i > 1 && deviceKey) forgetPoint(deviceKey, stepName);

      // ⚠️ Lần thử ĐẦU TIÊN cũng phải chịu được lỗi định vị, y như các lần sau.
      //
      // Bản trước để `this.tap()` của lần 1 nằm NGOÀI try/catch, nên khi nút chưa
      // render kịp thì `tap()` ném "Không tìm thấy [...]" và **thoát thẳng khỏi
      // hàm** — vòng lặp 3 lần ở đây chưa bao giờ chạy cho kiểu hỏng đó. Nghĩa là
      // lớp retry mà mọi lời gọi đang tin tưởng chỉ bảo vệ được MỘT trong hai kiểu
      // hỏng: "tap rồi mà không ăn". Kiểu còn lại — "chưa thấy nút để mà tap" —
      // đi thẳng ra ngoài thành job hỏng, rồi BullMQ retry lại cả job ~30 giây.
      //
      // Quan sát thật 2026-08-19 ở `mo-them-san-pham`: ảnh lỗi cho thấy nút CÓ trên
      // màn, cây a11y lúc dump CÓ nhãn — nó chỉ chưa có vào đúng lúc find() hỏi.
      // Một lượt thử lại sau vài trăm mili-giây là đủ, nhưng lượt đó không tồn tại.
      //
      // Đây là biến thể của §4.4 "không nuốt lỗi": ta không nuốt gì cả — lỗi vẫn
      // được ghi và vẫn ném ra nếu HẾT các lần thử, chỉ là nó không còn cắt ngang
      // chính cơ chế sinh ra để xử lý nó.
      try {
        if (i === 1) {
          // Lần đầu: thử toạ độ đã học. Không có thì định vị đầy đủ (a11y → OCR).
          tapped = await this.tapRemembered(deviceKey, stepName);
        }
        if (!tapped) tapped = await this.tap(tapLabels, stepName);
      } catch (err) {
        console.warn(
          `  ⚠ [${stepName}] lần ${i}/${attempts}: chưa tap được ` +
            `(${err instanceof Error ? err.message.split('\n')[0] : String(err)})`,
        );
        // Chưa định vị được thì phần lớn là màn hình còn đang render. Nghỉ ngắn
        // rồi thử lại rẻ hơn nhiều so với để cả job hỏng và BullMQ chạy lại 30 giây.
        if (i < attempts) await new Promise((r) => setTimeout(r, 600));
      }

      // guardInTreeOnly nghĩa là dấu hiệu chờ đã được xác nhận nằm trong cây a11y,
      // nên vòng chờ cũng tra bằng cây được — bỏ chụp ảnh + OCR mỗi lượt, và hỏi
      // dày hơn vì mỗi lượt rẻ đi ~5 lần.
      if (await this.pollFor(expectLabels, timeoutMs, guardInTreeOnly ? 400 : 1000, guardInTreeOnly)) {
        // Chỉ ghi nhớ toạ độ SAU KHI đã xác minh thao tác có hiệu lực. Ghi trước
        // thì ta đang lưu lại một cú tap chưa biết đúng sai.
        if (tapped && deviceKey) rememberPoint(deviceKey, stepName, tapped);
        return;
      }

      console.warn(
        `  ⚠ [${stepName}] lần ${i}/${attempts}: đã tap nhưng ` +
          `[${expectLabels.join(' | ')}] chưa xuất hiện sau ${timeoutMs / 1000}s`,
      );
    }

    const shot = await this.snap(`ERROR_${stepName}`);
    const visible = await this.describeScreen();
    throw new Error(
      `[${stepName}] Tap [${tapLabels.join(' | ')}] ${attempts} lần nhưng ` +
        `[${expectLabels.join(' | ')}] không xuất hiện — thao tác không có hiệu lực.\n` +
        `  Ảnh: ${shot}\n  Nội dung đọc được: ${visible}`,
    );
  }

  /**
   * Xác nhận đang ở đúng màn hình mong đợi. Gọi sau mỗi bước điều hướng để
   * phát hiện ngay khi lạc màn hình, thay vì phát hiện ở cuối pipeline.
   */
  async expect(labels: string[], stepName: string): Promise<void> {
    const hit = await this.find(labels);
    if (!hit) {
      const shot = await this.snap(`ERROR_expect_${stepName}`);
      const visible = await this.describeScreen();
      throw new Error(
        `[${stepName}] Màn hình không như mong đợi — không thấy [${labels.join(' | ')}].\n` +
          `  Ảnh màn hình: ${shot}\n` +
          `  Nội dung đọc được: ${visible}`,
      );
    }
  }

  /** Mô tả những gì đọc được trên màn hình — phục vụ thông báo lỗi và gỡ rối */
  async describeScreen(): Promise<string> {
    const nodes = await this.nodes();
    const a11y = nodes
      .filter((n) => n.text || n.desc)
      .map((n) => n.text || n.desc)
      .slice(0, 15);

    let ocrLines: string[] = [];
    const shotPath = await this.snap(`_desc_${Date.now()}`);
    try {
      const ocr = await readScreen(shotPath);
      ocrLines = ocr.lines
        .filter((l) => l.confidence >= 60 && l.text.length > 1)
        .map((l) => l.text)
        .slice(0, 20);
    } catch {
      // OCR hỏng thì vẫn báo được phần a11y
    } finally {
      fs.promises.unlink(shotPath).catch(() => {});
    }

    return `a11y=[${a11y.join(' | ')}] ocr=[${ocrLines.join(' | ')}]`;
  }

  /**
   * Gõ chữ vào ô nhập được CHỈ ĐỊNH THEO NHÃN.
   *
   * VÌ SAO KHÔNG LẤY "Ô EDITTEXT ĐẦU TIÊN" như bản trước: khi sheet "Thêm sản phẩm"
   * mở đè lên sheet "Chỉnh sửa bộ sưu tập", cây phần tử vẫn còn ô Tiêu đề của sheet
   * bên dưới và ô đó đứng trước trong cây. Kết quả: link Shopee bị gõ thẳng vào
   * tiêu đề bộ sưu tập của người dùng, và cú click còn làm sheet "Thêm sản phẩm"
   * đóng lại. Phải chỉ đích danh ô cần gõ.
   */
  async typeIntoLabeledInput(
    labels: string[],
    value: string,
    stepName: string,
  ): Promise<void> {
    const deviceKey = await this.deviceKey();

    // Hai lượt: lượt đầu có thể dùng toạ độ đã nhớ, lượt hai luôn định vị lại
    // đầy đủ. Kiểm tra con trỏ ở dưới chính là lớp xác minh cho toạ độ nhớ sẵn —
    // ô không nhận con trỏ nghĩa là tap trượt, và ta còn nguyên đường lui.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remembered = attempt === 1 && deviceKey ? getCachedPoint(deviceKey, stepName) : null;
      let point: { x: number; y: number; matched: string };

      if (remembered) {
        console.log(
          `  ⚡ [${stepName}] Dùng toạ độ ô nhập đã nhớ (${remembered.x},${remembered.y})`,
        );
        point = remembered;
      } else {
        const field = await this.find(labels);
        if (!field) {
          const shot = await this.snap(`ERROR_${stepName}_khong-thay-o-nhap`);
          const visible = await this.describeScreen();
          throw new Error(
            `[${stepName}] Không tìm thấy ô nhập [${labels.join(' | ')}].\n` +
              `  Ảnh: ${shot}\n  Nội dung đọc được: ${visible}`,
          );
        }
        point = { x: field.x, y: field.y, matched: field.matched };
      }

      await tapAt(this.driver, point.x, point.y);
      await humanDelay(400, 800);

      // Chỉ gõ vào ô ĐANG giữ con trỏ. Nếu cú tap không đưa được focus vào ô nhập
      // nào thì dừng hẳn — thà báo lỗi còn hơn gõ lạc sang ô khác.
      const focused = await this.driver.$(
        'android=new UiSelector().focused(true).className("android.widget.EditText")',
      );

      if (await focused.isExisting()) {
        await focused.setValue(value);
        if (deviceKey) rememberPoint(deviceKey, stepName, point);
        return;
      }

      if (remembered) {
        console.warn(
          `  ⚠ [${stepName}] Toạ độ nhớ sẵn không đưa được con trỏ vào ô nhập — ` +
            `bỏ cache và định vị lại bằng OCR.`,
        );
        forgetPoint(deviceKey, stepName);
        continue;
      }

      const shot = await this.snap(`ERROR_${stepName}_khong-co-focus`);
      throw new Error(
        `[${stepName}] Đã tap vào "${point.matched}" nhưng không ô nhập nào nhận con trỏ. ` +
          `Từ chối gõ để tránh ghi nhầm ô. Ảnh: ${shot}`,
      );
    }

    // Không tới được: lượt 2 luôn kết thúc bằng return hoặc throw ở trên.
    throw new Error(`[${stepName}] Không gõ được vào ô nhập sau 2 lần thử.`);
  }
}
