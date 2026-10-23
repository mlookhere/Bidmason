/** Strict child-process environment for opt-in read-only Auth/Storage probes.
 * Never forward provider Admin secrets, ambient app credentials, proxy settings,
 * or arbitrary operator environment variables into H01/H02 probe subprocesses.
 * This module performs no network, file writes, or subprocess execution. */
const PLATFORM_KEYS=[
  "PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "PATHEXT",
  "COMSPEC", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR",
  "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV",
];
const PROBE_KEYS=new Set([
  "BIDMASON_H01_URL", "BIDMASON_H01_PUBLISHABLE_KEY",
  "BIDMASON_H01_USER_A_JWT", "BIDMASON_H01_USER_B_JWT",
  "BIDMASON_H01_ORG_A", "BIDMASON_H01_ORG_B",
  "BIDMASON_H01_REVISION_A", "BIDMASON_H01_REVISION_B",
  "BIDMASON_H02_URL", "BIDMASON_H02_PUBLISHABLE_KEY",
  "BIDMASON_H02_USER_A_JWT", "BIDMASON_H02_USER_B_JWT",
  "BIDMASON_H02_PATH_A", "BIDMASON_H02_PATH_B",
]);

export function limitedProbeEnvironment(ambient,probe){
  if(!ambient || typeof ambient!=="object" || !probe || typeof probe!=="object")
    throw new TypeError("Probe environment must be explicitly provided");
  const output=Object.create(null);
  for(const key of PLATFORM_KEYS){
    if(typeof ambient[key]==="string")output[key]=ambient[key];
  }
  for(const [key,value] of Object.entries(probe)){
    if(!PROBE_KEYS.has(key)||typeof value!=="string"||!value.length)
      throw new TypeError("Unexpected live-probe environment field");
    output[key]=value;
  }
  // Each probe's required inputs are deliberately explicit. A forgotten
  // bearer session or test path must block before invoking child processes.
  if([...PROBE_KEYS].some(key=>!Object.hasOwn(output,key)))
    throw new TypeError("Incomplete H01/H02 live-probe environment");
  return output;
}
