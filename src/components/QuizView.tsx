import { useEffect, useState } from 'react';
import type { Changes, QuizQuestion } from '../quiz';

type Props = { apiKey: string; changes: Changes; onClose: () => void };

export function QuizView({ apiKey, changes, onClose }: Props) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setQuestions(null);
    setError(null);
    // The Anthropic SDK is loaded only when a quiz is requested, keeping the app's first load small.
    import('../quiz')
      .then(({ generateQuiz }) => generateQuiz(apiKey, changes))
      .then(
        (q) => !cancelled && setQuestions(q),
        (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      cancelled = true;
    };
  }, [apiKey, changes, attempt]);

  const restart = () => {
    setIndex(0);
    setPicked(null);
    setScore(0);
    setAttempt((a) => a + 1);
  };

  if (error) {
    return (
      <div className="quiz">
        <div className="error">{error}</div>
        <div className="row">
          <button className="secondary" onClick={onClose}>
            Zamknij
          </button>
          <button className="primary" onClick={restart}>
            Spróbuj ponownie
          </button>
        </div>
      </div>
    );
  }

  if (!questions) {
    return (
      <div className="quiz">
        <div className="loading">🧠 Układam pytania o te zmiany… (zwykle kilkanaście sekund)</div>
      </div>
    );
  }

  if (index >= questions.length) {
    const ratio = score / questions.length;
    return (
      <div className="quiz">
        <div className="quiz-result">
          {score}/{questions.length}
        </div>
        <div className="quiz-verdict">
          {ratio === 1 ? 'Komplet — znasz te zmiany 🎯' : ratio >= 0.6 ? 'Nieźle, ale warto zerknąć jeszcze raz.' : 'Lepiej przejrzyj zmiany ponownie przed approve.'}
        </div>
        <div className="row">
          <button className="secondary" onClick={onClose}>
            Zamknij
          </button>
          <button className="primary" onClick={restart}>
            Nowy quiz
          </button>
        </div>
      </div>
    );
  }

  const q = questions[index];
  const answered = picked !== null;

  return (
    <div className="quiz">
      <div className="meta">
        Pytanie {index + 1}/{questions.length} · wynik {score}
      </div>
      <div className="quiz-question">{q.question}</div>
      <div className="quiz-options">
        {q.options.map((option, i) => (
          <button
            key={i}
            className={`quiz-option${answered && i === q.correct_index ? ' correct' : ''}${answered && i === picked && i !== q.correct_index ? ' wrong' : ''}`}
            disabled={answered}
            onClick={() => {
              setPicked(i);
              if (i === q.correct_index) setScore((s) => s + 1);
            }}
          >
            {option}
          </button>
        ))}
      </div>
      {answered && (
        <>
          <div className="quiz-explanation">{q.explanation}</div>
          <button
            className="primary"
            onClick={() => {
              setPicked(null);
              setIndex(index + 1);
            }}
          >
            {index + 1 < questions.length ? 'Dalej →' : 'Wynik'}
          </button>
        </>
      )}
    </div>
  );
}
