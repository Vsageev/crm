import { type FormEvent, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, AlertCircle, ChevronUp, ChevronDown, Copy, ExternalLink } from 'lucide-react';
import { PageHeader } from '../../layout';
import { Button, Card, Input, Select, Textarea } from '../../ui';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/error-messages';
import styles from './QuizBuilderPage.module.css';

// ── Types ──────────────────────────────────────────────────────────────

type QuestionType = 'single_choice' | 'multiple_choice' | 'image_choice' | 'text_input' | 'number_input' | 'rating';

interface AnswerOption {
  text: string;
  imageUrl: string;
  points: number;
  jumpToQuestionId: string;
  jumpToEnd: boolean;
  position: number;
}

interface Question {
  text: string;
  description: string;
  questionType: QuestionType;
  position: number;
  isRequired: boolean;
  minValue: string;
  maxValue: string;
  ratingScale: string;
  options: AnswerOption[];
}

interface LeadField {
  key: string;
  label: string;
  isRequired: boolean;
  contactFieldMapping: string;
}

interface QuizResult {
  title: string;
  description: string;
  imageUrl: string;
  ctaText: string;
  ctaUrl: string;
  minScore: string;
  maxScore: string;
  isDefault: boolean;
  position: number;
}

interface PipelineOption {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

interface UserOption {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

type Tab = 'settings' | 'questions' | 'results' | 'publish';

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'single_choice', label: 'Single Choice' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'image_choice', label: 'Image Choice' },
  { value: 'text_input', label: 'Text Input' },
  { value: 'number_input', label: 'Number Input' },
  { value: 'rating', label: 'Rating' },
];

const CONTACT_FIELD_OPTIONS = [
  { value: '', label: 'No mapping' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'position', label: 'Position' },
  { value: 'notes', label: 'Notes' },
];

function emptyOption(position: number): AnswerOption {
  return { text: '', imageUrl: '', points: 0, jumpToQuestionId: '', jumpToEnd: false, position };
}

function emptyQuestion(position: number): Question {
  return {
    text: '',
    description: '',
    questionType: 'single_choice',
    position,
    isRequired: true,
    minValue: '',
    maxValue: '',
    ratingScale: '5',
    options: [emptyOption(0), emptyOption(1)],
  };
}

function emptyResult(position: number): QuizResult {
  return {
    title: '',
    description: '',
    imageUrl: '',
    ctaText: '',
    ctaUrl: '',
    minScore: '',
    maxScore: '',
    isDefault: false,
    position,
  };
}

function emptyLeadField(): LeadField {
  return { key: '', label: '', isRequired: false, contactFieldMapping: '' };
}

const hasChoiceOptions = (t: QuestionType) =>
  t === 'single_choice' || t === 'multiple_choice' || t === 'image_choice';

// ── Component ──────────────────────────────────────────────────────────

export function QuizBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [activeTab, setActiveTab] = useState<Tab>('settings');

  // Settings
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'inactive' | 'archived'>('draft');
  const [startHeadline, setStartHeadline] = useState('Take the Quiz');
  const [startDescription, setStartDescription] = useState('');
  const [startButtonText, setStartButtonText] = useState('Start Quiz');
  const [startImageUrl, setStartImageUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [leadCapturePosition, setLeadCapturePosition] = useState('before_results');
  const [leadCaptureHeading, setLeadCaptureHeading] = useState('Enter your details to see your result');
  const [leadCaptureFields, setLeadCaptureFields] = useState<LeadField[]>([
    { key: 'name', label: 'Name', isRequired: true, contactFieldMapping: 'firstName' },
    { key: 'email', label: 'Email', isRequired: true, contactFieldMapping: 'email' },
    { key: 'phone', label: 'Phone', isRequired: false, contactFieldMapping: 'phone' },
  ]);

  // CRM integration
  const [pipelineId, setPipelineId] = useState('');
  const [pipelineStageId, setPipelineStageId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  // Questions
  const [questions, setQuestions] = useState<Question[]>([emptyQuestion(0)]);

  // Results
  const [results, setResults] = useState<QuizResult[]>([
    { ...emptyResult(0), isDefault: true, title: 'Your Result' },
  ]);

  // Reference data
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  // State
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);
  const [copied, setCopied] = useState('');

  // Fetch reference data
  useEffect(() => {
    async function fetchOptions() {
      try {
        const [pRes, uRes] = await Promise.all([
          api<{ entries: PipelineOption[] }>('/pipelines?limit=200').catch(() => ({ entries: [] })),
          api<{ entries: UserOption[] }>('/users?limit=200').catch(() => ({ entries: [] })),
        ]);
        setPipelines(pRes.entries);
        setUsers(uRes.entries);
      } catch { /* non-critical */ }
    }
    fetchOptions();
  }, []);

  // Fetch existing quiz for edit
  useEffect(() => {
    if (!id) return;
    async function fetchQuiz() {
      setFetching(true);
      try {
        const data = await api<any>(`/quizzes/${id}`);
        setName(data.name || '');
        setDescription(data.description || '');
        setStatus(data.status || 'draft');
        setStartHeadline(data.startHeadline || 'Take the Quiz');
        setStartDescription(data.startDescription || '');
        setStartButtonText(data.startButtonText || 'Start Quiz');
        setStartImageUrl(data.startImageUrl || '');
        setAccentColor(data.accentColor || '');
        setLeadCapturePosition(data.leadCapturePosition || 'before_results');
        setLeadCaptureHeading(data.leadCaptureHeading || '');
        setLeadCaptureFields(
          (data.leadCaptureFields || []).map((f: any) => ({
            key: f.key || '',
            label: f.label || '',
            isRequired: f.isRequired ?? false,
            contactFieldMapping: f.contactFieldMapping || '',
          })),
        );
        setPipelineId(data.pipelineId || '');
        setPipelineStageId(data.pipelineStageId || '');
        setAssigneeId(data.assigneeId || '');

        if (data.questions?.length) {
          setQuestions(
            data.questions.map((q: any, qi: number) => ({
              text: q.text || '',
              description: q.description || '',
              questionType: q.questionType || 'single_choice',
              position: qi,
              isRequired: q.isRequired ?? true,
              minValue: q.minValue != null ? String(q.minValue) : '',
              maxValue: q.maxValue != null ? String(q.maxValue) : '',
              ratingScale: q.ratingScale != null ? String(q.ratingScale) : '5',
              options: (q.options || []).map((o: any, oi: number) => ({
                text: o.text || '',
                imageUrl: o.imageUrl || '',
                points: o.points ?? 0,
                jumpToQuestionId: o.jumpToQuestionId || '',
                jumpToEnd: o.jumpToEnd ?? false,
                position: oi,
              })),
            })),
          );
        }

        if (data.results?.length) {
          setResults(
            data.results.map((r: any, ri: number) => ({
              title: r.title || '',
              description: r.description || '',
              imageUrl: r.imageUrl || '',
              ctaText: r.ctaText || '',
              ctaUrl: r.ctaUrl || '',
              minScore: r.minScore != null ? String(r.minScore) : '',
              maxScore: r.maxScore != null ? String(r.maxScore) : '',
              isDefault: r.isDefault ?? false,
              position: ri,
            })),
          );
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setFetching(false);
      }
    }
    fetchQuiz();
  }, [id]);

  // ── Question helpers ──────────────────────────────────────────────────

  function updateQuestion(index: number, updates: Partial<Question>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...updates } : q)));
  }

  function addQuestion() {
    setQuestions((prev) => [...prev, emptyQuestion(prev.length)]);
  }

  function removeQuestion(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index).map((q, i) => ({ ...q, position: i })));
  }

  function moveQuestion(index: number, dir: -1 | 1) {
    setQuestions((prev) => {
      const arr = [...prev];
      const target = index + dir;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr.map((q, i) => ({ ...q, position: i }));
    });
  }

  function updateOption(qIndex: number, oIndex: number, updates: Partial<AnswerOption>) {
    setQuestions((prev) =>
      prev.map((q, qi) =>
        qi === qIndex
          ? { ...q, options: q.options.map((o, oi) => (oi === oIndex ? { ...o, ...updates } : o)) }
          : q,
      ),
    );
  }

  function addOption(qIndex: number) {
    setQuestions((prev) =>
      prev.map((q, qi) =>
        qi === qIndex
          ? { ...q, options: [...q.options, emptyOption(q.options.length)] }
          : q,
      ),
    );
  }

  function removeOption(qIndex: number, oIndex: number) {
    setQuestions((prev) =>
      prev.map((q, qi) =>
        qi === qIndex
          ? { ...q, options: q.options.filter((_, oi) => oi !== oIndex).map((o, i) => ({ ...o, position: i })) }
          : q,
      ),
    );
  }

  // ── Result helpers ────────────────────────────────────────────────────

  function updateResult(index: number, updates: Partial<QuizResult>) {
    setResults((prev) => prev.map((r, i) => (i === index ? { ...r, ...updates } : r)));
  }

  function addResult() {
    setResults((prev) => [...prev, emptyResult(prev.length)]);
  }

  function removeResult(index: number) {
    setResults((prev) => prev.filter((_, i) => i !== index).map((r, i) => ({ ...r, position: i })));
  }

  function setDefaultResult(index: number) {
    setResults((prev) => prev.map((r, i) => ({ ...r, isDefault: i === index })));
  }

  // ── Lead field helpers ────────────────────────────────────────────────

  function updateLeadField(index: number, updates: Partial<LeadField>) {
    setLeadCaptureFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  }

  function addLeadField() {
    setLeadCaptureFields((prev) => [...prev, emptyLeadField()]);
  }

  function removeLeadField(index: number) {
    setLeadCaptureFields((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Submit ────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Quiz name is required');
      setActiveTab('settings');
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        status,
        startHeadline: startHeadline.trim(),
        startDescription: startDescription.trim() || null,
        startButtonText: startButtonText.trim(),
        startImageUrl: startImageUrl.trim() || null,
        accentColor: accentColor.trim() || null,
        leadCapturePosition,
        leadCaptureHeading: leadCaptureHeading.trim(),
        leadCaptureFields: leadCaptureFields
          .filter((f) => f.key.trim() && f.label.trim())
          .map((f) => ({
            key: f.key.trim(),
            label: f.label.trim(),
            isRequired: f.isRequired,
            contactFieldMapping: f.contactFieldMapping || null,
          })),
        pipelineId: pipelineId || null,
        pipelineStageId: pipelineStageId || null,
        assigneeId: assigneeId || null,
        questions: questions
          .filter((q) => q.text.trim())
          .map((q, qi) => ({
            text: q.text.trim(),
            description: q.description.trim() || null,
            questionType: q.questionType,
            position: qi,
            isRequired: q.isRequired,
            minValue: q.minValue ? Number(q.minValue) : null,
            maxValue: q.maxValue ? Number(q.maxValue) : null,
            ratingScale: q.ratingScale ? Number(q.ratingScale) : null,
            options: hasChoiceOptions(q.questionType)
              ? q.options
                  .filter((o) => o.text.trim())
                  .map((o, oi) => ({
                    text: o.text.trim(),
                    imageUrl: o.imageUrl.trim() || null,
                    points: o.points || 0,
                    jumpToQuestionId: o.jumpToQuestionId || null,
                    jumpToEnd: o.jumpToEnd,
                    position: oi,
                  }))
              : [],
          })),
        results: results
          .filter((r) => r.title.trim())
          .map((r, ri) => ({
            title: r.title.trim(),
            description: r.description.trim() || null,
            imageUrl: r.imageUrl.trim() || null,
            ctaText: r.ctaText.trim() || null,
            ctaUrl: r.ctaUrl.trim() || null,
            minScore: r.minScore ? Number(r.minScore) : null,
            maxScore: r.maxScore ? Number(r.maxScore) : null,
            isDefault: r.isDefault,
            position: ri,
          })),
      };

      if (isEdit) {
        await api(`/quizzes/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/quizzes', { method: 'POST', body: JSON.stringify(body) });
      }
      navigate('/quizzes', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => {});
  }

  if (fetching) {
    return (
      <div>
        <PageHeader title={isEdit ? 'Edit Quiz' : 'New Quiz'} />
        <div className={styles.loadingState}>Loading quiz...</div>
      </div>
    );
  }

  const selectedPipeline = pipelines.find((p) => p.id === pipelineId);
  const quizUrl = id ? `${window.location.origin}/quiz/${id}` : '';
  const directLink = id ? `${quizUrl}?preview=1` : '';
  const embedCode = id
    ? `<iframe src="${quizUrl}" width="100%" height="700" frameborder="0" style="border:none;border-radius:12px;"></iframe>`
    : '';

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Quiz' : 'New Quiz'}
        description={isEdit ? 'Update quiz configuration' : 'Create a new interactive quiz'}
      />

      <div className={styles.backLink}>
        <Link to="/quizzes" className={styles.back}>
          <ArrowLeft size={14} /> All Quizzes
        </Link>
      </div>

      {/* Tab navigation */}
      <div className={styles.tabs}>
        {(['settings', 'questions', 'results', 'publish'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <Card className={styles.formCard}>
        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.alert}>
              <AlertCircle size={16} className={styles.alertIcon} />
              {error}
            </div>
          )}

          {/* ── Settings Tab ─────────────────────────────────────────── */}
          {activeTab === 'settings' && (
            <>
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Basic Info</h3>
                <Input
                  label="Quiz Name"
                  placeholder="e.g. Find Your Perfect Plan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
                <Textarea
                  label="Description"
                  placeholder="Internal description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
                <Select
                  label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </Select>
              </div>

              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Start Page</h3>
                <Input
                  label="Headline"
                  placeholder="Take the Quiz"
                  value={startHeadline}
                  onChange={(e) => setStartHeadline(e.target.value)}
                />
                <Textarea
                  label="Description"
                  placeholder="Describe what the quiz is about..."
                  value={startDescription}
                  onChange={(e) => setStartDescription(e.target.value)}
                  rows={2}
                />
                <div className={styles.row}>
                  <Input
                    label="Button Text"
                    placeholder="Start Quiz"
                    value={startButtonText}
                    onChange={(e) => setStartButtonText(e.target.value)}
                  />
                  <Input
                    label="Accent Color"
                    placeholder="#4F46E5"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                  />
                </div>
                <Input
                  label="Cover Image URL"
                  placeholder="https://..."
                  value={startImageUrl}
                  onChange={(e) => setStartImageUrl(e.target.value)}
                />
              </div>

              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Lead Capture</h3>
                <div className={styles.row}>
                  <Select
                    label="Position"
                    value={leadCapturePosition}
                    onChange={(e) => setLeadCapturePosition(e.target.value)}
                  >
                    <option value="before_results">Before Results</option>
                    <option value="after_results">After Results</option>
                  </Select>
                  <Input
                    label="Heading"
                    value={leadCaptureHeading}
                    onChange={(e) => setLeadCaptureHeading(e.target.value)}
                  />
                </div>

                <div className={styles.optionsList}>
                  {leadCaptureFields.map((field, fi) => (
                    <div key={fi} className={styles.leadFieldRow}>
                      <input
                        placeholder="Key (e.g. name)"
                        value={field.key}
                        onChange={(e) => updateLeadField(fi, { key: e.target.value })}
                      />
                      <input
                        placeholder="Label"
                        value={field.label}
                        onChange={(e) => updateLeadField(fi, { label: e.target.value })}
                      />
                      <select
                        value={field.contactFieldMapping}
                        onChange={(e) => updateLeadField(fi, { contactFieldMapping: e.target.value })}
                      >
                        {CONTACT_FIELD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={field.isRequired}
                        onChange={(e) => updateLeadField(fi, { isRequired: e.target.checked })}
                        title="Required"
                      />
                      <button type="button" className={styles.removeBtn} onClick={() => removeLeadField(fi)}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div>
                  <button type="button" className={styles.addBtn} onClick={addLeadField}>
                    <Plus size={14} /> Add Field
                  </button>
                </div>
              </div>

              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>CRM Integration</h3>
                <div className={styles.row}>
                  <Select
                    label="Pipeline"
                    value={pipelineId}
                    onChange={(e) => { setPipelineId(e.target.value); setPipelineStageId(''); }}
                  >
                    <option value="">None</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                  <Select
                    label="Stage"
                    value={pipelineStageId}
                    onChange={(e) => setPipelineStageId(e.target.value)}
                  >
                    <option value="">Select stage...</option>
                    {(selectedPipeline?.stages || []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </div>
                <Select
                  label="Assign to"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {/* ── Questions Tab ────────────────────────────────────────── */}
          {activeTab === 'questions' && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Questions</h3>

              {questions.map((q, qi) => (
                <div key={qi} className={styles.questionCard}>
                  <div className={styles.questionHeader}>
                    <span className={styles.questionNumber}>Q{qi + 1}</span>
                    <Select
                      value={q.questionType}
                      onChange={(e) => updateQuestion(qi, { questionType: e.target.value as QuestionType })}
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </Select>
                    <div className={styles.questionActions}>
                      <button type="button" className={styles.iconBtn} onClick={() => moveQuestion(qi, -1)} disabled={qi === 0} title="Move up">
                        <ChevronUp size={16} />
                      </button>
                      <button type="button" className={styles.iconBtn} onClick={() => moveQuestion(qi, 1)} disabled={qi === questions.length - 1} title="Move down">
                        <ChevronDown size={16} />
                      </button>
                      <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => removeQuestion(qi)} title="Remove">
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  <Input
                    placeholder="Question text..."
                    value={q.text}
                    onChange={(e) => updateQuestion(qi, { text: e.target.value })}
                  />
                  <Input
                    placeholder="Description / hint (optional)"
                    value={q.description}
                    onChange={(e) => updateQuestion(qi, { description: e.target.value })}
                  />

                  <div className={styles.toggleRow}>
                    <button
                      type="button"
                      className={`${styles.toggle} ${q.isRequired ? styles.toggleOn : styles.toggleOff}`}
                      onClick={() => updateQuestion(qi, { isRequired: !q.isRequired })}
                    >
                      <div className={styles.toggleKnob} />
                    </button>
                    <span className={styles.toggleLabel}>Required</span>
                  </div>

                  {q.questionType === 'number_input' && (
                    <div className={styles.row}>
                      <Input
                        label="Min Value"
                        type="number"
                        value={q.minValue}
                        onChange={(e) => updateQuestion(qi, { minValue: e.target.value })}
                      />
                      <Input
                        label="Max Value"
                        type="number"
                        value={q.maxValue}
                        onChange={(e) => updateQuestion(qi, { maxValue: e.target.value })}
                      />
                    </div>
                  )}

                  {q.questionType === 'rating' && (
                    <Input
                      label="Rating Scale"
                      type="number"
                      min="2"
                      max="10"
                      value={q.ratingScale}
                      onChange={(e) => updateQuestion(qi, { ratingScale: e.target.value })}
                    />
                  )}

                  {hasChoiceOptions(q.questionType) && (
                    <>
                      <div className={styles.optionsList}>
                        {q.options.map((opt, oi) => (
                          <div key={oi} className={styles.optionRow}>
                            <input
                              placeholder={`Option ${oi + 1}`}
                              value={opt.text}
                              onChange={(e) => updateOption(qi, oi, { text: e.target.value })}
                            />
                            <input
                              type="number"
                              placeholder="Points"
                              value={opt.points || ''}
                              onChange={(e) => updateOption(qi, oi, { points: Number(e.target.value) || 0 })}
                            />
                            <select
                              value={opt.jumpToEnd ? '__end' : opt.jumpToQuestionId || ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '__end') {
                                  updateOption(qi, oi, { jumpToEnd: true, jumpToQuestionId: '' });
                                } else {
                                  updateOption(qi, oi, { jumpToEnd: false, jumpToQuestionId: v });
                                }
                              }}
                            >
                              <option value="">Next question</option>
                              {questions.map((_, idx) =>
                                idx !== qi ? (
                                  <option key={idx} value={`__q${idx}`}>
                                    Jump to Q{idx + 1}
                                  </option>
                                ) : null,
                              )}
                              <option value="__end">Jump to end</option>
                            </select>
                            <button type="button" className={styles.removeBtn} onClick={() => removeOption(qi, oi)}>
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div>
                        <button type="button" className={styles.addBtn} onClick={() => addOption(qi)}>
                          <Plus size={14} /> Add Option
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}

              <div>
                <button type="button" className={styles.addBtn} onClick={addQuestion}>
                  <Plus size={14} /> Add Question
                </button>
              </div>
            </div>
          )}

          {/* ── Results Tab ──────────────────────────────────────────── */}
          {activeTab === 'results' && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Result Pages</h3>

              {results.map((r, ri) => (
                <div key={ri} className={styles.resultCard}>
                  <div className={styles.resultHeader}>
                    <span className={styles.resultLabel}>
                      Result {ri + 1}
                      {r.isDefault && <span className={styles.defaultBadge}>Default</span>}
                    </span>
                    <div className={styles.questionActions}>
                      {!r.isDefault && (
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => setDefaultResult(ri)}
                          title="Set as default"
                        >
                          Default
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => removeResult(ri)}
                        title="Remove"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  <Input
                    label="Title"
                    placeholder="e.g. You're a Starter!"
                    value={r.title}
                    onChange={(e) => updateResult(ri, { title: e.target.value })}
                  />
                  <Textarea
                    label="Description"
                    placeholder="Describe this result..."
                    value={r.description}
                    onChange={(e) => updateResult(ri, { description: e.target.value })}
                    rows={3}
                  />
                  <Input
                    label="Image URL"
                    placeholder="https://..."
                    value={r.imageUrl}
                    onChange={(e) => updateResult(ri, { imageUrl: e.target.value })}
                  />

                  <div className={styles.row}>
                    <Input
                      label="CTA Button Text"
                      placeholder="Learn More"
                      value={r.ctaText}
                      onChange={(e) => updateResult(ri, { ctaText: e.target.value })}
                    />
                    <Input
                      label="CTA URL"
                      placeholder="https://..."
                      value={r.ctaUrl}
                      onChange={(e) => updateResult(ri, { ctaUrl: e.target.value })}
                    />
                  </div>

                  <div className={styles.scoreRow}>
                    <input
                      type="number"
                      placeholder="Min Score"
                      value={r.minScore}
                      onChange={(e) => updateResult(ri, { minScore: e.target.value })}
                    />
                    <input
                      type="number"
                      placeholder="Max Score"
                      value={r.maxScore}
                      onChange={(e) => updateResult(ri, { maxScore: e.target.value })}
                    />
                  </div>
                </div>
              ))}

              <div>
                <button type="button" className={styles.addBtn} onClick={addResult}>
                  <Plus size={14} /> Add Result
                </button>
              </div>
            </div>
          )}

          {/* ── Publish Tab ──────────────────────────────────────────── */}
          {activeTab === 'publish' && (
            <div className={styles.publishSection}>
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Status</h3>
                <Select
                  label="Quiz Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </Select>
              </div>

              {isEdit && (
                <>
                  <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Direct Link</h3>
                    <div className={styles.linkRow}>
                      <input className={styles.linkInput} readOnly value={directLink} />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCopy(directLink, 'link')}
                      >
                        <Copy size={14} />
                        {copied === 'link' ? 'Copied!' : 'Copy'}
                      </Button>
                      <a href={directLink} target="_blank" rel="noopener noreferrer">
                        <Button type="button" variant="secondary" size="sm">
                          <ExternalLink size={14} /> Open
                        </Button>
                      </a>
                    </div>
                  </div>

                  <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Embed Code</h3>
                    <textarea className={styles.embedCode} readOnly rows={3} value={embedCode} />
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCopy(embedCode, 'embed')}
                      >
                        <Copy size={14} />
                        {copied === 'embed' ? 'Copied!' : 'Copy Embed Code'}
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {!isEdit && (
                <div className={styles.emptyState}>
                  Save the quiz first to get the embed code and direct link.
                </div>
              )}
            </div>
          )}

          {/* ── Form Actions ─────────────────────────────────────────── */}
          <div className={styles.formActions}>
            <Link to="/quizzes">
              <Button type="button" variant="secondary" size="md">Cancel</Button>
            </Link>
            <Button type="submit" size="md" disabled={loading}>
              {loading ? (isEdit ? 'Saving...' : 'Creating...') : isEdit ? 'Save Changes' : 'Create Quiz'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
