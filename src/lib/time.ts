export function formatDateTime(value: Date | null | undefined, timezone = "Europe/London"): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone
  }).format(value);
}
