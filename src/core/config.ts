import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface OllamaConfig {
  url: string;
  embedding_model: string;
  chat_model: string;
}

export interface ApiConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface Config {
  ollama: OllamaConfig;
  api: ApiConfig;
}

const DEFAULT_CONFIG: Config = {
  ollama: {
    url: "http://localhost:11434",
    embedding_model: "qwen3-embedding:latest",
    chat_model: "qwen3:latest",
  },
  api: {
    base_url: "",
    api_key: "",
    model: "",
  },
};

let cachedConfig: Config | null = null;

function resolveEnvVar(value: string): string {
  // Supports env:VAR_NAME pattern, e.g. api_key = "env:MINIMAX_API_KEY"
  if (value.startsWith("env:")) {
    const envName = value.slice(4);
    return process.env[envName] ?? "";
  }
  return value;
}

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const configPath = join(process.cwd(), "config.toml");
  if (!existsSync(configPath)) {
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }

  // Simple TOML parse — section-based line parser
  const content = readFileSync(configPath, "utf-8");
  const config: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); // deep clone

  let currentSection: string | null = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      const match = line.match(/^\[(\w+)\]$/);
      if (match) currentSection = match[1];
      continue;
    }
    const kvMatch = line.match(/^\s*(\w+)\s*=\s*["']([^"']+)["']/);
    if (!kvMatch || !currentSection) continue;
    const [, key, rawValue] = kvMatch;
    const value = resolveEnvVar(rawValue);
    if (currentSection === "ollama") {
      if (key === "url") config.ollama.url = value;
      if (key === "embedding_model") config.ollama.embedding_model = value;
      if (key === "chat_model") config.ollama.chat_model = value;
    }
    if (currentSection === "api") {
      if (key === "base_url") config.api.base_url = value;
      if (key === "api_key") config.api.api_key = value;
      if (key === "model") config.api.model = value;
    }
  }

  cachedConfig = config;
  return config;
}

export function getConfig(): Config {
  return loadConfig();
}
