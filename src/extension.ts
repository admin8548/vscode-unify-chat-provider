import * as vscode from 'vscode';

const CONFIG_NAMESPACE = 'unifyChatProviders';
const ENDPOINTS_KEY = `${CONFIG_NAMESPACE}.endpoints`;
const ACTIVE_PROVIDER_KEY = `${CONFIG_NAMESPACE}.activeProvider`;
const ACTIVE_MODEL_KEY = `${CONFIG_NAMESPACE}.activeModel`;

interface ProviderConfig {
  type?: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  defaultModel?: string;
}

interface ExtensionConfiguration {
  endpoints: ProviderConfig[];
  activeProvider?: string;
  activeModel?: string;
}

interface ChatMessagePayload {
  role: 'user' | 'assistant';
  content: string;
}

class ProviderStore {
  get configuration(): ExtensionConfiguration {
    const workspaceConfig = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return {
      endpoints: workspaceConfig.get<ProviderConfig[]>('endpoints', []),
      activeProvider: workspaceConfig.get<string>('activeProvider') ?? undefined,
      activeModel: workspaceConfig.get<string>('activeModel') ?? undefined,
    };
  }

  async updateConfiguration(key: string, value: unknown): Promise<void> {
    await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Workspace);
  }

  async setEndpoints(endpoints: ProviderConfig[]): Promise<void> {
    await this.updateConfiguration(ENDPOINTS_KEY, endpoints);
  }

  async setActiveProvider(providerName: string): Promise<void> {
    await this.updateConfiguration(ACTIVE_PROVIDER_KEY, providerName);
  }

  async setActiveModel(model: string): Promise<void> {
    await this.updateConfiguration(ACTIVE_MODEL_KEY, model);
  }
}

class AnthropicLikeClient {
  constructor(private readonly config: ProviderConfig) {}

  private buildMessages(messages: ChatMessagePayload[], prompt: string): unknown[] {
    const normalized = messages.map((message) => ({
      role: message.role,
      content: [
        {
          type: 'text',
          text: message.content,
        },
      ],
    }));

    normalized.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt,
        },
      ],
    });

    return normalized;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private async streamResponse(response: Response, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      return;
    }

    while (!token.isCancellationRequested) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);

      for (const line of lines) {
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.replace(/^data:\s*/, '');
        if (payload === '[DONE]') {
          return;
        }

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.delta?.text ?? parsed?.message?.content?.[0]?.text;
          if (typeof delta === 'string' && delta.length) {
            stream.markdown(delta);
          }
        } catch (error) {
          console.error('Failed to parse streaming chunk', error);
        }
      }
    }
  }

  async sendChat(messages: ChatMessagePayload[], prompt: string, model: string, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    const body = {
      model,
      messages: this.buildMessages(messages, prompt),
      max_tokens: 1024,
      stream: true,
    };

    const abortController = new AbortController();
    const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

    const requestInit: RequestInit = {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: abortController.signal,
    };

    try {
      const response = await fetch(this.config.baseUrl, requestInit);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Request failed with status ${response.status}: ${text}`);
      }

      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        await this.streamResponse(response, stream, token);
        return;
      }

      const result = await response.json();
      const content = result?.content?.[0]?.text ?? result?.output_text ?? result?.message ?? JSON.stringify(result);
      stream.markdown(typeof content === 'string' ? content : JSON.stringify(content));
    } finally {
      cancellationSubscription.dispose();
    }
  }
}

class ChatProviderService {
  private registration: vscode.Disposable | undefined;
  private readonly store = new ProviderStore();

  constructor(private readonly context: vscode.ExtensionContext) {}

  initialize(): void {
    this.registerCommands();
    this.registerFromConfiguration();

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(CONFIG_NAMESPACE)) {
          this.registerFromConfiguration();
        }
      }),
    );
  }

  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('unifyChatProviders.addProvider', async () => this.addProvider()),
      vscode.commands.registerCommand('unifyChatProviders.removeProvider', async () => this.removeProvider()),
      vscode.commands.registerCommand('unifyChatProviders.selectProvider', async () => this.selectProvider()),
      vscode.commands.registerCommand('unifyChatProviders.selectModel', async () => this.selectModel()),
    );
  }

  private validateEndpoint(endpoint: ProviderConfig): boolean {
    return Boolean(endpoint.name && endpoint.baseUrl && Array.isArray(endpoint.models) && endpoint.models.length > 0);
  }

  private createClient(endpoint: ProviderConfig): AnthropicLikeClient {
    const endpointType = endpoint.type ?? 'anthropic-like';

    switch (endpointType) {
      case 'anthropic-like':
      case 'anthropic':
      default:
        return new AnthropicLikeClient(endpoint);
    }
  }

  private getActiveEndpoint(): { endpoint: ProviderConfig; model: string } | undefined {
    const { endpoints, activeModel, activeProvider } = this.store.configuration;
    const endpoint = endpoints.find((item) => item.name === activeProvider) ?? endpoints[0];
    if (!endpoint || !this.validateEndpoint(endpoint)) {
      return undefined;
    }

    const model = activeModel || endpoint.defaultModel || endpoint.models[0];
    return { endpoint, model };
  }

  private registerFromConfiguration(): void {
    this.registration?.dispose();
    const selected = this.getActiveEndpoint();

    if (!selected) {
      return;
    }

    const { endpoint, model } = selected;
    const client = this.createClient(endpoint);

    const participant: any = {
      metadata: {
        name: endpoint.name,
        description: 'Unified chat provider participant',
      },
      async handleChatRequest(request: any, _context: any, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) {
        const history: ChatMessagePayload[] = (request?.messages ?? [])
          .map((message: any) => ({
            role: message?.role === 'assistant' ? 'assistant' : 'user',
            content: typeof message?.content === 'string' ? message.content : message?.content?.[0]?.text ?? '',
          }))
          .filter((message: ChatMessagePayload) => !!message.content);

        const prompt = typeof request?.prompt === 'string' ? request.prompt : request?.prompt?.value ?? '';
        if (!prompt) {
          stream.markdown('No prompt provided.');
          return;
        }

        try {
          await client.sendChat(history, prompt, model, stream, token);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stream.markdown(`Request failed: ${message}`);
        }
      },
    };

    this.registration = (vscode.lm as any).registerChatParticipant('unifyChatProviders.participant', participant);
    this.context.subscriptions.push(this.registration);
  }

  private async addProvider(): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Provider name (e.g., Anthropic)', placeHolder: 'Anthropic' });
    if (!name) {
      return;
    }

    const type = await vscode.window.showQuickPick(['anthropic-like'], {
      placeHolder: 'Provider type (e.g., anthropic-like)',
      canPickMany: false,
    });
    if (!type) {
      return;
    }

    const baseUrl = await vscode.window.showInputBox({
      prompt: 'Base URL for the chat completions endpoint',
      placeHolder: 'https://api.example.com/v1/messages',
    });
    if (!baseUrl) {
      return;
    }

    const apiKey = await vscode.window.showInputBox({ prompt: 'API Key (leave blank for none)', password: true });

    const modelsRaw = await vscode.window.showInputBox({ prompt: 'Comma separated list of models', placeHolder: 'model-a,model-b' });
    if (!modelsRaw) {
      return;
    }

    const models = modelsRaw
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);

    if (models.length === 0) {
      vscode.window.showErrorMessage('At least one model must be provided.');
      return;
    }

    const defaultModel = await vscode.window.showQuickPick(models, { placeHolder: 'Select default model (optional)', canPickMany: false });

    const newEndpoint: ProviderConfig = {
      type,
      name,
      baseUrl,
      apiKey: apiKey || undefined,
      models,
      defaultModel: defaultModel || undefined,
    };
    const { endpoints } = this.store.configuration;
    await this.store.setEndpoints([...endpoints.filter((endpoint) => endpoint.name !== name), newEndpoint]);
    await this.store.setActiveProvider(name);
    if (defaultModel) {
      await this.store.setActiveModel(defaultModel);
    }

    vscode.window.showInformationMessage(`Provider "${name}" added.`);
  }

  private async removeProvider(): Promise<void> {
    const { endpoints, activeProvider } = this.store.configuration;
    if (!endpoints.length) {
      vscode.window.showInformationMessage('No providers configured.');
      return;
    }

    const selection = await vscode.window.showQuickPick(endpoints.map((endpoint) => endpoint.name), { placeHolder: 'Select provider to remove' });
    if (!selection) {
      return;
    }

    const updated = endpoints.filter((endpoint) => endpoint.name !== selection);
    await this.store.setEndpoints(updated);

    if (selection === activeProvider) {
      await this.store.setActiveProvider(updated[0]?.name ?? '');
      await this.store.setActiveModel(updated[0]?.defaultModel ?? updated[0]?.models?.[0] ?? '');
    }

    vscode.window.showInformationMessage(`Provider "${selection}" removed.`);
  }

  private async selectProvider(): Promise<void> {
    const { endpoints, activeProvider } = this.store.configuration;
    if (!endpoints.length) {
      vscode.window.showInformationMessage('No providers configured.');
      return;
    }

    const selection = await vscode.window.showQuickPick(
      endpoints.map((endpoint) => ({ label: endpoint.name, description: endpoint.baseUrl })),
      { placeHolder: 'Select active provider', canPickMany: false, ignoreFocusOut: true },
    );

    if (!selection) {
      return;
    }

    await this.store.setActiveProvider(selection.label);
    const selectedProvider = endpoints.find((endpoint) => endpoint.name === selection.label);
    if (selectedProvider) {
      await this.store.setActiveModel(selectedProvider.defaultModel ?? selectedProvider.models[0]);
    }

    if (selection.label !== activeProvider) {
      vscode.window.showInformationMessage(`Active provider set to ${selection.label}.`);
    }
  }

  private async selectModel(): Promise<void> {
    const { endpoints, activeProvider, activeModel } = this.store.configuration;
    const provider = endpoints.find((endpoint) => endpoint.name === activeProvider);
    if (!provider) {
      vscode.window.showInformationMessage('Select a provider before choosing a model.');
      return;
    }

    const selection = await vscode.window.showQuickPick(provider.models, {
      placeHolder: `Select a model for ${provider.name}`,
      canPickMany: false,
      ignoreFocusOut: true,
    });

    if (!selection) {
      return;
    }

    await this.store.setActiveModel(selection);
    if (selection !== activeModel) {
      vscode.window.showInformationMessage(`Active model set to ${selection}.`);
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const service = new ChatProviderService(context);
  service.initialize();
}

export function deactivate(): void {}
