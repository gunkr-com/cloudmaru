import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkLocalRequest, parseAllowedHosts } from "@/lib/security/local-guard";

export function proxy(request: NextRequest): NextResponse {
  const decision = checkLocalRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    contentType: request.headers.get("content-type"),
  }, parseAllowedHosts(process.env.CLOUDSIGHT_ALLOWED_HOSTS));

  if (!decision.ok) {
    return new NextResponse(null, { status: decision.status, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.next();
}

// 빌드된 정적 파일(_next/static/)과 favicon만 건너뛴다. 확장자로 거르면 /analyses/x.png 같은
// 앱 경로도 proxy를 건너뛰어, Host 검사 없이 레이아웃이 렌더링된다. 이미지 최적화(_next/image)도 검사한다.
export const config = {
  matcher: ["/((?!_next/static/|favicon\\.ico$).*)"],
};
