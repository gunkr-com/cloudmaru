// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseExtendBicep, emitExtendBicep, ExtendBicepError } from './bicep-source';

const zoneSource=`var deploymentTargetMatches = toLower(resourceGroup().id) == 'target'
@minLength(2)
@maxLength(3)
@allowed(['1', '2', '3'])
param deploymentZones array
var deploymentInputsValid = length(union(deploymentZones, deploymentZones)) == length(deploymentZones)
var deploymentEnabled = deploymentTargetMatches && deploymentInputsValid
resource site 'Microsoft.Web/sites@2024-04-01' = if (deploymentEnabled) { name: 'site' zones: deploymentZones properties: { primary: deploymentZones[0] standby: deploymentZones[1] } }
resource gateway 'Microsoft.Network/applicationGateways@2024-05-01' = if (deploymentEnabled) { name: 'gateway' properties: { host: deploymentEnabled ? site!.properties.defaultHostName : '' } }
output deploymentTargetMatched bool = deploymentTargetMatches`;
it('admits only exact bounded fractional CPU literals in a cpu property',()=>{
 const source="resource app 'Microsoft.App/containerApps@2024-03-01' = { name: 'app' properties: { template: { containers: [{ resources: { cpu: json('0.25') memory: '0.5Gi' } }] } } }";
 expect(parseExtendBicep(emitExtendBicep(parseExtendBicep(source)))).toEqual(parseExtendBicep(source));
 for(const v of ['0','0.1','4.25','0.250','2.5e-1',' 0.25','true','null','{}','[]'])expect(()=>parseExtendBicep(source.replace("'0.25'",`'${v}'`))).toThrow();
 expect(()=>parseExtendBicep(source.replace('cpu:','memory:'))).toThrow();
 expect(()=>parseExtendBicep(source.replace("json('0.25')",'json(secret)'))).toThrow();
});
it('roundtrips only the required bounded logical zone IDs and exact distinct-input combined guard',()=>{
 const ast=parseExtendBicep(zoneSource);expect(parseExtendBicep(emitExtendBicep(ast))).toEqual(ast);
 expect(ast.parameters).toContainEqual({name:'deploymentZones',type:'array',minLength:2,maxLength:3,allowed:['1','2','3']});
 for(const [from,to] of [['@minLength(2)','@minLength(1)'],['@maxLength(3)','@maxLength(4)'],["'3'","'4'"],['deploymentZones array','other array'],['deploymentZones array','deploymentZones array = []'],['union(deploymentZones, deploymentZones)','union(deploymentZones, other)'],['deploymentZones[1]','deploymentZones[2]'],['&&','||']] as const)
  expect(()=>parseExtendBicep(zoneSource.replace(from,to))).toThrow();
});

describe('bounded Bicep source parser', () => {
  it('parses comments, multiline literals, nested objects/arrays, references and decorator blocks', () => {
    const source = `// resource fake 'Bad/type@2020-01-01' = {}\n@description('Password (only supplied locally)')\n@secure()\nparam credential string\nresource host /* between tokens */ 'Microsoft.Web/sites@2024-04-01' = {\n name: 'host'\n properties: { serverFarmId: existingHost.id nested: [{ value: '''\nnot a resource { }\n''' }] }\n}`;
    const ast = parseExtendBicep(source);
    expect(ast.parameters[0]).toEqual({name:'credential',secure:true,description:'Password (only supplied locally)'});
    expect(ast.resources).toHaveLength(1);
    expect(parseExtendBicep(emitExtendBicep(ast))).toEqual(ast);
  });
  it.each([
    `resource a 'X/y@2020-01-01' = { resource b 'X/z@2020-01-01' = {} }`,
    `resource a 'X/y@2020-01-01' = [for x in range(0,10): {}]`,
    `resource a 'X/y@2020-01-01' = if (true) {}`,
    `resource a 'X/y@2020-01-01' = { name: '\${loadTextContent(\'secret\')}' }`,
    `resource a 'X/y@2020-01-01' = { name: loadJsonContent('x') }`,
    `module a 'x.bicep' = {}`, `import * as x from 'x'`, `extension microsoftGraph`,
    `provider x`, `var x = loadTextContent('x')`, `output leaked string = credential`,
    `@secure()\nparam credential string = 'secret'`, `param credential string`,
    `resource a 'X/y@2020-01-01' = { a: 1 a: 2 }`,
    `resource a 'X/y@2020-01-01' = { a: r.id + '/x' }`,
    `resource a 'X/y@2020-01-01' = { a: 'unterminated }`,
    `/* unterminated`, `resource a 'X/y@2020-01-01' = { a: (evil()) }`,
    `resource a 'X/y@2020-01-01' = { a: resourceId('x','y') }`,
  ])('rejects unsupported syntax before any compiler I/O: %s', source => {
    expect(() => parseExtendBicep(source)).toThrow(ExtendBicepError);
  });
  it('parses exact server-bound resource-group scopes', () => {
    const ast = parseExtendBicep("resource host 'Microsoft.Web/serverfarms@2024-04-01' existing = { name: 'saved' scope: resourceGroup('subscription', 'group') }");
    expect(parseExtendBicep(emitExtendBicep(ast))).toEqual(ast);
  });
  it('bounds input, nesting, declaration count and rejects duplicate symbols', () => {
    expect(() => parseExtendBicep(' '.repeat(60001))).toThrow();
    expect(() => parseExtendBicep(`resource a 'X/y@2020-01-01' = { a: ${'['.repeat(50)}0${']'.repeat(50)} }`)).toThrow();
    expect(() => parseExtendBicep(`resource a 'X/y@2020-01-01' = {}\nresource a 'X/y@2020-01-01' = {}`)).toThrow();
  });
  it('round-trips only bounded required deployment inputs and exact lazy hostname/child ID forms',()=>{
    const source=`var deploymentTargetMatches = toLower(resourceGroup().id) == 'deployment_target'
@minValue(1)
@maxValue(65535)
param containerTargetPort int
@minLength(1)
@maxLength(80)
param staticWebAppLocation string
resource site 'Microsoft.Web/sites@2024-04-01' = if (deploymentTargetMatches) { name: 'new-site' }
resource gateway 'Microsoft.Network/applicationGateways@2024-05-01' = if (deploymentTargetMatches) {
 name: 'new-gateway'
 properties: { host: deploymentTargetMatches ? site!.properties.defaultHostName : ''
 child: resourceId('Microsoft.Network/applicationGateways/frontendIPConfigurations', 'new-gateway', 'frontend') }
}`;
    const program=parseExtendBicep(source);
    expect(program.parameters).toEqual([{name:'containerTargetPort',type:'int',minimum:1,maximum:65535},{name:'staticWebAppLocation',type:'string',minLength:1,maxLength:80}]);
    expect(parseExtendBicep(emitExtendBicep(program))).toEqual(program);
    for(const unsafe of [
      source.replace('deploymentTargetMatches ?','true ?'),source.replace(" : ''"," : 'foreign'"),
      source.replace('site!.properties.defaultHostName','site!.properties.secret'),
      source.replace("resourceId('Microsoft.Network/applicationGateways/frontendIPConfigurations'","resourceId('Microsoft.Resources/deployments'"),
      source.replace('@maxValue(65535)','@maxValue(999999)'),source.replace('@minLength(1)','@minLength(0)'),
      source.replace('param containerTargetPort int','param containerTargetPort int = 80'),
    ])expect(()=>parseExtendBicep(unsafe)).toThrow();
  });
});
