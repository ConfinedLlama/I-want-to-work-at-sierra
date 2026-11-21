#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { discover, type DiscoveryEvent } from "../discovery/discover.js";
import { loadIcp } from "../icp/load.js";
import { createRegistry, listSources, UnknownSourceError } from "../sources/registry.js";
import type { SourceContext } from "../sources/types.js";
import { formatReport, formatSources } from "./format.js";
import { createRuntime } from "./runtime.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** Replaces the live network runtime. Tests pass a stubbed one. */
  readonly runtime?: SourceContext;
}

/** Raised for anything the user can fix. Printed without a stack trace. */
class UsageError extends Error {}

/** Runs the CLI and returns the process exit code. Never calls process.exit itself. */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const program = new Command("outbound")
    .description("ICP in, researched prospects out.")
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  const icp = program.command("icp").description("Work with ideal customer profiles");
  icp
    .command("validate <file>")
    .description("Check that an ICP file is well formed")
    .action(async (file: string) => {
      const loaded = await loadIcp(resolve(io.cwd, file));
      if (!loaded.ok) throw new UsageError(loaded.error.message);
      const profile = loaded.value;
      io.stdout(
        `${profile.name}: ok. ${profile.personas.length} personas, ` +
          `${profile.company.keywords.length + profile.company.hiringSignals.length + profile.company.techSignals.length} search terms, ` +
          `${profile.seeds.length} seeds.\n`,
      );
    });

  program
    .command("sources")
    .description("List the data sources and how each one may be used")
    .action(() => {
      io.stdout(`${formatSources(listSources(createRegistry({ env: io.env })))}\n`);
    });

  program
    .command("discover <icp-file>")
    .description("Find companies that fit an ICP and collect signals about them")
    .option("--max <n>", "keep at most this many prospects", positiveInt, 25)
    .option("--only <ids>", "comma-separated source ids to use", (value: string) =>
      value.split(","),
    )
    .option("--out <file>", "also write the full report as JSON")
    .option("--json", "print the report as JSON instead of text", false)
    .option("--no-cache", "do not read or write the response cache")
    .option("--quiet", "do not print progress", false)
    .action(
      async (
        file: string,
        options: {
          max: number;
          only?: string[];
          out?: string;
          json: boolean;
          cache: boolean;
          quiet: boolean;
        },
      ) => {
        const loaded = await loadIcp(resolve(io.cwd, file));
        if (!loaded.ok) throw new UsageError(loaded.error.message);

        let registry;
        try {
          registry = createRegistry({ env: io.env, only: options.only });
        } catch (cause) {
          if (cause instanceof UnknownSourceError) throw new UsageError(cause.message);
          throw cause;
        }

        const context =
          io.runtime ?? createRuntime({ cwd: io.cwd, env: io.env, cache: options.cache });
        const report = await discover(loaded.value, registry, context, {
          maxProspects: options.max,
          ...(options.quiet
            ? {}
            : {
                onEvent: (event) => {
                  io.stderr(`${progressLine(event)}\n`);
                },
              }),
        });

        if (options.out !== undefined) {
          const path = resolve(io.cwd, options.out);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
          if (!options.quiet) io.stderr(`wrote ${path}\n`);
        }
        io.stdout(`${options.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
      },
    );

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (cause) {
    if (cause instanceof CommanderError) {
      // Commander has already printed help or its own message.
      return cause.exitCode;
    }
    if (cause instanceof UsageError) {
      io.stderr(`${cause.message}\n`);
      return 1;
    }
    throw cause;
  }
}

function positiveInt(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidArgumentError("must be a positive whole number");
  }
  return Number(value);
}

function progressLine(event: DiscoveryEvent): string {
  switch (event.type) {
    case "source-finished":
      return `  ${event.source}: ${event.candidates} candidates`;
    case "source-failed":
      return `  ${event.source}: failed, ${event.message}`;
    case "source-disabled":
      return `  ${event.source}: skipped for the rest of the run after ${event.failures} failures in a row`;
    case "merged":
      return `  merged into ${event.prospects} companies, enriching the top ${event.kept}`;
    case "enriched":
      return `  ${event.prospect}: ${event.signals} signals`;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
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
}
