import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {limitedProbeEnvironment} from '../scripts/item6-fixture-process-env.mjs';

const script=resolve(fileURLToPath(
  new URL('../scripts/item6-provision-live-fixtures.mjs',import.meta.url)
));
function invoke(args=[],env={}){
  return spawnSync(process.execPath,[script,...args],{
    env:{PATH:process.env.PATH,...env},encoding:'utf8',timeout:5000
  });
}

test('existing-project fixture command refuses default execution',()=>{
  const r=invoke();
  assert.equal(r.status,2);
  assert.match(r.stderr,/explicit --provision is required/);
  assert.equal(r.stdout,'');
});

test('explicit provisioning still requires protected inputs',()=>{
  const r=invoke(['--provision']);
  assert.equal(r.status,2);
  assert.match(r.stderr,/Missing BIDMASON_FIXTURE_URL/);
  assert.equal(r.stdout,'');
});

test('a mismatched project ref fails before contacting external providers',()=>{
  const secret='sb_secret_'+'s'.repeat(50);
  const pub='sb_publishable_'+'p'.repeat(50);
  const r=invoke(['--provision'],{
    BIDMASON_FIXTURE_URL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    BIDMASON_FIXTURE_PROJECT_REF:'bbbbbbbbbbbbbbbbbbbb',
    BIDMASON_FIXTURE_PUBLISHABLE_KEY:pub,
    BIDMASON_FIXTURE_ADMIN_KEY:secret,
    BIDMASON_FIXTURE_ACKNOWLEDGE:'EXISTING_BIDMASON_SYNTHETIC_FIXTURES_ONLY'
  });
  assert.equal(r.status,2);
  assert.match(r.stderr,/canonical HTTPS URL/);
  assert.equal(r.stdout,'');
  for(const value of [secret,pub])assert.equal(r.stderr.includes(value),false);
});

test('explicit existing-project acknowledgment is mandatory',()=>{
  const r=invoke(['--provision'],{
    BIDMASON_FIXTURE_URL:'https://jgbogpunyzkoytrclqdl.supabase.co',
    BIDMASON_FIXTURE_PROJECT_REF:'jgbogpunyzkoytrclqdl',
    BIDMASON_FIXTURE_PUBLISHABLE_KEY:'sb_publishable_'+'p'.repeat(50),
    BIDMASON_FIXTURE_ADMIN_KEY:'sb_secret_'+'s'.repeat(50),
    BIDMASON_FIXTURE_ACKNOWLEDGE:'no'
  });
  assert.equal(r.status,2);
  assert.match(r.stderr,/acknowledgment/);
  assert.equal(r.stdout,'');
});

test('a different canonical Supabase project is not authorized to receive test fixtures',()=>{
  const secret='sb_secret_'+'s'.repeat(50);
  const pub='sb_publishable_'+'p'.repeat(50);
  const r=invoke(['--provision'],{
    BIDMASON_FIXTURE_URL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    BIDMASON_FIXTURE_PROJECT_REF:'aaaaaaaaaaaaaaaaaaaa',
    BIDMASON_FIXTURE_PUBLISHABLE_KEY:pub,
    BIDMASON_FIXTURE_ADMIN_KEY:secret,
    BIDMASON_FIXTURE_ACKNOWLEDGE:'EXISTING_BIDMASON_SYNTHETIC_FIXTURES_ONLY'
  });
  assert.equal(r.status,2);
  assert.match(r.stderr,/Only the previously authorized BidMason Supabase project/);
  assert.equal(r.stdout,'');
  for(const token of [pub,secret])assert.equal(r.stderr.includes(token),false);
});

test('child H01/H02 environment never inherits Admin key or unrelated secrets',()=>{
  const keys=[
    'BIDMASON_H01_URL','BIDMASON_H01_PUBLISHABLE_KEY',
    'BIDMASON_H01_USER_A_JWT','BIDMASON_H01_USER_B_JWT',
    'BIDMASON_H01_ORG_A','BIDMASON_H01_ORG_B',
    'BIDMASON_H01_REVISION_A','BIDMASON_H01_REVISION_B',
    'BIDMASON_H02_URL','BIDMASON_H02_PUBLISHABLE_KEY',
    'BIDMASON_H02_USER_A_JWT','BIDMASON_H02_USER_B_JWT',
    'BIDMASON_H02_PATH_A','BIDMASON_H02_PATH_B',
  ];
  const scoped=Object.fromEntries(keys.map(key=>[key,'fixture-only-value']));
  const ambient={
    PATH:'/fixture-bin',
    BIDMASON_FIXTURE_ADMIN_KEY:'do-not-forward',
    STRIPE_SECRET_KEY:'do-not-forward',
    SUPABASE_SERVICE_ROLE_KEY:'do-not-forward',
    HTTPS_PROXY:'https://untrusted-proxy.test',
    NODE_OPTIONS:'--import malicious-preload',
    BIDMASON_H01_USER_A_JWT:'stale-ambient-token',
  };
  const result=limitedProbeEnvironment(ambient,scoped);
  assert.equal(Object.getPrototypeOf(result),null);
  assert.deepEqual(Object.keys(result).sort(),['PATH',...keys].sort());
  assert.equal(result.PATH,'/fixture-bin');
  assert.equal(result.BIDMASON_H01_USER_A_JWT,'fixture-only-value');
  assert.equal(Object.values(result).includes('do-not-forward'),false);
  for(const key of ['BIDMASON_FIXTURE_ADMIN_KEY','STRIPE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY','HTTPS_PROXY','NODE_OPTIONS']){
    assert.equal(Object.hasOwn(result,key),false,key);
  }
});

test('H01/H02 child environment rejects extra keys and missing sessions',()=>{
  const keys=[
    'BIDMASON_H01_URL','BIDMASON_H01_PUBLISHABLE_KEY',
    'BIDMASON_H01_USER_A_JWT','BIDMASON_H01_USER_B_JWT',
    'BIDMASON_H01_ORG_A','BIDMASON_H01_ORG_B',
    'BIDMASON_H01_REVISION_A','BIDMASON_H01_REVISION_B',
    'BIDMASON_H02_URL','BIDMASON_H02_PUBLISHABLE_KEY',
    'BIDMASON_H02_USER_A_JWT','BIDMASON_H02_USER_B_JWT',
    'BIDMASON_H02_PATH_A','BIDMASON_H02_PATH_B',
  ];
  const supplied=Object.fromEntries(keys.map(key=>[key,'fixture-only-value']));
  assert.throws(()=>limitedProbeEnvironment({},{}),/Incomplete H01\/H02/);
  assert.throws(()=>limitedProbeEnvironment({},
    {...supplied,BIDMASON_FIXTURE_ADMIN_KEY:'forbidden'}),
    /Unexpected live-probe environment field/);
  delete supplied.BIDMASON_H02_USER_B_JWT;
  assert.throws(()=>limitedProbeEnvironment({},supplied),/Incomplete H01\/H02/);
});
