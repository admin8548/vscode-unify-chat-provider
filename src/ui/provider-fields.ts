import * as vscode from 'vscode';
import { ConfigStore } from '../config-store';
import type { FormSchema, FieldContext } from './field-schema';
import {
  validateBaseUrl,
  validateProviderNameUnique,
  type ProviderFormDraft,
} from './form-utils';
import { normalizeBaseUrlInput } from '../utils';
import { ProviderType, PROVIDER_TYPES } from '../client/definitions';
import {
  ApiKeyStorageStatus,
  isApiKeySecretRef,
} from '../api-key-secret-store';

/**
 * Context for provider form fields.
 */
export interface ProviderFieldContext extends FieldContext {
  store: ConfigStore;
  apiKeyStatus?: ApiKeyStorageStatus;
  storeApiKeyInSettings: boolean;
  originalName?: string;
  onEditModels: (draft: ProviderFormDraft) => Promise<void>;
  onEditTimeout: (draft: ProviderFormDraft) => Promise<void>;
}

/**
 * Provider form field schema.
 */
export const providerFormSchema: FormSchema<ProviderFormDraft> = {
  sections: [
    { id: 'primary', label: 'Primary Fields' },
    { id: 'content', label: 'Content Fields' },
    { id: 'others', label: 'Other Fields' },
  ],
  fields: [
    // Name field
    {
      key: 'name',
      type: 'text',
      label: 'Name',
      icon: 'tag',
      section: 'primary',
      prompt: 'Enter a name for this provider',
      placeholder: 'e.g., My Provider, OpenRouter, Custom',
      required: true,
      validate: (value, _draft, context) => {
        const ctx = context as ProviderFieldContext;
        return validateProviderNameUnique(value, ctx.store, ctx.originalName);
      },
      transform: (value) => value.trim() || undefined,
      getDescription: (draft) => draft.name || '(required)',
    },
    // Type field
    {
      key: 'type',
      type: 'custom',
      label: 'API Format',
      icon: 'symbol-enum',
      section: 'primary',
      edit: async (draft) => {
        const { pickQuickItem } = await import('./component');
        const picked = await pickQuickItem<
          vscode.QuickPickItem & { typeValue: ProviderType }
        >({
          title: 'API Format',
          placeholder: 'Select the API format',
          items: Object.values(PROVIDER_TYPES).map((opt) => ({
            label: opt.label,
            description: opt.description,
            picked: opt.type === draft.type,
            typeValue: opt.type,
          })),
        });
        if (picked) {
          draft.type = picked.typeValue;
        }
      },
      getDescription: (draft) =>
        Object.values(PROVIDER_TYPES).find((o) => o.type === draft.type)
          ?.label || '(required)',
    },
    // Base URL field
    {
      key: 'baseUrl',
      type: 'text',
      label: 'API Base URL',
      icon: 'globe',
      section: 'primary',
      prompt: 'Enter the API base URL',
      placeholder: 'e.g., https://api.example.com',
      required: true,
      validate: (value) => validateBaseUrl(value),
      transform: (value) => normalizeBaseUrlInput(value),
      getDescription: (draft) => draft.baseUrl || '(required)',
    },
    // API Key field
    {
      key: 'apiKey',
      type: 'text',
      label: 'API Key',
      icon: 'key',
      section: 'primary',
      prompt: 'Enter your API key',
      placeholder: 'Leave blank if not required',
      password: true,
      getValue: (draft, context) => {
        const apiKey = draft.apiKey?.trim() || '';
        if (!apiKey) return '';

        const ctx = context as ProviderFieldContext | undefined;
        const status = ctx?.apiKeyStatus;
        if (status?.kind === 'plain' || status?.kind === 'secret') {
          return status.apiKey;
        }
        if (status?.kind === 'missing-secret') {
          return '';
        }

        return isApiKeySecretRef(apiKey) ? '' : apiKey;
      },
      transform: (value) => value.trim() || undefined,
      getDescription: (draft, context) => {
        const apiKey = draft.apiKey?.trim() || undefined;
        if (!apiKey) return '(optional)';

        const ctx = context as ProviderFieldContext | undefined;
        const status = ctx?.apiKeyStatus;

        if (status?.kind === 'missing-secret') {
          return 'Missing (re-enter required)';
        }

        return '••••••••';
      },
    },
    // Models field (custom)
    {
      key: 'models',
      type: 'custom',
      label: 'Models',
      icon: 'symbol-misc',
      section: 'content',
      edit: async (draft, context) => {
        const ctx = context as ProviderFieldContext;
        await ctx.onEditModels(draft);
      },
      getDescription: (draft) =>
        draft.models.length > 0
          ? `${draft.models.length} model(s)`
          : '(optional)',
      getDetail: (draft) =>
        draft.models.length > 0
          ? draft.models.map((m) => m.name || m.id).join(', ')
          : '(No models configured)',
    },
    // Extra Headers
    {
      key: 'extraHeaders',
      type: 'custom',
      label: 'Extra Headers',
      icon: 'json',
      section: 'others',
      edit: async () => {
        vscode.window
          .showInformationMessage(
            'Extra headers must be configured in VS Code settings (JSON).',
            'Open Settings',
          )
          .then((choice) => {
            if (choice === 'Open Settings') {
              vscode.commands.executeCommand(
                'workbench.action.openSettingsJson',
              );
            }
          });
      },
      getDescription: (draft) =>
        draft.extraHeaders
          ? `${Object.keys(draft.extraHeaders).length} headers`
          : 'Not configured',
    },
    // Extra Body
    {
      key: 'extraBody',
      type: 'custom',
      label: 'Extra Body',
      icon: 'json',
      section: 'others',
      edit: async () => {
        vscode.window
          .showInformationMessage(
            'Extra body parameters must be configured in VS Code settings (JSON).',
            'Open Settings',
          )
          .then((choice) => {
            if (choice === 'Open Settings') {
              vscode.commands.executeCommand(
                'workbench.action.openSettingsJson',
              );
            }
          });
      },
      getDescription: (draft) =>
        draft.extraBody
          ? `${Object.keys(draft.extraBody).length} properties`
          : 'Not configured',
    },
    // Timeout
    {
      key: 'timeout',
      type: 'custom',
      label: 'Network Timeout',
      icon: 'clock',
      section: 'others',
      edit: async (draft, context) => {
        const ctx = context as ProviderFieldContext;
        await ctx.onEditTimeout(draft);
      },
      getDescription: (draft) => {
        if (!draft.timeout?.connection && !draft.timeout?.response) {
          return 'default';
        }
        const parts: string[] = [];
        if (draft.timeout?.connection) {
          parts.push(`conn: ${draft.timeout.connection}ms`);
        }
        if (draft.timeout?.response) {
          parts.push(`resp: ${draft.timeout.response}ms`);
        }
        return parts.join(', ');
      },
    },
  ],
};
