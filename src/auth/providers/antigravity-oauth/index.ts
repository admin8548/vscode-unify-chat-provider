import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import {
  AuthConfigureResult,
  AuthProvider,
  AuthProviderContext,
  AuthProviderDefinition,
  AuthStatusChange,
  AuthStatusViewItem,
  AuthUiStatusSnapshot,
} from '../../auth-provider';
import { t } from '../../../i18n';
import {
  createSecretRef,
  isSecretRef,
  type SecretStore,
} from '../../../secret';
import type { AntigravityOAuthConfig, AuthCredential, OAuth2TokenData } from '../../types';
import { exchangeAntigravity, refreshAccessToken } from './oauth-client';
import { performAntigravityAuthorization } from './screens/authorize-screen';

function toPersistableConfig(
  config: AntigravityOAuthConfig | undefined,
): AntigravityOAuthConfig {
  return {
    method: 'antigravity-oauth',
    label: config?.label,
    description: config?.description,
    identityId: config?.identityId,
    token: config?.token,
    projectId: config?.projectId,
    tier: config?.tier,
    email: config?.email,
  };
}

async function cleanupLegacyClientSecret(
  config: AntigravityOAuthConfig | undefined,
  secretStore: SecretStore,
): Promise<void> {
  if (!config) {
    return;
  }

  const record = config as unknown as Record<string, unknown>;
  const raw = record['clientSecret'];
  if (typeof raw === 'string' && isSecretRef(raw)) {
    await secretStore.deleteOAuth2ClientSecret(raw);
  }
}

export class AntigravityOAuthProvider implements AuthProvider {
  static redactForExport(auth: AntigravityOAuthConfig): AntigravityOAuthConfig {
    return { ...toPersistableConfig(auth), token: undefined };
  }

  static async resolveForExport(
    auth: AntigravityOAuthConfig,
    secretStore: SecretStore,
  ): Promise<AntigravityOAuthConfig> {
    const tokenRaw = auth.token?.trim();
    if (!tokenRaw) {
      throw new Error('Missing token');
    }

    const tokenData = isSecretRef(tokenRaw)
      ? await secretStore.getOAuth2Token(tokenRaw)
      : this.parseTokenData(tokenRaw);

    if (!tokenData) {
      throw new Error('Missing token');
    }

    return { ...toPersistableConfig(auth), token: JSON.stringify(tokenData) };
  }

  static async normalizeOnImport(
    auth: AntigravityOAuthConfig,
    options: {
      secretStore: SecretStore;
      storeSecretsInSettings: boolean;
      existing?: AntigravityOAuthConfig;
    },
  ): Promise<AntigravityOAuthConfig> {
    const secretStore = options.secretStore;

    const normalizeToken = async (): Promise<string | undefined> => {
      const raw = auth.token?.trim();
      if (!raw) {
        return undefined;
      }

      if (options.storeSecretsInSettings) {
        if (!isSecretRef(raw)) {
          return raw;
        }
        const stored = await secretStore.getOAuth2Token(raw);
        return stored ? JSON.stringify(stored) : raw;
      }

      if (isSecretRef(raw)) {
        return raw;
      }

      const tokenData = this.parseTokenData(raw);
      if (!tokenData) {
        return undefined;
      }

      const existingRef =
        options.existing?.token && isSecretRef(options.existing.token)
          ? options.existing.token
          : undefined;

      const ref = existingRef ?? secretStore.createRef();
      await secretStore.setOAuth2Token(ref, tokenData);
      return ref;
    };

    const token = await normalizeToken();
    await cleanupLegacyClientSecret(auth, secretStore);
    return { ...toPersistableConfig(auth), token };
  }

  static async prepareForDuplicate(
    auth: AntigravityOAuthConfig,
    options: { secretStore: SecretStore; storeSecretsInSettings: boolean },
  ): Promise<AntigravityOAuthConfig> {
    const cleared: AntigravityOAuthConfig = { ...toPersistableConfig(auth), token: undefined, identityId: randomUUID() };

    if (!options.storeSecretsInSettings) {
      return cleared;
    }

    return this.normalizeOnImport(cleared, {
      secretStore: options.secretStore,
      storeSecretsInSettings: true,
    });
  }

  static async cleanupOnDiscard(
    auth: AntigravityOAuthConfig,
    secretStore: SecretStore,
  ): Promise<void> {
    const tokenRaw = auth.token?.trim();
    if (tokenRaw && isSecretRef(tokenRaw)) {
      await secretStore.deleteOAuth2Token(tokenRaw);
    }
    await cleanupLegacyClientSecret(auth, secretStore);
  }

  private static isTokenData(value: unknown): value is OAuth2TokenData {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    return (
      typeof record['accessToken'] === 'string' &&
      record['accessToken'].trim().length > 0 &&
      typeof record['tokenType'] === 'string' &&
      record['tokenType'].trim().length > 0
    );
  }

  private static parseTokenData(raw: string): OAuth2TokenData | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      return this.isTokenData(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private readonly _onDidChangeStatus = new vscode.EventEmitter<AuthStatusChange>();
  readonly onDidChangeStatus = this._onDidChangeStatus.event;

  constructor(
    private readonly context: AuthProviderContext,
    private config?: AntigravityOAuthConfig,
  ) {}

  get definition(): AuthProviderDefinition {
    return {
      id: 'antigravity-oauth',
      label: this.config?.label ?? 'Google (Antigravity)',
      description: this.config?.description ?? t('Authenticate with Google OAuth for Antigravity'),
    };
  }

  getConfig(): AntigravityOAuthConfig | undefined {
    return this.config;
  }

  private async persistConfig(next: AntigravityOAuthConfig): Promise<void> {
    this.config = next;
    await this.context.persistAuthConfig?.(next);
  }

  private async resolveTokenData(): Promise<OAuth2TokenData | null> {
    const raw = this.config?.token?.trim();
    if (!raw) {
      return null;
    }

    if (isSecretRef(raw)) {
      return this.context.secretStore.getOAuth2Token(raw);
    }

    return AntigravityOAuthProvider.parseTokenData(raw);
  }

  async getStatusSnapshot(): Promise<AuthUiStatusSnapshot> {
    const token = await this.resolveTokenData();
    if (!token) {
      return { kind: 'not-authorized' };
    }

    const expiresAt = token.expiresAt;
    if (expiresAt !== undefined && this.context.secretStore.isOAuth2TokenExpired(token, 0)) {
      const refreshable = !!token.refreshToken;
      return { kind: 'expired', refreshable, expiresAt };
    }

    return { kind: 'valid', expiresAt };
  }

  async getSummaryDetail(): Promise<string | undefined> {
    const snapshot = await this.getStatusSnapshot();
    if (snapshot.kind === 'not-authorized') {
      return t('Not authorized');
    }
    if (snapshot.kind === 'expired') {
      return snapshot.refreshable ? t('Expired (refreshable)') : t('Expired');
    }
    if (snapshot.kind === 'valid') {
      const email = this.config?.email?.trim();
      return email ? email : t('Authorized');
    }
    return undefined;
  }

  async getStatusViewItems(): Promise<AuthStatusViewItem[]> {
    const detail = await this.getSummaryDetail();
    const snapshot = await this.getStatusSnapshot();

    const description = (() => {
      switch (snapshot.kind) {
        case 'valid':
          return t('Authorized');
        case 'expired':
          return snapshot.refreshable ? t('Expired (refreshable)') : t('Expired');
        case 'not-authorized':
          return t('Not authorized');
        default:
          return t('Not configured');
      }
    })();

    const items: AuthStatusViewItem[] = [
      {
        label: `$(shield) ${t('Authorization status')}`,
        description,
        detail,
      },
    ];

    if (snapshot.kind === 'expired' && snapshot.refreshable) {
      items.push({
        label: `$(refresh) ${t('Refresh token')}`,
        description: t('Refresh access token'),
        action: {
          kind: 'inline',
          run: async () => {
            await this.refresh();
          },
        },
      });
    }

    items.push({
      label: `$(sign-in) ${t('Re-authorize...')}`,
      description: t('Sign in again or switch account'),
      action: {
        kind: 'close',
        run: async () => {
          const result = await this.configure();
          if (!result.success && result.error) {
            vscode.window.showErrorMessage(result.error);
          }
        },
      },
    });

    items.push({
      label: `$(sign-out) ${t('Sign out')}`,
      description: t('Revoke and clear local tokens'),
      action: {
        kind: 'inline',
        run: async () => {
          await this.revoke();
        },
      },
    });

    return items;
  }

  async getCredential(): Promise<AuthCredential | undefined> {
    const token = await this.resolveTokenData();
    if (!token) {
      return undefined;
    }

    const bufferMs = this.getExpiryBufferMs();
    if (this.context.secretStore.isOAuth2TokenExpired(token, bufferMs)) {
      const refreshed = await this.refresh();
      if (!refreshed) {
        this._onDidChangeStatus.fire({ status: 'expired' });
        return undefined;
      }

      const newToken = await this.resolveTokenData();
      if (!newToken) {
        this._onDidChangeStatus.fire({ status: 'expired' });
        return undefined;
      }

      return {
        value: newToken.accessToken,
        tokenType: newToken.tokenType,
        expiresAt: newToken.expiresAt,
      };
    }

    return {
      value: token.accessToken,
      tokenType: token.tokenType,
      expiresAt: token.expiresAt,
    };
  }

  getExpiryBufferMs(): number {
    return 5 * 60 * 1000;
  }

  async isValid(): Promise<boolean> {
    const token = await this.resolveTokenData();
    if (!token) {
      return false;
    }

    if (this.context.secretStore.isOAuth2TokenExpired(token, 0)) {
      return !!token.refreshToken;
    }

    return true;
  }

  async configure(): Promise<AuthConfigureResult> {
    const projectId =
      this.config?.projectId?.trim() ??
      (await vscode.window.showInputBox({
        title: t('Project ID (optional)'),
        prompt: t('Optional: enter project id (leave empty to auto-detect)'),
        ignoreFocusOut: true,
      }))?.trim() ??
      '';

    const authorization = await import('./oauth-client').then((m) =>
      m.authorizeAntigravity(projectId),
    );

    const callbackResult = await performAntigravityAuthorization(authorization.url);
    if (!callbackResult) {
      return { success: false, error: t('Authorization failed or was cancelled') };
    }

    if (callbackResult.type === 'error') {
      return {
        success: false,
        error: t('Authorization failed: {0}', callbackResult.error),
      };
    }

    const exchanged = await exchangeAntigravity({
      code: callbackResult.code,
      state: callbackResult.state,
    });

    if (exchanged.type === 'failed') {
      return {
        success: false,
        error: t('Authorization failed: {0}', exchanged.error),
      };
    }

    const tokenRef = createSecretRef();
    await this.context.secretStore.setOAuth2Token(tokenRef, {
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      tokenType: 'Bearer',
      expiresAt: exchanged.expiresAt,
    });

    const nextConfig: AntigravityOAuthConfig = {
      method: 'antigravity-oauth',
      label: this.config?.label,
      description: this.config?.description,
      identityId: randomUUID(),
      token: tokenRef,
      projectId: exchanged.projectId,
      tier: exchanged.tier,
      email: exchanged.email,
    };

    await this.persistConfig(nextConfig);
    this._onDidChangeStatus.fire({ status: 'valid' });

    return { success: true, config: nextConfig };
  }

  async refresh(): Promise<boolean> {
    const token = await this.resolveTokenData();
    if (!token?.refreshToken) {
      return false;
    }

    const refreshed = await refreshAccessToken({
      refreshToken: token.refreshToken,
    });

    if (!refreshed) {
      this._onDidChangeStatus.fire({ status: 'error', error: new Error('Refresh failed') });
      return false;
    }

    const raw = this.config?.token?.trim();
    if (!raw) {
      return false;
    }

    const nextToken: OAuth2TokenData = {
      accessToken: refreshed.accessToken,
      refreshToken: token.refreshToken,
      tokenType: refreshed.tokenType ?? 'Bearer',
      expiresAt: refreshed.expiresAt,
    };

    if (isSecretRef(raw)) {
      await this.context.secretStore.setOAuth2Token(raw, nextToken);
    } else {
      await this.persistConfig({ ...toPersistableConfig(this.config), token: JSON.stringify(nextToken) });
    }

    this._onDidChangeStatus.fire({ status: 'valid' });
    return true;
  }

  async revoke(): Promise<void> {
    if (!this.config) {
      return;
    }

    const tokenRaw = this.config.token?.trim();
    if (tokenRaw && isSecretRef(tokenRaw)) {
      await this.context.secretStore.deleteOAuth2Token(tokenRaw);
    }

    await this.persistConfig({
      ...toPersistableConfig(this.config),
      token: undefined,
      email: undefined,
      tier: undefined,
    });

    this._onDidChangeStatus.fire({ status: 'revoked' });
  }

  dispose(): void {
    this._onDidChangeStatus.dispose();
  }
}
