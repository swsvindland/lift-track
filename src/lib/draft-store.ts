import type { ProgramDraft } from "./program-builder";

/* A built program waiting in the editor. It lives in memory between the builder and the editor;
   nothing is saved until the program starts. */

let pending: ProgramDraft | null = null;

export function setPendingDraft(draft: ProgramDraft | null) {
  pending = draft;
}

export const pendingDraft = () => pending;
