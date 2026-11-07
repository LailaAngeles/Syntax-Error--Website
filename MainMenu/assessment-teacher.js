// Teacher Final Assessment page: live results for the signed-in teacher's assigned sections.
// Read-only. Same section rules as Class Overview (dashboard.js): only this school year's sections
// assigned in approvedUsers are listened to.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { renderAssessmentOverview, exportAssessmentCsv } from "./assessment-analysis.js";
import { showLoading, showLoadError, toast, withBusy } from "./ui-feedback.js";
import { isCurrentSection, closedYearNotice, watchSchoolYears, sectionYearId, yearLabel } from "./school-years.js";

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

const VERIFIED_KEY = "syntaxerror_verified_uid";
const hasVerifiedSession = user => user && (localStorage.getItem(VERIFIED_KEY) === user.uid || sessionStorage.getItem(VERIFIED_KEY) === user.uid);
const $ = id => document.getElementById(id);
const LOAD_TIMEOUT_MS = 20000;

const classListeners = new Map();
const classData = new Map();
const sectionYears = new Map();
let stopTeacher = null, stopSections = null, stopYears = null;
let sectionsKnown = false, loadTimer = null;

const selectedSection = () => $("section-select")?.value || "";
const allStudents = () => [...classData.values()].flat();
const studentsInView = () => { const s = selectedSection(); return s ? allStudents().filter(x => x.section === s) : allStudents(); };
const yearOf = student => sectionYears.get(student.section) ?? "";

function stopAll() {
    [stopTeacher, stopSections, stopYears].forEach(stop => stop?.());
    stopTeacher = stopSections = stopYears = null;
    classListeners.forEach(stop => stop());
    classListeners.clear();
    classData.clear();
}

function render() {
    const root = $("assessment-overview");
    // Nothing is drawn until every section has answered, so "0 students" is never shown by mistake.
    if (!sectionsKnown || [...classListeners.keys()].some(id => !classData.has(id))) {
        if (!root.dataset.ready && !root.querySelector(".da-loading-error")) showLoading(root, "Loading assessment results...");
        return;
    }
    clearTimeout(loadTimer);
    if (!classListeners.size) {
        delete root.dataset.ready;
        root.innerHTML = '<p class="da-empty">No section of this school year is assigned to you yet. Ask the Super Admin to assign one.</p>';
        return;
    }
    if (!root.dataset.ready) root.innerHTML = "";
    renderAssessmentOverview(root, studentsInView(), { showSection: !selectedSection(), yearOf });
}

function fail(error) {
    console.error("Final Assessment could not be loaded:", error);
    clearTimeout(loadTimer);
    const root = $("assessment-overview");
    if (root?.dataset.ready) toast("Some records could not be updated. Check your connection.", "error");
    else showLoadError(root, "Assessment results could not be loaded. Check your connection and refresh the page.");
}

function load(user) {
    stopAll();
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => fail("timed out"), LOAD_TIMEOUT_MS);
    let assigned = [], sectionsSnap = null, years = null;

    function sync() {
        if (!sectionsSnap || !years) return;
        const select = $("section-select");
        const previous = select.value;
        select.innerHTML = '<option value="">All my sections</option>';
        const wanted = new Map();
        sectionsSnap.forEach(d => {
            const name = d.data().name;
            if (!assigned.includes(name) || !isCurrentSection(d.data(), years)) return;
            wanted.set(d.id, name);
            sectionYears.set(name, years.length ? yearLabel(years, sectionYearId(d.data(), years)) : "");
            select.add(new Option(name, name));
        });
        if ([...select.options].some(o => o.value === previous)) select.value = previous;
        classListeners.forEach((stop, id) => {
            if (wanted.has(id)) return;
            stop(); classListeners.delete(id); classData.delete(id);
        });
        wanted.forEach((name, id) => {
            if (classListeners.has(id)) {
                classData.get(id)?.forEach(s => { s.section = name; });
                return;
            }
            classListeners.set(id, onSnapshot(collection(db, "sections", id, "classList"), snap => {
                classData.set(id, snap.docs.map(d => ({ ...d.data(), id: d.data().id ?? d.id, firebaseId: d.id, parentDocId: id, section: wanted.get(id) || name })));
                render();
            }, error => {
                classData.set(id, []);
                toast(`Students of ${wanted.get(id) || name} could not be loaded.`, "error");
                console.error("Assessment class listener error:", error);
                render();
            }));
        });
        sectionsKnown = true;
        const closed = closedYearNotice(years);
        if (closed) $("user-section-display").textContent = closed;
        render();
    }

    stopTeacher = onSnapshot(query(collection(db, "approvedUsers"), where("email", "==", user.email)), snap => {
        assigned = [];
        snap.forEach(d => { const s = d.data().section; assigned = (Array.isArray(s) ? s : [s]).filter(x => typeof x === "string" && x && x !== "No Section"); });
        $("user-section-display").textContent = assigned.length ? assigned.join(", ") : "no section assigned yet (ask the Super Admin)";
        sync();
    }, fail);
    stopYears = watchSchoolYears(db, list => { years = list; sync(); });
    stopSections = onSnapshot(collection(db, "sections"), snap => { sectionsSnap = snap; sync(); }, fail);
}

onAuthStateChanged(auth, user => {
    if (!hasVerifiedSession(user)) { stopAll(); location.href = "../index.html"; return; }
    load(user);
});

$("section-select").addEventListener("change", () => {
    // The Section column only shows for "All my sections", so the table is rebuilt.
    const root = $("assessment-overview");
    delete root.dataset.ready;
    root.innerHTML = "";
    render();
});

$("export-csv").addEventListener("click", event => withBusy(event.currentTarget, "Preparing...", async () => {
    const students = [...studentsInView()].sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
    const count = exportAssessmentCsv(students, yearOf, selectedSection() || "all-sections");
    count ? toast(`${count} row(s) exported.`) : toast("There is nothing to export.", "error");
}));

// Theme (same key as the other teacher pages)
{
    const html = document.documentElement;
    const button = $("theme-toggle");
    const icon = () => { const i = button?.querySelector("i"); if (i) i.className = html.dataset.theme === "dark" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill"; };
    html.dataset.theme = localStorage.getItem("dashboard-theme") || "light";
    icon();
    button?.addEventListener("click", () => {
        html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem("dashboard-theme", html.dataset.theme);
        icon();
        render(); // chart colours follow the theme
    });
}

window.showLogoutPopup = () => { $("logout-popup").style.display = "flex"; };
window.closeLogoutPopup = () => { $("logout-popup").style.display = "none"; };
window.logoutUser = async () => {
    stopAll();
    try {
        localStorage.removeItem(VERIFIED_KEY);
        sessionStorage.removeItem(VERIFIED_KEY);
        await signOut(auth);
        location.href = "../index.html";
    } catch (error) { console.error("Logout error", error); }
};
