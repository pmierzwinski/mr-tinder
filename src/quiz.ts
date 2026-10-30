import type { FileDiff, Review } from './review';

export type QuizQuestion = { question: string; options: string[]; correct_index: number; explanation: string };

const SYSTEM = `Jesteś doświadczonym reviewerem kodu. Dostajesz merge requesty (opis i diffy plików), które użytkownik właśnie przejrzał na telefonie.
Ułóż quiz z dokładnie 5 pytań jednokrotnego wyboru, który sprawdzi, czy użytkownik naprawdę przeczytał i zrozumiał te zmiany.

Zasady:
- Pytaj o konkretne zmiany: co i dlaczego się zmieniło, jak zachowa się nowy kod, jakie są skutki uboczne, ryzyka lub przypadki brzegowe. Nie pytaj o rzeczy, których nie widać w diffie.
- Unikaj pytań trywialnych (nazwa pliku, liczba linii) i takich, na które da się odpowiedzieć bez czytania kodu.
- Jeśli MR-ów jest kilka, rozłóż pytania między nie i uwzględnij zależności między repozytoriami.
- Każde pytanie ma dokładnie 4 odpowiedzi, jedna jest poprawna; błędne odpowiedzi mają brzmieć wiarygodnie.
- correct_index to indeks poprawnej odpowiedzi (0-3); losuj jego pozycję.
- explanation: 1-2 zdania, dlaczego odpowiedź jest poprawna, z odwołaniem do konkretnego miejsca w kodzie.
- Pisz po polsku, nazwy z kodu zostaw w oryginale.`;

function describeChanges(changes: Changes) {
  return changes
    .map(({ review, files }) => {
      const diffs = files
        .map((f) => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff || '(brak diffu tekstowego)'}`)
        .join('\n\n');
      return `<merge_request ref="${review.ref}">\nTytuł: ${review.title}\nOpis:\n${review.description || '(brak)'}\n\n${diffs}\n</merge_request>`;
    })
    .join('\n\n');
}

export type Changes = { review: Review; files: FileDiff[] }[];

const GEMINI_MODEL = 'gemini-3.8-flash';

// Gemini's responseSchema format (an OpenAPI subset); the answer is still validated below.
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          correct_index: { type: 'INTEGER' },
          explanation: { type: 'STRING' },
        },
        required: ['question', 'options', 'correct_index', 'explanation'],
      },
    },
  },
  required: ['questions'],
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/** Generates the quiz with Gemini; the key is the user's own and is sent only to Google's API. */
export async function generateQuiz(apiKey: string, changes: Changes): Promise<QuizQuestion[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: describeChanges(changes) }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) throw new Error(`Gemini: ${data.error?.message ?? `HTTP ${res.status}`}`);
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini zablokował zapytanie (${data.promptFeedback.blockReason}).`);

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Odpowiedź modelu została ucięta, spróbuj ponownie.');
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Gemini zwrócił odpowiedź, która nie jest poprawnym JSON-em.');
  }
  const questions = (json as { questions?: unknown } | null)?.questions;
  const valid = (Array.isArray(questions) ? questions : []).filter(isQuestion);
  if (!valid.length) throw new Error('Nie udało się odczytać quizu z odpowiedzi modelu.');
  return valid;
}

function isQuestion(q: unknown): q is QuizQuestion {
  const c = q as Partial<QuizQuestion> | null;
  return (
    typeof c?.question === 'string' &&
    typeof c.explanation === 'string' &&
    Array.isArray(c.options) &&
    c.options.length >= 2 &&
    c.options.every((o) => typeof o === 'string') &&
    Number.isInteger(c.correct_index) &&
    c.correct_index! >= 0 &&
    c.correct_index! < c.options.length
  );
}
