import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './TasksCalendarView.module.css';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'medium' | 'high';

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  isOverdue: boolean;
}

const PRIORITY_DOT_COLORS: Record<TaskPriority, string> = {
  low: 'var(--color-text-tertiary)',
  medium: 'var(--color-warning)',
  high: 'var(--color-error)',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface TasksCalendarViewProps {
  tasks: Task[];
  loading: boolean;
}

export function TasksCalendarView({ tasks, loading }: TasksCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const today = new Date();
  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  // Group tasks by date string (YYYY-MM-DD)
  const tasksByDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const d = new Date(task.dueDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!tasksByDate.has(key)) tasksByDate.set(key, []);
    tasksByDate.get(key)!.push(task);
  }

  function getDateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
  }

  function goToToday() {
    setCurrentDate(new Date());
  }

  // Build calendar grid (6 rows max)
  const weeks: (number | null)[][] = [];
  let currentWeek: (number | null)[] = [];

  for (let i = 0; i < startDay; i++) {
    currentWeek.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  if (loading) {
    return <div className={styles.loading}>Loading calendar...</div>;
  }

  return (
    <div className={styles.calendar}>
      <div className={styles.calendarHeader}>
        <button className={styles.navBtn} onClick={prevMonth}>
          <ChevronLeft size={16} />
        </button>
        <div className={styles.monthTitle}>
          <h3>{MONTH_NAMES[month]} {year}</h3>
          <button className={styles.todayBtn} onClick={goToToday}>
            Today
          </button>
        </div>
        <button className={styles.navBtn} onClick={nextMonth}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className={styles.grid}>
        {DAY_NAMES.map((name) => (
          <div key={name} className={styles.dayHeader}>
            {name}
          </div>
        ))}

        {weeks.map((week, wi) =>
          week.map((day, di) => {
            if (day === null) {
              return <div key={`${wi}-${di}`} className={styles.dayCell} />;
            }

            const key = getDateKey(day);
            const dayTasks = tasksByDate.get(key) || [];
            const todayClass = isToday(day) ? styles.today : '';

            return (
              <div key={`${wi}-${di}`} className={`${styles.dayCell} ${styles.dayCellActive} ${todayClass}`}>
                <span className={styles.dayNumber}>{day}</span>
                <div className={styles.dayTasks}>
                  {dayTasks.slice(0, 3).map((task) => (
                    <Link
                      key={task.id}
                      to={`/tasks/${task.id}`}
                      className={`${styles.calendarTask} ${task.status === 'completed' ? styles.calendarTaskDone : ''} ${task.isOverdue ? styles.calendarTaskOverdue : ''}`}
                    >
                      <span
                        className={styles.priorityDot}
                        style={{ background: PRIORITY_DOT_COLORS[task.priority] }}
                      />
                      <span className={styles.calendarTaskTitle}>{task.title}</span>
                    </Link>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className={styles.moreCount}>+{dayTasks.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
