import * as assert from "node:assert";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");
  // create a temp folder
  let tempNumber = 0;
  let tempFolder = path.join(os.tmpdir(), "dprint-vscode-test", "temp");

  const context = {
    get tempFolderUri() {
      return vscode.Uri.file(tempFolder);
    },
    createFile(name: string, text: string) {
      fs.writeFileSync(path.join(tempFolder, name), text, "utf8");
    },
    reset() {
      fs.rmSync(tempFolder, { recursive: true, force: true });
      fs.mkdirSync(tempFolder, { recursive: true });
    },
    async withTempFolder(action: () => Promise<void>) {
      tempFolder = path.join(
        os.tmpdir(),
        "dprint-vscode-test",
        `temp${++tempNumber}`
      );
      fs.rmSync(tempFolder, { recursive: true, force: true });
      fs.mkdirSync(tempFolder, { recursive: true });
      await action();
    },
    createDprintJson() {
      this.createFile(
        "dprint.json",
        `{
        "includes": [
          "**/*.json"
        ],
        "plugins": [
          "https://plugins.dprint.dev/json-0.15.3.wasm"
        ]
      }`
      );
    },
    async openWorkspace() {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        this.tempFolderUri
      );
      await vscode.workspace.getConfiguration("files").update("eol", "\n");
      await vscode.workspace
        .getConfiguration("editor")
        .update("defaultFormatter", "dprint.dprint");
    },
    async configureFormatOnSave() {
      await vscode.workspace
        .getConfiguration("editor")
        .update("formatOnSave", true);
    },
    getUri(name: string) {
      return vscode.Uri.joinPath(this.tempFolderUri, name);
    },
    waitInitialize() {
      // would be nice to do something better
      return this.sleep(250);
    },
    async sleep(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    async openAndShowDocument(name: string) {
      const doc = await vscode.workspace.openTextDocument(this.getUri(name));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
      return doc;
    },
    async formatCommand(name: string | vscode.Uri) {
      await vscode.commands.executeCommand(
        "editor.action.formatDocument",
        name instanceof vscode.Uri ? name : this.getUri(name)
      );
    },
    killAllDprintProcesses() {
      return new Promise<void>((resolve, reject) => {
        const command =
          os.platform() === "win32"
            ? "taskkill /im dprint.exe /f"
            : "pkill dprint";
        cp.exec(command, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };

  test("format on save", async () => {
    context.reset();
    context.createDprintJson();
    context.createFile("test.json", "");
    await context.openWorkspace();
    await context.configureFormatOnSave();
    await context.waitInitialize();

    // create a json file and open it
    const doc = await context.openAndShowDocument("test.json");
    await applyTextChanges(doc, [
      {
        newText: `{
             "test":     5
      }`,
        range: getRange([0, 0], [0, 0]),
      },
    ]);
    await doc.save();

    // should be formatted
    assert.equal(doc.getText(), `{\n  "test": 5\n}\n`);
  }).timeout(15_000);

  test("format command", async () => {
    context.reset();
    context.createDprintJson();
    context.createFile(
      "test.json",
      `{
          "test":               5
    }`
    );
    await context.openWorkspace();
    await context.waitInitialize();

    // open the test.json and format it with the format command
    const doc = await context.openAndShowDocument("test.json");
    await context.formatCommand(doc.uri);

    // should be formatted
    assert.equal(doc.getText(), `{\n  "test": 5\n}\n`);
  }).timeout(15_000);

  test("format after dprint process kill", async () => {
    context.reset();
    context.createDprintJson();
    context.createFile("test.json", "");
    await context.openWorkspace();
    await context.waitInitialize();

    // create a json file and open it
    const doc = await context.openAndShowDocument("test.json");
    await applyTextChanges(doc, [
      {
        range: getRange([0, 0], [0, 0]),
        newText: `{
              "   test":     5
        }`,
      },
    ]);
    await context.formatCommand(doc.uri);

    await context.killAllDprintProcesses();

    // now try editing and saving again
    await applyTextChanges(doc, [
      vscode.TextEdit.delete(getRange([0, 0], [5, 0])),
      {
        range: getRange([0, 0], [0, 0]),
        newText: `{
              "test":     5
        }`,
      },
    ]);
    await context.formatCommand(doc.uri);

    // should be formatted
    assert.equal(doc.getText(), `{\n  "test": 5\n}\n`);
  }).timeout(4_000);

  async function applyTextChanges(
    doc: vscode.TextDocument,
    edits: vscode.TextEdit[]
  ) {
    const edit = new vscode.WorkspaceEdit();
    edit.set(doc.uri, edits);
    await vscode.workspace.applyEdit(edit);
  }

  function getRange(from: [number, number], to: [number, number]) {
    return new vscode.Range(
      new vscode.Position(from[0], from[1]),
      new vscode.Position(to[0], to[1])
    );
  }

  // User-Level Config Tests
  suite("User-Level Config", () => {
    test("user-level config discovered when no workspace config", async () => {
      await context.withTempFolder(async () => {
        // Create temporary "home" directory structure
        const tempHome = path.join(
          os.tmpdir(),
          "dprint-test-home-" + Date.now()
        );
        const configDir = path.join(tempHome, ".config", "dprint");
        fs.mkdirSync(configDir, { recursive: true });

        // Create user-level config
        fs.writeFileSync(
          path.join(configDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.15.3.wasm"],
          })
        );

        // Mock HOME environment variable
        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = tempHome;
        process.env.USERPROFILE = tempHome;

        try {
          // Create workspace with NO config
          context.createFile("test.json", '{"unformatted":    5}');
          await context.openWorkspace();
          await context.waitInitialize();

          // Format and verify it worked
          const doc = await context.openAndShowDocument("test.json");
          await context.formatCommand(doc.uri);
          assert.equal(doc.getText(), '{\n  "unformatted": 5\n}\n');
        } finally {
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          fs.rmSync(tempHome, { recursive: true, force: true });
        }
      });
    }).timeout(15_000);

    test("workspace config takes priority over user-level", async () => {
      await context.withTempFolder(async () => {
        // Create user-level config
        const tempHome = path.join(
          os.tmpdir(),
          "dprint-test-home-" + Date.now()
        );
        const configDir = path.join(tempHome, ".config", "dprint");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.15.3.wasm"],
          })
        );

        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = tempHome;
        process.env.USERPROFILE = tempHome;

        try {
          // Create workspace WITH config
          context.reset();
          context.createDprintJson();
          context.createFile("test.json", '{"workspace":    5}');
          await context.openWorkspace();
          await context.waitInitialize();

          // Format and verify it worked with workspace config
          const doc = await context.openAndShowDocument("test.json");
          await context.formatCommand(doc.uri);
          assert.equal(doc.getText(), '{\n  "workspace": 5\n}\n');
        } finally {
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          fs.rmSync(tempHome, { recursive: true, force: true });
        }
      });
    }).timeout(15_000);

    test("user-level config disabled by setting", async () => {
      await context.withTempFolder(async () => {
        // Create user-level config
        const tempHome = path.join(
          os.tmpdir(),
          "dprint-test-home-" + Date.now()
        );
        const configDir = path.join(tempHome, ".config", "dprint");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.15.3.wasm"],
          })
        );

        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = tempHome;
        process.env.USERPROFILE = tempHome;

        try {
          // Create workspace with NO config but disable user-level config
          context.createFile("test.json", '{"disabled":    5}');
          await context.openWorkspace();
          await vscode.workspace
            .getConfiguration("dprint")
            .update("checkUserLevelConfig", false);
          await context.waitInitialize();

          // Try to format - should NOT be formatted
          const doc = await context.openAndShowDocument("test.json");
          const originalText = doc.getText();
          await context.formatCommand(doc.uri);
          // Text should remain unchanged (no formatting)
          assert.equal(doc.getText(), originalText);
        } finally {
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          await vscode.workspace
            .getConfiguration("dprint")
            .update("checkUserLevelConfig", undefined);
          fs.rmSync(tempHome, { recursive: true, force: true });
        }
      });
    }).timeout(15_000);

    test("custom configPath takes priority over everything", async () => {
      await context.withTempFolder(async () => {
        // Create custom config location
        const customConfigDir = path.join(tempFolder, "custom-configs");
        fs.mkdirSync(customConfigDir, { recursive: true });
        const customConfigPath = path.join(
          customConfigDir,
          "custom-dprint.json"
        );
        fs.writeFileSync(
          customConfigPath,
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.15.3.wasm"],
          })
        );

        // Also create workspace config and user-level config
        context.reset();
        context.createDprintJson();

        const tempHome = path.join(
          os.tmpdir(),
          "dprint-test-home-" + Date.now()
        );
        const userConfigDir = path.join(tempHome, ".config", "dprint");
        fs.mkdirSync(userConfigDir, { recursive: true });
        fs.writeFileSync(
          path.join(userConfigDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.15.3.wasm"],
          })
        );

        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = tempHome;
        process.env.USERPROFILE = tempHome;

        try {
          context.createFile("test.json", '{"custom":    5}');
          await context.openWorkspace();
          // Set custom config path
          await vscode.workspace
            .getConfiguration("dprint")
            .update("configPath", customConfigPath);
          await context.waitInitialize();

          // Format and verify it worked
          const doc = await context.openAndShowDocument("test.json");
          await context.formatCommand(doc.uri);
          assert.equal(doc.getText(), '{\n  "custom": 5\n}\n');
        } finally {
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          await vscode.workspace
            .getConfiguration("dprint")
            .update("configPath", undefined);
          fs.rmSync(tempHome, { recursive: true, force: true });
        }
      });
    }).timeout(15_000);

    test("user-level config in parent directory", async () => {
      await context.withTempFolder(async () => {
        // Create user-level config in PARENT directory (~/.config/dprint.json)
        const tempHome = path.join(
          os.tmpdir(),
          "dprint-test-home-" + Date.now()
        );
        const configDir = path.join(tempHome, ".config");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.15.3.wasm"],
          })
        );

        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = tempHome;
        process.env.USERPROFILE = tempHome;

        try {
          // Create workspace with NO config
          context.createFile("test.json", '{"parent":    5}');
          await context.openWorkspace();
          await context.waitInitialize();

          // Format and verify it worked
          const doc = await context.openAndShowDocument("test.json");
          await context.formatCommand(doc.uri);
          assert.equal(doc.getText(), '{\n  "parent": 5\n}\n');
        } finally {
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          fs.rmSync(tempHome, { recursive: true, force: true });
        }
      });
    }).timeout(15_000);

    test("JSONC config file with comments", async () => {
      await context.withTempFolder(async () => {
        // Create user-level config as JSONC with comments
        const tempHome = path.join(
          os.tmpdir(),
          "dprint-test-home-" + Date.now()
        );
        const configDir = path.join(tempHome, ".config", "dprint");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, "dprint.jsonc"),
          `{
  // This is a comment
  "includes": ["**/*.json"],
  /* Multi-line
     comment */
  "plugins": [
    "https://plugins.dprint.dev/json-0.15.3.wasm"
  ]
}`
        );

        const originalHome = process.env.HOME;
        const originalUserProfile = process.env.USERPROFILE;
        process.env.HOME = tempHome;
        process.env.USERPROFILE = tempHome;

        try {
          // Create workspace with NO config
          context.createFile("test.json", '{"jsonc":    5}');
          await context.openWorkspace();
          await context.waitInitialize();

          // Format and verify it worked
          const doc = await context.openAndShowDocument("test.json");
          await context.formatCommand(doc.uri);
          assert.equal(doc.getText(), '{\n  "jsonc": 5\n}\n');
        } finally {
          process.env.HOME = originalHome;
          process.env.USERPROFILE = originalUserProfile;
          fs.rmSync(tempHome, { recursive: true, force: true });
        }
      });
    }).timeout(15_000);
  });
});
