import type { FileDiff, Review } from './review';

export type Changes = { review: Review; files: FileDiff[] }[];

const GEMINI_MODEL = 'gemini-3.8-flash';

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/** Merge requests as text for the model: title, description and the diff of every file. */
export function describeChanges(changes: Changes) {
  return changes
    .map(({ review, files }) => {
      const diffs = files
        .map((f) => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff || '(brak diffu tekstowego)'}`)
        .join('\n\n');
      return `<merge_request ref="${review.ref}">\nTytuł: ${review.title}\nOpis:\n${review.description || '(brak)'}\n\n${diffs}\n</merge_request>`;
    })
    .join('\n\n');
}

/**
 * Asks Gemini for JSON matching `schema` (its responseSchema format, an OpenAPI subset).
 * The key is the user's own and is sent only to Google's API; callers still validate the answer.
 */
export async function askGemini(apiKey: string, system: string, text: string, schema: object): Promise<unknown> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) throw new Error(`Gemini: ${data.error?.message ?? `HTTP ${res.status}`}`);
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini zablokował zapytanie (${data.promptFeedback.blockReason}).`);

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Odpowiedź modelu została ucięta, spróbuj ponownie.');
  const answer = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    return JSON.parse(answer);
  } catch {
    throw new Error('Gemini zwrócił odpowiedź, która nie jest poprawnym JSON-em.');
  }
}
