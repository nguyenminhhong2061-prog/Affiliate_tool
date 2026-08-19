import { Worker, Job, UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { jobs } from '../db/schema';
import { createRedisConnection } from '../redis';
import { YOUTUBE_TAGGING_QUEUE_NAME, type YoutubeTaggingJobData } from './queue';
import { tagShopeeProductOnYoutube } from '../automation/youtubeAutomation';
import { youtubeCircuitBreaker } from '../automation/circuitBreaker';
import { laLoiDauVao } from '../automation/errors';
import { saveJobResult, getJobResult } from '../services/jobResult';

/**
 * Hàm xử lý chính cho từng job trong hàng đợi
 */
async function processYoutubeTaggingJob(job: Job<YoutubeTaggingJobData>) {
  const { jobId, shopeeUrl, shopeeProductId } = job.data;
  console.log(`[Worker] Bắt đầu xử lý Job ID: ${jobId} (Link: ${shopeeUrl})`);

  // 0. CHỐT CHẶN IDEMPOTENT — phải đứng trước mọi thứ khác, kể cả circuit breaker.
  //
  // Sự cố 2026-08-17 (job daca8661): job chạy XONG và đúng — sản phẩm đã gắn, link
  // affiliate đã ghi vào Redis — nhưng BullMQ mất lock giữa chừng nên không ghi
  // nhận được kết quả (`Missing lock ... moveToFinished`). Nó coi job là stalled và
  // chạy lại 2 lần nữa TRÊN ĐIỆN THOẠI THẬT, rồi báo `failed` cho người dùng trong
  // khi link vẫn nằm nguyên trong Redis.
  //
  // Nguyên nhân gốc (execSync chặn event loop) đã sửa ở adb.ts, và lock đã nới ở
  // dưới. Nhưng chốt chặn này vẫn cần, vì nó chặn theo KẾT QUẢ chứ không theo
  // nguyên nhân: bất kỳ lý do nào khiến một job đã xong bị chạy lại — mất lock,
  // tiến trình chết đúng lúc, ai đó bấm retry trên Bull Board — đều dừng ở đây,
  // trước khi kịp đụng vào bộ sưu tập thật.
  //
  // Sự tồn tại của `job:result:<id>` là bằng chứng đủ mạnh: nó CHỈ được ghi ở
  // nhánh thành công, sau khi đã trích được link affiliate đúng sản phẩm.
  const existingResult = await getJobResult(jobId);
  if (existingResult) {
    console.warn(
      `[Worker] ⚠️ Job ${jobId} đã có kết quả trong Redis — bỏ qua, KHÔNG chạy lại automation. ` +
        `(Link hết hạn lúc ${existingResult.expiresAt})`,
    );

    // Trả DB về đúng sự thật: job này thành công. Giữ nguyên completed_at cũ nếu
    // có — đó là mốc của lần chạy thật, chính xác hơn thời điểm phát hiện lại.
    const [row] = await db
      .select({ completedAt: jobs.completedAt })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    await db
      .update(jobs)
      .set({
        status: 'done',
        errorMessage: null,
        completedAt: row?.completedAt ?? new Date(),
      })
      .where(eq(jobs.id, jobId));

    return { jobId, expiresAt: existingResult.expiresAt };
  }

  // 1. Kiểm tra Circuit Breaker (Cầu chì an toàn)
  if (!youtubeCircuitBreaker.canExecute()) {
    const errorMsg = '[CircuitBreaker] Cầu chì đang ở trạng thái OPEN. Tạm ngắt worker để bảo vệ tài khoản.';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Cập nhật trạng thái DB -> 'processing'
  await db
    .update(jobs)
    .set({ status: 'processing' })
    .where(eq(jobs.id, jobId));

  await job.updateProgress(20);

  // 3. Thực thi Appium + HTTP fetch Automation Pipeline
  try {
    const result = await tagShopeeProductOnYoutube({
      jobId,
      shopeeUrl,
      shopeeProductId,
      // BullMQ đếm từ 0 ở lần chạy đầu; automation muốn "lần thử thứ mấy" nên +1.
      // Dùng cho van an toàn: hỏng lại ở lần thử ≥ 2 thì huỷ session (errors.ts).
      lanThu: job.attemptsMade + 1,
    });

    await job.updateProgress(90);

    // Ghi nhận thành công cho Circuit Breaker
    youtubeCircuitBreaker.recordSuccess();

    // 4a. Link affiliate có hạn sử dụng → lưu tạm vào Redis kèm TTL, KHÔNG ghi
    //     vào PostgreSQL để tránh trả link đã hết hiệu lực cho người dùng.
    const stored = await saveJobResult(jobId, result.affiliateUrl, result.voucher);

    // 4b. DB chỉ giữ trạng thái job, không giữ link
    await db
      .update(jobs)
      .set({
        status: 'done',
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    await job.updateProgress(100);
    console.log(
      `[Worker] ✅ Hoàn thành Job ID: ${jobId} -> Link hết hạn lúc ${stored.expiresAt}`,
    );

    // Không trả link trong kết quả BullMQ: giá trị này được BullMQ lưu lại và
    // hiển thị công khai trên Bull Board, nằm ngoài vòng đời TTL mà ta kiểm soát.
    return {
      jobId,
      expiresAt: stored.expiresAt,
    };
  } catch (err: any) {
    // ── Lỗi ĐẦU VÀO: dừng ngay, không retry, không đụng cầu chì ──────────────
    //
    // Link của người dùng không tự đổi giữa các lần thử, nên retry chỉ bắt họ chờ
    // 3 × ~40 giây để nhận đúng thông báo mà lần đầu đã biết. Và đếm nó vào cầu
    // chì làm hỏng job của NGƯỜI KHÁC: quan sát thật 2026-08-17, một link xấu
    // hỏng 3 lần đã khiến job kế tiếp bị từ chối dù link hợp lệ (nợ 7.5g).
    //
    // `UnrecoverableError` là cách BullMQ hiểu "đừng thử lại" — nó chuyển job
    // sang failed ngay lập tức, bỏ qua số lần thử còn lại.
    if (laLoiDauVao(err)) {
      console.warn(`[Worker] Job ${jobId} dừng vì lỗi đầu vào (không retry): ${err.message}`);
      throw new UnrecoverableError(err.message);
    }

    // Ghi nhận thất bại cho Circuit Breaker
    youtubeCircuitBreaker.recordFailure(err.message);
    throw err;
  }
}

// Khởi tạo BullMQ Worker với CONCURRENCY = 1 (Ràng buộc cứng xử lý tuần tự)
export function initWorker() {
  const worker = new Worker<YoutubeTaggingJobData>(
    YOUTUBE_TAGGING_QUEUE_NAME,
    processYoutubeTaggingJob,
    {
      connection: createRedisConnection(), // Worker phải có kết nối riêng
      concurrency: 1, // CHỈ XỬ LÝ TUẦN TỰ 1 JOB TẠI 1 THỜI ĐIỂM
      limiter: {
        max: 1,
        duration: 3000, // Khoảng cách tối thiểu 3 giây giữa các job
      },

      // ── Vì sao phải đặt tường minh, đừng để mặc định ──────────────────────
      // Mặc định của BullMQ là 30 giây, gia hạn bằng timer ở mốc 15 giây. Job ở
      // đây chạy 65-107 giây và có những quãng dài không nhường event loop, nên
      // 30 giây là quá sát: ngày 2026-08-17 một job đã THÀNH CÔNG bị mất lock,
      // BullMQ coi là stalled rồi chạy lại 2 lần trên điện thoại thật.
      //
      // 5 phút = gấp ~3 lần job chậm nhất từng đo (107 s). Cái giá của số lớn là
      // job của một worker chết thật sẽ nằm im lâu hơn trước khi được cứu — chấp
      // nhận được, vì worker chạy 1 tiến trình và người vận hành thấy ngay.
      lockDuration: 300000,

      // Nhịp quét job stalled. Giữ ngắn hơn nhiều so với lockDuration để khi
      // worker chết thật thì phát hiện sớm, mà vẫn không nhầm job đang chạy.
      stalledInterval: 60000,

      // Một job chỉ được cứu vì stalled ĐÚNG MỘT LẦN. Lần thứ hai coi như hỏng
      // hẳn, thay vì lặp vô hạn trên thiết bị thật.
      maxStalledCount: 1,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[Worker Event] Job ${job.id} đã hoàn thành trong hàng đợi.`);
  });

  worker.on('failed', async (job, err) => {
    const jobId = job?.data?.jobId;
    if (!jobId) {
      console.error('[Worker Event] Job thất bại nhưng không đọc được jobId:', err.message);
      return;
    }

    // BullMQ bắn sự kiện 'failed' sau MỖI lần thử, không phải chỉ lần cuối
    // (đã đo với bullmq 6.1.0: attempts=3 → sự kiện bắn 3 lần).
    //
    // Ghi 'failed' vào DB ngay lần thử đầu gây hai hậu quả thật:
    //   1. Người dùng đang hỏi trạng thái sẽ thấy "thất bại" kèm thông báo lỗi,
    //      trong khi job vẫn đang chờ retry và nhiều khả năng sẽ thành công.
    //   2. Chốt chặn "mỗi người 1 job" chỉ tính pending/processing, nên job bị
    //      đánh dấu failed sớm sẽ mở khoá cho người đó gửi link mới — chạy song
    //      song với chính lần retry của job cũ.
    //
    // Dấu hiệu thất bại THẬT là `finishedOn`: BullMQ chỉ đặt trường này khi
    // không còn lần thử nào nữa. Dùng nó thay vì đếm số lần thử vì nó đúng cả
    // khi BullMQ dừng sớm (UnrecoverableError / backoff trả -1) — những trường
    // hợp mà attemptsMade vẫn còn nhỏ hơn attempts nhưng job đã hỏng hẳn.
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalFailure = Boolean(job.finishedOn) || job.attemptsMade >= maxAttempts;

    if (!isFinalFailure) {
      console.warn(
        `[Worker Event] Job ${jobId} hỏng lần thử ${job.attemptsMade}/${maxAttempts}, sẽ thử lại: ${err.message}`,
      );

      // Trả về 'pending': job đang nằm chờ trong hàng đợi (BullMQ để ở trạng
      // thái delayed suốt thời gian backoff), không có gì đang chạy trên điện
      // thoại. Không ghi errorMessage vì lỗi này chưa phải kết luận cuối cùng.
      try {
        await db.update(jobs).set({ status: 'pending' }).where(eq(jobs.id, jobId));
      } catch (dbErr) {
        console.error(`[Worker Event] Không cập nhật được job ${jobId} về pending:`, dbErr);
      }
      return;
    }

    console.error(
      `[Worker Event] Job ${jobId} thất bại hẳn sau ${job.attemptsMade}/${maxAttempts} lần thử:`,
      err.message,
    );

    // Handler này là async: lỗi ném ra đây thành unhandled rejection, có thể
    // giết cả tiến trình worker. Bọc lại để một job hỏng không kéo sập hàng đợi.
    try {
      await db
        .update(jobs)
        .set({
          status: 'failed',
          errorMessage: err.message,
        })
        .where(eq(jobs.id, jobId));
    } catch (dbErr) {
      console.error(`[Worker Event] Không ghi được trạng thái failed cho job ${jobId}:`, dbErr);
    }
  });

  worker.on('error', (err) => {
    console.error('[Worker System Error]:', err.message);
  });

  console.log('⚡ [Worker] Appium + HTTP fetch Worker đã sẵn sàng (Concurrency: 1)');
  return worker;
}
