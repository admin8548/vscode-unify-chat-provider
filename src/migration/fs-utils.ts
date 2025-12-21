import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

function stripSurroundingQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizeConfigFilePathInput(raw: string): string {
  const stripped = stripSurroundingQuotes(raw);
  if (stripped === '~') return os.homedir();
  if (stripped.startsWith('~/') || stripped.startsWith('~\\')) {
    return path.join(os.homedir(), stripped.slice(2));
  }
  return stripped;
}

export async function isExistingFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function firstExistingFilePath(
  candidates: readonly string[],
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isExistingFile(candidate)) return candidate;
  }
  return undefined;
}

