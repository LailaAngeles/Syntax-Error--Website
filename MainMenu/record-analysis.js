// SyntaxError data analysis: reads the records the Unity game saves and turns them into
// traceable numbers. Nothing here estimates "difficulty" or labels students; every figure
// is a count, a duration or a date that can be found in the student's Firestore record.
//
// Record shape written by the game (sections/{id}/classList/{student}), see LevelCatalog.cs and
// LevelProgress.cs in the game project:
//   Subject Content > <level's path> > attempt ("FirstAttemp" ... "TwentiethAttemp", "Attempt21", ...)
//     attempt: { completionTime (s), wrongAttempts (all tasks), startedAt, completedAt, score,
//                <completed field>: true, <task>: {...} }
//     task:    { completed, wrongAttempts, timeSeconds or elapsedLevel<N>Seconds (time since the
//                level began), completedAt, lastAttempt, errors: [{ message, atSeconds }] }
//   GameProgress > completedLevels > LevelN: true       older completion marker
//   levelAccess > level<N> > { unlocked: true, unlockedAt }   written when a teacher PIN is accepted
// Read-only: this module never writes to Firestore.

import { infoButton as info, helpLink as help, setLiveNumbers } from './metric-help.js';
import { toast } from './ui-feedback.js';

export const TOTAL_LEVELS = 19;

// The game's own level list (LevelCatalog.cs): where each level saves, and its completed field.
// Levels do not share one depth: Level 8 saves directly under "Method Basics and Parameters".
const PAGE_TITLES = ['Basic Concepts', 'Methods, Arrays & Classes', 'Advanced Object-Oriented C#'];
export const LEVEL_CATALOG = [
    [1, 'Data Types', 'basic concept/Data types', 'level1Completed', 0],
    [2, 'Printing Text', 'basic concept/Printing Text', 'level2Completed', 0],
    [3, 'User Input', 'basic concept/User Input', 'level3Completed', 0],
    [4, 'Comments, Variables & Constants', 'basic concept/Comment Debugging', 'level4Completed', 0],
    [5, 'Arithmetic & Assignment', 'basic concept/Arithmetic', 'level5Completed', 0],
    [6, 'Control Flow & Logic', 'Conditionals and Loops', 'level6Completed', 0],
    [7, 'Looping Mechanisms', 'Conditionals and Loops/Loops and Logical Operator', 'level7Completed', 0],
    [8, 'Method Basics', 'Method Basics and Parameters', 'level8Completed', 1],
    [9, 'Advanced Methods', 'Advanced Method Concepts', 'level9Completed', 1],
    [10, 'Arrays & Strings', 'Arrays and String Handling', 'level10Completed', 1],
    [11, 'Multidimensional Arrays', 'Multidimensional & Jagged Arrays', 'level11Completed', 1],
    [12, 'Classes & Objects', 'Classes and Objects', 'level12Completed', 1],
    [13, 'Object Lifecycle', 'basic concept/Object Lifecycle', 'levelCompletion', 1],
    [14, 'Static Members & this', 'Static Members and this Context', 'level14Completed', 1],
    [15, 'Advanced Class Features', 'basic concept/Advanced Class Features', 'levelCompletion', 2],
    [16, 'Inheritance', 'Inheritance Mechanics', 'level16Completed', 2],
    [17, 'Polymorphism & Interfaces', 'Polymorphism and Interfaces', 'level17Completed', 2],
    [18, 'Structs, Enums & Namespaces', 'Structs Enums and Namespaces', 'level18Completed', 2],
    [19, 'Generics & Exceptions', 'Generics Collections and Exception Handling', 'level19Completed', 2]
].map(([id, title, path, field, page]) => ({ id, title, path, field, page }));
// Levels 6 and 7 can also be proven by these consoles (SyntaxErrorLevelCompletion.cs).
const CONSOLE_RULES = {
    6: ['RelationalOperatorConsole', 'NestedIfElseConsole', 'SwitchStatementConsole'],
    7: ['WhileLoop', 'ForLoop', 'DoWhileLoop', 'BreakContinue']
};

// ---------- small helpers ----------
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
    'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// FirstAttemp, SecondAttempt, ... TwentiethAttemp, Attempt21: the names the game uses.
export function attemptNumber(key) {
    const k = norm(key);
    const numbered = k.match(/^attempt(\d{1,3})$/);
    if (numbered) return +numbered[1];
    const word = k.match(/^([a-z]+?)attempt?$/);
    return word ? ORDINALS.indexOf(word[1]) + 1 : 0;
}
const num = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
// Times and counts cannot be negative; a negative saved value is treated as missing.
const amount = value => { const n = num(value); return n === null || n < 0 ? null : n; };
const isTimestamp = value => !!value && typeof value === 'object' && (typeof value.toDate === 'function' || ('seconds' in value && 'nanoseconds' in value));
const isMap = value => !!value && typeof value === 'object' && !Array.isArray(value) && !isTimestamp(value);
const yes = value => value === true || value === 1 || value === 'true';
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
const pathKey = parts => parts.map(norm).join('/');
const CATALOG_BY_PATH = new Map(LEVEL_CATALOG.map(level => [pathKey(level.path.split('/')), level]));

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
const subjectOf = student => student?.['Subject Content'] || student?.subjectContent;

// The Final Assessment saves under its own folder of Subject Content (see assessment-analysis.js).
// It mixes questions from levels 1-19, so it is kept out of every level count, time and total here.
export const isAssessmentKey = key => ['finalassessment', 'assessment'].includes(norm(key));

// Every place in Subject Content that holds attempts, at whatever depth the level saves them.
function attemptNodes(node, path = [], found = [], depth = 0) {
    if (!isMap(node) || depth > 8) return found;
    const keys = Object.keys(node).filter(k => depth > 0 || !isAssessmentKey(k));
    if (keys.some(k => attemptNumber(k) && isMap(node[k]))) found.push({ path, node });
    keys.forEach(k => { if (!attemptNumber(k)) attemptNodes(node[k], [...path, k], found, depth + 1); });
    return found;
}

// The game's rule: the level's completed field, a level<N>Completed flag, or the listed consoles.
// Tasks finished so far do not complete a level, and neither does opening it.
function attemptCompleted(attempt, level, def) {
    if (def?.field && yes(attempt[def.field])) return true;
    for (const [key, value] of Object.entries(attempt)) {
        const flag = norm(key).match(/^level(\d{1,2})completed$/);
        if (flag && yes(value) && (!level || +flag[1] === level)) return true;
    }
    return !!CONSOLE_RULES[level]?.every(name => isMap(attempt[name]) && yes(attempt[name].completed));
}

// Levels completed, with the same evidence the game's level menu trusts (LevelProgressReader).
export function levelsCompleted(student) {
    const levels = new Set();
    const content = subjectOf(student);
    for (const { path, node } of attemptNodes(content)) {
        const def = CATALOG_BY_PATH.get(pathKey(path));
        if (!def) continue;
        for (const [key, attempt] of Object.entries(node)) {
            if (attemptNumber(key) && isMap(attempt) && attemptCompleted(attempt, def.id, def)) levels.add(def.id);
        }
    }
    const older = student?.GameProgress?.completedLevels;
    if (isMap(older)) for (const [key, value] of Object.entries(older)) {
        const m = norm(key).match(/^level(\d{1,2})$/);
        if (m && yes(value) && +m[1] >= 1 && +m[1] <= TOTAL_LEVELS) levels.add(+m[1]);
    }
    const seen = new WeakSet();
    (function walk(node, depth) {
        if (!isMap(node) || depth > 12 || seen.has(node)) return;
        seen.add(node);
        for (const [key, value] of Object.entries(node)) {
            if (depth === 0 && isAssessmentKey(key)) continue;
            const k = norm(key);
            const m = k.match(/^level(\d{1,2})(?:is)?(?:completed|complete|finished)$/) || k.match(/^(?:completed|complete|finished)level(\d{1,2})$/);
            if (m && yes(value) && +m[1] >= 1 && +m[1] <= TOTAL_LEVELS) levels.add(+m[1]);
            walk(value, depth + 1);
        }
    })(content, 0);
    return levels;
}

// Levels whose teacher PIN was accepted: levelAccess.level<N>.unlocked.
export function levelsUnlocked(student) {
    const levels = new Set();
    const access = student?.levelAccess;
    if (isMap(access)) for (const [key, value] of Object.entries(access)) {
        const m = norm(key).match(/^level(\d{1,2})$/);
        if (m && isMap(value) && yes(value.unlocked)) levels.add(+m[1]);
    }
    return levels;
}

function readTask(name, task) {
    const errors = Array.isArray(task.errors)
        ? task.errors.filter(e => e && e.message).map(e => ({ message: String(e.message), at: num(e.atSeconds) }))
        : [];
    const elapsedKey = Object.keys(task).find(k => /^elapsedLevel\d+Seconds$/.test(k));
    return {
        name: prettyName(name),
        time: amount(task.timeSeconds),
        // Curriculum levels store when the task was finished, counted from the start of the level.
        doneAt: elapsedKey ? amount(task[elapsedKey]) : null,
        wrong: amount(task.wrongAttempts),
        completed: yes(task.completed),
        when: toMillis(task.completedAt) || toMillis(task.lastAttempt),
        errors
    };
}

function readAttempt(n, attempt, level, def) {
    const tasks = [];
    for (const [key, value] of Object.entries(attempt)) if (isMap(value)) tasks.push(readTask(key, value));
    const taskTime = tasks.reduce((sum, t) => sum + (t.time ?? 0), 0);
    const taskWrong = tasks.reduce((sum, t) => sum + (t.wrong ?? 0), 0);
    const total = amount(attempt.completionTime), wrong = amount(attempt.wrongAttempts);
    const started = toMillis(attempt.startedAt), finished = toMillis(attempt.completedAt);
    const completed = attemptCompleted(attempt, level, def);
    // The game creates empty attempt slots, and those are not attempts.
    // A completed marker with nothing else still counts for the level, just not as a timed attempt.
    const hasData = total > 0 || wrong > 0 || started || finished ||
        tasks.some(t => t.time > 0 || t.wrong > 0 || t.doneAt > 0 || t.completed || t.errors.length);
    if (!hasData) return null;
    return {
        n,
        // A saved total of 0 is not a real time when the tasks recorded some.
        time: total || taskTime,
        // The attempt's total covers all its tasks, so the two are never added together.
        wrong: Math.max(wrong ?? 0, taskWrong),
        completed,
        tasksDone: tasks.filter(t => t.completed).length,
        when: finished || Math.max(0, ...tasks.map(t => t.when)) || started,
        tasks
    };
}

// An attempt the student only opened has no result to compare.
const hasResult = a => a.time > 0 || a.wrong > 0 || a.completed;

// Full record of one student: topics > attempts > tasks, plus totals. A topic separates its latest
// attempt, its earlier attempts and the running total, so repeat plays can be told apart.
export function studentRecord(student) {
    // Keyed by topic so one topic saved under two spellings still counts as one topic for the student.
    const merged = new Map();
    for (const { path, node } of attemptNodes(subjectOf(student))) {
        const def = CATALOG_BY_PATH.get(pathKey(path));
        const marker = !def && Object.values(node).flatMap(a => isMap(a) ? Object.keys(a) : [])
            .map(k => norm(k).match(/^level(\d{1,2})completed$/)).find(Boolean);
        const level = def?.id ?? (marker ? +marker[1] : null);
        const attempts = [];
        for (const [key, attempt] of Object.entries(node)) {
            const n = attemptNumber(key);
            if (!n || !isMap(attempt)) continue;
            const read = readAttempt(n, attempt, level, def);
            if (read) attempts.push(read);
        }
        if (!attempts.length) continue;
        const key = def ? `level${def.id}` : pathKey(path);
        const existing = merged.get(key);
        if (existing) { existing.attempts.push(...attempts); existing.level ??= level; continue; }
        merged.set(key, {
            key, level, attempts,
            main: def ? PAGE_TITLES[def.page] : titleCase(path[0] ?? ''),
            topic: def ? def.title : prettyName(path[path.length - 1] ?? '')
        });
    }
    const topics = [...merged.values()].map(t => {
        // The same attempt saved under both spellings (FirstAttemp, FirstAttempt) counts once.
        const seen = new Set();
        const attempts = t.attempts.sort((a, b) => a.n - b.n || a.when - b.when).filter(a => {
            const id = `${a.n}|${a.time}|${a.wrong}|${a.when}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        // "Latest" is the newest attempt with a saved result. One the student only opened stays in the
        // history but would otherwise read as 0 seconds and pull the averages down.
        const latest = [...attempts].reverse().find(hasResult) || attempts[attempts.length - 1];
        const time = attempts.reduce((s, a) => s + a.time, 0);
        const wrong = attempts.reduce((s, a) => s + a.wrong, 0);
        return {
            ...t, attempts, latest, time, wrong,
            previous: { count: attempts.length - 1, time: time - latest.time, wrong: wrong - latest.wrong },
            completed: attempts.some(a => a.completed),
            when: Math.max(0, ...attempts.map(a => a.when))
        };
    });
    topics.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.topic.localeCompare(b.topic));
    const levels = levelsCompleted(student);
    const unlocked = levelsUnlocked(student);
    const played = new Set(topics.map(t => t.level).filter(Boolean));
    return {
        topics,
        levels,
        unlocked,
        played,
        // A level marker without timing data is still a game record, so the student has started.
        hasRecords: topics.length > 0 || levels.size > 0,
        time: topics.reduce((s, t) => s + t.time, 0),
        wrong: topics.reduce((s, t) => s + t.wrong, 0),
        attempts: topics.reduce((s, t) => s + t.attempts.length, 0),
        lastActivity: Math.max(0, toMillis(student?.lastSeen), ...topics.map(t => t.when)),
        online: yes(student?.isOnline)
    };
}

// Where one student stands on one level, following the game's rule: the previous level must be
// completed, then the teacher's PIN opens the level. Level 1 is always open. A saved attempt or a
// completed level proves access even on older records with no levelAccess entry.
export function levelStatus(record, level) {
    if (record.levels.has(level)) return 'completed';
    if (record.played.has(level)) return 'in-progress';
    if (level === 1 || record.unlocked.has(level)) return 'unlocked';
    return record.levels.has(level - 1) ? 'eligible' : 'locked';
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
    const access = Array.from({ length: TOTAL_LEVELS + 1 }, () => ({ locked: 0, eligible: 0, unlocked: 0, 'in-progress': 0, completed: 0 }));
    const recent = [];
    const notStarted = [];
    let started = 0, totalTime = 0, totalWrong = 0, totalLevels = 0;
    for (const student of students) {
        const r = studentRecord(student);
        r.levels.forEach(level => { levelCounts[level]++; });
        for (let level = 1; level <= TOTAL_LEVELS; level++) access[level][levelStatus(r, level)]++;
        totalLevels += r.levels.size;
        if (!r.hasRecords) { notStarted.push(student); continue; }
        started++; totalTime += r.time; totalWrong += r.wrong;
        for (const t of r.topics) {
            const entry = topics.get(t.key) || { main: t.main, topic: t.topic, level: t.level, students: 0, withErrors: 0, latestWithErrors: 0, time: 0, wrong: 0, latestTime: 0, latestWrong: 0, attempts: 0, messages: new Map() };
            entry.students++; entry.time += t.time; entry.wrong += t.wrong; entry.attempts += t.attempts.length;
            entry.latestTime += t.latest.time; entry.latestWrong += t.latest.wrong;
            if (t.latest.wrong > 0) entry.latestWithErrors++;
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
                if (a.when) recent.push({ student, topic: t.topic, level: t.level, attempt: a.n, time: a.time, wrong: a.wrong, completed: a.completed, when: a.when, hasResult: hasResult(a) });
            }
            topics.set(t.key, entry);
        }
    }
    const topicList = [...topics.values()].map(t => ({
        ...t, avgTime: t.time / t.students, avgWrong: t.wrong / t.students,
        avgLatestTime: t.latestTime / t.students, avgLatestWrong: t.latestWrong / t.students
    }));
    const taskList = [...tasks.values()].map(t => ({
        ...t, students: t.students.size, avgTime: t.timed ? t.time / t.timed : null,
        topMessage: [...t.messages.entries()].sort((a, b) => b[1] - a[1])[0] || null
    }));
    recent.sort((a, b) => b.when - a.when);
    return {
        total: students.length, duplicates: allStudents.length - students.length, started, notStarted, totalTime, totalWrong, totalLevels,
        levelCounts, access, topics: topicList, tasks: taskList, recent
    };
}

export function topBy(list, key) {
    return list.length ? [...list].sort((a, b) => b[key] - a[key] || String(a.topic).localeCompare(String(b.topic)))[0] : null;
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

// h:mm:ss, which Excel and Google Sheets read as a duration they can add up.
function csvDuration(seconds) {
    const s = Math.round(seconds);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
// ="..." keeps leading zeros of student numbers when the file is opened in Excel or Sheets.
const csvId = s => s.id != null ? `="${s.id}"` : '';
const csvIdentity = (s, yearOf) => [csvId(s), s.name ?? '', s.section ?? s.sectionName ?? '', yearOf?.(s) ?? ''];
const csvResult = attempt => attempt.completed ? 'Completed' : 'Not completed';
const STATUS_TEXT = { locked: 'Locked', eligible: 'Waiting for teacher code', unlocked: 'Unlocked, not played', 'in-progress': 'Started, not completed', completed: 'Completed' };
const levelName = level => level ? `Level ${level}` : '';

// Report 1: one row per student.
export const STUDENT_CSV_HEADER = ['Student number', 'Name', 'Section', 'School year', `Levels completed (of ${TOTAL_LEVELS})`, 'Which levels',
    'Total attempts', 'Latest attempt: level', 'Latest attempt: topic', 'Latest attempt: time (h:mm:ss)', 'Latest attempt: incorrect submissions', 'Latest attempt: result',
    'All attempts: time (h:mm:ss)', 'All attempts: incorrect submissions'];
export function studentCsvRows(students, yearOf) {
    return uniqueStudents(students).map(s => {
        const r = studentRecord(s);
        const newest = [...r.topics].sort((a, b) => b.latest.when - a.latest.when)[0];
        return [...csvIdentity(s, yearOf), r.levels.size, [...r.levels].sort((a, b) => a - b).join('; '), r.attempts,
            levelName(newest?.level), newest?.topic ?? '', newest ? csvDuration(newest.latest.time) : '', newest?.latest.wrong ?? '', newest ? csvResult(newest.latest) : '',
            r.attempts ? csvDuration(r.time) : '', r.attempts ? r.wrong : ''];
    });
}

// Report 2: one row per student per topic played.
export const TOPIC_CSV_HEADER = ['Student number', 'Name', 'Section', 'School year', 'Level', 'Topic', 'Level status', 'Total attempts',
    'Latest attempt: time (h:mm:ss)', 'Latest attempt: incorrect submissions', 'Latest attempt: result',
    'Earlier attempts: time (h:mm:ss)', 'Earlier attempts: incorrect submissions', 'All attempts: time (h:mm:ss)', 'All attempts: incorrect submissions'];
export function topicCsvRows(students, yearOf) {
    return uniqueStudents(students).flatMap(s => {
        const r = studentRecord(s);
        return r.topics.map(t => [...csvIdentity(s, yearOf), levelName(t.level), t.topic, t.level ? STATUS_TEXT[levelStatus(r, t.level)] : '', t.attempts.length,
            csvDuration(t.latest.time), t.latest.wrong, csvResult(t.latest),
            csvDuration(t.previous.time), t.previous.wrong, csvDuration(t.time), t.wrong]);
    });
}

// Report 3: one student, one row per attempt, oldest first within each level.
export const ATTEMPT_CSV_HEADER = ['Student number', 'Name', 'Section', 'School year', 'Level', 'Topic', 'Attempt number', 'Latest attempt?',
    'Time (h:mm:ss)', 'Incorrect submissions', 'Tasks completed', 'Result'];
export function attemptCsvRows(student, yearOf) {
    return studentRecord(student).topics.flatMap(t => t.attempts.map(a => [...csvIdentity(student, yearOf), levelName(t.level), t.topic, a.n, a === t.latest ? 'Yes' : 'No',
        csvDuration(a.time), a.wrong, a.tasks.length ? `${a.tasksDone} of ${a.tasks.length}` : '', csvResult(a)]));
}

// Names and sections become part of a download's file name.
export const csvFileName = (...parts) => `syntaxerror-${parts.filter(Boolean).join('-').replace(/[^\w-]+/g, '_')}.csv`;

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

// The same switch on the class and student views: the latest try, or everything recorded.
const viewSwitch = `<div class="da-view" role="group" aria-label="Which attempts to show">
    <button type="button" data-view="latest" aria-pressed="true">Latest attempt</button>
    <button type="button" data-view="all" aria-pressed="false">All attempts</button></div>`;
function syncViewSwitch(root) {
    root.querySelectorAll('[data-view]').forEach(b => {
        const on = b.dataset.view === root._view;
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('is-on', on);
    });
}
const CLASS_TEMPLATE = `
<section class="da-glance" aria-label="Summary of the numbers below"><h3><i class="bi bi-lightbulb" aria-hidden="true"></i> At a glance</h3><ul data-k="glance"></ul></section>
<div class="da-kpis">
  <div class="da-kpi"><span><i class="bi bi-people"></i> Students ${info('students')}</span><strong data-k="students">--</strong><small data-k="students-note"></small></div>
  <div class="da-kpi da-kpi-level"><span><i class="bi bi-flag"></i> Levels completed ${info('levels-avg')}</span><strong data-k="levels">--</strong><small data-k="levels-note"></small></div>
  <div class="da-kpi da-kpi-time"><span><i class="bi bi-hourglass-split"></i> Time recorded ${info('time-total')}</span><strong data-k="time">--</strong><small data-k="time-note"></small></div>
  <div class="da-kpi da-kpi-error"><span><i class="bi bi-bug"></i> Incorrect submissions ${info('wrong-total')}</span><strong data-k="wrong">--</strong><small data-k="wrong-note"></small></div>
</div>

<section class="card da-card">
  <div class="da-card-head"><div><h3><i class="bi bi-flag"></i> Level completion</h3><p>How many students have completed each of the ${TOTAL_LEVELS} game levels.</p></div>${help('level-chart')}</div>
  <div class="da-canvas da-canvas-level"><canvas data-c="levels" role="img" aria-label="Bar chart of students who completed each level"></canvas></div>
  <p class="da-summary da-summary-level" data-k="level-summary"></p>
  <div class="da-table-title"><strong>Who can play each level</strong>${info('level-access')}</div>
  <div class="da-table-wrap"><table class="da-table da-table-access"><thead><tr><th>Level</th><th>Locked</th><th>Waiting for code</th><th>Unlocked, not played</th><th>Started, not completed</th><th>Completed</th><th>Completed, of those with access</th></tr></thead><tbody data-k="access-rows"></tbody></table></div>
  <p class="da-table-note" data-k="access-note"></p>
</section>

<section class="card da-card">
  <div class="da-card-head"><div><h3><i class="bi bi-grid-3x3-gap"></i> Time spent and errors per topic</h3><p data-k="topic-note"></p></div>${viewSwitch}</div>
  <div class="da-highlights">
    <div class="da-highlight da-hl-time"><span>Most time spent ${info('hl-time')}</span><strong data-k="hl-time">--</strong><small data-k="hl-time-note"></small></div>
    <div class="da-highlight da-hl-error"><span>Most incorrect submissions ${info('hl-error')}</span><strong data-k="hl-error">--</strong><small data-k="hl-error-note"></small></div>
    <div class="da-highlight da-hl-people"><span>Most students with errors ${info('hl-people')}</span><strong data-k="hl-people">--</strong><small data-k="hl-people-note"></small></div>
  </div>
  <div class="da-charts">
    <figure class="da-chart da-chart-time"><figcaption><strong><i class="bi bi-hourglass-split"></i> Time spent per topic ${info('topic-time')}</strong><span data-k="time-caption"></span></figcaption>
      <div class="da-canvas"><canvas data-c="time" role="img" aria-label="Bar chart of average time per student for each topic"></canvas></div></figure>
    <figure class="da-chart da-chart-error"><figcaption><strong><i class="bi bi-bug"></i> Errors per topic ${info('topic-wrong')}</strong><span data-k="error-caption"></span></figcaption>
      <div class="da-canvas"><canvas data-c="errors" role="img" aria-label="Bar chart of average incorrect submissions per student for each topic"></canvas></div></figure>
  </div>
  <p class="da-empty" data-k="topic-empty" hidden><i class="bi bi-inbox"></i> No game records for this selection yet. Charts fill in after students finish levels in the mobile game.</p>
  <div class="da-table-title"><strong>Numbers per topic</strong>${info('topic-table')}</div>
  <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Level · Topic</th><th>Students who played</th><th>Latest attempt, average</th><th>All attempts, average</th><th>Students with errors</th><th>Total attempts</th></tr></thead><tbody data-k="topic-rows"></tbody></table></div>
</section>

  <section class="card da-card">
    <div class="da-card-head"><div><h3><i class="bi bi-list-check"></i> Tasks with the most incorrect submissions</h3><p>Individual coding tasks inside each level, with the error message students saw most.</p></div>${help('tasks')}</div>
    <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Task</th><th>Students</th><th>Total incorrect</th><th>Most common message</th></tr></thead><tbody data-k="task-rows"></tbody></table></div>
    <div data-more="tasks"></div>
  </section>

<div class="da-grid-2">
  <section class="card da-card">
    <div class="da-card-head"><div><h3><i class="bi bi-clock-history"></i> Recent activity</h3><p>The latest recorded attempts, newest first.</p></div>${help('recent')}</div>
    <div class="da-table-wrap"><table class="da-table"><thead><tr><th>Student</th><th>Level · Topic</th><th>Attempt</th><th>Result</th></tr></thead><tbody data-k="recent-rows"></tbody></table></div>
    <div data-more="recent"></div>
  </section>
  <section class="card da-card">
    <div class="da-card-head"><div><h3><i class="bi bi-hourglass"></i> Not started yet</h3><p>Students with no game records so far.</p></div>${help('not-started')}</div>
    <p class="da-count-line" data-k="not-started-count" hidden></p>
    <ul class="da-names" data-k="not-started"></ul>
    <div data-more="not-started"></div>
  </section>
</div>`;

// options.compact (Super Admin): keeps the headline numbers and charts in view and moves the
// per-topic table and the detailed lists behind "Show" toggles, so the page is less crowded.
export function renderClassOverview(root, students, options = {}) {
    if (!root) return;
    if (!root.dataset.ready) {
        root._view = 'latest';
        root._compact = !!options.compact;
        root._expanded = new Set();
        root.addEventListener('click', event => {
            const view = event.target.closest('[data-view]');
            const expand = event.target.closest('[data-expand]');
            if (view) root._view = view.dataset.view;
            else if (expand) {
                const key = expand.dataset.expand;
                root._expanded.has(key) ? root._expanded.delete(key) : root._expanded.add(key);
            } else return;
            renderClassOverview(root, root._students);
        });
        root.innerHTML = CLASS_TEMPLATE;
        root.dataset.ready = '1';
        if (options.compact) {
            const table = q(root, '[data-k="topic-rows"]').closest('.da-table-wrap');
            const tableToggle = Object.assign(document.createElement('details'), { className: 'da-more da-more-inline' });
            tableToggle.innerHTML = '<summary><i class="bi bi-table"></i> Show the per-topic table</summary>';
            table.before(tableToggle); tableToggle.append(table);
            const more = Object.assign(document.createElement('details'), { className: 'da-more' });
            more.innerHTML = '<summary><i class="bi bi-list-ul"></i> More details <span class="da-more-counts" data-k="more-counts"></span></summary>';
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

    // Access: levels nobody can reach yet are summed up in one line instead of 19 rows of zeros.
    const reachable = LEVEL_CATALOG.filter(l => s.access[l.id].locked < s.total);
    q(root, '[data-k="access-rows"]').innerHTML = reachable.map(l => {
        const a = s.access[l.id];
        const withAccess = a.unlocked + a['in-progress'] + a.completed;
        return `<tr><td><strong>Level ${l.id}</strong><small>${safeText(l.title)}</small></td><td>${a.locked}</td><td>${a.eligible}</td><td>${a.unlocked}</td><td>${a['in-progress']}</td><td>${a.completed}</td>
            <td>${withAccess ? `${a.completed} of ${withAccess} (${Math.round(a.completed / withAccess * 100)}%)` : '<span class="da-muted">No one yet</span>'}</td></tr>`;
    }).join('');
    const hiddenLevels = TOTAL_LEVELS - reachable.length;
    set(root, '[data-k="access-note"]', s.total && hiddenLevels ? `${plural(hiddenLevels, 'level')} not listed: still locked for every student, so they do not count against anyone.` : '');

    // Topics
    const empty = !s.topics.length;
    q(root, '[data-k="topic-empty"]').hidden = !empty;
    root.querySelectorAll('.da-chart, .da-highlights, .da-charts, .da-table-title').forEach(el => { el.hidden = empty; });
    q(root, '[data-k="topic-rows"]').closest('.da-table-wrap').hidden = empty;
    syncViewSwitch(root);
    const latestView = root._view === 'latest';
    const timeKey = latestView ? 'avgLatestTime' : 'avgTime', wrongKey = latestView ? 'avgLatestWrong' : 'avgWrong';
    const scope = latestView ? 'latest attempt' : 'all attempts';
    set(root, '[data-k="topic-note"]', latestView
        ? "Each student's most recent try at each topic, averaged across the students who played it."
        : "Every recorded attempt added up per student, then averaged. Retries increase these numbers.");
    set(root, '[data-k="time-caption"]', `Average per student, ${scope}. Longer bar = more time.`);
    set(root, '[data-k="error-caption"]', `Average incorrect submissions per student, ${scope}. Longer bar = more errors.`);
    const timeOf = t => t[timeKey], wrongOf = t => t[wrongKey], errorStudents = t => latestView ? t.latestWithErrors : t.withErrors;
    const totalTimeOf = t => latestView ? t.latestTime : t.time, totalWrongOf = t => latestView ? t.latestWrong : t.wrong;
    const mostTime = topBy(s.topics, timeKey), mostWrong = topBy(s.topics, wrongKey);
    const withErrorsList = s.topics.map(t => ({ ...t, shownWithErrors: errorStudents(t) })).filter(t => t.shownWithErrors > 0);
    const mostPeople = topBy(withErrorsList, 'shownWithErrors');
    set(root, '[data-k="hl-time"]', mostTime?.topic ?? '--');
    set(root, '[data-k="hl-time-note"]', mostTime ? `Average, ${scope}: about ${fmtTime(timeOf(mostTime))} per student` : '');
    set(root, '[data-k="hl-error"]', mostWrong && wrongOf(mostWrong) ? mostWrong.topic : 'None recorded');
    set(root, '[data-k="hl-error-note"]', mostWrong && wrongOf(mostWrong) ? `Average, ${scope}: ${aboutCount(wrongOf(mostWrong))} per student` : '');
    set(root, '[data-k="hl-people"]', mostPeople?.topic ?? 'None recorded');
    set(root, '[data-k="hl-people-note"]', mostPeople ? `${mostPeople.shownWithErrors} of ${mostPeople.students} students, ${scope}` : '');
    const unit = timeUnit(Math.max(0, ...s.topics.map(timeOf)));
    horizontalBars(q(root, '[data-c="time"]'), s.topics, t => timeOf(t) / unit.divide, c.time, t => fmtTime(timeOf(t)), t => `${fmtTime(totalTimeOf(t))} ÷ ${plural(t.students, 'student')} = about ${fmtTime(timeOf(t))} per student`, `${unit.name} per student`);
    horizontalBars(q(root, '[data-c="errors"]'), s.topics, wrongOf, c.error, t => fmtWhole(wrongOf(t)), t => `${plural(totalWrongOf(t), 'incorrect submission')} ÷ ${plural(t.students, 'student')} = ${aboutCount(wrongOf(t))} per student`, 'Incorrect submissions per student');
    q(root, '[data-k="topic-rows"]').innerHTML = empty
        ? ''
        : [...s.topics].sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.topic.localeCompare(b.topic)).map(t => `
            <tr><td><strong>${t.level ? `Level ${t.level} · ` : ''}${safeText(t.topic)}</strong><small>${safeText(t.main)}</small></td>
            <td>${t.students}</td><td>${fmtTime(t.avgLatestTime)}<small>${fmtWhole(t.avgLatestWrong)} incorrect</small></td><td>${fmtTime(t.avgTime)}<small>${fmtWhole(t.avgWrong)} incorrect · total ${t.wrong}</small></td><td>${t.withErrors} of ${t.students}</td><td>${t.attempts}</td></tr>`).join('');

    // Plain-language summary of the same figures shown below.
    const glance = !s.total ? ['No students in this selection yet.'] : [
        `${s.started} of ${s.total} students have started playing${s.notStarted.length ? `; ${s.notStarted.length} ${s.notStarted.length === 1 ? 'has' : 'have'} not started yet` : ''}.`,
        `On average, students have finished ${fmtWhole(avgLevels)} of ${TOTAL_LEVELS} levels.`,
        mostWrong && wrongOf(mostWrong) ? `Review <strong>${safeText(mostWrong.topic)}</strong> first: it has the most incorrect submissions (${scope}), ${aboutCount(wrongOf(mostWrong))} per student (${plural(mostWrong.students, 'student')} played it).` : '',
        mostTime ? `<strong>${safeText(mostTime.topic)}</strong> takes the longest (${scope}), about ${fmtTime(timeOf(mostTime))} per student.` : ''
    ].filter(Boolean);
    q(root, '[data-k="glance"]').innerHTML = glance.map(line => `<li>${line}</li>`).join('');

    setLiveNumbers(root, {
        students: `${s.total} on the class list: ${s.started} started playing, ${s.notStarted.length} not started.${s.duplicates ? ` ${plural(s.duplicates, 'repeated student number')} counted once.` : ''}`,
        'levels-avg': s.total ? `${plural(s.totalLevels, 'level')} completed ÷ ${plural(s.total, 'student')} = ${aboutCount(avgLevels)} per student.` : '',
        'time-total': s.started ? `Class total: ${fmtTime(s.totalTime)}.\n${fmtTime(s.totalTime)} ÷ ${s.started} who started = about ${fmtTime(avgTime)} per student.` : '',
        'wrong-total': s.started ? `Class total: ${s.totalWrong}.\n${s.totalWrong} ÷ ${s.started} who started = ${aboutCount(avgWrong)} per student.` : '',
        'level-chart': s.total ? `${s.total} students in this view. Level 1: ${s.levelCounts[1]} of ${s.total} (${Math.round(s.levelCounts[1] / s.total * 100)}%).` : '',
        'hl-time': mostTime ? `${mostTime.topic} (${scope}): ${fmtTime(totalTimeOf(mostTime))} ÷ ${plural(mostTime.students, 'student')} = about ${fmtTime(timeOf(mostTime))} per student.` : '',
        'hl-error': mostWrong && wrongOf(mostWrong) ? `${mostWrong.topic} (${scope}): ${plural(totalWrongOf(mostWrong), 'incorrect submission')} ÷ ${plural(mostWrong.students, 'student')} = ${aboutCount(wrongOf(mostWrong))} per student.` : '',
        'hl-people': mostPeople ? `${mostPeople.topic} (${scope}): ${mostPeople.shownWithErrors} of ${mostPeople.students} students made at least one error.` : '',
        'level-access': s.total && reachable.length ? `Level ${reachable[reachable.length - 1].id}: ${s.access[reachable[reachable.length - 1].id].eligible} waiting for a code, ${s.access[reachable[reachable.length - 1].id].locked} still locked.` : '',
        'not-started': s.total ? `${s.total} on the class list − ${s.started} with game records = ${s.notStarted.length} listed.` : ''
    });

    // Lists. The Super Admin's compact view starts short; "Show all" opens the rest.
    const compact = root._compact;
    const opened = key => !compact || root._expanded.has(key);
    const moreButton = (key, count, shown) => {
        const slot = q(root, `[data-more="${key}"]`);
        if (slot) slot.innerHTML = compact && count > shown
            ? `<button type="button" class="da-show-more" data-expand="${key}" aria-expanded="${opened(key)}">${opened(key) ? 'Show less' : `Show all (${count})`}</button>` : '';
    };

    // Tasks
    const allTasks = s.tasks.filter(t => t.wrong > 0).sort((a, b) => b.wrong - a.wrong || b.students - a.students).slice(0, 8);
    const tasks = opened('tasks') ? allTasks : allTasks.slice(0, 3);
    q(root, '[data-k="task-rows"]').innerHTML = tasks.length
        ? tasks.map(t => `<tr><td><strong>${safeText(t.task)}</strong><small>${t.level ? `Level ${t.level} · ` : ''}${safeText(t.topic)}</small></td><td>${t.students}</td><td>${t.wrong}</td>
            <td>${t.topMessage ? `${safeText(t.topMessage[0])}<small>${plural(t.topMessage[1], 'time')}</small>` : '<span class="da-muted">--</span>'}</td></tr>`).join('')
        : '<tr><td colspan="4" class="da-muted">No incorrect submissions recorded yet.</td></tr>';
    moreButton('tasks', allTasks.length, 3);

    // Activity
    const recent = s.recent.slice(0, opened('recent') ? 8 : 3);
    q(root, '[data-k="recent-rows"]').innerHTML = recent.length
        ? recent.map(r => `<tr><td><strong>${safeText(r.student.name ?? r.student.id)}</strong><small>${safeText(r.student.section ?? r.student.sectionName ?? '')}</small></td>
            <td>${r.level ? `Level ${r.level} · ` : ''}${safeText(r.topic)}</td><td>#${r.attempt}</td>
            <td>${!r.hasResult ? '<span class="da-pill">In progress</span><small>Opened, nothing saved yet</small>' : `${r.completed ? '<span class="da-pill da-pill-ok">Completed</span>' : '<span class="da-pill">Not completed</span>'}<small>This attempt: ${fmtTime(r.time)} · ${plural(r.wrong, 'incorrect submission')}</small>`}</td></tr>`).join('')
        : '<tr><td colspan="4" class="da-muted">No recorded attempts yet.</td></tr>';
    moreButton('recent', Math.min(s.recent.length, 8), 3);

    // Not started
    const names = [...s.notStarted].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
    const countLine = q(root, '[data-k="not-started-count"]');
    countLine.hidden = !compact || !s.total;
    countLine.textContent = `${names.length} of ${plural(s.total, 'student')} ${names.length === 1 ? 'has' : 'have'} not started.`;
    q(root, '[data-k="not-started"]').innerHTML = names.length
        ? (opened('not-started') ? names : []).map(st => `<li><strong>${safeText(st.name ?? st.id)}</strong><small>${safeText(st.id ?? '')}${st.section || st.sectionName ? ' · ' + safeText(st.section ?? st.sectionName) : ''}</small></li>`).join('')
        : `<li class="da-none">${s.total ? 'Every student has started playing.' : 'No students in this selection yet.'}</li>`;
    moreButton('not-started', names.length, 0);
    set(root, '[data-k="more-counts"]', `${plural(allTasks.length, 'task')} with errors · ${names.length} not started`);
    labelCells(root);
}

// ---------- one student (details popups) ----------
const SUMMARY_TEMPLATE = `
<div class="da-stat-list">
  <div><span>Levels completed ${info('col-levels')}</span><strong data-k="levels">--</strong></div>
  <div><span>Time recorded ${info('col-time')}</span><strong data-k="time">--</strong></div>
  <div><span>Incorrect submissions ${info('col-wrong')}</span><strong data-k="wrong">--</strong></div>
  <div><span>Attempts ${info('s-attempts')}</span><strong data-k="attempts">--</strong></div>
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
    q(root, '[data-k="chips"]').innerHTML = Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1)
        .map(l => `<span class="${r.levels.has(l) ? 'is-done' : ''}" title="Level ${l}: ${r.levels.has(l) ? 'completed' : 'not completed'}">${l}</span>`).join('');
}

const DETAIL_TEMPLATE = `
<section class="da-card da-plain">
  <div class="da-card-head"><div><span class="da-eyebrow">DATA ANALYSIS BY TOPIC</span><h3>Time spent and errors per topic</h3><p data-k="topic-note"></p></div>${viewSwitch}</div>
  <p class="da-empty" data-k="empty" hidden><i class="bi bi-inbox"></i> No game records for this student yet. This fills in after they finish a level in the mobile game.</p>
  <div class="da-charts da-charts-stack">
    <figure class="da-chart da-chart-time"><figcaption><strong><i class="bi bi-hourglass-split"></i> Time spent per topic ${info('s-topic-time')}</strong><span data-k="time-caption"></span></figcaption>
      <div class="da-canvas"><canvas data-c="time" role="img" aria-label="Bar chart of time spent on each topic"></canvas></div></figure>
    <figure class="da-chart da-chart-error"><figcaption><strong><i class="bi bi-bug"></i> Errors per topic ${info('s-topic-wrong')}</strong><span data-k="error-caption"></span></figcaption>
      <div class="da-canvas"><canvas data-c="errors" role="img" aria-label="Bar chart of incorrect submissions in each topic"></canvas></div></figure>
  </div>
  <div class="da-table-title" data-k="topics-title"><strong>Latest, earlier and total, per topic</strong>${info('s-topic-table')}</div>
  <div class="da-table-wrap" data-k="topics-wrap"><table class="da-table"><thead><tr><th>Level · Topic</th><th>Latest attempt</th><th>Earlier attempts</th><th>Total attempts</th><th>All attempts</th></tr></thead><tbody data-k="topic-rows"></tbody></table></div>
  <div class="da-export-row"><button type="button" class="da-btn" data-export-student><i class="bi bi-download"></i> Export this student's attempts (CSV)</button></div>
</section>
<section class="da-card da-plain" data-k="progress-card">
  <div class="da-card-head"><div><h3><i class="bi bi-graph-down-arrow"></i> Attempt progress</h3><p>How each retried level changed from one attempt to the next. A line going down means less time or fewer incorrect submissions.</p></div>${help('s-progress')}</div>
  <div class="da-progress-stats">
    <div><i class="bi bi-arrow-repeat"></i><strong data-k="retried">0</strong><span data-k="retried-label">levels retried</span></div>
    <div class="is-good"><i class="bi bi-lightning-charge"></i><strong data-k="faster">0</strong><span data-k="faster-label">faster on latest try</span></div>
    <div class="is-good"><i class="bi bi-check2-circle"></i><strong data-k="fewer">0</strong><span data-k="fewer-label">fewer incorrect submissions</span></div>
  </div>
  <p class="da-empty" data-k="progress-empty" hidden><i class="bi bi-arrow-repeat"></i> No level has been played more than once yet, so there is no change to compare.</p>
  <div class="da-charts" data-k="progress-charts">
    <figure class="da-chart da-chart-time"><figcaption><strong><i class="bi bi-hourglass-split"></i> Time per attempt</strong><span>Time on each try.</span></figcaption>
      <div class="da-canvas da-canvas-line"><canvas data-c="att-time" role="img" aria-label="Line chart of time per attempt for each retried level"></canvas></div></figure>
    <figure class="da-chart da-chart-error"><figcaption><strong><i class="bi bi-bug"></i> Incorrect submissions per attempt</strong><span>Incorrect submissions on each try.</span></figcaption>
      <div class="da-canvas da-canvas-line"><canvas data-c="att-wrong" role="img" aria-label="Line chart of incorrect submissions per attempt for each retried level"></canvas></div></figure>
  </div>
</section>
<section class="da-card da-plain" data-k="history-card">
  <div class="da-card-head"><div><h3><i class="bi bi-clock-history"></i> Attempt history</h3><p>One row per recorded attempt, oldest first. Bar = time · dots = incorrect submissions. Tap an attempt for its tasks and error messages.</p></div>${help('s-history')}</div>
  <div class="da-legend-row"><span><i class="da-key-bar"></i> Time</span><span><i class="da-key-dot"></i> 1 incorrect submission</span><span><i class="bi bi-check-circle-fill da-ok"></i> Completed</span><span><b class="da-latest-tag">Latest</b> Most recent attempt</span></div>
  <div data-k="history"></div>
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
                data: Array.from({ length: maxAttempts }, (_, i) => { const a = t.attempts.find(x => x.n === i + 1 && hasResult(x)); return a ? valueOf(a) : null; }),
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
    if (diff === 0) return `<span class="da-chg"><i class="bi bi-dash"></i> ${last} incorrect, same</span>`;
    return diff < 0
        ? `<span class="da-chg is-good"><i class="bi bi-arrow-down-right"></i> ${first} → ${last} incorrect</span>`
        : `<span class="da-chg is-worse"><i class="bi bi-arrow-up-right"></i> ${first} → ${last} incorrect</span>`;
}

function errorDots(n) {
    if (!n) return '<span class="da-dots is-zero" title="No incorrect submissions">0</span>';
    const shown = Math.min(n, 8);
    return `<span class="da-dots" title="${plural(n, 'incorrect submission')}">${'<i></i>'.repeat(shown)}${n > shown ? `<b>+${n - shown}</b>` : ''}<em>${n}</em></span>`;
}

export function renderStudentDetail(root, student, options = {}) {
    if (!root) return;
    if (!root.dataset.ready) {
        root.innerHTML = DETAIL_TEMPLATE;
        root.dataset.ready = '1';
        root._view = 'latest';
        root.addEventListener('click', event => {
            const view = event.target.closest('[data-view]');
            if (view) { root._view = view.dataset.view; renderStudentDetail(root, root._student, { yearOf: root._yearOf }); return; }
            if (!event.target.closest('[data-export-student]')) return;
            const s = root._student;
            downloadCsv(csvFileName(s.id, s.name), ATTEMPT_CSV_HEADER, attemptCsvRows(s, root._yearOf));
            toast('Student attempts exported.');
        });
    }
    root._student = student;
    root._yearOf = options.yearOf ?? root._yearOf;
    const r = studentRecord(student);
    const c = themeColors();
    const empty = !r.topics.length;
    q(root, '[data-k="empty"]').hidden = !empty;
    root.querySelectorAll('.da-charts-stack, [data-k="progress-card"], [data-k="history-card"]').forEach(el => { el.hidden = empty; });
    syncViewSwitch(root);
    root.querySelectorAll('[data-k="topics-title"], [data-k="topics-wrap"], .da-export-row').forEach(el => { el.hidden = empty; });
    const latestView = root._view === 'latest';
    set(root, '[data-k="topic-note"]', latestView
        ? "This student's most recent try at each topic. Earlier tries stay in the table and history below."
        : "Every recorded attempt added up. These totals grow each time the student replays a level.");
    set(root, '[data-k="time-caption"]', latestView ? 'Latest attempt. Longer bar = more time.' : 'All attempts added up. Longer bar = more time.');
    set(root, '[data-k="error-caption"]', latestView ? 'Latest attempt. Longer bar = more incorrect submissions.' : 'All attempts added up. Longer bar = more incorrect submissions.');
    const timeOf = t => latestView ? t.latest.time : t.time, wrongOf = t => latestView ? t.latest.wrong : t.wrong;
    const items = r.topics.map(t => ({ ...t, avgTime: timeOf(t) }));
    const unit = timeUnit(Math.max(0, ...r.topics.map(timeOf)));
    const howMany = t => latestView ? `latest attempt (#${t.latest.n})` : `over ${plural(t.attempts.length, 'attempt')}`;
    horizontalBars(q(root, '[data-c="time"]'), items, t => timeOf(t) / unit.divide, c.time, t => fmtShort(timeOf(t)), t => `${fmtTime(timeOf(t))}, ${howMany(t)}`, unit.name);
    horizontalBars(q(root, '[data-c="errors"]'), items, wrongOf, c.error, t => String(wrongOf(t)), t => `${plural(wrongOf(t), 'incorrect submission')}, ${howMany(t)}`, 'Incorrect submissions');
    q(root, '[data-k="topic-rows"]').innerHTML = r.topics.map(t => `<tr><td><strong>${t.level ? `Level ${t.level} · ` : ''}${safeText(t.topic)}</strong><small>${t.latest.completed ? 'Latest attempt completed' : 'Latest attempt not completed'}</small></td>
        <td>${fmtTime(t.latest.time)}<small>${plural(t.latest.wrong, 'incorrect')}</small></td>
        <td>${t.previous.count ? `${fmtTime(t.previous.time)}<small>${plural(t.previous.wrong, 'incorrect')} over ${plural(t.previous.count, 'attempt')}</small>` : '<span class="da-muted">None</span>'}</td>
        <td>${t.attempts.length}</td><td>${fmtTime(t.time)}<small>${plural(t.wrong, 'incorrect')}</small></td></tr>`).join('');
    labelCells(root);

    // Attempt progress: only levels played at least twice can show a change.
    r.topics.forEach((t, i) => { t.color = seriesColor(i); t.shape = SHAPES[i % SHAPES.length]; });
    const played = t => t.attempts.filter(hasResult);
    const retried = r.topics.filter(t => played(t).length >= 2);
    const firstLast = t => { const list = played(t); return [list[0], list[list.length - 1]]; };
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
        const maxAttempts = Math.max(...retried.map(t => Math.max(...played(t).map(a => a.n))));
        const attemptUnit = timeUnit(Math.max(...retried.flatMap(t => t.attempts.map(a => a.time))));
        attemptLines(q(root, '[data-c="att-time"]'), retried, a => a.time / attemptUnit.divide, maxAttempts, attemptUnit.name, v => fmtTime(v * attemptUnit.divide));
        attemptLines(q(root, '[data-c="att-wrong"]'), retried, a => a.wrong, maxAttempts, 'Incorrect submissions', v => plural(v, 'incorrect submission'));
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
        const badges = played(t).length >= 2 ? `${changeBadge(first.time, last.time, 'time')}${changeBadge(first.wrong, last.wrong, 'wrong')}` : '';
        return `
      <div class="da-history" style="--lvl:${t.color}">
        <div class="da-history-head">
          <div><strong>${t.level ? `Level ${t.level} · ` : ''}${safeText(t.topic)}</strong><span>${plural(t.attempts.length, 'attempt')}${t.completed ? ' · <i class="bi bi-check-circle-fill da-ok"></i> completed' : ''}</span></div>
          <div class="da-chgs">${badges}</div>
        </div>
        ${t.attempts.map(a => {
            const id = `${t.key}|${a.n}`;
            return `<details data-id="${safeText(id)}" ${open.has(id) ? 'open' : ''}>
              <summary title="Attempt ${a.n}: ${fmtTime(a.time)}, ${plural(a.wrong, 'incorrect submission')}">
                <span class="da-att">#${a.n}${a === t.latest && t.attempts.length > 1 ? '<b class="da-latest-tag">Latest</b>' : ''}</span>
                <span class="da-tbar"><i style="width:max(4px, calc((100% - 62px) * ${(a.time / maxTime).toFixed(3)}))"></i><b>${hasResult(a) ? fmtShort(a.time) : 'In progress'}</b></span>
                ${errorDots(a.wrong)}
                <span class="da-res">${a.completed ? '<i class="bi bi-check-circle-fill da-ok" title="Completed"></i>' : '<i class="bi bi-circle da-muted" title="Not completed"></i>'}</span>
              </summary>
              ${a.tasks.length ? `<p class="da-attempt-facts">Tasks completed: ${a.tasksDone} of ${a.tasks.length} · Incorrect submissions: ${a.wrong}</p>` : ''}
              <ul class="da-tasks">${a.tasks.map(task => `
                <li><div><strong>${safeText(task.name)}</strong><span>${task.time !== null ? fmtShort(task.time) : task.doneAt !== null ? `done at ${clock(task.doneAt)}` : '--'}</span>${task.completed ? '<i class="bi bi-check-circle-fill da-ok" title="Task completed"></i>' : '<i class="bi bi-circle da-muted" title="Task not completed"></i>'}${errorDots(task.wrong ?? 0)}</div>
                ${task.errors.length ? `<ol>${task.errors.map(e => `<li>${e.at !== null ? `<time>${clock(e.at)}</time>` : ''}${safeText(e.message)}</li>`).join('')}</ol>` : ''}</li>`).join('') || '<li class="da-muted">No task details recorded.</li>'}
              </ul></details>`;
        }).join('')}
      </div>`;
    }).join('');

    setLiveNumbers(root, {
        's-progress': retried.length ? `${plural(retried.length, 'level')} retried: ${faster} faster, ${fewer} with fewer incorrect submissions.` : 'No level has been played more than once yet.'
    });
}

// Chart colors follow the light/dark theme, so redraw visible views when it changes.
new MutationObserver(() => {
    document.querySelectorAll('[data-da-class]').forEach(root => root._students && renderClassOverview(root, root._students));
    document.querySelectorAll('[data-da-detail]').forEach(root => root._student && root.offsetParent && renderStudentDetail(root, root._student, { yearOf: root._yearOf }));
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
