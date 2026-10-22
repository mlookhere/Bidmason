import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildSyntheticDeliveryLabCases, buildSyntheticDeliveryLabSummaries} from "../lib/delivery-lab-fixtures.ts";
const page=readFileSync(new URL("../app/delivery-lab/page.tsx",import.meta.url),"utf8");

test("seven invented cases are derived from actual offline CRM and follow-up logic",()=>{
  const cases=buildSyntheticDeliveryLabCases();
  assert.deepEqual(cases.map(x=>x.id),[
    "painting-reply","cleaning-bounce","painting-consent-unknown","cleaning-internal-candidate",
    "cleaning-prior-optout","painting-prior-reply","painting-deal-won",
  ]);
  assert.ok(cases.every(x=>x.projection.state==="simulation-only"));
  assert.ok(cases.every(x=>x.triage.state==="review-simulation-only"));
  assert.ok(cases.every(x=>x.projection.eventCount>=3&&x.company.startsWith("Fictional")));
});
test("redacted CRM summaries stay tenant-scoped and never imply send authority",()=>{
  const reports=buildSyntheticDeliveryLabSummaries();
  assert.equal(reports.length,2);
  const grouped=Object.fromEntries(reports.map(x=>[x.company,x.report]));
  const painting=grouped["Fictional painting contractor"];
  const cleaning=grouped["Fictional cleaning contractor"];
  assert.deepEqual(painting.attention,{stopContact:0,operatorReview:3,deferred:1});
  assert.deepEqual(cleaning.attention,{stopContact:2,operatorReview:1,deferred:0});
  assert.equal(painting.reviewedCases,4);
  assert.equal(cleaning.reviewedCases,3);
  for(const {company,report} of reports){
    assert.ok(company.startsWith("Fictional "));
    assert.equal(report.state,"review-simulation-only");
    assert.equal(report.categories.reduce((sum,c)=>sum+c.count,0),report.reviewedCases);
    const serialized=JSON.stringify(report);
    for(const forbidden of ["buyer@", "dryrun_", "organizationId", "proposalId", "recipient", "contactAuthorized", "sendAllowed"])
      assert.ok(!serialized.includes(forbidden),forbidden);
    assert.deepEqual(Object.keys(report).sort(),["attention","categories","reviewedCases","state"]);
  }
});
test("fictional company pipeline is derived from the same scoped CRM evidence",()=>{
  const summaries=buildSyntheticDeliveryLabSummaries();
  const byCompany=Object.fromEntries(summaries.map(item=>[item.company,item]));
  const painting=byCompany["Fictional painting contractor"];
  const cleaning=byCompany["Fictional cleaning contractor"];
  assert.deepEqual(painting.pipeline.delivery,{
    notStarted:0,reserved:0,accepted:0,reportedDelivered:4,bounced:0,
  });
  assert.deepEqual(painting.pipeline.deals,{unverified:3,won:1,lost:0});
  assert.equal(painting.pipeline.distinctProposals,4);
  assert.deepEqual(cleaning.pipeline.delivery,{
    notStarted:0,reserved:0,accepted:0,reportedDelivered:2,bounced:1,
  });
  assert.deepEqual(cleaning.pipeline.deals,{unverified:3,won:0,lost:0});
  assert.equal(cleaning.pipeline.distinctProposals,3);
  for(const {report,pipeline} of summaries){
    assert.equal(pipeline.reviewedCases,report.reviewedCases);
    assert.deepEqual(pipeline.attention,report.attention);
    assert.equal(Object.values(pipeline.delivery).reduce((a,b)=>a+b,0),
      pipeline.reviewedCases);
    assert.equal(Object.values(pipeline.deals).reduce((a,b)=>a+b,0),
      pipeline.distinctProposals);
    assert.equal(pipeline.state,"crm-simulation-only");
    assert.equal(pipeline.contactAuthorized,false);
    assert.equal(pipeline.dataComplete,false);
    const output=JSON.stringify(pipeline);
    for(const secret of ["buyer@","fictional.example","dryrun_","organizationId",
      "proposalId","recipient","sourceSha256","policySha256"]){
      assert.equal(output.includes(secret),false);
    }
  }
});

test("lab renders explicit case-versus-proposal semantics without enabling contact",()=>{
  assert.match(page,/Fictional pipeline/);
  assert.match(page,/Case-level delivery reports; proposal-level deal outcomes/);
  assert.match(page,/Reported delivered · cases/);
  assert.match(page,/Won · unique proposals/);
  assert.match(page,/Unverified · unique proposals/);
  assert.match(page,/Incomplete fictional evidence\. No contact authorization/);
  assert.doesNotMatch(page,/<form\b|<input\b|<button\b|<textarea\b/i);
});

test("reply, bounce and unknown consent each block follow-up",()=>{
  const byId=Object.fromEntries(buildSyntheticDeliveryLabCases().map(x=>[x.id,x]));
  assert.equal(byId["painting-reply"].followUp.state,"blocked");
  assert.equal(byId["painting-reply"].triage.category,"reply-needs-review");
  assert.ok(byId["painting-reply"].followUp.blockers.some(x=>x.includes("reply")));
  assert.equal(byId["cleaning-bounce"].projection.delivery,"bounced");
  assert.equal(byId["cleaning-bounce"].triage.category,"contact-suppressed");
  assert.deepEqual(byId["cleaning-bounce"].projection.suppression,["bounced"]);
  assert.equal(byId["cleaning-bounce"].followUp.state,"blocked");
  assert.equal(byId["painting-consent-unknown"].followUp.state,"blocked");
  assert.equal(byId["painting-consent-unknown"].triage.category,"consent-needs-verification");
  assert.ok(byId["painting-consent-unknown"].followUp.blockers.some(x=>x.includes("consent")));
});
test("earlier fictional opt-out overrides otherwise internally eligible new proposal",()=>{
  const cases=buildSyntheticDeliveryLabCases();
  const caseWithHistory=cases.find(x=>x.id==="cleaning-prior-optout");
  assert.equal(caseWithHistory.followUp.state,"candidate-internal-only");
  assert.equal(caseWithHistory.triage.category,"contact-suppressed");
  assert.equal(caseWithHistory.triage.attention,"stop-contact");
  assert.deepEqual(caseWithHistory.historicalSuppression,["opted_out"]);
  assert.equal(caseWithHistory.triage.historicalStreams,1);
  assert.equal(caseWithHistory.triage.contactAuthorized,false);
  assert.equal(caseWithHistory.triage.state,"review-simulation-only");
  assert.equal(cases.filter(x=>x.triage.category==="external-authorization-required").length,1);
  assert.equal(cases.filter(x=>x.triage.category==="contact-suppressed").length,2);
  const serialized=JSON.stringify(caseWithHistory);
  for(const token of ["buyer-cleaning-prior-optout@", "11111111-1111", "22222222-2222", "dryrun_"])
    assert.ok(!serialized.includes(token),token);
});
test("an earlier fictional reply requires manual review despite a due-looking new proposal",()=>{
  const cases=buildSyntheticDeliveryLabCases();
  const priorReply=cases.find(x=>x.id==="painting-prior-reply");
  assert.equal(priorReply.projection.replied,false);
  assert.equal(priorReply.followUp.state,"candidate-internal-only");
  assert.equal(priorReply.triage.category,"reply-needs-review");
  assert.equal(priorReply.triage.attention,"operator-review");
  assert.equal(priorReply.triage.historicalReplyObserved,true);
  assert.deepEqual(priorReply.historicalSuppression,[]);
  assert.equal(priorReply.triage.historicalStreams,1);
  assert.equal(priorReply.triage.contactAuthorized,false);
  assert.equal(cases.filter(x=>x.triage.category==="reply-needs-review").length,2);
  assert.match(page,/Earlier recipient reply requires manual review before a new follow-up/);
  assert.match(page,/Reply in fictional earlier proposal — manual review required/);
  const serialized=JSON.stringify(priorReply);
  for(const forbidden of ["buyer-prior-reply@", "33333333-3333", "44444444-4444", "dryrun_"])
    assert.ok(!serialized.includes(forbidden),forbidden);
});
test("prior-proposal late replies and opt-outs keep company-wide review consistent",()=>{
  // Older proposal messages preceded the current reservation; their late
  // recipient response follows it and suppresses later contact. A stop that
  // preceded the new reservation would now fail the whole CRM audit.
  const lab=buildSyntheticDeliveryLabSummaries();
  const companies=Object.fromEntries(lab.map(row=>[row.company,row]));
  assert.equal(companies["Fictional cleaning contractor"]
    .report.categories.find(row=>row.category==="contact-suppressed").count,2);
  assert.equal(companies["Fictional painting contractor"]
    .report.categories.find(row=>row.category==="reply-needs-review").count,2);
  assert.ok(lab.every(row=>row.pipeline.contactAuthorized===false
    &&row.pipeline.dataComplete===false));
});

test("fictional won deal blocks reminders without converting the result into sending authority",()=>{
  const winner=buildSyntheticDeliveryLabCases().find(x=>x.id==="painting-deal-won");
  assert.equal(winner.dealOutcome,"won");
  assert.equal(winner.projection.delivery,"reported_delivered");
  assert.equal(winner.followUp.state,"blocked");
  assert.equal(winner.triage.category,"deal-closed");
  assert.equal(winner.triage.attention,"deferred");
  assert.equal(winner.triage.contactAuthorized,false);
  assert.ok(winner.followUp.blockers.some(x=>/won|lost|closed/i.test(x)));
  assert.match(page,/Won — follow-ups stopped \(fictional\)/);
  assert.match(page,/No closed outcome in fixture — unverified/);
  const json=JSON.stringify(winner);
  for(const forbidden of ["buyer-deal-won@", "55555555-5555", "dryrun_", "idempotencyKey"])
    assert.ok(!json.includes(forbidden),forbidden);
});
test("timing candidate never becomes a sending authorization",()=>{
  const candidate=buildSyntheticDeliveryLabCases().find(x=>x.id==="cleaning-internal-candidate");
  assert.equal(candidate.followUp.state,"candidate-internal-only");
  assert.equal(candidate.triage.category,"external-authorization-required");
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
  assert.match(page,/Operator review category/);
  assert.match(page,/Fictional CRM review overview/);
  assert.match(page,/Stop-contact review/);
  assert.match(page,/Earlier proposal suppression/);
  assert.match(page,/Earlier proposal reply/);
  assert.match(page,/Earlier recipient suppression overrides this proposal/);
  assert.match(page,/No contact authorization or live tenant access/);
  assert.match(page,/What an operator would review/);
  assert.doesNotMatch(page,/fetch\(|submit\(|localStorage|sessionStorage|use client/i);
});
