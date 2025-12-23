<p align="center">
<img src="./icon.png" style="width:100px;" />
</p>

<h1 align="center">
Unify Chat Provider
</h1>

<p align="center">
Integrate multiple LLM API providers into VS Code's Github Copilot Chat using the Language Model API.
</p>

<!-- <br>
<p align="center">
<a href="https://unocss.dev/">Documentation</a> |
<a href="https://unocss.dev/play/">Playground</a>
</p>
<br> -->

<br>
<p align="center">
<span>English</span> |
<a href="./README_zh-CN.md">简体中文</a>
</p>

## Introduction

To be supplemented...

## Contributing

- Build: `npm run compile`
- Watch: `npm run watch`
- Interactive release: `npm run release`

## Roadmap

- The `nativeTool` should include a configuration option within `ModelConfig`. In addition to `Default`, `Enable`, and `Disable`, add an `Auto` option that automatically selects the appropriate setting based on the model family. Also, include native tool implementations for various models to force a specific choice. Remove the related `Features`. Add the `Anthropic WebFetchTool` and ensure that citation content is handled correctly (it may not be displayed directly).
- The current Features use “Feature” as the key and should also use conditions to determine which Features should be enabled. In addition to boolean values, other types of data are also supported. So user can override the support of a Feature in the configuration.
- Precise thinking contents to reduce the amount of network data (OpenAIConciseReasoning and Anthropic thinking).
- Support monitoring of balance usage.
- Embedded functionality similar to [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).
- Context Indicator, official related issue：https://github.com/microsoft/vscode/issues/277871, https://github.com/microsoft/vscode/issues/277414
- Multilingual support.

## License

[MIT @ SmallMain](./LICENSE)
