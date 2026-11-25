// 분석과 Pro 결과물 생성은 예약 행(pending)을 먼저 만들고 백그라운드에서 끝낸다.
export type JobStatus = "pending" | "succeeded" | "failed";
