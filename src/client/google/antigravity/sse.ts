export type SseEvent = {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
};

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  options?: { abortSignal?: AbortSignal },
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';

  const readChunk = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (options?.abortSignal?.aborted) {
      throw new Error('Aborted');
    }
    return reader.read();
  };

  try {
    while (true) {
      const result = await readChunk();
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });

      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary === -1) {
          break;
        }

        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const lines = raw.split(/\r?\n/);

        let dataParts: string[] = [];
        let event: string | undefined;
        let id: string | undefined;
        let retry: number | undefined;

        for (const line of lines) {
          if (!line || line.startsWith(':')) {
            continue;
          }

          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          const rawValue = colon === -1 ? '' : line.slice(colon + 1);
          const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

          switch (field) {
            case 'data':
              dataParts.push(value);
              break;
            case 'event':
              event = value;
              break;
            case 'id':
              id = value;
              break;
            case 'retry':
              {
                const parsed = Number(value);
                if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
                  retry = parsed;
                }
              }
              break;
            default:
              break;
          }
        }

        const data = dataParts.join('\n');
        if (data === '') {
          continue;
        }

        yield { data, event, id, retry };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
