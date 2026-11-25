import { describe, expect, it } from "vitest";
import * as network from "./index";
import type {
  HopType,
  NSGRule,
  ParsedPrefix,
  PathAnalysisResult,
  PathCandidate,
  PathHop,
  PathQuery,
  PathVerdict,
  RouteEntry,
} from "./index";
import { diagnosePath, analyzePath } from "./analyze-path";
import { prefixContains, prefixesOverlap } from "./cidr";

describe("network public API", () => {
  it("exports path diagnostics and the compatible public functions", () => {
    expect(Object.keys(network).sort()).toEqual([
      "analyzePath",
      "diagnosePath",
      "prefixContains",
      "prefixesOverlap",
    ]);
    expect(network.analyzePath).toBe(analyzePath);
    expect(network.diagnosePath).toBe(diagnosePath);
    expect(network.prefixContains).toBe(prefixContains);
    expect(network.prefixesOverlap).toBe(prefixesOverlap);
  });
  it("exposes query and result types for callers", () => {
    const query: PathQuery = {
      sourceResourceId: "/missing-source",
      destinationResourceId: "/missing-destination",
    };
    const result: PathAnalysisResult = network.analyzePath([], query);
    const verdict: PathVerdict = result.overallVerdict;
    const candidate: PathCandidate | undefined = result.pathCandidates[0];
    const hop: PathHop | undefined = candidate?.hops[0];
    const hopType: HopType | undefined = hop?.hopType;
    const rule: NSGRule = {
      direction: "inbound",
      access: "allow",
      priority: 100,
      name: "allow",
    };
    const route: RouteEntry = { name: "route" };
    const prefix: ParsedPrefix = { version: 4, network: BigInt(0), length: 0 };
    expect({
      verdict,
      hopType,
      rule: rule.name,
      route: route.name,
      prefix: prefix.length,
    }).toEqual({
      verdict: "unknown",
      hopType: undefined,
      rule: "allow",
      route: "route",
      prefix: 0,
    });
  });
});
