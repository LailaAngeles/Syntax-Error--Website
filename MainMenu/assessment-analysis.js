// SyntaxError Final Assessment: one game play that mixes questions from levels 1-19.
// Used by the teacher page (MainMenu/Assessment.html) and the Super Admin page (SuperAdmin/Assessment.html).
// Read-only: this module never writes to Firestore. Like record-analysis.js, every number is a count,
// a duration, a date or a score the game saved; nothing is estimated.
//
// Record shape the game saves (sections/{id}/classList/{student}), the same attempt pattern as the levels:
//   Subject Content > Final Assessment > attempt ("FirstAttemp", "SecondAttemp", ... "Attempt21")
//     attempt:  { assessmentCompleted: true, completionTime (s), wrongAttempts, score (0-100),
//                 totalItems, startedAt, completedAt, <item>: {...} }
//     item:     { level: 1-19, question, correct (or completed), wrongAttempts, timeSeconds,
//                 errors: [{ message, atSeconds }] }
//   Item keys are free (Q1, Q2, ...). Do not name them "Level<N>" or use "level<N>Completed" fields:
//   those names are read as level completion markers elsewhere. The level comes from the item's
//   "level" field, or from a key that starts with L<N>_ (e.g. "L5_Q2").
//   Score: the saved "score" when present, otherwise correct items / total items x 100.

import {
    LEVEL_CATALOG, TOTAL_LEVELS, attemptNumber, isAssessmentKey, toMillis, fmtTime, fmtDate, safeText,
    uniqueStudents, downloadCsv, csvFileName
} from './record-analysis.js';

export const ASSESSMENT_TITLE = 'Final Assessment';
// The score a student needs for "Passed". Change it here; every page and export follows.
export const PASSING_SCORE = 75;

const LEVEL_TITLE = new Map(LEVEL_CATALOG.map(l => [l.id, l.title]));
export const levelTitle = level => LEVEL_TITLE.get(level) || `Level ${level}`;

// ---------- small helpers (same rules as record-analysis.js) ----------
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const amount = value => { const n = num(value); return n === null || n < 0 ? null : n; };
const isTimestamp = value => !!value && typeof value === 'object' && (typeof value.toDate === 'function' || ('seconds' in value && 'nanoseconds' in value));
const isMap = value => !!value && typeof value === 'object' && !Array.isArray(value) && !isTimestamp(value);
const yes = value => value === true || value === 1 || value === 'true';
const prettyName = value => String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const pct = (part, whole) => whole ? Math.round(part / whole * 100) : 0;
const avg = list => list.length ? list.reduce((s, v) => s + v, 0) / list.length : null;
const studentKey = s => `${s.parentDocId ?? s.section ?? ''}/${s.firebaseId ?? s.id ?? s.name ?? ''}`;

// ---------- reading one student ----------
function assessmentNode(student) {
    const content = student?.['Subject Content'] || student?.subjectContent;
    if (!isMap(content)) return null;
    const key = Object.keys(content).find(isAssessmentKey);
    return key && isMap(content[key]) ? content[key] : null;
}

function itemLevel(key, item) {
    const saved = num(item.level);
    if (saved !== null && Number.isInteger(saved) && saved >= 1 && saved <= TOTAL_LEVELS) return saved;
    const m = String(key).match(/^(?:l|lvl)\s*(\d{1,2})(?:[^0-9]|$)/i);
    return m && +m[1] >= 1 && +m[1] <= TOTAL_LEVELS ? +m[1] : null;
}

function readItem(key, item) {
    const errors = Array.isArray(item.errors)
        ? item.errors.filter(e => e && e.message).map(e => ({ message: String(e.message), at: num(e.atSeconds) }))
        : [];
    return {
        key,
        level: itemLevel(key, item),
        question: prettyName(item.question || item.title || item.name || key),
        // "correct" decides when the game saves it; "completed" is the levels' word for the same thing.
        correct: 'correct' in item ? yes(item.correct) : yes(item.completed),
        wrong: amount(item.wrongAttempts) ?? 0,
        time: amount(item.timeSeconds),
        errors
    };
}

function readAttempt(n, attempt) {
    const items = Object.entries(attempt).filter(([, v]) => isMap(v)).map(([k, v]) => readItem(k, v))
        .sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.key.localeCompare(b.key, undefined, { numeric: true }));
    const correct = items.filter(i => i.correct).length;
    const total = Math.max(amount(attempt.totalItems) ?? 0, items.length);
    const savedScore = num(attempt.score);
    const itemWrong = items.reduce((s, i) => s + i.wrong, 0);
    const itemTime = items.reduce((s, i) => s + (i.time ?? 0), 0);
    const started = toMillis(attempt.startedAt), finished = toMillis(attempt.completedAt);
    const completed = yes(attempt.assessmentCompleted) || yes(attempt.completed);
    const time = amount(attempt.completionTime) || itemTime;
    const wrong = Math.max(amount(attempt.wrongAttempts) ?? 0, itemWrong);
    // The game creates empty attempt slots, and those are not attempts.
    if (!completed && !time && !wrong && !started && !finished && !items.length && savedScore === null) return null;
    return {
        n, items, correct, total, time, wrong, completed, started, finished,
        score: savedScore !== null ? Math.max(0, Math.min(100, Math.round(savedScore))) : total ? pct(correct, total) : null,
        when: finished || started
    };
}

// Per-level numbers of one attempt.
function levelBreakdown(attempt) {
    const levels = new Map();
    for (const item of attempt?.items || []) {
        if (!item.level) continue;
        const l = levels.get(item.level) || { level: item.level, items: 0, correct: 0, wrong: 0, time: 0, timed: 0 };
        l.items++; if (item.correct) l.correct++; l.wrong += item.wrong;
        if (item.time !== null) { l.time += item.time; l.timed++; }
        levels.set(item.level, l);
    }
    return levels;
}

// Status and result of one student. "Result" is the latest completed attempt, the same rule the
// game's level menu uses for its latest score; the best score is shown beside it.
export function assessmentRecord(student) {
    const node = assessmentNode(student);
    const seen = new Set();
    const attempts = [];
    if (node) for (const [key, value] of Object.entries(node)) {
        const n = attemptNumber(key);
        if (!n || !isMap(value)) continue;
        const read = readAttempt(n, value);
        // The same attempt saved under both spellings (FirstAttemp, FirstAttempt) counts once.
        const id = read && `${read.n}|${read.time}|${read.wrong}|${read.when}`;
        if (read && !seen.has(id)) { seen.add(id); attempts.push(read); }
    }
    attempts.sort((a, b) => a.n - b.n || a.when - b.when);
    const finished = attempts.filter(a => a.completed);
    const result = finished[finished.length - 1] || null;
    const best = finished.reduce((b, a) => a.score !== null && (b === null || a.score > b.score) ? a : b, null);
    const status = result ? 'completed' : attempts.length ? 'in-progress' : 'not-taken';
    return {
        attempts, result, best, status,
        latest: attempts[attempts.length - 1] || null,
        passed: result?.score != null && result.score >= PASSING_SCORE,
        levels: levelBreakdown(result),
        lastActivity: Math.max(0, ...attempts.map(a => a.when))
    };
}

export const STATUS_LABEL = { 'not-taken': 'Not taken', 'in-progress': 'Started, not finished', completed: 'Completed' };

// ---------- a group of students ----------
export function assessmentSummary(allStudents) {
    const students = uniqueStudents(allStudents).map(student => ({ student, record: assessmentRecord(student) }));
    const done = students.filter(s => s.record.result);
    const scores = done.map(s => s.record.result.score).filter(v => v !== null);
    const levels = Array.from({ length: TOTAL_LEVELS + 1 }, (_, level) => ({ level, items: 0, correct: 0, wrong: 0, time: 0, timed: 0, students: 0, missed: 0, messages: new Map() }));
    for (const { record } of done) {
        for (const l of record.levels.values()) {
            const entry = levels[l.level];
            entry.students++; entry.items += l.items; entry.correct += l.correct; entry.wrong += l.wrong;
            entry.time += l.time; entry.timed += l.timed;
            if (l.correct < l.items) entry.missed++;
        }
        for (const item of record.result.items) {
            if (item.level) item.errors.forEach(e => levels[item.level].messages.set(e.message, (levels[item.level].messages.get(e.message) || 0) + 1));
        }
    }
    const bins = [[0, 49], [50, PASSING_SCORE - 1], [PASSING_SCORE, 89], [90, 100]].map(([lo, hi]) => ({ lo, hi, count: scores.filter(v => v >= lo && v <= hi).length }));
    return {
        students,
        total: students.length,
        duplicates: allStudents.length - students.length,
        taken: students.filter(s => s.record.attempts.length).length,
        completed: done.length,
        inProgress: students.filter(s => s.record.status === 'in-progress').length,
        notTaken: students.filter(s => s.record.status === 'not-taken').length,
        passed: done.filter(s => s.record.passed).length,
        avgScore: avg(scores),
        avgTime: avg(done.map(s => s.record.result.time).filter(Boolean)),
        bins,
        levels: levels.slice(1).map(l => ({
            ...l, title: levelTitle(l.level), rate: l.items ? l.correct / l.items : null,
            avgTime: l.timed ? l.time / l.timed : null,
            topMessage: [...l.messages.entries()].sort((a, b) => b[1] - a[1])[0] || null
        }))
    };
}

// ---------- CSV ----------
const csvDuration = seconds => {
    const s = Math.round(seconds || 0);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const ASSESSMENT_CSV_HEADER = ['Student number', 'Name', 'Section', 'School year', 'Status', 'Attempts', 'Result score (%)',
    `Passed (${PASSING_SCORE}% or higher)`, 'Correct items', 'Total items', 'Time (h:mm:ss)', 'Incorrect submissions', 'Completed on', 'Best score (%)',
    ...LEVEL_CATALOG.map(l => `Level ${l.id} correct`)];
export function assessmentCsvRows(students, yearOf) {
    return uniqueStudents(students).map(s => {
        const r = assessmentRecord(s), a = r.result;
        return [s.id != null ? `="${s.id}"` : '', s.name ?? '', s.section ?? s.sectionName ?? '', yearOf?.(s) ?? '', STATUS_LABEL[r.status], r.attempts.length,
            a?.score ?? '', a ? (r.passed ? 'Yes' : 'No') : '', a?.correct ?? '', a?.total ?? '', a ? csvDuration(a.time) : '', a?.wrong ?? '',
            a?.finished ? fmtDate(a.finished) : '', r.best?.score ?? '',
            ...LEVEL_CATALOG.map(l => { const b = r.levels.get(l.id); return b ? `${b.correct} of ${b.items}` : ''; })];
    });
}
export function exportAssessmentCsv(students, yearOf, ...nameParts) {
    const rows = assessmentCsvRows(students, yearOf);
    if (rows.length) downloadCsv(csvFileName(...nameParts, 'final-assessment'), ASSESSMENT_CSV_HEADER, rows);
    return rows.length;
}

// ---------- charts ----------
const charts = new WeakMap();
function colors() {
    const css = getComputedStyle(document.documentElement);
    const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return { good: read('--da-level', '#0f8a5f'), warn: read('--da-error', '#b45f06'), bad: read('--as-bad', '#c2410c'), time: read('--da-time', '#1f6fd1'),
        text: read('--da-muted', '#6b7280'), ink: read('--da-ink', '#1f2937'), grid: read('--da-line', '#e5e7eb') };
}
function draw(canvas, config) {
    if (!canvas || typeof Chart === 'undefined') return;
    charts.get(canvas)?.destroy();
    charts.set(canvas, new Chart(canvas.getContext('2d'), config));
}
const rateColor = (rate, c) => rate === null ? c.grid : rate * 100 >= PASSING_SCORE ? c.good : rate >= .5 ? c.warn : c.bad;

function levelChart(canvas, summary) {
    const c = colors();
    const rows = summary.levels;
    draw(canvas, {
        type: 'bar',
        data: { labels: rows.map(l => String(l.level)), datasets: [{ data: rows.map(l => l.rate === null ? 0 : Math.round(l.rate * 100)), backgroundColor: rows.map(l => rateColor(l.rate, c)), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 30 }] },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: {
                    title: list => `Level ${rows[list[0].dataIndex].level} · ${rows[list[0].dataIndex].title}`,
                    label: item => { const l = rows[item.dataIndex]; return l.items ? `${l.correct} of ${l.items} items correct (${Math.round(l.rate * 100)}%)` : 'No answered items yet'; }
                } }
            },
            scales: {
                x: { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.ink, font: { weight: 600 } }, title: { display: true, text: 'Level', color: c.text } },
                y: { min: 0, max: 100, grid: { color: c.grid }, border: { display: false }, ticks: { color: c.text, stepSize: 25, callback: v => v + '%' }, title: { display: true, text: 'Items correct', color: c.text } }
            }
        }
    });
}

function scoreChart(canvas, summary) {
    const c = colors();
    const bins = summary.bins;
    draw(canvas, {
        type: 'bar',
        data: { labels: bins.map(b => `${b.lo}–${b.hi}%`), datasets: [{ data: bins.map(b => b.count), backgroundColor: bins.map(b => b.lo >= PASSING_SCORE ? c.good : b.lo >= 50 ? c.warn : c.bad), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 46 }] },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => `${plural(item.raw, 'student')} (${pct(item.raw, summary.completed)}% of those who completed)` } } },
            scales: {
                x: { grid: { display: false }, border: { color: c.grid }, ticks: { color: c.ink, font: { weight: 600 } }, title: { display: true, text: 'Result score', color: c.text } },
                y: { beginAtZero: true, grid: { color: c.grid }, border: { display: false }, ticks: { color: c.text, precision: 0 }, title: { display: true, text: 'Students', color: c.text } }
            }
        }
    });
}

// ---------- rendering: class overview ----------
const scorePill = (score, passed) => score === null || score === undefined ? '<span class="da-muted">--</span>'
    : `<span class="as-score ${passed ? 'is-pass' : 'is-below'}">${score}%</span>`;
const statusPill = status => `<span class="as-status as-status-${status}">${STATUS_LABEL[status]}</span>`;
const rateText = rate => rate === null ? '--' : `${Math.round(rate * 100)}%`;

const SORTS = {
    name: (a, b) => String(a.student.name ?? '').localeCompare(String(b.student.name ?? '')),
    'score-desc': (a, b) => (b.record.result?.score ?? -1) - (a.record.result?.score ?? -1),
    'score-asc': (a, b) => (a.record.result?.score ?? 101) - (b.record.result?.score ?? 101),
    'time-desc': (a, b) => (b.record.result?.time ?? -1) - (a.record.result?.time ?? -1),
    recent: (a, b) => b.record.lastActivity - a.record.lastActivity
};
const FILTERS = {
    all: () => true,
    completed: s => s.record.status === 'completed',
    passed: s => s.record.passed,
    below: s => s.record.status === 'completed' && !s.record.passed,
    'in-progress': s => s.record.status === 'in-progress',
    'not-taken': s => s.record.status === 'not-taken'
};

function shell(root, opts) {
    root.innerHTML = `
    <div class="da-kpis as-kpis">
        <div class="da-kpi"><span><i class="bi bi-people"></i> Students</span><strong data-k="total">0</strong><small data-k="total-note">In view</small></div>
        <div class="da-kpi da-kpi-time"><span><i class="bi bi-clipboard-check"></i> Completed</span><strong data-k="completed">0</strong><small data-k="completed-note"></small></div>
        <div class="da-kpi da-kpi-level"><span><i class="bi bi-award"></i> Passed</span><strong data-k="passed">0</strong><small data-k="passed-note"></small></div>
        <div class="da-kpi as-kpi-score"><span><i class="bi bi-percent"></i> Average score</span><strong data-k="avg">--</strong><small data-k="avg-note"></small></div>
    </div>
    <div class="as-extra" data-k="extra"></div>
    <div class="da-charts as-charts">
        <figure class="da-chart as-chart-wide">
            <figcaption><strong><i class="bi bi-bar-chart-line"></i> Items correct per level</strong><span>The 19 level topics inside the assessment. Each bar is the share of answered items that were correct, from each student's result attempt. Green: ${PASSING_SCORE}% or more, amber: 50–${PASSING_SCORE - 1}%, orange: below 50%.</span></figcaption>
            <div class="da-canvas da-canvas-level"><canvas data-k="level-chart" aria-label="Items correct per level"></canvas></div>
            <p class="da-summary" data-k="level-summary"></p>
        </figure>
        <figure class="da-chart">
            <figcaption><strong><i class="bi bi-graph-up"></i> Score distribution</strong><span>Result scores of the students who completed the assessment. Passing is ${PASSING_SCORE}%.</span></figcaption>
            <div class="da-canvas"><canvas data-k="score-chart" aria-label="Score distribution"></canvas></div>
        </figure>
    </div>
    <section class="da-card da-plain">
        <div class="da-card-head"><div><h3><i class="bi bi-list-ol"></i> Results per level topic</h3><p>Exact numbers behind the chart. "Students with a miss" answered at least one item of that level incorrectly.</p></div></div>
        <div class="da-table-wrap"><table class="da-table as-level-table">
            <thead><tr><th>Level</th><th>Topic</th><th>Items correct</th><th>Correct</th><th>Students with a miss</th><th>Incorrect submissions</th><th>Avg. time per item</th><th>Most common error</th></tr></thead>
            <tbody data-k="levels"></tbody>
        </table></div>
    </section>
    <section class="da-card da-plain">
        <div class="da-card-head"><div><h3><i class="bi bi-person-lines-fill"></i> Student results</h3><p>Result = the student's latest completed attempt. Select <b>View</b> for the per-level breakdown, every question and every attempt.</p></div></div>
        <div class="as-tools">
            <label class="da-filter as-search">Search<input type="search" data-k="search" placeholder="Name or student number" autocomplete="off" spellcheck="false"></label>
            <label class="da-filter">Show<select data-k="filter">
                <option value="all">All students</option><option value="completed">Completed</option><option value="passed">Passed (${PASSING_SCORE}%+)</option>
                <option value="below">Below ${PASSING_SCORE}%</option><option value="in-progress">Started, not finished</option><option value="not-taken">Not taken</option>
            </select></label>
            <label class="da-filter">Sort by<select data-k="sort">
                <option value="name">Name (A–Z)</option><option value="score-desc">Highest score</option><option value="score-asc">Lowest score</option>
                <option value="time-desc">Most time</option><option value="recent">Most recent activity</option>
            </select></label>
        </div>
        <p class="student-table-count as-count" data-k="count"></p>
        <div class="da-table-wrap"><table class="da-table as-student-table">
            <thead><tr><th>Student</th>${opts.showSection ? '<th>Section</th>' : ''}<th>Status</th><th>Score</th><th>Correct items</th><th>Time</th><th>Incorrect</th><th>Attempts</th><th>Completed on</th><th></th></tr></thead>
            <tbody data-k="students"></tbody>
        </table></div>
    </section>`;
    const k = name => root.querySelector(`[data-k="${name}"]`);
    ['search', 'filter', 'sort'].forEach(name => k(name).addEventListener(name === 'search' ? 'input' : 'change', () => drawStudents(root)));
    k('students').addEventListener('click', event => {
        const button = event.target.closest('[data-open]');
        const entry = button && root._as.rows.get(button.dataset.open);
        if (entry) openAssessmentStudent(entry.student, root._as.opts);
    });
    root.dataset.ready = '1';
}

function drawStudents(root) {
    const k = name => root.querySelector(`[data-k="${name}"]`);
    const { summary, opts } = root._as;
    const term = k('search').value.trim().toLowerCase();
    const digits = term.replace(/^0+/, '');
    const list = summary.students
        .filter(FILTERS[k('filter').value] || FILTERS.all)
        .filter(({ student: s }) => !term || String(s.name ?? '').toLowerCase().includes(term) || (digits && String(s.id ?? '').replace(/^0+/, '').includes(digits)))
        .sort((a, b) => (SORTS[k('sort').value] || SORTS.name)(a, b) || SORTS.name(a, b));
    root._as.rows = new Map(list.map(e => [studentKey(e.student), e]));
    k('count').textContent = `Showing ${list.length} of ${plural(summary.total, 'student')}`;
    const cols = opts.showSection ? 10 : 9;
    k('students').innerHTML = list.length ? list.map(({ student: s, record: r }) => {
        const a = r.result;
        return `<tr>
            <td><strong>${safeText(s.name || 'Unknown')}</strong><small>${safeText(s.id ?? s.firebaseId ?? '')}</small></td>
            ${opts.showSection ? `<td>${safeText(s.section ?? s.sectionName ?? '')}</td>` : ''}
            <td>${statusPill(r.status)}</td>
            <td>${scorePill(a?.score, r.passed)}${r.best && r.best !== a ? `<small>Best ${r.best.score}%</small>` : ''}</td>
            <td>${a ? `${a.correct} of ${a.total}` : '<span class="da-muted">--</span>'}</td>
            <td>${a ? fmtTime(a.time) : '<span class="da-muted">--</span>'}</td>
            <td>${a ? a.wrong : '<span class="da-muted">--</span>'}</td>
            <td>${r.attempts.length || '<span class="da-muted">0</span>'}</td>
            <td>${a?.finished ? fmtDate(a.finished) : r.lastActivity ? `<span class="da-muted">Last played ${fmtDate(r.lastActivity, false)}</span>` : '<span class="da-muted">--</span>'}</td>
            <td><button type="button" class="da-btn as-view" data-open="${safeText(studentKey(s))}" ${r.attempts.length ? '' : 'disabled title="No assessment attempt yet"'}><i class="bi bi-eye"></i> View</button></td>
        </tr>`;
    }).join('') : `<tr><td colspan="${cols}" class="as-none">No students match this view.</td></tr>`;
}

// root: an empty element. students: class-list records (with section, id, name).
// opts.showSection: add a Section column. opts.yearOf(student): school year label for the popup.
export function renderAssessmentOverview(root, students, opts = {}) {
    if (!root) return;
    if (!root.dataset.ready) shell(root, opts);
    const summary = assessmentSummary(students);
    root._as = { ...(root._as || {}), summary, opts };
    const k = name => root.querySelector(`[data-k="${name}"]`);
    k('total').textContent = summary.total;
    k('total-note').textContent = summary.duplicates ? `In view (${plural(summary.duplicates, 'duplicate record')} counted once)` : 'In view';
    k('completed').textContent = summary.completed;
    k('completed-note').textContent = `${pct(summary.completed, summary.total)}% · ${summary.inProgress} started, not finished · ${summary.notTaken} not taken`;
    k('passed').textContent = summary.passed;
    k('passed-note').textContent = summary.completed ? `${pct(summary.passed, summary.completed)}% of those who completed (${PASSING_SCORE}%+)` : `Passing score: ${PASSING_SCORE}%`;
    k('avg').textContent = summary.avgScore === null ? '--' : `${Math.round(summary.avgScore)}%`;
    k('avg-note').textContent = summary.avgTime ? `Average time ${fmtTime(summary.avgTime)}` : 'Of result attempts';
    k('extra').innerHTML = summary.total && !summary.taken
        ? `<p class="da-empty"><i class="bi bi-hourglass-split"></i> No student in this view has started the ${ASSESSMENT_TITLE} yet. Results appear here live as soon as the game saves them.</p>` : '';

    // The weakest level among those with answers, for the one-line chart summary.
    const answered = summary.levels.filter(l => l.items);
    const weakest = [...answered].sort((a, b) => a.rate - b.rate || b.items - a.items)[0];
    const strongest = [...answered].sort((a, b) => b.rate - a.rate || b.items - a.items)[0];
    k('level-summary').textContent = weakest && answered.length > 1
        ? `Lowest: Level ${weakest.level} (${weakest.title}), ${rateText(weakest.rate)} correct. Highest: Level ${strongest.level} (${strongest.title}), ${rateText(strongest.rate)} correct.` : '';
    levelChart(k('level-chart'), summary);
    scoreChart(k('score-chart'), summary);

    k('levels').innerHTML = summary.levels.map(l => `<tr>
        <td><strong>${l.level}</strong></td>
        <td>${safeText(l.title)}</td>
        <td>${l.items ? `${l.correct} of ${l.items}` : '<span class="da-muted">No answers yet</span>'}</td>
        <td>${l.items ? `<span class="as-rate" style="--rate:${Math.round(l.rate * 100)}%;--rate-color:${rateColor(l.rate, colors())}"><span></span>${rateText(l.rate)}</span>` : '<span class="da-muted">--</span>'}</td>
        <td>${l.students ? `${l.missed} of ${l.students}` : '<span class="da-muted">--</span>'}</td>
        <td>${l.items ? l.wrong : '<span class="da-muted">--</span>'}</td>
        <td>${l.avgTime !== null ? fmtTime(l.avgTime) : '<span class="da-muted">--</span>'}</td>
        <td>${l.topMessage ? `<span class="as-msg">${safeText(l.topMessage[0])}</span><small>${plural(l.topMessage[1], 'time')}</small>` : '<span class="da-muted">--</span>'}</td>
    </tr>`).join('');
    drawStudents(root);

    // Keep an open student popup in step with live updates.
    if (openKey) {
        const entry = summary.students.find(e => studentKey(e.student) === openKey);
        if (entry) openAssessmentStudent(entry.student, opts, { keepScroll: true });
    }
}

// ---------- rendering: one student (popup) ----------
let openKey = null;
let openAttempt = null;

function modal() {
    let overlay = document.getElementById('as-modal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'as-modal';
    overlay.className = 'as-modal';
    overlay.hidden = true;
    overlay.innerHTML = `<div class="as-modal-box" role="dialog" aria-modal="true" aria-labelledby="as-modal-title" tabindex="-1">
        <div class="as-modal-head"><div><span class="da-eyebrow">${ASSESSMENT_TITLE.toUpperCase()}</span><h2 id="as-modal-title"></h2><p id="as-modal-sub"></p></div>
        <button type="button" class="as-close" aria-label="Close">Close <i class="bi bi-x-lg"></i></button></div>
        <div class="as-modal-body" id="as-modal-body"></div></div>`;
    document.body.append(overlay);
    const close = () => { overlay.hidden = true; openKey = null; openAttempt = null; document.body.classList.remove('as-modal-open'); };
    overlay.querySelector('.as-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) close(); });
    overlay.addEventListener('click', e => {
        const pick = e.target.closest('[data-attempt]');
        if (!pick || !overlay._student) return;
        openAttempt = +pick.dataset.attempt;
        openAssessmentStudent(overlay._student, overlay._opts, { keepScroll: true });
    });
    return overlay;
}

export function openAssessmentStudent(student, opts = {}, { keepScroll = false } = {}) {
    const overlay = modal();
    const key = studentKey(student);
    if (key !== openKey) openAttempt = null;
    openKey = key;
    overlay._student = student; overlay._opts = opts;
    const r = assessmentRecord(student);
    const shown = r.attempts.find(a => a.n === openAttempt) || r.result || r.latest;
    const year = opts.yearOf?.(student);
    overlay.querySelector('#as-modal-title').textContent = student.name || 'Student';
    overlay.querySelector('#as-modal-sub').textContent = [student.id ?? student.firebaseId, student.section ?? student.sectionName, year && `S.Y. ${year}`].filter(Boolean).join(' · ');
    const body = overlay.querySelector('#as-modal-body');
    if (!shown) {
        body.innerHTML = `<p class="da-empty">This student has not started the ${ASSESSMENT_TITLE} yet.</p>`;
    } else {
        const isResult = shown === r.result;
        const levels = levelBreakdown(shown);
        const passed = shown.score !== null && shown.score >= PASSING_SCORE;
        body.innerHTML = `
        <div class="as-attempts" role="group" aria-label="Attempts">${r.attempts.map(a => `<button type="button" data-attempt="${a.n}" class="${a === shown ? 'is-active' : ''}" aria-pressed="${a === shown}">Attempt ${a.n}${a === r.result ? ' · Result' : ''}${a.completed ? '' : ' · not finished'}</button>`).join('')}</div>
        <p class="as-note">${isResult ? 'This is the result attempt: the latest one the student finished.' : shown.completed ? 'An earlier finished attempt. The result is the latest finished attempt.' : 'This attempt was not finished, so it is not the result.'}</p>
        <div class="as-stats">
            <div class="as-stat-score ${shown.score === null ? '' : passed ? 'is-pass' : 'is-below'}"><span>Score</span><strong>${shown.score === null ? '--' : shown.score + '%'}</strong><small>${shown.score === null ? 'Not saved' : passed ? `Passed (${PASSING_SCORE}%+)` : `Below ${PASSING_SCORE}%`}</small></div>
            <div><span>Correct items</span><strong>${shown.correct} of ${shown.total}</strong><small>${shown.total ? pct(shown.correct, shown.total) + '% of items' : 'No items saved'}</small></div>
            <div><span>Time</span><strong>${fmtTime(shown.time)}</strong><small>${shown.started ? 'Started ' + fmtDate(shown.started) : '&nbsp;'}</small></div>
            <div><span>Incorrect submissions</span><strong>${shown.wrong}</strong><small>${shown.finished ? 'Finished ' + fmtDate(shown.finished) : shown.completed ? 'Finished' : 'Not finished'}</small></div>
        </div>
        <h3 class="as-h3"><i class="bi bi-grid-3x3-gap"></i> Per level</h3>
        <div class="as-level-grid">${LEVEL_CATALOG.map(l => {
            const b = levels.get(l.id);
            const state = !b ? 'none' : b.correct === b.items ? 'all' : b.correct ? 'some' : 'zero';
            return `<div class="as-level as-level-${state}" title="Level ${l.id} · ${safeText(l.title)}"><strong>${l.id}</strong><span>${b ? `${b.correct}/${b.items}` : '–'}</span></div>`;
        }).join('')}</div>
        <div class="as-legend"><span><i class="as-key as-level-all"></i> All correct</span><span><i class="as-key as-level-some"></i> Some correct</span><span><i class="as-key as-level-zero"></i> None correct</span><span><i class="as-key as-level-none"></i> No item saved</span></div>
        <h3 class="as-h3"><i class="bi bi-question-square"></i> Questions</h3>
        ${shown.items.length ? `<div class="da-table-wrap"><table class="da-table as-item-table"><thead><tr><th>Level</th><th>Question</th><th>Result</th><th>Incorrect</th><th>Time</th><th>Error messages</th></tr></thead><tbody>
            ${shown.items.map(i => `<tr>
                <td>${i.level ? `<strong>${i.level}</strong><small>${safeText(levelTitle(i.level))}</small>` : '<span class="da-muted">--</span>'}</td>
                <td>${safeText(i.question)}</td>
                <td>${i.correct ? '<span class="as-status as-status-completed"><i class="bi bi-check-lg"></i> Correct</span>' : '<span class="as-status as-status-wrong"><i class="bi bi-x-lg"></i> Not correct</span>'}</td>
                <td>${i.wrong}</td>
                <td>${i.time !== null ? fmtTime(i.time) : '<span class="da-muted">--</span>'}</td>
                <td>${i.errors.length ? `<ul class="as-errors">${i.errors.map(e => `<li>${safeText(e.message)}${e.at !== null ? ` <small>at ${fmtTime(e.at)}</small>` : ''}</li>`).join('')}</ul>` : '<span class="da-muted">None</span>'}</td>
            </tr>`).join('')}
        </tbody></table></div>` : '<p class="da-empty">The game saved no questions for this attempt.</p>'}
        ${r.attempts.length > 1 ? `<h3 class="as-h3"><i class="bi bi-clock-history"></i> All attempts</h3>
        <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Attempt</th><th>Status</th><th>Score</th><th>Correct</th><th>Time</th><th>Incorrect</th><th>Date</th></tr></thead><tbody>
            ${r.attempts.map(a => `<tr><td>${a.n}${a === r.result ? ' <span class="da-pill da-pill-ok">Result</span>' : ''}</td><td>${a.completed ? 'Finished' : 'Not finished'}</td><td>${scorePill(a.score, a.score !== null && a.score >= PASSING_SCORE)}</td><td>${a.correct} of ${a.total}</td><td>${fmtTime(a.time)}</td><td>${a.wrong}</td><td>${a.when ? fmtDate(a.when) : '--'}</td></tr>`).join('')}
        </tbody></table></div>` : ''}`;
    }
    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    document.body.classList.add('as-modal-open');
    if (!keepScroll) overlay.querySelector('.as-modal-body').scrollTo?.(0, 0);
    if (wasHidden) overlay.querySelector('.as-modal-box').focus({ preventScroll: true });
}

// ---------- Super Admin: one row per section ----------
// groups: [{ name, teachers: [names], students: [...] }]
export function renderSectionComparison(tbody, groups, onPick) {
    if (!tbody) return;
    if (!groups.length) { tbody.innerHTML = '<tr><td colspan="7" class="as-none">No sections in this school year.</td></tr>'; return; }
    tbody.innerHTML = groups.map(g => {
        const s = assessmentSummary(g.students);
        return `<tr>
            <td><button type="button" class="sa-section-link as-section-link" data-section="${safeText(g.name)}">${safeText(g.name)} <i class="bi bi-arrow-right-short"></i></button></td>
            <td>${g.teachers.length ? g.teachers.map(t => `<span class="insight-pill">${safeText(t)}</span>`).join(' ') : '<span class="da-muted">No teacher assigned</span>'}</td>
            <td>${s.total}</td>
            <td>${s.completed} of ${s.total}</td>
            <td>${s.avgScore === null ? '<span class="da-muted">--</span>' : Math.round(s.avgScore) + '%'}</td>
            <td>${s.completed ? `${s.passed} of ${s.completed}` : '<span class="da-muted">--</span>'}</td>
            <td>${s.completed ? `${pct(s.passed, s.completed)}%` : '<span class="da-muted">--</span>'}</td>
        </tr>`;
    }).join('');
    if (!tbody.dataset.wired) {
        tbody.dataset.wired = '1';
        tbody.addEventListener('click', e => { const b = e.target.closest('.as-section-link'); if (b) onPick?.(b.dataset.section); });
    }
}
