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

    // Create a temporary workspace folder for tests
    const testWorkspace = path.join(os.tmpdir(), "dprint-vscode-test-workspace");
    fs.rmSync(testWorkspace, { recursive: true, force: true });
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
