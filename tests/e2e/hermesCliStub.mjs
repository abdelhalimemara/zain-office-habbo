#!/usr/bin/env node
// Stands in for the real `hermes` CLI during e2e runs (the server's HERMES_BIN). The real CLI writes
// straight to ~/.hermes, bypassing HERMES_URL, so it must never run here. Each call appends its argv
// as one JSON line to $E2E_HERMES_CALLS for the test to read, then exits 0.
import { appendFileSync } from "node:fs";

const log = process.env.E2E_HERMES_CALLS;
if (!log) {
  console.error("hermesCliStub: E2E_HERMES_CALLS is not set");
  process.exit(2);
}
appendFileSync(log, `${JSON.stringify(process.argv.slice(2))}\n`);
process.exit(0);
