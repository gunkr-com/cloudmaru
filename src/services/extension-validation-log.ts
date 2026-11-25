import "server-only";
import {z} from "zod";
import type {ExtensionValidationEvent} from "@/lib/extend-app/job";

// Never log model text, arbitrary Zod object keys, provider errors or inventory IDs.
// Unknown future validator reasons remain opaque until explicitly reviewed here.
const codes=new Set([
 "invalid-model-structure","invalid-proposal-structure","validation-failed",
 "app-service-capacity-intent-mismatch","component-deployment-mapping-required",
 "container-coupled-meter-basis-mismatch","container-resource-profile-mismatch","deployment-intent-required",
 "duplicate-base-charge","function-storage-binding-required","functions-hosting-meter-basis-mismatch",
 "gateway-backend-binding-required","gateway-capacity-zone-intent-required","gateway-coupled-meter-basis-mismatch",
 "gateway-public-ip-binding-required","incompatible-subnet-role","instance-quantity-mismatch",
 "invalid-deployment-cardinality","invalid-existing-parent","invalid-incremental-usage","invalid-new-parent",
 "invalid-subnet-component","outside-new-parent","postgres-compute-storage-pair-required",
 "postgres-deployment-mapping-required","postgres-native-ha-billing-basis-mismatch","postgres-storage-basis-mismatch",
 "proposed-parent-overlap","proposed-subnet-overlap","reference-network-role-required","region-mismatch",
 "required-subnet-binding-missing","reuse-not-eligible","selected-subnet-required","static-backend-binding-required",
 "subnet-role-conflict","subnet-role-overlap","subnet-size-basis-mismatch","unknown-component",
 "unknown-reference-architecture","unrepresented-network-quantity","unsafe-text-or-service-reference","unselected-network-role",
]);
const fields=new Set(["schemaVersion","requestTitle","recommendationReason","recommendedTier","plans","tier",
 "referenceArchitectureId","title","pros","en","ko","reusedResources","resourceId","componentId","reason",
 "newItems","quantity","instanceCount","usageIncreases","subnetProposals","id","parent","kind","region",
 "addressPrefixes","deploymentBindings","role","target","subnetProposalId","delegation","request-context","extension"]);
export function logExtensionValidation(id:string,event:ExtensionValidationEvent):void {
 const issues=event.errors.slice(0,20).map(error=>{
  const match=/^([^:]{0,256}): ([a-z-]{1,80})$/.exec(error);
  const parts=match?.[1].split(".")??[];
  return {path:parts.length>0&&parts.length<=12&&parts.every(part=>fields.has(part)||/^[0-9]{1,4}$/.test(part))
   ? parts.join("."):"unknown",code:match&&codes.has(match[2])?match[2]:"other-validation-error"};
 });
 console.info("[cloudsight:extension-validation]",{id:z.uuid().safeParse(id).success?id:"unknown",
  attempt:event.attempt,valid:event.errors.length===0,issues,omitted:Math.max(0,event.errors.length-issues.length)});
}
