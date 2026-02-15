function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildDialForwardTwiml(input: {
  forwardToPhoneNumber: string;
  statusCallbackUrl: string;
  timeoutSeconds?: number;
}): string {
  const timeout = input.timeoutSeconds ?? 20;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Dial timeout="${timeout}" action="${escapeXml(input.statusCallbackUrl)}" method="POST">` +
    `<Number>${escapeXml(input.forwardToPhoneNumber)}</Number>` +
    `</Dial>` +
    `</Response>`
  );
}

export function buildEmptyTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
