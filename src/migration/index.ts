import { promises as fs } from 'fs';
import { claudeCodeMigrationSource } from './claude-code';
import { codexMigrationSource } from './codex';
import { geminiCliMigrationSource } from './gemini-cli';
import { normalizeConfigFilePathInput } from './fs-utils';
import type {
  ProviderMigrationCandidate,
  ProviderMigrationSource,
} from './types';
import { migrationLog } from '../logger';

export type {
  ProviderMigrationCandidate,
  ProviderMigrationSource,
} from './types';
export { normalizeConfigFilePathInput } from './fs-utils';

export const PROVIDER_MIGRATION_SOURCES: readonly ProviderMigrationSource[] = [
  claudeCodeMigrationSource,
  codexMigrationSource,
  geminiCliMigrationSource,
];

export function getProviderMigrationSource(
  id: string,
): ProviderMigrationSource | undefined {
  return PROVIDER_MIGRATION_SOURCES.find((s) => s.id === id);
}

export async function importProvidersFromConfigFile(options: {
  source: ProviderMigrationSource;
  configFilePath: string;
}): Promise<readonly ProviderMigrationCandidate[]> {
  const filePath = normalizeConfigFilePathInput(options.configFilePath);
  migrationLog.info(options.source.id, `Reading config file: ${filePath}`);
  const content = await fs.readFile(filePath, 'utf-8');
  migrationLog.info(options.source.id, 'Config file content', content);
  return options.source.importFromConfigContent(content);
}
