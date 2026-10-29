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

export async function generateQuiz(apiKey: string, changes: { mr: MergeRequest; files: FileDiff[] }[]): Promise<QuizQuestion[]> {
  // The key is the user's own and never leaves their browser except to the Anthropic API.
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
  const questions = response.parsed_output?.questions.filter(
    (q) => q.options.length >= 2 && q.correct_index >= 0 && q.correct_index < q.options.length,
  );
  if (!questions?.length) throw new Error('Nie udało się odczytać quizu z odpowiedzi modelu.');
  return questions;
}
