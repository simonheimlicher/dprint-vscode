import * as assert from "node:assert";
import { getUserConfigDirectory, isUserLevelConfig } from "../../utils";

suite("Utils Test Suite", () => {
  suite("getUserConfigDirectory", () => {
    test("Linux/macOS default path", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: {},
      });
      assert.equal(result, "/home/testuser/.config/dprint");
    });

    test("Linux with XDG_CONFIG_HOME set", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: { XDG_CONFIG_HOME: "/custom/config" },
      });
      assert.equal(result, "/custom/config/dprint");
    });

    test("Linux with XDG_CONFIG_HOME undefined", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: { XDG_CONFIG_HOME: undefined },
      });
      assert.equal(result, "/home/testuser/.config/dprint");
    });

    test("Windows default path with APPDATA set", () => {
      const result = getUserConfigDirectory({
        homedir: "C:\\Users\\testuser",
        platform: "win32",
        env: { APPDATA: "C:\\Users\\testuser\\AppData\\Roaming" },
      });
      assert.equal(result, "C:\\Users\\testuser\\AppData\\Roaming\\dprint");
    });

    test("Windows with APPDATA undefined", () => {
      const result = getUserConfigDirectory({
        homedir: "C:\\Users\\testuser",
        platform: "win32",
        env: { APPDATA: undefined },
      });
      assert.equal(result, "C:\\Users\\testuser\\AppData\\Roaming\\dprint");
    });

    test("macOS (darwin) platform uses Unix logic", () => {
      const result = getUserConfigDirectory({
        homedir: "/Users/testuser",
        platform: "darwin",
        env: {},
      });
      assert.equal(result, "/Users/testuser/.config/dprint");
    });

    test("macOS with XDG_CONFIG_HOME override", () => {
      const result = getUserConfigDirectory({
        homedir: "/Users/testuser",
        platform: "darwin",
        env: { XDG_CONFIG_HOME: "/opt/config" },
      });
      assert.equal(result, "/opt/config/dprint");
    });

    test("Edge case - empty environment variables", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: {},
      });
      // Should use default ~/.config/dprint
      assert.equal(result, "/home/testuser/.config/dprint");
    });
  });

  suite("isUserLevelConfig", () => {
    // Single workspace scenarios
    test("single workspace - config inside workspace is NOT user-level", () => {
      const configUri = "file:///workspace/project/dprint.json";
      const workspaceFolders = ["file:///workspace/project"];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), false);
    });

    test("single workspace - config in subdirectory is NOT user-level", () => {
      const configUri = "file:///workspace/project/packages/lib/dprint.json";
      const workspaceFolders = ["file:///workspace/project"];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), false);
    });

    test("single workspace - config outside workspace IS user-level", () => {
      const configUri = "file:///home/user/.config/dprint/dprint.json";
      const workspaceFolders = ["file:///workspace/project"];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), true);
    });

    // Multi-root workspace scenarios (the regression case)
    test("multi-root - config in folder A is NOT user-level for folder B", () => {
      // This is the bug that was fixed: folder A's config should NOT be
      // treated as user-level when processing folder B
      const configUri = "file:///workspace/project-a/dprint.json";
      const workspaceFolders = [
        "file:///workspace/project-a",
        "file:///workspace/project-b",
      ];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), false);
    });

    test("multi-root - config in folder B is NOT user-level for folder A", () => {
      const configUri = "file:///workspace/project-b/dprint.json";
      const workspaceFolders = [
        "file:///workspace/project-a",
        "file:///workspace/project-b",
      ];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), false);
    });

    test("multi-root - config outside all folders IS user-level", () => {
      const configUri = "file:///home/user/.config/dprint/dprint.json";
      const workspaceFolders = [
        "file:///workspace/project-a",
        "file:///workspace/project-b",
      ];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), true);
    });

    test("multi-root - user-level config used when no workspace has config", () => {
      // User config should be identified as user-level even with multiple workspaces
      const configUri = "file:///home/user/.config/dprint/dprint.jsonc";
      const workspaceFolders = [
        "file:///workspace/frontend",
        "file:///workspace/backend",
        "file:///workspace/shared",
      ];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), true);
    });

    // Edge cases
    test("empty workspace folders - any config is user-level", () => {
      const configUri = "file:///some/path/dprint.json";
      const workspaceFolders: string[] = [];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), true);
    });

    test("Windows paths work correctly", () => {
      const configUri = "file:///c%3A/Users/dev/AppData/Roaming/dprint/dprint.json";
      const workspaceFolders = ["file:///c%3A/workspace/project"];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), true);
    });

    test("Windows - config in workspace is NOT user-level", () => {
      const configUri = "file:///c%3A/workspace/project/dprint.json";
      const workspaceFolders = ["file:///c%3A/workspace/project"];
      assert.strictEqual(isUserLevelConfig(configUri, workspaceFolders), false);
    });
  });
});
