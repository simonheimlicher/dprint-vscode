import { homedir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
export * from "./ActivatedDisposables.js";
export * from "./TextDownloader.js";

export class ObjectDisposedError extends Error {}

/** For now, only expands ~/ to env.HOME */
export function shellExpand(path: string, env: { [prop: string]: string | undefined } = process.env) {
  if (path.startsWith("~/")) {
    const home = env.HOME ?? "";
    path = path.replace("~/", home + "/");
  }
  return path;
}

/**
 * Gets platform-specific user-level config directory for dprint.
 * - Linux/macOS: ~/.config/dprint
 * - Windows: %APPDATA%\dprint
 *
 * @param options Optional parameters for testing (allows dependency injection)
 */
export function getUserConfigDirectory(options?: {
  homedir?: string;
  platform?: NodeJS.Platform;
  env?: { APPDATA?: string; XDG_CONFIG_HOME?: string };
}): string {
  const home = options?.homedir ?? homedir();
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;

  // Use platform-appropriate path separator (enables cross-platform testing)
  const join = platform === "win32" ? path.win32.join : path.posix.join;

  if (platform === "win32") {
    // On Windows, use APPDATA
    const appData = env.APPDATA;
    if (appData) {
      return join(appData, "dprint");
    }
    // Fallback to home directory
    return join(home, "AppData", "Roaming", "dprint");
  } else {
    // Linux/macOS use XDG_CONFIG_HOME or ~/.config
    const xdgConfigHome = env.XDG_CONFIG_HOME;
    if (xdgConfigHome) {
      return join(xdgConfigHome, "dprint");
    }
    return join(home, ".config", "dprint");
  }
}

export async function waitWorkspaceInitialized() {
  while (vscode.workspace.workspaceFolders == null || vscode.workspace.workspaceFolders.length === 0) {
    await delay(100);
  }
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
