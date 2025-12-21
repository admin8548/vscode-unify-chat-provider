import type { ProviderConfig } from '../types';

export interface ProviderMigrationCandidate {
  provider: Partial<ProviderConfig>;
}

export interface ProviderMigrationSource {
  readonly id: string;
  readonly displayName: string;
  /**
   * Try to auto-detect a config file for this application.
   * Return the file path if found, otherwise undefined.
   */
  detectConfigFile(): Promise<string | undefined>;
  /**
   * Import providers from config content (not file path).
   * Implementations should throw an Error with a user-friendly message.
   */
  importFromConfigContent(
    content: string,
  ): Promise<readonly ProviderMigrationCandidate[]>;
}

