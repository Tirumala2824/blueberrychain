import { describe, expect, it } from "vitest";
import { SseParser, formatSse, readSse, type SseEvent } from "./sse.js";

function parse(chunks: string[]): SseEvent[] {
  const out: SseEvent[] = [];
  const parser = new SseParser((e) => out.push(e));
  for (const c of chunks) parser.push(c);
  parser.end();
  return out;
}

describe("SSE parser", () => {
  it("parses events split at any point, including inside a CRLF", () => {
    const stream = "event: response.text.delta\r\ndata: {\"text\":\"Hel\"}\r\n\r\nid: 7\r\ndata: a\r\ndata: b\r\n\r\n";
    const whole = parse([stream]);
    expect(whole).toEqual([
      { event: "response.text.delta", data: '{"text":"Hel"}', id: null, retry: null },
      { event: "message", data: "a\nb", id: "7", retry: null },
    ]);
    for (let cut = 1; cut < stream.length; cut++) expect(parse([stream.slice(0, cut), stream.slice(cut)])).toEqual(whole);
    expect(parse([...stream])).toEqual(whole);
  });

  it("ignores comments, keeps the last id and reads retry", () => {
    expect(parse([": keep-alive\n", "retry: 3000\nid: 1\ndata: x\n\n", "data: y\n\n"])).toEqual([
      { event: "message", data: "x", id: "1", retry: 3000 },
      { event: "message", data: "y", id: "1", retry: 3000 },
    ]);
  });

  it("drops an event that never got its blank line", () => {
    expect(parse(["data: complete\n\n", "data: partial"])).toEqual([{ event: "message", data: "complete", id: null, retry: null }]);
  });

  it("reads a fetch body stream", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("event: status\ndata: {\"status\":\"planning\"}\n"));
        controller.enqueue(enc.encode("\nevent: done\ndata: [DONE]\n\n"));
        controller.close();
      },
    });
    const events: SseEvent[] = [];
    for await (const e of readSse(body)) events.push(e);
    expect(events.map((e) => e.event)).toEqual(["status", "done"]);
  });

  it("formats multi-line data as separate data lines and round-trips", () => {
    const text = formatSse({ event: "agent.trace", id: "3", data: "line 1\nline 2" });
    expect(text).toBe("id: 3\nevent: agent.trace\ndata: line 1\ndata: line 2\n\n");
    expect(parse([text])).toEqual([{ event: "agent.trace", data: "line 1\nline 2", id: "3", retry: null }]);
  });
});
