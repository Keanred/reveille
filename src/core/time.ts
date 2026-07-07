// A zone "day" is not always 24h (23h/25h on DST days) and all-day dates are floating calendar dates, not UTC instants.

export function zonedMidnight(dateStr: string, zone: string): number {
  const utcDate = new Date(`${dateStr}T00:00:00Z`);
  const formatter = Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(utcDate);

  const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const zonedDate = new Date(
    `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}:${partMap.second}Z`,
  );

  return utcDate.getTime() - (zonedDate.getTime() - utcDate.getTime());
}

export function zonedDateStr(instantMs: number, zone: string): string {
  const parts = Object.fromEntries(
    Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatClock(instantMs: number, zone: string, locale?: string): string {
  const formatter = Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(new Date(instantMs));
}

export function nextDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(ms / 1000)}s`;
}
