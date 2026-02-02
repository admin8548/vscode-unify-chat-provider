import * as os from 'os';
import * as path from 'path';
import type {
  ProviderMigrationCandidate,
  ProviderMigrationSource,
} from './types';
import { firstExistingFilePath } from './fs-utils';
import { WELL_KNOWN_PROVIDERS, resolveProviderModels } from '../well-known/providers';
import { t } from '../i18n';
import type { ProviderConfig } from '../types';
import type {
  GoogleVertexAIAdcConfig,
  GoogleVertexAIApiKeyConfig,
  GoogleVertexAIServiceAccountConfig,
} from '../auth/types';
import { migrationLog } from '../logger';
import { GeminiCliOAuthDetectedError } from './errors';

function getString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) continue;
    if (trimmedLine.startsWith('#')) continue;
    if (trimmedLine.startsWith('//')) continue;

    const line = trimmedLine.startsWith('export ')
      ? trimmedLine.slice('export '.length).trim()
      : trimmedLine;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;

    const rawKey = line.slice(0, equalsIndex).trim();
    if (!rawKey) continue;

    const normalizedKey = rawKey.toUpperCase();
    const rawValue = line.slice(equalsIndex + 1).trim();
    if (!rawValue) continue;

    let value = rawValue;
    const firstChar = value[0];
    if (firstChar === '"' || firstChar === "'") {
      const quote = firstChar;
      let endIndex = -1;
      for (let i = 1; i < value.length; i++) {
        const ch = value[i];
        if (ch === quote && value[i - 1] !== '\\') {
          endIndex = i;
          break;
        }
      }
      if (endIndex > 0) {
        value = value.slice(1, endIndex);
      } else {
        value = value.slice(1);
      }
    } else {
      const hashIndex = value.indexOf('#');
      if (hashIndex >= 0) {
        value = value.slice(0, hashIndex).trim();
      }
    }

    const finalValue = value.trim();
    if (!finalValue) continue;
    result[normalizedKey] = finalValue;
  }

  return result;
}

function extractGeminiCliEnv(content: string): Record<string, string> {
  const relevantEnvKeys = [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_PROJECT_ID',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_GENAI_USE_VERTEXAI',
  ] as const;

  const merged: Record<string, string> = {};

  for (const [key, value] of Object.entries(parseDotEnv(content))) {
    const upperKey = key.trim().toUpperCase();
    const trimmedValue = value.trim();
    if (!upperKey || !trimmedValue) continue;
    if (!(upperKey in merged)) {
      merged[upperKey] = trimmedValue;
    }
  }

  for (const key of relevantEnvKeys) {
    const fromProcessEnv = getString(process.env[key]);
    if (fromProcessEnv && !(key in merged)) {
      merged[key] = fromProcessEnv;
    }
  }

  return merged;
}

function buildGeminiCliProvider(
  env: Record<string, string>,
): ProviderMigrationCandidate {
  const geminiApiKey = getString(env['GEMINI_API_KEY']);
  const googleApiKey = getString(env['GOOGLE_API_KEY']);
  const applicationCredentials = getString(
    env['GOOGLE_APPLICATION_CREDENTIALS'],
  );
  const project =
    getString(env['GOOGLE_CLOUD_PROJECT']) ??
    getString(env['GOOGLE_CLOUD_PROJECT_ID']);
  const location = getString(env['GOOGLE_CLOUD_LOCATION']);
  const useVertexFromEnv =
    getString(env['GOOGLE_GENAI_USE_VERTEXAI'])?.toLowerCase() === 'true';

  const enabledAuthMethods = [
    geminiApiKey ? 'gemini-api-key' : undefined,
    googleApiKey ? 'google-cloud-api-key' : undefined,
    applicationCredentials ? 'service-account-json' : undefined,
  ].filter((value): value is string => value !== undefined);

  if (enabledAuthMethods.length > 1) {
    throw new Error(
      t(
        'Gemini CLI config has multiple authentication variables set ({0}). Keep only one of GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_APPLICATION_CREDENTIALS.',
        enabledAuthMethods.join(', '),
      ),
    );
  }

  const vertexWellKnown = WELL_KNOWN_PROVIDERS.find(
    (p) => p.type === 'google-vertex-ai',
  );
  const aiStudioWellKnown = WELL_KNOWN_PROVIDERS.find(
    (p) => p.type === 'google-ai-studio',
  );

  if (!vertexWellKnown || !aiStudioWellKnown) {
    throw new Error('Required well-known providers are missing.');
  }

  const modelsForVertex = resolveProviderModels({
    ...vertexWellKnown,
    name: 'Gemini CLI',
  });
  const modelsForAiStudio = resolveProviderModels({
    ...aiStudioWellKnown,
    name: 'Gemini CLI',
  });

  if (applicationCredentials) {
    if (!location) {
      throw new Error(
        t(
          'Vertex AI (service account JSON key) is missing required env var: GOOGLE_CLOUD_LOCATION.',
        ),
      );
    }

    const auth: GoogleVertexAIServiceAccountConfig = {
      method: 'google-vertex-ai-auth',
      subType: 'service-account',
      keyFilePath: applicationCredentials,
      projectId: project,
      location,
    };

    const provider: Partial<ProviderConfig> = {
      type: 'google-vertex-ai',
      name: 'Gemini CLI',
      baseUrl: vertexWellKnown.baseUrl,
      auth,
      models: modelsForVertex,
    };

    return { provider };
  }

  if (googleApiKey) {
    const auth: GoogleVertexAIApiKeyConfig = {
      method: 'google-vertex-ai-auth',
      subType: 'api-key',
      apiKey: googleApiKey,
    };

    const provider: Partial<ProviderConfig> = {
      type: 'google-vertex-ai',
      name: 'Gemini CLI',
      baseUrl: vertexWellKnown.baseUrl,
      auth,
      models: modelsForVertex,
    };

    return { provider };
  }

  if (geminiApiKey) {
    const provider: Partial<ProviderConfig> = {
      type: 'google-ai-studio',
      name: 'Gemini CLI',
      baseUrl: aiStudioWellKnown.baseUrl,
      auth: {
        method: 'api-key',
        apiKey: geminiApiKey,
      },
      models: modelsForAiStudio,
    };

    return { provider };
  }

  if (project || location || useVertexFromEnv) {
    if (!project || !location) {
      const missing: string[] = [];
      if (!project) missing.push('GOOGLE_CLOUD_PROJECT');
      if (!location) missing.push('GOOGLE_CLOUD_LOCATION');
      throw new Error(
        t(
          'Vertex AI (ADC) is missing required env var(s): {0}.',
          missing.join(', '),
        ),
      );
    }

    const auth: GoogleVertexAIAdcConfig = {
      method: 'google-vertex-ai-auth',
      subType: 'adc',
      projectId: project,
      location,
    };

    const provider: Partial<ProviderConfig> = {
      type: 'google-vertex-ai',
      name: 'Gemini CLI',
      baseUrl: vertexWellKnown.baseUrl,
      auth,
      models: modelsForVertex,
    };

    return { provider };
  }

  throw new GeminiCliOAuthDetectedError();
}

export const geminiCliMigrationSource: ProviderMigrationSource = {
  id: 'gemini-cli',
  displayName: 'Gemini CLI',
  async detectConfigFile(): Promise<string | undefined> {
    const home = os.homedir();
    return firstExistingFilePath([path.join(home, '.gemini', '.env')]);
  },
  async importFromConfigContent(
    content: string,
  ): Promise<readonly ProviderMigrationCandidate[]> {
    migrationLog.info('gemini-cli', 'Parsing config content');
    const env = extractGeminiCliEnv(content);
    migrationLog.info('gemini-cli', 'Extracted environment variables', {
      ...env,
      GEMINI_API_KEY: env['GEMINI_API_KEY'] ? '***' : undefined,
      GOOGLE_API_KEY: env['GOOGLE_API_KEY'] ? '***' : undefined,
      GOOGLE_APPLICATION_CREDENTIALS: env['GOOGLE_APPLICATION_CREDENTIALS']
        ? '***'
        : undefined,
    });
    const candidate = buildGeminiCliProvider(env);
    migrationLog.info('gemini-cli', 'Built provider candidate', {
      type: candidate.provider.type,
      name: candidate.provider.name,
      baseUrl: candidate.provider.baseUrl,
      modelsCount: candidate.provider.models?.length,
    });
    return [candidate];
  },
};
