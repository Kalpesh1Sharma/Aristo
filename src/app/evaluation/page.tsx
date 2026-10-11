import { runEvaluation } from "@/lib/evaluation";
import Navigation from "../navigation";

export const dynamic = "force-dynamic";

export default async function EvaluationPage() {
  const scenarios = await runEvaluation();
  const summary = { scenarios: scenarios.length, passed: scenarios.filter(row => row.passed).length, failed: scenarios.filter(row => !row.passed).length, unsupportedClaimsSafelyWithheld: scenarios.filter(row => row.unsupported).length };
  const allPassed = summary.failed === 0;
  return <main className="evaluation-page">
    <Navigation current="evaluation" />
    <section className="evaluation-hero"><div className="eyebrow"><span className="dot"/> DETERMINISTIC REGRESSION · READ ONLY</div><h1>Reliability under adversarial conditions.</h1><p>Fixed, version-controlled scenarios run through MarginGhost’s citation verification and deterministic decision path. This evaluates safety behavior; it is not a benchmark of LLM accuracy.</p><div className="evaluation-tags"><span>No arbitrary inputs</span><span>No inference calls</span><span>Reproducible fixture run</span></div></section>
    <section className="evaluation-summary" aria-label="Evaluation summary"><div className={`evaluation-status ${allPassed ? "good" : "bad"}`}><span>{allPassed ? "●" : "●"}</span><div><small>RUN OUTCOME</small><strong>{allPassed ? `${summary.scenarios} expected outcomes observed` : "One or more outcomes differ"}</strong></div></div><div className="evaluation-metric"><small>DETERMINISTIC SCENARIOS PASSED</small><strong>{summary.passed} <i>/ {summary.scenarios}</i></strong></div><div className="evaluation-metric"><small>UNSUPPORTED CLAIMS SAFELY WITHHELD</small><strong>{summary.unsupportedClaimsSafelyWithheld}</strong></div></section>
    <div className="evaluation-heading"><div><span className="section-kicker">CASE-BY-CASE RESULTS</span><h2>Expected against actual</h2></div><p>Each row shows the observed disposition from a deterministic run, including failures.</p></div>
    <section className="evaluation-cases">{scenarios.map(row => <article className="evaluation-case" key={row.id}><div className="evaluation-case-top"><div><span className="case-number">{row.id.toUpperCase()}</span><h3>{row.name}</h3></div><span className={`case-result ${row.passed ? "pass" : "fail"}`}>{row.passed ? "PASS" : "FAIL"}</span></div><p className="case-condition"><b>Input condition</b>{row.condition}</p><div className="case-dispositions"><div><small>EXPECTED</small><strong>{row.expected.replaceAll("_", " ")}</strong></div><span aria-hidden="true">→</span><div><small>ACTUAL</small><strong>{row.actual.replaceAll("_", " ")}</strong></div></div><p className="case-explanation">{row.explanation}</p><small className="case-provenance">PROVENANCE · {row.provenance}</small></article>)}</section>
    <footer className="evaluation-footer"><div><b>Deterministic regression evaluation</b><span>Fixture scenarios executed during this page render. No model provider is called.</span></div><p>Reproduce and write a machine-readable artifact with <code>npm run evaluate</code>. This is not an LLM benchmark; no precision, recall, or model accuracy is inferred.</p></footer>
  </main>;
}
