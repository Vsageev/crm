import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';
import { createContact } from './contacts.js';
import { createDeal } from './deals.js';
import { findContactDuplicates } from './duplicates.js';
import { createNotification } from './notifications.js';

// ── Interfaces ──────────────────────────────────────────────────────────

interface AuditContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface QuizListQuery {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LeadCaptureFieldInput {
  key: string;
  label: string;
  isRequired: boolean;
  contactFieldMapping?: string | null;
}

export interface QuizQuestionInput {
  text: string;
  description?: string | null;
  questionType: string;
  position: number;
  isRequired?: boolean;
  minValue?: number | null;
  maxValue?: number | null;
  ratingScale?: number | null;
  options?: QuizAnswerOptionInput[];
}

export interface QuizAnswerOptionInput {
  text: string;
  imageUrl?: string | null;
  points?: number;
  jumpToQuestionId?: string | null;
  jumpToEnd?: boolean;
  position: number;
}

export interface QuizResultInput {
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  ctaText?: string | null;
  ctaUrl?: string | null;
  minScore?: number | null;
  maxScore?: number | null;
  isDefault?: boolean;
  position: number;
}

export interface CreateQuizData {
  name: string;
  description?: string | null;
  status?: string;
  startHeadline?: string;
  startDescription?: string | null;
  startButtonText?: string;
  startImageUrl?: string | null;
  leadCapturePosition?: string;
  leadCaptureHeading?: string;
  leadCaptureFields?: LeadCaptureFieldInput[];
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  assigneeId?: string | null;
  accentColor?: string | null;
  questions?: QuizQuestionInput[];
  results?: QuizResultInput[];
}

export interface UpdateQuizData {
  name?: string;
  description?: string | null;
  status?: string;
  startHeadline?: string;
  startDescription?: string | null;
  startButtonText?: string;
  startImageUrl?: string | null;
  leadCapturePosition?: string;
  leadCaptureHeading?: string;
  leadCaptureFields?: LeadCaptureFieldInput[];
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  assigneeId?: string | null;
  accentColor?: string | null;
  questions?: QuizQuestionInput[];
  results?: QuizResultInput[];
}

export interface SessionListQuery {
  quizId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface StartSessionData {
  quizId: string;
  ipAddress?: string;
  userAgent?: string;
  referrerUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

export interface UpdateSessionAnswersData {
  answers: Record<string, unknown>;
}

export interface CompleteSessionData {
  leadData?: Record<string, string>;
  answers?: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getQuestionsForQuiz(quizId: string) {
  return store
    .find('quizQuestions', (r) => r.quizId === quizId)
    .sort((a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0));
}

function getOptionsForQuestions(questionIds: string[]) {
  const idSet = new Set(questionIds);
  return store
    .find('quizAnswerOptions', (r) => idSet.has(r.questionId as string))
    .sort((a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0));
}

function getResultsForQuiz(quizId: string) {
  return store
    .find('quizResults', (r) => r.quizId === quizId)
    .sort((a, b) => ((a.position as number) ?? 0) - ((b.position as number) ?? 0));
}

function assembleQuiz(quiz: Record<string, unknown>) {
  const quizId = quiz.id as string;
  const questions = getQuestionsForQuiz(quizId);
  const questionIds = questions.map((q) => q.id as string);
  const allOptions = getOptionsForQuestions(questionIds);

  const optionsByQuestion = new Map<string, Record<string, unknown>[]>();
  for (const opt of allOptions) {
    const qId = opt.questionId as string;
    const arr = optionsByQuestion.get(qId);
    if (arr) arr.push(opt);
    else optionsByQuestion.set(qId, [opt]);
  }

  const questionsWithOptions = questions.map((q) => ({
    ...q,
    options: optionsByQuestion.get(q.id as string) ?? [],
  }));

  const results = getResultsForQuiz(quizId);

  return { ...quiz, questions: questionsWithOptions, results };
}

// ── Quiz CRUD ───────────────────────────────────────────────────────────

export async function listQuizzes(query: QuizListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (query.status && r.status !== query.status) return false;
    if (query.search && !(r.name as string)?.toLowerCase().includes(query.search.toLowerCase())) return false;
    return true;
  };

  const all = store
    .find('quizzes', predicate)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  const total = all.length;
  const page = all.slice(offset, offset + limit);

  // Attach session counts for list view
  const entries = page.map((quiz) => {
    const quizId = quiz.id as string;
    const totalSessions = store.count('quizSessions', (r) => r.quizId === quizId);
    const completedSessions = store.count(
      'quizSessions',
      (r) => r.quizId === quizId && r.status === 'completed',
    );
    return {
      ...quiz,
      totalSessions,
      completedSessions,
      completionRate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0,
    };
  });

  return { entries, total };
}

export async function getQuizById(id: string) {
  const quiz = store.getById('quizzes', id);
  if (!quiz) return null;
  return assembleQuiz(quiz);
}

export async function createQuiz(data: CreateQuizData, audit?: AuditContext) {
  const { questions, results, leadCaptureFields, ...quizData } = data;

  const quiz = store.insert('quizzes', {
    ...quizData,
    status: quizData.status ?? 'draft',
    startHeadline: quizData.startHeadline ?? 'Take the Quiz',
    startButtonText: quizData.startButtonText ?? 'Start Quiz',
    leadCapturePosition: quizData.leadCapturePosition ?? 'before_results',
    leadCaptureHeading: quizData.leadCaptureHeading ?? 'Enter your details to see your result',
    leadCaptureFields: leadCaptureFields ?? [],
  });

  const quizId = quiz.id as string;

  // Insert questions + their options
  if (questions && questions.length > 0) {
    for (const q of questions) {
      const { options, ...qData } = q;
      const question = store.insert('quizQuestions', { ...qData, quizId });
      if (options && options.length > 0) {
        store.insertMany(
          'quizAnswerOptions',
          options.map((opt) => ({
            ...opt,
            questionId: question.id as string,
            points: opt.points ?? 0,
            jumpToEnd: opt.jumpToEnd ?? false,
          })),
        );
      }
    }
  }

  // Insert results
  if (results && results.length > 0) {
    store.insertMany(
      'quizResults',
      results.map((r) => ({
        ...r,
        quizId,
        isDefault: r.isDefault ?? false,
      })),
    );
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'create',
      entityType: 'quiz',
      entityId: quizId,
      changes: quizData,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getQuizById(quizId);
}

export async function updateQuiz(id: string, data: UpdateQuizData, audit?: AuditContext) {
  const { questions, results, leadCaptureFields, ...quizData } = data;

  const setData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(quizData)) {
    if (value !== undefined) setData[key] = value;
  }
  if (leadCaptureFields !== undefined) setData.leadCaptureFields = leadCaptureFields;

  const updated = store.update('quizzes', id, setData);
  if (!updated) return null;

  // Replace questions + options if provided
  if (questions !== undefined) {
    // Delete old options for this quiz's questions
    const oldQuestions = store.find('quizQuestions', (r) => r.quizId === id);
    const oldQuestionIds = new Set(oldQuestions.map((q) => q.id as string));
    store.deleteWhere('quizAnswerOptions', (r) => oldQuestionIds.has(r.questionId as string));
    store.deleteWhere('quizQuestions', (r) => r.quizId === id);

    // Insert new questions + options
    for (const q of questions) {
      const { options, ...qData } = q;
      const question = store.insert('quizQuestions', { ...qData, quizId: id });
      if (options && options.length > 0) {
        store.insertMany(
          'quizAnswerOptions',
          options.map((opt) => ({
            ...opt,
            questionId: question.id as string,
            points: opt.points ?? 0,
            jumpToEnd: opt.jumpToEnd ?? false,
          })),
        );
      }
    }
  }

  // Replace results if provided
  if (results !== undefined) {
    store.deleteWhere('quizResults', (r) => r.quizId === id);
    if (results.length > 0) {
      store.insertMany(
        'quizResults',
        results.map((r) => ({
          ...r,
          quizId: id,
          isDefault: r.isDefault ?? false,
        })),
      );
    }
  }

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'update',
      entityType: 'quiz',
      entityId: id,
      changes: data as unknown as Record<string, unknown>,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return getQuizById(id);
}

export async function deleteQuiz(id: string, audit?: AuditContext) {
  const quiz = store.getById('quizzes', id);
  if (!quiz) return null;

  // Delete related data
  const questions = store.find('quizQuestions', (r) => r.quizId === id);
  const questionIds = new Set(questions.map((q) => q.id as string));
  store.deleteWhere('quizAnswerOptions', (r) => questionIds.has(r.questionId as string));
  store.deleteWhere('quizQuestions', (r) => r.quizId === id);
  store.deleteWhere('quizResults', (r) => r.quizId === id);
  store.deleteWhere('quizSessions', (r) => r.quizId === id);

  store.delete('quizzes', id);

  if (audit) {
    await createAuditLog({
      userId: audit.userId,
      action: 'delete',
      entityType: 'quiz',
      entityId: id,
      ipAddress: audit.ipAddress,
      userAgent: audit.userAgent,
    });
  }

  return quiz;
}

// ── Public quiz ─────────────────────────────────────────────────────────

export async function getPublicQuiz(id: string, preview = false) {
  const quiz = store.getById('quizzes', id);
  if (!quiz) return null;
  if (!preview && quiz.status !== 'active') return null;

  const full: any = assembleQuiz(quiz);

  // Strip internal fields for public consumption
  return {
    id: full.id,
    name: full.name,
    description: full.description,
    startHeadline: full.startHeadline,
    startDescription: full.startDescription,
    startButtonText: full.startButtonText,
    startImageUrl: full.startImageUrl,
    leadCapturePosition: full.leadCapturePosition,
    leadCaptureHeading: full.leadCaptureHeading,
    leadCaptureFields: full.leadCaptureFields,
    accentColor: full.accentColor,
    questions: full.questions.map((q: any) => ({
      id: q.id,
      text: q.text,
      description: q.description,
      questionType: q.questionType,
      position: q.position,
      isRequired: q.isRequired,
      minValue: q.minValue,
      maxValue: q.maxValue,
      ratingScale: q.ratingScale,
      options: q.options.map((o: any) => ({
        id: o.id,
        text: o.text,
        imageUrl: o.imageUrl,
        points: o.points,
        jumpToQuestionId: o.jumpToQuestionId,
        jumpToEnd: o.jumpToEnd,
        position: o.position,
      })),
    })),
    results: full.results.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      imageUrl: r.imageUrl,
      ctaText: r.ctaText,
      ctaUrl: r.ctaUrl,
      minScore: r.minScore,
      maxScore: r.maxScore,
      isDefault: r.isDefault,
      position: r.position,
    })),
  };
}

// ── Sessions ────────────────────────────────────────────────────────────

export async function startSession(data: StartSessionData) {
  const session = store.insert('quizSessions', {
    quizId: data.quizId,
    status: 'in_progress',
    answers: {},
    totalScore: 0,
    matchedResultId: null,
    leadData: null,
    contactId: null,
    dealId: null,
    ipAddress: data.ipAddress ?? null,
    userAgent: data.userAgent ?? null,
    referrerUrl: data.referrerUrl ?? null,
    utmSource: data.utmSource ?? null,
    utmMedium: data.utmMedium ?? null,
    utmCampaign: data.utmCampaign ?? null,
    utmTerm: data.utmTerm ?? null,
    utmContent: data.utmContent ?? null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  });
  return session;
}

export async function updateSessionAnswers(sessionId: string, data: UpdateSessionAnswersData) {
  const session = store.getById('quizSessions', sessionId);
  if (!session) return null;

  const existingAnswers = (session.answers as Record<string, unknown>) ?? {};
  const merged = { ...existingAnswers, ...data.answers };

  const updated = store.update('quizSessions', sessionId, { answers: merged });
  return updated;
}

export async function completeSession(quizId: string, sessionId: string, data: CompleteSessionData) {
  const session = store.getById('quizSessions', sessionId);
  if (!session || session.quizId !== quizId) return null;

  const quiz = store.getById('quizzes', quizId);
  if (!quiz) return null;

  // Merge any final answers
  let answers = (session.answers as Record<string, unknown>) ?? {};
  if (data.answers) {
    answers = { ...answers, ...data.answers };
  }

  // Calculate score
  const questions = getQuestionsForQuiz(quizId);
  const questionIds = questions.map((q) => q.id as string);
  const allOptions = getOptionsForQuestions(questionIds);

  let totalScore = 0;
  for (const [_questionId, answerValue] of Object.entries(answers)) {
    // answerValue can be a single optionId (string) or array of optionIds
    const selectedIds = Array.isArray(answerValue) ? answerValue : [answerValue];
    for (const optId of selectedIds) {
      if (typeof optId === 'string') {
        const option = allOptions.find((o) => o.id === optId);
        if (option) {
          totalScore += (option.points as number) ?? 0;
        }
      }
    }
  }

  // Match result
  const results = getResultsForQuiz(quizId);
  let matchedResultId: string | null = null;

  // First try to find a result where the score falls within [minScore, maxScore]
  for (const result of results) {
    const min = result.minScore as number | null;
    const max = result.maxScore as number | null;
    if (min !== null && max !== null && totalScore >= min && totalScore <= max) {
      matchedResultId = result.id as string;
      break;
    }
    if (min !== null && max === null && totalScore >= min) {
      matchedResultId = result.id as string;
      break;
    }
    if (min === null && max !== null && totalScore <= max) {
      matchedResultId = result.id as string;
      break;
    }
  }

  // Fallback to default result
  if (!matchedResultId) {
    const defaultResult = results.find((r) => r.isDefault === true);
    if (defaultResult) {
      matchedResultId = defaultResult.id as string;
    }
  }

  // Process lead data → create contact + deal
  let contactId: string | null = null;
  let dealId: string | null = null;
  const leadData = data.leadData ?? null;

  if (leadData) {
    try {
      const result = await processQuizLead(quiz, session, leadData);
      contactId = result.contactId;
      dealId = result.dealId;
    } catch {
      // Non-critical — session is still saved
    }
  }

  const updated = store.update('quizSessions', sessionId, {
    answers,
    totalScore,
    matchedResultId,
    leadData,
    contactId,
    dealId,
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  return updated;
}

// ── Lead processing ─────────────────────────────────────────────────────

const CONTACT_FIELD_MAPPINGS = ['firstName', 'lastName', 'email', 'phone', 'position', 'notes'] as const;
type ContactFieldKey = (typeof CONTACT_FIELD_MAPPINGS)[number];

async function processQuizLead(
  quiz: Record<string, unknown>,
  session: Record<string, unknown>,
  leadData: Record<string, string>,
) {
  const leadCaptureFields = (quiz.leadCaptureFields as { key: string; contactFieldMapping: string | null }[]) ?? [];

  // Map lead data to contact fields
  const contactData: Partial<Record<ContactFieldKey, string>> = {};
  for (const field of leadCaptureFields) {
    if (
      field.contactFieldMapping &&
      CONTACT_FIELD_MAPPINGS.includes(field.contactFieldMapping as ContactFieldKey)
    ) {
      const value = leadData[field.key];
      if (value !== undefined && value !== null && value !== '') {
        contactData[field.contactFieldMapping as ContactFieldKey] = value;
      }
    }
  }

  // Also try direct mapping from common keys
  if (!contactData.firstName && leadData.name) contactData.firstName = leadData.name;
  if (!contactData.firstName && leadData.firstName) contactData.firstName = leadData.firstName;
  if (!contactData.email && leadData.email) contactData.email = leadData.email;
  if (!contactData.phone && leadData.phone) contactData.phone = leadData.phone;

  if (!contactData.firstName) {
    if (contactData.email) {
      contactData.firstName = contactData.email.split('@')[0];
    } else {
      return { contactId: null, dealId: null };
    }
  }

  // Check for duplicates
  let contactId: string | null = null;
  const dupeResult = await findContactDuplicates({
    email: contactData.email,
    phone: contactData.phone,
    firstName: contactData.firstName,
    lastName: contactData.lastName,
  });

  if (dupeResult.hasDuplicates) {
    contactId = dupeResult.duplicates[0].id;
  }

  const utmFields = {
    utmSource: (session.utmSource as string) ?? undefined,
    utmMedium: (session.utmMedium as string) ?? undefined,
    utmCampaign: (session.utmCampaign as string) ?? undefined,
    utmTerm: (session.utmTerm as string) ?? undefined,
    utmContent: (session.utmContent as string) ?? undefined,
    referrerUrl: (session.referrerUrl as string) ?? undefined,
  };

  if (!contactId) {
    const contact = await createContact({
      firstName: contactData.firstName,
      lastName: contactData.lastName,
      email: contactData.email,
      phone: contactData.phone,
      position: contactData.position,
      notes: contactData.notes,
      source: 'quiz',
      ownerId: (quiz.assigneeId as string) ?? undefined,
      ...utmFields,
    });
    contactId = contact.id as string;
  }

  let dealId: string | null = null;
  if (quiz.pipelineId && quiz.pipelineStageId) {
    const dealTitle = contactData.email
      ? `Quiz lead — ${contactData.email}`
      : `Quiz lead — ${contactData.firstName}${contactData.lastName ? ' ' + contactData.lastName : ''}`;

    const deal = await createDeal({
      title: dealTitle,
      pipelineId: quiz.pipelineId as string,
      pipelineStageId: quiz.pipelineStageId as string,
      contactId: contactId ?? undefined,
      ownerId: (quiz.assigneeId as string) ?? undefined,
      stage: 'new',
      leadSource: 'quiz',
      ...utmFields,
    });
    dealId = deal.id as string;
  }

  // Notify the assignee
  if (quiz.assigneeId) {
    createNotification({
      userId: quiz.assigneeId as string,
      type: 'lead_assigned',
      title: 'New lead from quiz',
      message: `A new quiz completion was received from "${quiz.name}"${contactData.email ? ` (${contactData.email})` : ''}.`,
      entityType: dealId ? 'deal' : 'contact',
      entityId: (dealId ?? contactId) as string,
    }).catch(() => {});
  }

  return { contactId, dealId };
}

// ── Session list & stats ────────────────────────────────────────────────

export async function listQuizSessions(query: SessionListQuery) {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const predicate = (r: Record<string, unknown>) => {
    if (query.quizId && r.quizId !== query.quizId) return false;
    if (query.status && r.status !== query.status) return false;
    return true;
  };

  const all = store
    .find('quizSessions', predicate)
    .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  const total = all.length;
  const entries = all.slice(offset, offset + limit);

  return { entries, total };
}

export async function getQuizStats(quizId: string) {
  const totalSessions = store.count('quizSessions', (r) => r.quizId === quizId);
  const completedSessions = store.count(
    'quizSessions',
    (r) => r.quizId === quizId && r.status === 'completed',
  );
  const abandonedSessions = store.count(
    'quizSessions',
    (r) => r.quizId === quizId && r.status === 'abandoned',
  );
  const sessionsWithContacts = store.count(
    'quizSessions',
    (r) => r.quizId === quizId && r.status === 'completed' && r.contactId != null,
  );

  return {
    totalSessions,
    completedSessions,
    abandonedSessions,
    completionRate: totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0,
    leadConversionRate:
      completedSessions > 0 ? Math.round((sessionsWithContacts / completedSessions) * 100) : 0,
  };
}
