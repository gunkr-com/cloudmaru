import "server-only";
import { z } from 'zod';
import { createTranslator } from '@/i18n/translate';
import type { ExtensionArtifact } from '@/types/extension';
import type { PreparedArtifact } from '@/lib/extend-artifacts/artifact-job';
import { createBicepContext, buildBicepRequest, bindBicepSource } from '@/lib/extend-artifacts/bicep-semantics';
import { sourceScanSchema } from "@/lib/completion/schema";
import { buildArtifactTextRequest, createArtifactTextContext, validateArtifactProsePlanOutput } from "@/lib/extend-artifacts/guide-evaluation";
import { ExtensionArtifactStorageError } from "@/lib/extend-artifacts/storage-validation";
import { getExtension, getExtensionCoreData, getExtensionSourceScan } from "./db/extensions";
import { getExtensionArtifact } from "./db/extension-artifacts";
import {getExtensionDeploymentIntent} from '@/lib/catalog/extension-deployment';

const inputLabels={postgresPassword:'extensionArtifacts.postgresPassword',deploymentZones:'extensionArtifacts.deploymentZones',
 staticWebAppLocation:'extensionArtifacts.staticWebAppLocation',containerImage:'extensionArtifacts.containerImage',containerTargetPort:'extensionArtifacts.containerTargetPort',
 functionStorageConnection:'extensionArtifacts.functionStorageConnection',gatewayCertificateData:'extensionArtifacts.gatewayCertificateData',gatewayCertificatePassword:'extensionArtifacts.gatewayCertificatePassword'} as const;

type Readers = {
  getExtension: typeof getExtension;
  getExtensionCoreData: typeof getExtensionCoreData;
  getExtensionSourceScan: typeof getExtensionSourceScan;
  getExtensionArtifact: typeof getExtensionArtifact;
};
/** 저장 행 ID만 받는다. 쿠키·제출된 안/금액·현재 카탈로그·대체 키를 사용하지 않는다. */
export function createExtensionArtifactContextService(readers: Readers) {
  const service = {
    async prepareExtensionArtifactRequest(id: string): Promise<PreparedArtifact<ExtensionArtifact> | null> {
      const row = await readers.getExtensionArtifact(id);
      if (!row || row.status !== 'pending') return null;
      if (row.kind !== 'bicep') {
        const prepared = await service.prepareExtensionArtifactTextRequest(id);
        return prepared && {...prepared, validate: raw => validateArtifactProsePlanOutput(raw, prepared.context)};
      }
      try {
        const parent = await readers.getExtension(row.extensionId);
        const catalogData = await readers.getExtensionCoreData(row.extensionId);
        const source = await readers.getExtensionSourceScan(row.sourceScanId);
        if (!parent?.result || parent.status !== 'succeeded' || !catalogData || !source
          || source.scan.workspaceId !== row.workspaceId || source.scan.id !== row.sourceScanId
          || JSON.stringify(sourceScanSchema.parse(source.sourceScan)) !== JSON.stringify(sourceScanSchema.parse(parent.result.sourceScan))) throw new ExtensionArtifactStorageError();
        const binding = {id:row.id, extensionId:row.extensionId, workspaceId:row.workspaceId, sourceScanId:row.sourceScanId,
          tier:row.tier, kind:'bicep' as const, createdAt:row.createdAt};
        const extension=parent.result;
        const context = createBicepContext(binding, {extension,catalogData,inventory:source.inventory});
        return {attemptId:row.attemptId,request:buildBicepRequest(context),validate(raw) {
          const parsed=z.strictObject({code:z.string().min(1).max(60000)}).safeParse(raw);
          if (!parsed.success) return {ok:false,errors:['code: source-contract-required']};
          try {
            const bound=bindBicepSource(parsed.data.code,context);
            const localized=(key:Parameters<ReturnType<typeof createTranslator>>[0],args?:Record<string,string|number>)=>({en:createTranslator('en')(key,args),ko:createTranslator('ko')(key,args)});
            const hasInput=(name:string)=>bound.parameters.some(p=>p.name===name);
            const plan=extension.plans.find(p=>p.tier===binding.tier)!;
            const intent=getExtensionDeploymentIntent(catalogData.catalog,plan.referenceArchitectureId,binding.tier)!;
            const inputNotes=[
              ...(hasInput('deploymentZones')?[localized('extensionArtifacts.zonesNotice')]:[]),
              ...(hasInput('staticWebAppLocation')?[localized('extensionArtifacts.staticLocationNotice')]:[]),
              ...(hasInput('containerImage')?[localized('extensionArtifacts.containerInputNotice')]:[]),
              ...(hasInput('functionStorageConnection')?[localized('extensionArtifacts.functionStorageNotice',{component:intent.bindings.find(b=>b.role==='function-storage')!.toComponentId})]:[]),
              ...(hasInput('gatewayCertificateData')?[localized('extensionArtifacts.gatewayInputNotice')]:[]),
            ];
            return {ok:true,value:{schemaVersion:1,...binding,content:{code:bound.code,parameters:bound.parameters.map(p=>{
              const label=inputLabels[p.name as keyof typeof inputLabels];if(!label)throw new ExtensionArtifactStorageError();
              return {name:p.name,description:localized(label)};
            }),
              existingResourceIds:bound.existingResourceIds,newComponentIds:bound.newComponentIds,unverifiedDraft:true,
              deploymentNotes:[{en:createTranslator('en')('extensionArtifacts.targetNotice',{target:bound.deploymentTarget}),
                ko:createTranslator('ko')('extensionArtifacts.targetNotice',{target:bound.deploymentTarget})},...bound.postgresMappings.map(m=>{
                const note=(locale:'en'|'ko')=>{const t=createTranslator(locale);return t('extensionArtifacts.postgresNotice',{sku:m.skuName,tier:m.tier,version:m.engineVersion,storage:m.storageType,
                  topology:t(m.highAvailabilityMode==='ZoneRedundant'?'extensionArtifacts.postgresNativeHa':'extensionArtifacts.postgresIndependent',{logical:m.logicalServerCount,physical:m.physicalInstanceCount}),
                  basis:t(m.mappingBasis==='official-example'?'extensionArtifacts.mappingOfficial':'extensionArtifacts.mappingInferred')});};
                return {en:note('en'),ko:note('ko')};}),...inputNotes]}}};
          } catch { return {ok:false,errors:['code: source-does-not-match-saved-contract']}; }
        }};
      } catch { throw new ExtensionArtifactStorageError(); }
    },
    async prepareExtensionArtifactTextRequest(id: string) {
      try {
        const row = await readers.getExtensionArtifact(id);
        if (!row || row.status !== "pending") return null;
        if (row.kind !== "guide" && row.kind !== "evaluation") throw new ExtensionArtifactStorageError();
        const parent = await readers.getExtension(row.extensionId);
        if (!parent || parent.status !== "succeeded" || !parent.result
          || parent.id !== row.extensionId || parent.workspaceId !== row.workspaceId
          || parent.sourceScanId !== row.sourceScanId) throw new ExtensionArtifactStorageError();
        const catalogData = await readers.getExtensionCoreData(parent.id);
        const source = await readers.getExtensionSourceScan(row.sourceScanId);
        if (!catalogData || !source || source.scan.id !== row.sourceScanId || source.scan.workspaceId !== row.workspaceId
          || source.scan.status !== "succeeded"
          || JSON.stringify(sourceScanSchema.parse(source.sourceScan)) !== JSON.stringify(sourceScanSchema.parse(parent.result.sourceScan))) {
          throw new ExtensionArtifactStorageError();
        }
        const context = createArtifactTextContext({ id: row.id, extensionId: row.extensionId, workspaceId: row.workspaceId,
          sourceScanId: row.sourceScanId, tier: row.tier, kind: row.kind, createdAt: row.createdAt },
        { extension: parent.result, catalogData, inventory: source.inventory });
        return { attemptId: row.attemptId, context, request: buildArtifactTextRequest(context) };
      } catch (error) {
        if (error instanceof ExtensionArtifactStorageError) throw error;
        throw new ExtensionArtifactStorageError("internal");
      }
    },
  };
  return service;
}
export const { prepareExtensionArtifactTextRequest, prepareExtensionArtifactRequest } = createExtensionArtifactContextService({
  getExtension, getExtensionCoreData, getExtensionSourceScan, getExtensionArtifact,
});
