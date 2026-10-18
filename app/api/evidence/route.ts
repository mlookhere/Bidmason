import { downloadMemberEvidence } from "../../../lib/private-evidence-download.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'none'",
  "referrer-policy": "no-referrer",
  vary: "Authorization",
};

export async function GET(request: Request) {
  // Disabled until two genuine Auth/Storage sessions, operational rate
  // limits and deployment credentials have been verified on this project.
  if (process.env.BIDMASON_PRIVATE_DOWNLOAD_ENABLED !== "true") {
    return Response.json(
      { error: "Private evidence downloads are not enabled" },
      { status: 503, headers: HEADERS },
    );
  }
  const url = new URL(request.url);
  const result = await downloadMemberEvidence({
    authorization: request.headers.get("authorization"),
    organizationId: url.searchParams.get("organizationId"),
    objectPath: url.searchParams.get("objectPath"),
  }, { publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY, signal: request.signal });
  if (result.status !== 200) {
    return Response.json({ error: result.error }, { status: result.status, headers: HEADERS });
  }
  const extension = result.contentType === "application/pdf" ? "pdf"
    : result.contentType === "image/png" ? "png" : "jpg";
  return new Response(new Blob([Uint8Array.from(result.bytes)], { type: result.contentType }), {
    status: 200,
    headers: {
      ...HEADERS,
      "content-type": result.contentType,
      "content-disposition": 'attachment; filename="evidence.' + extension + '"',
      "content-length": String(result.bytes.byteLength),
    },
  });
}
