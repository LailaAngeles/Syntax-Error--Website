// SyntaxError Final Assessment: one game play that mixes questions from levels 1-19.
// Used by the teacher page (MainMenu/Assessment.html) and the Super Admin page (SuperAdmin/Assessment.html).
// Read-only: this module never writes to Firestore. Every number is a count, a duration, a date or an
// answer the game saved; nothing is estimated.
//
// Record shape the game saves (sections/{id}/classList/{student}):
//   Subject Content > Final Assessment > attempt ("FirstAttemp", "SecondAttemp", ... "Attempt21")
//     attempt:  { assessmentCompleted: true, completionTime (s), wrongAttempts, totalItems,
//                 startedAt, completedAt, <item>: {...} }
//     item:     { level: 1-19, question, correct (or completed), wrongAttempts, timeSeconds,
//                 errors: [{ message, atSeconds }] }
//   Item keys are free (Q1, Q2, ...). Do not name them "Level<N>" or use "level<N>Completed" fields:
//   those names are read as level completion markers elsewhere. The level comes from the item's
//   "level" field, or from a key that starts with L<N>_ (e.g. "L5_Q2").
//
// What the page is for: finding the topics (levels) students find hard. A topic is "hard" when students
// got under HARD_BELOW % of its questions right in their final result.

import {
    LEVEL_CATALOG, TOTAL_LEVELS, attemptNumber, isAssessmentKey, toMillis, fmtTime, fmtDate, safeText,
    uniqueStudents, downloadCsv, csvFileName
} from './record-analysis.js';

export const ASSESSMENT_TITLE = 'Final Assessment';
// Topic difficulty, as a share of questions answered correctly. Change the numbers here; every page follows.
export const HARD_BELOW = 50;   // under this: hard
export const EASY_FROM = 80;    // this or more: easy; in between: okay

const PAGE = 12;                // student cards shown at a time
const LEVEL_TITLE = new Map(LEVEL_CATALOG.map(l => [l.id, l.title]));
export const levelTitle = level => LEVEL_TITLE.get(level) || `Level ${level}`;

// ---------- small helpers (same rules as record-analysis.js) ----------
const num = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const amount = value => { const n = num(value); return n === null || n < 0 ? null : n; };
const isTimestamp = value => !!value && typeof value === 'object' && (typeof value.toDate === 'function' || ('seconds' in value && 'nanoseconds' in value));
const isMap = value => !!value && typeof value === 'object' && !Array.isArray(value) && !isTimestamp(value);
const yes = value => value === true || value === 1 || value === 'true';
const prettyName = value => String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
const studentKey = s => `${s.parentDocId ?? s.section ?? ''}/${s.firebaseId ?? s.id ?? s.name ?? ''}`;
const rateText = rate => rate === null ? '--' : `${Math.round(rate * 100)}%`;

// Topic difficulty from a share of questions right (0-1), or 'none' when the topic has no answers.
const topicState = rate => {
    if (rate === null || rate === undefined) return 'none';
    const p = Math.round(rate * 100);
    return p < HARD_BELOW ? 'hard' : p >= EASY_FROM ? 'easy' : 'okay';
};
const isHard = rate => topicState(rate) === 'hard';
const TOPIC_WORD = { hard: 'Hard', okay: 'Okay', easy: 'Easy', none: 'No answers' };

// ---------- reading one student ----------
// The Final Assessment is Level 20 of the game. It saves under "Final Assessment", or under a Level 20 key.
export const ASSESSMENT_LEVEL = 20;
const isLevel20Key = key => new RegExp(`^(?:level|lvl|l)${ASSESSMENT_LEVEL}$`).test(norm(key));
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function assessmentNode(student) {
    const content = student?.['Subject Content'] || student?.subjectContent;
    if (!isMap(content)) return null;
    const key = Object.keys(content).find(isAssessmentKey) || Object.keys(content).find(isLevel20Key);
    return key && isMap(content[key]) ? content[key] : null;
}

// The topic (level 1-19) a question belongs to. The assessment itself is Level 20, so a question
// saved with level 20 is looked up in the topic fields instead. Returns null when no topic is found.
const TOPIC_FIELDS = ['level', 'topic', 'topicLevel', 'topicNumber', 'levelTopic', 'sourceLevel', 'originalLevel'];
function itemLevel(key, item) {
    for (const field of TOPIC_FIELDS) {
        const saved = num(item[field]);
        if (saved !== null && Number.isInteger(saved) && saved >= 1 && saved <= TOTAL_LEVELS) return saved;
    }
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
    const itemWrong = items.reduce((s, i) => s + i.wrong, 0);
    const itemTime = items.reduce((s, i) => s + (i.time ?? 0), 0);
    const started = toMillis(attempt.startedAt), finished = toMillis(attempt.completedAt);
    const completed = yes(attempt.assessmentCompleted) || yes(attempt.completed);
    const time = amount(attempt.completionTime) || itemTime;
    const wrong = Math.max(amount(attempt.wrongAttempts) ?? 0, itemWrong);
    // The game creates empty attempt slots, and those are not attempts.
    if (!completed && !time && !wrong && !started && !finished && !items.length) return null;
    const unmatched = items.filter(i => !i.level).length;
    return { n, items, correct, total, time, wrong, completed, started, finished, when: finished || started, unmatched };
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

// The topic (level) with the lowest share of questions right. Ties go to the lower level number.
function hardestOf(levels) {
    let worst = null;
    for (const l of levels.values()) {
        if (!l.items) continue;
        const rate = l.correct / l.items;
        if (!worst || rate < worst.rate || (rate === worst.rate && l.level < worst.level)) {
            worst = { level: l.level, title: levelTitle(l.level), rate };
        }
    }
    return worst;
}
const hardCountOf = levels => [...levels.values()].filter(l => l.items && isHard(l.correct / l.items)).length;

// Status and result of one student. "Final result" is the latest finished attempt.
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
    const levels = levelBreakdown(result);
    const hardCount = hardCountOf(levels);
    const status = result ? 'completed' : attempts.length ? 'in-progress' : 'not-taken';
    return {
        attempts, result, status,
        latest: attempts[attempts.length - 1] || null,
        levels,
        hardest: hardestOf(levels),
        hardCount,
        needsHelp: hardCount > 0,
        unmatched: result?.unmatched ?? 0,
        lastActivity: Math.max(0, ...attempts.map(a => a.when))
    };
}

export const STATUS_LABEL = { 'not-taken': 'Not started yet', 'in-progress': 'Started, not finished', completed: 'Completed' };

// ---------- a group of students ----------
export function assessmentSummary(allStudents) {
    const students = uniqueStudents(allStudents).map(student => ({ student, record: assessmentRecord(student) }));
    const done = students.filter(s => s.record.result);
    const levels = Array.from({ length: TOTAL_LEVELS + 1 }, (_, level) => ({ level, items: 0, correct: 0, wrong: 0, time: 0, timed: 0, students: 0, struggling: 0, messages: new Map() }));
    for (const { record } of done) {
        for (const l of record.levels.values()) {
            const entry = levels[l.level];
            entry.students++; entry.items += l.items; entry.correct += l.correct; entry.wrong += l.wrong;
            entry.time += l.time; entry.timed += l.timed;
            if (isHard(l.correct / l.items)) entry.struggling++;
        }
        for (const item of record.result.items) {
            if (item.level) item.errors.forEach(e => levels[item.level].messages.set(e.message, (levels[item.level].messages.get(e.message) || 0) + 1));
        }
    }
    const rows = levels.slice(1).map(l => {
        const rate = l.items ? l.correct / l.items : null;
        return {
            ...l, title: levelTitle(l.level), rate, state: topicState(rate),
            avgTime: l.timed ? l.time / l.timed : null,
            topMessage: [...l.messages.entries()].sort((a, b) => b[1] - a[1])[0] || null
        };
    });
    const answered = rows.filter(l => l.items);
    const hardest = [...answered].sort((a, b) => a.rate - b.rate || a.level - b.level)[0] || null;
    const easiest = [...answered].sort((a, b) => b.rate - a.rate || a.level - b.level)[0] || null;
    return {
        students,
        total: students.length,
        duplicates: allStudents.length - students.length,
        taken: students.filter(s => s.record.attempts.length).length,
        completed: done.length,
        inProgress: students.filter(s => s.record.status === 'in-progress').length,
        notTaken: students.filter(s => s.record.status === 'not-taken').length,
        needHelp: done.filter(s => s.record.needsHelp).length,
        unmatched: done.reduce((sum, s) => sum + s.record.unmatched, 0),
        levels: rows,
        hardest: answered.length ? { level: hardest.level, title: hardest.title, rate: hardest.rate } : null,
        easiest: answered.length > 1 ? { level: easiest.level, title: easiest.title, rate: easiest.rate } : null
    };
}

// ---------- CSV ----------
const csvDuration = seconds => {
    const s = Math.round(seconds || 0);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const ASSESSMENT_CSV_HEADER = ['Student number', 'Name', 'Section', 'School year', 'Status', 'Attempts', 'Finished on',
    'Hardest topic', 'Topics to review', 'Wrong answers', 'Time (h:mm:ss)',
    ...LEVEL_CATALOG.map(l => `Level ${l.id} correct`)];
export function assessmentCsvRows(students, yearOf) {
    return uniqueStudents(students).map(s => {
        const r = assessmentRecord(s), a = r.result;
        const h = r.hardest;
        return [s.id != null ? `="${s.id}"` : '', s.name ?? '', s.section ?? s.sectionName ?? '', yearOf?.(s) ?? '', STATUS_LABEL[r.status], r.attempts.length,
            a?.finished ? fmtDate(a.finished) : '',
            h ? `Level ${h.level} · ${h.title} (${Math.round(h.rate * 100)}% right)` : '',
            a ? r.hardCount : '', a ? a.wrong : '', a ? csvDuration(a.time) : '',
            ...LEVEL_CATALOG.map(l => { const b = r.levels.get(l.id); return b ? `${b.correct} of ${b.items}` : ''; })];
    });
}
export function exportAssessmentCsv(students, yearOf, ...nameParts) {
    const rows = assessmentCsvRows(students, yearOf);
    if (rows.length) downloadCsv(csvFileName(...nameParts, 'final-assessment'), ASSESSMENT_CSV_HEADER, rows);
    return rows.length;
}

// ---------- rendering: shared pieces ----------
const statusPill = status => `<span class="as-status as-status-${status}">${STATUS_LABEL[status]}</span>`;
const diffPill = state => `<span class="as-diff as-diff-${state}">${TOPIC_WORD[state]}</span>`;
const hardestCell = h => h
    ? `<span class="as-hardest">Level ${h.level} · ${safeText(h.title)}<small>${Math.round(h.rate * 100)}% right</small></span>`
    : '<span class="da-muted">--</span>';
// Does this student find the level hard in their final result?
const findsHard = (record, level) => { const b = record.levels.get(level); return !!b && isHard(b.correct / b.items); };

const SORTS = {
    name: (a, b) => String(a.student.name ?? '').localeCompare(String(b.student.name ?? '')),
    review: (a, b) => b.record.hardCount - a.record.hardCount,
    hardest: (a, b) => (a.record.hardest?.rate ?? 2) - (b.record.hardest?.rate ?? 2)
};
const FILTERS = {
    all: () => true,
    'needs-help': s => s.record.needsHelp,
    completed: s => s.record.status === 'completed',
    'in-progress': s => s.record.status === 'in-progress',
    'not-taken': s => s.record.status === 'not-taken'
};
const CHIPS = [['all', 'All'], ['needs-help', 'Needs help'], ['completed', 'Finished'], ['in-progress', 'Started'], ['not-taken', 'Not started']];

// ---------- rendering: the page ----------
function shell(root, opts) {
    root.innerHTML = `
    <div class="da-kpis as-kpis">
        <div class="da-kpi"><span><i class="bi bi-people"></i> Students</span><strong data-k="total">0</strong><small data-k="total-note">In view</small></div>
        <div class="da-kpi da-kpi-time"><span><i class="bi bi-clipboard-check"></i> Finished</span><strong data-k="completed">0</strong><small data-k="completed-note"></small></div>
        <div class="da-kpi da-kpi-level"><span><i class="bi bi-exclamation-triangle"></i> Hardest level</span><strong data-k="hardest">--</strong><small data-k="hardest-note"></small></div>
        <div class="da-kpi"><span><i class="bi bi-life-preserver"></i> Need help</span><strong data-k="needhelp">0</strong><small data-k="needhelp-note"></small></div>
    </div>
    <div class="as-extra" data-k="extra"></div>

    <section class="as-card">
        <div class="as-card-head"><h3><i class="bi bi-grid-3x3-gap"></i> Topics</h3><p>Click a level to see how students did on it.</p></div>
        <div class="as-tiles" data-k="tiles"></div>
        <div class="as-legend">
            <span><i class="as-key as-tile-easy"></i> Easy (${EASY_FROM}%+ right)</span>
            <span><i class="as-key as-tile-okay"></i> Okay (${HARD_BELOW}–${EASY_FROM - 1}%)</span>
            <span><i class="as-key as-tile-hard"></i> Hard (under ${HARD_BELOW}%)</span>
            <span><i class="as-key as-tile-none"></i> No answers yet</span>
        </div>
        <div class="as-detail" data-k="detail" aria-live="polite"></div>
    </section>

    <section class="as-card">
        <div class="as-card-head"><h3><i class="bi bi-person-lines-fill"></i> Students</h3><p data-k="count"></p></div>
        <div class="as-chips" role="group" aria-label="Show students" data-k="chips">
            ${CHIPS.map(([value, label]) => `<button type="button" class="as-chip" data-filter="${value}" aria-pressed="${value === 'all'}">${label}</button>`).join('')}
        </div>
        <div class="as-student-tools">
            <input type="search" data-k="search" placeholder="Search name or student number" autocomplete="off" spellcheck="false" aria-label="Search students">
            <select data-k="sort" aria-label="Sort students">
                <option value="name">Name (A–Z)</option><option value="review">Most topics to review</option><option value="hardest">Hardest topic first</option>
            </select>
        </div>
        <div class="as-focus" data-k="focus" hidden><span data-k="focus-text"></span><button type="button" class="as-focus-clear" data-k="focus-clear">Clear</button></div>
        <div class="as-scards" data-k="cards"></div>
        <div class="as-more"><button type="button" class="da-btn" data-k="more" hidden>Show more</button></div>
    </section>`;

    const k = name => root.querySelector(`[data-k="${name}"]`);
    root._as = { ...(root._as || {}), filter: 'all', level: null, limit: PAGE };
    k('search').addEventListener('input', () => { root._as.limit = PAGE; drawStudents(root); });
    k('sort').addEventListener('change', () => drawStudents(root));
    k('chips').addEventListener('click', e => {
        const b = e.target.closest('[data-filter]');
        if (!b) return;
        root._as.filter = b.dataset.filter; root._as.limit = PAGE;
        k('chips').querySelectorAll('[data-filter]').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
        drawStudents(root);
    });
    k('tiles').addEventListener('click', e => {
        const b = e.target.closest('[data-level]');
        if (!b) return;
        const level = +b.dataset.level;
        root._as.level = root._as.level === level ? null : level;
        root._as.limit = PAGE;
        drawTopics(root); drawStudents(root);
    });
    k('focus-clear').addEventListener('click', () => { root._as.level = null; root._as.limit = PAGE; drawTopics(root); drawStudents(root); });
    k('more').addEventListener('click', () => { root._as.limit += PAGE; drawStudents(root); });
    k('cards').addEventListener('click', e => {
        const b = e.target.closest('[data-open]');
        const entry = b && root._as.byKey?.get(b.dataset.open);
        if (entry) openAssessmentStudent(entry.student, root._as.opts);
    });
    root.dataset.ready = '1';
}

// The 19 topic tiles and the detail panel of the selected topic.
function drawTopics(root) {
    const k = name => root.querySelector(`[data-k="${name}"]`);
    const { summary, level } = root._as;
    k('tiles').innerHTML = summary.levels.map(l => `<button type="button" class="as-tile as-tile-${l.state}${l.level === level ? ' is-selected' : ''}" data-level="${l.level}" aria-pressed="${l.level === level}" title="Level ${l.level} · ${safeText(l.title)}">
        <b>${l.level}</b><small>${l.items ? rateText(l.rate) : '–'}</small></button>`).join('');

    const detail = k('detail');
    if (!level) {
        detail.innerHTML = summary.completed
            ? '<p class="as-detail-empty"><i class="bi bi-hand-index"></i> Choose a level above to see how students did on it.</p>'
            : '<p class="as-detail-empty"><i class="bi bi-hourglass-split"></i> Topic results appear here when students finish the test.</p>';
        return;
    }
    const l = summary.levels[level - 1];
    detail.innerHTML = `
        <div class="as-detail-head">
            <div><span class="as-detail-kicker">Level ${l.level}</span><h4>${safeText(l.title)}</h4></div>
            ${diffPill(l.state)}
        </div>
        <div class="as-detail-stats">
            <div><span>Questions right</span><strong>${l.items ? rateText(l.rate) : '--'}</strong><small>${l.items ? `${l.correct} of ${l.items} answers` : 'No answers yet'}</small></div>
            <div><span>Find it hard</span><strong>${l.students ? `${l.struggling} of ${l.students}` : '--'}</strong><small>got under ${HARD_BELOW}% right</small></div>
            <div><span>Wrong answers</span><strong>${l.items ? l.wrong : '--'}</strong><small>on this level</small></div>
            <div><span>Time per question</span><strong>${l.avgTime !== null ? fmtTime(l.avgTime) : '--'}</strong><small>average</small></div>
        </div>
        <p class="as-detail-mistake">${l.topMessage
            ? `<i class="bi bi-exclamation-circle"></i> Most common mistake: <b>${safeText(l.topMessage[0])}</b> <small>(${plural(l.topMessage[1], 'time')})</small>`
            : '<i class="bi bi-check2-circle"></i> No mistake messages recorded for this level.'}</p>`;
}

// The student cards, filtered by the chips, the search, and the selected topic.
function drawStudents(root) {
    const k = name => root.querySelector(`[data-k="${name}"]`);
    const { summary, opts, filter, level, limit } = root._as;
    const term = k('search').value.trim().toLowerCase();
    const digits = term.replace(/^0+/, '');
    const match = ({ student: s, record: r }) => (FILTERS[filter] || FILTERS.all)({ student: s, record: r })
        && (!level || findsHard(r, level))
        && (!term || String(s.name ?? '').toLowerCase().includes(term) || (digits && String(s.id ?? '').replace(/^0+/, '').includes(digits)));
    const matches = summary.students.filter(match).sort((a, b) => (SORTS[k('sort').value] || SORTS.name)(a, b) || SORTS.name(a, b));
    const shown = matches.slice(0, limit);
    root._as.byKey = new Map(summary.students.map(e => [studentKey(e.student), e]));

    k('count').textContent = `Showing ${shown.length} of ${plural(matches.length, 'student')}`;
    k('focus').hidden = !level;
    if (level) k('focus-text').textContent = `Only students who find Level ${level} (${levelTitle(level)}) hard.`;

    k('cards').innerHTML = shown.length ? shown.map(({ student: s, record: r }) => {
        const hardestHtml = r.result && r.hardest
            ? `<span class="as-chip-hard">Level ${r.hardest.level} · ${safeText(r.hardest.title)} <b>${Math.round(r.hardest.rate * 100)}%</b></span>`
            : '<span class="da-muted">No result yet</span>';
        const section = opts.showSection ? ` · ${safeText(s.section ?? s.sectionName ?? '')}` : '';
        return `<button type="button" class="as-scard" data-open="${safeText(studentKey(s))}">
            <span class="as-scard-top"><strong>${safeText(s.name || 'Unknown')}</strong>${statusPill(r.status)}</span>
            <small>${safeText(s.id ?? s.firebaseId ?? '')}${section}</small>
            <span class="as-scard-foot">${hardestHtml}<span class="as-review">${r.result ? `${r.hardCount} to review` : '--'}</span></span>
        </button>`;
    }).join('') : '<p class="as-none">No students match this view.</p>';

    const more = k('more');
    more.hidden = matches.length <= shown.length;
    more.textContent = `Show ${Math.min(PAGE, matches.length - shown.length)} more`;
}

// root: an empty element. students: class-list records (with section, id, name).
// opts.showSection: show the section on each card. opts.yearOf(student): school year label for the popup.
export function renderAssessmentOverview(root, students, opts = {}) {
    if (!root) return;
    if (!root.dataset.ready) shell(root, opts);
    const summary = assessmentSummary(students);
    root._as = { ...root._as, summary, opts };
    const k = name => root.querySelector(`[data-k="${name}"]`);
    k('total').textContent = summary.total;
    k('total-note').textContent = summary.duplicates ? `${plural(summary.duplicates, 'duplicate')} counted once` : 'In view';
    k('completed').textContent = summary.completed;
    k('completed-note').textContent = `${summary.inProgress} started · ${summary.notTaken} not started`;
    k('hardest').textContent = summary.hardest ? `Level ${summary.hardest.level}` : '--';
    k('hardest-note').textContent = summary.hardest ? `${summary.hardest.title} · ${rateText(summary.hardest.rate)} right` : 'Shown once students answer';
    k('needhelp').textContent = summary.needHelp;
    k('needhelp-note').textContent = summary.completed ? `of ${summary.completed} who finished` : 'Students with a hard topic';
    k('extra').innerHTML = (summary.total && !summary.taken
        ? `<p class="da-empty"><i class="bi bi-hourglass-split"></i> No student in this view has started the ${ASSESSMENT_TITLE} yet. Results appear here live as soon as the game saves them.</p>` : '')
        + (summary.unmatched
            ? `<p class="as-warn"><i class="bi bi-exclamation-triangle"></i> ${plural(summary.unmatched, 'question')} could not be matched to a topic (Levels 1–19), so they are left out of the topic results.</p>` : '');

    drawTopics(root);
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

function levelsOf(attempt) { return levelBreakdown(attempt); }

function modal() {
    let overlay = document.getElementById('as-modal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'as-modal';
    overlay.className = 'as-modal';
    overlay.hidden = true;
    overlay.innerHTML = `<div class="as-modal-box" role="dialog" aria-modal="true" aria-labelledby="as-modal-title" tabindex="-1">
        <div class="as-modal-head"><div><span class="da-eyebrow">${ASSESSMENT_TITLE.toUpperCase()} · LEVEL ${ASSESSMENT_LEVEL}</span><h2 id="as-modal-title"></h2><p id="as-modal-sub"></p></div>
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
        const levels = levelsOf(shown);
        const hardest = hardestOf(levels);
        const hardCount = hardCountOf(levels);
        body.innerHTML = `
        <div class="as-attempts" role="group" aria-label="Attempts">${r.attempts.map(a => `<button type="button" data-attempt="${a.n}" class="${a === shown ? 'is-active' : ''}" aria-pressed="${a === shown}">Attempt ${a.n}${a === r.result ? ' · Final result' : ''}${a.completed ? '' : ' · not finished'}</button>`).join('')}</div>
        <p class="as-note">${isResult ? "This is the final result: the student's last finished attempt." : shown.completed ? 'An earlier attempt. Only the last finished attempt is the final result.' : 'This attempt was not finished, so it is not the final result.'}</p>
        <div class="as-stats">
            <div class="${hardest ? 'as-stat-hard' : ''}"><span>Hardest topic</span><strong>${hardest ? `Level ${hardest.level}` : '--'}</strong><small>${hardest ? `${safeText(hardest.title)} · ${Math.round(hardest.rate * 100)}% right` : 'No answers saved'}</small></div>
            <div><span>Topics to review</span><strong>${hardCount}</strong><small>${levels.size ? `of ${plural(levels.size, 'topic')} · under ${HARD_BELOW}% right` : 'No topics answered'}</small></div>
            <div><span>Wrong answers</span><strong>${shown.wrong}</strong><small>${shown.finished ? 'Finished ' + fmtDate(shown.finished) : shown.completed ? 'Finished' : 'Not finished'}</small></div>
            <div><span>Time</span><strong>${fmtTime(shown.time)}</strong><small>${shown.started ? 'Started ' + fmtDate(shown.started) : '&nbsp;'}</small></div>
        </div>
        <h3 class="as-h3"><i class="bi bi-grid-3x3-gap"></i> Each level</h3>
        <div class="as-level-grid">${LEVEL_CATALOG.map(l => {
            const b = levels.get(l.id);
            const state = b ? topicState(b.correct / b.items) : 'none';
            return `<div class="as-level as-level-${state}" title="Level ${l.id} · ${safeText(l.title)}${b ? ` · ${TOPIC_WORD[state]}` : ''}"><strong>${l.id}</strong><span>${b ? `${b.correct}/${b.items}` : '–'}</span></div>`;
        }).join('')}</div>
        <div class="as-legend"><span><i class="as-key as-tile-easy"></i> Easy</span><span><i class="as-key as-tile-okay"></i> Okay</span><span><i class="as-key as-tile-hard"></i> Hard</span><span><i class="as-key as-tile-none"></i> No answer saved</span></div>
        <h3 class="as-h3"><i class="bi bi-question-square"></i> Questions</h3>
        ${shown.items.length ? `<div class="da-table-wrap"><table class="da-table as-item-table"><thead><tr><th>Level</th><th>Question</th><th>Answer</th><th>Wrong tries</th><th>Time</th><th>Mistake messages</th></tr></thead><tbody>
            ${shown.items.map(i => `<tr>
                <td>${i.level ? `<strong>${i.level}</strong><small>${safeText(levelTitle(i.level))}</small>` : '<span class="da-muted">--</span>'}</td>
                <td>${safeText(i.question)}</td>
                <td>${i.correct ? '<span class="as-status as-status-completed"><i class="bi bi-check-lg"></i> Correct</span>' : '<span class="as-status as-status-wrong"><i class="bi bi-x-lg"></i> Wrong</span>'}</td>
                <td>${i.wrong}</td>
                <td>${i.time !== null ? fmtTime(i.time) : '<span class="da-muted">--</span>'}</td>
                <td>${i.errors.length ? `<ul class="as-errors">${i.errors.map(e => `<li>${safeText(e.message)}${e.at !== null ? ` <small>at ${fmtTime(e.at)}</small>` : ''}</li>`).join('')}</ul>` : '<span class="da-muted">None</span>'}</td>
            </tr>`).join('')}
        </tbody></table></div>` : '<p class="da-empty">The game saved no questions for this attempt.</p>'}
        ${r.attempts.length > 1 ? `<h3 class="as-h3"><i class="bi bi-clock-history"></i> All attempts</h3>
        <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Attempt</th><th>Status</th><th>Hardest topic</th><th>Wrong answers</th><th>Time</th><th>Date</th></tr></thead><tbody>
            ${r.attempts.map(a => { const h = hardestOf(levelsOf(a)); return `<tr><td>${a.n}${a === r.result ? ' <span class="da-pill da-pill-ok">Final result</span>' : ''}</td><td>${a.completed ? 'Finished' : 'Not finished'}</td><td>${h ? `Level ${h.level} · ${safeText(h.title)}` : '<span class="da-muted">--</span>'}</td><td>${a.wrong}</td><td>${fmtTime(a.time)}</td><td>${a.when ? fmtDate(a.when) : '--'}</td></tr>`; }).join('')}
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
    if (!groups.length) { tbody.innerHTML = '<tr><td colspan="6" class="as-none">No sections in this school year.</td></tr>'; return; }
    tbody.innerHTML = groups.map(g => {
        const s = assessmentSummary(g.students);
        return `<tr>
            <td><button type="button" class="sa-section-link as-section-link" data-section="${safeText(g.name)}">${safeText(g.name)} <i class="bi bi-arrow-right-short"></i></button></td>
            <td>${g.teachers.length ? g.teachers.map(t => `<span class="insight-pill">${safeText(t)}</span>`).join(' ') : '<span class="da-muted">No teacher assigned</span>'}</td>
            <td>${s.total}</td>
            <td>${s.completed} of ${s.total}</td>
            <td>${s.completed ? s.needHelp : '<span class="da-muted">--</span>'}</td>
            <td>${hardestCell(s.hardest)}</td>
        </tr>`;
    }).join('');
    if (!tbody.dataset.wired) {
        tbody.dataset.wired = '1';
        tbody.addEventListener('click', e => { const b = e.target.closest('.as-section-link'); if (b) onPick?.(b.dataset.section); });
    }
}
