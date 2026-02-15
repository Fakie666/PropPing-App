import twilio from "twilio";

export type SmsSendInput = {
  to: string;
  from: string;
  body: string;
};

export type SmsSendResult = {
  sid: string;
  provider: "twilio" | "mock";
};

type SmsSender = {
  sendSms(input: SmsSendInput): Promise<SmsSendResult>;
};

let testSenderOverride: SmsSender | null = null;

class MockSmsSender implements SmsSender {
  async sendSms(input: SmsSendInput): Promise<SmsSendResult> {
    const sid = `MOCK_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    console.log(
      `[twilio:mock] OUTBOUND SMS from=${input.from} to=${input.to} sid=${sid} body=${JSON.stringify(input.body)}`
    );
    return { sid, provider: "mock" };
  }
}

class TwilioSmsSender implements SmsSender {
  private client: ReturnType<typeof twilio>;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for real Twilio SMS sending.");
    }
    this.client = twilio(accountSid, authToken);
  }

  async sendSms(input: SmsSendInput): Promise<SmsSendResult> {
    const response = await this.client.messages.create({
      to: input.to,
      from: input.from,
      body: input.body
    });

    return {
      sid: response.sid,
      provider: "twilio"
    };
  }
}

function isMockModeEnabled(): boolean {
  const flag = (process.env.MOCK_TWILIO ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    return true;
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return true;
  }

  return process.env.NODE_ENV !== "production" && flag !== "0" && flag !== "false" && flag !== "no";
}

function getSmsSender(): SmsSender {
  if (testSenderOverride) {
    return testSenderOverride;
  }

  if (isMockModeEnabled()) {
    return new MockSmsSender();
  }

  return new TwilioSmsSender();
}

export async function sendSms(input: SmsSendInput): Promise<SmsSendResult> {
  return getSmsSender().sendSms(input);
}

export function setSmsSenderForTests(sender: SmsSender | null): void {
  testSenderOverride = sender;
}
