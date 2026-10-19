import { Buffer } from "node:buffer";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN=/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}$/;
const SQL="select bm_intake_private.auth_session_is_active("+
  "$1::uuid,$2::uuid) as active";
const DENIED="Current verified Supabase Auth session required";

/** Auth-validated session identity. Never assemble from browser-supplied IDs. */
export interface VerifiedSessionBinding {
  userId:string;
  sessionId:string;
}
export interface SessionBoundActiveSessionVerifier extends ActiveSessionVerifier {
  verifySessionBinding(session:unknown):Promise<VerifiedSessionBinding>;
}

function sessionIdOfVerifiedJwt(token:string,userId:string):string {
  // The Auth server must validate this VERY token first. Decoding JWT
  // payload bytes alone is NEVER proof of signature or authorization.
  const payload=token.split(".")[1];
  if(payload.length>8192)throw Error(DENIED);
  let claims:unknown;
  try {
    const decoded=Buffer.from(payload,"base64url").toString("utf8");
    if(Buffer.from(decoded,"utf8").toString("base64url")!==payload)
      throw Error(DENIED);
    claims=JSON.parse(decoded);
  }catch{throw Error(DENIED);}
  if(!claims||typeof claims!=="object"||Array.isArray(claims))throw Error(DENIED);
  const c=claims as Record<string,unknown>;
  if(c.sub!==userId || typeof c.session_id!=="string"
    || !UUID.test(c.session_id)
    || !Number.isSafeInteger(c.iat)
    || !Number.isSafeInteger(c.exp))throw Error(DENIED);
  const now=Math.floor(Date.now()/1000);
  if((c.iat as number)>now+60 || (c.exp as number)<=now
    || (c.exp as number)<=(c.iat as number))throw Error(DENIED);
  return c.session_id;
}

/**
 * Strict server-only alternative to JWT-only verification for sensitive
 * internal pricing. Each invocation performs live Auth verification BEFORE
 * reading JWT claims, then probes the current auth.sessions row in primary
 * PostgreSQL. Missing/revoked/foreign-user session fails closed.
 *
 * The primary DB query must run under a protected service role. Neither
 * raw token nor private session rows may reach client code or logs.
 */
export function createSessionBoundSupabaseVerifier(
 auth:ActiveSessionVerifier,primary:PrivateIntakeDatabase,
):SessionBoundActiveSessionVerifier {
  async function verifySessionBinding(session:unknown):Promise<VerifiedSessionBinding> {
      if(typeof session!=="string"||session.length>16384
        || !TOKEN.test(session))throw Error(DENIED);
      // Independently verify token via trusted Auth server first.
      const identity=await auth.verifyActiveSession(session);
      if(!identity||!UUID.test(identity.userId))throw Error(DENIED);
      const sessionId=sessionIdOfVerifiedJwt(session,identity.userId);
      let rows:unknown;
      try {
        const result=await primary.query(SQL,[identity.userId,sessionId]);
        rows=result?.rows;
      }catch{throw Error(DENIED);}
      if(!Array.isArray(rows)||rows.length!==1
        || !rows[0]||typeof rows[0]!=="object"
        || Array.isArray(rows[0])
        || Reflect.ownKeys(rows[0]).length!==1
        || Object.getOwnPropertyDescriptor(rows[0],"active")?.value!==true){
        throw Error(DENIED);
      }
      return {userId:identity.userId,sessionId};
  }
  return {
    verifySessionBinding,
    async verifyActiveSession(session:unknown):Promise<{userId:string}> {
      const identity=await verifySessionBinding(session);
      return {userId:identity.userId};
    },
  };
}
