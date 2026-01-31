import * as vscode from "vscode";
import type { ExtensionBackend } from "../ExtensionBackend";
import type { Logger } from "../logger";
import { ActivatedDisposables, HttpsTextDownloader, ObjectDisposedError } from "../utils";
import { ConfigJsonSchemaProvider } from "./ConfigJsonSchemaProvider";
import { getLanguageIdsForPlugin, isKnownPlugin } from "./pluginRegistry";
import { type FolderInfos, WorkspaceService } from "./WorkspaceService";

export function activateLegacy(
  context: vscode.ExtensionContext,
  logger: Logger,
): ExtensionBackend {
  const resourceStores = new ActivatedDisposables(logger);
  const workspaceService = new WorkspaceService({
    logger,
  });
  resourceStores.push(workspaceService);

  // todo: add an "onDidOpen" for dprint.json and use the appropriate EditorInfo
  // for ConfigJsonSchemaProvider based on the file that's shown
  const configSchemaProvider = new ConfigJsonSchemaProvider(logger, new HttpsTextDownloader());
  resourceStores.push(
    vscode.workspace.registerTextDocumentContentProvider(ConfigJsonSchemaProvider.scheme, configSchemaProvider),
  );

  // Track formatter registration separately so we can dispose it on reinitialization
  let formatterDisposable: vscode.Disposable | undefined;

  return {
    isLsp: false,
    async reInitialize() {
      try {
        const folderInfos = await workspaceService.initializeFolders();
        configSchemaProvider.setFolderInfos(folderInfos);

        // Dispose previous formatter registration before creating a new one
        formatterDisposable?.dispose();
        formatterDisposable = trySetFormattingSubscriptionFromFolderInfos(folderInfos);

        if (folderInfos.length === 0) {
          logger.logInfo("Configuration file not found.");
        }
      } catch (err) {
        if (!(err instanceof ObjectDisposedError)) {
          logger.logError("Error initializing:", err);
        }
      }
      logger.logDebug("Initialized legacy backend.");
    },
    dispose() {
      formatterDisposable?.dispose();
      resourceStores.dispose();
      logger.logDebug("Disposed legacy backend.");
    },
    getEditorServicePid() {
      return workspaceService.getEditorServicePid();
    },
  };

  function trySetFormattingSubscriptionFromFolderInfos(allFolderInfos: FolderInfos): vscode.Disposable | undefined {
    const languageIds = collectLanguageIds(allFolderInfos);

    if (languageIds.size === 0) {
      logger.logInfo("No known plugins found. Formatter not registered.");
      return undefined;
    }

    // Convert Set to array and create language-based DocumentSelector
    const documentSelector: vscode.DocumentSelector = Array.from(languageIds).map(languageId => ({
      scheme: "file",
      language: languageId,
    }));

    logger.logInfo(`Registering formatter for languages: ${Array.from(languageIds).join(", ")}`);

    return vscode.languages.registerDocumentFormattingEditProvider(
      documentSelector,
      {
        provideDocumentFormattingEdits(document, options, token) {
          return workspaceService.provideDocumentFormattingEdits(document, options, token);
        },
      },
    );

    function collectLanguageIds(folderInfos: FolderInfos): Set<string> {
      const languageIds = new Set<string>();
      const unknownPlugins = new Set<string>();

      for (const folderInfo of folderInfos) {
        for (const plugin of folderInfo.editorInfo.plugins) {
          // Use configKey as the primary lookup, fall back to name
          const pluginKey = plugin.configKey || plugin.name;

          if (isKnownPlugin(pluginKey)) {
            const pluginLanguageIds = getLanguageIdsForPlugin(pluginKey);
            if (pluginLanguageIds) {
              pluginLanguageIds.forEach(id => languageIds.add(id));
            }
          } else {
            unknownPlugins.add(pluginKey);
          }
        }
      }

      // Log unknown plugins for debugging
      if (unknownPlugins.size > 0) {
        logger.logInfo(
          `Unknown/custom plugins detected (will not be registered): ${Array.from(unknownPlugins).join(", ")}`,
        );
        logger.logInfo(
          "If this is an official dprint plugin, please report this at https://github.com/dprint/dprint-vscode/issues",
        );
      }

      return languageIds;
    }
  }
}
