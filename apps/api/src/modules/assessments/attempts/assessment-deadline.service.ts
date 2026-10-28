import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { LmsStore, type Tx } from "../../courses/lms.store.js";
import { AttemptsService } from "./attempts.service.js";

export type DeadlineLease = { id: string; attemptId: string; leaseToken: string; fence: number; attempts: number; maxAttempts: number };

/** Separate assessment queue. No media jobs, grading handler, external I/O or implicit test timers. */
@Injectable()
export class AssessmentDeadlineService implements OnModuleDestroy {
  private readonly logger = new Logger(AssessmentDeadlineService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(@Inject(LmsStore) private readonly store: LmsStore,
    @Inject(AttemptsService) private readonly attempts: AttemptsService) {}

  start() {
    if (this.timer) return;
    const run = () => {
      if (this.running) return;
      this.running = this.tick().then(() => undefined).catch(() => {
        this.logger.error("ASSESSMENT_DEADLINE_RUN_FAILED");
      }).finally(() => { this.running = undefined; });
    };
    this.timer = setInterval(run, 1000);
    this.timer.unref();
    run();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
  /** Reconstruct only missing work; never reset terminal retry counters. Bounded per tick. */
  async recover(limit = 50) {
    const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
    return this.attempts.transaction(async tx => {
      const now = await this.attempts.clock(tx);
      const rows = await tx.assessmentAttempt.findMany({ where: {
        OR: [
          { status: "IN_PROGRESS", deadlineAt: { lte: now }, jobs: { none: { kind: "deadline" } } },
          { status: { in: ["SUBMITTED", "AUTO_SUBMITTED"] }, jobs: { none: { kind: "grade" } } },
        ],
      }, orderBy: [{ startedAt: "asc" }, { id: "asc" }], take: bounded });
      for (const a of rows) {
        const kind = a.status === "IN_PROGRESS" ? "deadline" : "grade";
        await tx.assessmentJob.upsert({ where: { deduplicationKey: `${kind}:${a.id}` },
          create: { attemptId: a.id, kind, deduplicationKey: `${kind}:${a.id}`, availableAt: now }, update: {} });
      }
      return rows.length;
    });
  }
  async claim(): Promise<DeadlineLease | null> {
    const token = randomUUID();
    // Claim is its own short transaction. No job lock is retained while acquiring attempt locks.
    const rows = await this.store.db.$queryRaw<DeadlineLease[]>`
      WITH candidate AS (
        SELECT id FROM assessment_jobs
        WHERE kind='deadline' AND attempts<max_attempts
          AND ((state='queued' AND available_at<=clock_timestamp())
            OR (state='running' AND lease_until<=clock_timestamp()))
        ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE assessment_jobs j SET state='running',lease_token=${token}::uuid,
        lease_until=clock_timestamp()+interval '30 seconds',fence=fence+1,attempts=attempts+1,error_code=NULL
      FROM candidate c WHERE j.id=c.id
      RETURNING j.id,j.attempt_id AS "attemptId",j.lease_token AS "leaseToken",j.fence,j.attempts,j.max_attempts AS "maxAttempts"`;
    return rows[0] ?? null;
  }
  private async fenced(tx: Tx, lease: DeadlineLease) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM assessment_jobs WHERE id=${lease.id}::uuid AND state='running'
        AND lease_token=${lease.leaseToken}::uuid AND fence=${lease.fence}
        AND lease_until>clock_timestamp() FOR UPDATE`;
    return rows.length > 0;
  }
  /** A stale/expired lease cannot finalize or acknowledge work. Attempt lock precedes job lock. */
  async execute(lease: DeadlineLease): Promise<boolean> {
    return this.attempts.transaction(async tx => {
      await this.attempts.lockDeadline(tx, lease.attemptId);
      if (!await this.fenced(tx, lease)) return false;
      const a = await this.attempts.finalizeDeadline(tx, lease.attemptId);
      if (a.status === "IN_PROGRESS") {
        await tx.assessmentJob.update({ where: { id: lease.id }, data: {
          state: "queued", leaseToken: null, leaseUntil: null, availableAt: a.deadlineAt!,
        } });
        return false;
      }
      await tx.assessmentJob.update({ where: { id: lease.id }, data: { state: "succeeded", leaseToken: null, leaseUntil: null, errorCode: null } });
      return true;
    });
  }
  private async failed(lease: DeadlineLease) {
    await this.attempts.transaction(async tx => {
      if (!await this.fenced(tx, lease)) return;
      const terminal = lease.attempts >= lease.maxAttempts;
      await tx.assessmentJob.update({ where: { id: lease.id }, data: { state: terminal ? "failed" : "queued",
        availableAt: new Date((await this.attempts.clock(tx)).getTime() + Math.min(60000, 1000 * 2 ** lease.attempts)),
        leaseToken: null, leaseUntil: null, errorCode: "DEADLINE_FINALIZATION_FAILED" } });
      if (terminal) await this.failureAudit(tx, lease.id, lease.attemptId);
    });
  }
  private async failureAudit(tx: Tx, jobId: string, attemptId: string) {
    await tx.auditLog.create({ data: { actorUserId: null, action: "assessment.job.failed",
      entityType: "assessment_job", entityId: jobId, metadata: { attemptId, kind: "deadline", code: "DEADLINE_FINALIZATION_FAILED" } } });
  }
  async reap(limit = 50) {
    return this.attempts.transaction(async tx => {
      const now = await this.attempts.clock(tx);
      const rows = await tx.$queryRaw<{ id: string; attemptId: string }[]>`
        SELECT id,attempt_id AS "attemptId" FROM assessment_jobs
        WHERE kind='deadline' AND state='running' AND lease_until<=${now}
          AND attempts>=max_attempts ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ${Math.max(1, Math.min(100, limit))}`;
      for (const row of rows) {
        await tx.assessmentJob.update({ where: { id: row.id }, data: { state: "failed", leaseToken: null, leaseUntil: null, errorCode: "DEADLINE_LEASE_EXHAUSTED" } });
        await this.failureAudit(tx, row.id, row.attemptId);
      }
      return rows.length;
    });
  }
  async tick(limit = 10) {
    await this.recover();
    await this.reap();
    let completed = 0;
    for (let n = 0; n < Math.max(1, Math.min(50, limit)); n++) {
      const lease = await this.claim();
      if (!lease) break;
      try { if (await this.execute(lease)) completed++; }
      catch { await this.failed(lease); }
    }
    return completed;
  }
}
