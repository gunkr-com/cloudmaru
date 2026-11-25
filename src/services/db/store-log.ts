import "server-only";

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const base = `${error.name}: ${error.message}`;
  return error.cause instanceof Error ? `${base} (cause: ${error.cause.name}: ${error.cause.message})` : base;
}

// 저장 함수는 화면에 일반 오류(WorkspaceStoreError)만 보낸다. 원인을 찾을 수 있도록 서버 터미널에는
// 오류 이름과 메시지를 남긴다. 쿼리와 매개변수(사용자 입력, 분석 결과)는 남기지 않는다.
export function logStoreError(scope: string, error: unknown): void {
  console.error(`[cloudsight:db] ${scope} failed — ${describe(error)}`);
}
