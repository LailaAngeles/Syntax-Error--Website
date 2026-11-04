// Teacher Home page: greeting, live counts for the teacher's sections and quick links.
// Read-only: it listens to the same records as the dashboard and never writes to Firestore.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { classSummary } from "./record-analysis.js";
import { setLiveNumbers } from "./metric-help.js";
import { isCurrentSection, closedYearNotice, watchSchoolYears } from "./school-years.js";

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

// Same rule as the other teacher pages: the email PIN step must be completed for this session.
const VERIFIED_KEY = "syntaxerror_verified_uid";
const hasVerifiedSession = user => user && (localStorage.getItem(VERIFIED_KEY) === user.uid ||
    sessionStorage.getItem(VERIFIED_KEY) === user.uid);

const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
const stops = [];
const classListeners = new Map();
const classData = new Map();

function stopListeners() {
    stops.splice(0).forEach(stop => stop());
    classListeners.forEach(stop => stop());
    classListeners.clear();
    classData.clear();
}

function timeGreeting(hour = new Date().getHours()) {
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function showNotice(message) {
    const notice = document.getElementById("wh-notice");
    if (notice) notice.hidden = !message;
    setText("wh-notice-text", message);
}

function renderCounts() {
    const summary = classSummary([...classData.values()].flat());
    setText("wh-sections", String(classListeners.size));
    setText("wh-students", String(summary.total));
    setText("wh-started", String(summary.started));
    setText("wh-not-started", String(summary.notStarted.length));
    setLiveNumbers(document.getElementById("wh-kpis"), {
        students: `${summary.total} on your class lists: ${summary.started} started playing, ${summary.notStarted.length} not started.`,
        started: `${summary.started} of ${summary.total} students have game records.`,
        "not-started-count": `${summary.total} students − ${summary.started} started = ${summary.notStarted.length}.`
    });
}

function watchClasses(user) {
    let assigned = [];
    let hasTeacher = false;
    let sections = null;
    let years = null;

    function sync() {
        if (!hasTeacher || !sections || !years) return;
        const wanted = new Map();
        sections.forEach(d => {
            if (assigned.includes(d.data().name) && isCurrentSection(d.data(), years)) wanted.set(d.id, d.data().name);
        });
        classListeners.forEach((stop, id) => {
            if (wanted.has(id)) return;
            stop();
            classListeners.delete(id);
            classData.delete(id);
        });
        wanted.forEach((name, id) => {
            if (classListeners.has(id)) return;
            classListeners.set(id, onSnapshot(collection(db, "sections", id, "classList"), snap => {
                classData.set(id, snap.docs.map(student => ({ ...student.data(), id: student.data().id ?? student.id, section: name })));
                renderCounts();
            }, error => console.error("Class list listener error:", error)));
        });
        showNotice(closedYearNotice(years) || (wanted.size ? "" : "No section is assigned to you yet. Ask the Super Admin to assign one."));
        renderCounts();
    }

    stops.push(onSnapshot(query(collection(db, "approvedUsers"), where("email", "==", user.email)), snap => {
        hasTeacher = true;
        assigned = [];
        let name = "";
        snap.forEach(d => {
            assigned = (d.data().section || []).filter(s => s && s !== "No Section");
            name = d.data().name || d.data().fullName || "";
        });
        setText("wh-greeting", name ? `${timeGreeting()}, ${name}!` : `${timeGreeting()}!`);
        sync();
    }, error => console.error("Teacher listener error:", error)));
    stops.push(watchSchoolYears(db, list => { years = list; sync(); }));
    stops.push(onSnapshot(collection(db, "sections"), snap => { sections = snap; sync(); },
        error => console.error("Sections listener error:", error)));
}

onAuthStateChanged(auth, user => {
    stopListeners();
    if (!hasVerifiedSession(user)) {
        window.location.href = "../index.html";
        return;
    }
    watchClasses(user);
});

setText("wh-date", new Date().toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
setText("wh-greeting", `${timeGreeting()}!`);

// --- THEME ---
const themeToggle = document.getElementById("theme-toggle");
const showThemeIcon = theme => {
    const icon = themeToggle?.querySelector("i");
    if (icon) icon.className = theme === "dark" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
};
showThemeIcon(document.documentElement.getAttribute("data-theme"));
themeToggle?.addEventListener("click", () => {
    const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("dashboard-theme", theme);
    showThemeIcon(theme);
});

// --- LOGOUT ---
window.logoutUser = async () => {
    stopListeners();
    try {
        localStorage.removeItem(VERIFIED_KEY);
        sessionStorage.removeItem(VERIFIED_KEY);
        await signOut(auth);
        window.location.href = "../index.html";
    } catch (error) {
        console.error("Logout error", error);
    }
};
window.closeLogoutPopup = () => { document.getElementById("logout-popup").style.display = "none"; };
window.showLogoutPopup = () => { document.getElementById("logout-popup").style.display = "flex"; };
