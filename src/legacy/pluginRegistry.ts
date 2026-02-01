/**
 * Registry mapping dprint plugins to VSCode language identifiers.
 *
 * This module provides a hardcoded mapping from dprint plugin configKey values
 * to VSCode language IDs. This enables proper formatter registration so that
 * VSCode's formatter UI correctly recognizes which file types dprint can format.
 *
 * To add a new plugin:
 * 1. Find the plugin's configKey (the key used in dprint.json config)
 * 2. Find VSCode language IDs from: https://code.visualstudio.com/docs/languages/identifiers
 * 3. Add entry to DPRINT_PLUGIN_REGISTRY object
 *
 * Example:
 * "my-plugin": {
 *   languageIds: ["mylang"],
 *   extensions: [".mylang"]
 * }
 */

export interface PluginLanguageMapping {
  /** The VSCode language IDs this plugin formats */
  languageIds: string[];
  /** Optional: File extensions for documentation/validation */
  extensions?: string[];
}

/**
 * Registry of official dprint plugins and their VSCode language mappings.
 * Key is the plugin's configKey (from dprint.json).
 */
export const DPRINT_PLUGIN_REGISTRY: Record<string, PluginLanguageMapping> = {
  // TypeScript/JavaScript Plugin
  // https://plugins.dprint.dev/typescript/
  typescript: {
    languageIds: [
      "typescript",
      "javascript",
      "typescriptreact",
      "javascriptreact",
    ],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
  },

  // JSON Plugin
  // https://plugins.dprint.dev/json/
  json: {
    languageIds: ["json", "jsonc"],
    extensions: [".json", ".jsonc"],
  },

  // Markdown Plugin
  // https://plugins.dprint.dev/markdown/
  markdown: {
    languageIds: ["markdown"],
    extensions: [".md", ".markdown", ".mkd", ".mdwn", ".mkdn", ".mdown"],
  },

  // TOML Plugin
  // https://plugins.dprint.dev/toml/
  toml: {
    languageIds: ["toml"],
    extensions: [".toml"],
  },

  // Dockerfile Plugin
  // https://plugins.dprint.dev/dockerfile/
  dockerfile: {
    languageIds: ["dockerfile"],
    extensions: [],
  },

  // Biome Plugin (handles JS/TS/JSON)
  // https://plugins.dprint.dev/biome/
  biome: {
    languageIds: [
      "typescript",
      "javascript",
      "typescriptreact",
      "javascriptreact",
      "json",
      "jsonc",
    ],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
  },

  // Malva Plugin (CSS/SCSS/Sass/Less)
  // https://plugins.dprint.dev/malva/
  malva: {
    languageIds: ["css", "scss", "sass", "less"],
    extensions: [".css", ".scss", ".sass", ".less"],
  },

  // Markup_fmt Plugin (HTML, Vue, Svelte, etc.)
  // https://plugins.dprint.dev/markup_fmt/
  markup_fmt: {
    languageIds: ["html", "vue", "svelte", "xml"],
    extensions: [".html", ".vue", ".svelte", ".xml"],
  },

  // Markup Plugin (alias for markup_fmt)
  markup: {
    languageIds: ["html", "vue", "svelte", "xml"],
    extensions: [".html", ".vue", ".svelte", ".xml"],
  },

  // GraphQL Plugin
  // https://plugins.dprint.dev/graphql/
  graphql: {
    languageIds: ["graphql"],
    extensions: [".graphql", ".gql"],
  },

  // YAML Plugin
  // https://plugins.dprint.dev/g-plane/pretty_yaml/
  yaml: {
    languageIds: ["yaml"],
    extensions: [".yaml", ".yml"],
  },

  // Ruff Plugin (Python)
  // https://plugins.dprint.dev/ruff/
  ruff: {
    languageIds: ["python"],
    extensions: [".py"],
  },

  // Mago Plugin (PHP)
  // https://plugins.dprint.dev/mago/
  mago: {
    languageIds: ["php"],
    extensions: [".php"],
  },

  // Roslyn Plugin (C#/VB.NET)
  // https://plugins.dprint.dev/roslyn/
  roslyn: {
    languageIds: ["csharp", "vb"],
    extensions: [".cs", ".vb"],
  },

  // Prettier Plugin (process plugin, handles many languages)
  // https://plugins.dprint.dev/prettier/
  prettier: {
    languageIds: [
      "typescript",
      "javascript",
      "typescriptreact",
      "javascriptreact",
      "json",
      "jsonc",
      "css",
      "scss",
      "less",
      "html",
      "vue",
      "yaml",
      "markdown",
    ],
  },

  // Jupyter Plugin
  // https://plugins.dprint.dev/jupyter/
  jupyter: {
    languageIds: ["jupyter"],
    extensions: [".ipynb"],
  },
};

/**
 * Get VSCode language IDs for a dprint plugin.
 * @param configKey - The plugin's configKey from PluginInfo
 * @returns Array of VSCode language IDs, or undefined if plugin not recognized
 */
export function getLanguageIdsForPlugin(
  configKey: string
): string[] | undefined {
  return DPRINT_PLUGIN_REGISTRY[configKey]?.languageIds;
}

/**
 * Check if a plugin is in the known registry.
 * @param configKey - The plugin's configKey from PluginInfo
 * @returns true if plugin is recognized
 */
export function isKnownPlugin(configKey: string): boolean {
  return configKey in DPRINT_PLUGIN_REGISTRY;
}
