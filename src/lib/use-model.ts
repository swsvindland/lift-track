import { useEffect, useState } from "react";
import { generateJson, modelStatus, prewarmModel, type ModelStatus } from "./local-ai";
import type { Generate } from "./lift-ai";

let cached: ModelStatus | null = null;

/**
 * Whether this phone's own model can run, and a `generate` that uses it. Without one, features
 * fall back to the parsers that need no model, and nothing is ever sent anywhere.
 */
export function useModel(options: { prewarm?: boolean } = {}) {
  const [status, setStatus] = useState<ModelStatus | null>(cached);
  useEffect(() => {
    let live = true;
    void modelStatus().then((s) => {
      cached = s;
      if (live) setStatus(s);
      if (s.state === "available" && options.prewarm) prewarmModel();
    });
    return () => {
      live = false;
    };
  }, [options.prewarm]);
  const available = status?.state === "available";
  const generate: Generate | undefined = available ? (request) => generateJson(request) : undefined;
  return { status, available, generate, engine: status?.engine ?? "none" };
}

/** Plain words for why the model isn't there, for a one-line note. */
export function modelNote(status: ModelStatus | null): string | null {
  if (!status || status.state === "available") return null;
  if (status.reason === "disabled")
    return "Turn on Apple Intelligence in Settings to read looser descriptions.";
  if (status.state === "downloadable" || status.state === "downloading")
    return "The on-device model is still downloading; shorthand works now.";
  return null;
}
