// @vitest-environment node
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import {expect,it} from 'vitest';
import {applyMigrations} from '@/services/db/migrate';
import {reasonCodeSchema} from '@/lib/completion/schema';
import {extension,ids,legacySnapshot} from '@/lib/completion/fixtures.test-data';
it('upgrades through 0009 without rewriting saved rows and accepts only exact closed compiler errors',async()=>{
 const db=new PGlite(),directory=await mkdtemp(join(tmpdir(),'cloudsight-compiler-migration-'));
 try{
  for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')&&f<'0010'))
   await writeFile(join(directory,file),await readFile(join('db/migrations',file)));
  await applyMigrations(db,directory);
  await db.query("insert into workspaces(id,name) values ($1,'Synthetic')",[ids.workspace]);
  await db.query("insert into scans(id,workspace_id,source,status,inventory,summary,collected_at) values ($1,$2,'import','succeeded',$3,$4,$5)",[ids.scan,ids.workspace,legacySnapshot.inventory,legacySnapshot.record.summary,legacySnapshot.record.collectedAt]);
  const id=(await db.query<{id:string}>('select * from reserve_extension($1,$2,$3,null)',[ids.workspace,ids.scan,extension.input])).rows[0].id;
  await db.query("update extensions set status='failed',error=$2,usage=$3,completed_at=now() where id=$1",[id,{schemaVersion:1,code:'internal'},{promptTokens:2,completionTokens:3,costUsd:0.01}]);
  const tables=['workspaces','scans','extensions','llm_calls'];
  const before=await Promise.all(tables.map(t=>db.query(`select * from ${t} order by id`)));
  const valid={schemaVersion:1,code:'compiler-unavailable'};
  expect((await db.query<{ok:boolean}>('select completion_error_v1($1) as ok',[valid])).rows[0].ok).toBe(false);
  expect(await applyMigrations(db)).toEqual(['0010_compiler_error.sql']);
  expect(await applyMigrations(db)).toEqual([]);
  const after=await Promise.all(tables.map(t=>db.query(`select * from ${t} order by id`)));
  expect(after.map(r=>r.rows)).toEqual(before.map(r=>r.rows));
  for(const code of reasonCodeSchema.options){
   expect((await db.query<{ok:boolean}>('select completion_error_v1($1) as ok',[{schemaVersion:1,code}])).rows[0].ok).toBe(true);
  }
  // Exhaustive SQL/TS membership, including shape/version changes and diagnostic-like values.
  const sql=(await readFile('db/migrations/0010_compiler_error.sql','utf8')).split("payload->>'code' in (")[1].split('), false)')[0];
  expect([...sql.matchAll(/'([^']+)'/g)].map(m=>m[1]).sort()).toEqual([...reasonCodeSchema.options].sort());
  for(const bad of [null,{},[],{code:'compiler-unavailable'},{...valid,schemaVersion:2},{...valid,schemaVersion:'1'},{...valid,detail:'private'},{...valid,code:'compiler-version'},{...valid,code:'compiler-unavailable /private/company'}, {schemaVersion:1,code:null}]){
   expect((await db.query<{ok:boolean}>('select completion_error_v1($1) as ok',[bad])).rows[0].ok).toBe(false);
   await expect(db.query('update extensions set error=$2 where id=$1',[id,bad])).rejects.toThrow();
  }
  await db.query('update extensions set error=$2 where id=$1',[id,valid]);
  expect((await db.query('select error from extensions where id=$1',[id])).rows[0]).toEqual({error:valid});
 }finally{await db.close();await rm(directory,{recursive:true,force:true});}
},30000);
