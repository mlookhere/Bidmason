#!/usr/bin/env node
/** Opt-in synthetic H01/H02 fixture creation for an existing Supabase project.
 * No production emails, customer information, or service-role impersonation.
 * Never import into web routes, deploy as an API, or run in CI.
 * Does not confer H01/H02 acceptance or production/send authorization. */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {limitedProbeEnvironment} from './item6-fixture-process-env.mjs';

const SLUGS=['bm-synthetic-h01-h02-20261022-a','bm-synthetic-h01-h02-20261022-b'];
const NAMES=['TEST ONLY - BidMason synthetic tenant A','TEST ONLY - BidMason synthetic tenant B'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REF=/^[a-z]{20}$/;
// User-authorized existing project; matching a different valid URL/ref is not approval.
const EXPECTED_PROJECT_REF='jgbogpunyzkoytrclqdl';
const PNG=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5cAAAAASUVORK5CYII=',
  'base64'
);
function requireEnv(name){
  const value=process.env[name];
  if(typeof value!=='string'||!value.length)throw Error('Missing '+name);
  return value;
}
function configuration(){
  const url=requireEnv('BIDMASON_FIXTURE_URL');
  const projectRef=requireEnv('BIDMASON_FIXTURE_PROJECT_REF');
  const publicKey=requireEnv('BIDMASON_FIXTURE_PUBLISHABLE_KEY');
  const adminKey=requireEnv('BIDMASON_FIXTURE_ADMIN_KEY');
  if(!REF.test(projectRef)||url!=='https://'+projectRef+'.supabase.co')
    throw Error('Expected canonical HTTPS URL and matching 20-character Supabase project ref');
  if(projectRef!==EXPECTED_PROJECT_REF)
    throw Error('Only the previously authorized BidMason Supabase project is permitted');
  if(!publicKey.startsWith('sb_publishable_')||publicKey.length<30
    ||(!adminKey.startsWith('sb_secret_')&&!adminKey.startsWith('eyJ'))
    ||adminKey.length<30||publicKey===adminKey)
    throw Error('Use distinct publishable and protected admin/service keys');
  if(requireEnv('BIDMASON_FIXTURE_ACKNOWLEDGE')!=='EXISTING_BIDMASON_SYNTHETIC_FIXTURES_ONLY')
    throw Error('Missing explicit existing-project synthetic fixture acknowledgment');
  return {url,publicKey,adminKey};
}
async function request(url,path,key,method='GET',body=undefined,auth=key,contentType='application/json'){
  const headers={apikey:key,Authorization:'Bearer '+auth,Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']=contentType;
  if(path.startsWith('/rest/v1/')&&method==='POST')
    headers.Prefer='return=representation';
  const response=await fetch(url+path,{method,headers,
    body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),
    redirect:'manual',signal:AbortSignal.timeout(14000)});
  // Never print provider bodies: they may carry JWTs, emails or secrets.
  if(response.status<200||response.status>=300)
    throw Error('Supabase fixture operation rejected (HTTP '+response.status+')');
  const raw=await response.text();
  if(raw.length>100000)throw Error('Oversized provider response');
  try{return raw?JSON.parse(raw):null;}
  catch{throw Error('Unexpected provider response encoding');}
}
function validId(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw Error('Invalid server-issued fixture UUID');
  return value;
}
function one(value){return Array.isArray(value)&&value.length===1?value[0]:null;}
function runProbe(python,module,env){
  const result=spawnSync(python,['-m',module,'--live-readonly'],{
    env:limitedProbeEnvironment(process.env,env,module),encoding:'utf8',timeout:120000,
    maxBuffer:150000,stdio:['ignore','pipe','pipe'],shell:false
  });
  // Do not forward outputs; future probe versions might expose identifiers.
  return {probe:module,status:result.status===0?'requires-independent-review':'blocked'};
}
async function provision(){
  if(process.argv.length!==3||process.argv[2]!=='--provision')
    throw Error('BLOCKED by default; explicit --provision is required');
  const {url,publicKey,adminKey}=configuration();
  const existing=await request(url,
    '/rest/v1/bm_organizations?select=id,slug,name&slug=in.('+SLUGS.join(',')+')',
    adminKey);
  if(!Array.isArray(existing)||existing.length!==2)
    throw Error('Exactly two seeded synthetic organizations required');
  const orgs=SLUGS.map((slug,i)=>{
    const row=one(existing.filter(v=>v.slug===slug&&v.name===NAMES[i]));
    if(!row)throw Error('Synthetic organization labels do not match approved seed');
    return validId(row.id);
  });
  const users=await request(url,'/auth/v1/admin/users?page=1&per_page=100',adminKey);
  // Refuse to overwrite existing Auth users or resume an ambiguous partial run.
  if(!users||!Array.isArray(users.users)||users.users.length!==0)
    throw Error('Existing Auth users detected; stop for independent review');
  const credentials=[];
  for(let i=0;i<2;i++){
    const email='bm-fixture-20261022-'+(i===0?'a':'b')+'@example.test';
    const password=randomBytes(36).toString('base64url')+'Aa9!';
    // Admin API creates a confirmed, deliberately nonexistent test email.
    // It does not dispatch a confirmation email to a real recipient.
    const created=await request(url,'/auth/v1/admin/users',adminKey,'POST',{
      email,password,email_confirm:true,
      app_metadata:{bidmason_test_fixture:'item6-h01-h02-20261022'}
    });
    const userId=validId(created.id??created.user?.id);
    // Use actual GoTrue password grant, never a service-role-simulated JWT.
    const session=await request(url,'/auth/v1/token?grant_type=password',
      publicKey,'POST',{email,password});
    if(typeof session?.access_token!=='string'||session.access_token.length<60
      ||validId(session.user?.id)!==userId)
      throw Error('Auth session mismatch; fixture not accepted');
    credentials.push({userId,jwt:session.access_token});
  }
  if(credentials[0].userId===credentials[1].userId)
    throw Error('Auth sessions are not independent');
  const revisions=[],paths=[];
  for(let i=0;i<2;i++){
    const org=orgs[i],actor=credentials[i];
    const membership=await request(url,'/rest/v1/bm_memberships',adminKey,'POST',{
      organization_id:org,user_id:actor.userId,member_role:'owner'
    });
    if(!one(membership))throw Error('Membership was not confirmed');
    // The real signed-in user submits a minimal immutable RLS-protected row.
    const revision=await request(url,'/rest/v1/bm_brief_revisions',
      publicKey,'POST',{
        organization_id:org,revision:1,document:{},
        content_sha256:createHash('sha256').update('{}').digest('hex')
      },actor.jwt);
    revisions.push(validId(one(revision)?.id));
    const path=org+'/'+randomUUID()+'.png';
    await request(url,'/storage/v1/object/bm-evidence/'+path,
      publicKey,'POST',PNG,actor.jwt,'image/png');
    paths.push(path);
  }
  const env={
    BIDMASON_H01_URL:url,BIDMASON_H01_PUBLISHABLE_KEY:publicKey,
    BIDMASON_H01_USER_A_JWT:credentials[0].jwt,
    BIDMASON_H01_USER_B_JWT:credentials[1].jwt,
    BIDMASON_H01_ORG_A:orgs[0],BIDMASON_H01_ORG_B:orgs[1],
    BIDMASON_H01_REVISION_A:revisions[0],
    BIDMASON_H01_REVISION_B:revisions[1],
    BIDMASON_H02_URL:url,BIDMASON_H02_PUBLISHABLE_KEY:publicKey,
    BIDMASON_H02_USER_A_JWT:credentials[0].jwt,
    BIDMASON_H02_USER_B_JWT:credentials[1].jwt,
    BIDMASON_H02_PATH_A:paths[0],BIDMASON_H02_PATH_B:paths[1]
  };
  const python=process.env.BIDMASON_FIXTURE_PYTHON??'python3';
  const probes=[
    runProbe(python,'ci.item6_rls_readonly_probe',env),
    runProbe(python,'ci.item6_storage_readonly_probe',env)
  ];
  console.log(JSON.stringify({
    state:'provisioned-synthetic-only',createdAuthUsers:2,
    createdMemberships:2,createdBriefRevisions:2,
    uploadedPrivateObjects:2,h01H02:probes,releaseAuthorized:false
  }));
  if(probes.some(x=>x.status==='blocked'))process.exitCode=1;
}
try{await provision();}
catch(error){
  // Never print stack traces, keys, tokens, test IDs or provider responses.
  console.error('BLOCKED: '+(error instanceof Error?error.message:'fixture provisioning failed'));
  process.exitCode=2;
}
