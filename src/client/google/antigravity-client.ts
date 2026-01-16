import * as vscode from 'vscode';
import type { ModelConfig, PerformanceTrace, ProviderConfig } from '../../types';
import type { RequestLogger } from '../../logger';
import type { AuthTokenInfo } from '../../auth/types';
import { FeatureId } from '../definitions';
import {
  createCustomFetch,
  createFirstTokenRecorder,
  getToken,
  getUnifiedUserAgent,
  isFeatureSupported,
  mergeHeaders,
  setUserAgentHeader,
} from '../utils';
import { DEFAULT_TIMEOUT_CONFIG, withIdleTimeout } from '../../utils';
import { getBaseModelId } from '../../model-id-utils';
import { createSimpleHttpLogger } from '../../logger';
import { encodeStatefulMarkerPart } from '../../utils';

import { parseSseStream } from './antigravity/sse';
import { sseEventToGenerateContentResponse } from './antigravity/stream-adapter';
import { normalizeToolArgsInResponse } from './antigravity/normalize-tool-args';
import { parseGeminiApiBody, rewriteGeminiPreviewAccessError, rewriteGeminiRateLimitError } from './antigravity/request-helpers';
import { cacheThoughtSignature } from './antigravity/thought-signature-cache';
import { GoogleAIStudioProvider } from './ai-studio-client';
import {
  CODE_ASSIST_ENDPOINT_FALLBACKS,
  CODE_ASSIST_HEADERS,
  isClaudeThinkingModel,
  isClaudeModel,
} from './antigravity/constants';
import { generateRequestId, getSessionId, mergeCommaSeparatedHeaderValues } from './antigravity/utils';
import { resolveOriginalToolName } from './antigravity/tool-schema-cache';
import { transformClaudeRequest, transformGeminiRequest } from './antigravity/transform/index.js';

type AntigravityWrappedBody = {
  project: string;
  model: string;
  userAgent: string;
  requestType: string;
  requestId: string;
  request: Record<string, unknown>;
};

function getProjectIdFromProviderConfig(config: ProviderConfig): string {
  const auth = config.auth;
  if (auth && auth.method === 'antigravity-oauth') {
    return auth.projectId?.trim() || '';
  }
  return '';
}

type AntigravityModelFamily = 'claude' | 'gemini-flash' | 'gemini-pro';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatAntigravityHttpError(
  status: number,
  rawText: string,
  requestedModel?: string,
): string {
  const parsed = parseGeminiApiBody(rawText);
  if (!parsed) {
    return rawText;
  }

  const previewFixed = rewriteGeminiPreviewAccessError(parsed, status, requestedModel) ?? null;
  const rateLimitFixed =
    previewFixed === null ? rewriteGeminiRateLimitError(parsed) : null;
  const patched = previewFixed ?? rateLimitFixed ?? parsed;

  const message = patched.error?.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : rawText;
}

function unwrapAntigravityResponseBody(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    const first = payload.find((item): item is Record<string, unknown> => isRecord(item));
    return unwrapAntigravityResponseBody(first);
  }
  if (!isRecord(payload)) {
    return payload;
  }
  const response = payload['response'];
  return response !== undefined ? response : payload;
}

function unsanitizeToolNamesInResponseBody(payload: unknown): void {
  if (!isRecord(payload)) {
    return;
  }

  const candidates = payload['candidates'];
  if (!Array.isArray(candidates)) {
    return;
  }

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;

    const content = candidate['content'];
    if (!isRecord(content)) continue;

    const parts = content['parts'];
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!isRecord(part)) continue;

      const functionCall = part['functionCall'];
      if (isRecord(functionCall) && typeof functionCall['name'] === 'string') {
        functionCall['name'] = resolveOriginalToolName(functionCall['name']);
      }

      const functionResponse = part['functionResponse'];
      if (isRecord(functionResponse) && typeof functionResponse['name'] === 'string') {
        functionResponse['name'] = resolveOriginalToolName(functionResponse['name']);
      }
    }
  }
}

function cacheThoughtSignatureFromResponseBody(
  payload: unknown,
  options: { family: AntigravityModelFamily; sessionId: string; thoughtBuffer?: { text: string } },
): void {
  if (!isRecord(payload)) {
    return;
  }

  const candidates = payload['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return;
  }

  const candidate = candidates[0];
  if (!isRecord(candidate)) {
    return;
  }

  const content = candidate['content'];
  if (!isRecord(content)) {
    return;
  }

  const parts = content['parts'];
  if (!Array.isArray(parts)) {
    return;
  }

  const buffer = options.thoughtBuffer ?? { text: '' };

  for (const part of parts) {
    if (!isRecord(part)) continue;

    const isThought = part['thought'] === true;
    const text = typeof part['text'] === 'string' ? part['text'] : undefined;
    if (isThought && text) {
      buffer.text += text;
    }

    const signature =
      typeof part['thoughtSignature'] === 'string' ? part['thoughtSignature'] : undefined;

    if (signature && buffer.text.trim().length > 0) {
      cacheThoughtSignature(options.family, options.sessionId, buffer.text, signature);
    }
  }
}

export class GoogleAntigravityProvider extends GoogleAIStudioProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  protected buildHeaders(
    credential?: AuthTokenInfo,
    modelConfig?: ModelConfig,
  ): Record<string, string> {
    const credentialValue = getToken(credential);

    const headers = mergeHeaders(
      undefined,
      this.config.extraHeaders,
      modelConfig?.extraHeaders,
    );

    if (credentialValue) {
      headers['Authorization'] = `Bearer ${credentialValue}`;
    }

    setUserAgentHeader(headers, getUnifiedUserAgent());

    headers['User-Agent'] = CODE_ASSIST_HEADERS['User-Agent'];
    headers['X-Goog-Api-Client'] = CODE_ASSIST_HEADERS['X-Goog-Api-Client'];
    headers['Client-Metadata'] = CODE_ASSIST_HEADERS['Client-Metadata'];

    if (modelConfig && isClaudeThinkingModel(modelConfig.id)) {
      const existing = headers['anthropic-beta'];
      const combined = mergeCommaSeparatedHeaderValues([
        ...(existing ? [existing] : []),
        'interleaved-thinking-2025-05-14',
      ]);
      headers['anthropic-beta'] = combined;
    }

    return headers;
  }

  private mapThinkingEffortToLevelString(
    effort: NonNullable<NonNullable<ModelConfig['thinking']>['effort']>,
  ): string {
    switch (effort) {
      case 'minimal':
        return 'minimal';
      case 'low':
        return 'low';
      case 'medium':
        return 'medium';
      case 'high':
      case 'xhigh':
        return 'high';
      case 'none':
        return 'minimal';
    }
  }

  private buildThinkingConfigForAntigravity(
    model: ModelConfig,
    useThinkingLevel: boolean,
  ): Record<string, unknown> | undefined {
    const thinking = model.thinking;
    if (!thinking) {
      return undefined;
    }

    if (thinking.type === 'disabled' || thinking.effort === 'none') {
      return useThinkingLevel
        ? { includeThoughts: false, thinkingLevel: 'minimal' }
        : { includeThoughts: false, thinkingBudget: 0 };
    }

    const out: Record<string, unknown> = {
      includeThoughts: true,
    };

    if (thinking.effort) {
      out['thinkingLevel'] = this.mapThinkingEffortToLevelString(thinking.effort);
    }

    if (thinking.budgetTokens !== undefined) {
      out['thinkingBudget'] = thinking.budgetTokens;
    } else {
      out['thinkingBudget'] = -1;
    }

    if (useThinkingLevel) {
      delete out['thinkingBudget'];
    } else {
      delete out['thinkingLevel'];
    }

    return out;
  }

  private buildGenerationConfig(
    model: ModelConfig,
    useThinkingLevel: boolean,
  ): Record<string, unknown> | undefined {
    const out: Record<string, unknown> = {};

    if (model.temperature !== undefined) out['temperature'] = model.temperature;
    if (model.topP !== undefined) out['topP'] = model.topP;
    if (model.topK !== undefined) out['topK'] = model.topK;
    if (model.maxOutputTokens !== undefined) out['maxOutputTokens'] = model.maxOutputTokens;
    if (model.presencePenalty !== undefined) out['presencePenalty'] = model.presencePenalty;
    if (model.frequencyPenalty !== undefined) out['frequencyPenalty'] = model.frequencyPenalty;

    const thinkingConfig = this.buildThinkingConfigForAntigravity(model, useThinkingLevel);
    if (thinkingConfig) out['thinkingConfig'] = thinkingConfig;

    return Object.keys(out).length > 0 ? out : undefined;
  }

  private getModelFamily(modelId: string): AntigravityModelFamily {
    if (isClaudeModel(modelId)) {
      return 'claude';
    }
    return modelId.includes('flash') ? 'gemini-flash' : 'gemini-pro';
  }

  private wrapRequestBody(
    modelId: string,
    payload: Record<string, unknown>,
    streaming: boolean,
  ): AntigravityWrappedBody {
    const projectId = getProjectIdFromProviderConfig(this.config);
    const requestId = generateRequestId();
    const sessionId = getSessionId();

    const ctx = {
      model: modelId,
      family: this.getModelFamily(modelId),
      projectId,
      streaming,
      requestId,
      sessionId,
    };

    const transformed = isClaudeModel(modelId)
      ? transformClaudeRequest(ctx, payload)
      : transformGeminiRequest(ctx, payload);

    return JSON.parse(transformed.body) as AntigravityWrappedBody;
  }

  async *streamChat(
    encodedModelId: string,
    model: ModelConfig,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    performanceTrace: PerformanceTrace,
    token: vscode.CancellationToken,
    logger: RequestLogger,
    credential: AuthTokenInfo,
  ): AsyncGenerator<vscode.LanguageModelResponsePart2> {
    const abortController = new AbortController();
    const cancellationListener = token.onCancellationRequested(() => {
      abortController.abort();
    });

    if (token.isCancellationRequested) {
      abortController.abort();
      cancellationListener.dispose();
      return;
    }

    const useThinkingLevel = isFeatureSupported(
      FeatureId.GeminiUseThinkingLevel,
      this.config,
      model,
    );

    const { systemInstruction: convertedSystemInstruction, contents } =
      this.convertMessages(encodedModelId, messages);

    const tools = this.convertTools(options.tools);

    const functionCallingConfig = this.buildFunctionCallingConfig(
      options.toolMode,
      tools,
    );

    const toolConfigPayload = functionCallingConfig
      ? { toolConfig: { functionCallingConfig } }
      : undefined;

    const streamEnabled = model.stream ?? true;

    const generationConfig = this.buildGenerationConfig(model, useThinkingLevel);
    const extraBody = this.buildExtraBody(model);

    const requestPayload: Record<string, unknown> = {
      ...extraBody,
      contents,
      ...(convertedSystemInstruction
        ? { systemInstruction: convertedSystemInstruction }
        : {}),
      ...(tools ? { tools } : {}),
      ...(toolConfigPayload ?? {}),
      ...(generationConfig ? { generationConfig } : {}),
    };

    performanceTrace.ttf = Date.now() - performanceTrace.tts;

    try {
      if (streamEnabled) {
        const responseTimeoutMs =
          this.config.timeout?.response ?? DEFAULT_TIMEOUT_CONFIG.response;

        const wrappedBody = this.wrapRequestBody(
          getBaseModelId(model.id),
          requestPayload,
          true,
        );

        const httpLogger = createSimpleHttpLogger({
          purpose: 'Antigravity streamGenerateContent',
          providerName: this.config.name,
          providerType: this.config.type,
        });

        const connectionTimeoutMs =
          this.config.timeout?.connection ?? DEFAULT_TIMEOUT_CONFIG.connection;

        const customFetch = createCustomFetch({
          connectionTimeoutMs,
          logger: httpLogger,
        });

        let response: Response | undefined;
        let lastError: string | undefined;

        for (const baseUrl of CODE_ASSIST_ENDPOINT_FALLBACKS) {
          const endpoint = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
          try {
            const r = await customFetch(endpoint, {
              method: 'POST',
              headers: {
                ...this.buildHeaders(credential, model),
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
              },
              body: JSON.stringify(wrappedBody),
              signal: abortController.signal,
            });

            if (r.ok && r.body) {
              response = r;
              break;
            }

            const text = await r.text().catch(() => '');
            const message = formatAntigravityHttpError(r.status, text, model.id);
            lastError = `HTTP ${r.status} ${message}`.trim();
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }

        if (!response) {
          throw new Error(`Antigravity request failed: ${lastError ?? 'Unknown error'}`);
        }

        const body = response.body;
        if (!body) {
          throw new Error('Missing response body');
        }

        const rawEvents = parseSseStream(body, { abortSignal: abortController.signal });

        const family = this.getModelFamily(getBaseModelId(model.id));
        const sessionId = getSessionId();
        const thoughtBuffer = { text: '' };

        const adapted = (async function* () {
          for await (const event of rawEvents) {
            const chunk = sseEventToGenerateContentResponse(event);
            if (chunk) {
              normalizeToolArgsInResponse(chunk);
              unsanitizeToolNamesInResponseBody(chunk);
              cacheThoughtSignatureFromResponseBody(chunk, { family, sessionId, thoughtBuffer });
              yield chunk;
            }
          }
        })();

        const timedStream = withIdleTimeout(
          adapted,
          responseTimeoutMs,
          abortController.signal,
        );

        const recordFirstToken = createFirstTokenRecorder(performanceTrace);

        const parsed = this.parseMessageStream(
          (async function* () {
            for await (const chunk of timedStream) {
              recordFirstToken();
              yield chunk;
            }
          })(),
          token,
          logger,
          performanceTrace,
        );

        for await (const part of parsed) {
          yield part;
        }

        return;
      }

      const wrappedBody = this.wrapRequestBody(
        getBaseModelId(model.id),
        requestPayload,
        false,
      );

      const connectionTimeoutMs =
        this.config.timeout?.connection ?? DEFAULT_TIMEOUT_CONFIG.connection;

      const httpLogger = createSimpleHttpLogger({
        purpose: 'Antigravity generateContent',
        providerName: this.config.name,
        providerType: this.config.type,
      });

      const customFetch = createCustomFetch({
        connectionTimeoutMs,
        logger: httpLogger,
      });

      let response: Response | undefined;
      let lastError: string | undefined;

      for (const baseUrl of CODE_ASSIST_ENDPOINT_FALLBACKS) {
        const endpoint = `${baseUrl}/v1internal:generateContent`;
        try {
          const r = await customFetch(endpoint, {
            method: 'POST',
            headers: {
              ...this.buildHeaders(credential, model),
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(wrappedBody),
            signal: abortController.signal,
          });

          if (r.ok) {
            response = r;
            break;
          }

          const text = await r.text().catch(() => '');
          const message = formatAntigravityHttpError(r.status, text, model.id);
          lastError = `HTTP ${r.status} ${message}`.trim();
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!response) {
        throw new Error(`Antigravity request failed: ${lastError ?? 'Unknown error'}`);
      }

      const r = response;

      const responsePayload: unknown = await r.json();
      const effectiveResponse = unwrapAntigravityResponseBody(responsePayload);

      normalizeToolArgsInResponse(effectiveResponse);
      unsanitizeToolNamesInResponseBody(effectiveResponse);
      cacheThoughtSignatureFromResponseBody(effectiveResponse, {
        family: this.getModelFamily(getBaseModelId(model.id)),
        sessionId: getSessionId(),
      });

      const parsed = this.parseMessage(
        effectiveResponse as Parameters<GoogleAntigravityProvider['parseMessage']>[0],
        performanceTrace,
        logger,
      );

      for await (const part of parsed) {
        yield part;
      }

      yield encodeStatefulMarkerPart([]);
    } finally {
      cancellationListener.dispose();
    }
  }
}
