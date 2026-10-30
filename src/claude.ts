import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { FileDiff, Review } from './review';

export type Changes = { review: Review; files: FileDiff[] }[];

const MODEL = 'claude-opus-5-5';

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
 * Asks Claude for JSON matching `schema`. The key is the user's own and goes only to Anthropic's API,
 * straight from the browser (there is no backend), hence `dangerouslyAllowBrowser`.
 */
export async function askClaude<T extends z.ZodType>(apiKey: string, system: string, text: string, schema: T): Promise<z.infer<T>> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      // If a safety classifier declines, the API retries on a suitable model within the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: text }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude odrzucił klucz API — sprawdź go w ustawieniach.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('Ten klucz API nie ma dostępu do modelu Claude.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Za dużo zapytań do Claude (limit lub brak środków) — spróbuj za chwilę.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Nie udało się połączyć z API Claude.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude: ${e.message}`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude odmówił odpowiedzi na to zapytanie.');
  if (response.stop_reason === 'max_tokens') throw new Error('Odpowiedź modelu została ucięta, spróbuj ponownie.');
  if (!response.parsed_output) throw new Error('Nie udało się odczytać odpowiedzi modelu.');
  return response.parsed_output;
}
