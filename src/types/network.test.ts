import { expectTypeOf, it } from "vitest";
import type { NSGRule, PathAnalysisResult, PathCandidate, PathHop, PathVerdict, RouteEntry } from "./network";

it("네트워크 결과와 규칙을 불변 타입으로 연결한다", () => {
  expectTypeOf<PathAnalysisResult["overallVerdict"]>().toEqualTypeOf<PathVerdict>();
  expectTypeOf<PathAnalysisResult["pathCandidates"]>().toEqualTypeOf<readonly PathCandidate[]>();
  expectTypeOf<PathCandidate["hops"]>().toEqualTypeOf<readonly PathHop[]>();
  expectTypeOf<NSGRule["sourceAddressPrefix"]>().toEqualTypeOf<string | readonly string[] | null | undefined>();
  expectTypeOf<RouteEntry["nextHopIp"]>().toEqualTypeOf<string | null | undefined>();
});
