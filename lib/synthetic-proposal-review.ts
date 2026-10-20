import {createHash} from "node:crypto";
import type {SyntheticPdfManifest} from "./proposal-revision-qa.ts";

type Line = {serviceCode:string;label:string;unit:string;units:number;unitPriceCents:number;lineTotalCents:number};
type Scope = {area:string;work:string;completion:string};
export type SyntheticReviewSnapshot = {
  kind:"synthetic-branded-proposal-preview";
  brand:{businessName:string;primaryHex:string;accentHex:string};
  proposal:{reference:string;recipient:string;title:string;overview:string;scope:Scope[];
    lines:Line[];subtotalCents:number;taxCents:number;totalCents:number;
    assumptions:string[];exclusions:string[];timeline:string};
};

const escape = (value:string|number):string => String(value).replace(/[&<>"']/g,
  char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]??char));
const sha = (value:Uint8Array|string):string =>
  createHash("sha256").update(value).digest("hex");
const money = (cents:number):string => "$"+(cents/100).toLocaleString("en-US",
  {minimumFractionDigits:2,maximumFractionDigits:2});
const quoted = (value:string):string => JSON.stringify(value).replace(/[\u007f-\uffff]/g,
  char=>"\\u"+char.charCodeAt(0).toString(16).padStart(4,"0"));

/** Python json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=True)
 * for the restricted synthetic snapshot schema (no floats or arbitrary objects). */
export function syntheticSnapshotSha256(value:unknown):string {
  const canonical = (item:unknown):string => {
    if(Array.isArray(item)) return "["+item.map(canonical).join(",")+"]";
    if(item!==null && typeof item==="object"){
      if(Object.getPrototypeOf(item)!==Object.prototype ||
        Reflect.ownKeys(item).some(key=>typeof key!=="string" ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(item,key)??{},"value")))
        throw new TypeError("Unsafe synthetic object");
      const obj=item as Record<string,unknown>;
      return "{"+Object.keys(obj).sort().map(key=>
        quoted(key)+":"+canonical(obj[key])).join(",")+"}";
    }
    if(typeof item==="string") return quoted(item);
    if(typeof item==="number" && Number.isSafeInteger(item)) return JSON.stringify(item);
    if(typeof item==="boolean" || item===null) return JSON.stringify(item);
    throw new TypeError("Unsafe synthetic value");
  };
  return sha(canonical(value));
}
function verified(snapshot:SyntheticReviewSnapshot, manifest:SyntheticPdfManifest,
  pdfBytes:Uint8Array):void {
  if(snapshot?.kind!=="synthetic-branded-proposal-preview"
    || manifest?.format!=="synthetic-proposal-integrity-v1"
    || manifest.disposition!=="INTERNAL ONLY - NOT FOR DELIVERY"
    || !/^SYN-[A-Z0-9-]{3,35}$/.test(snapshot.proposal?.reference??"")
    || snapshot.proposal.reference!==manifest.reference
    || !Number.isSafeInteger(manifest.revision) || manifest.revision<1
    || !Number.isSafeInteger(manifest.pageCount) || manifest.pageCount<1 || manifest.pageCount>8
    || !Number.isSafeInteger(manifest.pdfBytes) || manifest.pdfBytes<2500
    || manifest.pdfBytes>16*1024*1024 || manifest.pdfBytes!==pdfBytes.length
    || !/^[a-f0-9]{64}$/.test(manifest.pdfSha256)
    || !/^[a-f0-9]{64}$/.test(manifest.snapshotSha256)
    || sha(pdfBytes)!==manifest.pdfSha256
    || syntheticSnapshotSha256(snapshot)!==manifest.snapshotSha256)
    throw new TypeError("Synthetic review evidence mismatch");
  const p=snapshot.proposal;
  if(!Array.isArray(p.scope)||p.scope.length>20||!Array.isArray(p.lines)
    ||p.lines.length>30||!Array.isArray(p.assumptions)||p.assumptions.length>12
    ||!Array.isArray(p.exclusions)||p.exclusions.length>12)
    throw new TypeError("Invalid synthetic review data");
}


export type SyntheticReviewArtifact = {
  snapshot:SyntheticReviewSnapshot;
  manifest:SyntheticPdfManifest;
  pdfBytes:Uint8Array;
};

/** A revision is always a new unapproved review, even if content stays unchanged. */
export function compareSyntheticProposalRevisions(
  previous:SyntheticReviewArtifact, current:SyntheticReviewArtifact,
):{from:number;to:number;changes:{field:string;before:string;after:string}[]} {
  verified(previous.snapshot,previous.manifest,previous.pdfBytes);
  verified(current.snapshot,current.manifest,current.pdfBytes);
  if(previous.snapshot.brand.businessName!==current.snapshot.brand.businessName
    ||previous.manifest.reference!==current.manifest.reference
    ||current.manifest.revision!==previous.manifest.revision+1)
    throw new TypeError("Nonconsecutive or unrelated synthetic proposal revisions");

  const old=previous.snapshot.proposal, next=current.snapshot.proposal;
  const changes:{field:string;before:string;after:string}[]=[];
  const change=(field:string,before:string,after:string):void=>{
    if(before!==after) changes.push({field,before,after});
  };
  change("Total",money(old.totalCents),money(next.totalCents));
  change("Subtotal",money(old.subtotalCents),money(next.subtotalCents));
  change("Tax",money(old.taxCents),money(next.taxCents));
  for(const field of ["recipient","title","overview","timeline"] as const)
    change(field,old[field],next[field]);
  for(const field of ["assumptions","exclusions"] as const)
    change(field,old[field].join(" | "),next[field].join(" | "));
  for(let i=0;i<Math.max(old.scope.length,next.scope.length);i++){
    const describe=(item:Scope|undefined):string=>
      item?item.area+": "+item.work+" / "+item.completion:"(not included)";
    change("Scope "+(i+1),describe(old.scope[i]),describe(next.scope[i]));
  }
  const oldLines=new Map(old.lines.map(x=>[x.serviceCode,x]));
  const nextLines=new Map(next.lines.map(x=>[x.serviceCode,x]));
  if(oldLines.size!==old.lines.length||nextLines.size!==next.lines.length)
    throw new TypeError("Duplicate synthetic service code");
  for(const code of new Set([...oldLines.keys(),...nextLines.keys()])){
    const describe=(item:Line|undefined):string=>
      item?item.label+": "+item.units+" "+item.unit+" x "+money(item.unitPriceCents)
        +" = "+money(item.lineTotalCents):"(not included)";
    change("Service "+code,describe(oldLines.get(code)),describe(nextLines.get(code)));
  }
  change("Brand palette",previous.snapshot.brand.primaryHex+"/"+previous.snapshot.brand.accentHex,
    current.snapshot.brand.primaryHex+"/"+current.snapshot.brand.accentHex);
  return {from:previous.manifest.revision,to:current.manifest.revision,changes};
}

const css=[
  ":root{font-family:system-ui,Arial,sans-serif;color:#1b3045}",
  "*{box-sizing:border-box}body{margin:0;background:#f1f4f6}",
  "main{max-width:1060px;margin:auto;padding:24px}",
  "header{background:#142a3c;color:white;padding:28px}",
  "h1{font-size:clamp(1.6rem,4vw,2.4rem)}h2{font-size:1.2rem}",
  "article{background:white;border:1px solid #dce3e8;border-radius:8px;padding:20px;margin:18px 0;overflow-wrap:anywhere}",
  ".blocked{background:#fff0e9;border:2px solid #a63d25;color:#792d1c;padding:16px;font-weight:800}",
  "table{width:100%;border-collapse:collapse;table-layout:fixed}",
  "th,td{border-bottom:1px solid #dce3e8;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}",
  "th{background:#e9eff3}p,li{line-height:1.5}",
  "@media(max-width:600px){main{padding:12px}article{padding:14px}td,th{font-size:.8rem;padding:7px}}",
  "@media print{body{background:white}main{padding:0}article{break-inside:avoid}header{background:white;color:#142a3c;border-bottom:2px solid}}",
].join("");
const table=(headings:string[],items:(string|number)[][]):string =>
  "<table><thead><tr>"+headings.map(x=>"<th scope=\"col\">"+escape(x)+"</th>").join("")+
  "</tr></thead><tbody>"+items.map(row=>"<tr>"+row.map(x=>
    "<td>"+escape(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
const list=(items:string[]):string =>
  "<ul>"+items.map(x=>"<li>"+escape(x)+"</li>").join("")+"</ul>";

/** Offline synthetic report. The only "passed" observation is PDF fingerprint
 * consistency; commercial approval and delivery remain blocked unconditionally. */
export function renderSyntheticProposalReview(snapshot:SyntheticReviewSnapshot,
  manifest:SyntheticPdfManifest,pdfBytes:Uint8Array,
  previous?:SyntheticReviewArtifact):string {
  verified(snapshot,manifest,pdfBytes);
  const revision=previous?compareSyntheticProposalRevisions(previous,
    {snapshot,manifest,pdfBytes}):null;
  const changeSection=revision?
    "<article><h2>Changes since revision "+escape(revision.from)+"</h2>"+
    "<p>Prior revision receipts and QA evidence are stale. Independent reviews must be repeated.</p>"+
    (revision.changes.length
      ? table(["Field","Previous","Current"],revision.changes.map(x=>[x.field,x.before,x.after]))
      : "<p>No content differences. The new revision still invalidates prior signoff.</p>")+
    "</article>":"";

  const p=snapshot.proposal;
  const checks=[
    ["Pricing policy","NOT RUN","No authorized company ratecard or tax decision"],
    ["Source and scope","NOT RUN","Original evidence and contractor review not connected"],
    ["Claims","NOT RUN","Credentials, brand rights and wording need evidence"],
    ["Recipient","NOT RUN","Recipient identity and contact authorization unverified"],
    ["PDF integrity","PASSED","Actual PDF bytes match a separately Python-verified synthetic manifest"],
  ];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="robots" content="noindex,nofollow,noarchive">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">'+
    "<title>Internal QA - "+escape(p.reference)+"</title><style>"+css+"</style></head><body>"+
    "<header><div>BidMason / Offline QA</div><h1>"+escape(snapshot.brand.businessName)+
    "</h1><p>Synthetic revision "+escape(manifest.revision)+" / "+escape(p.reference)+"</p></header>"+
    '<main><div role="status" class="blocked">BLOCKED - SYNTHETIC INTERNAL DRAFT - NOT FOR DELIVERY</div>'+
    "<article><h2>Proposal</h2><p><strong>"+escape(p.title)+"</strong></p><p>Recipient: "+
    escape(p.recipient)+"</p><p>"+escape(p.overview)+"</p><p>Timeline: "+
    escape(p.timeline)+"</p></article>"+
    changeSection+"<article><h2>Required QA</h2>"+table(["Check","State","Explanation"],checks)+
    "<p>No authenticated operator or contractor approval exists. This report has no signing, publishing or sending controls.</p></article>"+
    "<article><h2>Scope</h2>"+table(["Area","Work","Completion"],p.scope.map(x=>
      [x.area,x.work,x.completion]))+"</article>"+
    "<article><h2>Fictional price lines</h2>"+
    table(["Service","Units","Unit","Rate","Amount"],p.lines.map(x=>
      [x.label,x.units,x.unit,money(x.unitPriceCents),money(x.lineTotalCents)]))+
    "<p>Subtotal: "+escape(money(p.subtotalCents))+" / Tax: "+escape(money(p.taxCents))+
    " / <strong>Total: "+escape(money(p.totalCents))+"</strong></p></article>"+
    "<article><h2>Assumptions</h2>"+list(p.assumptions)+"<h2>Exclusions</h2>"+
    list(p.exclusions)+"</article>"+
    "<article><h2>Evidence fingerprints</h2><p>Revision "+escape(manifest.revision)+
    " / Pages "+escape(manifest.pageCount)+" / Bytes "+escape(manifest.pdfBytes)+
    "</p><p>PDF SHA-256: <code>"+escape(manifest.pdfSha256)+
    "</code></p><p>Snapshot SHA-256: <code>"+escape(manifest.snapshotSha256)+
    "</code></p><p>Awaiting real tenant authorization and human acceptance.</p></article></main></body></html>";
}
