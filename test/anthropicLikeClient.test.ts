import assert from 'node:assert';
import test, { mock } from 'node:test';
import Module from 'node:module';

const configurationValues = {
  endpoints: [
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-chat'] },
  ],
};

const vscodeMock = {
  workspace: {
    getConfiguration: (section?: string) => {
      if (section === 'unifyChatProviders') {
        return {
          get: (key: string, defaultValue?: unknown) => (configurationValues as any)[key] ?? defaultValue,
        } as any;
      }
      return { update: async () => undefined } as any;
    },
    onDidChangeConfiguration: () => ({ dispose() {} }),
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

test('AnthropicLikeClient handles JSON responses', async () => {
  const { AnthropicLikeClient } = await import('../src/extension');
  const markdown: string[] = [];
  const stream = { markdown: (value: string) => markdown.push(value) } as any;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  } as any;

  global.fetch = mock.fn(async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ content: [{ text: 'Hello from DeepSeek' }] }),
    body: null,
  })) as any;

  const client = new AnthropicLikeClient({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-chat'] });
  await client.sendChat([], 'Hi there', 'deepseek-chat', stream, token);

  assert.deepStrictEqual(markdown, ['Hello from DeepSeek']);
  assert.strictEqual((fetch as any).mock.calls.length, 1);
});

test('AnthropicLikeClient streams SSE responses', async () => {
  const { AnthropicLikeClient } = await import('../src/extension');
  const markdown: string[] = [];
  const stream = { markdown: (value: string) => markdown.push(value) } as any;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  } as any;

  const encoder = new TextEncoder();
  const chunks = [
    'data: {"delta": {"text": "Hello"}}\n\n',
    'data: {"delta": {"text": " world"}}\n\n',
    'data: [DONE]\n\n',
  ];
  const reader = {
    index: 0,
    async read() {
      if (this.index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const value = encoder.encode(chunks[this.index]);
      this.index += 1;
      return { done: false, value };
    },
  };

  global.fetch = mock.fn(async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: { getReader: () => reader },
  })) as any;

  const client = new AnthropicLikeClient({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-chat'] });
  await client.sendChat([], 'Stream request', 'deepseek-chat', stream, token);

  assert.deepStrictEqual(markdown, ['Hello', ' world']);
});

test('AnthropicLikeClient surfaces HTTP failures', async () => {
  const { AnthropicLikeClient } = await import('../src/extension');
  const stream = { markdown: () => undefined } as any;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  } as any;

  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Service unavailable',
    headers: new Headers(),
    body: null,
  }) as any;

  const client = new AnthropicLikeClient({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', models: ['deepseek-chat'] });
  await assert.rejects(() => client.sendChat([], 'Hi', 'deepseek-chat', stream, token), /Request failed with status 500/);
});
