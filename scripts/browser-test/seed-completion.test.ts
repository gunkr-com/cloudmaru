// @vitest-environment node
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
it.each([['--target','/existing/company'],['--new']].map(args=>({args})))('CLI rejects target/environment without exposing paths or opening a DB: %j',({args})=>{
 const result=spawnSync(process.execPath,['--import','tsx','--conditions=react-server','scripts/browser-test/seed-completion.ts',...args],{
  cwd:process.cwd(),env:{...process.env,CLOUDSIGHT_DATA_DIR:'/private-company/sentinel'},encoding:'utf8',timeout:10000,
 });
 expect(result.status).toBe(1);
 expect(result.stdout).toBe('');
 expect(result.stderr.trim()).toBe(args[0]==='--new'?'acceptance-seed-existing-environment':'acceptance-seed-new-only');
 expect(result.stderr).not.toContain('/private-company');
});
