import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { FileDiff, MergeRequest } from './gitlab';

const QuizSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correct_index: z.number().int(),
      explanation: z.string(),
    }),
  ),
});

export type Quiz = z.infer<typeof QuizSchema>;
export type QuizQuestion = Quiz['questions'][number];

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

function describeChanges(changes: { mr: MergeRequest; files: FileDiff[] }[]) {
  return changes
    .map(({ mr, files }) => {
      const diffs = files
        .map((f) => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff || '(brak diffu tekstowego)'}`)
        .join('\n\n');
      return `<merge_request ref="${mr.references.full}">\nTytuł: ${mr.title}\nOpis:\n${mr.description || '(brak)'}\n\n${diffs}\n</merge_request>`;
    })
    .join('\n\n');
}

export type AiProvider = 'anthropic' | 'gemini';

/** Google AI Studio keys start with "AIza"; everything else is treated as an Anthropic key. */
export const providerForKey = (key: string): AiProvider => (key.startsWith('AIza') ? 'gemini' : 'anthropic');

type Changes = { mr: MergeRequest; files: FileDiff[] }[];

function usableQuestions(questions: QuizQuestion[] | undefined) {
  const valid = questions?.filter((q) => q.options.length >= 2 && q.correct_index >= 0 && q.correct_index < q.options.length);
  if (!valid?.length) throw new Error('Nie udało się odczytać quizu z odpowiedzi modelu.');
  return valid;
}

export function generateQuiz(apiKey: string, changes: Changes): Promise<QuizQuestion[]> {
  // The key is the user's own and never leaves their browser except to the chosen AI provider.
  return providerForKey(apiKey) === 'gemini' ? generateWithGemini(apiKey, changes) : generateWithClaude(apiKey, changes);
}

async function generateWithClaude(apiKey: string, changes: Changes) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(QuizSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: describeChanges(changes) }],
  });

  if (response.stop_reason === 'refusal') throw new Error('Model odmówił ułożenia quizu dla tych zmian.');
  if (response.stop_reason === 'max_tokens') throw new Error('Odpowiedź modelu została ucięta, spróbuj ponownie.');
  return usableQuestions(response.parsed_output?.questions);
}

const GEMINI_MODEL = 'gemini-3.8-flash';

// Gemini's responseSchema uses its own OpenAPI-style subset, so it's written out instead of derived from zod.
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

async function generateWithGemini(apiKey: string, changes: Changes) {
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
  return usableQuestions(QuizSchema.safeParse(json).data?.questions);
}
