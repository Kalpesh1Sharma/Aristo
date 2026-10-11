import Link from "next/link";
import ThemeSwitch from "./theme-switch";
import JudgeLogoutButton from "./judge-preview/logout-button";

export default function Navigation({ current, result = false, signedIn = false }: { current?: string; result?: boolean; signedIn?: boolean }) {
  return <header className="topbar"><Link className="brand" href="/" aria-label="MarginGhost home"><span className="brand-icon">M</span><span>MarginGhost <small>FINANCIAL INTELLIGENCE</small></span></Link><nav className="main-nav" aria-label="Main navigation"><Link href="/" aria-current={current === "home" ? "page" : undefined}>Overview</Link><Link href="/investigate" aria-current={current === "investigate" ? "page" : undefined}>Investigate</Link><Link href="/demo" aria-current={current === "demo" ? "page" : undefined}>Synthetic demo</Link><Link href="/evaluation" aria-current={current === "evaluation" ? "page" : undefined}>Evaluation</Link>{result && <a href="#results">Results</a>}</nav>{signedIn && <JudgeLogoutButton />}<ThemeSwitch /><Link className="nav-cta" href="/judge-preview">Judge Preview <span aria-hidden="true">↗</span></Link></header>;
}
