import { z } from 'zod';
import { askClaude, describeChanges, type Changes } from './claude';

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

/** Generates the quiz with Claude; the key is the user's own and is sent only to Anthropic's API. */
export async function generateQuiz(apiKey: string, changes: Changes): Promise<QuizQuestion[]> {
  const { questions } = await askClaude(apiKey, SYSTEM, describeChanges(changes), QuizSchema);
  // The schema can't express "index within options", so that is checked here.
  const valid = questions.filter(isQuestion);
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
