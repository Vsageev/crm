import { useEffect, useState, useMemo, useCallback, useRef, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import styles from './QuizTakerPage.module.css';

// ── Types ──────────────────────────────────────────────────────────────

interface AnswerOption {
  id: string;
  text: string;
  imageUrl: string | null;
  points: number;
  jumpToQuestionId: string | null;
  jumpToEnd: boolean;
  position: number;
}

interface Question {
  id: string;
  text: string;
  description: string | null;
  questionType: string;
  position: number;
  isRequired: boolean;
  minValue: number | null;
  maxValue: number | null;
  ratingScale: number | null;
  options: AnswerOption[];
}

interface QuizResult {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  minScore: number | null;
  maxScore: number | null;
  isDefault: boolean;
}

interface QuizData {
  id: string;
  name: string;
  description: string | null;
  startHeadline: string;
  startDescription: string | null;
  startButtonText: string;
  startImageUrl: string | null;
  leadCapturePosition: string;
  leadCaptureHeading: string;
  leadCaptureFields: { key: string; label: string; isRequired: boolean; contactFieldMapping: string | null }[];
  accentColor: string | null;
  questions: Question[];
  results: QuizResult[];
}

type Screen = 'start' | 'question' | 'lead_capture' | 'result';

const BASE_URL = '/api';

const CHOICE_TYPES = new Set(['single_choice', 'multiple_choice', 'image_choice']);

// ── Helpers ────────────────────────────────────────────────────────────

function getUtmParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get('utm_source') || undefined,
    utmMedium: params.get('utm_medium') || undefined,
    utmCampaign: params.get('utm_campaign') || undefined,
    utmTerm: params.get('utm_term') || undefined,
    utmContent: params.get('utm_content') || undefined,
    referrerUrl: document.referrer || undefined,
  };
}

function matchResult(results: QuizResult[], totalScore: number): QuizResult | null {
  // First: find a result whose score range matches
  for (const r of results) {
    const hasMin = r.minScore !== null;
    const hasMax = r.maxScore !== null;
    if (hasMin && hasMax && totalScore >= r.minScore! && totalScore <= r.maxScore!) return r;
    if (hasMin && !hasMax && totalScore >= r.minScore!) return r;
    if (!hasMin && hasMax && totalScore <= r.maxScore!) return r;
  }
  // Fallback: default result, then first result
  return results.find((r) => r.isDefault) ?? results[0] ?? null;
}

function calculateScore(
  answers: Record<string, unknown>,
  questions: Question[],
): number {
  let total = 0;
  for (const [qId, val] of Object.entries(answers)) {
    const q = questions.find((qq) => qq.id === qId);
    if (!q) continue;
    const selectedIds = Array.isArray(val) ? val : [val];
    for (const optId of selectedIds) {
      if (typeof optId === 'string') {
        const opt = q.options.find((o) => o.id === optId);
        if (opt) total += opt.points;
      }
    }
  }
  return total;
}

// ── Component ──────────────────────────────────────────────────────────

export function QuizTakerPage() {
  const { id } = useParams<{ id: string }>();

  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [fetchError, setFetchError] = useState('');
  const [fetchLoading, setFetchLoading] = useState(true);

  const [screen, setScreen] = useState<Screen>('start');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [leadData, setLeadData] = useState<Record<string, string>>({});
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [leadSubmittedAfterResult, setLeadSubmittedAfterResult] = useState(false);

  const [questionHistory, setQuestionHistory] = useState<number[]>([]);
  const [matchedResult, setMatchedResult] = useState<QuizResult | null>(null);

  // Ref to always have fresh answers in timeout callbacks
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // Fetch quiz
  useEffect(() => {
    if (!id) return;
    setFetchLoading(true);
    const params = new URLSearchParams(window.location.search);
    const previewParam = params.get('preview') ? '?preview=1' : '';
    fetch(`${BASE_URL}/public/quiz/${id}${previewParam}`)
      .then((r) => {
        if (!r.ok) throw new Error('Quiz not found');
        return r.json();
      })
      .then((data) => {
        setQuiz(data);
        setFetchLoading(false);
      })
      .catch((err) => {
        setFetchError(err.message || 'Failed to load quiz');
        setFetchLoading(false);
      });
  }, [id]);

  const accent = quiz?.accentColor || '#4f46e5';
  const questions = useMemo(() => quiz?.questions ?? [], [quiz]);
  const currentQuestion = questions[questionIndex] ?? null;
  const hasLeadCapture = (quiz?.leadCaptureFields?.length ?? 0) > 0;

  const totalQuestions = questions.length;
  const progress = totalQuestions > 0
    ? Math.min(((questionIndex + 1) / totalQuestions) * 100, 100)
    : 0;

  // ── Session helpers ────────────────────────────────────────────────

  function saveAnswerToSession(questionId: string, value: unknown) {
    if (!sessionId || !id) return;
    fetch(`${BASE_URL}/public/quiz/${id}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: { [questionId]: value } }),
    }).catch(() => {});
  }

  // ── Start quiz ─────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    if (!id || !quiz) return;

    // If there are no questions, skip straight to lead capture or result
    if (questions.length === 0) {
      try {
        const utmParams = getUtmParams();
        const res = await fetch(`${BASE_URL}/public/quiz/${id}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(utmParams),
        });
        if (res.ok) {
          const session = await res.json();
          setSessionId(session.id);
        }
      } catch { /* continue */ }

      if (hasLeadCapture && quiz.leadCapturePosition === 'before_results') {
        setScreen('lead_capture');
      } else {
        handleComplete();
      }
      return;
    }

    try {
      const utmParams = getUtmParams();
      const res = await fetch(`${BASE_URL}/public/quiz/${id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(utmParams),
      });
      if (res.ok) {
        const session = await res.json();
        setSessionId(session.id);
      }
    } catch { /* continue without session tracking */ }

    setScreen('question');
    setQuestionIndex(0);
    setQuestionHistory([0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, quiz, questions.length, hasLeadCapture]);

  // ── Answer handling ────────────────────────────────────────────────

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function getCurrentAnswer() {
    if (!currentQuestion) return undefined;
    return answers[currentQuestion.id];
  }

  // ── Navigation ─────────────────────────────────────────────────────

  function resolveNextIndex(fromIndex: number, currentAnswers: Record<string, unknown>): number | null {
    const q = questions[fromIndex];
    if (!q) return null;

    const answer = currentAnswers[q.id];

    // Check branching from selected option (single choice / image choice)
    if (answer && typeof answer === 'string') {
      const option = q.options.find((o) => o.id === answer);
      if (option?.jumpToEnd) return null;
      if (option?.jumpToQuestionId) {
        const targetIdx = questions.findIndex((tq) => tq.id === option.jumpToQuestionId);
        if (targetIdx >= 0) return targetIdx;
      }
    }

    const next = fromIndex + 1;
    return next < questions.length ? next : null;
  }

  function advanceTo(nextIdx: number | null) {
    if (nextIdx === null) {
      goToEndScreen();
    } else {
      setQuestionIndex(nextIdx);
      setQuestionHistory((prev) => [...prev, nextIdx]);
    }
  }

  function goToNextQuestion() {
    if (!currentQuestion) return;
    saveAnswerToSession(currentQuestion.id, answers[currentQuestion.id]);
    const nextIdx = resolveNextIndex(questionIndex, answers);
    advanceTo(nextIdx);
  }

  function goToPrevQuestion() {
    if (questionHistory.length <= 1) {
      setScreen('start');
      return;
    }
    const newHistory = questionHistory.slice(0, -1);
    setQuestionHistory(newHistory);
    setQuestionIndex(newHistory[newHistory.length - 1]);
  }

  function goToEndScreen() {
    if (hasLeadCapture && quiz?.leadCapturePosition === 'before_results') {
      setScreen('lead_capture');
    } else {
      handleComplete();
    }
  }

  // ── Single choice auto-advance ─────────────────────────────────────

  function handleSingleChoiceSelect(questionId: string, optionId: string) {
    const updated = { ...answersRef.current, [questionId]: optionId };
    setAnswers(updated);
    answersRef.current = updated;

    saveAnswerToSession(questionId, optionId);

    setTimeout(() => {
      const qIdx = questions.findIndex((q) => q.id === questionId);
      if (qIdx < 0) return;

      const option = questions[qIdx].options.find((o) => o.id === optionId);

      if (option?.jumpToEnd) {
        goToEndScreen();
        return;
      }

      let nextIdx: number | null = null;
      if (option?.jumpToQuestionId) {
        const targetIdx = questions.findIndex((q) => q.id === option.jumpToQuestionId);
        if (targetIdx >= 0) nextIdx = targetIdx;
      }
      if (nextIdx === null) {
        nextIdx = qIdx + 1 < questions.length ? qIdx + 1 : null;
      }

      advanceTo(nextIdx);
    }, 250);
  }

  // ── Rating auto-advance ────────────────────────────────────────────

  function handleRatingSelect(questionId: string, value: string) {
    const updated = { ...answersRef.current, [questionId]: value };
    setAnswers(updated);
    answersRef.current = updated;

    saveAnswerToSession(questionId, value);

    setTimeout(() => {
      const qIdx = questions.findIndex((q) => q.id === questionId);
      if (qIdx < 0) return;
      const nextIdx = qIdx + 1 < questions.length ? qIdx + 1 : null;
      advanceTo(nextIdx);
    }, 250);
  }

  // ── Multiple choice toggle ─────────────────────────────────────────

  function toggleMultiChoice(questionId: string, optionId: string) {
    const current = (answers[questionId] as string[]) || [];
    const next = current.includes(optionId)
      ? current.filter((cid) => cid !== optionId)
      : [...current, optionId];
    setAnswer(questionId, next);
  }

  // ── Lead capture ───────────────────────────────────────────────────

  function handleLeadSubmit(e: FormEvent) {
    e.preventDefault();
    if (!quiz) return;

    const errors: Record<string, string> = {};
    for (const field of quiz.leadCaptureFields) {
      if (field.isRequired && !leadData[field.key]?.trim()) {
        errors[field.key] = `${field.label} is required`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setLeadErrors(errors);
      return;
    }

    if (screen === 'lead_capture') {
      // Before results: complete with lead data
      handleComplete(leadData);
    } else {
      // After results: submit lead data to existing session
      submitLeadAfterResult(leadData);
    }
  }

  async function submitLeadAfterResult(lead: Record<string, string>) {
    setSubmitting(true);
    if (sessionId && id) {
      try {
        await fetch(`${BASE_URL}/public/quiz/${id}/sessions/${sessionId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadData: lead }),
        });
      } catch { /* non-critical */ }
    }
    setSubmitting(false);
    setLeadSubmittedAfterResult(true);
  }

  // ── Complete session ───────────────────────────────────────────────

  async function handleComplete(lead?: Record<string, string>) {
    setSubmitting(true);

    const totalScore = calculateScore(answersRef.current, questions);
    const result = quiz?.results?.length ? matchResult(quiz.results, totalScore) : null;
    setMatchedResult(result);

    if (sessionId && id) {
      try {
        await fetch(`${BASE_URL}/public/quiz/${id}/sessions/${sessionId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadData: lead || undefined,
            answers: answersRef.current,
          }),
        });
      } catch { /* non-critical */ }
    }

    setSubmitting(false);
    setScreen('result');
  }

  // ── Can proceed check ─────────────────────────────────────────────

  function canProceed(): boolean {
    if (!currentQuestion) return false;
    if (!currentQuestion.isRequired) return true;

    const val = getCurrentAnswer();
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  }

  // ── Whether to show after-results lead capture ────────────────────

  const showAfterResultLeadCapture =
    screen === 'result' &&
    hasLeadCapture &&
    quiz?.leadCapturePosition === 'after_results' &&
    !leadSubmittedAfterResult;

  // ── Render ─────────────────────────────────────────────────────────

  if (fetchLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.cardBody}>
            <div className={styles.loading}>Loading quiz...</div>
          </div>
        </div>
      </div>
    );
  }

  if (fetchError || !quiz) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.cardBody}>
            <div className={styles.error}>{fetchError || 'Quiz not found'}</div>
          </div>
        </div>
      </div>
    );
  }

  const cssVars = { '--accent': accent } as React.CSSProperties;

  // Check if question screen but currentQuestion is null (out of bounds / empty)
  const questionScreenEmpty = screen === 'question' && !currentQuestion;

  // Check if current question type has choice options but none are configured
  const choiceTypeNoOptions =
    currentQuestion &&
    CHOICE_TYPES.has(currentQuestion.questionType) &&
    currentQuestion.options.length === 0;

  return (
    <div className={styles.container} style={cssVars}>
      <div className={styles.card}>
        {/* Progress bar (during questions only) */}
        {screen === 'question' && totalQuestions > 0 && (
          <div className={styles.progressWrap}>
            <div className={styles.progressBar} style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className={styles.cardBody}>
          {/* ── Start Screen ──────────────────────────────────────── */}
          {screen === 'start' && (
            <div className={styles.startScreen}>
              {quiz.startImageUrl && (
                <img src={quiz.startImageUrl} alt="" className={styles.startImage} />
              )}
              <h1 className={styles.startHeadline}>{quiz.startHeadline}</h1>
              {quiz.startDescription && (
                <p className={styles.startDescription}>{quiz.startDescription}</p>
              )}
              <button className={styles.startBtn} onClick={handleStart}>
                {quiz.startButtonText}
              </button>
            </div>
          )}

          {/* ── Question Screen — empty / out-of-bounds guard ─────── */}
          {questionScreenEmpty && (
            <div className={styles.questionScreen}>
              <p className={styles.loading}>No more questions.</p>
              <div className={styles.navRow}>
                <button className={styles.backBtn} onClick={goToPrevQuestion}>
                  Back
                </button>
                <button className={styles.nextBtn} onClick={goToEndScreen}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Question Screen ───────────────────────────────────── */}
          {screen === 'question' && currentQuestion && (
            <div className={styles.questionScreen}>
              <div className={styles.questionMeta}>
                <span className={styles.questionCounter}>
                  {questionIndex + 1} / {totalQuestions}
                </span>
              </div>

              <h2 className={styles.questionText}>{currentQuestion.text}</h2>
              {currentQuestion.description && (
                <p className={styles.questionDescription}>{currentQuestion.description}</p>
              )}

              {/* Single choice */}
              {currentQuestion.questionType === 'single_choice' && !choiceTypeNoOptions && (
                <div className={styles.choiceList}>
                  {currentQuestion.options.map((opt) => {
                    const selected = getCurrentAnswer() === opt.id;
                    return (
                      <button
                        key={opt.id}
                        className={`${styles.choiceBtn} ${selected ? styles.choiceBtnSelected : ''}`}
                        onClick={() => handleSingleChoiceSelect(currentQuestion.id, opt.id)}
                      >
                        <span className={styles.choiceIndicator}>
                          <Check size={14} className={styles.choiceCheck} />
                        </span>
                        {opt.text}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Multiple choice */}
              {currentQuestion.questionType === 'multiple_choice' && !choiceTypeNoOptions && (
                <div className={styles.choiceList}>
                  {currentQuestion.options.map((opt) => {
                    const selected = ((getCurrentAnswer() as string[]) || []).includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        className={`${styles.choiceBtn} ${styles.choiceMulti} ${selected ? styles.choiceBtnSelected : ''}`}
                        onClick={() => toggleMultiChoice(currentQuestion.id, opt.id)}
                      >
                        <span className={styles.choiceIndicator}>
                          <Check size={14} className={styles.choiceCheck} />
                        </span>
                        {opt.text}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Image choice */}
              {currentQuestion.questionType === 'image_choice' && !choiceTypeNoOptions && (
                <div className={styles.choiceList}>
                  {currentQuestion.options.map((opt) => {
                    const selected = getCurrentAnswer() === opt.id;
                    return (
                      <button
                        key={opt.id}
                        className={`${styles.choiceBtn} ${selected ? styles.choiceBtnSelected : ''}`}
                        onClick={() => handleSingleChoiceSelect(currentQuestion.id, opt.id)}
                      >
                        <span className={styles.choiceIndicator}>
                          <Check size={14} className={styles.choiceCheck} />
                        </span>
                        {opt.imageUrl && (
                          <img src={opt.imageUrl} alt="" className={styles.choiceImage} />
                        )}
                        {opt.text}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Choice type with 0 options — skip prompt */}
              {choiceTypeNoOptions && (
                <p className={styles.emptyNote}>No options configured for this question.</p>
              )}

              {/* Text input */}
              {currentQuestion.questionType === 'text_input' && (
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="Type your answer..."
                  value={(getCurrentAnswer() as string) || ''}
                  onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
                  autoFocus
                />
              )}

              {/* Number input */}
              {currentQuestion.questionType === 'number_input' && (
                <input
                  type="number"
                  className={styles.textInput}
                  placeholder="Enter a number..."
                  min={currentQuestion.minValue ?? undefined}
                  max={currentQuestion.maxValue ?? undefined}
                  value={(getCurrentAnswer() as string) || ''}
                  onChange={(e) => setAnswer(currentQuestion.id, e.target.value)}
                  autoFocus
                />
              )}

              {/* Rating */}
              {currentQuestion.questionType === 'rating' && (
                <div className={styles.ratingRow}>
                  {Array.from({ length: currentQuestion.ratingScale || 5 }, (_, i) => i + 1).map(
                    (n) => (
                      <button
                        key={n}
                        className={`${styles.ratingBtn} ${getCurrentAnswer() === String(n) ? styles.ratingBtnSelected : ''}`}
                        onClick={() => handleRatingSelect(currentQuestion.id, String(n))}
                      >
                        {n}
                      </button>
                    ),
                  )}
                </div>
              )}

              {/* Navigation — always show back + next/skip */}
              <div className={styles.navRow}>
                <button className={styles.backBtn} onClick={goToPrevQuestion}>
                  Back
                </button>
                {/* Auto-advance types (single_choice, image_choice, rating) don't need a next button
                    unless there are no options or the question is optional */}
                {(currentQuestion.questionType === 'single_choice' ||
                  currentQuestion.questionType === 'image_choice') &&
                  !choiceTypeNoOptions ? (
                  // Optional single-choice: show Skip if not required and no answer selected
                  !currentQuestion.isRequired && !getCurrentAnswer() ? (
                    <button className={styles.nextBtn} onClick={goToNextQuestion}>
                      Skip
                    </button>
                  ) : null
                ) : currentQuestion.questionType === 'rating' && !choiceTypeNoOptions ? (
                  !currentQuestion.isRequired && !getCurrentAnswer() ? (
                    <button className={styles.nextBtn} onClick={goToNextQuestion}>
                      Skip
                    </button>
                  ) : null
                ) : (
                  <button
                    className={styles.nextBtn}
                    onClick={goToNextQuestion}
                    disabled={currentQuestion.isRequired && !canProceed()}
                  >
                    {!currentQuestion.isRequired && !getCurrentAnswer() ? 'Skip' : 'Next'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Lead Capture Screen ───────────────────────────────── */}
          {screen === 'lead_capture' && (
            <div className={styles.leadScreen}>
              <h2 className={styles.leadHeading}>{quiz.leadCaptureHeading}</h2>
              <form className={styles.leadForm} onSubmit={handleLeadSubmit}>
                {quiz.leadCaptureFields.map((field) => (
                  <div
                    key={field.key}
                    className={`${styles.leadField} ${leadErrors[field.key] ? styles.leadFieldError : ''}`}
                  >
                    <label>
                      {field.label}
                      {field.isRequired && <span> *</span>}
                    </label>
                    <input
                      type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'}
                      value={leadData[field.key] || ''}
                      onChange={(e) => {
                        setLeadData((prev) => ({ ...prev, [field.key]: e.target.value }));
                        if (leadErrors[field.key]) {
                          setLeadErrors((prev) => {
                            const next = { ...prev };
                            delete next[field.key];
                            return next;
                          });
                        }
                      }}
                      placeholder={field.label}
                    />
                    {leadErrors[field.key] && (
                      <div className={styles.fieldError}>{leadErrors[field.key]}</div>
                    )}
                  </div>
                ))}
                <button type="submit" className={styles.submitBtn} disabled={submitting}>
                  {submitting ? 'Submitting...' : 'See My Result'}
                </button>
              </form>
            </div>
          )}

          {/* ── Result Screen ─────────────────────────────────────── */}
          {screen === 'result' && (
            <div className={styles.resultScreen}>
              {matchedResult ? (
                <>
                  {matchedResult.imageUrl && (
                    <img src={matchedResult.imageUrl} alt="" className={styles.resultImage} />
                  )}
                  <h2 className={styles.resultTitle}>{matchedResult.title}</h2>
                  {matchedResult.description && (
                    <p className={styles.resultDescription}>{matchedResult.description}</p>
                  )}
                  {matchedResult.ctaText && matchedResult.ctaUrl && (
                    <a
                      href={matchedResult.ctaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.ctaBtn}
                    >
                      {matchedResult.ctaText}
                    </a>
                  )}
                </>
              ) : (
                <h2 className={styles.resultTitle}>Thank you for completing the quiz!</h2>
              )}

              {/* After-results lead capture form */}
              {showAfterResultLeadCapture && (
                <div className={styles.afterResultLead}>
                  <h3 className={styles.afterResultLeadHeading}>{quiz.leadCaptureHeading}</h3>
                  <form className={styles.leadForm} onSubmit={handleLeadSubmit}>
                    {quiz.leadCaptureFields.map((field) => (
                      <div
                        key={field.key}
                        className={`${styles.leadField} ${leadErrors[field.key] ? styles.leadFieldError : ''}`}
                      >
                        <label>
                          {field.label}
                          {field.isRequired && <span> *</span>}
                        </label>
                        <input
                          type={field.key === 'email' ? 'email' : field.key === 'phone' ? 'tel' : 'text'}
                          value={leadData[field.key] || ''}
                          onChange={(e) => {
                            setLeadData((prev) => ({ ...prev, [field.key]: e.target.value }));
                            if (leadErrors[field.key]) {
                              setLeadErrors((prev) => {
                                const next = { ...prev };
                                delete next[field.key];
                                return next;
                              });
                            }
                          }}
                          placeholder={field.label}
                        />
                        {leadErrors[field.key] && (
                          <div className={styles.fieldError}>{leadErrors[field.key]}</div>
                        )}
                      </div>
                    ))}
                    <button type="submit" className={styles.submitBtn} disabled={submitting}>
                      {submitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </form>
                </div>
              )}

              {/* Confirmation after after-results lead submission */}
              {screen === 'result' &&
                hasLeadCapture &&
                quiz.leadCapturePosition === 'after_results' &&
                leadSubmittedAfterResult && (
                  <p className={styles.leadSubmittedNote}>Your details have been submitted. Thank you!</p>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
