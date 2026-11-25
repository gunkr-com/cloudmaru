import type { MessageKey } from "@/i18n/messages/types";
const errors: Record<string, MessageKey> = {
  "key-unavailable": "assessmentRoadmap.errors.key-unavailable", "not-configured": "assessmentRoadmap.errors.key-unavailable",
  "workspace-changed": "assessmentRoadmap.errors.workspace-changed", "no-data": "assessmentRoadmap.errors.no-data",
  "validation-failed": "assessmentRoadmap.errors.validation-failed", timeout: "assessmentRoadmap.errors.timeout",
  interrupted: "assessmentRoadmap.errors.interrupted", "assessment-missing": "assessmentRoadmap.errors.assessment-missing",
  "assessment-not-succeeded": "assessmentRoadmap.errors.assessment-not-succeeded", "invalid-body": "assessmentRoadmap.errors.invalid-body",
};
export function roadmapErrorMessageKey(code: string): MessageKey {
  return Object.hasOwn(errors, code) ? errors[code] : "assessmentRoadmap.errors.internal";
}
