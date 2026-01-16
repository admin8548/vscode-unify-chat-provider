import { createHash } from 'node:crypto';
import type { AntigravityModelFamily } from './transform/types';

const signatureCache = new Map<string, string>();

function normalizeThoughtText(text: string): string {
  return text.trim();
}

function getSignatureKey(
  family: AntigravityModelFamily,
  sessionId: string,
  thoughtText: string,
): string {
  const normalizedText = normalizeThoughtText(thoughtText);
  const input = `${family}:${sessionId}:${normalizedText}`;
  return createHash('sha256').update(input).digest('hex');
}

export function cacheThoughtSignature(
  family: AntigravityModelFamily,
  sessionId: string,
  thoughtText: string,
  signature: string,
): void {
  signatureCache.set(getSignatureKey(family, sessionId, thoughtText), signature);
}

export function getCachedThoughtSignature(
  family: AntigravityModelFamily,
  sessionId: string,
  thoughtText: string,
): string | undefined {
  return signatureCache.get(getSignatureKey(family, sessionId, thoughtText));
}

