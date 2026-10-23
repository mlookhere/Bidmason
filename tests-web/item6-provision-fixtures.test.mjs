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

const H01=[
  'BIDMASON_H01_URL','BIDMASON_H01_PUBLISHABLE_KEY',
  'BIDMASON_H01_USER_A_JWT','BIDMASON_H01_USER_B_JWT',
  'BIDMASON_H01_ORG_A','BIDMASON_H01_ORG_B',
  'BIDMASON_H01_REVISION_A','BIDMASON_H01_REVISION_B',
];
const H02=[
  'BIDMASON_H02_URL','BIDMASON_H02_PUBLISHABLE_KEY',
  'BIDMASON_H02_USER_A_JWT','BIDMASON_H02_USER_B_JWT',
  'BIDMASON_H02_PATH_A','BIDMASON_H02_PATH_B',
];
const MODULE01='ci.item6_rls_readonly_probe';
const MODULE02='ci.item6_storage_readonly_probe';
const complete=()=>Object.fromEntries([...H01,...H02]
  .map(key=>[key,'probe-value-'+key]));

test('each child receives only its own JWTs plus safe platform values',()=>{
  const ambient={
    PATH:'/fixture-bin',PYTHONPATH:'/malicious-imports',
    PYTHONHOME:'/malicious-interpreter',VIRTUAL_ENV:'/malicious-venv',
    BIDMASON_FIXTURE_ADMIN_KEY:'do-not-forward',
    STRIPE_SECRET_KEY:'do-not-forward',
    SUPABASE_SERVICE_ROLE_KEY:'do-not-forward',
    HTTPS_PROXY:'https://untrusted-proxy.test',
    NODE_OPTIONS:'--import malicious-preload',
    BIDMASON_H01_USER_A_JWT:'stale-ambient-token',
  };
  const supplied=complete();
  const h01=limitedProbeEnvironment(ambient,supplied,MODULE01);
  const h02=limitedProbeEnvironment(ambient,supplied,MODULE02);
  assert.equal(Object.getPrototypeOf(h01),null);
  assert.equal(Object.getPrototypeOf(h02),null);
  assert.deepEqual(Object.keys(h01).sort(),['PATH',...H01].sort());
  assert.deepEqual(Object.keys(h02).sort(),['PATH',...H02].sort());
  for(const key of H01){
    assert.equal(h01[key],supplied[key]);
    assert.equal(Object.hasOwn(h02,key),false,key);
  }
  for(const key of H02){
    assert.equal(h02[key],supplied[key]);
    assert.equal(Object.hasOwn(h01,key),false,key);
  }
  for(const key of ['BIDMASON_FIXTURE_ADMIN_KEY','STRIPE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY','HTTPS_PROXY','NODE_OPTIONS',
    'PYTHONPATH','PYTHONHOME','VIRTUAL_ENV']){
    assert.equal(Object.hasOwn(h01,key),false,key);
    assert.equal(Object.hasOwn(h02,key),false,key);
  }
  assert.equal(Object.values(h01).includes('do-not-forward'),false);
  assert.equal(Object.values(h02).includes('do-not-forward'),false);
});

test('H01/H02 subprocess refuses unknown module, injected keys and missing JWTs',()=>{
  const supplied=complete();
  assert.throws(()=>limitedProbeEnvironment({},supplied,undefined),
    /Unrecognized H01\/H02 live-probe module/);
  assert.throws(()=>limitedProbeEnvironment({},supplied,'ci.malicious_probe'),
    /Unrecognized H01\/H02 live-probe module/);
  for(const module of [MODULE01,MODULE02]){
    assert.throws(()=>limitedProbeEnvironment({}, {},module),
      /Incomplete H01\/H02 live-probe environment/);
    assert.throws(()=>limitedProbeEnvironment({},{
      ...supplied,BIDMASON_FIXTURE_ADMIN_KEY:'forbidden'
    },module),/Unexpected live-probe environment field/);
  }
  delete supplied.BIDMASON_H02_USER_B_JWT;
  assert.throws(()=>limitedProbeEnvironment({},supplied,MODULE01),
    /Incomplete H01\/H02 live-probe environment/);
  assert.throws(()=>limitedProbeEnvironment({},supplied,MODULE02),
    /Incomplete H01\/H02 live-probe environment/);
});

test('diagnostic input isolation cannot be tricked by unexpected empty credentials',()=>{
  for(const module of [MODULE01,MODULE02]){
    const supplied=complete();
    supplied.BIDMASON_H01_USER_B_JWT='';
    assert.throws(()=>limitedProbeEnvironment({},supplied,module),
      /Unexpected live-probe environment field/);
    const valid=complete();
    valid.BIDMASON_H02_USER_A_JWT=null;
    assert.throws(()=>limitedProbeEnvironment({},valid,module),
      /Unexpected live-probe environment field/);
  }
});
