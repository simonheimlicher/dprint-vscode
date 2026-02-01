import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";

import { runTests } from "@vscode/test-electron";

async function main() {
  // Clear environment variables that interfere with spawning a new VSCode instance.
  // ELECTRON_RUN_AS_NODE makes Electron treat the first argument as a script to execute
  // instead of a workspace folder to open. This happens when tests are run from within
  // a VSCode extension host (e.g., Claude Code).
  delete process.env.ELECTRON_RUN_AS_NODE;
  delete process.env.ELECTRON_NO_ATTACH_CONSOLE;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("VSCODE_")) {
      delete process.env[key];
    }
  }

  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // Create a unique wrapper directory that contains:
    // 1. A "stopper" dprint.json with empty includes (prevents dprint from finding user configs)
    // 2. The actual test workspace as a subdirectory
    const testWrapper = fs.mkdtempSync(path.join(os.tmpdir(), "dprint-vscode-test-"));

    // Create stopper config - dprint finds this and stops searching
    // Empty includes means it won't format anything (files don't match)
    // But we need a plugin so dprint can initialize without hanging
    fs.writeFileSync(
      path.join(testWrapper, "dprint.json"),
      JSON.stringify({
        includes: [],
        plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
      }),
    );

    const testWorkspace = path.join(testWrapper, "workspace");
    fs.mkdirSync(testWorkspace, { recursive: true });

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testWorkspace, "--disable-extensions"],
    });
  } catch (err) {
    console.error("Failed to run tests");
    console.error(err);
    process.exit(1);
  }
}

main();
