// Super Admin Home page: greeting, live counts for the active school year and quick links.
// Read-only: it listens to the same records as the Student Records page and never writes to Firestore.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { classSummary, toMillis } from "../MainMenu/record-analysis.js";
import { setLiveNumbers } from "../MainMenu/metric-help.js";
import { activeYear, isCurrentSection, closedYearNotice, watchSchoolYears } from "../MainMenu/school-years.js";

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

const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
const classListeners = new Map();
const classData = new Map();
let sections = null;
let years = null;

function renderStudents() {
    const summary = classSummary([...classData.values()].flat());
    setText("wh-sections", String(classListeners.size));
    setText("wh-students", String(summary.total));
    setText("wh-students-note", `${summary.started} started playing · ${summary.notStarted.length} not started`);
    setLiveNumbers(document.getElementById("wh-kpis"), {
        students: `${summary.total} on the class lists: ${summary.started} started playing, ${summary.notStarted.length} not started.`
    });
}

function sync() {
    if (!sections || !years) return;
    const active = activeYear(years);
    setText("wh-year", active?.label || (years.length ? "None active" : "Not set up"));
    setText("wh-year-note", active ? "Currently active" : "Start one on Teachers & Sections");
    const message = closedYearNotice(years);
    const notice = document.getElementById("wh-notice");
    if (notice) notice.hidden = !message;
    setText("wh-notice-text", message);

    const wanted = new Set();
    sections.forEach(d => { if (isCurrentSection(d.data(), years)) wanted.add(d.id); });
    classListeners.forEach((stop, id) => {
        if (wanted.has(id)) return;
        stop();
        classListeners.delete(id);
        classData.delete(id);
    });
    wanted.forEach(id => {
        if (classListeners.has(id)) return;
        classListeners.set(id, onSnapshot(collection(db, "sections", id, "classList"), snap => {
            classData.set(id, snap.docs.map(student => ({ ...student.data(), firebaseId: student.id })));
            renderStudents();
        }, error => console.error("Class list listener error:", error)));
    });
    renderStudents();
}

const stopYears = watchSchoolYears(db, list => { years = list; sync(); });
const stopSections = onSnapshot(collection(db, "sections"), snap => { sections = snap; sync(); },
    error => console.error("Sections listener error:", error));
const teacherNames = new Map();
const stopTeachers = onSnapshot(collection(db, "approvedUsers"), snap => {
    setText("wh-teachers", String(snap.size));
    teacherNames.clear();
    snap.forEach(d => { if (d.data().name && d.data().email) teacherNames.set(d.data().email, d.data().name); });
    renderActivity();
}, error => console.error("Teachers listener error:", error));

// Teacher activity: the latest changes, short first, with the rest one click away.
const ACTIVITY_SHORT = 5, ACTIVITY_MAX = 30;
let activity = null;
let activityOpen = false;
function activityMessage(text) {
    const li = document.createElement("li");
    li.className = "wh-activity-note";
    li.textContent = text;
    document.getElementById("wh-activity-list").replaceChildren(li);
    document.getElementById("wh-activity-more").hidden = true;
}
function renderActivity() {
    if (!activity) return;
    if (!activity.length) { setText("wh-activity-count", ""); activityMessage("No teacher changes recorded yet."); return; }
    const shown = activityOpen ? activity : activity.slice(0, ACTIVITY_SHORT);
    document.getElementById("wh-activity-list").replaceChildren(...shown.map(entry => {
        const li = document.createElement("li");
        const what = document.createElement("strong");
        what.textContent = entry.summary || entry.action || "Change";
        const who = document.createElement("small");
        const when = toMillis(entry.at);
        who.textContent = [teacherNames.get(entry.teacherEmail) || entry.teacherEmail, entry.section,
            when ? new Date(when).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "just now"].filter(Boolean).join(" · ");
        li.append(what, who);
        return li;
    }));
    setText("wh-activity-count", `Latest ${activity.length}`);
    const more = document.getElementById("wh-activity-more");
    more.hidden = activity.length <= ACTIVITY_SHORT;
    more.textContent = activityOpen ? "Show less" : `Show all (${activity.length})`;
}
document.getElementById("wh-activity-more")?.addEventListener("click", () => { activityOpen = !activityOpen; renderActivity(); });
const stopActivity = onSnapshot(query(collection(db, "teacherActivity"), orderBy("at", "desc"), limit(ACTIVITY_MAX)), snap => {
    activity = snap.docs.map(d => d.data()).sort((a, b) => toMillis(b.at) - toMillis(a.at));
    renderActivity();
}, error => {
    console.warn("Teacher activity could not be read:", error?.code || error);
    setText("wh-activity-count", "");
    activityMessage(error?.code === "permission-denied"
        ? "Not available yet. Add the rule in firestore-teacher-activity.rules to your Firestore rules."
        : "Recent changes could not be loaded. Check your connection.");
});

setText("wh-date", new Date().toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }));

// --- THEME ---
const themeIcon = document.getElementById("themeIcon");
const showThemeIcon = theme => { if (themeIcon) themeIcon.className = `bi ${theme === "dark" ? "bi-sun" : "bi-moon"}`; };
showThemeIcon(document.documentElement.getAttribute("data-theme"));
document.getElementById("themeToggle")?.addEventListener("click", () => {
    const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    showThemeIcon(theme);
});

// --- LOGOUT ---
window.showLogoutPopup = () => { document.getElementById("logout-popup").style.display = "flex"; };
window.closeLogoutPopup = () => { document.getElementById("logout-popup").style.display = "none"; };
window.logoutUser = async () => {
    stopYears?.(); stopSections(); stopTeachers(); stopActivity();
    classListeners.forEach(stop => stop());
    try {
        await signOut(auth);
        window.location.href = "../Components/LogIn.html";
    } catch (error) {
        console.error("Logout Error:", error);
        alert("Sign out failed. Please try again.");
    }
};
