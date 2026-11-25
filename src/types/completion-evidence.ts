export type AttemptEvidenceBinding = {rowId:string;attemptId:string} & (
  {source:"assessment-roadmap";kind:"roadmap"} |
  {source:"extension-artifact";kind:"guide"|"evaluation"|"bicep"}
);
export type AttemptValidationEvidence = {policyVersion:string;compilerVersion?:string};
export type AttemptEvidence = {schemaVersion:1;basisDigest:string;contentDigest:string;validation:AttemptValidationEvidence};
