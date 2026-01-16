import { getParamType } from './tool-schema-cache';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeJsonParse(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function recursivelyParseJsonStrings(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => recursivelyParseJsonStrings(item));
  }

  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = recursivelyParseJsonStrings(inner);
    }
    return out;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const stripped = value.trim();

  const hasControlCharEscapes = value.includes('\\n') || value.includes('\\t');
  const hasIntentionalEscapes = value.includes('\\"') || value.includes('\\\\');

  if (hasControlCharEscapes && !hasIntentionalEscapes) {
    try {
      const unescaped = safeJsonParse(`"${value.split('"').join('\\"')}"`);
      if (typeof unescaped === 'string') {
        return unescaped;
      }
    } catch {
    }
  }

  if (stripped && (stripped.startsWith('{') || stripped.startsWith('['))) {
    const isWellFormed =
      (stripped.startsWith('{') && stripped.endsWith('}')) ||
      (stripped.startsWith('[') && stripped.endsWith(']'));

    if (isWellFormed) {
      try {
        const parsed = safeJsonParse(value);
        return recursivelyParseJsonStrings(parsed);
      } catch {
      }
    }

    if (stripped.startsWith('[') && !stripped.endsWith(']')) {
      try {
        const lastBracket = stripped.lastIndexOf(']');
        if (lastBracket > 0) {
          const cleaned = stripped.slice(0, lastBracket + 1);
          const parsed = safeJsonParse(cleaned);
          return recursivelyParseJsonStrings(parsed);
        }
      } catch {
      }
    }

    if (stripped.startsWith('{') && !stripped.endsWith('}')) {
      try {
        const lastBrace = stripped.lastIndexOf('}');
        if (lastBrace > 0) {
          const cleaned = stripped.slice(0, lastBrace + 1);
          const parsed = safeJsonParse(cleaned);
          return recursivelyParseJsonStrings(parsed);
        }
      } catch {
      }
    }
  }

  return value;
}

function processEscapeSequencesOnly(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const hasControlCharEscapes = value.includes('\\n') || value.includes('\\t');
  const hasIntentionalEscapes = value.includes('\\"') || value.includes('\\\\');

  if (hasControlCharEscapes && !hasIntentionalEscapes) {
    try {
      const unescaped = JSON.parse(`"${value.split('"').join('\\"')}"`);
      if (typeof unescaped === 'string') {
        return unescaped;
      }
    } catch {
    }
  }

  return value;
}

export function normalizeToolCallArgs(args: unknown, toolName: string): unknown {
  if (!args || typeof args !== 'object') {
    return args;
  }

  const record = args as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    const expectedType = getParamType(toolName, key);

    if (expectedType === 'string') {
      result[key] = processEscapeSequencesOnly(value);
      continue;
    }

    if (
      typeof value === 'string' &&
      (expectedType === 'array' || expectedType === 'object')
    ) {
      try {
        result[key] = JSON.parse(value) as unknown;
      } catch {
        result[key] = processEscapeSequencesOnly(value);
      }
      continue;
    }

    if (expectedType === undefined) {
      result[key] = processEscapeSequencesOnly(value);
      continue;
    }

    result[key] = processEscapeSequencesOnly(value);
  }

  return result;
}

export function normalizeToolArgsInResponse(response: unknown): void {
  if (!response || typeof response !== 'object') {
    return;
  }

  const candidates = (response as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates)) {
    return;
  }

  for (const candidate of candidates) {
    const parts =
      (candidate as { content?: { parts?: unknown } } | undefined)?.content?.parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      const record = isRecord(part) ? part : undefined;
      if (!record) {
        continue;
      }

      const functionCall = record.functionCall;
      if (functionCall && isRecord(functionCall) && 'args' in functionCall) {
        const beforeArgs = functionCall.args;
        const name =
          typeof functionCall.name === 'string' ? functionCall.name : undefined;
        if (name) {
          functionCall.args = normalizeToolCallArgs(beforeArgs, name);
        }
      }

      const functionResponse = record.functionResponse;
      if (functionResponse && isRecord(functionResponse) && 'response' in functionResponse) {
        functionResponse.response = recursivelyParseJsonStrings(functionResponse.response);
      }
    }
  }
}
