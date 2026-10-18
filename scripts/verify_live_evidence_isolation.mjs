import { verifyLiveEvidenceIsolation } from "../lib/live-evidence-isolation.ts";

// Explicit manual operator invocation ONLY. Not a default/skippable CI gate.
// No bearer tokens or source documents are printed even on failure.
const e = process.env;
if (e.BIDMASON_LIVE_ISOLATION_APPROVED !== "read-only-existing-fixtures") {
  process.stderr.write("FAIL: approved read-only test operator invocation required\n");
  process.exitCode = 1;
} else {
  const key = e.BIDMASON_TEST_PUBLISHABLE_KEY;
  const tokenA = e.BIDMASON_TEST_TOKEN_A;
  const tokenB = e.BIDMASON_TEST_TOKEN_B;
  const orgA = e.BIDMASON_TEST_ORG_A;
  const orgB = e.BIDMASON_TEST_ORG_B;
  const pathA = e.BIDMASON_TEST_RECEIPT_A;
  const pathB = e.BIDMASON_TEST_RECEIPT_B;
  if (![key, tokenA, tokenB, orgA, orgB, pathA, pathB].every(Boolean)) {
    process.stderr.write("FAIL: two pre-existing signed-in tenant sessions and receipt paths required\n");
    process.exitCode = 1;
  } else {
    try {
      const result = await verifyLiveEvidenceIsolation({
        publishableKey: key,
        first: { authorization: "Bearer " + tokenA, organizationId: orgA, existingReceiptPath: pathA },
        second: { authorization: "Bearer " + tokenB, organizationId: orgB, existingReceiptPath: pathB },
      });
      process.stdout.write("PASS: verified live read-only two-tenant evidence isolation: " +
        JSON.stringify(result) + "\n");
    } catch {
      process.stderr.write("FAIL: real two-tenant evidence isolation not established (details suppressed)\n");
      process.exitCode = 1;
    }
  }
}
