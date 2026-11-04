// SyntaxError data analysis: reads the records the Unity game saves and turns them into
// traceable numbers. Nothing here estimates "difficulty" or labels students; every figure
// is a count, a duration or a date that can be found in the student's Firestore record.
//
// Record shape written by the game (sections/{id}/classList/{student}):
//   Subject Content > main topic > topic > attempt ("FirstAttemp", "SecondAttemp", ...)
//     attempt: { completionTime (s), completedAt, level{N}Completed: true, <task>: {...} }
//     task:    { timeSeconds, wrongAttempts, completed, completedAt, lastAttempt,
//                errors: [{ message, atSeconds }] }
// Read-only: this module never writes to Firestore.

import { infoButton as info, helpLink as help, setLiveNumbers } from './metric-help.js';

export const TOTAL_LEVELS = 19;

// ---------- small helpers ----------
const ATTEMPTS = { firstattempt: 1, firstattemp: 1, secondattempt: 2, secondattemp: 2, thirdattempt: 3, thirdattemp: 3,
    fourthattempt: 4, fourthattemp: 4, fifthattempt: 5, fifthattemp: 5, sixthattempt: 6, sixthattemp: 6, seventhattempt: 7, seventhattemp: 7,
    eighthattempt: 8, eighthattemp: 8, ninthattempt: 9, ninthattemp: 9, tenthattempt: 10, tenthattemp: 10 };
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const attemptNumber = key => ATTEMPTS[norm(key)] || 0;
const num = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
// Times and counts cannot be negative; a negative saved value is treated as missing.
const amount = value => { const n = num(value); return n === null || n < 0 ? null : n; };
const isTimestamp = value => !!value && typeof value === 'object' && (typeof value.toDate === 'function' || ('seconds' in value && 'nanoseconds' in value));
export function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
const prettyName = value => String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const titleCase = value => prettyName(value).replace(/\b\w/g, c => c.toUpperCase());
export const safeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

export function fmtTime(seconds) {
    if (!Number.isFinite(seconds)) return '--';
    const s = Math.round(seconds);
    if (s < 60) return `${s} s`;
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return h ? `${h} h ${m} min` : r ? `${m} min ${r} s` : `${m} min`;
}
// Averages are shown as whole numbers. Anything between 0 and 1 stays "<1" so a real value never reads as zero.
export const fmtWhole = value => !Number.isFinite(value) ? '--' : value > 0 && value < 1 ? '<1' : String(Math.round(value));
export const aboutCount = value => !Number.isFinite(value) ? '--' : Number.isInteger(value) ? String(value)
    : value < 1 ? 'less than 1' : `about ${Math.round(value)}`;
export function fmtDate(ms, withTime = true) {
    if (!ms) return '--';
    return new Date(ms).toLocaleString('en-PH', withTime
        ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', year: 'numeric' });
}
const clock = seconds => { if (!Number.isFinite(seconds)) return ''; const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- reading one student ----------
// Levels completed: explicit "level{N}Completed: true" markers anywhere in the record
// (the same rule the rest of the site uses for game progress).
export function levelsCompleted(student) {
    const levels = new Set();
    const seen = new WeakSet();
    (function walk(node, context, depth) {
        if (!node || typeof node !== 'object' || depth > 25 || seen.has(node) || isTimestamp(node)) return;
        seen.add(node);
        for (const [key, value] of Object.entries(node)) {
            const k = norm(key);
            const m = k.match(/^level(\d{1,2})(?:is)?(?:completed|complete|finished)$/) || k.match(/^(?:completed|complete|finished)level(\d{1,2})$/);
            const yes = value === true || value === 1 || value === 'true';
            if (m && yes && +m[1] >= 1 && +m[1] <= TOTAL_LEVELS) levels.add(+m[1]);
            const levelKey = k.match(/^level(\d{1,2})$/);
            const next = levelKey ? +levelKey[1] : context;
            if (next && /^(completed|iscompleted|finished)$/.test(k) && yes) levels.add(next);
            if (value && typeof value === 'object') walk(value, next, depth + 1);
        }
    })(student, null, 0);
    return levels;
}

function readTask(name, task) {
    const errors = Array.isArray(task.errors)
        ? task.errors.filter(e => e && e.message).map(e => ({ message: String(e.message), at: num(e.atSeconds) }))
        : [];
    return {
        name: prettyName(name),
        time: amount(task.timeSeconds),
        wrong: amount(task.wrongAttempts),
        completed: task.completed === true || task.completed === 'true',
        when: toMillis(task.completedAt) || toMillis(task.lastAttempt),
        errors
    };
}

// Full record of one student: topics > attempts > tasks, plus totals.
export function studentRecord(student) {
    const content = student?.['Subject Content'] || student?.subjectContent;
    // Keyed by topic so one topic saved under two spellings still counts as one topic for the student.
    const merged = new Map();
    if (content && typeof content === 'object') {
        for (const [main, topicMap] of Object.entries(content)) {
            if (!topicMap || typeof topicMap !== 'object' || isTimestamp(topicMap)) continue;
            for (const [topicName, node] of Object.entries(topicMap)) {
                if (!node || typeof node !== 'object' || isTimestamp(node)) continue;
                const attempts = [];
                let level = null;
                for (const [attemptKey, attempt] of Object.entries(node)) {
                    const n = attemptNumber(attemptKey);
                    if (!n || !attempt || typeof attempt !== 'object') continue;
                    const tasks = [];
                    let levelDone = false;
                    for (const [key, value] of Object.entries(attempt)) {
                        const marker = norm(key).match(/^level(\d{1,2})completed$/);
                        if (marker) { level = +marker[1]; if (value === true || value === 'true') levelDone = true; continue; }
                        if (value && typeof value === 'object' && !Array.isArray(value) && !isTimestamp(value)) tasks.push(readTask(key, value));
                    }
                    const taskTime = tasks.reduce((sum, t) => sum + (t.time ?? 0), 0);
                    const total = amount(attempt.completionTime);
                    const hasData = total !== null || tasks.some(t => t.time !== null || t.wrong !== null);
                    if (!hasData) continue;
                    attempts.push({
                        n,
                        // A saved total of 0 is not a real time when the tasks recorded some.
                        time: total || taskTime,
                        wrong: tasks.reduce((sum, t) => sum + (t.wrong ?? 0), 0),
                        completed: levelDone || (tasks.length > 0 && tasks.every(t => t.completed)),
                        when: toMillis(attempt.completedAt) || Math.max(0, ...tasks.map(t => t.when)),
                        tasks
                    });
                }
                if (!attempts.length) continue;
                const key = `${norm(main)}|${norm(topicName)}`;
                const existing = merged.get(key);
                if (existing) { existing.attempts.push(...attempts); existing.level ??= level; continue; }
                merged.set(key, { key, main: titleCase(main), topic: prettyName(topicName), level, attempts });
            }
        }
    }
    const topics = [...merged.values()].map(t => {
        t.attempts.sort((a, b) => a.n - b.n);
        return {
            ...t,
            time: t.attempts.reduce((s, a) => s + a.time, 0),
            wrong: t.attempts.reduce((s, a) => s + a.wrong, 0),
            completed: t.attempts.some(a => a.completed),
            when: Math.max(0, ...t.attempts.map(a => a.when))
        };
    });
    topics.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.topic.localeCompare(b.topic));
    const levels = levelsCompleted(student);
    return {
        topics,
        levels,
        // A level marker without timing data is still a game record, so the student has started.
        hasRecords: topics.length > 0 || levels.size > 0,
        time: topics.reduce((s, t) => s + t.time, 0),
        wrong: topics.reduce((s, t) => s + t.wrong, 0),
        attempts: topics.reduce((s, t) => s + t.attempts.length, 0),
        lastActivity: Math.max(0, toMillis(student?.lastSeen), ...topics.map(t => t.when)),
        online: student?.isOnline === true || student?.isOnline === 'true'
    };
}

// Compact per-student numbers for tables and CSV export.
export function studentSummary(student) {
    const r = studentRecord(student);
    return { levels: r.levels.size, time: r.time, wrong: r.wrong, attempts: r.attempts, lastActivity: r.lastActivity, hasRecords: r.hasRecords, online: r.online };
}

// ---------- reading a group of students ----------
// One student number counts once, even if it appears in two of the sections in view. The record kept
// is the current one (not moved away) with the most game data. Students without a number are all kept.
export function uniqueStudents(students) {
    const kept = new Map();
    const rest = [];
    const rank = s => { const r = studentSummary(s); return [s.movedTo ? 0 : 1, r.attempts, r.levels, r.lastActivity]; };
    for (const student of students) {
        const id = student?.id ?? student?.firebaseId;
        if (id == null || id === '') { rest.push(student); continue; }
        const other = kept.get(String(id));
        if (!other) { kept.set(String(id), student); continue; }
        const a = rank(student), b = rank(other);
        const better = a.findIndex((v, i) => v !== b[i]);
        if (better >= 0 && a[better] > b[better]) kept.set(String(id), student);
    }
    return [...kept.values(), ...rest];
}

export function classSummary(allStudents) {
    const students = uniqueStudents(allStudents);
    const topics = new Map();
    const tasks = new Map();
    const levelCounts = Array(TOTAL_LEVELS + 1).fill(0);
    const recent = [];
    const notStarted = [];
    let started = 0, totalTime = 0, totalWrong = 0, totalLevels = 0;
    for (const student of students) {
        const r = studentRecord(student);
        r.levels.forEach(level => { levelCounts[level]++; });
        totalLevels += r.levels.size;
        if (!r.hasRecords) { notStarted.push(student); continue; }
        started++; totalTime += r.time; totalWrong += r.wrong;
        for (const t of r.topics) {
            const entry = topics.get(t.key) || { main: t.main, topic: t.topic, level: t.level, students: 0, withErrors: 0, time: 0, wrong: 0, attempts: 0, messages: new Map() };
            entry.students++; entry.time += t.time; entry.wrong += t.wrong; entry.attempts += t.attempts.length;
            if (entry.level == null) entry.level = t.level;
            if (t.wrong > 0) entry.withErrors++;
            for (const a of t.attempts) {
                for (const task of a.tasks) {
                    task.errors.forEach(e => entry.messages.set(e.message, (entry.messages.get(e.message) || 0) + 1));
                    const taskKey = `${t.key}|${norm(task.name)}`;
                    const te = tasks.get(taskKey) || { task: task.name, topic: t.topic, level: t.level, students: new Set(), wrong: 0, time: 0, timed: 0, messages: new Map() };
                    te.students.add(student.id ?? student.firebaseId ?? student.name);
                    te.wrong += task.wrong ?? 0;
                    if (task.time !== null) { te.time += task.time; te.timed++; }
                    task.errors.forEach(e => te.messages.set(e.message, (te.messages.get(e.message) || 0) + 1));
                    tasks.set(taskKey, te);
                }
                if (a.when) recent.push({ student, topic: t.topic, level: t.level, attempt: a.n, time: a.time, wrong: a.wrong, completed: a.completed, when: a.when });
            }
            topics.set(t.key, entry);
        }
    }
    const topicList = [...topics.values()].map(t => ({ ...t, avgTime: t.time / t.students, avgWrong: t.wrong / t.students }));
    const taskList = [...tasks.values()].map(t => ({
        ...t, students: t.students.size, avgTime: t.timed ? t.time / t.timed : null,
        topMessage: [...t.messages.entries()].sort((a, b) => b[1] - a[1])[0] || null
    }));
    recent.sort((a, b) => b.when - a.when);
    return {
        total: students.length, duplicates: allStudents.length - students.length, started, notStarted, totalTime, totalWrong, totalLevels,
        levelCounts, topics: topicList, tasks: taskList, recent
    };
}

export function topBy(list, key) {
    return list.length ? [...list].sort((a, b) => b[key] - a[key] || String(a.topic).localeCompare(String(b.topic)))[0] : null;
}

function commonMessages(topics, limit = 6) {
    const out = [];
    topics.forEach(t => t.messages.forEach((count, message) => out.push({ message, count, topic: t.topic })));
    return out.sort((a, b) => b.count - a.count || a.message.localeCompare(b.message)).slice(0, limit);
}

// ---------- CSV export ----------
export function downloadCsv(filename, header, rows) {
    const cell = value => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Local date and time (the teacher's time zone), e.g. 2026-11-02 12:29.
function localStamp(ms) {
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function studentCsvRows(students) {
    return uniqueStudents(students).map(s => {
        const r = studentSummary(s);
        // ="..." keeps leading zeros of student numbers when the file is opened in Excel or Sheets.
        return [s.id != null ? `="${s.id}"` : '', s.name ?? '', s.section ?? s.sectionName ?? '', r.levels, Math.round(r.time), r.wrong, r.attempts,
            r.lastActivity ? localStamp(r.lastActivity) : ''];
    });
}
export const STUDENT_CSV_HEADER = ['Student number', 'Name', 'Section', `Levels completed (of ${TOTAL_LEVELS})`, 'Time recorded (seconds)', 'Wrong submissions', 'Attempts', 'Last activity'];

// ---------- charts ----------
const charts = new WeakMap();
function themeColors() {
    const css = getComputedStyle(document.documentElement);
    const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
        time: read('--da-time', '#1f6fd1'), error: read('--da-error', '#c26a00'), level: read('--da-level', '#0f8a5f'),
        text: read('--da-muted', '#6b7280'), ink: read('--da-ink', '#1f2937'), grid: read('--da-line', '#e5e7eb')
    };
}

// Prints each bar's value at its end so the reader never has to estimate from the axis.
const valueLabels = {
    id: 'daValueLabels',
    afterDatasetsDraw(chart, args, options) {
        // With 19 columns a phone has no room for a number on each bar; tapping a bar still shows it.
        if (!options?.format || chart.width < options.narrowHide) return;
        const { ctx } = chart;
        const horizontal = chart.options.indexAxis === 'y';
        ctx.save();
        ctx.font = '600 12px Inter, "Segoe UI", sans-serif';
        ctx.fillStyle = options.color;
        ctx.textBaseline = horizontal ? 'middle' : 'bottom';
        ctx.textAlign = horizontal ? 'left' : 'center';
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const text = options.format(i);
            if (text) horizontal ? ctx.fillText(text, bar.x + 6, bar.y) : ctx.fillText(text, bar.x, bar.y - 4);
        });
        ctx.restore();
    }
};

function drawChart(canvas, config) {
    if (!canvas || typeof Chart === 'undefined') return;
    charts.get(canvas)?.destroy();
    charts.set(canvas, new Chart(canvas.getContext('2d'), { ...config, plugins: [valueLabels] }));
}
function clearChart(canvas) { charts.get(canvas)?.destroy(); charts.delete(canvas); }

// Whole-number axis ticks need seconds when every value is under 2 minutes.
const timeUnit = maxSeconds => maxSeconds < 120 ? { divide: 1, name: 'Seconds' } : { divide: 60, name: 'Minutes' };
// Long topic names would squeeze the bars on a phone; the tooltip always has the full name.
function shortLabel(chart, label) {
    const limit = chart.width < 420 ? 18 : 34;
    return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
}

function horizontalBars(canvas, items, valueOf, color, labelOf, tooltipOf, axisTitle) {
    if (!items.length) return clearChart(canvas);
    const c = themeColors();
    const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
    canvas.parentElement.style.height = Math.max(150, sorted.length * 38 + 60) + 'px';
    drawChart(canvas, {
        type: 'bar',
        data: { labels: sorted.map(t => t.topic), datasets: [{ data: sorted.map(valueOf), backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            plugins: {
                legend: { display: false },
                daValueLabels: { color: c.ink, format: i => labelOf(sorted[i]) },
                tooltip: { callbacks: { title: list => { const t = sorted[list[0].dataIndex]; return t.level ? `Level ${t.level} · ${t.topic}` : t.topic; }, label: item => tooltipOf(sorted[item.dataIndex]) } }
            },
            scales: {
                x: { beginAtZero: true, grace: '28%', grid: { color: c.grid }, border: { display: false }, ticks: { color: c.text, maxTicksLimit: 6, precision: 0 }, title: { display: true, text: axisTitle, color: c.text } },
                y: { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.ink, autoSkip: false, font: { weight: 600 }, callback(value) { return shortLabel(this.chart, this.getLabelForValue(value)); } } }
            }
        }
    });
}

function levelChart(canvas, counts, total) {
    const c = themeColors();
    const levels = Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1);
    drawChart(canvas, {
        type: 'bar',
        data: { labels: levels.map(String), datasets: [{ data: levels.map(l => counts[l]), backgroundColor: c.level, hoverBackgroundColor: c.level, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 30 }] },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            plugins: {
                legend: { display: false },
                daValueLabels: { color: c.ink, narrowHide: 460, format: i => counts[i + 1] ? String(counts[i + 1]) : '' },
                tooltip: { callbacks: { title: list => `Level ${list[0].label}`, label: item => `${item.raw} of ${total} students completed it (${total ? Math.round(item.raw / total * 100) : 0}%)` } }
            },
            scales: {
                x: { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.ink, maxRotation: 0, autoSkipPadding: 2 }, title: { display: true, text: 'Game level', color: c.text } },
                y: { beginAtZero: true, grace: '15%', grid: { color: c.grid }, border: { display: false }, ticks: { color: c.text, precision: 0, maxTicksLimit: 6 }, title: { display: true, text: 'Students', color: c.text } }
            }
        }
    });
}

// ---------- class view (teacher dashboard) ----------
const q = (root, sel) => root.querySelector(sel);
// Phones show table rows as cards; each cell takes its label from the column heading.
function labelCells(root) {
    root.querySelectorAll('.da-table').forEach(table => {
        const heads = [...table.querySelectorAll('th')].map(th => th.textContent.trim());
        table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((cell, i) => { if (cell.colSpan === 1) cell.dataset.label = heads[i]; }));
    });
}
const set = (root, sel, text) => { const el = q(root, sel); if (el) el.textContent = text; };

const CLASS_TEMPLATE = `
<section class="da-glance" aria-label="Summary of the numbers below"><h3><i class="bi bi-lightbulb" aria-hidden="true"></i> At a glance</h3><ul data-k="glance"></ul></section>
<div class="da-kpis">
  <div class="da-kpi"><span><i class="bi bi-people"></i> Students ${info('students')}</span><strong data-k="students">--</strong><small data-k="students-note"></small></div>
  <div class="da-kpi da-kpi-level"><span><i class="bi bi-flag"></i> Levels completed ${info('levels-avg')}</span><strong data-k="levels">--</strong><small data-k="levels-note"></small></div>
  <div class="da-kpi da-kpi-time"><span><i class="bi bi-hourglass-split"></i> Time recorded ${info('time-total')}</span><strong data-k="time">--</strong><small data-k="time-note"></small></div>
  <div class="da-kpi da-kpi-error"><span><i class="bi bi-bug"></i> Wrong submissions ${info('wrong-total')}</span><strong data-k="wrong">--</strong><small data-k="wrong-note"></small></div>
</div>

<section class="card da-card">
  <div class="da-card-head"><div><h3><i class="bi bi-flag"></i> Level completion</h3><p>How many students have completed each of the ${TOTAL_LEVELS} game levels.</p></div>${help('level-chart')}</div>
  <div class="da-canvas da-canvas-level"><canvas data-c="levels" role="img" aria-label="Bar chart of students who completed each level"></canvas></div>
  <p class="da-summary da-summary-level" data-k="level-summary"></p>
</section>

<section class="card da-card">
  <div class="da-card-head"><div><h3><i class="bi bi-grid-3x3-gap"></i> Time spent and errors per topic</h3><p>Averages per student who played the topic, adding up every attempt.</p></div></div>
  <div class="da-highlights">
    <div class="da-highlight da-hl-time"><span>Most time spent ${info('hl-time')}</span><strong data-k="hl-time">--</strong><small data-k="hl-time-note"></small></div>
    <div class="da-highlight da-hl-error"><span>Most wrong submissions ${info('hl-error')}</span><strong data-k="hl-error">--</strong><small data-k="hl-error-note"></small></div>
    <div class="da-highlight da-hl-people"><span>Most students with errors ${info('hl-people')}</span><strong data-k="hl-people">--</strong><small data-k="hl-people-note"></small></div>
  </div>
  <div class="da-charts">
    <figure class="da-chart da-chart-time"><figcaption><strong><i class="bi bi-hourglass-split"></i> Time spent per topic ${info('topic-time')}</strong><span>Average per student, all attempts. Longer bar = more time.</span></figcaption>
      <div class="da-canvas"><canvas data-c="time" role="img" aria-label="Bar chart of average time per student for each topic"></canvas></div></figure>
    <figure class="da-chart da-chart-error"><figcaption><strong><i class="bi bi-bug"></i> Errors per topic ${info('topic-wrong')}</strong><span>Average wrong submissions per student, all attempts. Longer bar = more errors.</span></figcaption>
      <div class="da-canvas"><canvas data-c="errors" role="img" aria-label="Bar chart of average wrong submissions per student for each topic"></canvas></div></figure>
  </div>
  <p class="da-empty" data-k="topic-empty" hidden><i class="bi bi-inbox"></i> No game records for this selection yet. Charts fill in after students finish levels in the mobile game.</p>
  <div class="da-table-title"><strong>Numbers per topic</strong>${info('topic-table')}</div>
  <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Level · Topic</th><th>Students who played</th><th>Avg. time per student</th><th>Avg. wrong per student</th><th>Students with errors</th><th>Attempts</th></tr></thead><tbody data-k="topic-rows"></tbody></table></div>
</section>

<div class="da-grid-2">
  <section class="card da-card">
    <div class="da-card-head"><div><h3><i class="bi bi-list-check"></i> Tasks with the most wrong submissions</h3><p>Individual coding tasks inside each level, with the error message students saw most.</p></div>${help('tasks')}</div>
    <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Task</th><th>Students</th><th>Total wrong</th><th>Most common message</th></tr></thead><tbody data-k="task-rows"></tbody></table></div>
  </section>
  <section class="card da-card">
    <div class="da-card-head"><div><h3><i class="bi bi-chat-square-text"></i> Most common error messages</h3><p>Messages the game showed when an answer was wrong.</p></div>${help('messages')}</div>
    <ol class="da-messages" data-k="messages"></ol>
  </section>
</div>

<div class="da-grid-2">
  <section class="card da-card">
    <div class="da-card-head"><div><h3><i class="bi bi-clock-history"></i> Recent activity</h3><p>The latest recorded attempts, newest first.</p></div>${help('recent')}</div>
    <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Student</th><th>Level · Topic</th><th>Attempt</th><th>Result</th><th>When</th></tr></thead><tbody data-k="recent-rows"></tbody></table></div>
  </section>
  <section class="card da-card">
    <div class="da-card-head"><div><h3><i class="bi bi-hourglass"></i> Not started yet</h3><p>Students with no game records so far.</p></div>${help('not-started')}</div>
    <ul class="da-names" data-k="not-started"></ul>
  </section>
</div>`;

// options.compact (Super Admin): keeps the headline numbers and charts in view and moves the
// per-topic table and the detailed lists behind "Show" toggles, so the page is less crowded.
export function renderClassOverview(root, students, options = {}) {
    if (!root) return;
    if (!root.dataset.ready) {
        root.innerHTML = CLASS_TEMPLATE;
        root.dataset.ready = '1';
        if (options.compact) {
            const table = q(root, '[data-k="topic-rows"]').closest('.da-table-wrap');
            const tableToggle = Object.assign(document.createElement('details'), { className: 'da-more da-more-inline' });
            tableToggle.innerHTML = '<summary><i class="bi bi-table"></i> Show the per-topic table</summary>';
            table.before(tableToggle); tableToggle.append(table);
            const more = Object.assign(document.createElement('details'), { className: 'da-more' });
            more.innerHTML = '<summary><i class="bi bi-list-ul"></i> More details: tasks, error messages, recent activity and students not started</summary>';
            root.querySelectorAll('.da-grid-2').forEach(grid => more.append(grid));
            root.append(more);
        }
    }
    root._students = students;
    const s = classSummary(students);
    const c = themeColors();

    const avgLevels = s.total ? s.totalLevels / s.total : 0;
    const avgTime = s.started ? s.totalTime / s.started : 0;
    const avgWrong = s.started ? s.totalWrong / s.started : 0;
    set(root, '[data-k="students"]', String(s.total));
    set(root, '[data-k="students-note"]', `${s.started} started playing · ${s.notStarted.length} not started${s.duplicates ? ` · ${plural(s.duplicates, 'repeated record')} counted once` : ''}`);
    set(root, '[data-k="levels"]', s.total ? `${fmtWhole(avgLevels)} of ${TOTAL_LEVELS}` : '--');
    set(root, '[data-k="levels-note"]', s.total ? `Average per student · all ${plural(s.total, 'student')}` : 'No students in this selection');
    set(root, '[data-k="time"]', s.started ? fmtTime(s.totalTime) : '--');
    set(root, '[data-k="time-note"]', s.started ? `Class total · about ${fmtTime(avgTime)} per student who started` : 'No game records yet');
    set(root, '[data-k="wrong"]', s.started ? String(s.totalWrong) : '--');
    set(root, '[data-k="wrong-note"]', s.started ? `Class total · ${aboutCount(avgWrong)} per student who started` : 'No game records yet');

    levelChart(q(root, '[data-c="levels"]'), s.levelCounts, s.total);
    const highest = s.levelCounts.reduce((max, n, level) => n > 0 ? level : max, 0);
    set(root, '[data-k="level-summary"]', !s.total ? 'No students in this selection yet.' : highest
        ? `Level 1: ${s.levelCounts[1]} of ${s.total} students (${Math.round(s.levelCounts[1] / s.total * 100)}%). Furthest level completed by anyone: Level ${highest}.`
        : 'No student has completed a level yet.');

    // Topics
    const empty = !s.topics.length;
    q(root, '[data-k="topic-empty"]').hidden = !empty;
    root.querySelectorAll('.da-chart, .da-highlights, .da-charts, .da-table-title').forEach(el => { el.hidden = empty; });
    q(root, '[data-k="topic-rows"]').closest('.da-table-wrap').hidden = empty;
    const mostTime = topBy(s.topics, 'avgTime'), mostWrong = topBy(s.topics, 'avgWrong');
    const mostPeople = topBy(s.topics.filter(t => t.withErrors > 0), 'withErrors');
    set(root, '[data-k="hl-time"]', mostTime?.topic ?? '--');
    set(root, '[data-k="hl-time-note"]', mostTime ? `Average: about ${fmtTime(mostTime.avgTime)} per student` : '');
    set(root, '[data-k="hl-error"]', mostWrong?.avgWrong ? mostWrong.topic : 'None recorded');
    set(root, '[data-k="hl-error-note"]', mostWrong?.avgWrong ? `Average: ${aboutCount(mostWrong.avgWrong)} per student` : '');
    set(root, '[data-k="hl-people"]', mostPeople?.topic ?? 'None recorded');
    set(root, '[data-k="hl-people-note"]', mostPeople ? `${mostPeople.withErrors} of ${mostPeople.students} students made at least one error` : '');
    const unit = timeUnit(Math.max(0, ...s.topics.map(t => t.avgTime)));
    horizontalBars(q(root, '[data-c="time"]'), s.topics, t => t.avgTime / unit.divide, c.time, t => fmtTime(t.avgTime), t => `${fmtTime(t.time)} ÷ ${plural(t.students, 'student')} = about ${fmtTime(t.avgTime)} per student`, `${unit.name} per student`);
    horizontalBars(q(root, '[data-c="errors"]'), s.topics, t => t.avgWrong, c.error, t => fmtWhole(t.avgWrong), t => `${plural(t.wrong, 'wrong submission')} ÷ ${plural(t.students, 'student')} = ${aboutCount(t.avgWrong)} per student`, 'Wrong submissions per student');
    q(root, '[data-k="topic-rows"]').innerHTML = empty
        ? ''
        : [...s.topics].sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.topic.localeCompare(b.topic)).map(t => `
            <tr><td><strong>${t.level ? `Level ${t.level} · ` : ''}${safeText(t.topic)}</strong><small>${safeText(t.main)}</small></td>
            <td>${t.students}</td><td>${fmtTime(t.avgTime)}<small>Total: ${fmtTime(t.time)}</small></td><td>${fmtWhole(t.avgWrong)}<small>Total: ${t.wrong}</small></td><td>${t.withErrors} of ${t.students}</td><td>${t.attempts}</td></tr>`).join('');

    // Plain-language summary of the same figures shown below.
    const glance = !s.total ? ['No students in this selection yet.'] : [
        `${s.started} of ${s.total} students have started playing${s.notStarted.length ? `; ${s.notStarted.length} ${s.notStarted.length === 1 ? 'has' : 'have'} not started yet` : ''}.`,
        `On average, students have finished ${fmtWhole(avgLevels)} of ${TOTAL_LEVELS} levels.`,
        mostWrong?.avgWrong ? `Review <strong>${safeText(mostWrong.topic)}</strong> first: it has the most wrong submissions, ${aboutCount(mostWrong.avgWrong)} per student (${plural(mostWrong.students, 'student')} played it).` : '',
        mostTime ? `<strong>${safeText(mostTime.topic)}</strong> takes the longest, about ${fmtTime(mostTime.avgTime)} per student.` : ''
    ].filter(Boolean);
    q(root, '[data-k="glance"]').innerHTML = glance.map(line => `<li>${line}</li>`).join('');

    setLiveNumbers(root, {
        students: `${s.total} on the class list: ${s.started} started playing, ${s.notStarted.length} not started.${s.duplicates ? ` ${plural(s.duplicates, 'repeated student number')} counted once.` : ''}`,
        'levels-avg': s.total ? `${plural(s.totalLevels, 'level')} completed ÷ ${plural(s.total, 'student')} = ${aboutCount(avgLevels)} per student.` : '',
        'time-total': s.started ? `Class total: ${fmtTime(s.totalTime)}.\n${fmtTime(s.totalTime)} ÷ ${s.started} who started = about ${fmtTime(avgTime)} per student.` : '',
        'wrong-total': s.started ? `Class total: ${s.totalWrong}.\n${s.totalWrong} ÷ ${s.started} who started = ${aboutCount(avgWrong)} per student.` : '',
        'level-chart': s.total ? `${s.total} students in this view. Level 1: ${s.levelCounts[1]} of ${s.total} (${Math.round(s.levelCounts[1] / s.total * 100)}%).` : '',
        'hl-time': mostTime ? `${mostTime.topic}: ${fmtTime(mostTime.time)} ÷ ${plural(mostTime.students, 'student')} = about ${fmtTime(mostTime.avgTime)} per student.` : '',
        'hl-error': mostWrong?.avgWrong ? `${mostWrong.topic}: ${plural(mostWrong.wrong, 'wrong submission')} ÷ ${plural(mostWrong.students, 'student')} = ${aboutCount(mostWrong.avgWrong)} per student.` : '',
        'hl-people': mostPeople ? `${mostPeople.topic}: ${mostPeople.withErrors} of ${mostPeople.students} students made at least one error.` : '',
        'not-started': s.total ? `${s.total} on the class list − ${s.started} with game records = ${s.notStarted.length} listed.` : ''
    });

    // Tasks
    const tasks = s.tasks.filter(t => t.wrong > 0).sort((a, b) => b.wrong - a.wrong || b.students - a.students).slice(0, 8);
    q(root, '[data-k="task-rows"]').innerHTML = tasks.length
        ? tasks.map(t => `<tr><td><strong>${safeText(t.task)}</strong><small>${t.level ? `Level ${t.level} · ` : ''}${safeText(t.topic)}</small></td><td>${t.students}</td><td>${t.wrong}</td>
            <td>${t.topMessage ? `${safeText(t.topMessage[0])}<small>${plural(t.topMessage[1], 'time')}</small>` : '<span class="da-muted">--</span>'}</td></tr>`).join('')
        : '<tr><td colspan="4" class="da-muted">No wrong submissions recorded yet.</td></tr>';

    const messages = commonMessages(s.topics);
    q(root, '[data-k="messages"]').innerHTML = messages.length
        ? messages.map(m => `<li><strong>${safeText(m.message)}</strong><small>${plural(m.count, 'time')} · ${safeText(m.topic)}</small></li>`).join('')
        : '<li class="da-none">No error messages recorded yet.</li>';

    // Activity
    q(root, '[data-k="recent-rows"]').innerHTML = s.recent.length
        ? s.recent.slice(0, 8).map(r => `<tr><td><strong>${safeText(r.student.name ?? r.student.id)}</strong><small>${safeText(r.student.section ?? '')}</small></td>
            <td>${r.level ? `Level ${r.level} · ` : ''}${safeText(r.topic)}</td><td>#${r.attempt}</td>
            <td>${r.completed ? '<span class="da-pill da-pill-ok">Completed</span>' : '<span class="da-pill">Not completed</span>'}<small>This attempt: ${fmtTime(r.time)} · ${plural(r.wrong, 'wrong submission')}</small></td>
            <td>${fmtDate(r.when)}</td></tr>`).join('')
        : '<tr><td colspan="5" class="da-muted">No recorded attempts yet.</td></tr>';
    const names = [...s.notStarted].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
    q(root, '[data-k="not-started"]').innerHTML = names.length
        ? names.map(st => `<li><strong>${safeText(st.name ?? st.id)}</strong><small>${safeText(st.id ?? '')}${st.section ? ' · ' + safeText(st.section) : ''}</small></li>`).join('')
        : `<li class="da-none">${s.total ? 'Every student has started playing.' : 'No students in this selection yet.'}</li>`;
    labelCells(root);
}

// ---------- one student (details popups) ----------
const SUMMARY_TEMPLATE = `
<div class="da-stat-list">
  <div><span>Levels completed ${info('col-levels')}</span><strong data-k="levels">--</strong></div>
  <div><span>Time recorded ${info('col-time')}</span><strong data-k="time">--</strong></div>
  <div><span>Wrong submissions ${info('col-wrong')}</span><strong data-k="wrong">--</strong></div>
  <div><span>Attempts ${info('s-attempts')}</span><strong data-k="attempts">--</strong></div>
  <div class="da-stat-wide"><span>Last activity ${info('col-last')}</span><strong data-k="last">--</strong></div>
</div>
<div class="da-level-chips" data-k="chips" aria-label="Levels completed"></div>`;

export function renderStudentSummary(root, student) {
    if (!root) return;
    if (!root.dataset.ready) { root.innerHTML = SUMMARY_TEMPLATE; root.dataset.ready = '1'; }
    const r = studentRecord(student);
    set(root, '[data-k="levels"]', `${r.levels.size} of ${TOTAL_LEVELS}`);
    const played = r.topics.length > 0;
    set(root, '[data-k="time"]', played ? fmtTime(r.time) : '--');
    set(root, '[data-k="wrong"]', played ? String(r.wrong) : '--');
    set(root, '[data-k="attempts"]', String(r.attempts));
    // isOnline is the game's own flag and can stay true if the app was closed abruptly, so the date is shown too.
    set(root, '[data-k="last"]', `${r.lastActivity ? fmtDate(r.lastActivity) : 'No activity yet'}${r.online ? ' · game reports online' : ''}`);
    q(root, '[data-k="chips"]').innerHTML = Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1)
        .map(l => `<span class="${r.levels.has(l) ? 'is-done' : ''}" title="Level ${l}: ${r.levels.has(l) ? 'completed' : 'not completed'}">${l}</span>`).join('');
}

const DETAIL_TEMPLATE = `
<section class="da-card da-plain">
  <div class="da-card-head"><div><span class="da-eyebrow">DATA ANALYSIS BY TOPIC</span><h3>Time spent and errors per topic</h3><p>Totals from this student's game records, all attempts added up.</p></div></div>
  <p class="da-empty" data-k="empty" hidden><i class="bi bi-inbox"></i> No game records for this student yet. This fills in after they finish a level in the mobile game.</p>
  <div class="da-charts da-charts-stack">
    <figure class="da-chart da-chart-time"><figcaption><strong><i class="bi bi-hourglass-split"></i> Time spent per topic ${info('s-topic-time')}</strong><span>This student's total. Longer bar = more time.</span></figcaption>
      <div class="da-canvas"><canvas data-c="time" role="img" aria-label="Bar chart of time spent on each topic"></canvas></div></figure>
    <figure class="da-chart da-chart-error"><figcaption><strong><i class="bi bi-bug"></i> Errors per topic ${info('s-topic-wrong')}</strong><span>This student's total. Longer bar = more wrong submissions.</span></figcaption>
      <div class="da-canvas"><canvas data-c="errors" role="img" aria-label="Bar chart of wrong submissions in each topic"></canvas></div></figure>
  </div>
</section>
<section class="da-card da-plain" data-k="progress-card">
  <div class="da-card-head"><div><h3><i class="bi bi-graph-down-arrow"></i> Attempt progress</h3><p>How each retried level changed from one attempt to the next. A line going down means less time or fewer wrong submissions.</p></div>${help('s-progress')}</div>
  <div class="da-progress-stats">
    <div><i class="bi bi-arrow-repeat"></i><strong data-k="retried">0</strong><span data-k="retried-label">levels retried</span></div>
    <div class="is-good"><i class="bi bi-lightning-charge"></i><strong data-k="faster">0</strong><span data-k="faster-label">faster on latest try</span></div>
    <div class="is-good"><i class="bi bi-check2-circle"></i><strong data-k="fewer">0</strong><span data-k="fewer-label">fewer wrong submissions</span></div>
  </div>
  <p class="da-empty" data-k="progress-empty" hidden><i class="bi bi-arrow-repeat"></i> No level has been played more than once yet, so there is no change to compare.</p>
  <div class="da-charts" data-k="progress-charts">
    <figure class="da-chart da-chart-time"><figcaption><strong><i class="bi bi-hourglass-split"></i> Time per attempt</strong><span>Time on each try.</span></figcaption>
      <div class="da-canvas da-canvas-line"><canvas data-c="att-time" role="img" aria-label="Line chart of time per attempt for each retried level"></canvas></div></figure>
    <figure class="da-chart da-chart-error"><figcaption><strong><i class="bi bi-bug"></i> Wrong submissions per attempt</strong><span>Wrong answers on each try.</span></figcaption>
      <div class="da-canvas da-canvas-line"><canvas data-c="att-wrong" role="img" aria-label="Line chart of wrong submissions per attempt for each retried level"></canvas></div></figure>
  </div>
</section>
<section class="da-card da-plain" data-k="history-card">
  <div class="da-card-head"><div><h3><i class="bi bi-clock-history"></i> Attempt history</h3><p>Bar = time · dots = wrong submissions. Tap an attempt for its tasks and error messages.</p></div>${help('s-history')}</div>
  <div class="da-legend-row"><span><i class="da-key-bar"></i> Time</span><span><i class="da-key-dot"></i> 1 wrong submission</span><span><i class="bi bi-check-circle-fill da-ok"></i> Completed</span></div>
  <div data-k="history"></div>
</section>
<section class="da-card da-plain" data-k="messages-card">
  <div class="da-card-head"><div><h3><i class="bi bi-chat-square-text"></i> Most common errors</h3><p>Messages the game showed when an answer was wrong.</p></div>${help('s-messages')}</div>
  <ol class="da-messages" data-k="messages"></ol>
</section>`;

// Fixed categorical order (validated for colour-vision deficiencies in both themes). A level keeps
// its colour and marker shape across both progress charts; shapes and end labels keep lines
// distinguishable without relying on colour alone.
const SERIES = {
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
};
const SHAPES = ['circle', 'rect', 'triangle', 'rectRot', 'star', 'crossRot', 'rectRounded', 'cross'];
const seriesColor = i => SERIES[document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'][i % 8];

// 3 min 21 s -> "3m 21s" (compact, for bars and badges).
function fmtShort(seconds) {
    if (!Number.isFinite(seconds)) return '--';
    const s = Math.round(Math.abs(seconds));
    if (s < 60) return `${s}s`;
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return h ? `${h}h ${m}m` : r ? `${m}m ${r}s` : `${m}m`;
}

// Labels the last point of each line with its level, so lines are named where they end.
const lineEndLabels = {
    id: 'daLineEnds',
    afterDatasetsDraw(chart, args, options) {
        if (!options?.enabled) return;
        const { ctx } = chart;
        ctx.save();
        ctx.font = '700 11px Inter, "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            if (meta.hidden) return;
            let last = -1;
            dataset.data.forEach((v, j) => { if (v != null) last = j; });
            const point = meta.data[last];
            if (!point) return;
            ctx.fillStyle = dataset.borderColor;
            ctx.fillText(dataset.shortLabel, point.x + 9, point.y);
        });
        ctx.restore();
    }
};

function attemptLines(canvas, topics, valueOf, maxAttempts, axisTitle, tooltipValue) {
    if (!canvas || typeof Chart === 'undefined') return;
    const c = themeColors();
    // Hollow markers on the chart's own surface colour; the marker shape differs per level.
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--da-surface').trim() || '#ffffff';
    charts.get(canvas)?.destroy();
    charts.set(canvas, new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: Array.from({ length: maxAttempts }, (_, i) => `Attempt ${i + 1}`),
            datasets: topics.map(t => ({
                label: t.level ? `Level ${t.level} · ${t.topic}` : t.topic,
                shortLabel: t.level ? `L${t.level}` : t.topic.slice(0, 8),
                data: Array.from({ length: maxAttempts }, (_, i) => t.attempts.find(a => a.n === i + 1) ? valueOf(t.attempts.find(a => a.n === i + 1)) : null),
                borderColor: t.color, backgroundColor: t.color,
                pointStyle: t.shape, pointRadius: 5, pointHoverRadius: 8, pointBorderWidth: 2, pointBackgroundColor: surface,
                borderWidth: 2, tension: 0, spanGaps: true
            }))
        },
        plugins: [lineEndLabels],
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
            interaction: { mode: 'nearest', intersect: false },
            layout: { padding: { right: 30, top: 6 } },
            plugins: {
                legend: { display: topics.length > 1, position: 'bottom', labels: { color: c.ink, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 11 } } },
                daLineEnds: { enabled: true },
                tooltip: { callbacks: { label: item => `${item.dataset.label}: ${tooltipValue(item.raw)}` } }
            },
            scales: {
                x: { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.ink } },
                y: { beginAtZero: true, grace: '12%', grid: { color: c.grid }, border: { display: false }, ticks: { color: c.text, maxTicksLimit: 5, precision: 0 }, title: { display: true, text: axisTitle, color: c.text } }
            }
        }
    }));
}

// Change badge between the first and the latest attempt of a level (facts, not a judgement).
function changeBadge(first, last, kind) {
    const diff = kind === 'time' ? Math.round(last) - Math.round(first) : last - first;
    if (kind === 'time') {
        if (diff === 0) return `<span class="da-chg"><i class="bi bi-dash"></i> same time</span>`;
        return diff < 0
            ? `<span class="da-chg is-good"><i class="bi bi-arrow-down-right"></i> ${fmtShort(diff)} faster</span>`
            : `<span class="da-chg is-worse"><i class="bi bi-arrow-up-right"></i> ${fmtShort(diff)} slower</span>`;
    }
    if (diff === 0) return `<span class="da-chg"><i class="bi bi-dash"></i> ${last} wrong, same</span>`;
    return diff < 0
        ? `<span class="da-chg is-good"><i class="bi bi-arrow-down-right"></i> ${first} → ${last} wrong</span>`
        : `<span class="da-chg is-worse"><i class="bi bi-arrow-up-right"></i> ${first} → ${last} wrong</span>`;
}

function errorDots(n) {
    if (!n) return '<span class="da-dots is-zero" title="No wrong submissions">0</span>';
    const shown = Math.min(n, 8);
    return `<span class="da-dots" title="${plural(n, 'wrong submission')}">${'<i></i>'.repeat(shown)}${n > shown ? `<b>+${n - shown}</b>` : ''}<em>${n}</em></span>`;
}

export function renderStudentDetail(root, student) {
    if (!root) return;
    if (!root.dataset.ready) { root.innerHTML = DETAIL_TEMPLATE; root.dataset.ready = '1'; }
    root._student = student;
    const r = studentRecord(student);
    const c = themeColors();
    const empty = !r.topics.length;
    q(root, '[data-k="empty"]').hidden = !empty;
    root.querySelectorAll('.da-charts-stack, [data-k="progress-card"], [data-k="history-card"], [data-k="messages-card"]').forEach(el => { el.hidden = empty; });
    const items = r.topics.map(t => ({ ...t, avgTime: t.time }));
    const unit = timeUnit(Math.max(0, ...r.topics.map(t => t.time)));
    horizontalBars(q(root, '[data-c="time"]'), items, t => t.time / unit.divide, c.time, t => fmtShort(t.time), t => `${fmtTime(t.time)} over ${plural(t.attempts.length, 'attempt')}`, unit.name);
    horizontalBars(q(root, '[data-c="errors"]'), items, t => t.wrong, c.error, t => String(t.wrong), t => `${plural(t.wrong, 'wrong submission')} over ${plural(t.attempts.length, 'attempt')}`, 'Wrong submissions');

    // Attempt progress: only levels played at least twice can show a change.
    r.topics.forEach((t, i) => { t.color = seriesColor(i); t.shape = SHAPES[i % SHAPES.length]; });
    const retried = r.topics.filter(t => t.attempts.length >= 2);
    const firstLast = t => [t.attempts[0], t.attempts[t.attempts.length - 1]];
    const faster = retried.filter(t => { const [a, b] = firstLast(t); return Math.round(b.time) < Math.round(a.time); }).length;
    const fewer = retried.filter(t => { const [a, b] = firstLast(t); return b.wrong < a.wrong; }).length;
    set(root, '[data-k="retried"]', String(retried.length));
    set(root, '[data-k="retried-label"]', retried.length === 1 ? 'level retried' : 'levels retried');
    set(root, '[data-k="faster"]', retried.length ? `${faster} of ${retried.length}` : '0');
    set(root, '[data-k="fewer"]', retried.length ? `${fewer} of ${retried.length}` : '0');
    q(root, '[data-k="progress-empty"]').hidden = retried.length > 0;
    q(root, '[data-k="progress-charts"]').hidden = !retried.length;
    root.querySelector('.da-progress-stats').hidden = !retried.length;
    if (retried.length) {
        const maxAttempts = Math.max(...retried.map(t => Math.max(...t.attempts.map(a => a.n))));
        const attemptUnit = timeUnit(Math.max(...retried.flatMap(t => t.attempts.map(a => a.time))));
        attemptLines(q(root, '[data-c="att-time"]'), retried, a => a.time / attemptUnit.divide, maxAttempts, attemptUnit.name, v => fmtTime(v * attemptUnit.divide));
        attemptLines(q(root, '[data-c="att-wrong"]'), retried, a => a.wrong, maxAttempts, 'Wrong submissions', v => plural(v, 'wrong submission'));
    } else {
        clearChart(q(root, '[data-c="att-time"]'));
        clearChart(q(root, '[data-c="att-wrong"]'));
    }

    // Visual history. Keep open <details> open across live updates.
    const historyEl = q(root, '[data-k="history"]');
    const open = new Set([...historyEl.querySelectorAll('details[open]')].map(d => d.dataset.id));
    historyEl.innerHTML = r.topics.map(t => {
        const maxTime = Math.max(1, ...t.attempts.map(a => a.time));
        const [first, last] = firstLast(t);
        const badges = t.attempts.length >= 2 ? `${changeBadge(first.time, last.time, 'time')}${changeBadge(first.wrong, last.wrong, 'wrong')}` : '';
        return `
      <div class="da-history" style="--lvl:${t.color}">
        <div class="da-history-head">
          <div><strong>${t.level ? `Level ${t.level} · ` : ''}${safeText(t.topic)}</strong><span>${plural(t.attempts.length, 'attempt')}${t.completed ? ' · <i class="bi bi-check-circle-fill da-ok"></i> completed' : ''}</span></div>
          <div class="da-chgs">${badges}</div>
        </div>
        ${t.attempts.map(a => {
            const id = `${t.key}|${a.n}`;
            return `<details data-id="${safeText(id)}" ${open.has(id) ? 'open' : ''}>
              <summary title="Attempt ${a.n}: ${fmtTime(a.time)}, ${plural(a.wrong, 'wrong submission')}${a.when ? ', ' + fmtDate(a.when) : ''}">
                <span class="da-att">#${a.n}</span>
                <span class="da-tbar"><i style="width:max(4px, calc((100% - 62px) * ${(a.time / maxTime).toFixed(3)}))"></i><b>${fmtShort(a.time)}</b></span>
                ${errorDots(a.wrong)}
                <span class="da-res">${a.completed ? '<i class="bi bi-check-circle-fill da-ok" title="Completed"></i>' : '<i class="bi bi-circle da-muted" title="Not completed"></i>'}</span>
                <time>${a.when ? new Date(a.when).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : ''}</time>
              </summary>
              <ul class="da-tasks">${a.tasks.map(task => `
                <li><div><strong>${safeText(task.name)}</strong><span>${task.time !== null ? fmtShort(task.time) : '--'}</span>${errorDots(task.wrong ?? 0)}</div>
                ${task.errors.length ? `<ol>${task.errors.map(e => `<li>${e.at !== null ? `<time>${clock(e.at)}</time>` : ''}${safeText(e.message)}</li>`).join('')}</ol>` : ''}</li>`).join('') || '<li class="da-muted">No task details recorded.</li>'}
              </ul></details>`;
        }).join('')}
      </div>`;
    }).join('');

    const messages = new Map();
    r.topics.forEach(t => t.attempts.forEach(a => a.tasks.forEach(task => task.errors.forEach(e => {
        const m = messages.get(e.message) || { message: e.message, count: 0, topics: new Set() };
        m.count++; m.topics.add(t.topic); messages.set(e.message, m);
    }))));
    const list = [...messages.values()].sort((a, b) => b.count - a.count || a.message.localeCompare(b.message)).slice(0, 6);
    q(root, '[data-k="messages"]').innerHTML = list.length
        ? list.map(m => `<li><strong>${safeText(m.message)}</strong><small>${plural(m.count, 'time')} · ${m.topics.size > 1 ? `${m.topics.size} topics` : safeText([...m.topics][0])}</small></li>`).join('')
        : '<li class="da-none">No error messages recorded.</li>';
    setLiveNumbers(root, {
        's-progress': retried.length ? `${plural(retried.length, 'level')} retried: ${faster} faster, ${fewer} with fewer wrong submissions.` : 'No level has been played more than once yet.'
    });
}

// Chart colors follow the light/dark theme, so redraw visible views when it changes.
new MutationObserver(() => {
    document.querySelectorAll('[data-da-class]').forEach(root => root._students && renderClassOverview(root, root._students));
    document.querySelectorAll('[data-da-detail]').forEach(root => root._student && root.offsetParent && renderStudentDetail(root, root._student));
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
