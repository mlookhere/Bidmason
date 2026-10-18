import { NextResponse } from "next/server";
import { lookupAccount } from "../../../lib/supabase-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const result = await lookupAccount(
    request.headers.get("authorization"),
    process.env.SUPABASE_PUBLISHABLE_KEY,
  );
  const headers = { "cache-control": "no-store, private", "x-content-type-options": "nosniff" };
  return NextResponse.json(
    result.status === 200 ? result.data : { error: result.error },
    { status: result.status, headers },
  );
}
