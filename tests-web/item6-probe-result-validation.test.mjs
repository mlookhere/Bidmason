import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyReadOnlyProbeReport}
  from '../scripts/item6-verify-probe-result.mjs';

const H01_STEPS=[
  'own-organization','other-organization','enumerate-organizations',
  'own-membership','other-membership','foreign-organization-memberships',
  'enumerate-memberships','own-brief-revision','other-brief-revision',
  'foreign-organization-brief-revisions','enumerate-brief-revisions',
];
const H01_CHECKS=['user-1-auth','user-2-auth',
  ...[1,2].flatMap(user=>H01_STEPS.map(name=>`user-${user}-${name}`)),
  'anonymous-organizations','anonymous-memberships','anonymous-brief-revisions'];
const H02_CHECKS=['user-1-auth','user-2-auth',
  'user-1-own-membership','user-1-foreign-memberships',
  'user-2-own-membership','user-2-foreign-memberships',
  'user-1-own-object','user-1-other-object',
  'user-2-own-object','user-2-other-object',
  'anonymous-object-1','anonymous-object-2',
  'public-object-1','public-object-2',
  'public-with-key-object-1','public-with-key-object-2'];
const H01='ci.item6_rls_readonly_probe';
const H02='ci.item6_storage_readonly_probe';
function report(module){
  const h01=module===H01;
  return {
    schema:h01?'bidmason.item6.h01-readonly-probe.v1':
      'bidmason.item6.h02-readonly-object-probe.v2',
    state:'requires-independent-review',
    releaseAuthorized:false,
    [h01?'h01Accepted':'h02Accepted']:false,
    checks:(h01?H01_CHECKS:H02_CHECKS).map(name=>({name,passed:true})),
    notTested:h01?[
      'write-boundary','missing-membership','session-revocation',
      'storage','independent-human-review'
    ]:[
      'uploads','upserts','signed-url-expiry','signed-url-revocation',
      'malicious-paths','session-revocation','independent-human-review'
    ],
  };
}
const check=(module,payload)=>
  verifyReadOnlyProbeReport(module,JSON.stringify(payload));

test('the exact independent H01 and H02 matrices are reviewable, never accepted',()=>{
  for(const [module,count] of [[H01,27],[H02,16]]){
    const proof=check(module,report(module));
    assert.deepEqual(proof,{
      status:'requires-independent-review',checksPassed:count,
      releaseAuthorized:false,
    });
    assert.equal(Object.hasOwn(proof,'h01Accepted'),false);
    assert.equal(Object.hasOwn(proof,'h02Accepted'),false);
  }
});

test('both probes fail closed if any mandatory check is absent, false or replayed',()=>{
  for(const module of [H01,H02]){
    const base=report(module);
    for(const bad of [
      {...base,checks:base.checks.slice(0,-1)},
      {...base,checks:base.checks.map((row,i)=>i===3?{...row,passed:false}:row)},
      {...base,checks:base.checks.map((row,i)=>i===4?base.checks[3]:row)},
      {...base,checks:base.checks.slice().reverse()},
      {...base,checks:base.checks.map((row,i)=>i===1?{...row,extra:true}:row)},
    ]){
      assert.throws(()=>check(module,bad),
        /(Incomplete or unsafe|Missing or failed) read-only probe/);
    }
  }
});

test('H01/H02 fail closed on forged acceptance, misleading state or limitations',()=>{
  for(const module of [H01,H02]){
    const base=report(module);
    for(const bad of [
      {...base,state:'passed'},
      {...base,releaseAuthorized:true},
      {...base,[module===H01?'h01Accepted':'h02Accepted']:true},
      {...base,schema:'bidmason.item6.invalid'},
      {...base,notTested:[]},
      {...base,notTested:base.notTested.slice().reverse()},
      {...base,contactAuthorized:true},
    ]){
      assert.throws(()=>check(module,bad),
        /(Incomplete or unsafe|Incomplete read-only) probe/);
    }
    assert.throws(()=>check(module===H01?H02:H01,base),
      /Incomplete or unsafe read-only probe report/);
  }
});

test('malformed output and unknown diagnostic modules never become evidence',()=>{
  for(const raw of ['','BLOCKED','{}','[]','null','true',
    JSON.stringify(report(H01))+'\n'+JSON.stringify(report(H01)),
    'x'.repeat(150001)]){
    assert.throws(()=>verifyReadOnlyProbeReport(H01,raw),
      /(Invalid|Malformed) read-only probe report/);
  }
  assert.throws(()=>check('ci.fake_probe',report(H01)),
    /Invalid read-only probe report/);
});
