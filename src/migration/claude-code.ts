import * as os from 'os';
import * as path from 'path';
import type {
  ProviderMigrationCandidate,
  ProviderMigrationSource,
} from './types';
import { firstExistingFilePath, isExistingFile } from './fs-utils';
import {
  WELL_KNOWN_MODELS,
  WellKnownModelId,
  normalizeWellKnownConfigs,
} from '../well-known/models';
import { t } from '../i18n';
import type { ModelConfig, ProviderConfig } from '../types';
import { migrationLog } from '../logger';

const CLAUDE_CODE_DEFAULT_MODEL_IDS: WellKnownModelId[] = [
  'claude-sonnet-4-5',
  'claude-opus-4-5',
  'claude-haiku-4-5',
] as const;

function getClaudeCodeDefaultModels(provider: ProviderConfig): ModelConfig[] {
  const models: (typeof WELL_KNOWN_MODELS)[number][] = [];
  for (const id of CLAUDE_CODE_DEFAULT_MODEL_IDS) {
    const model = WELL_KNOWN_MODELS.find((m) => m.id === id);
    if (!model) {
      throw new Error(t('Well-known model not found: {0}', id));
    }
    models.push(model);
  }
  return normalizeWellKnownConfigs(models, undefined, provider);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type StringEntry = { keyNorm: string; value: string };

function collectStringEntries(
  value: unknown,
  out: StringEntry[],
  options: { maxDepth: number },
  depth = 0,
  seen = new Set<object>(),
): void {
  if (depth > options.maxDepth) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringEntries(item, out, options, depth + 1, seen);
    }
    return;
  }

  if (!isObjectRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string') {
      out.push({ keyNorm: normalizeKey(key), value: nested });
      continue;
    }
    collectStringEntries(nested, out, options, depth + 1, seen);
  }
}

function tryParseJson(content: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed;
  } catch {
    // ignore
  }
  return undefined;
}

function parseKeyValuePairs(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    if (!key) continue;

    let value = line.slice(equalsIndex + 1).trim();
    if (!value) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

function normalizeUrlCandidate(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return withScheme;
  } catch {
    return undefined;
  }
}

function pickValueByKey(
  entries: readonly StringEntry[],
  keyNormsExact: readonly string[],
  keyNormSuffixes: readonly string[],
): string | undefined {
  for (const keyNorm of keyNormsExact) {
    for (const entry of entries) {
      if (entry.keyNorm === keyNorm) {
        const trimmed = entry.value.trim();
        if (trimmed) return trimmed;
      }
    }
  }

  for (const suffix of keyNormSuffixes) {
    for (const entry of entries) {
      if (entry.keyNorm.endsWith(suffix)) {
        const trimmed = entry.value.trim();
        if (trimmed) return trimmed;
      }
    }
  }

  return undefined;
}

function extractClaudeCodeSettings(content: string): {
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  providerName?: string;
} {
  const json = tryParseJson(content.trim());
  const entries: StringEntry[] = [];
  if (json !== undefined) {
    collectStringEntries(json, entries, { maxDepth: 12 });
  }

  const env = parseKeyValuePairs(content);
  for (const [key, value] of Object.entries(env)) {
    entries.push({ keyNorm: normalizeKey(key), value });
  }

  const baseUrlRaw = pickValueByKey(
    entries,
    ['url', 'baseurl', 'apiurl'],
    ['baseurl', 'apiurl', 'url'],
  );
  const apiKeyRaw = pickValueByKey(
    entries,
    ['token', 'apikey'],
    ['apikey', 'token'],
  );
  const modelIdRaw = pickValueByKey(
    entries,
    ['model', 'modelid', 'defaultmodel'],
    ['model'],
  );
  const providerNameRaw = pickValueByKey(
    entries,
    ['name', 'providername'],
    ['providername'],
  );

  const baseUrl = baseUrlRaw
    ? (normalizeUrlCandidate(baseUrlRaw) ?? baseUrlRaw)
    : undefined;
  const apiKey = apiKeyRaw?.trim() || undefined;
  const modelId = modelIdRaw?.trim() || undefined;
  const providerName = providerNameRaw?.trim() || undefined;

  return { baseUrl, apiKey, modelId, providerName };
}

function buildClaudeCodeProvider(
  settings: ReturnType<typeof extractClaudeCodeSettings>,
): ProviderMigrationCandidate {
  const baseUrl = settings.baseUrl;
  const apiKey = settings.apiKey;

  if (!baseUrl || !apiKey) {
    const missing: string[] = [];
    if (!baseUrl) missing.push('URL');
    if (!apiKey) missing.push('TOKEN/APIKEY');
    throw new Error(
      t(
        'Claude Code config is missing required field(s): {0}',
        missing.join(', '),
      ),
    );
  }

  const providerForMatching: ProviderConfig = {
    type: 'anthropic',
    name: settings.providerName || 'Claude Code',
    baseUrl,
    auth: {
      method: 'api-key',
      apiKey,
    },
    models: [],
  };

  const provider: Partial<ProviderConfig> = {
    ...providerForMatching,
    models: getClaudeCodeDefaultModels(providerForMatching),
  };

  return { provider };
}

function getClaudeCodeConfigPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
    path.join(home, '.claude.json'),
  ];
}

export async function detectAllConfigFiles(): Promise<string[]> {
  const candidates = getClaudeCodeConfigPaths();
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await isExistingFile(candidate)) {
      existing.push(candidate);
    }
  }
  return existing;
}

export const claudeCodeMigrationSource: ProviderMigrationSource = {
  id: 'claude-code',
  displayName: 'Claude Code',
  async detectConfigFile(): Promise<string | undefined> {
    const candidates = getClaudeCodeConfigPaths();
    return firstExistingFilePath(candidates);
  },
  async importFromConfigContent(
    content: string,
  ): Promise<readonly ProviderMigrationCandidate[]> {
    migrationLog.info('claude-code', 'Parsing config content');
    const settings = extractClaudeCodeSettings(content);
    migrationLog.info('claude-code', 'Extracted settings', {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey ? '***' : undefined,
      modelId: settings.modelId,
      providerName: settings.providerName,
    });
    const candidate = buildClaudeCodeProvider(settings);
    migrationLog.info('claude-code', 'Built provider candidate', {
      type: candidate.provider.type,
      name: candidate.provider.name,
      baseUrl: candidate.provider.baseUrl,
      modelsCount: candidate.provider.models?.length,
    });
    return [candidate];
  },
};
