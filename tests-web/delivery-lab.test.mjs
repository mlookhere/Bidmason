import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildSyntheticDeliveryLabCases} from "../lib/delivery-lab-fixtures.ts";
const page=readFileSync(new URL("../app/delivery-lab/page.tsx",import.meta.url),"utf8");

test("four invented cases are derived from actual offline CRM and follow-up logic",()=>{
  const cases=buildSyntheticDeliveryLabCases();
  assert.deepEqual(cases.map(x=>x.id),[
    "painting-reply","cleaning-bounce","painting-consent-unknown","cleaning-internal-candidate",
  ]);
  assert.ok(cases.every(x=>x.projection.state==="simulation-only"));
  assert.ok(cases.every(x=>x.projection.eventCount>=3&&x.company.startsWith("Fictional")));
});
test("reply, bounce and unknown consent each block follow-up",()=>{
  const byId=Object.fromEntries(buildSyntheticDeliveryLabCases().map(x=>[x.id,x]));
  assert.equal(byId["painting-reply"].followUp.state,"blocked");
  assert.ok(byId["painting-reply"].followUp.blockers.some(x=>x.includes("reply")));
  assert.equal(byId["cleaning-bounce"].projection.delivery,"bounced");
  assert.deepEqual(byId["cleaning-bounce"].projection.suppression,["bounced"]);
  assert.equal(byId["cleaning-bounce"].followUp.state,"blocked");
  assert.equal(byId["painting-consent-unknown"].followUp.state,"blocked");
  assert.ok(byId["painting-consent-unknown"].followUp.blockers.some(x=>x.includes("consent")));
});
test("timing candidate never becomes a sending authorization",()=>{
  const candidate=buildSyntheticDeliveryLabCases().find(x=>x.id==="cleaning-internal-candidate");
  assert.equal(candidate.followUp.state,"candidate-internal-only");
  assert.deepEqual(candidate.followUp.blockers,[]);
  assert.match(page,/Internal candidate only — not send approval/);
  assert.match(page,/External authorization and real consent remain unverified/);
  assert.doesNotMatch(page,/<form\b|<input\b|<button\b|<textarea\b/i);
});
test("static route discloses limits and remains noindex, no input or mutation",()=>{
  assert.match(page,/Synthetic records only/);
  assert.match(page,/not access controlled/);
  assert.match(page,/robots: \{index: false, follow: false\}/);
  assert.match(page,/Skip to main content/);
  assert.match(page,/aria-labelledby="cases-heading"/);
  assert.match(page,/Delivery remains disabled/);
  assert.doesNotMatch(page,/fetch\(|submit\(|localStorage|sessionStorage|use client/i);
});
