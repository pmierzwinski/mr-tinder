import { z } from 'zod';
import { askClaude, describeChanges, type Changes } from './claude';
import { fileKey, type AiStep } from './flow';

// AI reading order, loaded only when asked for so the Claude SDK stays out of the app's first load.

const SYSTEM = `Jesteś doświadczonym reviewerem kodu. Dostajesz merge requesty (opis i diffy plików).
Ułóż WSZYSTKIE zmienione pliki w kolejności, w jakiej najłatwiej zrozumieć zmianę, czytając kod krok po kroku wzdłuż przepływu wykonania:
od punktu wejścia (np. handler, kontroler, UI, event) przez kolejne wywoływane metody aż do warstw najniższych (repozytoria, modele, konfiguracja).
Plik, który wywołuje metodę, ma być przed plikiem z jej definicją. Testy i pliki pomocnicze na końcu.

Dla każdego pliku podaj:
- ref: referencja merge requesta z atrybutu ref,
- path: ścieżka pliku dokładnie jak po "+++ " (dla usuniętych plików jak po "--- "),
- note: jedno krótkie zdanie po polsku, co ten plik robi w tym przepływie (nazwy z kodu zostaw w oryginale).`;

const FlowSchema = z.object({
  steps: z.array(z.object({ ref: z.string(), path: z.string(), note: z.string() })),
});

/** Asks Claude for the reading order; returns the steps it named that match real files, in its order. */
export async function generateFlow(apiKey: string, changes: Changes): Promise<AiStep[]> {
  const { steps } = await askClaude(apiKey, SYSTEM, describeChanges(changes), FlowSchema);
  const out: AiStep[] = [];
  const seen = new Set<string>();
  for (const { ref, path, note } of steps) {
    // Prefer the named MR; fall back to the path alone when the model mixed up the ref.
    const matches = changes.flatMap(({ review, files }) =>
      files.filter((f) => f.new_path === path || f.old_path === path).map((f) => ({ review, f })),
    );
    const match = matches.find((m) => m.review.ref === ref) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!match) continue;
    const key = fileKey(match.review.id, match.f.new_path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, note });
  }
  if (!out.length) throw new Error('Nie udało się odczytać kolejności z odpowiedzi modelu.');
  return out;
}
