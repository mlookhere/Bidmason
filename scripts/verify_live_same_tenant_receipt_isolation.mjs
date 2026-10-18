import { verifySameTenantEvidencePrivacy } from "../lib/live-evidence-isolation.ts";

// Manual READ-ONLY test using pre-existing, operator-approved synthetic user
// sessions/receipt-backed evidence. Never creates users, tokens or objects.
const e=process.env;
if(e.BIDMASON_LIVE_ISOLATION_APPROVED!=="read-only-existing-fixtures"){
  process.stderr.write("FAIL: approved read-only verification is required\n");
  process.exitCode=1;
}else{
  const required=[
    e.BIDMASON_TEST_PUBLISHABLE_KEY,
    e.BIDMASON_TEST_TOKEN_UPLOADER,
    e.BIDMASON_TEST_TOKEN_OTHER_CONTRACTOR,
    e.BIDMASON_TEST_ORG,
    e.BIDMASON_TEST_RECEIPT_PATH,
  ];
  if(!required.every(Boolean)){
    process.stderr.write("FAIL: two pre-existing signed-in same-tenant users and verified receipt required\n");
    process.exitCode=1;
  }else{
    try{
      const result=await verifySameTenantEvidencePrivacy({
        publishableKey:e.BIDMASON_TEST_PUBLISHABLE_KEY,
        uploader:{
          authorization:"Bearer "+e.BIDMASON_TEST_TOKEN_UPLOADER,
          organizationId:e.BIDMASON_TEST_ORG,
          existingReceiptPath:e.BIDMASON_TEST_RECEIPT_PATH,
        },
        otherContractor:{
          authorization:"Bearer "+e.BIDMASON_TEST_TOKEN_OTHER_CONTRACTOR,
          organizationId:e.BIDMASON_TEST_ORG,
        },
      });
      process.stdout.write("PASS: genuine same-tenant private evidence read isolation "+
        JSON.stringify(result)+"\n");
    }catch{
      process.stderr.write("FAIL: genuine same-tenant Auth/Storage evidence isolation not established\n");
      process.exitCode=1;
    }
  }
}
