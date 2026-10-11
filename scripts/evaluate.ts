import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { runEvaluation } from "../src/lib/evaluation";

async function main() {
const rows = await runEvaluation();
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const workingTreeDirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
const artifact = {
  evaluationType: "deterministic regression evaluation",
  generatedAt: new Date().toISOString(),
  sourceRevision,
  workingTreeDirty,
  sourceRevisionNote: "sourceRevision is HEAD at generation; workingTreeDirty records whether uncommitted changes were included. Rerun npm run evaluate after changes.",
  summary: { scenarios: rows.length, passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, unsupportedClaimsSafelyWithheld: rows.filter(row => row.unsupported).length },
  scenarios: rows
};
await writeFile("src/lib/evaluation-snapshot.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Evaluation: ${artifact.summary.passed}/${artifact.summary.scenarios} passed; wrote src/lib/evaluation-snapshot.json`);
if (artifact.summary.failed > 0) process.exitCode = 1;
}
void main();
