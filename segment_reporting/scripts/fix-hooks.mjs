// Fix backslash paths in lefthook's generated hook scripts.
// On Windows/MSYS, lefthook writes absolute paths with backslashes
// (e.g., D:\path\to\lefthook.exe) which Git bash interprets as
// escape sequences. This script converts them to forward slashes.
//
// Run from the repo root (the `prepare` script cd's there first). Every hook
// lefthook installs needs the same fix, so process each stage we configure.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

// Resolve the real hooks directory from git rather than hardcoding .git/hooks.
// In linked worktrees `.git` is a file and hooks live elsewhere, and a custom
// core.hooksPath redirects them entirely; git rev-parse reports the truth.
const hooksDir = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
    encoding: "utf8",
}).trim();
const hookPaths = ["pre-commit", "pre-push"].map((h) => join(hooksDir, h));

for (const hookPath of hookPaths) {
    if (!existsSync(hookPath)) {
        continue;
    }
    const content = readFileSync(hookPath, "utf8");
    const fixed = content.replace(/\\/g, "/");
    if (fixed !== content) {
        writeFileSync(hookPath, fixed);
    }
}
