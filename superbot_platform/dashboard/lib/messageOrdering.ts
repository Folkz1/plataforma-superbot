type SortableMessage = {
  direction?: string | null;
  message_type?: string | null;
  created_at?: string | null;
  raw_payload?: unknown;
};

function parseIsoTimestampToMicros(value: string): number | null {
  // Expected formats (FastAPI/Pydantic):
  // - 2026-02-26T19:30:46.123456+00:00
  // - 2026-02-26T19:30:46.123Z
  // - 2026-02-26T19:30:46Z
  // We parse manually to preserve microseconds (Date.parse truncates to ms).
  const match = value.trim().match(
    // Accept: Z, +hh:mm, +hhmm, or no timezone (assume UTC).
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }

  const fraction = match[7] || '';
  const tz = match[8] || 'Z';

  const padded = (fraction + '000000').slice(0, 6);
  const micros = Number(padded || '0');
  if (!Number.isFinite(micros)) return null;

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  if (!Number.isFinite(utcMs)) return null;

  if (tz !== 'Z') {
    const tzMatch = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!tzMatch) return null;
    const sign = tzMatch[1] === '-' ? -1 : 1;
    const tzHours = Number(tzMatch[2]);
    const tzMinutes = Number(tzMatch[3]);
    if (!Number.isFinite(tzHours) || !Number.isFinite(tzMinutes)) return null;
    const offsetMs = sign * ((tzHours * 60 + tzMinutes) * 60 * 1000);
    // Input is local time at offset; convert to UTC.
    utcMs -= offsetMs;
  }

  return utcMs * 1000 + micros;
}

function readPath(value: unknown, path: Array<string | number>): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(current) || key < 0 || key >= current.length) return undefined;
      current = current[key];
      continue;
    }

    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function extractTiebreakId(message: SortableMessage): string | null {
  const raw = message.raw_payload;

  const candidates = [
    // WhatsApp Cloud API: response contains messages[0].id
    readPath(raw, ['result', 'messages', 0, 'id']),
    readPath(raw, ['messages', 0, 'id']),

    // Messenger/Instagram: response contains message_id
    readPath(raw, ['result', 'message_id']),
    readPath(raw, ['result', 'messageId']),
    readPath(raw, ['message_id']),
    readPath(raw, ['messageId']),

    // Generic fallbacks
    readPath(raw, ['id']),
    readPath(raw, ['sent', 'id']),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }

  return null;
}

function parseTimestampMicros(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Accept seconds/ms/micros.
    if (value > 100_000_000_000_000) return Math.round(value); // micros
    if (value > 100_000_000_000) return Math.round(value * 1000); // ms -> micros
    return Math.round(value * 1_000_000); // sec -> micros
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') {
      if (numeric > 100_000_000_000_000) return Math.round(numeric); // micros
      if (numeric > 100_000_000_000) return Math.round(numeric * 1000); // ms -> micros
      return Math.round(numeric * 1_000_000); // sec -> micros
    }

    const isoMicros = parseIsoTimestampToMicros(value);
    if (isoMicros !== null) return isoMicros;

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed * 1000; // ms -> micros
  }

  return null;
}

function extractMessageTimestampMicros(message: SortableMessage): number {
  const raw = message.raw_payload;

  // Always prefer DB `created_at` as the canonical ordering key.
  // Raw payload timestamps can be coarse (seconds) and may be reused across
  // multiple outbound messages, which breaks burst ordering.
  const candidates = [
    message.created_at,
    readPath(raw, ['timestamp']),
    readPath(raw, ['sent', 'timestamp']),
    readPath(raw, ['entry', 0, 'time']),
    readPath(raw, ['entry', 0, 'messaging', 0, 'timestamp']),
  ];

  for (const candidate of candidates) {
    const ts = parseTimestampMicros(candidate);
    if (ts !== null) return ts;
  }

  return 0;
}

export function sortMessagesChronologically<T extends SortableMessage>(messages: T[] = []): T[] {
  const ordered = messages
    .map((message, index) => ({
      message,
      index,
      ts: extractMessageTimestampMicros(message),
      tie: extractTiebreakId(message),
    }))
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.tie && b.tie && a.tie !== b.tie) return a.tie < b.tie ? -1 : 1;
      return a.index - b.index;
    })

  return ordered.map((item) => item.message);
}

function isWhatsappBurstCandidate(item: {
  message: SortableMessage;
  ts: number;
}): boolean {
  const direction = String(item.message.direction || '').toLowerCase();
  if (direction !== 'out') return false;

  const messageType = String(item.message.message_type || '').toLowerCase();
  if (messageType === 'human_reply' || messageType === 'status_change') return false;

  // Ignore invalid timestamps.
  if (!Number.isFinite(item.ts) || item.ts <= 0) return false;
  return true;
}

export function sortMessagesForChannel<T extends SortableMessage>(
  messages: T[] = [],
  channelType?: string | null
): T[] {
  const base = messages
    .map((message, index) => ({
      message,
      index,
      ts: extractMessageTimestampMicros(message),
      tie: extractTiebreakId(message),
    }))
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.tie && b.tie && a.tie !== b.tie) return a.tie < b.tie ? -1 : 1;
      return a.index - b.index;
    });

  if (String(channelType || '').toLowerCase() !== 'whatsapp') {
    return base.map((item) => item.message);
  }

  // WhatsApp-specific render fix:
  // some outbound burst logs are persisted in reverse textual order while
  // timestamps stay within the same second. Reorder only these tight bursts.
  const fixed = [...base];
  let cursor = 0;

  while (cursor < fixed.length) {
    const current = fixed[cursor];
    if (!isWhatsappBurstCandidate(current)) {
      cursor += 1;
      continue;
    }

    const baseSecond = Math.floor(current.ts / 1_000_000);
    let end = cursor + 1;

    while (end < fixed.length) {
      const next = fixed[end];
      if (!isWhatsappBurstCandidate(next)) break;
      const nextSecond = Math.floor(next.ts / 1_000_000);
      if (nextSecond !== baseSecond) break;
      end += 1;
    }

    const size = end - cursor;
    if (size >= 2) {
      const firstTs = fixed[cursor].ts;
      const lastTs = fixed[end - 1].ts;
      // Only flip very tight bot bursts (<= 1 second window) to avoid
      // affecting normal sequential agent messages.
      if (lastTs - firstTs <= 1_000_000) {
        const reversed = fixed.slice(cursor, end).reverse();
        fixed.splice(cursor, size, ...reversed);
      }
    }

    cursor = end;
  }

  return fixed.map((item) => item.message);
}
