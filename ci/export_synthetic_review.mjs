/** Private offline inspection report generation from Python-verified fictional PDFs. */
import {readFile, writeFile, stat} from "node:fs/promises";
import {join} from "node:path";
import {renderSyntheticProposalReview} from "../lib/synthetic-proposal-review.ts";

const [inputDir,outputDir]=process.argv.slice(2);
if(!inputDir || !outputDir || !(await stat(inputDir)).isDirectory()
   || !(await stat(outputDir)).isDirectory()) throw new Error("Existing private input and output directories required");

for(const name of ["painting","cleaning","painting-unicode"]){
  const {snapshot,manifest}=JSON.parse(await readFile(join(inputDir,name+".json"),"utf8"));
  const pdf=await readFile(join(inputDir,name+".pdf"));
  const html=renderSyntheticProposalReview(snapshot,manifest,pdf);
  const target=join(outputDir,name+".review.html");
  await writeFile(target,html,{flag:"wx",mode:0o600});
  console.log("PASS: offline synthetic blocked QA report:",name);
}
