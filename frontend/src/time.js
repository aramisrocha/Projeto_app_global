// Records are stored in UTC; they are shown in the employee's time zone when it is valid
function format(value, options, timeZone, locale = "pt-BR") {
  const date = value instanceof Date ? value : new Date(value);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

export function formatTime(value, timeZone, withSeconds = false) {
  return format(
    value,
    { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) },
    timeZone
  );
}

export function formatLongDate(value, timeZone) {
  const text = format(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, timeZone);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDayLabel(value, timeZone) {
  return format(value, { weekday: "short", day: "2-digit", month: "short" }, timeZone);
}

// yyyy-mm-dd in the given time zone, used to group records by day
export function dayKey(value, timeZone) {
  return format(value, { year: "numeric", month: "2-digit", day: "2-digit" }, timeZone, "en-CA");
}

// Sums IN→OUT pairs; an open IN counts until now
export function workedMs(recordsAscending, now = new Date()) {
  let total = 0;
  let openedAt = null;
  for (const record of recordsAscending) {
    const at = new Date(record.timestampUtc).getTime();
    if (record.type === "IN") {
      openedAt = at;
    } else if (record.type === "OUT" && openedAt !== null) {
      total += at - openedAt;
      openedAt = null;
    }
  }
  if (openedAt !== null) total += Math.max(0, now.getTime() - openedAt);
  return total;
}

export function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}`;
}

// Newest day first; records inside each day oldest first
export function groupByDay(records, timeZone, now = new Date()) {
  const groups = new Map();
  for (const record of records) {
    const key = dayKey(record.timestampUtc, timeZone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const todayKey = dayKey(now, timeZone);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, items]) => {
      const ascending = [...items].sort((a, b) => (a.timestampUtc < b.timestampUtc ? -1 : 1));
      // A day that is over and still has an open IN does not keep counting
      const until = key === todayKey ? now : new Date(ascending[ascending.length - 1].timestampUtc);
      return {
        key,
        label: formatDayLabel(ascending[0].timestampUtc, timeZone),
        records: ascending,
        workedMs: workedMs(ascending, until),
      };
    });
}
