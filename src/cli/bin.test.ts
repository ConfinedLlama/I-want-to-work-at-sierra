import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../../", import.meta.url));
const bin = fileURLToPath(new URL("./bin.ts", import.meta.url));

describe("bin", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "outbound-bin-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // This is how an installed bin is reached: package managers link it into
  // node_modules/.bin rather than copying it.
  it("runs the cli when it is started through a symlink", async () => {
    const link = join(dir, "outbound");
    await symlink(bin, link);
    const { stdout } = await exec(process.execPath, ["--import", "tsx", link, "sources"], {
      cwd: repo,
    });
    expect(stdout).toContain("yc  (discovery)");
    expect(stdout).toContain("github  (enrichment)");
  }, 30_000);
});
