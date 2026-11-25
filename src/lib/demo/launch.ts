/** 오프라인 합성 데모 서버의 주소·인자·환경 변수 규칙. 입출력 없는 순수 함수만 둔다. */
export const DEMO_HOST = "127.0.0.1";
export const DEMO_START_PATH = "/overview";

export type DemoArgs = { mode: "start" };

/**
 * 대상 폴더·호스트·포트를 받지 않는다. 매번 새 데이터 폴더와 빈 루프백 포트를 쓴다.
 * 개발 서버는 dotenv 파일이 바뀌면 다시 읽어 시작 때 비운 이름 밖의 값이 들어올 수 있으므로 프로덕션 서버만 띄운다.
 */
export function parseDemoArgs(args: readonly string[]): DemoArgs {
  if (args.length === 0) return { mode: "start" };
  throw Error("demo-args-invalid");
}

export function demoStartUrl(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("demo-port-invalid");
  return `http://${DEMO_HOST}:${port}${DEMO_START_PATH}`;
}

// 서버 실행에 필요한 일반 셸 값만 넘긴다. 자격 증명·NODE_OPTIONS·프록시 설정은 넘기지 않는다.
const PASSTHROUGH = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SystemRoot", "COMSPEC"];
// Next.js는 이미 정의된 변수를 dotenv 값으로 덮지 않는다. 빈 값으로 고정해 저장소 dotenv의 비밀 값이 서버에 들어가지 않게 한다.
const BLANKED = ["ANTHROPIC_API_KEY", "CLAUDE_MODEL", "CLOUDSIGHT_ALLOWED_HOSTS", "CLOUDSIGHT_DEV_ORIGINS", "CLOUDSIGHT_BICEP_PATH", "CLOUDMARU_PRICES_FILE"];
// Next.js dotenv 파서가 받는 키 문자(점·대시 포함). `=`·공백·빈 이름은 환경 변수 이름이 될 수 없어 버린다.
const ENV_NAME = /^[\w.-]+$/;

export function demoServerEnv(
  parent: Readonly<Record<string, string | undefined>>,
  folders: { dataDirectory: string; secretsDirectory: string; dotenvNames: readonly string[] },
): Record<string, string> {
  if (parent.CLOUDSIGHT_DATA_DIR?.trim()) throw Error("demo-existing-environment");
  const env: Record<string, string> = {};
  for (const name of PASSTHROUGH) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  for (const name of [...folders.dotenvNames, ...BLANKED]) if (ENV_NAME.test(name)) env[name] = "";
  return {
    ...env,
    CLOUDSIGHT_DATA_DIR: folders.dataDirectory,
    CLOUDSIGHT_SECRETS_DIR: folders.secretsDirectory,
    CLOUDSIGHT_DEMO: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

const ANSI = /\u001b\[[0-9;]*m/g;

/** `next start|dev -H 127.0.0.1 -p 0`이 출력한 실제 바인딩 포트. 다른 호스트나 줄은 무시한다. */
export function nextLocalPort(line: string): number | null {
  const match = /^\s*-\s+Local:\s+http:\/\/127\.0\.0\.1:(\d{1,5})\s*$/.exec(line.replace(ANSI, ""));
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

export function isNextReadyLine(line: string): boolean {
  return /(?:^|\s)Ready in\s/.test(line.replace(ANSI, ""));
}
