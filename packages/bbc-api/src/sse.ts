/**
 * Incremental Server-Sent Events parser (WHATWG event-stream rules): chunks may split
 * anywhere, including between the CR and LF of a line break; `data` lines concatenate
 * with "\n"; lines starting with ":" are comments. Used for Cortex Agent runs and for
 * the engine's trace relay.
 */

export interface SseEvent {
  /** Event type ("message" when the stream didn't name one). */
  event: string;
  data: string;
  /** The last event id seen on the stream (carried forward, as browsers do). */
  id: string | null;
  retry: number | null;
}

export class SseParser {
  private buffer = "";
  private skipLf = false;
  private dataLines: string[] = [];
  private eventType = "";
  private lastId: string | null = null;
  private retry: number | null = null;

  constructor(private readonly onEvent: (event: SseEvent) => void) {}

  push(chunk: string): void {
    let text = chunk;
    if (this.skipLf && text.startsWith("\n")) text = text.slice(1);
    this.skipLf = false;
    this.buffer += text;
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // A lone CR at the very end may be the first half of a CRLF split across chunks.
      if (match[0] === "\r" && match.index === this.buffer.length - 1) {
        this.line(this.buffer.slice(0, match.index));
        this.buffer = "";
        this.skipLf = true;
        break;
      }
      this.line(this.buffer.slice(0, match.index));
      this.buffer = this.buffer.slice(match.index + match[0].length);
    }
  }

  /** End of stream: an event without its terminating blank line is discarded (per spec). */
  end(): void {
    this.buffer = "";
    this.dataLines = [];
    this.eventType = "";
  }

  private line(line: string): void {
    if (line === "") {
      if (this.dataLines.length) {
        this.onEvent({ event: this.eventType || "message", data: this.dataLines.join("\n"), id: this.lastId, retry: this.retry });
      }
      this.dataLines = [];
      this.eventType = "";
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventType = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
  }
}

/** Read a fetch body as SSE events. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const queue: SseEvent[] = [];
  const parser = new SseParser((event) => queue.push(event));
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      while (queue.length) yield queue.shift() as SseEvent;
    }
    parser.push(decoder.decode());
    parser.end();
    while (queue.length) yield queue.shift() as SseEvent;
  } finally {
    reader.releaseLock();
  }
}

/** Serialize one event for an SSE response (multi-line data split into data lines). */
export function formatSse(event: { event?: string; data: string; id?: string }): string {
  const lines: string[] = [];
  if (event.id !== undefined) lines.push(`id: ${event.id}`);
  if (event.event) lines.push(`event: ${event.event}`);
  for (const part of event.data.split(/\r\n|\r|\n/)) lines.push(`data: ${part}`);
  return `${lines.join("\n")}\n\n`;
}
