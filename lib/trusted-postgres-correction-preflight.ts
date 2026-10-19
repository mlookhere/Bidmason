import { createHash } from "node:crypto";
import { verifyTypedNoteSourceRecord, type TypedNoteSourceRecord }
  from "./tenant-typed-note-source.ts";
import type { TrustedExtractionCorrectionStore, TenantExtractionCorrectionRecord }
  from "./tenant-extraction-correction.ts";
import type { ActiveSessionVerifier, PrivateIntakeDatabase }
  from "./trusted-typed-note-ledger.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const READ=`select record from bm_intake_private.read_typed_note_for_extraction(
  $1::uuid,$2::uuid,$3::uuid)`;

function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
  return !!value && typeof value==="object" && !Array.isArray(value)
    && [Object.prototype,null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length===keys.length && keys.every(key=>{
      const d=Object.getOwnPropertyDescriptor(value,key);
      return d?.enumerable===true && Object.hasOwn(d,"value");
    });
}
function digest(text:string):string {
  return createHash("sha256").update(text,"utf8").digest("hex");
}

/**
 * Read-only compatibility layer between the REAL disposable PostgreSQL
 * extraction source and the typed human-correction contract.
 *
 * The staged SQL sources support revisions 1..3 and deliberately lack
 * pending/activated correction columns or a correction CAS transaction.
 * Therefore mutation MUST remain disabled, not simulated or silently
 * persisted in memory. Never connect this to a public route/replica.
 */
export function createTrustedPostgresCorrectionPreflightStore(
  auth:ActiveSessionVerifier, db:PrivateIntakeDatabase,
):TrustedExtractionCorrectionStore {
  async function actor(session:unknown):Promise<string>{
    const identity=await auth.verifyActiveSession(session);
    if(!exact(identity,["userId"])||typeof identity.userId!=="string"
      || !UUID.test(identity.userId)){
      throw new Error("Current authenticated correction reviewer required");
    }
    return identity.userId;
  }
  return {
    async readAuthorized(input){
      if(!exact(input,["organizationId","sourceId","session"])
        || typeof input.organizationId!=="string"||!UUID.test(input.organizationId)
        || typeof input.sourceId!=="string"||!UUID.test(input.sourceId)
        || input.session===null||input.session===undefined){
        throw new TypeError("Invalid private correction preflight selector");
      }
      // Freeze all selectors before the first await; the caller must not
      // retarget this read or the second Auth check during an in-flight query.
      const organizationId=input.organizationId;
      const sourceId=input.sourceId;
      const session=input.session;
      const verified=await actor(session);
      // The private SQL checks and locks CURRENT tenant membership before
      // querying source identity and restricts rows to the original creator.
      const response=await db.query(READ,[organizationId,verified,sourceId]);
      if(!response||!Array.isArray(response.rows)||response.rows.length!==1
        || !exact(response.rows[0],["record"])){
        throw new Error("Authorized correction original is unavailable");
      }
      // A changed/revoked session cannot complete an apparently safe read.
      if(await actor(session)!==verified){
        throw new Error("Correction reviewer session changed during read");
      }
      const record=response.rows[0].record as TypedNoteSourceRecord;
      if(!record||!exact(record,["organizationId","sourceId","revision",
          "original","review","extractionAudit","scopeReview","creationAudit"])
        || record.organizationId!==organizationId
        || record.sourceId!==sourceId
        || !exact(record.creationAudit,["actorId","requestId","textSha256"])
        || record.creationAudit.actorId!==verified
        || !exact(record.original,["kind","text"])
        || typeof record.original.text!=="string"){
        throw new Error("Untrusted correction source projection");
      }
      const textSha256=digest(record.original.text);
      verifyTypedNoteSourceRecord(record,{
        organizationId,
        requestId:record.creationAudit.requestId,
        text:record.original.text,
      },textSha256,verified);
      if(record.revision===1){
        // There is no committed model extraction to correct.
        return null;
      }
      // Explicit null lifecycle markers are safe only because the real
      // staged database has NO correction columns and cannot write them.
      // A changed schema/projection must fail validation above until a
      // separately reviewed, tested correction-specific SQL adapter exists.
      const projected: TenantExtractionCorrectionRecord = {
        ...record, pendingCorrection:null, activatedCorrection:null,
      };
      return projected;
    },
    async mutateAuthorized(_input){
      // This MUST remain unavailable until a real database migration
      // independently enforces tenant membership, source ownership, revision
      // CAS, immutable original/audit and correction append-only lineage.
      // Never call the requested transform or execute any SQL.
      throw new Error("Correction persistence unavailable: staged PostgreSQL has no authorized correction CAS");
    },
  };
}
