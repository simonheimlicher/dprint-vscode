import * as assert from "node:assert";
import * as path from "node:path";
import { getUserConfigDirectory } from "../../utils";

suite("Utils Test Suite", () => {
  suite("getUserConfigDirectory", () => {
    test("Linux/macOS default path", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: {},
      });
      assert.equal(result, path.join("/home/testuser", ".config", "dprint"));
    });

    test("Linux with XDG_CONFIG_HOME set", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: { XDG_CONFIG_HOME: "/custom/config" },
      });
      assert.equal(result, path.join("/custom/config", "dprint"));
    });

    test("Linux with XDG_CONFIG_HOME undefined", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: { XDG_CONFIG_HOME: undefined },
      });
      assert.equal(result, path.join("/home/testuser", ".config", "dprint"));
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
      assert.equal(
        result,
        path.join("C:\\Users\\testuser", "AppData", "Roaming", "dprint")
      );
    });

    test("macOS (darwin) platform uses Unix logic", () => {
      const result = getUserConfigDirectory({
        homedir: "/Users/testuser",
        platform: "darwin",
        env: {},
      });
      assert.equal(result, path.join("/Users/testuser", ".config", "dprint"));
    });

    test("macOS with XDG_CONFIG_HOME override", () => {
      const result = getUserConfigDirectory({
        homedir: "/Users/testuser",
        platform: "darwin",
        env: { XDG_CONFIG_HOME: "/opt/config" },
      });
      assert.equal(result, path.join("/opt/config", "dprint"));
    });

    test("Edge case - empty environment variables", () => {
      const result = getUserConfigDirectory({
        homedir: "/home/testuser",
        platform: "linux",
        env: {},
      });
      // Should use default ~/.config/dprint
      assert.equal(result, path.join("/home/testuser", ".config", "dprint"));
    });
  });
});
