// AI를 부르는 라우트의 maxDuration과 같은 값. 라우트 파일에는 리터럴로 써야 한다(Next.js 제약).
export const JOB_MAX_DURATION_SECONDS = 300;

// 이보다 오래된 pending 작업은 실행이 끊긴 것으로 보고 다시 시도할 수 있게 한다.
export const JOB_STALE_AFTER_SECONDS = 330;

export function getStaleBefore(now: Date): Date {
  return new Date(now.getTime() - JOB_STALE_AFTER_SECONDS * 1000);
}

export function isJobStale(createdAt: string, now: Date): boolean {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return true;
  return created < getStaleBefore(now).getTime();
}
