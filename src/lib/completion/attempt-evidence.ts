import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {AttemptEvidence,AttemptEvidenceBinding,AttemptValidationEvidence} from "@/types/completion-evidence";
const version=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,79}$/);
const validationSchema=z.strictObject({policyVersion:version,compilerVersion:version.optional()});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSchema=z.strictObject({schemaVersion:z.literal(1),basisDigest:hash,contentDigest:hash,validation:validationSchema});
const bindingSchema=z.strictObject({rowId:z.uuid(),attemptId:z.uuid(),source:z.enum(["assessment-roadmap","extension-artifact"]),
  kind:z.enum(["roadmap","guide","evaluation","bicep"])}).refine(value=>(value.source === "assessment-roadmap") === (value.kind === "roadmap"));
function invalid():never {throw new Error("completion-evidence-invalid");}
function digest(value:unknown):string {
  const data=z.json().parse(value);
  return createHash("sha256").update(JSON.stringify(data,(_key,item)=>item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0)) : item)).digest("hex");
}
function details(binding:AttemptEvidenceBinding,raw:AttemptValidationEvidence):AttemptValidationEvidence {
  const value=validationSchema.parse(raw);
  if((binding.kind === "bicep") !== (value.compilerVersion !== undefined)) invalid();
  return value;
}
/** Call only after full semantic validation (and actual compilation for Bicep).
 * Digests detect corruption and bind the saved attempt; they are not signatures against a full-DB writer.
 */
export function sealAttemptEvidence(rawBinding:AttemptEvidenceBinding,content:unknown,basis:unknown,rawValidation:AttemptValidationEvidence):AttemptEvidence {
  try {
    const binding=bindingSchema.parse(rawBinding) as AttemptEvidenceBinding;
    const validation=details(binding,rawValidation),basisDigest=digest(basis);
    return {schemaVersion:1,basisDigest,contentDigest:digest([binding,content,basisDigest,validation]),validation};
  } catch {return invalid();}
}
/** Reopen/download validates stored content, source basis and attempt without rerunning model/compiler. */
export function verifyAttemptEvidence(raw:unknown,binding:AttemptEvidenceBinding,content:unknown,basis:unknown):AttemptValidationEvidence {
  try {
    const saved=evidenceSchema.parse(raw),expected=sealAttemptEvidence(binding,content,basis,saved.validation);
    if(saved.basisDigest !== expected.basisDigest || saved.contentDigest !== expected.contentDigest) invalid();
    return saved.validation;
  } catch {return invalid();}
}
