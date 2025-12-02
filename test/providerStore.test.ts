import assert from 'node:assert';
import test from 'node:test';
import Module from 'node:module';

const updates: Array<{ key: string; value: unknown; target: unknown }> = [];
const configurationValues = {
  endpoints: [
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-chat'] },
  ],
  activeProvider: 'DeepSeek',
  activeModel: 'deepseek-chat',
};

const vscodeMock = {
  workspace: {
    getConfiguration: (section?: string) => {
      if (section === 'unifyChatProviders') {
        return {
          get: (key: string, defaultValue?: unknown) => (configurationValues as any)[key] ?? defaultValue,
        } as any;
      }

      return {
        update: async (key: string, value: unknown, target: unknown) => {
          updates.push({ key, value, target });
          (configurationValues as any)[key] = value;
        },
      } as any;
    },
  },
  ConfigurationTarget: { Workspace: 'workspace' },
  window: {
    showInformationMessage: () => undefined,
    showErrorMessage: () => undefined,
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined,
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
  lm: { registerChatParticipant: () => ({ dispose() {} }) },
};

const originalLoad = (Module as any)._load;
(Module as any)._load = (request: string, parent: any, isMain: boolean) => {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad(request, parent, isMain);
};

test('ProviderStore exposes workspace configuration and writes updates', async () => {
  const { ProviderStore } = await import('../src/extension');
  const store = new ProviderStore();

  const config = store.configuration;
  assert.strictEqual(config.activeProvider, 'DeepSeek');
  assert.strictEqual(config.activeModel, 'deepseek-chat');
  assert.strictEqual(config.endpoints[0].name, 'DeepSeek');

  await store.setEndpoints([{ name: 'Second', baseUrl: 'https://example', models: ['m1'] }]);
  await store.setActiveProvider('Second');
  await store.setActiveModel('m1');

  assert.deepStrictEqual(updates[0], {
    key: 'unifyChatProviders.endpoints',
    value: [{ name: 'Second', baseUrl: 'https://example', models: ['m1'] }],
    target: 'workspace',
  });
  assert.deepStrictEqual(updates[1], {
    key: 'unifyChatProviders.activeProvider',
    value: 'Second',
    target: 'workspace',
  });
  assert.deepStrictEqual(updates[2], {
    key: 'unifyChatProviders.activeModel',
    value: 'm1',
    target: 'workspace',
  });
});
