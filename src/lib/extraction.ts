import OpenAI from "openai";
import { z } from "zod";

export type ExtractedIntent = "VIEWING" | "MAINTENANCE" | "GENERAL" | "UNKNOWN";
export type ExtractedSeverity = "ROUTINE" | "URGENT" | "EMERGENCY" | null;

export type SmsExtraction = {
  stop: boolean;
  intent: ExtractedIntent;
  postcode: string | null;
  severity: ExtractedSeverity;
  angerSignals: boolean;
  safetyRisk: boolean;
  name: string | null;
  areaOrProperty: string | null;
  callbackText: string | null;
  issueDescription: string | null;
  summary: string | null;
  usedOpenAi: boolean;
};

const UK_POSTCODE_REGEX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const STOP_REGEX = /\b(stop|unsubscribe|cancel|end|quit|remove me)\b/i;
const INTENT_VIEWING_REGEX = /\b(viewing|rent|rental|let|letting|property)\b/i;
const INTENT_MAINTENANCE_REGEX = /\b(repair|maintenance|leak|boiler|heating|plumbing|electrical|fault)\b/i;
const INTENT_GENERAL_REGEX = /\b(other|general|question|query|enquiry|enquiry)\b/i;
const URGENT_REGEX = /\b(urgent|asap|today|immediately)\b/i;
const EMERGENCY_REGEX =
  /\b(emergency|danger|fire|gas leak|smell gas|smoke|flood|sparks|electroc|carbon monoxide|co alarm)\b/i;
const ANGER_KEYWORD_REGEX = /\b(complaint|lawyer|ombudsman|unsafe|ignored|ridiculous|disgusting|angry)\b/i;
const PROFANITY_REGEX = /\b(fuck|fucking|shit|bastard|damn)\b/i;
const NAME_REGEX = /\b(i am|i'm|this is|my name is)\s+([a-z][a-z' -]{1,40})/i;
const CALLBACK_REGEX = /\b(callback|call me|ring me|tomorrow|am|pm|morning|afternoon|evening)\b/i;

const ExtractionSchema = z.object({
  stop: z.boolean().default(false),
  intent: z.enum(["VIEWING", "MAINTENANCE", "GENERAL", "UNKNOWN"]).default("UNKNOWN"),
  postcode: z.string().nullable().default(null),
  severity: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).nullable().default(null),
  angerSignals: z.boolean().default(false),
  safetyRisk: z.boolean().default(false),
  name: z.string().nullable().default(null),
  areaOrProperty: z.string().nullable().default(null),
  callbackText: z.string().nullable().default(null),
  issueDescription: z.string().nullable().default(null),
  summary: z.string().nullable().default(null)
});

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function detectAllCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 10) {
    return false;
  }
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.85;
}

function fallbackIntent(text: string): ExtractedIntent {
  const compact = text.trim().toLowerCase();
  if (compact === "1") {
    return "VIEWING";
  }
  if (compact === "2") {
    return "MAINTENANCE";
  }
  if (compact === "3") {
    return "GENERAL";
  }

  if (INTENT_MAINTENANCE_REGEX.test(text)) {
    return "MAINTENANCE";
  }
  if (INTENT_VIEWING_REGEX.test(text)) {
    return "VIEWING";
  }
  if (INTENT_GENERAL_REGEX.test(text)) {
    return "GENERAL";
  }

  return "UNKNOWN";
}

function fallbackSeverity(text: string): ExtractedSeverity {
  if (EMERGENCY_REGEX.test(text)) {
    return "EMERGENCY";
  }
  if (URGENT_REGEX.test(text)) {
    return "URGENT";
  }
  if (/\b(routine|normal|non[- ]?urgent)\b/i.test(text)) {
    return "ROUTINE";
  }
  return null;
}

function fallbackName(text: string): string | null {
  const match = text.match(NAME_REGEX);
  if (!match?.[2]) {
    return null;
  }
  const value = normalizeWhitespace(match[2]);
  return value.length > 1 ? value : null;
}

function fallbackPostcode(text: string): string | null {
  const match = text.match(UK_POSTCODE_REGEX);
  if (!match?.[1]) {
    return null;
  }

  return normalizeWhitespace(match[1].toUpperCase());
}

function fallbackExtraction(messageBody: string): SmsExtraction {
  const body = normalizeWhitespace(messageBody);
  const intent = fallbackIntent(body);
  const severity = fallbackSeverity(body);
  const postcode = fallbackPostcode(body);
  const stop = STOP_REGEX.test(body);
  const angerSignals = ANGER_KEYWORD_REGEX.test(body) || PROFANITY_REGEX.test(body) || detectAllCaps(body);
  const safetyRisk = EMERGENCY_REGEX.test(body);

  return {
    stop,
    intent,
    postcode,
    severity,
    angerSignals,
    safetyRisk,
    name: fallbackName(body),
    areaOrProperty: intent === "VIEWING" && !postcode ? body : null,
    callbackText: CALLBACK_REGEX.test(body) ? body : null,
    issueDescription: intent === "MAINTENANCE" ? body : null,
    summary: body.length > 0 ? body : null,
    usedOpenAi: false
  };
}

let openAiClient: OpenAI | null = null;

function getOpenAiClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return null;
  }

  if (!openAiClient) {
    openAiClient = new OpenAI({ apiKey: key });
  }
  return openAiClient;
}

async function openAiExtraction(messageBody: string): Promise<SmsExtraction | null> {
  const client = getOpenAiClient();
  if (!client) {
    return null;
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract structured fields from UK property-management SMS messages. Output JSON only. Do not include markdown."
      },
      {
        role: "user",
        content: [
          "Return JSON with keys:",
          "stop:boolean, intent:(VIEWING|MAINTENANCE|GENERAL|UNKNOWN), postcode:string|null, severity:(ROUTINE|URGENT|EMERGENCY|null),",
          "angerSignals:boolean, safetyRisk:boolean, name:string|null, areaOrProperty:string|null, callbackText:string|null, issueDescription:string|null, summary:string|null.",
          "Message:",
          messageBody
        ].join("\n")
      }
    ]
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  const result = ExtractionSchema.parse(parsed);
  return {
    ...result,
    postcode: result.postcode ? normalizeWhitespace(result.postcode.toUpperCase()) : null,
    name: result.name ? normalizeWhitespace(result.name) : null,
    areaOrProperty: result.areaOrProperty ? normalizeWhitespace(result.areaOrProperty) : null,
    callbackText: result.callbackText ? normalizeWhitespace(result.callbackText) : null,
    issueDescription: result.issueDescription ? normalizeWhitespace(result.issueDescription) : null,
    summary: result.summary ? normalizeWhitespace(result.summary) : null,
    usedOpenAi: true
  };
}

export async function extractSmsSignals(messageBody: string): Promise<SmsExtraction> {
  const fallback = fallbackExtraction(messageBody);
  try {
    const ai = await openAiExtraction(messageBody);
    if (!ai) {
      return fallback;
    }

    return {
      ...fallback,
      ...ai,
      usedOpenAi: true
    };
  } catch (error) {
    console.warn("[extraction] OpenAI extraction failed, using fallback.", error);
    return fallback;
  }
}
