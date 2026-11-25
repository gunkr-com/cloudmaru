import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // proxy(src/proxy.ts)를 거치는 요청 본문은 이 크기까지만 버퍼링되고 넘는 부분은 오류 없이 잘린다(기본 10MB).
    // 스캔 파일 가져오기 상한(SCAN_BODY_MAX_BYTES, 64 MiB)보다 1 MiB 크게 둔다. 그래야 Content-Length 없이 상한을
    // 넘는 본문도 잘리기 전에 라우트가 초과를 보고 import-too-large로 답한다.
    proxyClientMaxBodySize: 65 * 1024 * 1024,
  },
  outputFileTracingIncludes: {
    "/*": ["./db/migrations/*.sql"],
  },
  // Tailscale로 다른 기기에서 dev 서버를 열 때 HMR 등 개발용 요청을 허용한다. 프로덕션에는 영향이 없다.
  allowedDevOrigins: (process.env.CLOUDSIGHT_DEV_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean),
};

export default nextConfig;
