import "server-only";

/** `npm run demo`이 띄운 합성 데이터 서버에서만 켜진다. 화면 표시용이며 권한이나 외부 호출을 바꾸지 않는다. */
export function isDemoMode(): boolean {
  return process.env.CLOUDSIGHT_DEMO === "1";
}
