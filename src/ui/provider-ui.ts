import { ConfigStore } from '../config-store';
import { ProviderConfig } from '../types';
import { promptForBase64Config } from './base64-config';
import { runUiStack } from './router/stack-router';
import type { UiContext } from './router/types';
import { runRemoveProviderScreen } from './screens/remove-provider-screen';
import type { ApiKeySecretStore } from '../api-key-secret-store';

export async function manageProviders(
  store: ConfigStore,
  apiKeyStore: ApiKeySecretStore,
): Promise<void> {
  const ctx: UiContext = { store, apiKeyStore };
  await runUiStack(ctx, { kind: 'providerList' });
}

export async function addProvider(
  store: ConfigStore,
  apiKeyStore: ApiKeySecretStore,
): Promise<void> {
  const ctx: UiContext = { store, apiKeyStore };
  await runUiStack(ctx, { kind: 'providerForm' });
}

export async function addProviderFromConfig(
  store: ConfigStore,
  apiKeyStore: ApiKeySecretStore,
): Promise<void> {
  const config = await promptForBase64Config<Partial<ProviderConfig>>({
    title: 'Add Provider From Config',
    placeholder: 'Paste configuration JSON or Base64 string...',
  });
  if (!config) return;

  const ctx: UiContext = { store, apiKeyStore };
  await runUiStack(ctx, { kind: 'providerForm', initialConfig: config });
}

export async function addProviderFromWellKnownList(
  store: ConfigStore,
  apiKeyStore: ApiKeySecretStore,
): Promise<void> {
  const ctx: UiContext = { store, apiKeyStore };
  await runUiStack(ctx, { kind: 'wellKnownProviderList' });
}

export async function importProviders(
  store: ConfigStore,
  apiKeyStore: ApiKeySecretStore,
): Promise<void> {
  const ctx: UiContext = { store, apiKeyStore };
  await runUiStack(ctx, { kind: 'importProviders' });
}

export async function removeProvider(
  store: ConfigStore,
  apiKeyStore: ApiKeySecretStore,
): Promise<void> {
  await runRemoveProviderScreen(store, apiKeyStore);
}
