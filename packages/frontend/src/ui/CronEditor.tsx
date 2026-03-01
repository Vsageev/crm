import { useMemo, useState } from 'react';
import styles from './CronEditor.module.css';

interface CronEditorProps {
  value: string;
  onChange: (cron: string) => void;
}

type Frequency = 'every_minute' | 'every_x_minutes' | 'hourly' | 'daily' | 'weekly' | 'advanced';

interface ParsedCron {
  frequency: Frequency;
  minute: number;
  hour: number;
  interval: number;
  dayOfWeek: number;
}

const MINUTE_INTERVALS = [5, 10, 15, 30];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseCron(expr: string): ParsedCron {
  const defaults: ParsedCron = { frequency: 'every_minute', minute: 0, hour: 9, interval: 15, dayOfWeek: 1 };
  if (!expr.trim()) return defaults;

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { ...defaults, frequency: 'advanced' };

  const [min, hr, dom, mon, dow] = parts;

  // * * * * * → every minute
  if (min === '*' && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { ...defaults, frequency: 'every_minute' };
  }

  // */X * * * * → every X minutes
  const intervalMatch = min.match(/^\*\/(\d+)$/);
  if (intervalMatch && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    const iv = parseInt(intervalMatch[1], 10);
    if (MINUTE_INTERVALS.includes(iv)) {
      return { ...defaults, frequency: 'every_x_minutes', interval: iv };
    }
    return { ...defaults, frequency: 'advanced' };
  }

  // M * * * * → hourly at minute M
  if (/^\d+$/.test(min) && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    const m = parseInt(min, 10);
    if (m >= 0 && m <= 59) {
      return { ...defaults, frequency: 'hourly', minute: m };
    }
  }

  // M H * * * → daily at H:M
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && mon === '*' && dow === '*') {
    const m = parseInt(min, 10);
    const h = parseInt(hr, 10);
    if (m >= 0 && m <= 59 && h >= 0 && h <= 23) {
      return { ...defaults, frequency: 'daily', minute: m, hour: h };
    }
  }

  // M H * * D → weekly on day D at H:M
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && mon === '*' && /^\d+$/.test(dow)) {
    const m = parseInt(min, 10);
    const h = parseInt(hr, 10);
    const d = parseInt(dow, 10);
    if (m >= 0 && m <= 59 && h >= 0 && h <= 23 && d >= 0 && d <= 6) {
      return { ...defaults, frequency: 'weekly', minute: m, hour: h, dayOfWeek: d };
    }
  }

  return { ...defaults, frequency: 'advanced' };
}

function buildCron(parsed: ParsedCron): string {
  switch (parsed.frequency) {
    case 'every_minute':
      return '* * * * *';
    case 'every_x_minutes':
      return `*/${parsed.interval} * * * *`;
    case 'hourly':
      return `${parsed.minute} * * * *`;
    case 'daily':
      return `${parsed.minute} ${parsed.hour} * * *`;
    case 'weekly':
      return `${parsed.minute} ${parsed.hour} * * ${parsed.dayOfWeek}`;
    default:
      return '';
  }
}

const minuteOptions = Array.from({ length: 60 }, (_, i) => i);
const hourOptions = Array.from({ length: 24 }, (_, i) => i);

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

export function CronEditor({ value, onChange }: CronEditorProps) {
  const [advancedOverride, setAdvancedOverride] = useState(false);
  const autoParsed = useMemo(() => parseCron(value), [value]);
  const frequency: Frequency = advancedOverride ? 'advanced' : autoParsed.frequency;

  function update(patch: Partial<ParsedCron>) {
    const next = { ...autoParsed, ...patch };
    if (next.frequency === 'advanced') return;
    setAdvancedOverride(false);
    onChange(buildCron(next));
  }

  function handleFrequencyChange(freq: Frequency) {
    if (freq === 'advanced') {
      setAdvancedOverride(true);
      return;
    }
    setAdvancedOverride(false);
    const next: ParsedCron = { ...autoParsed, frequency: freq };
    onChange(buildCron(next));
  }

  return (
    <div className={styles.container}>
      <div className={styles.row}>
        <select
          className={styles.inlineSelect}
          value={frequency}
          onChange={(e) => handleFrequencyChange(e.target.value as Frequency)}
        >
          <option value="every_minute">Every minute</option>
          <option value="every_x_minutes">Every X minutes</option>
          <option value="hourly">Every hour</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="advanced">Advanced</option>
        </select>

        {frequency === 'every_x_minutes' && (
          <>
            <label>every</label>
            <select
              className={styles.inlineSelect}
              value={autoParsed.interval}
              onChange={(e) => update({ interval: parseInt(e.target.value, 10) })}
            >
              {MINUTE_INTERVALS.map((iv) => (
                <option key={iv} value={iv}>{iv}</option>
              ))}
            </select>
            <label>minutes</label>
          </>
        )}

        {frequency === 'hourly' && (
          <>
            <label>at minute</label>
            <select
              className={styles.inlineSelect}
              value={autoParsed.minute}
              onChange={(e) => update({ minute: parseInt(e.target.value, 10) })}
            >
              {minuteOptions.map((m) => (
                <option key={m} value={m}>{pad2(m)}</option>
              ))}
            </select>
          </>
        )}

        {frequency === 'daily' && (
          <>
            <label>at</label>
            <select
              className={styles.inlineSelect}
              value={autoParsed.hour}
              onChange={(e) => update({ hour: parseInt(e.target.value, 10) })}
            >
              {hourOptions.map((h) => (
                <option key={h} value={h}>{pad2(h)}</option>
              ))}
            </select>
            <label>:</label>
            <select
              className={styles.inlineSelect}
              value={autoParsed.minute}
              onChange={(e) => update({ minute: parseInt(e.target.value, 10) })}
            >
              {minuteOptions.map((m) => (
                <option key={m} value={m}>{pad2(m)}</option>
              ))}
            </select>
          </>
        )}

        {frequency === 'weekly' && (
          <>
            <label>on</label>
            <select
              className={styles.inlineSelect}
              value={autoParsed.dayOfWeek}
              onChange={(e) => update({ dayOfWeek: parseInt(e.target.value, 10) })}
            >
              {DAYS_OF_WEEK.map((day, i) => (
                <option key={i} value={i}>{day}</option>
              ))}
            </select>
            <label>at</label>
            <select
              className={styles.inlineSelect}
              value={autoParsed.hour}
              onChange={(e) => update({ hour: parseInt(e.target.value, 10) })}
            >
              {hourOptions.map((h) => (
                <option key={h} value={h}>{pad2(h)}</option>
              ))}
            </select>
            <label>:</label>
            <select
              className={styles.inlineSelect}
              value={autoParsed.minute}
              onChange={(e) => update({ minute: parseInt(e.target.value, 10) })}
            >
              {minuteOptions.map((m) => (
                <option key={m} value={m}>{pad2(m)}</option>
              ))}
            </select>
          </>
        )}

        {frequency === 'advanced' && (
          <input
            className={styles.rawInput}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="* * * * *"
          />
        )}
      </div>
    </div>
  );
}
