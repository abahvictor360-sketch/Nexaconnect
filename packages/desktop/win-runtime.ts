// Bundle the Microsoft Visual C++ runtime beside libsql's native module.
//
// @libsql/win32-x64-msvc/index.node imports VCRUNTIME140.dll, and Electron does
// not ship it - Chromium links its own runtime statically. Plenty of Windows
// machines have it from some other program, which is why Vifug opens on ours;
// a clean or tightly managed install does not, and there the database module
// fails to load before a window exists. Up to 1.19.2 that was a launch with no
// window and no message at all.
//
// Microsoft allows these three DLLs to be deployed app-locally. They go next to
// index.node, not next to Vifug.exe: Node loads a native module with that
// module's own folder as the first place Windows looks for its dependencies,
// so a copy beside Vifug.exe is ignored in favour of System32 - or of nothing.
// Verified by loading the app and reading which VCRUNTIME140.dll the process
// actually mapped.
//
// Copied from the build machine's System32 (every GitHub Windows runner has
// the current redistributable). On macOS and Linux there is nothing to do.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const OUT = "build/win-runtime";
const DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];

if (process.platform !== "win32") {
  console.log("Not Windows - no Visual C++ runtime to bundle");
  process.exit(0);
}

const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const dll of DLLS) {
  const from = path.join(system32, dll);
  // Fail the build rather than ship an installer that opens on some PCs only.
  if (!existsSync(from)) {
    throw new Error(`${from} not found - install the Visual C++ 2015-2022 x64 redistributable on the build machine`);
  }
  copyFileSync(from, path.join(OUT, dll));
}
console.log(`Copied ${DLLS.join(", ")} -> ${OUT}`);
