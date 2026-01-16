import { randomUUID } from 'node:crypto';

const SESSION_ID = `-${Math.floor(Math.random() * 9_000_000_000_000_000)}`;

export function generateRequestId(): string {
  return `agent-${randomUUID()}`;
}

export function getSessionId(): string {
  return SESSION_ID;
}

export function mergeCommaSeparatedHeaderValues(values: string[]): string {
  const out: string[] = [];
  for (const raw of values) {
    for (const part of raw.split(',')) {
      const v = part.trim();
      if (!v) continue;
      if (!out.includes(v)) out.push(v);
    }
  }
  return out.join(',');
}
