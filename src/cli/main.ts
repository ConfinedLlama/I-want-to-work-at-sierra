import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { discover, type DiscoveryEvent } from "../discovery/discover.js";
import { loadIcp } from "../icp/load.js";
import { createRegistry, listSources } from "../sources/registry.js";
import type { SourceContext } from "../sources/types.js";
import { count, formatReport, formatSources } from "./format.js";
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
      const terms =
        profile.company.keywords.length +
        profile.company.hiringSignals.length +
        profile.company.techSignals.length;
      io.stdout(
        `${profile.name}: ok. ${count(profile.personas.length, "persona")}, ` +
          `${count(terms, "search term")}, ${count(profile.seeds.length, "seed")}.\n`,
      );
    });

  program
    .command("sources")
    .description("List the data sources and how each one may be used")
    .action(() => {
      const registry = createRegistry({ env: io.env });
      if (!registry.ok) throw new UsageError(registry.error.message);
      io.stdout(`${formatSources(listSources(registry.value))}\n`);
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

        const registry = createRegistry({ env: io.env, only: options.only });
        if (!registry.ok) throw new UsageError(registry.error.message);

        const context =
          io.runtime ?? createRuntime({ cwd: io.cwd, env: io.env, cache: options.cache });
        const report = await discover(loaded.value, registry.value, context, {
          maxProspects: options.max,
          ...(options.quiet
            ? {}
            : {
                onEvent: (event) => {
                  io.stderr(`${progressLine(event)}\n`);
                },
              }),
        });

        // Printed before the file is written: the run is paid for by then, and
        // a bad --out path should not be the reason its result is never seen.
        io.stdout(`${options.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);

        if (options.out !== undefined) {
          const path = resolve(io.cwd, options.out);
          try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
          } catch (cause) {
            const reason = cause instanceof Error ? cause.message : String(cause);
            throw new UsageError(`Could not write ${path}: ${reason}`);
          }
          if (!options.quiet) io.stderr(`wrote ${path}\n`);
        }
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
      return `  ${event.source}: ${count(event.candidates, "candidate")}`;
    case "source-failed":
      return `  ${event.source}: failed, ${event.message}`;
    case "source-disabled":
      return `  ${event.source}: skipped for the rest of the run after ${event.failures} failures in a row`;
    case "merged":
      return `  merged into ${count(event.prospects, "company", "companies")}, enriching the top ${event.kept}`;
    case "enriched":
      return `  ${event.prospect}: ${count(event.signals, "signal")}`;
  }
}
