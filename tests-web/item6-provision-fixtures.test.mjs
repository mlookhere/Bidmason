import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

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
    BIDMASON_FIXTURE_URL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    BIDMASON_FIXTURE_PROJECT_REF:'aaaaaaaaaaaaaaaaaaaa',
    BIDMASON_FIXTURE_PUBLISHABLE_KEY:'sb_publishable_'+'p'.repeat(50),
    BIDMASON_FIXTURE_ADMIN_KEY:'sb_secret_'+'s'.repeat(50),
    BIDMASON_FIXTURE_ACKNOWLEDGE:'no'
  });
  assert.equal(r.status,2);
  assert.match(r.stderr,/acknowledgment/);
  assert.equal(r.stdout,'');
});
