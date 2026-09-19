// Bundle the Microsoft Visual C++ runtime with the Windows build, two ways.
//
// @libsql/win32-x64-msvc/index.node imports VCRUNTIME140.dll, and Electron does
// not ship it - Chromium links its own runtime statically. Plenty of Windows
// machines have it from some other program, which is why Vifug opens on ours;
// a clean or tightly managed install does not, and there the database module
// fails to load before a window exists. Up to 1.19.2 that was a launch with no
// window and no message at all.
//
// 1. The installer carries Microsoft's vc_redist.x64.exe and offers to run it
//    when the runtime is missing (build/installer.nsh). That is the proper
//    install, but it needs an administrator, which a user can decline.
//
// 2. So the three DLLs are also deployed app-locally, which Microsoft allows.
//    They go next to index.node, not next to Vifug.exe: Node loads a native
//    module with that module's own folder as the first place Windows looks for
//    its dependencies, so a copy beside Vifug.exe is ignored in favour of
//    System32 - or of nothing. Verified by loading the app and reading which
//    VCRUNTIME140.dll the process actually mapped.
//
// The DLLs come from the build machine's System32 (every GitHub Windows runner
// has the current redistributable). On macOS and Linux there is nothing to do.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const OUT = "build/win-runtime";
const DLLS = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];
// Microsoft's permanent link to the latest x64 Visual C++ 2015-2022 redistributable.
const REDIST_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe";
// installer.nsh reads it from ${BUILD_RESOURCES_DIR}, which is build/.
const REDIST = "build/vc_redist.x64.exe";

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

// Downloaded once and kept (it is gitignored); delete it to pick up a newer one.
if (!existsSync(REDIST)) {
  console.log(`Downloading ${REDIST_URL}`);
  const res = await fetch(REDIST_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Could not download the Visual C++ redistributable: HTTP ${res.status}`);
  writeFileSync(REDIST, new Uint8Array(await res.arrayBuffer()));
}

// Everything in this installer runs as administrator on someone else's PC, so
// refuse to ship it unless Windows itself says Microsoft signed it.
//
// Windows PowerShell 5.1 is started with PSModulePath removed and the Security
// module imported by its full path. GitHub's runner launches this build from
// PowerShell 7, whose PSModulePath the child inherits - so 5.1 went looking for
// Get-AuthenticodeSignature among PowerShell 7's modules, could not load it,
// printed nothing, and the check refused a genuine Microsoft file. That failed
// the v1.19.4 Windows build.
const powershell = path.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe");
const securityModule = path.join(
  system32, "WindowsPowerShell", "v1.0", "Modules", "Microsoft.PowerShell.Security", "Microsoft.PowerShell.Security.psd1",
);
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) if (key.toLowerCase() === "psmodulepath") delete childEnv[key];
const signature = execFileSync(
  powershell,
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Import-Module '${securityModule}'; $s = Get-AuthenticodeSignature -LiteralPath '${path.resolve(REDIST)}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`,
  ],
  { encoding: "utf8", env: childEnv },
).trim();
const [status, subject = ""] = signature.split("|");
if (status !== "Valid" || !/O=Microsoft Corporation/.test(subject)) {
  rmSync(REDIST, { force: true });
  throw new Error(`vc_redist.x64.exe is not validly signed by Microsoft (${signature}) - deleted it`);
}
console.log(`Bundling ${REDIST} (${(statSync(REDIST).size / 1048576).toFixed(1)} MB, signed by Microsoft)`);
