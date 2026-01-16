import type { Content, GenerateContentResponse, Part } from '@google/genai';
import type { SseEvent } from './sse';

type Candidate = NonNullable<GenerateContentResponse['candidates']>[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonOrNull(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw);

    const firstObject = Array.isArray(parsed)
      ? parsed.find((item): item is Record<string, unknown> => isRecord(item))
      : isRecord(parsed)
        ? parsed
        : undefined;

    if (firstObject && isRecord(firstObject['response'])) {
      return firstObject['response'];
    }

    return firstObject ?? parsed;
  } catch {
    return null;
  }
}

function buildMinimalResponseFromParts(parts: Part[], usage?: unknown): GenerateContentResponse {
  const candidate: Candidate = {
    index: 0,
    content: {
      role: 'model',
      parts,
    } as Content,
    finishReason: undefined,
    safetyRatings: undefined,
  };

  const response: GenerateContentResponse = {
    candidates: [candidate],
    usageMetadata: isRecord(usage) ? (usage as unknown as GenerateContentResponse['usageMetadata']) : undefined,
  } as GenerateContentResponse;

  return response;
}

function extractPartsFromUnknown(payload: unknown): Part[] {
  if (!isRecord(payload)) {
    return [];
  }

  const candidates = payload['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const first = candidates[0];
  if (!isRecord(first)) {
    return [];
  }

  const content = first['content'];
  if (!isRecord(content)) {
    return [];
  }

  const parts = content['parts'];
  if (!Array.isArray(parts)) {
    return [];
  }

  const out: Part[] = [];
  for (const part of parts) {
    if (isRecord(part)) {
      out.push(part as unknown as Part);
    }
  }
  return out;
}

function extractUsageFromUnknown(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return undefined;
  }
  return payload['usageMetadata'];
}

export function sseEventToGenerateContentResponse(event: SseEvent): GenerateContentResponse | null {
  const json = parseJsonOrNull(event.data);
  if (!json) {
    return null;
  }

  const parts = extractPartsFromUnknown(json);
  if (parts.length === 0) {
    return null;
  }

  const usage = extractUsageFromUnknown(json);
  return buildMinimalResponseFromParts(parts, usage);
}
