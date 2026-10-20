import {createHmac, randomBytes, timingSafeEqual} from "node:crypto";

/** Cryptographic consistency for an unexposed read-only buyer view grant.
 * Authenticating the issuer, recipient, active revision and revocation state
 * remains the responsibility of a future tenant-authorized server route. */
export type BuyerViewIdentity = {
  organizationId: string;
  proposalId: string;
  revision: number;
  recipientSha256: string;
  contentSha256: string;
};
export type BuyerViewResult =
  | {state:"signed-claims-only"; grantId:string; expiresAt:number}
  | {state:"blocked"; reason:string};

const VERSION="bmview1";
const AUDIENCE="buyer-readonly-proposal";
const MAX_LIFETIME=900; // 15 minutes, not a perpetual share link.
const MAX_TIME=8_640_000_000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const GRANT_ID=/^[a-f0-9]{32}$/;
const FIELDS=["organizationId","proposalId","revision","recipientSha256","contentSha256"] as const;
const CLAIM_FIELDS=["audience","organizationId","proposalId","revision",
  "recipientSha256","contentSha256","issuedAt","expiresAt","grantId"] as const;

type Claims=BuyerViewIdentity&{
  audience:typeof AUDIENCE;
  issuedAt:number;
  expiresAt:number;
  grantId:string;
};

function ownData(value:unknown,fields:readonly string[]):value is Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)
    ||Object.getPrototypeOf(value)!==Object.prototype
    ||Reflect.ownKeys(value).length!==fields.length)return false;
  return fields.every(field=>{
    const d=Object.getOwnPropertyDescriptor(value,field);
    return d?.enumerable===true&&Object.hasOwn(d,"value");
  });
}
function validIdentity(value:unknown):value is BuyerViewIdentity{
  if(!ownData(value,FIELDS))return false;
  return typeof value.organizationId==="string"&&UUID.test(value.organizationId)
    &&typeof value.proposalId==="string"&&UUID.test(value.proposalId)
    &&Number.isSafeInteger(value.revision)&&(value.revision as number)>=1
    &&typeof value.recipientSha256==="string"&&SHA.test(value.recipientSha256)
    &&typeof value.contentSha256==="string"&&SHA.test(value.contentSha256);
}
function keyBytes(key:unknown):key is Uint8Array{
  return key instanceof Uint8Array&&key.byteLength>=32&&key.byteLength<=128;
}
function validTime(value:unknown):value is number{
  return Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<=MAX_TIME;
}
function validClaims(value:unknown):value is Claims{
  if(!ownData(value,CLAIM_FIELDS))return false;
  const record=value as Record<string,unknown>;
  const identity=Object.fromEntries(FIELDS.map(field=>[field,record[field]]));
  return record.audience===AUDIENCE&&validIdentity(identity)
    &&validTime(record.issuedAt)&&validTime(record.expiresAt)
    &&(record.expiresAt as number)>(record.issuedAt as number)
    &&(record.expiresAt as number)-(record.issuedAt as number)<=MAX_LIFETIME
    &&typeof record.grantId==="string"&&GRANT_ID.test(record.grantId);
}
function sign(data:string,key:Uint8Array):Buffer{
  return createHmac("sha256",key).update("bidmason:buyer-view:v1:")
    .update(data).digest();
}

/** Issuance must only be called by a future authenticated, authorized server.
 * No sending, storage, provider call, or public access route is created here. */
export function createBuyerViewGrant(identity:BuyerViewIdentity,key:Uint8Array,
  nowSeconds:number,lifetimeSeconds=MAX_LIFETIME):string{
  if(!validIdentity(identity)||!keyBytes(key)||!validTime(nowSeconds)
    ||!Number.isSafeInteger(lifetimeSeconds)||lifetimeSeconds<1
    ||lifetimeSeconds>MAX_LIFETIME||nowSeconds+lifetimeSeconds>MAX_TIME){
    throw new TypeError("Invalid read-only grant issuance evidence");
  }
  const claims:Claims={
    audience:AUDIENCE,...identity,issuedAt:nowSeconds,
    expiresAt:nowSeconds+lifetimeSeconds,grantId:randomBytes(16).toString("hex"),
  };
  const encoded=Buffer.from(JSON.stringify(claims)).toString("base64url");
  return VERSION+"."+encoded+"."+sign(encoded,key).toString("base64url");
}

/** Proves signed claims only. Caller must authenticate buyer, check active
 * tenant/revision and consult durable revocation records before any view. */
export function verifyBuyerViewGrant(token:string,expected:BuyerViewIdentity,
  key:Uint8Array,nowSeconds:number,revokedGrantIds:readonly string[]=[]):BuyerViewResult{
  if(!validIdentity(expected)||!keyBytes(key)||!validTime(nowSeconds)
    ||!Array.isArray(revokedGrantIds)
    ||Object.getPrototypeOf(revokedGrantIds)!==Array.prototype
    ||revokedGrantIds.length>500
    ||Reflect.ownKeys(revokedGrantIds).length!==revokedGrantIds.length+1
    ||!Array.from({length:revokedGrantIds.length},(_,index)=>{
      const d=Object.getOwnPropertyDescriptor(revokedGrantIds,String(index));
      return d?.enumerable===true&&Object.hasOwn(d,"value")
        &&typeof d.value==="string"&&GRANT_ID.test(d.value);
    }).every(Boolean)){
    throw new TypeError("Invalid buyer grant verification evidence");
  }
  if(typeof token!=="string"||token.length>800){
    return {state:"blocked",reason:"Invalid grant encoding"};
  }
  const match=/^bmview1\.([A-Za-z0-9_-]{1,700})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if(!match)return {state:"blocked",reason:"Invalid grant encoding"};
  const encoded=match[1],signature=match[2];
  const received=Buffer.from(signature,"base64url");
  if(received.length!==32||received.toString("base64url")!==signature
    ||!timingSafeEqual(received,sign(encoded,key))){
    return {state:"blocked",reason:"Invalid grant signature"};
  }
  try{
    const raw=Buffer.from(encoded,"base64url");
    if(raw.toString("base64url")!==encoded){
      return {state:"blocked",reason:"Noncanonical grant encoding"};
    }
    const claims:unknown=JSON.parse(raw.toString("utf8"));
    if(!validClaims(claims)||JSON.stringify(claims)!==raw.toString("utf8")){
      return {state:"blocked",reason:"Invalid signed claims"};
    }
    if(FIELDS.some(field=>claims[field]!==expected[field])){
      return {state:"blocked",reason:"Grant identity or proposal revision mismatch"};
    }
    if(nowSeconds<claims.issuedAt||nowSeconds>=claims.expiresAt){
      return {state:"blocked",reason:"Grant is not currently valid"};
    }
    if(revokedGrantIds.includes(claims.grantId)){
      return {state:"blocked",reason:"Grant has been revoked"};
    }
    return {state:"signed-claims-only",grantId:claims.grantId,expiresAt:claims.expiresAt};
  }catch{
    return {state:"blocked",reason:"Unreadable grant payload"};
  }
}
