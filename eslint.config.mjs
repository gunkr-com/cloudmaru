import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  // scripts/와 evals/의 TypeScript도 eslint . 검사 대상에 포함한다.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "docs/**",
    "evals/results/**",
    // Claude Code 작업 폴더. git worktree가 여기 생기면 저장소 전체 사본이 들어온다.
    ".claude/**",
  ]),
]);
