// Super Admin Final Assessment page: every section of one school year, read-only and live.
// Section, school-year and teacher rules are the same as the Student Records page (StudentList.js).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { renderAssessmentOverview, renderSectionComparison, exportAssessmentCsv } from "../MainMenu/assessment-analysis.js";
import { toast, withBusy } from "../MainMenu/ui-feedback.js";
import { STATUS_LABEL, activeYear, sectionYearId, watchSchoolYears } from "../MainMenu/school-years.js";

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
const $ = id => document.getElementById(id);

let schoolYears = null, sectionSnapshot = null, teacherSnapshot = null;
let sectionMeta = new Map(), teachersBySection = new Map();
const classListeners = new Map();
const classData = new Map();
const yearFromLink = new URLSearchParams(location.search).get("year");
const selectedSection = () => $("section-select")?.value || "";
const selectedYear = () => (schoolYears || []).find(y => y.id === ($("year-select")?.value || "")) || null;
const allStudents = () => [...classData.values()].flat();
const inSection = name => allStudents().filter(s => !name || s.section === name);
const yearOf = () => selectedYear()?.label ?? "";
const teacherNames = name => (teachersBySection.get(name) || []).join(", ") || "No teacher assigned";

function renderAll() {
    const section = selectedSection();
    $("insight-teacher").textContent = section ? teacherNames(section) : `${teachersBySection.size} section(s) with a teacher`;
    const names = [...sectionMeta.keys()].sort((a, b) => a.localeCompare(b));
    renderSectionComparison($("section-compare"), names.map(name => ({ name, teachers: teachersBySection.get(name) || [], students: inSection(name) })), pickSection);
    const root = $("assessment-overview");
    if (!root.dataset.ready) root.innerHTML = "";
    renderAssessmentOverview(root, inSection(section), { showSection: !section, yearOf });
}

function rebuildOverview() {
    const root = $("assessment-overview");
    delete root.dataset.ready;
    root.innerHTML = "";
    renderAll();
}

function pickSection(name) {
    $("section-select").value = name;
    rebuildOverview();
    $("assessment-overview").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderYearPicker() {
    const picker = $("year-picker"), select = $("year-select");
    picker.hidden = !schoolYears.length;
    const keep = select.value || yearFromLink || activeYear(schoolYears)?.id || schoolYears[0]?.id || "";
    select.replaceChildren(...schoolYears.map(y => new Option(`${y.label} · ${STATUS_LABEL[y.status] || y.status}`, y.id)));
    if (schoolYears.some(y => y.id === keep)) select.value = keep;
}

function renderYearNote() {
    const note = $("year-note"), year = selectedYear();
    note.hidden = !year || year.status === "active";
    if (year && year.status !== "active") {
        note.innerHTML = '<i class="bi bi-clock-history"></i>';
        note.append(year.status === "upcoming"
            ? `School year ${year.label} has not started yet.`
            : `You are viewing School Year ${year.label} (${STATUS_LABEL[year.status]}). These records are kept as history and are not changed.`);
    }
}

function syncSections() {
    if (!sectionSnapshot || !schoolYears) return;
    const yearId = $("year-select").value;
    const select = $("section-select");
    const current = select.value;
    select.innerHTML = '<option value="">All sections</option>';
    const wanted = new Map();
    sectionMeta = new Map();
    sectionSnapshot.forEach(d => {
        if (schoolYears.length && sectionYearId(d.data(), schoolYears) !== yearId) return;
        const name = d.data().name || d.id;
        sectionMeta.set(name, d.data());
        wanted.set(d.id, name);
        select.add(new Option(name, name));
    });
    if ([...select.options].some(o => o.value === current)) select.value = current;
    classListeners.forEach((stop, id) => {
        if (!wanted.has(id)) { stop(); classListeners.delete(id); classData.delete(id); }
    });
    wanted.forEach((name, id) => {
        if (classListeners.has(id)) { classData.get(id)?.forEach(s => { s.section = name; s.sectionName = name; }); return; }
        classListeners.set(id, onSnapshot(collection(db, "sections", id, "classList"), snap => {
            classData.set(id, snap.docs.map(d => ({ ...d.data(), id: d.data().id ?? d.id, firebaseId: d.id, parentDocId: id, section: wanted.get(id) || name, sectionName: wanted.get(id) || name })));
            renderAll();
        }, err => { console.error("Student listener error", err); toast(`Students of ${name} could not be loaded.`, "error"); }));
    });
    buildTeachers();
    renderYearNote();
    renderAll();
}

// Active year: the teachers' current assignment. Ended years: the teachers saved on each section
// when the year ended, or else the year's saved assignment (same rule as Student Records).
function buildTeachers() {
    if (!teacherSnapshot) return;
    const year = selectedYear();
    const past = year && year.status !== "active";
    const map = new Map();
    if (past) sectionMeta.forEach((data, name) => {
        if (Array.isArray(data.teachers)) map.set(name, data.teachers.map(t => t.name || t.email).filter(Boolean));
    });
    teacherSnapshot.forEach(d => {
        const data = d.data();
        if (data.status && data.status !== "approved") return;
        const label = data.name || data.email;
        const assigned = past ? (data.sectionsByYear?.[year.id] || []) : data.section;
        (Array.isArray(assigned) ? assigned : [assigned]).forEach(section => {
            if (!section || section === "No Section") return;
            if (schoolYears?.length && !sectionMeta.has(section)) return;
            if (past && Array.isArray(sectionMeta.get(section)?.teachers)) return;
            if (!map.has(section)) map.set(section, []);
            if (!map.get(section).includes(label)) map.get(section).push(label);
        });
    });
    teachersBySection = map;
}

onSnapshot(collection(db, "sections"), snap => { sectionSnapshot = snap; syncSections(); },
    err => { console.error("Sections listener error", err); $("assessment-overview").innerHTML = '<p class="da-empty">Sections could not be loaded. Check your connection and refresh the page.</p>'; });
watchSchoolYears(db, years => { schoolYears = years; renderYearPicker(); syncSections(); });
onSnapshot(collection(db, "approvedUsers"), snap => { teacherSnapshot = snap; buildTeachers(); renderAll(); }, err => console.error("Teacher listener error", err));
window.addEventListener("pagehide", () => { classListeners.forEach(stop => stop()); classListeners.clear(); });

$("section-select").addEventListener("change", rebuildOverview);
$("year-select").addEventListener("change", () => {
    $("section-select").value = "";
    delete $("assessment-overview").dataset.ready;
    syncSections();
});
$("export-csv").addEventListener("click", event => withBusy(event.currentTarget, "Preparing...", async () => {
    const section = selectedSection();
    const students = [...inSection(section)].sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
    const count = exportAssessmentCsv(students, yearOf, selectedYear()?.id, section || "all-sections");
    count ? toast(`${count} row(s) exported.`) : toast("There is nothing to export.", "error");
}));

// Theme (same key as the other Super Admin pages)
{
    const html = document.documentElement, icon = $("themeIcon");
    const setIcon = () => { icon.className = `bi ${html.getAttribute("data-theme") === "dark" ? "bi-sun" : "bi-moon"}`; };
    setIcon();
    $("themeToggle").addEventListener("click", () => {
        const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
        html.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
        setIcon();
        renderAll(); // chart colours follow the theme
    });
}

window.showLogoutPopup = () => { $("logout-popup").style.display = "flex"; };
window.closeLogoutPopup = () => { $("logout-popup").style.display = "none"; };
window.logoutUser = async () => {
    try { await signOut(auth); location.href = "../Components/LogIn.html"; }
    catch (error) { console.error("Logout Error:", error); alert("Sign out failed. Please try again."); }
};
