import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiscoveryReport } from "../discovery/discover.js";
import { minimalIcp } from "../icp/testing.js";
import { testContext } from "../sources/testing.js";
import { run, type CliIo } from "./main.js";

const YC = "https://yc-oss.github.io/api/companies/all.json";

describe("cli", () => {
  let dir: string;
  let out: string;
  let errOut: string;
  let stub: ReturnType<typeof testContext>["stub"];
  let io: CliIo;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "outbound-cli-"));
    out = "";
    errOut = "";
    const test = testContext();
    stub = test.stub;
    io = {
      stdout: (text) => (out += text),
      stderr: (text) => (errOut += text),
      env: {},
      cwd: dir,
      runtime: test.context,
    };
    await writeFile(
      join(dir, "icp.json"),
      JSON.stringify(minimalIcp({ company: { keywords: ["support"] } })),
    );
    stub.on(YC, {
      body: [
        {
          name: "Helpline",
          status: "Active",
          website: "https://helpline.example",
          one_liner: "Support for stores",
          url: "https://www.ycombinator.com/companies/helpline",
        },
      ],
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("validates a good profile", async () => {
    expect(await run(["icp", "validate", "icp.json"], io)).toBe(0);
    expect(out).toBe("Test ICP: ok. 1 persona, 1 search term, 0 seeds.\n");
  });

  it("explains a bad profile and exits non-zero", async () => {
    await writeFile(join(dir, "bad.json"), JSON.stringify({ name: "x" }));
    expect(await run(["icp", "validate", "bad.json"], io)).toBe(1);
    expect(errOut).toContain("ICP is not valid:");
    expect(errOut).toContain("personas:");
    expect(out).toBe("");
  });

  it("lists sources", async () => {
    expect(await run(["sources"], io)).toBe(0);
    expect(out).toContain("yc  (discovery)");
    expect(out).toContain("github  (enrichment)");
    expect(out).toContain("optional: GITHUB_TOKEN");
  });

  it("discovers and prints a readable report, progress on stderr", async () => {
    expect(await run(["discover", "icp.json", "--only", "yc"], io)).toBe(0);
    expect(out).toContain("1. Helpline (helpline.example)  [yc]");
    expect(out).toContain("https://www.ycombinator.com/companies/helpline");
    expect(out).toContain("1 candidate, 1 company after merging, 0 excluded, 1 kept.");
    expect(errOut).toContain("yc: 1 candidate\n");
  });

  it("prints only json on stdout with --json", async () => {
    expect(await run(["discover", "icp.json", "--only", "yc", "--json", "--quiet"], io)).toBe(0);
    const report = JSON.parse(out) as DiscoveryReport;
    expect(report.prospects[0]?.id).toBe("helpline.example");
    expect(errOut).toBe("");
  });

  it("writes the report to a file, creating directories", async () => {
    const code = await run(
      ["discover", "icp.json", "--only", "yc", "--out", "runs/today/report.json", "--quiet"],
      io,
    );
    expect(code).toBe(0);
    const report = JSON.parse(
      await readFile(join(dir, "runs/today/report.json"), "utf8"),
    ) as DiscoveryReport;
    expect(report.stats.kept).toBe(1);
  });

  it("prints the report and then explains an --out path it cannot write", async () => {
    await writeFile(join(dir, "taken"), "a file where the directory should go");
    const code = await run(
      ["discover", "icp.json", "--only", "yc", "--out", "taken/report.json", "--quiet"],
      io,
    );
    expect(code).toBe(1);
    expect(out).toContain("1. Helpline (helpline.example)  [yc]");
    expect(errOut).toContain(`Could not write ${join(dir, "taken", "report.json")}`);
  });

  it("lists a seeded prospect with the seed marked once", async () => {
    await writeFile(
      join(dir, "seeded.json"),
      JSON.stringify(minimalIcp({ seeds: [{ name: "Named", domain: "named.com" }] })),
    );
    expect(await run(["discover", "seeded.json", "--only", "yc", "--quiet"], io)).toBe(0);
    expect(out).toContain("1. Named (named.com)  [seed]\n");
  });

  it("reports source failures without failing the command", async () => {
    // The default route answers 200, so this needs a context of its own.
    const failing = testContext();
    failing.stub.on(YC, { status: 500 });
    const code = await run(["discover", "icp.json", "--only", "yc"], {
      ...io,
      runtime: failing.context,
    });
    expect(code).toBe(0);
    expect(out).toContain("No prospects found.");
    expect(out).toContain("1 source failure:");
  });

  it("rejects an unknown source by name", async () => {
    expect(await run(["discover", "icp.json", "--only", "yc,linkedin"], io)).toBe(1);
    expect(errOut).toContain('Unknown source "linkedin"');
  });

  it.each(["", ",", " , "])("rejects --only %j, which selects nothing", async (only) => {
    expect(await run(["discover", "icp.json", "--only", only], io)).toBe(1);
    expect(errOut).toContain("No source selected. Known: yc, hackernews");
    expect(out).toBe("");
    expect(stub.calls).toEqual([]);
  });

  it("rejects a nonsensical --max", async () => {
    expect(await run(["discover", "icp.json", "--max", "0"], io)).toBe(1);
    expect(errOut).toContain("must be a positive whole number");
  });

  it("fails on an unknown command", async () => {
    expect(await run(["frobnicate"], io)).toBe(1);
    expect(errOut).toContain("unknown command");
  });

  it("prints help and exits zero", async () => {
    expect(await run(["--help"], io)).toBe(0);
    expect(out).toContain("discover");
  });
});
