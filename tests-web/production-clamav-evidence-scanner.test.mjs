import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSignedDailyInfo, parseLoadedDatabaseVersion,
  createProductionClamAvScanner,
} from "../lib/production-clamav-evidence-scanner.ts";

const NOW = Date.UTC(2026,9,18,12,0,0);
const signed = (builtAt,version=28123,signatureCount=312345)=>
  ["File: /var/lib/clamav/daily.cld",
   "Build time: "+new Date(builtAt).toUTCString(),
   "Version: "+version,"Signatures: "+signatureCount,
   "Builder: official",
   "Verification OK.", ""].join("\n");

test("official signed daily database parser checks signed proof and freshness",()=>{
  assert.equal(parseSignedDailyInfo(signed(NOW-2*60*60*1000),NOW),28123);
  assert.equal(parseSignedDailyInfo(signed(NOW-72*60*60*1000),NOW),28123);
  for(const sample of [
    signed(NOW-73*60*60*1000),
    signed(NOW+6*60*1000),
    signed(NOW).replace("Verification OK.","Verification FAILED."),
    signed(NOW).replace("Version: 28123","Version: 0"),
    signed(NOW,28123,1),
    "File: fake.ndb\nBuild time: fresh\nVersion: 28123\nSignatures: 10000",
    signed(NOW).replace("Build time:", "No build time:"),
  ]) assert.throws(()=>parseSignedDailyInfo(sample,NOW),/ClamAV/);
});

test("daemon loaded VERSION must explicitly match supported ClamAV protocol",()=>{
  assert.equal(parseLoadedDatabaseVersion("ClamAV 1.4.3/28123/Sun Oct 18 2026\0"),28123);
  for(const bad of [
    "COMMAND UNAVAILABLE\0","PONG\0","ClamAV 1.4.3/0/Oct 18\0",
    "ClamAV 1.4.3/28123/Sun Oct 18 2026\n",
    "ClamAV 1.4.3/28123/Sun Oct 18 2026\0garbage",
    "ClamAV 1.4.3/28123/Sun\nOct 18\0",
    "x".repeat(300),
  ]) assert.throws(()=>parseLoadedDatabaseVersion(bad),/ClamAV/);
});

test("production scanner refuses missing official daily database even if daemon might say clean",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"bm-clamav-unsigned-"));
  try{
    const scanner=createProductionClamAvScanner({port:3310,signatureDirectory:dir});
    await assert.rejects(scanner(Buffer.from("%PDF-1.7\n"),"application/pdf"),/Signed ClamAV daily database unavailable/);
    assert.throws(()=>createProductionClamAvScanner({port:3310,signatureDirectory:"relative"}),/signature directory/);
    assert.throws(()=>createProductionClamAvScanner({port:0,signatureDirectory:dir}),/port/);
    const ctl=new AbortController();ctl.abort();
    await assert.rejects(scanner(Buffer.from("%PDF-1.7\n"),"application/pdf",ctl.signal),/cancelled/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("synthetic real-engine CI fixture is not acceptable evidence of production signature readiness",()=>{
  const fixture="File: /tmp/ci/bidmason-ci.ndb\nVersion: 1\nSignatures: 1\nVerification OK.";
  assert.throws(()=>parseSignedDailyInfo(fixture,NOW),/ClamAV/);
});
