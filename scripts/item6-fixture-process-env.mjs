/** Strict child-process environment for opt-in read-only Auth/Storage probes.
 * Never forward provider Admin secrets, ambient app credentials, proxy settings,
 * Python import overrides, or JWTs intended for the OTHER diagnostic.
 * This module performs no network, file writes, or subprocess execution. */
const PLATFORM_KEYS=[
  "PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "PATHEXT",
  "COMSPEC", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR",
];
// PYTHONPATH and PYTHONHOME can change which code executes under -m. The
// authenticated probes must import repository-owned modules from their cwd.
const H01=[
  "BIDMASON_H01_URL", "BIDMASON_H01_PUBLISHABLE_KEY",
  "BIDMASON_H01_USER_A_JWT", "BIDMASON_H01_USER_B_JWT",
  "BIDMASON_H01_ORG_A", "BIDMASON_H01_ORG_B",
  "BIDMASON_H01_REVISION_A", "BIDMASON_H01_REVISION_B",
];
const H02=[
  "BIDMASON_H02_URL", "BIDMASON_H02_PUBLISHABLE_KEY",
  "BIDMASON_H02_USER_A_JWT", "BIDMASON_H02_USER_B_JWT",
  "BIDMASON_H02_PATH_A", "BIDMASON_H02_PATH_B",
];
const MODULE_KEYS=new Map([
  ["ci.item6_rls_readonly_probe",H01],
  ["ci.item6_storage_readonly_probe",H02],
]);
const ALLOWED_INPUTS=new Set([...H01,...H02]);

/** Requires the complete validated fixture input object, but forwards only
 * the named diagnostic's own keys. Any missing credential or unknown module
 * fails before Python is spawned. */
export function limitedProbeEnvironment(ambient,probe,module){
  if(!ambient || typeof ambient!=="object" || !probe || typeof probe!=="object")
    throw new TypeError("Probe environment must be explicitly provided");
  const required=MODULE_KEYS.get(module);
  if(!required)
    throw new TypeError("Unrecognized H01/H02 live-probe module");
  for(const [key,value] of Object.entries(probe)){
    if(!ALLOWED_INPUTS.has(key)||typeof value!=="string"||!value.length)
      throw new TypeError("Unexpected live-probe environment field");
  }
  if([...ALLOWED_INPUTS].some(key=>!Object.hasOwn(probe,key)))
    throw new TypeError("Incomplete H01/H02 live-probe environment");
  const output=Object.create(null);
  for(const key of PLATFORM_KEYS){
    if(typeof ambient[key]==="string")output[key]=ambient[key];
  }
  for(const key of required)output[key]=probe[key];
  return output;
}
