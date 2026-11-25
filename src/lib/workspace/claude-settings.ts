import { z } from "zod";

// 전역 키나 임의의 프로세스 환경 변수를 선택하지 못하게 전용 이름만 받는다.
export const claudeApiKeyEnvSchema = z.string().trim()
  .regex(/^CLOUDSIGHT_CLAUDE_KEY_[A-Z][A-Z0-9_]{0,63}$/)
  .nullable();
