# Unify Chat Providers

A VS Code extension that manages multiple chat providers and registers a unified Language Model Chat participant. Configure any number of Anthropic-style endpoints, select the active provider/model, and chat directly from VS Code.

## Features

- Workspace configuration for multiple endpoints (type, name, base URL, API key, available models, default model).
- Registers a VS Code Language Model chat participant using the currently selected provider and model.
- Requests follow Anthropic-compatible headers and body schema with streaming responses.
- Quick commands to add, remove, select providers, and switch models.
- Designed to be extensible so additional provider formats can be added later.

## Requirements

- VS Code 1.88.0 or newer.
- Network access to your configured provider endpoints.

## Getting Started

1. Install dependencies and build the extension:

   ```bash
   npm install
   npm run compile
   ```

2. Press `F5` in VS Code to launch an Extension Development Host and load the extension.

## Configuration

Add providers to your workspace settings (`.vscode/settings.json`) using the `unifyChatProviders.endpoints` array. Each entry should follow this shape:

```json
{
  "unifyChatProviders.endpoints": [
    {
      "type": "anthropic-like",
      "name": "Anthropic",
      "baseUrl": "https://api.anthropic.com/v1/messages",
      "apiKey": "ANTHROPIC_API_KEY",
      "models": ["claude-3-opus-20240229", "claude-3-haiku-20240307"],
      "defaultModel": "claude-3-opus-20240229"
    },
    {
      "type": "anthropic-like",
      "name": "Internal Gateway",
      "baseUrl": "https://llm.company.example/v1/messages",
      "apiKey": "INTERNAL_TOKEN",
      "models": ["general-1", "research-2"]
    }
  ],
  "unifyChatProviders.activeProvider": "Anthropic",
  "unifyChatProviders.activeModel": "claude-3-opus-20240229"
}
```

- `type`: Provider type. Currently supports `anthropic-like` (default). Use this to enable future protocol variations without changing the schema.
- `name`: Human-friendly provider name.
- `baseUrl`: Endpoint URL for Anthropic-compatible chat messages.
- `apiKey`: Optional bearer token.
- `models`: List of supported models.
- `defaultModel`: Optional default model for the provider.

## Commands & UI

- **Unify Chat Providers: Add Provider** – Prompt-driven flow to add a provider and models.
- **Unify Chat Providers: Remove Provider** – Remove a configured provider.
- **Unify Chat Providers: Select Provider** – Choose which provider is active. The chat participant is re-registered automatically.
- **Unify Chat Providers: Select Model** – Pick the current model for the active provider.

After selecting a provider/model, open the VS Code chat view and start chatting with the registered participant. Requests are sent with Anthropic-compatible headers/body, and streaming responses are rendered as they arrive.

## Extensibility

The request pipeline is abstracted in `src/extension.ts` through the `AnthropicLikeClient` and a provider store. You can add new client implementations for other formats and swap them into the registration logic without changing command handling or configuration persistence.

## Development

- Build: `npm run compile`
- Watch: `npm run watch`

Contributions are welcome! The project is licensed under MIT.
