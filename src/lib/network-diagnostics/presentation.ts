import type { NetworkDiagnostic } from "@/types/network-diagnostics";
import { redactForModel } from "@/lib/inventory/redact";

/** 저장 판정은 유지하고 예상 밖의 비밀 근거 값은 브라우저 전달 전에 제거한다. */
export function sanitizeNetworkDiagnostic(value: NetworkDiagnostic): NetworkDiagnostic {
  return {
    ...value,
    engine: {
      ...value.engine,
      paths: value.engine.paths.map(path => ({
        ...path,
        hops: path.hops.map(hop => ({
          ...hop,
          evidence: hop.evidence.map(evidence => {
            if (evidence.observation.state !== "present") return evidence;
            const safe = redactForModel(evidence.observation.value, evidence.propertyPath);
            return JSON.stringify(safe) === JSON.stringify(evidence.observation.value) ? evidence : {
              ...evidence, observation: { state: "invalid" as const, reason: "invalid-data" as const },
            };
          }),
        })),
      })),
    },
  };
}
