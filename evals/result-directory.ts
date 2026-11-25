import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * 평가 결과 폴더(`<root>/<UTC 실행 시각><번호><접미사>`)를 만들고 경로를 돌려준다.
 * 여러 실행이 같은 밀리초에 시작하면 이름이 겹치므로, 재귀 없는 mkdir가 EEXIST를 내면 -2, -3 …을 붙여 다시 만든다.
 * 실행기는 이 함수를 모델 호출 전에 불러, 이름 충돌로 이미 비용을 낸 결과를 잃지 않게 한다.
 */
export async function createResultDirectory(root: string, startedAt: Date, suffix = ""): Promise<string> {
  const timestamp = startedAt.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  await mkdir(root, { recursive: true });
  for (let attempt = 1; ; attempt += 1) {
    const directory = join(root, `${timestamp}${attempt === 1 ? "" : `-${attempt}`}${suffix}`);
    try {
      await mkdir(directory);
      return directory;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
}
