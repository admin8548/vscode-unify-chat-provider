import * as vscode from 'vscode';
import { generateAutoVersionedId } from '../model-id-utils';
import {
  deepClone,
  mergePartialByKeys,
  MODEL_CONFIG_KEYS,
  PROVIDER_CONFIG_KEYS,
  withoutKey,
} from '../config-ops';
import { ProviderConfig, ModelConfig } from '../types';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decode a config string to an object.
 *
 * Supports:
 * - Raw JSON object string
 * - Base64 / Base64-URL encoded JSON object string
 */
export function decodeConfigStringToObject<T extends object = object>(
  text: string,
): T | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  // 1) Try raw JSON first.
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isObjectRecord(parsed)) {
      return parsed as T;
    }
  } catch {
    // ignore and fall back to Base64
  }

  // 2) Fall back to Base64 / Base64-URL
  return decodeBase64ToObject<T>(trimmed);
}

/**
 * Encode a configuration object to Base64-URL string.
 * The object is serialized to JSON and then encoded.
 */
export function encodeConfigToBase64(config: object): string {
  const json = JSON.stringify(config);
  // Use Buffer for Node.js environment
  const base64 = Buffer.from(json, 'utf-8').toString('base64');
  // Convert to base64url: replace + with -, / with _, and remove trailing =
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a Base64 or Base64-URL string to an object.
 * Supports both standard Base64 and Base64-URL formats.
 * @returns The decoded object, or undefined if decoding fails.
 */
export function decodeBase64ToObject<T = object>(
  base64String: string,
): T | undefined {
  try {
    // Normalize base64url to base64
    let normalized = base64String.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    const pad = normalized.length % 4;
    if (pad === 2) {
      normalized += '==';
    } else if (pad === 3) {
      normalized += '=';
    }

    const json = Buffer.from(normalized, 'base64').toString('utf-8');
    const obj = JSON.parse(json);

    // Basic validation: must be an object
    if (!isObjectRecord(obj)) {
      return undefined;
    }

    return obj as T;
  } catch {
    return undefined;
  }
}

/**
 * Try to get a valid config string from clipboard.
 * Supports JSON object string and Base64/Base64-URL encoded JSON.
 *
 * @returns The decoded object if valid, undefined otherwise.
 */
export async function tryGetBase64ConfigFromClipboard<
  T extends object = object,
>(): Promise<T | undefined> {
  try {
    const clipboardText = await vscode.env.clipboard.readText();
    if (!clipboardText || clipboardText.length > 100000) {
      return undefined;
    }
    return decodeConfigStringToObject<T>(clipboardText.trim());
  } catch {
    return undefined;
  }
}

/**
 * Try to get a valid config from clipboard.
 * Supports JSON object string and Base64/Base64-URL encoded JSON.
 */
export async function tryGetConfigFromClipboard<
  T extends object = object,
>(): Promise<T | undefined> {
  try {
    const clipboardText = await vscode.env.clipboard.readText();
    if (!clipboardText || clipboardText.length > 100000) {
      return undefined;
    }
    return decodeConfigStringToObject<T>(clipboardText.trim());
  } catch {
    return undefined;
  }
}

/**
 * Copy a configuration as Base64 string to clipboard.
 */
export async function copyConfigAsBase64(config: object): Promise<void> {
  const base64 = encodeConfigToBase64(config);
  await vscode.env.clipboard.writeText(base64);
}

/**
 * Show an input dialog to get a config string.
 * Pre-fills with clipboard content if it's a valid config.
 */
export async function promptForBase64Config<
  T extends object = object,
>(options: { title: string; placeholder?: string }): Promise<T | undefined> {
  const clipboardConfig = await tryGetConfigFromClipboard<T>();

  const inputBox = vscode.window.createInputBox();
  inputBox.title = options.title;
  inputBox.placeholder =
    options.placeholder ?? 'Paste configuration JSON or Base64 string...';
  inputBox.ignoreFocusOut = true;

  // Pre-fill with clipboard if valid
  if (clipboardConfig) {
    const clipboardText = await vscode.env.clipboard.readText();
    inputBox.value = clipboardText.trim();
    inputBox.validationMessage = undefined;
  }

  return new Promise<T | undefined>((resolve) => {
    let resolved = false;

    const finish = (result: T | undefined) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    inputBox.onDidChangeValue((text) => {
      if (!text.trim()) {
        inputBox.validationMessage = undefined;
        return;
      }
      const decoded = decodeConfigStringToObject<T>(text.trim());
      if (!decoded) {
        inputBox.validationMessage =
          'Invalid configuration. Paste a JSON object or a Base64/Base64-URL encoded JSON object.';
      } else {
        inputBox.validationMessage = undefined;
      }
    });

    inputBox.onDidAccept(() => {
      const text = inputBox.value.trim();
      if (!text) {
        finish(undefined);
        inputBox.hide();
        return;
      }

      const decoded = decodeConfigStringToObject<T>(text);
      if (!decoded) {
        inputBox.validationMessage =
          'Invalid configuration. Paste a JSON object or a Base64/Base64-URL encoded JSON object.';
        return;
      }

      finish(decoded);
      inputBox.hide();
    });

    inputBox.onDidHide(() => {
      finish(undefined);
      inputBox.dispose();
    });

    inputBox.show();
  });
}

/**
 * Show a dialog displaying the config string (already copied to clipboard).
 */
export async function showCopiedBase64Config(config: object): Promise<void> {
  const base64 = encodeConfigToBase64(config);
  await vscode.env.clipboard.writeText(base64);
  vscode.window.showInformationMessage(
    'Configuration string has been copied to clipboard.',
  );

  const inputBox = vscode.window.createInputBox();
  inputBox.title = 'Base64 Configuration';
  inputBox.prompt = 'You can copy and share this configuration string.';
  inputBox.value = base64;
  inputBox.ignoreFocusOut = false;

  return new Promise<void>((resolve) => {
    inputBox.onDidAccept(() => {
      inputBox.hide();
    });
    inputBox.onDidHide(() => {
      inputBox.dispose();
      resolve();
    });
    inputBox.show();
  });
}

/**
 * Merge partial config into a provider draft.
 * Only copies properties that exist in the source.
 */
export function mergePartialProviderConfig(
  draft: Partial<ProviderConfig>,
  source: Partial<ProviderConfig>,
): void {
  mergePartialByKeys(draft, source, withoutKey(PROVIDER_CONFIG_KEYS, 'models'));

  const models = source.models;
  if (models !== undefined && Array.isArray(models)) {
    draft.models = deepClone(models);
  }
}

/**
 * Merge partial config into a model draft.
 * Only copies properties that exist in the source.
 */
export function mergePartialModelConfig(
  draft: Partial<ModelConfig>,
  source: Partial<ModelConfig>,
): void {
  mergePartialByKeys(draft, source, MODEL_CONFIG_KEYS);
}

/**
 * Duplicate a model with auto-incremented ID.
 */
export function duplicateModel(
  model: ModelConfig,
  existingModels: ModelConfig[],
): ModelConfig {
  const newId = generateAutoVersionedId(model.id, existingModels);
  const cloned = deepClone(model);
  cloned.id = newId;
  return cloned;
}
