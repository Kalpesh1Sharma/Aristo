import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../src/app/page";
import InvestigatePage from "../src/app/investigate/page";
import DemoPage from "../src/app/demo/page";

test("homepage presents product value and links to both workflows", () => {
  const html = renderToStaticMarkup(createElement(Home));
  assert.match(html, /Find invoice discrepancies/);
  assert.match(html, /href="\/investigate"/);
  assert.match(html, /href="\/demo"/);
});

test("investigation route retains the PDF workspace and shared route navigation", () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";
  let html: string;
  try { html = renderToStaticMarkup(createElement(InvestigatePage)); }
  finally { if (previousNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previousNodeEnv; }
  assert.match(html, /Build an investigation/);
  assert.match(html, /printed ID inside each document/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /Live AI investigation requires authorized access/);
  assert.match(html, /disabled/);
});

test("demo route presents the synthetic scenarios and evidence notice", () => {
  const html = renderToStaticMarkup(createElement(DemoPage));
  assert.match(html, /Three ways to examine a case/);
  assert.match(html, /Potential overcharge/);
  assert.match(html, /Two prices disagree/);
  assert.match(html, /Demonstration data only/);
  assert.match(html, /href="\/investigate"/);
});
