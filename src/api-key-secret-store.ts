import * as vscode from 'vscode';
import { randomUUID } from 'crypto';

const SECRET_REF_PREFIX = '$UCPSECRET:';
const SECRET_REF_SUFFIX = '$';

const UUID_V4_LIKE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApiKeySecretRef(): string {
  return `${SECRET_REF_PREFIX}${randomUUID()}${SECRET_REF_SUFFIX}`;
}

export function isApiKeySecretRef(value: string): boolean {
  if (!value.startsWith(SECRET_REF_PREFIX) || !value.endsWith(SECRET_REF_SUFFIX))
    return false;
  const inner = value.slice(SECRET_REF_PREFIX.length, -SECRET_REF_SUFFIX.length);
  return UUID_V4_LIKE_REGEX.test(inner);
}

export type ApiKeyStorageStatus =
  | { kind: 'unset' }
  | { kind: 'plain'; apiKey: string }
  | { kind: 'secret'; ref: string; apiKey: string }
  | { kind: 'missing-secret'; ref: string };

export class ApiKeySecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async keys(): Promise<string[]> {
    const keys = await this.secrets.keys();
    return keys.filter((k) => k.length > 0);
  }

  async get(ref: string): Promise<string | undefined> {
    return this.secrets.get(ref);
  }

  async set(ref: string, apiKey: string): Promise<void> {
    await this.secrets.store(ref, apiKey);
  }

  async delete(ref: string): Promise<void> {
    await this.secrets.delete(ref);
  }

  async getStatus(rawApiKey: string | undefined): Promise<ApiKeyStorageStatus> {
    const apiKey = rawApiKey?.trim() || undefined;
    if (!apiKey) return { kind: 'unset' };

    if (!isApiKeySecretRef(apiKey)) {
      return { kind: 'plain', apiKey };
    }

    const stored = await this.get(apiKey);
    if (stored) {
      return { kind: 'secret', ref: apiKey, apiKey: stored };
    }

    return { kind: 'missing-secret', ref: apiKey };
  }
}
