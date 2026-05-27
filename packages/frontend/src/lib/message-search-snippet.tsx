import {
  useFeatureFlags,
  type MessageSearchSenderStyle,
} from '../devtools/feature-flags';
import styles from './message-search-snippet.module.css';

export type MessageSearchSnippetData = {
  snippet: string;
  matchStart: number;
  matchLength: number;
  direction: 'inbound' | 'outbound';
  agentName: string;
};

function getSenderLabel(data: MessageSearchSnippetData): string {
  return data.direction === 'outbound' ? 'You' : data.agentName;
}

function HighlightedSnippet({ data }: { data: MessageSearchSnippetData }) {
  const start = Math.max(0, data.matchStart);
  const end = Math.min(data.snippet.length, start + Math.max(0, data.matchLength));
  const before = data.snippet.slice(0, start);
  const match = data.snippet.slice(start, end);
  const after = data.snippet.slice(end);

  return (
    <>
      {before}
      {match ? <mark className={styles.mark}>{match}</mark> : null}
      {after}
    </>
  );
}

export function renderMessageSearchSnippetForStyle(
  data: MessageSearchSnippetData,
  style: MessageSearchSenderStyle,
) {
  const isUserMessage = data.direction === 'outbound';
  const label = getSenderLabel(data);
  const text = <HighlightedSnippet data={data} />;

  switch (style) {
    case 'inbox-prefix':
      return (
        <span className={styles.root}>
          <span className={isUserMessage ? styles.prefixUser : styles.prefixAgent}>{label}: </span>
          {text}
        </span>
      );
    case 'badge':
      return (
        <span className={styles.root}>
          <span
            className={`${styles.badge} ${isUserMessage ? styles.badgeUser : styles.badgeAgent}`}
          >
            {label}
          </span>
          {text}
        </span>
      );
    case 'accent-bar':
      return (
        <span
          className={`${styles.accentBar} ${
            isUserMessage ? styles.accentBarUser : styles.accentBarAgent
          }`}
        >
          {text}
        </span>
      );
    case 'role-dot':
      return (
        <span className={styles.root}>
          <span
            className={`${styles.roleDot} ${
              isUserMessage ? styles.roleDotUser : styles.roleDotAgent
            }`}
            aria-hidden
          />
          <span className={isUserMessage ? styles.roleLabelUser : styles.roleLabelAgent}>
            {label}
          </span>
          <span className={styles.roleSep} aria-hidden>
            ·
          </span>
          {text}
        </span>
      );
    case 'inline-text':
    default:
      return (
        <span className={styles.root}>
          <span className={isUserMessage ? styles.inlineUser : styles.inlineAgent}>{label}</span>
          <span className={styles.inlineSep} aria-hidden>
            ·
          </span>
          {text}
        </span>
      );
  }
}

export function MessageSearchSnippet({ data }: { data: MessageSearchSnippetData }) {
  const { flags } = useFeatureFlags();
  return renderMessageSearchSnippetForStyle(data, flags['agentChat.messageSearchSenderStyle']);
}
