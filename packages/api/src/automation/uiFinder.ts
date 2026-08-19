/**
 * Tiện ích định vị phần tử cho app YouTube Studio.
 *
 * Bối cảnh: app này vẽ phần lớn chữ bằng canvas nên KHÔNG expose `text` vào
 * accessibility tree — chỉ một phần node có `content-desc`. Vì vậy chiến lược
 * tìm phần tử phải phối hợp nhiều lớp:
 *   1. UiSelector theo description / text (khi app có expose)
 *   2. Phân tích trực tiếp page source, lấy `bounds` rồi tap theo toạ độ tâm
 *
 * Nguyên tắc: KHÔNG nuốt lỗi. Không tìm thấy thì ném lỗi để pipeline dừng ngay,
 * tránh tình trạng các bước sau tap mù vào màn hình sai.
 */

export interface UiNode {
  className: string;
  text: string;
  desc: string;
  resourceId: string;
  clickable: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
}

/** Tâm của một node — dùng để tap theo toạ độ */
export function centerOf(node: UiNode): { x: number; y: number } {
  return {
    x: Math.round((node.bounds.x1 + node.bounds.x2) / 2),
    y: Math.round((node.bounds.y1 + node.bounds.y2) / 2),
  };
}

/** Bóc toàn bộ node từ page source XML của UiAutomator2 */
export function parseNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  // Mỗi phần tử bắt đầu bằng '<' và kết thúc bằng '>' — tách theo dấu '>'
  for (const chunk of xml.split(/(?<=>)/g)) {
    const boundsRaw = chunk.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsRaw) continue;
    nodes.push({
      className: chunk.match(/class="([^"]*)"/)?.[1] ?? '',
      text: chunk.match(/\btext="([^"]*)"/)?.[1] ?? '',
      desc: chunk.match(/content-desc="([^"]*)"/)?.[1] ?? '',
      resourceId: chunk.match(/resource-id="([^"]*)"/)?.[1] ?? '',
      clickable: /clickable="true"/.test(chunk),
      bounds: {
        x1: parseInt(boundsRaw[1], 10),
        y1: parseInt(boundsRaw[2], 10),
        x2: parseInt(boundsRaw[3], 10),
        y2: parseInt(boundsRaw[4], 10),
      },
    });
  }
  return nodes;
}

/**
 * Chuẩn hoá chuỗi trước khi so khớp.
 *
 * QUAN TRỌNG: Android trả chuỗi tiếng Việt ở dạng Unicode tổ hợp (NFD — dấu nằm
 * tách rời), còn chuỗi literal trong mã nguồn ở dạng dựng sẵn (NFC). Hai chuỗi
 * hiển thị giống hệt nhau nhưng `===` trả về false ("Chọn sản phẩm" là 16 ký tự
 * từ app, 13 ký tự trong code). Không có bước normalize('NFC') này thì MỌI nhãn
 * tiếng Việt có dấu đều không bao giờ khớp.
 */
export function normalizeText(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const normalize = normalizeText;

/** Tìm các node có text hoặc content-desc chứa `label` (không phân biệt hoa thường) */
export function findNodesByLabel(nodes: UiNode[], label: string): UiNode[] {
  const needle = normalize(label);
  return nodes.filter(
    (n) => normalize(n.text).includes(needle) || normalize(n.desc).includes(needle),
  );
}

/**
 * Tìm node khớp `label`, ưu tiên node clickable; nếu node khớp không clickable
 * thì vẫn trả về nó (ta sẽ tap theo toạ độ tâm — hoạt động với cả node cha
 * clickable bao ngoài).
 */
export function findNodeByLabel(nodes: UiNode[], label: string): UiNode | null {
  const matches = findNodesByLabel(nodes, label);
  if (matches.length === 0) return null;

  // Ưu tiên khớp CHÍNH XÁC trước khi chấp nhận khớp chứa.
  //
  // Màn "Chỉnh sửa bộ sưu tập" có cả nút "Thêm" lẫn liên kết "Tìm hiểu thêm".
  // Khớp chứa + ưu tiên clickable sẽ trúng liên kết nằm phía trên và tap trượt
  // nút cần bấm — sheet không mở ra, còn pipeline thì tưởng đã mở.
  const needle = normalize(label);
  const exact = matches.filter(
    (n) => normalize(n.text) === needle || normalize(n.desc) === needle,
  );

  const pool = exact.length > 0 ? exact : matches;
  return pool.find((n) => n.clickable) ?? pool[0];
}

/** Tap theo toạ độ tuyệt đối bằng W3C actions */
export async function tapAt(
  driver: WebdriverIO.Browser,
  x: number,
  y: number,
): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 90 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
  await driver.releaseActions();
}

/**
 * Tìm phần tử theo nhãn rồi tap. Ném lỗi nếu không tìm thấy — KHÔNG im lặng bỏ qua.
 * @param labels danh sách nhãn thay thế nhau (ví dụ ['Tuyển tập', 'Bộ sưu tập'])
 */
export async function tapByLabel(
  driver: WebdriverIO.Browser,
  labels: string[],
  stepName: string,
): Promise<UiNode> {
  const xml = await driver.getPageSource();
  const nodes = parseNodes(xml);

  for (const label of labels) {
    const node = findNodeByLabel(nodes, label);
    if (node) {
      const { x, y } = centerOf(node);
      await tapAt(driver, x, y);
      return node;
    }
  }

  const available = nodes
    .filter((n) => n.text || n.desc)
    .map((n) => `"${n.text || n.desc}"`)
    .slice(0, 30)
    .join(', ');
  throw new Error(
    `[${stepName}] Không tìm thấy phần tử khớp [${labels.join(' | ')}]. ` +
      `Các nhãn đang có trên màn hình: ${available || '(màn hình không expose nhãn nào)'}`,
  );
}
