import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { describeJson, extractJson, type JsonSchema } from "./model-json";

/* The phone's own model: Apple Foundation Models (Apple Intelligence) on iPhone, Gemini Nano on
   Android. Only on-device models are used, never a cloud fallback. Ported from Vector Macros. */

export type TextBox = { text: string; x: number; y: number; width: number; height: number };

export type ModelStatus = {
  state: "available" | "downloadable" | "downloading" | "unavailable";
  engine: "apple" | "gemini-nano" | "none";
  vision: boolean;
  reason?: "os" | "device" | "disabled" | "not-ready" | "unsupported" | "missing";
  detail?: string;
};

export type GenerateRequest = {
  instructions: string;
  prompt: string;
  schema: JsonSchema;
  maxTokens?: number;
};

type NativeLocalAI = {
  getStatus(): Promise<ModelStatus>;
  download(): Promise<void>;
  prewarm(): Promise<void>;
  generate(
    instructions: string,
    prompt: string,
    schema: string,
    imageUri: string | null,
    maxTokens: number
  ): Promise<string>;
  recognizeText(imageUri: string): Promise<TextBox[]>;
};

// Expo Go and builds without the module report the feature as unavailable.
const native = requireOptionalNativeModule<NativeLocalAI>("LocalAI");

export async function modelStatus(): Promise<ModelStatus> {
  if (!native) return { state: "unavailable", engine: "none", vision: false, reason: "missing" };
  try {
    return await native.getStatus();
  } catch (e) {
    return {
      state: "unavailable",
      engine: "none",
      vision: false,
      reason: "unsupported",
      detail: e instanceof Error ? e.message : "",
    };
  }
}

/** Text recognition needs only this build's module, not Apple Intelligence or Gemini Nano. */
export const textRecognitionAvailable = () => !!native;

/** Reads the text in a photo on the phone (Vision on iOS, ML Kit on Android), top to bottom. */
export async function recognizeText(imageUri: string): Promise<TextBox[]> {
  if (!native) throw new Error("Text recognition isn't available in this build.");
  return native.recognizeText(imageUri);
}

/** Gemini Nano is installed by Android's AICore on request; Apple installs its model itself. */
export async function downloadModel() {
  if (native) await native.download();
}

export function prewarmModel() {
  void native?.prewarm().catch(() => {});
}

export function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

/**
 * Apple's decoder needs every object titled, closed and ordered; the schemas here are written
 * plainly and completed on the way out.
 */
export function appleSchema(schema: JsonSchema, title = "Reply"): JsonSchema {
  if (schema.type === "object") {
    const properties = Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        appleSchema(value, key[0].toUpperCase() + key.slice(1)),
      ])
    );
    return {
      title,
      additionalProperties: false,
      ...schema,
      properties,
      required: schema.required ?? Object.keys(properties),
      "x-order": schema["x-order"] ?? Object.keys(properties),
    };
  }
  if (schema.type === "array" && schema.items)
    return { ...schema, items: appleSchema(schema.items, `${title}Item`) };
  return schema;
}

/** Runs one on-device request and returns the parsed JSON reply. Nothing leaves the phone. */
export async function generateJson(request: GenerateRequest): Promise<unknown> {
  if (!native) throw new Error("On-device AI isn't available in this build.");
  // Apple decodes against the schema; Gemini Nano is told the shape in the prompt instead.
  const prompt =
    Platform.OS === "android"
      ? `${request.prompt}\n\n${describeJson(request.schema)}`
      : request.prompt;
  for (let attempt = 0; ; attempt++) {
    try {
      const text = await native.generate(
        request.instructions,
        prompt,
        JSON.stringify(Platform.OS === "ios" ? appleSchema(request.schema) : request.schema),
        null,
        request.maxTokens ?? 800
      );
      return extractJson(text);
    } catch (e) {
      // A busy model usually frees up within a second or two.
      if (errorCode(e) === "ERR_LOCAL_AI_BUSY" && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

/** OCR lines in reading order, as plain text. */
export function linesToText(boxes: TextBox[]): string {
  const rows: TextBox[][] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(
      (r) => Math.abs(r[0].y - box.y) < Math.max(r[0].height, box.height) * 0.5
    );
    if (row) row.push(box);
    else rows.push([box]);
  }
  return rows
    .map((r) =>
      r
        .sort((a, b) => a.x - b.x)
        .map((b) => b.text)
        .join("  ")
    )
    .join("\n");
}
