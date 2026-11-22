#!/usr/bin/env node
import { run } from "./main.js";

// The executable. It is kept apart from main.ts so that importing the CLI, as
// the tests do, never starts it.
run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.cwd(),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (cause: unknown) => {
    console.error(cause);
    process.exitCode = 70;
  },
);
