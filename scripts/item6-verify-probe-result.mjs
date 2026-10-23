/** Schema gate for opt-in real H01/H02 read-only probes.
 * Every expected case must be present and true in its documented order.
 * An exit code alone, incomplete checklist, changed schema, or forged release
 * approval is never enough to label diagnostic evidence reviewable.
 * Pure local parser; no network, token handling, persistence, or send action. */
const H01_STEPS=[
  "own-organization","other-organization","enumerate-organizations",
  "own-membership","other-membership","foreign-organization-memberships",
  "enumerate-memberships","own-brief-revision","other-brief-revision",
  "foreign-organization-brief-revisions","enumerate-brief-revisions",
];
const H01_CASES=[
  "user-1-auth","user-2-auth",
  ...[1,2].flatMap(user=>H01_STEPS.map(name=>`user-${user}-${name}`)),
  "anonymous-organizations","anonymous-memberships","anonymous-brief-revisions",
];
const H02_CASES=[
  "user-1-auth","user-2-auth",
  "user-1-own-membership","user-1-foreign-memberships",
  "user-2-own-membership","user-2-foreign-memberships",
  "user-1-own-object","user-1-other-object",
  "user-2-own-object","user-2-other-object",
  "anonymous-object-1","anonymous-object-2",
  "public-object-1","public-object-2",
  "public-with-key-object-1","public-with-key-object-2",
];
const SPEC=new Map([
  ["ci.item6_rls_readonly_probe",{
    schema:"bidmason.item6.h01-readonly-probe.v1",
    acceptance:"h01Accepted",
    checks:H01_CASES,
    notTested:["write-boundary","missing-membership","session-revocation",
      "storage","independent-human-review"],
  }],
  ["ci.item6_storage_readonly_probe",{
    schema:"bidmason.item6.h02-readonly-object-probe.v2",
    acceptance:"h02Accepted",
    checks:H02_CASES,
    notTested:["uploads","upserts","signed-url-expiry","signed-url-revocation",
      "malicious-paths","session-revocation","independent-human-review"],
  }],
]);
/** Python probes use print(json.dumps(result, sort_keys=True)), with the
 * standard ': ' and ', ' separators, ASCII-only report strings and a single
 * output newline. A parsed JSON object does not remember duplicate keys:
 * re-serialize the verified structure and compare exact bytes before it can
 * be treated as evidence. The fixed schema admits no non-ASCII values.
 * Do not accept arbitrary logs, pretty-printing or a second JSON document. */
function canonicalPythonJson(value){
  if(value===null)return "null";
  if(typeof value==="boolean")return value?"true":"false";
  if(typeof value==="string"){
    if(!/^[\x00-\x7f]*$/.test(value))
      throw new TypeError("Non-ASCII read-only probe report");
    return JSON.stringify(value);
  }
  if(Array.isArray(value))
    return "["+value.map(canonicalPythonJson).join(", ")+"]";
  if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype)
    return "{"+Object.keys(value).sort().map(k=>
      JSON.stringify(k)+": "+canonicalPythonJson(value[k])).join(", ")+"}";
  throw new TypeError("Noncanonical read-only probe JSON value");
}

function record(value,fields){
  if(value===null||typeof value!=="object"||Array.isArray(value)
    ||Object.getPrototypeOf(value)!==Object.prototype)return false;
  const keys=Reflect.ownKeys(value);
  return keys.length===fields.length
    &&fields.every(key=>Object.hasOwn(value,key));
}

/** Return a nonauthorizing aggregate only; never return arbitrary probe JSON. */
export function verifyReadOnlyProbeReport(module,raw){
  const expected=SPEC.get(module);
  if(!expected||typeof raw!=="string"||raw.length<10||raw.length>150000)
    throw new TypeError("Invalid read-only probe report");
  let result;
  try{result=JSON.parse(raw);}
  catch{throw new TypeError("Malformed read-only probe report");}
  // The Python subprocess prints one compact sorted-key JSON object and a
  // newline. CRLF is accepted for a Windows operator host; any other output
  // or a duplicate/unknown key in the wire format fails closed.
  const canonical=canonicalPythonJson(result);
  if(raw!==canonical+"\\n" && raw!==canonical+"\\r\\n"){
    throw new TypeError("Noncanonical read-only probe report");
  }
  const top=["schema","state","releaseAuthorized",expected.acceptance,
    "checks","notTested"];
  if(!record(result,top)||result.schema!==expected.schema
    ||result.state!=="requires-independent-review"
    ||result.releaseAuthorized!==false
    ||result[expected.acceptance]!==false
    ||!Array.isArray(result.checks)
    ||result.checks.length!==expected.checks.length
    ||!Array.isArray(result.notTested)
    ||result.notTested.length!==expected.notTested.length){
    throw new TypeError("Incomplete or unsafe read-only probe report");
  }
  for(let i=0;i<expected.checks.length;i++){
    const check=result.checks[i];
    if(!record(check,["name","passed"])
      ||check.name!==expected.checks[i]||check.passed!==true){
      throw new TypeError("Missing or failed read-only probe control");
    }
  }
  if(result.notTested.some((name,i)=>name!==expected.notTested[i])){
    throw new TypeError("Incomplete read-only probe limitations");
  }
  return {status:"requires-independent-review",
    checksPassed:expected.checks.length,releaseAuthorized:false};
}
