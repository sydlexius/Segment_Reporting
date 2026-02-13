// Fix backslash paths in lefthook's generated hook scripts.
// On Windows/MSYS, lefthook writes absolute paths with backslashes
// (e.g., D:\path\to\lefthook.exe) which Git bash interprets as
// escape sequences. This script converts them to forward slashes.

import { readFileSync, writeFileSync, existsSync } from "fs";

const hookPath = ".git/hooks/pre-commit";
if (existsSync(hookPath)) {
    const content = readFileSync(hookPath, "utf8");
    const fixed = content.replace(/\\/g, "/");
    if (fixed !== content) {
        writeFileSync(hookPath, fixed);
    }
}
