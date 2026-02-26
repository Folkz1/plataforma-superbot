type SortableMessage = {
  direction?: string | null;
  created_at?: string | null;
  raw_payload?: unknown;
};

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

function parseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return null;
}

function extractMessageTimestamp(message: SortableMessage): number {
  const raw = message.raw_payload;
  const direction = String(message.direction || '').toLowerCase();

  // Outbound/system events often carry inbound timestamps in raw_payload.
  // Prioritize DB `created_at` so burst replies keep real send order.
  const outboundCandidates = [
    message.created_at,
    readPath(raw, ['timestamp']),
    readPath(raw, ['sent', 'timestamp']),
    readPath(raw, ['entry', 0, 'time']),
    readPath(raw, ['entry', 0, 'messaging', 0, 'timestamp']),
  ];

  const inboundCandidates = [
    readPath(raw, ['timestamp']),
    readPath(raw, ['sent', 'timestamp']),
    readPath(raw, ['entry', 0, 'time']),
    readPath(raw, ['entry', 0, 'messaging', 0, 'timestamp']),
    message.created_at,
  ];

  const candidates = direction === 'in' ? inboundCandidates : outboundCandidates;

  for (const candidate of candidates) {
    const ts = parseTimestamp(candidate);
    if (ts !== null) return ts;
  }

  return 0;
}

export function sortMessagesChronologically<T extends SortableMessage>(messages: T[] = []): T[] {
  return messages
    .map((message, index) => ({
      message,
      index,
      ts: extractMessageTimestamp(message),
    }))
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.index - b.index;
    })
    .map((item) => item.message);
}
