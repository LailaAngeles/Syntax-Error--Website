// "Time Spent and Errors per Topic" for teachers: a class view (dashboard.html) and a
// single-student view (student details popup in Students.html).
// Only recorded facts are shown (time and wrong submissions); no difficulty scores.
// Game data shape: Subject Content > main topic > topic (level) > attempt (FirstAttemp...) > task
// { timeSeconds, wrongAttempts, errors: [{message}] }. Each attempt also stores completionTime.
const charts = new Map();
let classStudents = [];
let lastStudent = null;

const attemptNumber = name => ({firstattempt:1,firstattemp:1,secondattempt:2,secondattemp:2,thirdattempt:3,thirdattemp:3})[String(name).toLowerCase().replace(/[^a-z0-9]/g,'')] || 0;
const numberOrNull = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const prettyName = value => String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const isTimestamp = value => value && typeof value === 'object' && (('seconds' in value && 'nanoseconds' in value) || typeof value.toDate === 'function');
const safeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// 318 seconds -> "5 min 18 s"; short and readable for teachers.
function fmtTime(seconds) {
    if (!Number.isFinite(seconds)) return '--';
    const s = Math.round(seconds);
    if (s < 60) return `${s} s`;
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return h ? `${h} h ${m} min` : r ? `${m} min ${r} s` : `${m} min`;
}
const fmtCount = value => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '--';

// One record per topic for a student, summed over every attempt.
function topicRecords(student) {
    const content = student?.['Subject Content'] || student?.subjectContent;
    if (!content || typeof content !== 'object') return [];
    const records = [];
    for (const [main, topics] of Object.entries(content)) {
        if (!topics || typeof topics !== 'object') continue;
        for (const [topic, node] of Object.entries(topics)) {
            if (!node || typeof node !== 'object') continue;
            let time = 0, errors = 0, attempts = 0, hasData = false;
            const messages = [];
            for (const [attemptKey, attempt] of Object.entries(node)) {
                if (!attemptNumber(attemptKey) || !attempt || typeof attempt !== 'object') continue;
                attempts++;
                let taskTime = 0;
                for (const task of Object.values(attempt)) {
                    if (!task || typeof task !== 'object' || Array.isArray(task) || isTimestamp(task)) continue;
                    const wrong = numberOrNull(task.wrongAttempts), seconds = numberOrNull(task.timeSeconds);
                    if (wrong !== null && wrong >= 0) { errors += wrong; hasData = true; }
                    if (seconds !== null && seconds >= 0) { taskTime += seconds; hasData = true; }
                    if (Array.isArray(task.errors)) task.errors.forEach(e => { if (e?.message) messages.push(String(e.message)); });
                }
                const total = numberOrNull(attempt.completionTime);
                if (total !== null && total >= 0) { time += total; hasData = true; }
                else time += taskTime;
            }
            if (hasData) records.push({ key: `${main}\u0000${topic}`, main: prettyName(main), topic: prettyName(topic), time, errors, attempts, messages });
        }
    }
    return records;
}

function aggregateTopics(students) {
    const topics = new Map();
    let withData = 0;
    for (const student of students) {
        const records = topicRecords(student);
        if (records.length) withData++;
        for (const r of records) {
            const t = topics.get(r.key) || { main: r.main, topic: r.topic, students: 0, withErrors: 0, time: 0, errors: 0, messages: new Map() };
            t.students++; t.time += r.time; t.errors += r.errors;
            if (r.errors > 0) t.withErrors++;
            r.messages.forEach(m => t.messages.set(m, (t.messages.get(m) || 0) + 1));
            topics.set(r.key, t);
        }
    }
    const list = [...topics.values()].map(t => ({ ...t, avgTime: t.time / t.students, avgErrors: t.errors / t.students }));
    return { list, withData };
}

const topBy = (list, key) => list.length ? [...list].sort((a, b) => b[key] - a[key] || a.topic.localeCompare(b.topic))[0] : null;

function commonErrors(list) {
    const messages = [];
    list.forEach(t => t.messages.forEach((count, message) => messages.push({ message, count, topic: t.topic })));
    return messages.sort((a, b) => b.count - a.count || a.message.localeCompare(b.message)).slice(0, 6);
}

function renderErrorList(id, list) {
    const el = document.getElementById(id);
    if (!el) return;
    const items = commonErrors(list);
    el.innerHTML = items.length
        ? items.map(m => `<li><strong>${safeText(m.message)}</strong><small>${plural(m.count, 'time')} · ${safeText(m.topic)}</small></li>`).join('')
        : '<li class="tte-none">No error messages recorded yet.</li>';
}

// ---------- Charts ----------
function themeColors() {
    const css = getComputedStyle(document.documentElement);
    const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return { time: read('--tte-time', '#1f6fd1'), error: read('--tte-error', '#c26a00'), text: read('--text-muted', '#6b7280'), ink: read('--text-main', '#1f2937'), grid: read('--border', '#e5e7eb') };
}

// Prints each bar's value just past its end, so nobody has to read the axis.
const valueLabels = {
    id: 'tteValueLabels',
    afterDatasetsDraw(chart, args, options) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = '600 12px Inter, "Segoe UI", sans-serif';
        ctx.fillStyle = options.color;
        ctx.textBaseline = 'middle';
        chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(options.format(i), bar.x + 6, bar.y));
        ctx.restore();
    }
};

function drawBars(canvasId, items, valueOf, color, labelOf, tooltipOf, axisTitle) {
    charts.get(canvasId)?.destroy();
    charts.delete(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined' || !items.length) return;
    const colors = themeColors();
    const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
    canvas.parentElement.style.height = Math.max(170, sorted.length * 38 + 60) + 'px';
    charts.set(canvasId, new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: sorted.map(t => t.topic), datasets: [{ data: sorted.map(valueOf), backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 }] },
        plugins: [valueLabels],
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
            layout: { padding: { right: 8 } },
            plugins: {
                legend: { display: false },
                tteValueLabels: { color: colors.ink, format: i => labelOf(sorted[i]) },
                tooltip: { callbacks: { title: items => { const t = sorted[items[0].dataIndex]; return `${t.topic} (${t.main})`; }, label: item => tooltipOf(sorted[item.dataIndex]) } }
            },
            scales: {
                x: { beginAtZero: true, grace: '28%', grid: { color: colors.grid }, border: { display: false }, ticks: { color: colors.text, maxTicksLimit: 6 }, title: { display: true, text: axisTitle, color: colors.text } },
                y: { grid: { display: false }, border: { color: colors.grid }, ticks: { color: colors.ink, autoSkip: false, font: { weight: 600 } } }
            }
        }
    }));
}

// ---------- Class view (dashboard) ----------
function syncSectionOptions(students) {
    const select = document.getElementById('tte-section-select');
    if (!select) return '';
    const current = select.value;
    const names = [...new Set(students.map(s => s.section).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    select.replaceChildren(new Option('All my sections', ''), ...names.map(n => new Option(n, n)));
    select.value = names.includes(current) ? current : '';
    return select.value;
}

export function renderTopicTimeErrors(students) {
    classStudents = students;
    if (!document.getElementById('tte-section')) return;
    const section = syncSectionOptions(students);
    const scoped = section ? students.filter(s => s.section === section) : students;
    const { list, withData } = aggregateTopics(scoped);
    const colors = themeColors();

    setText('tte-coverage', `${withData} of ${plural(scoped.length, 'student')} ${section ? 'in ' + section : 'in your sections'} have game records so far.`);

    const mostTime = topBy(list, 'avgTime');
    const mostErrors = topBy(list, 'avgErrors');
    const mostStudents = topBy(list.filter(t => t.withErrors > 0), 'withErrors');
    setText('tte-time-topic', mostTime ? mostTime.topic : 'No records yet');
    setText('tte-time-note', mostTime ? `Students spent about ${fmtTime(mostTime.avgTime)} each on this topic.` : 'Appears once students finish a level.');
    setText('tte-error-topic', mostErrors ? mostErrors.topic : 'No records yet');
    setText('tte-error-note', mostErrors ? `About ${fmtCount(mostErrors.avgErrors)} wrong submissions per student.` : 'Appears once students finish a level.');
    setText('tte-students-topic', mostStudents ? mostStudents.topic : (list.length ? 'No errors recorded' : 'No records yet'));
    setText('tte-students-note', mostStudents ? `${mostStudents.withErrors} of ${mostStudents.students} students made at least one error here.` : 'Counts students with at least one wrong submission.');

    const empty = !list.length;
    document.getElementById('tte-empty').hidden = !empty;
    document.querySelectorAll('#tte-section .tte-chart').forEach(el => { el.hidden = empty; });
    drawBars('tteTimeChart', list, t => t.avgTime / 60, colors.time, t => fmtTime(t.avgTime), t => `About ${fmtTime(t.avgTime)} per student (${plural(t.students, 'student')} with records)`, 'Minutes per student');
    drawBars('tteErrorChart', list, t => t.avgErrors, colors.error, t => fmtCount(t.avgErrors), t => `About ${fmtCount(t.avgErrors)} wrong submissions per student (${t.errors} in total)`, 'Wrong submissions per student');
    setText('tte-time-summary', mostTime ? `Longest: ${mostTime.topic}, about ${fmtTime(mostTime.avgTime)} per student.` : '');
    setText('tte-error-summary', mostErrors ? (mostErrors.avgErrors > 0 ? `Most wrong submissions: ${mostErrors.topic}, about ${fmtCount(mostErrors.avgErrors)} per student.` : 'No wrong submissions recorded.') : '');

    document.getElementById('tte-breakdown').innerHTML = empty
        ? '<tr><td colspan="5" class="tte-muted">No topic records yet.</td></tr>'
        : [...list].sort((a, b) => b.avgErrors - a.avgErrors || b.avgTime - a.avgTime).map(t => `
            <tr>
                <td><strong>${safeText(t.topic)}</strong><small>${safeText(t.main)}</small></td>
                <td>${t.students}</td>
                <td>${fmtTime(t.avgTime)}</td>
                <td>${fmtCount(t.avgErrors)}</td>
                <td>${t.withErrors} of ${t.students}</td>
            </tr>`).join('');
    renderErrorList('tte-errors', list);
}

document.addEventListener('change', event => {
    if (event.target?.id === 'tte-section-select') renderTopicTimeErrors(classStudents);
});

// ---------- Single student (details popup) ----------
export function renderStudentTimeErrors(student) {
    lastStudent = student;
    if (!document.getElementById('stte-section')) return;
    const list = topicRecords(student);
    const colors = themeColors();
    const totalTime = list.reduce((n, t) => n + t.time, 0);
    const totalErrors = list.reduce((n, t) => n + t.errors, 0);

    setText('stte-total-time', list.length ? fmtTime(totalTime) : '--');
    setText('stte-total-errors', list.length ? String(totalErrors) : '--');
    setText('stte-topics', String(list.length));
    const mostTime = topBy(list, 'time');
    const mostErrors = topBy(list, 'errors');

    const empty = !list.length;
    document.getElementById('stte-empty').hidden = !empty;
    document.querySelectorAll('#stte-section .tte-chart, #stte-section .tte-lower').forEach(el => { el.hidden = empty; });
    drawBars('stteTimeChart', list, t => t.time / 60, colors.time, t => fmtTime(t.time), t => `${fmtTime(t.time)} over ${plural(t.attempts, 'attempt')}`, 'Minutes');
    drawBars('stteErrorChart', list, t => t.errors, colors.error, t => String(t.errors), t => `${plural(t.errors, 'wrong submission')} over ${plural(t.attempts, 'attempt')}`, 'Wrong submissions');
    setText('stte-time-summary', mostTime ? `Most time: ${mostTime.topic} (${fmtTime(mostTime.time)}).` : '');
    setText('stte-error-summary', mostErrors ? (mostErrors.errors > 0 ? `Most wrong submissions: ${mostErrors.topic} (${mostErrors.errors}).` : 'No wrong submissions recorded.') : '');

    document.getElementById('stte-breakdown').innerHTML = [...list].sort((a, b) => b.errors - a.errors || b.time - a.time).map(t => `
        <tr>
            <td><strong>${safeText(t.topic)}</strong><small>${safeText(t.main)}</small></td>
            <td>${fmtTime(t.time)}</td>
            <td>${t.errors}</td>
            <td>${t.attempts}</td>
        </tr>`).join('');
    renderErrorList('stte-errors', list);
}

// Chart colors come from the theme, so redraw when the theme toggle flips data-theme.
new MutationObserver(() => {
    renderTopicTimeErrors(classStudents);
    if (lastStudent && document.getElementById('stte-section')?.offsetParent) renderStudentTimeErrors(lastStudent);
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
