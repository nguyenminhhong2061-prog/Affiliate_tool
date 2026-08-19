/**
 * Hồi quy cho luật huỷ session Appium. **KHÔNG cần điện thoại.**
 *
 *   npx ts-node src/scripts/checkSessionDisposal.ts
 *
 * ── Vì sao cần ──────────────────────────────────────────────────────────────
 * Luật cũ huỷ session cho MỌI lỗi không phải lỗi đầu vào. Lô 5 job thật ngày
 * 2026-08-19 cho thấy cái giá: hai lượt hỏng vì bước giao diện trượt đã giết
 * session, bắt job kế tiếp trả 12,1 s và 11,2 s dựng lại — 23,3 giây lãng phí
 * cho một lý do không nói gì về sức khoẻ của session.
 *
 * Bài kiểm này dùng ĐÚNG NGUYÊN VĂN thông báo lỗi đã quan sát được trong lô đó,
 * chứ không phải chuỗi tự nghĩ ra. Một bài test dựng bằng chuỗi tưởng tượng chỉ
 * chứng minh hàm khớp được chuỗi tưởng tượng ấy.
 */
import { LoiDauVao, coNenHuySession } from '../automation/errors';

interface Ca {
  ten: string;
  err: unknown;
  lanThu: number;
  huyMongDoi: boolean;
}

const CAC_CA: Ca[] = [
  // ── GIỮ session: lỗi ở một bước giao diện ────────────────────────────────
  {
    ten: 'L3 thật — chờ kết quả tìm kiếm quá hạn',
    err: new Error('[cho-ket-qua-tim-kiem-tho] Chờ 20s vẫn không thấy kết quả tìm kiếm.'),
    lanThu: 1,
    huyMongDoi: false,
  },
  {
    ten: 'L5 thật — không tìm thấy nút Thêm',
    err: new Error('[mo-them-san-pham] Không tìm thấy [Thêm].'),
    lanThu: 1,
    huyMongDoi: false,
  },
  {
    ten: 'tap không ăn sau 3 lần',
    err: new Error('[chon-chinh-sua] Tap [Chỉnh sửa] 3 lần nhưng sheet không mở'),
    lanThu: 1,
    huyMongDoi: false,
  },
  {
    ten: 'không thấy bộ sưu tập theo tên',
    err: new Error('Không thấy bộ sưu tập tên "24/04". Hiện có: SP 6M-8M, SP 5M-6M'),
    lanThu: 1,
    huyMongDoi: false,
  },

  // ── GIỮ session: lỗi đầu vào ─────────────────────────────────────────────
  {
    ten: 'lỗi đầu vào — sản phẩm đã có sẵn',
    err: new LoiDauVao('Sản phẩm này đã có trong bộ sưu tập rồi.'),
    lanThu: 1,
    huyMongDoi: false,
  },
  {
    ten: 'lỗi đầu vào ở lần thử 3 vẫn GIỮ (không retry nên không tới đây, nhưng phải đúng)',
    err: new LoiDauVao('Sản phẩm này không nằm trong diện được nhận voucher.'),
    lanThu: 3,
    huyMongDoi: false,
  },

  // ── HUỶ session: kênh điều khiển hỏng ────────────────────────────────────
  {
    ten: 'session Appium đã chết',
    err: new Error('invalid session id: session is either terminated or not started'),
    lanThu: 1,
    huyMongDoi: true,
  },
  {
    ten: 'không nối được Appium server',
    err: new Error('connect ECONNREFUSED 127.0.0.1:4723'),
    lanThu: 1,
    huyMongDoi: true,
  },
  {
    ten: 'UiAutomator2 trên máy sập',
    err: new Error('The instrumentation process is not running (probably crashed)'),
    lanThu: 1,
    huyMongDoi: true,
  },
  {
    ten: 'thiết bị rớt USB',
    err: new Error("adb.exe: device 'rg4lijbinzlb657d' not found"),
    lanThu: 1,
    huyMongDoi: true,
  },
  {
    ten: 'nhận qua err.name chứ không qua message',
    err: Object.assign(new Error('something went wrong'), { name: 'NoSuchDriver' }),
    lanThu: 1,
    huyMongDoi: true,
  },

  // ── HUỶ session: van an toàn ở lần thử ≥ 2 ───────────────────────────────
  {
    ten: 'VAN AN TOÀN — cùng lỗi giao diện nhưng ở lần thử 2',
    err: new Error('[mo-them-san-pham] Không tìm thấy [Thêm].'),
    lanThu: 2,
    huyMongDoi: true,
  },
  {
    ten: 'VAN AN TOÀN — lần thử 3',
    err: new Error('[cho-ket-qua-tim-kiem-tho] Chờ 20s vẫn không thấy kết quả tìm kiếm.'),
    lanThu: 3,
    huyMongDoi: true,
  },
];

let hong = 0;
for (const ca of CAC_CA) {
  const { huy, lyDo } = coNenHuySession(ca.err, ca.lanThu);
  const dat = huy === ca.huyMongDoi;
  if (!dat) hong++;
  console.log(
    `${dat ? '✅' : '❌'} ${(huy ? 'HUỶ ' : 'GIỮ ').padEnd(5)} lần ${ca.lanThu}  ${ca.ten}`,
  );
  if (!dat) console.log(`      mong đợi ${ca.huyMongDoi ? 'HUỶ' : 'GIỮ'}, lý do đưa ra: ${lyDo}`);
}

// ── Ca then chốt: đúng lô 5 job hôm 2026-08-19 sẽ tiết kiệm bao nhiêu ──────
const loLo = [
  new Error('[cho-ket-qua-tim-kiem-tho] Chờ 20s vẫn không thấy kết quả tìm kiếm.'), // L3
  new Error('[mo-them-san-pham] Không tìm thấy [Thêm].'), // L5
];
const soLanHuy = loLo.filter((e) => coNenHuySession(e, 1).huy).length;
console.log(
  `\nLô 5 job hôm 2026-08-19: luật cũ dựng lại session ${loLo.length} lần (23,3 s), ` +
    `luật mới ${soLanHuy} lần.`,
);
if (soLanHuy !== 0) hong++;

console.log(hong === 0 ? '\n🎉 TẤT CẢ ĐỀU ĐẠT' : `\n💥 ${hong} ca HỎNG`);
process.exit(hong === 0 ? 0 : 1);
