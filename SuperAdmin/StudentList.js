import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
    renderClassOverview, renderStudentSummary, renderStudentDetail, classSummary, studentSummary, topBy,
    downloadCsv, csvFileName, studentCsvRows, topicCsvRows, STUDENT_CSV_HEADER, TOPIC_CSV_HEADER, fmtDate, safeText, TOTAL_LEVELS, fmtWhole, aboutCount
} from "../MainMenu/record-analysis.js";
import { toast, withBusy } from "../MainMenu/ui-feedback.js";
import { STATUS_LABEL, activeYear, sectionYearId, watchSchoolYears } from "../MainMenu/school-years.js";

// ----------------------------
// CONFIG & INITIALIZATION
// ----------------------------
const firebaseConfig = {
    apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let allStudents = [];
let teachersBySection = new Map();

const toggleLoading = (show) => {
    const loader = document.getElementById("loading-overlay");
    if (loader) loader.style.display = show ? "flex" : "none";
};
const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
const selectedSection = () => document.getElementById("section-select")?.value || "";

window.showLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "flex";
};

window.closeLogoutPopup = function() {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "none";
};

window.logoutUser = async function() {
    toggleLoading(true);
    try {
        await signOut(auth);
        window.location.href = '../Components/LogIn.html';
    } catch (error) {
        console.error("Logout Error:", error);
        alert("Sign out failed. Please try again.");
    } finally {
        toggleLoading(false);
    }
};

// ----------------------------
// 1. DATA FETCHING (read-only, realtime)
// ----------------------------
let stopSectionList = null;
// School years: one year is shown at a time, so records of different years never mix.
let schoolYears = null;
let sectionSnapshot = null;
let teacherSnapshot = null;
let sectionMeta = new Map();
const yearFromLink = new URLSearchParams(location.search).get('year');
const selectedYearId = () => document.getElementById('year-select')?.value || '';
const selectedYear = () => (schoolYears || []).find(y => y.id === selectedYearId()) || null;
const activeClassListeners = new Map();
const latestClasses = new Map();
let selectedStudentKey = null;

function renderAll() {
    allStudents = [...latestClasses.values()].flat();
    const section = selectedSection();
    renderTable(section);
    renderOverview(section);
    renderSectionOverview(section);
    if (selectedStudentKey && document.getElementById('analysis-section')?.style.display !== 'none') {
        const student = allStudents.find(s => `${s.parentDocId}/${s.firebaseId}` === selectedStudentKey);
        if (student) window.viewAnalysis(student.firebaseId, student.parentDocId, { keepScroll: true });
        else closeStudentSummary();
    }
}

function fetchAllDatabaseContent() {
    toggleLoading(true);
    if (stopSectionList) stopSectionList();
    stopSectionList = onSnapshot(collection(db, 'sections'), snapshot => {
        sectionSnapshot = snapshot;
        syncSections();
    }, err => { console.error('Sections listener error', err); toggleLoading(false); });
    watchSchoolYears(db, years => { schoolYears = years; renderYearPicker(); syncSections(); });
}

function renderYearPicker() {
    const picker = document.getElementById('year-picker');
    const select = document.getElementById('year-select');
    if (!picker || !select) return;
    picker.hidden = !schoolYears.length;
    const keep = select.value || yearFromLink || activeYear(schoolYears)?.id || schoolYears[0]?.id || '';
    select.replaceChildren(...schoolYears.map(y => new Option(`${y.label} · ${STATUS_LABEL[y.status] || y.status}`, y.id)));
    if (schoolYears.some(y => y.id === keep)) select.value = keep;
}

function syncSections() {
    if (!sectionSnapshot || !schoolYears) return;
    const snapshot = sectionSnapshot;
    const yearId = selectedYearId();
    {
        const wanted = new Map();
        const select = document.getElementById('section-select');
        const current = select?.value || '';
        if (select) select.innerHTML = '<option value="">All sections</option>';
        sectionMeta = new Map();
        snapshot.forEach(d => {
            if (schoolYears.length && sectionYearId(d.data(), schoolYears) !== yearId) return;
            const name = d.data().name || d.id;
            sectionMeta.set(name, d.data());
            wanted.set(d.id, name);
            select?.add(new Option(name, name));
        });
        if (select && [...select.options].some(o => o.value === current)) select.value = current;
        for (const [id, stop] of activeClassListeners) {
            if (!wanted.has(id)) { stop(); activeClassListeners.delete(id); latestClasses.delete(id); }
        }
        for (const [id, name] of wanted) {
            if (!activeClassListeners.has(id)) {
                const unsub = onSnapshot(collection(db, 'sections', id, 'classList'), snap => {
                    latestClasses.set(id, snap.docs.map(d => ({
                        ...d.data(), id: d.data().id ?? d.id, section: wanted.get(id) || name,
                        sectionName: wanted.get(id) || name, firebaseId: d.id, parentDocId: id
                    })));
                    renderAll();
                }, err => { console.error('Student listener error', err); toggleLoading(false); });
                activeClassListeners.set(id, unsub);
            } else {
                latestClasses.get(id)?.forEach(s => { s.sectionName = name; s.section = name; });
            }
        }
        buildTeachers();
        renderYearNote();
        renderAll();
        toggleLoading(false);
    }
}

function renderYearNote() {
    const note = document.getElementById('year-note');
    const year = selectedYear();
    if (!note) return;
    note.hidden = !year || year.status === 'active';
    if (year && year.status !== 'active') {
        note.innerHTML = '<i class="bi bi-clock-history"></i>';
        note.append(year.status === 'upcoming'
            ? `School year ${year.label} has not started yet.`
            : `You are viewing School Year ${year.label} (${STATUS_LABEL[year.status]}). These records are kept as history and are not changed.`);
    }
}
window.addEventListener('pagehide', () => { stopSectionList?.(); activeClassListeners.forEach(stop => stop()); activeClassListeners.clear(); });

// Teachers per section, from approvedUsers (names when available, otherwise the email).
function listenToTeachers() {
    onSnapshot(collection(db, 'approvedUsers'), snapshot => {
        teacherSnapshot = snapshot;
        buildTeachers();
        renderAll();
    }, err => console.error('Teacher listener error', err));
}
// Active year (or no school years): the teachers' current assignment. Ended years: the teachers
// saved on each section when the year ended, or else the year's saved assignment.
function buildTeachers() {
    if (!teacherSnapshot) return;
    const year = selectedYear();
    const past = year && year.status !== 'active';
    const map = new Map();
    if (past) {
        sectionMeta.forEach((data, name) => {
            if (Array.isArray(data.teachers)) map.set(name, data.teachers.map(t => t.name || t.email).filter(Boolean));
        });
    }
    {
        teacherSnapshot.forEach(d => {
            const data = d.data();
            if (data.status && data.status !== 'approved') return;
            const label = data.name || data.email;
            const assigned = past ? (data.sectionsByYear?.[year.id] || []) : data.section;
            (Array.isArray(assigned) ? assigned : [assigned]).forEach(section => {
                if (!section || section === 'No Section') return;
                if (schoolYears?.length && !sectionMeta.has(section)) return;
                if (past && Array.isArray(sectionMeta.get(section)?.teachers)) return;
                if (!map.has(section)) map.set(section, []);
                if (!map.get(section).includes(label)) map.get(section).push(label);
            });
        });
    }
    teachersBySection = map;
}
function teacherNames(sectionName) {
    const names = teachersBySection.get(sectionName) || [];
    return names.length ? names.join(', ') : 'No teacher assigned';
}

// ----------------------------
// 2. RENDERING
// ----------------------------
function studentsInSection(section) {
    return allStudents.filter(s => !section || s.sectionName === section);
}

function renderOverview(section) {
    const students = studentsInSection(section);
    setText('insight-teacher', section ? teacherNames(section) : `${teachersBySection.size} section(s) with a teacher`);
    renderClassOverview(document.getElementById('sa-class-overview'), students, { compact: true });
}

function renderTable(section) {
    const tableBody = document.getElementById("students-table");
    const searchTerm = (document.getElementById("search-student")?.value || "").toLowerCase();
    if (!tableBody) return;

    const inSection = studentsInSection(section);
    setText("count-students", inSection.length);

    const filtered = inSection.filter(s => !searchTerm ||
        (s.name && s.name.toLowerCase().includes(searchTerm)) ||
        (s.id && String(s.id).replace(/^0+/, '').includes(searchTerm.replace(/^0+/, ''))))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    if (!filtered.length) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--sa-muted)"><div style="font-size:2rem;margin-bottom:10px"><i class="bi bi-inbox"></i></div><h4>No students found</h4><p>Try a different search or section.</p></td></tr>`;
        return;
    }
    tableBody.innerHTML = filtered.map(s => {
        const r = studentSummary(s);
        const percent = Math.round(r.levels / TOTAL_LEVELS * 100);
        return `
        <tr>
            <td><strong>${safeText(s.name || 'Unknown')}</strong><br><small style="color:var(--sa-muted)">${safeText(s.id || s.firebaseId)}</small></td>
            <td><span style="background:var(--sa-soft);border:1px solid var(--sa-line);padding:4px 10px;border-radius:20px;white-space:nowrap">${safeText(s.sectionName)}</span></td>
            <td><strong>${r.levels} of ${TOTAL_LEVELS}</strong><div style="width:100px;background:var(--sa-line);height:6px;border-radius:10px;margin-top:6px"><div style="width:${percent}%;background:#0f8a5f;height:100%;border-radius:10px"></div></div></td>
            <td>${r.lastActivity ? fmtDate(r.lastActivity) : '<span style="color:var(--sa-muted)">No activity yet</span>'}${movedNote(s)}${r.online ? '<br><small style="color:#15803d;font-weight:700">Online (reported by the game)</small>' : ''}</td>
            <td><button data-student-id="${safeText(s.firebaseId)}" data-section-id="${safeText(s.parentDocId)}" class="open-student-summary" style="background:#2563eb;color:#fff;border:none;padding:8px 14px;border-radius:6px;cursor:pointer">Details</button></td>
        </tr>`;
    }).join("");
}

// A record left behind when the student moved into a later school year.
function movedNote(s) {
    if (!s.movedTo) return '';
    const year = (schoolYears || []).find(y => y.id === s.movedTo.schoolYearId);
    return `<br><small style="color:var(--sa-muted)">Moved to ${safeText(s.movedTo.sectionName || 'a new section')}${year ? ' · S.Y. ' + safeText(year.label) : ''}</small>`;
}

function renderSectionOverview(selected) {
    const body = document.getElementById('section-overview');
    if (!body) return;
    const sections = [...new Set([...document.getElementById('section-select')?.options || []].map(o => o.value).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    setText('count-sections', sections.length);
    if (!sections.length) { body.innerHTML = '<tr><td colspan="6" style="color:var(--sa-muted)">No sections yet.</td></tr>'; return; }
    body.innerHTML = sections.map(name => {
        const students = studentsInSection(name);
        const s = classSummary(students);
        const teachers = teachersBySection.get(name) || [];
        const mostWrong = topBy(s.topics, 'avgWrong');
        return `<tr class="${name === selected ? 'is-selected' : ''}">
            <td><button type="button" class="sa-section-link" data-section="${safeText(name)}" title="Show this section's overview">${safeText(name)} <i class="bi bi-arrow-right-short"></i></button></td>
            <td>${teachers.length ? teachers.map(t => `<span class="insight-pill">${safeText(t)}</span>`).join('') : '<span class="insight-muted">No teacher assigned</span>'}</td>
            <td>${s.total}</td>
            <td>${s.started} of ${s.total}</td>
            <td>${fmtWhole(s.total ? s.totalLevels / s.total : 0)} of ${TOTAL_LEVELS}</td>
            <td>${mostWrong?.avgWrong ? `${safeText(mostWrong.topic)}<small>${aboutCount(mostWrong.avgWrong)} per student</small>` : '<span class="insight-muted">--</span>'}</td>
        </tr>`;
    }).join('');
}

// ----------------------------
// 3. STUDENT RECORD POPUP
// ----------------------------
window.viewAnalysis = function(firebaseId, parentDocId = null, options = {}) {
    const student = allStudents.find(s => String(s.firebaseId) === String(firebaseId) && (!parentDocId || s.parentDocId === parentDocId));
    if (!student) return;
    selectedStudentKey = `${student.parentDocId}/${student.firebaseId}`;
    const panel = document.getElementById('analysis-section');
    panel.style.display = 'flex';
    document.body.classList.add('summary-modal-open');
    setText('summary-modal-heading', student.name || 'Student');
    setText('summary-description', `${student.id || student.firebaseId} · ${student.sectionName || 'No section'}`);
    const fields = [['Full name', student.name], ['Student number', student.id || student.firebaseId], ['Section', student.sectionName], ['Assigned teacher', teacherNames(student.sectionName)]];
    document.getElementById('student-details-content').innerHTML = fields
        .map(([label, value]) => `<div class="summary-profile-field"><span>${label}</span><strong>${safeText(value ?? '--')}</strong></div>`).join('');
    renderStudentSummary(document.getElementById('sa-student-summary'), student);
    renderStudentDetail(document.getElementById('sa-student-detail'), student, { yearOf: () => selectedYear()?.label ?? '' });
    if (!options.keepScroll) panel.querySelector('.summary-dialog-panel')?.scrollTo?.(0, 0);
    if (!options.keepScroll) panel.focus({ preventScroll: true });
};

function closeStudentSummary() {
    const panel = document.getElementById('analysis-section');
    if (!panel || panel.style.display === 'none') return;
    panel.style.display = 'none';
    document.body.classList.remove('summary-modal-open');
    selectedStudentKey = null;
}
document.getElementById('close-analysis')?.addEventListener('click', closeStudentSummary);
document.getElementById('analysis-section')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeStudentSummary();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeStudentSummary();
});

// ----------------------------
// 4. TABS (Overview / Sections & teachers / Students)
// ----------------------------
const TAB_KEY = 'sa-students-tab';
function showTab(name) {
    ['overview', 'sections', 'students'].forEach(tab => {
        const active = tab === name;
        document.getElementById(`tab-${tab}`)?.classList.toggle('active', active);
        document.getElementById(`tab-${tab}`)?.setAttribute('aria-selected', String(active));
        const view = document.getElementById(`view-${tab}`);
        if (view) view.hidden = !active;
    });
    try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* storage unavailable: tab just isn't remembered */ }
    // Charts measure their size when shown, so redraw the overview when its tab opens.
    if (name === 'overview') renderOverview(selectedSection());
}
['overview', 'sections', 'students'].forEach(tab => document.getElementById(`tab-${tab}`)?.addEventListener('click', () => showTab(tab)));
document.querySelector('.sa-tabs')?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    const next = tabs[(tabs.indexOf(document.activeElement) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); next.click();
});
// A section name in "Sections & teachers" opens that section's overview.
document.getElementById('section-overview')?.addEventListener('click', event => {
    const link = event.target.closest('.sa-section-link');
    if (!link) return;
    const select = document.getElementById('section-select');
    select.value = link.dataset.section;
    renderAll();
    showTab('overview');
});
let savedTab = 'overview';
try { savedTab = localStorage.getItem(TAB_KEY) || 'overview'; } catch (e) { savedTab = 'overview'; }
showTab(['overview', 'sections', 'students'].includes(savedTab) ? savedTab : 'overview');

// ----------------------------
// 5. INITIALIZE & EVENTS
// ----------------------------
fetchAllDatabaseContent();
listenToTeachers();

document.getElementById("section-select")?.addEventListener("change", renderAll);
document.getElementById("year-select")?.addEventListener("change", () => {
    const section = document.getElementById("section-select");
    if (section) section.value = "";
    closeStudentSummary();
    syncSections();
});
document.getElementById("search-student")?.addEventListener("input", () => renderTable(selectedSection()));
document.getElementById('students-table')?.addEventListener('click', (event) => {
    const button = event.target.closest('.open-student-summary');
    if (button) window.viewAnalysis(button.dataset.studentId, button.dataset.sectionId);
});
function wireExport(buttonId, label, header, rowsOf) {
    const button = document.getElementById(buttonId);
    button?.addEventListener("click", () => withBusy(button, "Preparing...", async () => {
        const section = selectedSection();
        const students = [...studentsInSection(section)].map(s => ({ ...s, section: s.sectionName })).sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
        const rows = rowsOf(students, () => selectedYear()?.label ?? "");
        if (!rows.length) return toast(`There is nothing to export for ${label}.`, "error");
        downloadCsv(csvFileName(selectedYear()?.id, section || "all-sections", label), header, rows);
        toast(`${rows.length} row(s) exported.`);
    }));
}
wireExport("export-csv", "students", STUDENT_CSV_HEADER, studentCsvRows);
wireExport("export-topics-csv", "topics", TOPIC_CSV_HEADER, topicCsvRows);
