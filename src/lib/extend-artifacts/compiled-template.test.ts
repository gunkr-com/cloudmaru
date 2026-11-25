import { describe, expect, it } from 'vitest';
import { parseExtendBicep } from './bicep-source';
import { validateCompiledTemplate } from './compiled-template';
it('matches the verified literal CPU expression only under Container Apps cpu fields',()=>{
 const program=parseExtendBicep("resource app 'Microsoft.App/containerApps@2024-03-01' = { name: 'app' properties: { template: { containers: [{ resources: { cpu: json('0.25') memory: '0.5Gi' } }] } } }");
 const t={...template(),resources:[{type:'Microsoft.App/containerApps',apiVersion:'2024-03-01',name:'app',properties:{template:{containers:[{resources:{cpu:"[json('0.25')]",memory:'0.5Gi'}}]}}}]};
 expect(validateCompiledTemplate(t,program).resourceCount).toBe(1);
 for(const cpu of ["[json('0.5')]","[json(parameters('payload'))]",0.25]){
  const changed=structuredClone(t);Object.assign(changed.resources[0].properties.template.containers[0].resources,{cpu});
  expect(()=>validateCompiledTemplate(changed,program)).toThrow();
 }
 const changed=structuredClone(t),foreign=structuredClone(program);
 changed.resources[0].type='Microsoft.KeyVault/vaults';foreign.resources[0].type='Microsoft.KeyVault/vaults@2024-03-01';
 expect(()=>validateCompiledTemplate(changed,foreign)).toThrow();
});

it('requires distinct bounded zones, combined conditions and the same lazy read guard in exact ARM',()=>{
 const program=parseExtendBicep(`var deploymentTargetMatches = toLower(resourceGroup().id) == 'target'
@minLength(2)
@maxLength(3)
@allowed(['1', '2', '3'])
param deploymentZones array
var deploymentInputsValid = length(union(deploymentZones, deploymentZones)) == length(deploymentZones)
var deploymentEnabled = deploymentTargetMatches && deploymentInputsValid
resource site 'Microsoft.Web/sites@2024-04-01' = if (deploymentEnabled) { name: 'site' zones: deploymentZones }
resource gateway 'Microsoft.Network/applicationGateways@2024-05-01' = if (deploymentEnabled) { name: 'gateway' properties: { host: deploymentEnabled ? site!.properties.defaultHostName : '' } }
output deploymentTargetMatched bool = deploymentTargetMatches`);
 const t={...template(),parameters:{deploymentZones:{type:'array',minLength:2,maxLength:3,allowedValues:['1','2','3']}},variables:{deploymentTargetMatches:"[equals(toLower(resourceGroup().id), 'target')]",deploymentInputsValid:"[equals(length(union(parameters('deploymentZones'), parameters('deploymentZones'))), length(parameters('deploymentZones')))]",deploymentEnabled:"[and(variables('deploymentTargetMatches'), variables('deploymentInputsValid'))]"},outputs:{deploymentTargetMatched:{type:'bool',value:"[variables('deploymentTargetMatches')]"}},resources:[
 {condition:"[variables('deploymentEnabled')]",type:'Microsoft.Web/sites',apiVersion:'2024-04-01',name:'site',zones:"[parameters('deploymentZones')]"},
 {condition:"[variables('deploymentEnabled')]",type:'Microsoft.Network/applicationGateways',apiVersion:'2024-05-01',name:'gateway',properties:{host:"[if(variables('deploymentEnabled'), reference(resourceId('Microsoft.Web/sites', 'site'), '2024-04-01').defaultHostName, '')]"},dependsOn:["[resourceId('Microsoft.Web/sites', 'site')]"]}]};
 expect(validateCompiledTemplate(t,program).resourceCount).toBe(2);
 for(const attack of [
  (x:typeof t)=>{x.resources[0].condition="[variables('deploymentTargetMatches')]";},
  (x:typeof t)=>{x.variables.deploymentInputsValid='[true]';},
  (x:typeof t)=>{x.resources[1].properties!.host=x.resources[1].properties!.host.replace("'deploymentEnabled'","'deploymentTargetMatches'");},
  (x:typeof t)=>{Object.assign(x.parameters.deploymentZones,{defaultValue:['1','2']});},
 ]){const changed=structuredClone(t);attack(changed);expect(()=>validateCompiledTemplate(changed,program)).toThrow();}
});

const source = `resource old 'Microsoft.Web/serverfarms@2024-04-01' existing = {
  name: 'saved-plan'
  scope: resourceGroup('00000000-0000-4000-8000-00000000a001', 'other-rg')
}
resource site 'Microsoft.Web/sites@2024-04-01' = {
  name: 'new-site'
  location: 'canadacentral'
  kind: 'app,linux'
  properties: { serverFarmId: old.id
    httpsOnly: true }
}
resource net 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'new-net'
  location: 'canadacentral'
  properties: { addressSpace: { addressPrefixes: ['10.2.0.0/16'] } }
}
resource child 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: net
  name: 'new-sub'
  properties: { addressPrefixes: ['10.2.1.0/24'] }
}`;
function template() {
  return {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    metadata: { _generator: { name: 'bicep', version: '0.49.2.45890', templateHash: '3523169826824339733' } },
    resources: [
      { type: 'Microsoft.Web/sites', apiVersion: '2024-04-01', name: 'new-site', location: 'canadacentral', kind: 'app,linux',
        properties: { serverFarmId: "[extensionResourceId(format('/subscriptions/{0}/resourceGroups/{1}', '00000000-0000-4000-8000-00000000a001', 'other-rg'), 'Microsoft.Web/serverfarms', 'saved-plan')]", httpsOnly: true } },
      { type: 'Microsoft.Network/virtualNetworks', apiVersion: '2024-05-01', name: 'new-net', location: 'canadacentral',
        properties: { addressSpace: { addressPrefixes: ['10.2.0.0/16'] } } },
      { type: 'Microsoft.Network/virtualNetworks/subnets', apiVersion: '2024-05-01', name: "[format('{0}/{1}', 'new-net', 'new-sub')]",
        properties: { addressPrefixes: ['10.2.1.0/24'] }, dependsOn: ["[resourceId('Microsoft.Network/virtualNetworks', 'new-net')]"] },
    ],
  };
}
const validate = (raw: unknown) => validateCompiledTemplate(raw, parseExtendBicep(source));
describe('compiled ARM compared with the entire validated bound program', () => {
  it('checks exact emitted scope references, types, configuration, CIDRs and dependencies; existing declarations disappear', () => {
    expect(validate(template())).toEqual({ generatorVersion: '0.49.2.45890', resourceCount: 3 });
    const reordered = template(); reordered.resources.reverse();
    expect(validate(reordered).resourceCount).toBe(3);
  });
  it.each([
    (t: ReturnType<typeof template>) => { t.resources[0].properties!.httpsOnly = false; },
    (t: ReturnType<typeof template>) => { t.resources[0].properties!.serverFarmId = '[resourceId(\'foreign\')]'; },
    (t: ReturnType<typeof template>) => { t.resources[0].type = 'Microsoft.Resources/deployments'; },
    (t: ReturnType<typeof template>) => { t.resources[0].location = 'westus2'; },
    (t: ReturnType<typeof template>) => { t.resources[0].name = 'saved-plan'; },
    (t: ReturnType<typeof template>) => { t.resources[0].apiVersion = '2020-01-01'; },
    (t: ReturnType<typeof template>) => { t.resources[2].dependsOn = []; },
    (t: ReturnType<typeof template>) => { t.resources[2].properties!.addressPrefixes = ['10.9.0.0/24']; },
    (t: ReturnType<typeof template>) => { t.resources.push(t.resources[0]); },
    (t: ReturnType<typeof template>) => { t.resources.pop(); },
  ])('refuses any missing, expanded or modified emitted resource', mutate => {
    const t = template(); mutate(t); expect(() => validate(t)).toThrow('compiled-template-mismatch');
  });
  it.each(['condition', 'copy', 'resources', 'scope', 'sku', 'identity'])('rejects extra resource %s including loop/condition/nesting bypasses', key => {
    const t = template(); Object.assign(t.resources[0], { [key]: {} });
    expect(() => validate(t)).toThrow();
  });
  it.each(['variables', 'functions', 'outputs', 'parameters', 'languageVersion', 'imports'])('rejects unexpected root %s and unknown expressions', key => {
    expect(() => validate({ ...template(), [key]: {} })).toThrow();
  });
  it('bounds expansion/depth and requires the reviewed compiler generator', () => {
    expect(() => validate({ ...template(), resources: Array(201).fill(template().resources[0]) })).toThrow();
    const t = template(); t.metadata._generator.version = '999.1'; expect(() => validate(t)).toThrow();
    let deep: unknown = null; for (let i = 0; i < 70; i++) deep = { x: deep };
    expect(() => validate(deep)).toThrow();
    const t2 = template(); t2.resources[0].properties!.serverFarmId = "[reference('secret')]";
    expect(() => validate(t2)).toThrow();
  });
});
it('checks the exact target predicate, output and condition on every child without cascading assumptions',()=>{
 const program=parseExtendBicep("var deploymentTargetMatches = toLower(resourceGroup().id) == '/subscriptions/00000000-0000-4000-8000-00000000a001/resourcegroups/saved'\n"+source.replaceAll('= {','= if (deploymentTargetMatches) {').replace('existing = if (deploymentTargetMatches)','existing =')+'\noutput deploymentTargetMatched bool = deploymentTargetMatches');
 const t={...template(),variables:{deploymentTargetMatches:"[equals(toLower(resourceGroup().id), '/subscriptions/00000000-0000-4000-8000-00000000a001/resourcegroups/saved')]"},outputs:{deploymentTargetMatched:{type:'bool',value:"[variables('deploymentTargetMatches')]"}}};
 for(const r of t.resources)Object.assign(r,{condition:"[variables('deploymentTargetMatches')]"});
 expect(validateCompiledTemplate(t,program).resourceCount).toBe(3);
 for(const mutate of [(x:typeof t)=>{Object.assign(x.resources[2],{condition:true});},(x:typeof t)=>{x.variables.deploymentTargetMatches='[true]';},(x:typeof t)=>{x.outputs.deploymentTargetMatched.value='[true]';}]){
  const changed=structuredClone(t);mutate(changed);expect(()=>validateCompiledTemplate(changed,program)).toThrow();
 }
});
it('accepts only exact secure parameters without defaults and matches their emitted references',()=>{
 const program=parseExtendBicep("@secure()\nparam postgresPassword string\nresource db 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {\nname: 'synthetic-db'\nproperties: { administratorLoginPassword: postgresPassword }\n}");
 const t={...template(),resources:[{type:'Microsoft.DBforPostgreSQL/flexibleServers',apiVersion:'2024-08-01',name:'synthetic-db',properties:{administratorLoginPassword:"[parameters('postgresPassword')]"}}],parameters:{postgresPassword:{type:'securestring'}}};
 expect(validateCompiledTemplate(t,program).resourceCount).toBe(1);
 expect(()=>validateCompiledTemplate({...t,parameters:{postgresPassword:{type:'string',defaultValue:'unsafe'}}},program)).toThrow();
});
it('checks bounded inputs and exact lazy hostname/child-ID expressions independently',()=>{
 const program=parseExtendBicep(`var deploymentTargetMatches = toLower(resourceGroup().id) == 'target'
@minValue(1)
@maxValue(65535)
param containerTargetPort int
@minLength(1)
@maxLength(80)
param staticWebAppLocation string
resource site 'Microsoft.Web/sites@2024-04-01' = if (deploymentTargetMatches) { name: 'site' properties: { port: containerTargetPort } }
resource gateway 'Microsoft.Network/applicationGateways@2024-05-01' = if (deploymentTargetMatches) { name: 'gateway' properties: {
 host: deploymentTargetMatches ? site!.properties.defaultHostName : ''
 child: resourceId('Microsoft.Network/applicationGateways/frontendIPConfigurations', 'gateway', 'frontend') } }
resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = if (deploymentTargetMatches) { name: 'static' location: staticWebAppLocation }
output deploymentTargetMatched bool = deploymentTargetMatches`);
 const t={...template(),parameters:{containerTargetPort:{type:'int',minValue:1,maxValue:65535},staticWebAppLocation:{type:'string',minLength:1,maxLength:80}},
 variables:{deploymentTargetMatches:"[equals(toLower(resourceGroup().id), 'target')]"},outputs:{deploymentTargetMatched:{type:'bool',value:"[variables('deploymentTargetMatches')]"}},
 resources:[
  {condition:"[variables('deploymentTargetMatches')]",type:'Microsoft.Web/sites',apiVersion:'2024-04-01',name:'site',properties:{port:"[parameters('containerTargetPort')]"}},
  {condition:"[variables('deploymentTargetMatches')]",type:'Microsoft.Network/applicationGateways',apiVersion:'2024-05-01',name:'gateway',properties:{host:"[if(variables('deploymentTargetMatches'), reference(resourceId('Microsoft.Web/sites', 'site'), '2024-04-01').defaultHostName, '')]",child:"[resourceId('Microsoft.Network/applicationGateways/frontendIPConfigurations', 'gateway', 'frontend')]"},dependsOn:["[resourceId('Microsoft.Web/sites', 'site')]"]},
  {condition:"[variables('deploymentTargetMatches')]",type:'Microsoft.Web/staticSites',apiVersion:'2023-12-01',name:'static',location:"[parameters('staticWebAppLocation')]"},
 ]};
 expect(validateCompiledTemplate(t,program).resourceCount).toBe(3);
 for(const mutate of [
  (x:typeof t)=>{x.parameters.containerTargetPort.maxValue=999999;},
  (x:typeof t)=>{x.resources[1].properties!.host="[reference(resourceId('Microsoft.Web/sites', 'site'), '2024-04-01').defaultHostName]";},
  (x:typeof t)=>{x.resources[1].properties!.host=x.resources[1].properties!.host!.replace("'site'","'foreign'");},
  (x:typeof t)=>{x.resources[1].properties!.child=x.resources[1].properties!.child!.replace("'gateway'","'foreign'");},
  (x:typeof t)=>{x.resources[2].location='canadacentral';},
 ]){const changed=structuredClone(t);mutate(changed);expect(()=>validateCompiledTemplate(changed,program)).toThrow();}
});
