import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { renderClassOverview, downloadCsv, studentCsvRows, STUDENT_CSV_HEADER } from "./record-analysis.js";
import { expireStaleCodes } from "./level-codes.js";
import { isCurrentSection, closedYearNotice, watchSchoolYears } from "./school-years.js";

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

// Same rule as the Students page: the email PIN step must be completed for this session.
const VERIFIED_KEY = "syntaxerror_verified_uid";
function hasVerifiedSession(user) {
    return user && (localStorage.getItem(VERIFIED_KEY) === user.uid ||
        sessionStorage.getItem(VERIFIED_KEY) === user.uid);
}

// Global State
let allStudentsData = [];
let mySections = [];
let unsubscribeTeacher = null;
let unsubscribeSections = null;
let unsubscribeYears = null;
const teacherClassListeners = new Map();
const teacherClassData = new Map();

function stopTeacherListeners() {
    if (unsubscribeTeacher) { unsubscribeTeacher(); unsubscribeTeacher = null; }
    if (unsubscribeSections) { unsubscribeSections(); unsubscribeSections = null; }
    if (unsubscribeYears) { unsubscribeYears(); unsubscribeYears = null; }
    teacherClassListeners.forEach(stop => stop());
    teacherClassListeners.clear();
    teacherClassData.clear();
}

function selectedSection() {
    return document.getElementById("section-select")?.value || "";
}

function studentsInView() {
    const section = selectedSection();
    return section ? allStudentsData.filter(s => s.section === section) : allStudentsData;
}

function renderLiveTeacherData() {
    allStudentsData = Array.from(teacherClassData.values()).flat();
    renderClassOverview(document.getElementById("class-overview"), studentsInView());
}

// ----------------------------
// 1. AUTH & DATA LOADING
// ----------------------------
onAuthStateChanged(auth, async (user) => {
    if (!hasVerifiedSession(user)) {
        stopTeacherListeners();
        window.location.href = "../index.html";
        return;
    }
    await loadTeacherDashboard(user);
});

// --- THEME ---
document.addEventListener("DOMContentLoaded", () => {
    const themeToggleBtn = document.getElementById("theme-toggle");
    const htmlElement = document.documentElement;

    const savedTheme = localStorage.getItem("dashboard-theme") || "light";
    htmlElement.setAttribute("data-theme", savedTheme);
    updateToggleIcon(savedTheme);

    themeToggleBtn?.addEventListener("click", () => {
        const currentTheme = htmlElement.getAttribute("data-theme");
        const newTheme = currentTheme === "light" ? "dark" : "light";
        htmlElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("dashboard-theme", newTheme);
        updateToggleIcon(newTheme);
    });

    function updateToggleIcon(theme) {
        const icon = themeToggleBtn?.querySelector("i");
        if (icon) icon.className = theme === "dark" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
    }
});

// Teachers only ever receive listeners for the sections assigned to them in approvedUsers.
async function loadTeacherDashboard(user) {
    stopTeacherListeners();
    const loader = document.getElementById("loading-overlay");
    if (loader) loader.style.display = "flex";

    let assignedSections = [];
    let sectionsSnapshot = null;
    let schoolYears = null;
    let codesCleaned = false;

    function syncTeacherSections() {
        if (!sectionsSnapshot || !schoolYears) return;
        const select = document.getElementById("section-select");
        const previousSelection = select?.value || "";
        if (select) select.innerHTML = '<option value="">All my sections</option>';
        const wanted = new Map();

        sectionsSnapshot.forEach(sDoc => {
            const name = sDoc.data().name;
            // Only this school year's sections; same-named sections of past years are history.
            if (!assignedSections.includes(name) || !isCurrentSection(sDoc.data(), schoolYears)) return;
            wanted.set(sDoc.id, name);
            if (select) select.add(new Option(name, name));
        });
        if (select && [...select.options].some(option => option.value === previousSelection)) {
            select.value = previousSelection;
        }
        teacherClassListeners.forEach((stop, id) => {
            if (!wanted.has(id)) {
                stop();
                teacherClassListeners.delete(id);
                teacherClassData.delete(id);
            }
        });
        wanted.forEach((name, id) => {
            if (teacherClassListeners.has(id)) return;
            const stop = onSnapshot(collection(db, "sections", id, "classList"), snap => {
                teacherClassData.set(id, snap.docs.map(student => ({
                    ...student.data(), id: student.data().id ?? student.id, section: wanted.get(id) || name
                })));
                renderLiveTeacherData();
            }, error => console.error("Teacher class listener error:", error));
            teacherClassListeners.set(id, stop);
        });
        // A section name change should also update its displayed students.
        teacherClassData.forEach((students, id) => {
            const name = wanted.get(id);
            if (name) students.forEach(student => { student.section = name; });
        });
        renderLiveTeacherData();
        const closed = closedYearNotice(schoolYears);
        const display = document.getElementById("user-section-display");
        if (display && closed) display.textContent = closed;
        if (loader) loader.style.display = "none";
        // Level codes whose 5 minutes ran out while no page was open: expire them so they cannot be used.
        if (!codesCleaned && wanted.size) {
            codesCleaned = true;
            expireStaleCodes(db, [...wanted.keys()], user.uid).catch(error => console.warn("Level code cleanup failed:", error));
        }
    }

    const q = query(collection(db, "approvedUsers"), where("email", "==", user.email));
    unsubscribeTeacher = onSnapshot(q, snap => {
        assignedSections = [];
        snap.forEach(d => { assignedSections = (d.data().section || []).filter(s => s && s !== "No Section"); });
        mySections = assignedSections;
        const display = document.getElementById("user-section-display");
        if (display) display.textContent = mySections.length ? mySections.join(", ") : "no section assigned yet (ask the Super Admin)";
        syncTeacherSections();
    }, error => { console.error("Teacher permission listener error:", error); if (loader) loader.style.display = "none"; });

    unsubscribeYears = watchSchoolYears(db, years => { schoolYears = years; syncTeacherSections(); });
    unsubscribeSections = onSnapshot(collection(db, "sections"), snap => {
        sectionsSnapshot = snap;
        syncTeacherSections();
    }, error => { console.error("Teacher sections listener error:", error); if (loader) loader.style.display = "none"; });
}

// ----------------------------
// 2. UI EVENTS
// ----------------------------
document.getElementById("section-select")?.addEventListener("change", renderLiveTeacherData);

document.getElementById("export-csv")?.addEventListener("click", () => {
    const section = selectedSection();
    const students = [...studentsInView()].sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`syntaxerror-${section || "all-sections"}-${stamp}.csv`, STUDENT_CSV_HEADER, studentCsvRows(students));
});

window.logoutUser = async () => {
    stopTeacherListeners();
    try {
        localStorage.removeItem(VERIFIED_KEY);
        sessionStorage.removeItem(VERIFIED_KEY);
        await signOut(auth);
        window.location.href = '../index.html';
    } catch (error) {
        console.error("Logout error", error);
    }
};

window.closeLogoutPopup = () => {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "none";
};

window.showLogoutPopup = () => {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "flex";
};
