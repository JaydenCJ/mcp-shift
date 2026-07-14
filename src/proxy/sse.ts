/** Minimal Server-Sent Events framing (parser + serializer). */

export interface SseEvent {
  event?: string;
  data: string;
  id?: string;
}

/** Incremental SSE parser: feed chunks, get complete events. */
export class SseParser {
  private buffer = '';

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    // Normalize CRLF; events are separated by a blank line.
    let sepIndex: number;
    while ((sepIndex = this.buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = this.buffer.slice(0, sepIndex);
      const sepMatch = /\r?\n\r?\n/.exec(this.buffer.slice(sepIndex));
      this.buffer = this.buffer.slice(sepIndex + (sepMatch ? sepMatch[0].length : 2));
      const event = parseEventBlock(raw);
      if (event) events.push(event);
    }
    return events;
  }
}

function parseEventBlock(block: string): SseEvent | undefined {
  const lines = block.split(/\r?\n/);
  let eventName: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];
  let sawField = false;
  for (const line of lines) {
    if (line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    if (colon === -1) {
      if (line.length > 0) {
        sawField = true;
        continue;
      }
      continue;
    }
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    sawField = true;
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
  }
  if (!sawField || dataLines.length === 0) return undefined;
  const event: SseEvent = { data: dataLines.join('\n') };
  if (eventName !== undefined) event.event = eventName;
  if (id !== undefined) event.id = id;
  return event;
}

export function serializeSseEvent(event: SseEvent): string {
  let out = '';
  if (event.event) out += `event: ${event.event}\n`;
  if (event.id) out += `id: ${event.id}\n`;
  for (const line of event.data.split('\n')) {
    out += `data: ${line}\n`;
  }
  return out + '\n';
}

export function sseComment(text: string): string {
  return `: ${text}\n\n`;
}
