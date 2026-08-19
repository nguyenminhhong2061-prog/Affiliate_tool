/**
 * Phân tích chi tiết từng LƯỢT CHẠY: bước, mốc tích luỹ, loại thao tác,
 * và phần "dư" (thời gian app phản hồi, không nằm trong khoản nào đo được).
 */
import * as fs from 'fs';

interface Run {
  idx: number;
  job: string;
  link: string;
  ok: boolean;
  err?: string;
  reusedSession: boolean;
  total: number;
  steps: { name: string; dur: number; mark: number }[];
  ops: { name: string; n: number; sec: number }[];
}

const LINKS: Record<string, string> = {
  e70d4ea0: '1 · Áo Hoodie Zip',
  a0fbe800: '2 · Áo len ROWAY',
  '92b7ea45': '3 · Giày Asics',
  bc51290a: '4 · Máy cạo râu',
  '8a24aac5': '5 · OPPO Reno12',
};

const log = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const runs: Run[] = [];
let cur: Run | null = null;
let inTable = false;
let sect: 'ops' | 'steps' | null = null;

for (const line of log) {
  const b = line.match(/🚀 Bắt đầu Job ID: ([0-9a-f]{8})/);
  if (b) {
    cur = {
      idx: runs.length + 1,
      job: b[1],
      link: LINKS[b[1]] ?? b[1],
      ok: false,
      reusedSession: false,
      total: 0,
      steps: [],
      ops: [],
    };
    continue;
  }
  if (!cur) continue;

  if (line.includes('Dùng lại session Appium')) cur.reusedSession = true;
  if (/✅ Hoàn thành Job [0-9a-f]/.test(line)) cur.ok = true;
  const f = line.match(/❌ Job [0-9a-f-]+ thất bại: (.+)$/);
  if (f) cur.err = f[1].trim();

  if (line.includes('CHI PHÍ LẦN CHẠY')) { inTable = true; sect = null; continue; }
  if (!inTable) continue;

  const t = line.match(/│ Tổng:\s*([\d.]+)s/);
  if (t) cur.total = parseFloat(t[1]);
  if (line.includes('Theo loại thao tác')) { sect = 'ops'; continue; }
  if (line.includes('Theo bước')) { sect = 'steps'; continue; }

  if (sect === 'ops') {
    const m = line.match(/│\s+(\S+)\s+(\d+) lần\s+([\d.]+)s/);
    if (m) cur.ops.push({ name: m[1], n: +m[2], sec: parseFloat(m[3]) });
  }
  if (sect === 'steps') {
    const m = line.match(/│\s+(\S+)\s+\+\s*([\d.]+)s\s+\(mốc ([\d.]+)s\)/);
    if (m) cur.steps.push({ name: m[1], dur: parseFloat(m[2]), mark: parseFloat(m[3]) });
  }

  if (line.includes('└──')) { inTable = false; sect = null; runs.push(cur); cur = null; }
}

const f1 = (n: number) => n.toFixed(1).padStart(6) + 's';

for (const r of runs) {
  const measured = r.ops.reduce((s, o) => s + o.sec, 0);
  const du = r.total - measured;
  const head =
    `LƯỢT ${r.idx} · link ${r.link} · ${r.ok ? '✅ THÀNH CÔNG' : '❌ HỎNG'} · ` +
    `${r.total.toFixed(1)}s · session ${r.reusedSession ? 'TÁI DÙNG' : 'DỰNG MỚI'}`;
  console.log('\n' + '═'.repeat(78));
  console.log(head);
  if (r.err) console.log('  lỗi: ' + r.err.slice(0, 110));
  console.log('═'.repeat(78));

  console.log('  BƯỚC                            thời lượng   %tổng   mốc tích luỹ');
  for (const s of r.steps) {
    const pct = ((s.dur / r.total) * 100).toFixed(0).padStart(4);
    console.log(`    ${s.name.padEnd(30)}${f1(s.dur)}  ${pct}%   ${f1(s.mark)}`);
  }

  console.log('  LOẠI THAO TÁC                   thời lượng   %tổng   số lần   ms/lần');
  for (const o of r.ops) {
    const pct = ((o.sec / r.total) * 100).toFixed(0).padStart(4);
    const per = ((o.sec * 1000) / o.n).toFixed(0).padStart(6);
    console.log(`    ${o.name.padEnd(30)}${f1(o.sec)}  ${pct}%   ${String(o.n).padStart(6)}   ${per}`);
  }
  console.log(`    ${'— cộng khoản ĐO ĐƯỢC'.padEnd(30)}${f1(measured)}  ${((measured / r.total) * 100).toFixed(0).padStart(4)}%`);
  console.log(`    ${'— PHẦN DƯ (app phản hồi)'.padEnd(30)}${f1(du)}  ${((du / r.total) * 100).toFixed(0).padStart(4)}%`);
}

// ── Tổng hợp riêng các lượt THÀNH CÔNG ──
const ok = runs.filter((r) => r.ok);
console.log('\n' + '═'.repeat(78));
console.log(`TỔNG HỢP ${ok.length} LƯỢT THÀNH CÔNG`);
console.log('═'.repeat(78));

const allSteps = [...new Set(ok.flatMap((r) => r.steps.map((s) => s.name)))];
console.log('  BƯỚC'.padEnd(34) + ok.map((r) => `L${r.idx}`.padStart(9)).join('') + '     TB    %TB');
for (const name of allSteps) {
  const vals = ok.map((r) => r.steps.find((s) => s.name === name)?.dur ?? 0);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const avgTotal = ok.reduce((s, r) => s + r.total, 0) / ok.length;
  console.log(
    `    ${name.padEnd(30)}` +
      vals.map((v) => (v.toFixed(1) + 's').padStart(9)).join('') +
      `${avg.toFixed(1).padStart(7)}s ${((avg / avgTotal) * 100).toFixed(0).padStart(4)}%`,
  );
}
const avgTotal = ok.reduce((s, r) => s + r.total, 0) / ok.length;
console.log(`    ${'TỔNG'.padEnd(30)}` + ok.map((r) => (r.total.toFixed(1) + 's').padStart(9)).join('') + `${avgTotal.toFixed(1).padStart(7)}s`);
