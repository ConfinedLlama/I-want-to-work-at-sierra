import type { DiscoveryReport } from "../discovery/discover.js";
import type { Prospect } from "../discovery/prospect.js";
import type { SourceInfo } from "../sources/types.js";

export function formatSources(sources: readonly (SourceInfo & { role: string })[]): string {
  return sources
    .map((source) =>
      [
        `${source.id}  (${source.role})`,
        `  ${source.name}`,
        `  gives: ${source.gives.join(", ")}`,
        `  limits: ${source.rateLimit}`,
        ...(source.optionalEnv === undefined ? [] : [`  optional: ${source.optionalEnv}`]),
        `  docs: ${source.homepage}`,
      ].join("\n"),
    )
    .join("\n\n");
}

export function formatReport(report: DiscoveryReport): string {
  const { stats } = report;
  const lines: string[] = [];

  if (report.prospects.length === 0) {
    lines.push("No prospects found.");
  }
  report.prospects.forEach((prospect, index) => {
    lines.push(...formatProspect(prospect, index + 1), "");
  });

  lines.push(
    `${stats.candidates} candidates, ${stats.merged} companies after merging, ` +
      `${stats.excluded} excluded, ${stats.kept} kept.`,
  );

  if (report.failures.length > 0) {
    lines.push(
      "",
      `${report.failures.length} source ${report.failures.length === 1 ? "failure" : "failures"}:`,
    );
    for (const failure of report.failures) {
      const about = failure.prospect === undefined ? "" : ` for ${failure.prospect}`;
      lines.push(`  - ${failure.message}${about}`);
    }
  }
  return lines.join("\n");
}

function formatProspect(prospect: Prospect, rank: number): string[] {
  const where = prospect.domain === undefined ? "" : ` (${prospect.domain})`;
  const size = prospect.employees === undefined ? "" : `, ~${prospect.employees} people`;
  const seeded = prospect.seeded ? ", seed" : "";
  const lines = [
    `${rank}. ${prospect.name}${where}  [${prospect.sources.join(", ")}${size}${seeded}]`,
  ];
  for (const signal of prospect.signals) {
    const matched =
      signal.matched === undefined || signal.matched.length === 0
        ? ""
        : `  {${signal.matched.join(", ")}}`;
    lines.push(
      `   ${signal.kind.padEnd(11)} ${signal.summary}${matched}`,
      `               ${signal.url}`,
    );
  }
  return lines;
}
