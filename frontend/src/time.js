// Timestamps are stored in UTC and shown in the browser's time zone
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

export function formatDateTime(value) {
  return format(value, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(value) {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 }).format(value);
}
