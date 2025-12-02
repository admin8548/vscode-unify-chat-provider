import assert from 'node:assert';
import test, { mock } from 'node:test';
import Module from 'node:module';

const configurationValues = {
  endpoints: [
    {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: ['deepseek-chat', 'deepseek-chat-alt'],
      defaultModel: 'deepseek-chat',
    },
    {
      name: 'Second',
      baseUrl: 'https://second.example/v1/messages',
      models: ['s1'],
    },
  ],
  activeProvider: 'Second',
  activeModel: '',
};

const registeredParticipants: any[] = [];

const vscodeMock = {
  workspace: {
    getConfiguration: (section?: string) => {
      if (section === 'unifyChatProviders') {
        return {
          get: (key: string, defaultValue?: unknown) => (configurationValues as any)[key] ?? defaultValue,
        } as any;
      }
      return {
        update: async (key: string, value: unknown) => {
          (configurationValues as any)[key] = value;
        },
      } as any;
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
  lm: {
    registerChatParticipant: (identifier: string, participant: any) => {
      registeredParticipants.push({ identifier, participant });
      return { dispose() {} };
    },
  },
};

const originalLoad = (Module as any)._load;
(Module as any)._load = (request: string, parent: any, isMain: boolean) => {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad(request, parent, isMain);
};

test('ChatProviderService resolves active endpoint and model', async () => {
  const { ChatProviderService } = await import('../src/extension');
  const service = new ChatProviderService({ subscriptions: [] } as any);

  const result = (service as any).getActiveEndpoint();
  assert.ok(result);
  assert.strictEqual(result?.endpoint.name, 'Second');
  assert.strictEqual(result?.model, 's1');
});

test('ChatProviderService registers participant from configuration', async () => {
  registeredParticipants.length = 0;
  const { ChatProviderService } = await import('../src/extension');
  const service = new ChatProviderService({ subscriptions: [] } as any);
  const stubClient = { sendChat: mock.fn(async () => undefined) };
  (service as any).createClient = () => stubClient;

  (service as any).registerFromConfiguration();

  assert.strictEqual(registeredParticipants.length > 0, true);
  const registration = registeredParticipants[registeredParticipants.length - 1];
  const participant = registration.participant;
  const markdown: string[] = [];
  const stream = { markdown: (value: string) => markdown.push(value) } as any;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose() {} }),
  } as any;

  await participant.handleChatRequest({ messages: [], prompt: '' }, {}, stream, token);
  assert.deepStrictEqual(markdown, ['No prompt provided.']);
  assert.strictEqual(stubClient.sendChat.mock.calls.length, 0);

  await participant.handleChatRequest(
    {
      messages: [
        { role: 'user', content: [{ text: 'Hello' }] },
        { role: 'assistant', content: [{ text: 'Hi there' }] },
      ],
      prompt: 'New prompt',
    },
    {},
    stream,
    token,
  );

  assert.strictEqual(stubClient.sendChat.mock.calls.length, 1);
  const [history, prompt, model] = stubClient.sendChat.mock.calls[0].arguments;
  assert.deepStrictEqual(history, [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' },
  ]);
  assert.strictEqual(prompt, 'New prompt');
  assert.strictEqual(model, 's1');
});

test('ChatProviderService skips registration when configuration is invalid', async () => {
  registeredParticipants.length = 0;
  configurationValues.endpoints = [];
  const { ChatProviderService } = await import('../src/extension');
  const service = new ChatProviderService({ subscriptions: [] } as any);
  (service as any).registerFromConfiguration();

  assert.strictEqual((service as any).registration, undefined);

  configurationValues.endpoints = [
    {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: ['deepseek-chat', 'deepseek-chat-alt'],
      defaultModel: 'deepseek-chat',
    },
    {
      name: 'Second',
      baseUrl: 'https://second.example/v1/messages',
      models: ['s1'],
    },
  ];
});
