import { askGemini, describeChanges, type Changes } from './gemini';

export type { Changes };

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

/** Generates the quiz with Gemini; the key is the user's own and is sent only to Google's API. */
export async function generateQuiz(apiKey: string, changes: Changes): Promise<QuizQuestion[]> {
  const json = await askGemini(apiKey, SYSTEM, describeChanges(changes), GEMINI_SCHEMA);
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
