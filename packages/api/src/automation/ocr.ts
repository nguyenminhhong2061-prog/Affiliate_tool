/**
 * OCR đọc chữ trên ảnh chụp màn hình.
 *
 * Lý do cần OCR: app YouTube Studio vẽ hầu hết chữ bằng canvas nên không đưa vào
 * accessibility tree (khảo sát thực tế: màn Mua sắm chỉ có 4/85 node mang nhãn).
 * Muốn tìm "Tuyển tập", "Thêm", "Xong", "Đăng"... phải đọc ảnh như mắt người.
 */
import { createWorker, type Worker } from 'tesseract.js';
import { metrics } from './metrics';

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  words: OcrWord[];
  lines: OcrLine[];
}

let workerPromise: Promise<Worker> | null = null;

/**
 * Worker OCR dùng chung — khởi tạo tốn vài giây và tải dữ liệu ngôn ngữ tiếng Việt,
 * nên giữ lại một instance cho toàn bộ vòng đời tiến trình.
 */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('vie');
  }
  return workerPromise;
}

export async function closeOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

/**
 * Chạy OCR trên một file ảnh, trả về danh sách từ và dòng kèm toạ độ.
 *
 * Đo tại đây chứ không tại nơi gọi: OCR là khoản chi lớn nhất và có nhiều đường
 * vào (Screen.find, Screen.describeScreen, readProductTitle), đếm ở gốc mới
 * không sót đường nào.
 */
export async function readScreen(imagePath: string): Promise<OcrResult> {
  return metrics.time('ocr', () => runOcr(imagePath));
}

async function runOcr(imagePath: string): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imagePath, {}, { blocks: true });

  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];

  // tesseract.js v6+ trả cấu trúc lồng: blocks → paragraphs → lines → words
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        lines.push({
          text: line.text.trim(),
          confidence: line.confidence,
          bbox: line.bbox,
        });
        for (const word of line.words ?? []) {
          words.push({
            text: word.text.trim(),
            confidence: word.confidence,
            bbox: word.bbox,
          });
        }
      }
    }
  }

  return { words, lines };
}

/** Bỏ dấu tiếng Việt + hạ chữ thường, để so khớp chịu được lỗi nhận dạng dấu */
export function normalizeVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tìm nhãn trên màn hình. So khớp trên dòng trước (chính xác hơn với cụm nhiều từ),
 * sau đó tới từng từ. Bỏ dấu hai phía để chịu được sai sót OCR với dấu tiếng Việt.
 *
 * @returns toạ độ tâm của vùng chữ khớp, hoặc null nếu không tìm thấy
 */
export function locateLabel(
  ocr: OcrResult,
  label: string,
  minConfidence = 45,
): { x: number; y: number; matched: string; confidence: number } | null {
  const needle = normalizeVi(label);

  const candidates: Array<{ text: string; confidence: number; bbox: OcrWord['bbox'] }> = [
    ...ocr.lines,
    ...ocr.words,
  ];

  // Ưu tiên khớp chính xác, sau đó mới tới khớp chứa
  const exact = candidates.find(
    (c) => c.confidence >= minConfidence && normalizeVi(c.text) === needle,
  );
  const partial = candidates.find(
    (c) => c.confidence >= minConfidence && normalizeVi(c.text).includes(needle),
  );

  const hit = exact ?? partial;
  if (!hit) return null;

  return {
    x: Math.round((hit.bbox.x0 + hit.bbox.x1) / 2),
    y: Math.round((hit.bbox.y0 + hit.bbox.y1) / 2),
    matched: hit.text,
    confidence: hit.confidence,
  };
}
