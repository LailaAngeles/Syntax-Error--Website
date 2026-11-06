import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, collection, getDocs, getDoc, onSnapshot, query, where, writeBatch, doc, updateDoc, deleteDoc, setDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { renderStudentSummary, renderStudentDetail, studentSummary, uniqueStudents, studentCsvRows, topicCsvRows, STUDENT_CSV_HEADER, TOPIC_CSV_HEADER, downloadCsv, csvFileName, fmtTime } from "./record-analysis.js";
import { toast, withBusy } from "./ui-feedback.js";
import { logTeacherActivity } from "./activity-log.js";
import { setLiveNumbers } from "./metric-help.js";
import { isCurrentSection, closedYearNotice, watchSchoolYears, sectionYearId, yearLabel } from "./school-years.js";
import { searchStudents } from "./student-search.js";
import { createFocusMonitor } from "./focus-monitor.js";
import { checkStudentNumber, checkName, checkMiddleInitial, formatMiddleInitial, checkFullName, checkEmail, checkBirthday, checkStudentDetails, birthdayBounds, cleanSpaces, showFieldError } from "./student-rules.js";

// 1. FIREBASE CONFIG
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
function hasVerifiedSession(user) {
    return user && (localStorage.getItem(VERIFIED_KEY) === user.uid ||
        sessionStorage.getItem(VERIFIED_KEY) === user.uid);
}


// Global Variables
let allStudents = [];
let currentUserSection = []; 
let sectionDocMapping = {};
let unsubscribeStudentUser = null;
let unsubscribeStudentSections = null;
let unsubscribeStudentYears = null;
let studentSchoolYears = null;
const studentClassListeners = new Map();
const studentClassSnapshots = new Map();
// Loading state: the table waits for the first answer from every section instead of showing "no students".
let sectionsKnown = false;
let studentLoadFailed = false;
const LOAD_TIMEOUT_MS = 20000;
const stillLoading = () => !sectionsKnown || [...studentClassListeners.keys()].some(id => !studentClassSnapshots.has(id));
const sectionYears = new Map();
const yearOfStudent = student => sectionYears.get(student.section) ?? "";
function failLoading(error) {
    console.error("Student records could not be loaded:", error);
    studentLoadFailed = true;
    loadStudents(document.getElementById("section-select")?.value || "");
}

// classList document id -> the student's number, per section (they differ only for some moved records).
const studentDocNumbers = new Map();

// Game Activity Monitor: one listener per assigned section on sections/<id>/focusEvents.
const focusMonitor = createFocusMonitor({
    db,
    teacherUid: () => auth.currentUser?.uid || "",
    selectedSection: () => document.getElementById("section-select")?.value || "",
    pageLoading: () => stillLoading() && !studentLoadFailed,
    describeStudent(sectionDocId, studentDocId) {
        const number = studentDocNumbers.get(sectionDocId)?.get(studentDocId) ?? studentDocId;
        const student = allStudents.find(s => String(s.parentDocId) === String(sectionDocId) && String(s.id) === String(number));
        if (!student) return null;
        return {
            name: student.name,
            number: String(student.id ?? number),
            online: studentSummary(student).online,
            completedLevels: new Set(student.levelProgress?.completedLevelNumbers || [])
        };
    }
});

function stopStudentRealtimeListeners() {
    if (unsubscribeStudentUser) { unsubscribeStudentUser(); unsubscribeStudentUser = null; }
    if (unsubscribeStudentSections) { unsubscribeStudentSections(); unsubscribeStudentSections = null; }
    if (unsubscribeStudentYears) { unsubscribeStudentYears(); unsubscribeStudentYears = null; }
    studentClassListeners.forEach(stop => stop());
    studentClassListeners.clear();
    studentClassSnapshots.clear();
    studentDocNumbers.clear();
    focusMonitor.stop();
}

// =========== FIRESTORE-BASED 19-LEVEL GAME PROGRESS ===========
// Progress is derived from explicit level completion markers, not the
// imported/default "progress: 0" field or individual console completions.
const TOTAL_GAME_LEVELS = 19;

function getStudentLevelProgress(student) {
    const completed = new Set();
    const root = student && typeof student === "object" ? student : {};
    const subject = root["Subject Content"] || root.subjectContent;
    const visited = new WeakSet();
    const truthyCompleted = v => v === true || v === 1 || v === "true";

    function visit(node, depth = 0, levelContext = null) {
        if (!node || typeof node !== "object" || depth > 24 || visited.has(node)) return;
        visited.add(node);
        if (Array.isArray(node)) {
            node.forEach(item => visit(item, depth + 1, levelContext));
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            // Explicit fields e.g. level6Completed, Level_6_Completed,
            // completedLevel6, Level 6 Completed.
            const normalized = key.replace(/[\s_-]/g, "").toLowerCase();
            let match = normalized.match(/^level(\d{1,2})(?:is)?(?:completed|complete|finished)$/)
                     || normalized.match(/^(?:completed|complete|finished)level(\d{1,2})$/);
            if (match && truthyCompleted(value)) {
                const n = Number(match[1]);
                if (n >= 1 && n <= TOTAL_GAME_LEVELS) completed.add(n);
            }
            // Level-specific object e.g. Level7: { completed: true }.
            const levelKey = normalized.match(/^level(\d{1,2})$/);
            const nextLevel = levelKey ? Number(levelKey[1]) : levelContext;
            if (nextLevel && nextLevel >= 1 && nextLevel <= TOTAL_GAME_LEVELS &&
                /^(?:completed|iscompleted|complete|finished)$/.test(normalized) && truthyCompleted(value)) {
                completed.add(nextLevel);
            }
            if (value && typeof value === "object") visit(value, depth + 1, nextLevel);
        }
    }
    // Look through classList doc, including Subject Content and embedded maps.
    visit(root);
    const count = completed.size;
    return {
        completedLevels: count,
        totalLevels: TOTAL_GAME_LEVELS,
        completedLevelNumbers: [...completed].sort((a,b) => a-b),
        percent: Math.round(count / TOTAL_GAME_LEVELS * 100),
        hasSubjectContent: !!(subject && typeof subject === "object")
    };
}

function withFirestoreProgress(student) {
    const calculated = getStudentLevelProgress(student);
    return { ...student, progress: calculated.percent, levelProgress: calculated };
}

function renderRealtimeStudents() {
    allStudents = [...studentClassSnapshots.values()].flat().map(withFirestoreProgress);
    loadStudents(document.getElementById("section-select")?.value || "");
    focusMonitor.render();
    // Re-render the open student record from the fresh snapshot; open attempt details stay open.
    if (activeStudentDetailsId !== null && document.getElementById("student-details-modal")?.style.display !== "none") {
        const current = allStudents.find(s => String(s.id) === String(activeStudentDetailsId) &&
          (activeStudentDetailsSection === null || String(s.parentDocId) === activeStudentDetailsSection));
        if (current) window.viewStudent(current.id, { keepScroll: true });
        else window.closeStudentModal?.();
    }
}

let activeStudentDetailsId = null;
let activeStudentDetailsSection = null;

function formatBirthdayToPassword(dateStr) {
    if (!dateStr || dateStr === "No Birthday") return "";
    return String(dateStr).replace(/-/g, "");
}

// UI Helpers
const toggleLoading = (show) => {
    const loader = document.getElementById("loading-overlay");
    if(loader) loader.style.display = show ? "flex" : "none";
};


// 2. DATA INITIALIZATION
onAuthStateChanged(auth, async (user) => {
    if (!hasVerifiedSession(user)) {
        stopStudentRealtimeListeners();
        window.location.href = "../Components/LogIn.html";
        return;
    }
    setTimeout(() => { if (stillLoading()) failLoading("timed out"); }, LOAD_TIMEOUT_MS);
    await getUserData(user);
    await fetchClassList();
});

async function getUserData(user) {
    stopStudentRealtimeListeners();
    const select = document.getElementById("section-select");
    let sectionSnapshot = null;

    function syncAssignedSections() {
        if (!sectionSnapshot || !studentSchoolYears) return;
        const closed = closedYearNotice(studentSchoolYears);
        const display = document.getElementById("user-section");
        if (display) display.textContent = closed || currentUserSection.join(", ");
        const selected = select?.value || "";
        sectionDocMapping = {};
        if (select) select.innerHTML = '<option value="">-- All My Sections --</option>';
        sectionSnapshot.forEach(d => {
            const name = d.data().name;
            // Only this school year's sections; same-named sections of past years are history.
            if (!isCurrentSection(d.data(), studentSchoolYears)) return;
            sectionDocMapping[name] = d.id;
            sectionYears.set(name, studentSchoolYears.length ? yearLabel(studentSchoolYears, sectionYearId(d.data(), studentSchoolYears)) : "");
            if (currentUserSection.includes(name) && select) {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            }
        });
        if (select && [...select.options].some(opt => opt.value === selected)) select.value = selected;
        sectionsKnown = true;
        fetchClassList();
    }

    const q = query(collection(db, "approvedUsers"), where("email", "==", user.email));
    unsubscribeStudentUser = onSnapshot(q, snap => {
        currentUserSection = [];
        snap.forEach(d => { currentUserSection = d.data().section || []; });
        const display = document.getElementById("user-section");
        if (display) display.textContent = currentUserSection.join(", ");
        syncAssignedSections();
    }, failLoading);

    unsubscribeStudentYears = watchSchoolYears(db, years => { studentSchoolYears = years; syncAssignedSections(); });
    unsubscribeStudentSections = onSnapshot(collection(db, "sections"), snap => {
        sectionSnapshot = snap;
        syncAssignedSections();
    }, failLoading);
}

async function fetchClassList() {
    const wanted = new Map();
    for (const sectionName of currentUserSection) {
        const id = sectionDocMapping[sectionName];
        if (id) wanted.set(id, sectionName);
    }
    studentClassListeners.forEach((stop, id) => {
        if (!wanted.has(id)) {
            stop();
            studentClassListeners.delete(id);
            studentClassSnapshots.delete(id);
        }
    });
    wanted.forEach((sectionName, docId) => {
        if (studentClassListeners.has(docId)) return;
        const stop = onSnapshot(collection(db, "sections", docId, "classList"), snap => {
            studentClassSnapshots.set(docId, snap.docs.map(sDoc => ({
                ...sDoc.data(), section: wanted.get(docId) || sectionName, parentDocId: docId
            })));
            studentDocNumbers.set(docId, new Map(snap.docs.map(sDoc => [sDoc.id, String(sDoc.data().id ?? sDoc.id)])));
            renderRealtimeStudents();
        }, error => { studentClassSnapshots.set(docId, []); toast(`Students of ${sectionName} could not be loaded.`, "error"); failLoading(error); });
        studentClassListeners.set(docId, stop);
    });
    studentClassSnapshots.forEach((students, id) => {
        const name = wanted.get(id);
        if (name) students.forEach(student => { student.section = name; });
    });
    focusMonitor.sync(wanted);
    renderRealtimeStudents();
}

// 3. TABLE LOADING & STAT UPDATES
function loadStudents(section) {
    const table = document.getElementById("students-table");
    const searchTerm = document.getElementById("search-student")?.value || "";
    const filterBy = document.getElementById("student-filter")?.value || "all";
    const sort = document.getElementById("student-sort")?.value || "name";
    const displayText = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

    if (stillLoading() && !studentLoadFailed) {
        if (table) table.innerHTML = `<tr><td colspan="5" class="no-students"><span class="da-loading" role="status"><span class="da-spinner" aria-hidden="true"></span> Loading student records...</span></td></tr>`;
        return;
    }
    if (studentLoadFailed && !allStudents.length) {
        if (table) table.innerHTML = `<tr><td colspan="5" class="no-students"><span class="da-loading da-loading-error" role="alert"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> Student records could not be loaded. Check your connection and refresh the page.</span></td></tr>`;
        return;
    }
    // Counts follow the section only, not the search box or the table filter.
    const inSection = uniqueStudents(allStudents.filter(s => section === "" || s.section === section))
        .map(s => ({ student: s, summary: studentSummary(s) }));
    setText("card-total-students", inSection.length);
    setText("online-count", inSection.filter(r => r.summary.online).length);
    setText("started-count", inSection.filter(r => r.summary.hasRecords).length);
    const startedCount = inSection.filter(r => r.summary.hasRecords).length;
    setText("not-started-count", inSection.length - startedCount);
    setLiveNumbers(document.querySelector(".students-kpis"), {
        started: `${startedCount} of ${inSection.length} students have game records.`,
        "not-started-count": `${inSection.length} students − ${startedCount} started = ${inSection.length - startedCount}.`
    });

    // Student numbers are matched with leading zeros ignored (0200252 finds 200252); see student-search.js.
    const rows = searchStudents(inSection, searchTerm, r => r.student).filter(({ summary }) => {
        const matchesFilter = filterBy === "all" ||
            (filterBy === "started" && summary.hasRecords) ||
            (filterBy === "notstarted" && !summary.hasRecords) ||
            (filterBy === "online" && summary.online);
        return matchesFilter;
    });
    const byName = (a, b) => String(a.student.name || "").localeCompare(String(b.student.name || ""));
    const sorters = {
        "levels-desc": (a, b) => b.summary.levels - a.summary.levels || byName(a, b),
        "levels-asc": (a, b) => a.summary.levels - b.summary.levels || byName(a, b),
        "wrong-desc": (a, b) => b.summary.wrong - a.summary.wrong || byName(a, b),
        "time-desc": (a, b) => b.summary.time - a.summary.time || byName(a, b),
        "recent": (a, b) => b.summary.lastActivity - a.summary.lastActivity || byName(a, b)
    };
    rows.sort(sorters[sort] || byName);
    window.__visibleStudents = rows.map(r => r.student);
    setText("table-results", `Showing ${rows.length} of ${inSection.length} students`);

    if (!table) return;
    if (!rows.length) {
        table.innerHTML = `<tr><td colspan="5" class="no-students">No students match your current filters.</td></tr>`;
        return;
    }
    table.innerHTML = rows.map(({ student: s, summary: r }) => {
        const percent = Math.round(r.levels / TOTAL_GAME_LEVELS * 100);
        const stateClass = r.levels >= TOTAL_GAME_LEVELS ? "is-complete" : r.levels > 0 ? "is-active" : "is-new";
        // isOnline is the game's own flag and can stay true after an abrupt exit; Details shows the last activity date.
        const online = r.online ? '<span class="online-pill" title="Reported by the game"><span></span> Online</span>' : '';
        const id = displayText(s.id);
        return `
        <tr>
            <td data-label="Student"><div class="student-name-cell"><span class="student-avatar">${displayText(String(s.name || "?").trim().charAt(0).toUpperCase())}</span><span><strong>${displayText(s.name)}</strong><small>${id} · ${displayText(s.section)}</small>${online}</span></div></td>
            <td data-label="Levels completed">
                <div class="progress-label-row"><strong>${r.levels} of ${TOTAL_GAME_LEVELS}</strong></div>
                <div class="progress-track" role="progressbar" aria-valuenow="${r.levels}" aria-valuemin="0" aria-valuemax="${TOTAL_GAME_LEVELS}" aria-label="Levels completed"><div class="progress-fill ${stateClass}" style="width:${percent}%"></div></div>
            </td>
            <td data-label="Time recorded">${r.attempts ? displayText(fmtTime(r.time)) : '<span class="cell-muted">--</span>'}</td>
            <td data-label="Wrong submissions">${r.attempts ? r.wrong : '<span class="cell-muted">--</span>'}</td>
            <td data-label="Action">
                <div class="row-actions">
                    <button type="button" class="row-btn row-btn-view" onclick="viewStudent('${id}')"><i class="bi bi-eye"></i> Details</button>
                    <button type="button" class="row-btn row-btn-edit" onclick="editStudent('${id}')" title="Edit student" aria-label="Edit ${displayText(s.name)}"><i class="bi bi-pencil"></i></button>
                    <button type="button" class="row-btn row-btn-archive" onclick="archiveStudent('${id}')" title="Archive student" aria-label="Archive ${displayText(s.name)}"><i class="bi bi-archive"></i></button>
                </div>
            </td>
        </tr>`;
    }).join("");
}

["add-student-id", "edit-id-input"].forEach(fieldId => document.getElementById(fieldId)?.addEventListener("input", event => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 11);
    if (digits !== event.target.value) event.target.value = digits;
}));
document.querySelectorAll("#add-student-modal input, #edit-modal input").forEach(input =>
    input.addEventListener("input", () => showFieldError(input, "")));

document.getElementById("student-filter")?.addEventListener("change", () => loadStudents(document.getElementById("section-select")?.value || ""));
function wireStudentExport(buttonId, label, header, rowsOf) {
    const button = document.getElementById(buttonId);
    button?.addEventListener("click", () => withBusy(button, "Preparing...", async () => {
        const rows = rowsOf(window.__visibleStudents || [], yearOfStudent);
        if (!rows.length) return toast(`There is nothing to export for ${label}.`, "error");
        downloadCsv(csvFileName(document.getElementById("section-select")?.value || "all-sections", label), header, rows);
        toast(`${rows.length} row(s) exported.`);
    }));
}
wireStudentExport("export-students-csv", "students", STUDENT_CSV_HEADER, studentCsvRows);
wireStudentExport("export-topics-csv", "topics", TOPIC_CSV_HEADER, topicCsvRows);

// 4. EDIT & ARCHIVE LOGIC
window.editStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const idInput = document.getElementById("edit-id-input");
    const nameInput = document.getElementById("edit-name-input");
    const emailInput = document.getElementById("edit-email-input");
    const emailNote = document.getElementById("edit-email-note");
    const bdayInput = document.getElementById("edit-birthday-input");
    const saveBtn = document.getElementById("save-edit-btn");

    // A student with a sign-in account logs in with the email saved on that account, which this page
    // cannot change. Editing only the record would disconnect the two, so it is shown read-only.
    const storedEmail = String(student.email ?? "").trim();
    const hadEmail = !!storedEmail && storedEmail.toLowerCase() !== "no email";
    const accountLinked = !!student.uid;

    idInput.value = student.id;
    nameInput.value = student.name;
    emailInput.value = hadEmail ? storedEmail : "";
    emailInput.readOnly = accountLinked;
    emailNote.textContent = accountLinked
        ? "This student has a sign-in account, so the email cannot be changed here."
        : hadEmail ? "" : "This student has no email on record. Enter one to save.";
    emailNote.hidden = !emailNote.textContent;
    // Only sections assigned to this teacher in the current school year can be chosen.
    const sectionInput = document.getElementById("edit-section-select");
    const sectionNote = document.getElementById("edit-section-note");
    const sectionChoices = [...new Set([student.section, ...currentUserSection.filter(name => sectionDocMapping[name])])].filter(Boolean).sort((a, b) => a.localeCompare(b));
    sectionInput.replaceChildren(...sectionChoices.map(name => new Option(name, name)));
    sectionInput.value = student.section;
    sectionInput.disabled = sectionChoices.length < 2;
    const syncSectionNote = () => {
        const moving = sectionInput.value !== student.section;
        sectionNote.textContent = !moving
            ? (yearOfStudent(student) ? `School year ${yearOfStudent(student)}.` : "") + (sectionChoices.length < 2 ? " You have one section, so there is nowhere to move this student." : "")
            : `Moves this student from ${student.section} to ${sectionInput.value}. Their account, levels and attempts move with them.` +
              (studentSummary(student).online ? " The game shows them online: ask them to close the game first." : "");
        sectionNote.hidden = !sectionNote.textContent.trim();
    };
    sectionInput.onchange = syncSectionNote;
    syncSectionNote();
    bdayInput.value = student.birthday || "";
    const bounds = birthdayBounds();
    bdayInput.min = bounds.min;
    bdayInput.max = bounds.max;
    [idInput, nameInput, emailInput, bdayInput].forEach(input => showFieldError(input, ""));

    document.getElementById("edit-modal").style.display = "flex";
    saveBtn.disabled = false;
    saveBtn.innerText = "Save Changes";

    saveBtn.onclick = async () => {
        const newId = idInput.value.trim();
        const newName = cleanSpaces(nameInput.value);
        const newEmail = emailInput.value.trim();
        const newBday = bdayInput.value;
        const idChanged = newId !== String(student.id);
        const newSection = sectionInput.value;
        const sectionChanged = newSection !== student.section;
        const targetSectionId = sectionChanged ? sectionDocMapping[newSection] : student.parentDocId;

        const problems = checkStudentDetails(
            { id: newId, email: newEmail, birthday: newBday },
            allStudents.filter(s => s !== student)
        );
        const checks = [
            [idInput, problems.id],
            [nameInput, checkFullName(newName)],
            [emailInput, accountLinked ? "" : problems.email],
            [bdayInput, problems.birthday]
        ];
        checks.forEach(([input, message]) => showFieldError(input, message));
        const firstProblem = checks.find(([, message]) => message);
        if (firstProblem) { firstProblem[0].focus(); return; }

        // Edit only changes details. The password is never touched here (use Reset Password),
        // and only fields that actually changed are written.
        const changes = {};
        if (newName !== String(student.name ?? "").trim()) changes.name = newName;
        if (!accountLinked && newEmail !== (hadEmail ? storedEmail : "")) changes.email = newEmail;
        if (newBday !== String(student.birthday ?? "")) changes.birthday = newBday;
        if (!idChanged && !sectionChanged && !Object.keys(changes).length) { closeEditModal(); return; }

        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
        toggleLoading(true);
        try {
            if (idChanged) {
                const archived = await getDoc(doc(db, "archivedStudents", newId)).catch(() => null);
                if (archived?.exists()) {
                    showFieldError(idInput, `Student number ${newId} already exists in the archive.`);
                    idInput.focus();
                    return;
                }
            }
            const oldRef = doc(db, "sections", student.parentDocId, "classList", student.id);
            if (idChanged || sectionChanged) {
                if (!targetSectionId) throw new Error("That section is no longer available.");
                const newRef = doc(db, "sections", targetSectionId, "classList", newId);
                if ((await getDoc(newRef)).exists()) {
                    showFieldError(idInput, `Student number ${newId} is already in ${newSection}.`);
                    idInput.focus();
                    return;
                }
                // Copy the stored record (game data, password, everything), not the page's computed copy.
                const stored = await getDoc(oldRef);
                if (!stored.exists()) throw new Error("Student record not found.");
                const record = { ...stored.data(), ...changes, id: newId };
                // Records restored from the archive also carry where they belong.
                if ("section" in record) record.section = newSection;
                if ("parentDocId" in record) record.parentDocId = targetSectionId;
                // Both happen together, so a student can never end up in both sections or in neither.
                const batch = writeBatch(db);
                batch.set(newRef, record);
                batch.delete(oldRef);
                await batch.commit();
            } else {
                await updateDoc(oldRef, changes);
            }
            const changed = [idChanged && "student number", ...Object.keys(changes)].filter(Boolean).join(", ");
            if (sectionChanged) logTeacherActivity(db, auth, { action: "student_moved", summary: `Moved ${newName} from ${student.section} to ${newSection}`, section: newSection, studentId: newId });
            if (changed) logTeacherActivity(db, auth, { action: "student_updated", summary: `Updated ${newName} (${changed})`, section: newSection, studentId: newId });
            closeEditModal();
            await fetchClassList();
            toast(sectionChanged ? `${newName} moved to ${newSection}.` : "Student record updated.");
        } catch (error) {
            console.error("Update error:", error);
            toast("The student record could not be updated. Please try again.", "error");
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
            toggleLoading(false);
        }
    };
};

window.closeEditModal = function() {
    document.getElementById("edit-modal").style.display = "none";
};

window.archiveStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const confirmModal = document.getElementById("confirm-modal");
    document.getElementById("confirm-title").textContent = `Archive ${student.name}?`;
    document.getElementById("confirm-message").textContent = `This student will be moved to the archive and removed from ${student.section}.`;
    confirmModal.style.display = "flex";

    document.getElementById("confirm-action-btn").onclick = async () => {
        const actionBtn = document.getElementById("confirm-action-btn");
        actionBtn.disabled = true;
        actionBtn.innerText = "Archiving...";
        
        await proceedWithArchive(student);
        
        actionBtn.disabled = false;
        actionBtn.innerText = "Confirm Archive";
        closeConfirmModal();
    };
};

async function proceedWithArchive(student) {
    toggleLoading(true);
    try {
        const archiveRef = doc(db, "archivedStudents", student.id);
        
        await setDoc(archiveRef, {
            ...student,
            archivedAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            status: "archived"
        });

        const originalRef = doc(db, "sections", student.parentDocId, "classList", student.id);
        await deleteDoc(originalRef);

        logTeacherActivity(db, auth, { action: "student_archived", summary: `Archived ${student.name}`, section: student.section, studentId: student.id });
        toast(`${student.name} has been moved to the archive.`);
        await fetchClassList(); 
        
    } catch (error) {
        console.error("Archive Error:", error);
        toast("The student could not be archived. Please try again.", "error");
    } finally {
        toggleLoading(false);
    }
}

window.closeConfirmModal = () => document.getElementById("confirm-modal").style.display = "none";

// 5. INDIVIDUAL STUDENT VIEW 







window.viewStudent = function(studentId, options = {}) {
    const student = allStudents.find(s => String(s.id) === String(studentId));
    if (!student) return;
    activeStudentDetailsId = student.id;
    activeStudentDetailsSection = student.parentDocId == null ? null : String(student.parentDocId);

    // Identity on the left, recorded game data on the right. No scores or labels are derived.
    document.getElementById("student-details-modal").style.display = "flex";
    document.getElementById("modal-student-name").textContent = student.name;
    document.getElementById("modal-student-id").textContent = student.id;
    document.getElementById("modal-student-section").textContent = `Section: ${student.section || "--"}`;
    document.getElementById("modal-student-birthday").textContent = `Birthday: ${student.birthday || "Not saved"}`;
    renderStudentSummary(document.getElementById("student-summary"), student);
    renderStudentDetail(document.getElementById("student-detail"), student, { yearOf: yearOfStudent });
    if (!options.keepScroll) document.querySelector("#student-details-modal .student-modal-box")?.scrollTo?.(0, 0);
};

window.closeStudentModal = function(){
    activeStudentDetailsId = null;
    activeStudentDetailsSection = null;
    const detailsModal = document.getElementById("student-details-modal");
    detailsModal.style.display = "none";
    // Open the next student at the top, with their details card in view.
    detailsModal.scrollTop = 0;
    const detailsBox = detailsModal.querySelector(".student-modal-box");
    if (detailsBox) detailsBox.scrollTop = 0;
};




// Class-list template: exactly four columns, in the order the import reads them.
// Student Number and Birthday are text cells so Excel keeps leading zeros (02000452904)
// and keeps the date as typed (mm/dd/yyyy) instead of converting it.
const TEMPLATE_HEADERS = ["Student Number", "Full Name", "Student Email", "Birthday (mm/dd/yyyy)"];
const TEMPLATE_ROWS = 300;

window.downloadExcelTemplate = function () {
    try {
        const rows = [TEMPLATE_HEADERS, ...Array.from({ length: TEMPLATE_ROWS }, () => ["", "", "", ""])];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        for (let r = 1; r <= TEMPLATE_ROWS; r++) {
            for (const col of ["A", "D"]) ws[`${col}${r + 1}`] = { t: "s", v: "", z: "@" };
        }
        ws["!cols"] = [{ wch: 20 }, { wch: 34 }, { wch: 38 }, { wch: 22 }];

        const guide = XLSX.utils.aoa_to_sheet([
            ["How to fill in the class list"],
            [],
            ["Column", "Rule", "Example"],
            ["Student Number", "10 or 11 digits only, no dashes or spaces", "02000452904"],
            ["Full Name", "Surname, First name Middle initial. Letters only (2 to 120 characters)", "Dela Cruz, Juan M."],
            ["Student Email", "A valid email address (required)", "juan.delacruz@caloocan.sti.edu.ph"],
            ["Birthday (mm/dd/yyyy)", "Month/day/year; the student must be at least 16 years old", "01/15/2008"],
            [],
            ["Notes"],
            ["Fill in the 'Class List' sheet only and keep row 1 (the headings) as it is."],
            ["The game password is the birthday as YYYYMMDD, for example 20080115."],
            ["Rows that break a rule are skipped and listed after the import so you can fix them."]
        ]);
        guide["!cols"] = [{ wch: 24 }, { wch: 70 }, { wch: 36 }];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, ws, "Class List");
        XLSX.utils.book_append_sheet(workbook, guide, "How to fill in");
        XLSX.writeFile(workbook, "Student_Class_List_Template.xlsx");

    } catch (error) {
        console.error("Template download error:", error);
        alert("Unable to download the Excel template.");
    }
};


window.openAddStudentModal = function () {

    const sectionSelect =
        document.getElementById("section-select");

    const selectedSection =
        sectionSelect ? sectionSelect.value : "";

    if (!selectedSection) {

        alert(
            "Please select a section first before adding a student manually."
        );

        if (sectionSelect) {
            sectionSelect.focus();
        }

        return;
    }

    document.getElementById(
        "add-student-section-name"
    ).textContent = selectedSection;

    document.getElementById(
        "add-student-id"
    ).value = "";

    document.getElementById(
        "add-student-surname"
    ).value = "";

    document.getElementById(
        "add-student-first-name"
    ).value = "";

    document.getElementById(
        "add-student-middle-initial"
    ).value = "";

    const birthdayInput = document.getElementById("add-student-birthday");
    const bounds = birthdayBounds();
    birthdayInput.min = bounds.min;
    birthdayInput.max = bounds.max;
    document.querySelectorAll("#add-student-modal input").forEach(input => showFieldError(input, ""));

    document.getElementById(
        "add-student-email"
    ).value = "";

    document.getElementById(
        "add-student-birthday"
    ).value = "";

    const saveBtn =
        document.getElementById("save-add-student-btn");

    saveBtn.disabled = false;

    saveBtn.innerHTML =
        '<i class="bi bi-person-check"></i> Add Student';

    document.getElementById(
        "add-student-modal"
    ).style.display = "flex";

    setTimeout(() => {

        document
            .getElementById("add-student-id")
            ?.focus();

    }, 50);
};


window.closeAddStudentModal = function () {

    const modal =
        document.getElementById("add-student-modal");

    if (modal) {
        modal.style.display = "none";
    }
};


window.saveManualStudent = async function () {

    const sectionSelect =
        document.getElementById("section-select");

    const selectedSectionName =
        sectionSelect ? sectionSelect.value : "";

    const parentDocId =
        sectionDocMapping[selectedSectionName];

    const id =
        document.getElementById("add-student-id")
            .value
            .trim();

    const surname =
        document.getElementById("add-student-surname")
            .value
            .trim();

    const firstName =
        document.getElementById("add-student-first-name")
            .value
            .trim();

    const middleInitial =
        document.getElementById("add-student-middle-initial")
            .value
            .trim();

    const email =
        document.getElementById("add-student-email")
            .value
            .trim();

    const birthday =
        document.getElementById("add-student-birthday")
            .value;


    if (!selectedSectionName || !parentDocId) {

        alert("Please select a valid section first.");

        return;
    }


    // Check every field and show each problem under its own field (same rules as Update Student).
    const problems = checkStudentDetails({ id, email, birthday }, allStudents);
    const checks = [
        ["add-student-id", problems.id],
        ["add-student-surname", checkName(surname, "Surname")],
        ["add-student-first-name", checkName(firstName, "First name")],
        ["add-student-middle-initial", checkMiddleInitial(middleInitial)],
        ["add-student-email", problems.email],
        ["add-student-birthday", problems.birthday]
    ];
    checks.forEach(([fieldId, message]) => showFieldError(document.getElementById(fieldId), message));
    const firstProblem = checks.find(([, message]) => message);
    if (firstProblem) {
        document.getElementById(firstProblem[0])?.focus();
        return;
    }


        // Stored the same way as existing records, e.g. "Acabo, Jerick B."
    const fullName =
        `${cleanSpaces(surname)}, ${cleanSpaces(firstName)} ${formatMiddleInitial(middleInitial)}`
            .trim();


    const saveBtn =
        document.getElementById(
            "save-add-student-btn"
        );

    saveBtn.disabled = true;

    saveBtn.innerHTML =
        '<i class="bi bi-hourglass-split"></i> Adding...';

    toggleLoading(true);


    try {

        const selectedSectionStudents =
            allStudents.filter(
                s => s.section === selectedSectionName
            );


        if (
            selectedSectionStudents.some(
                s => String(s.id) === id
            )
        ) {

            alert(
                `Student Number ${id} already exists in ${selectedSectionName}.`
            );

            return;
        }


        /*
         * Check archived students as well.
         */
        try {

            const archiveSnap =
                await getDocs(
                    collection(
                        db,
                        "archivedStudents"
                    )
                );

            if (
                archiveSnap.docs.some(
                    d => String(d.id) === id
                )
            ) {

                showFieldError(document.getElementById("add-student-id"), `Student number ${id} already exists in the archive.`);

                return;
            }

        } catch (archiveError) {

            console.warn(
                "Could not check archived students:",
                archiveError
            );
        }


        /*
         * Create the student inside:
         *
         * sections
         *   └── selected section
         *       └── classList
         *           └── student number
         */
        const studentRef =
            doc(
                db,
                "sections",
                parentDocId,
                "classList",
                id
            );


        /*
         * Birthday becomes the initial password.
         *
         * Example:
         * 2005-01-14
         *
         * becomes:
         * 20050114
         */
        const studentPassword =
            formatBirthdayToPassword(
                birthday
            );


        await setDoc(
            studentRef,
            {
                id: id,

                name: fullName,

                email: email,

                birthday: birthday,

                password: studentPassword,

                progress: 0,

                idleTime: "0m",

                difficulty: [
                    0,
                    0,
                    0,
                    0,
                    0
                ],

                attempts: []
            }
        );


        /*
         * Close modal after successful save.
         */
        closeAddStudentModal();


        /*
         * Refresh the student data.
         */
        await fetchClassList();


        /*
         * Keep the teacher on the section
         * they were working with.
         */
        const refreshedSectionSelect =
            document.getElementById(
                "section-select"
            );


        if (refreshedSectionSelect) {

            refreshedSectionSelect.value =
                selectedSectionName;

            loadStudents(
                selectedSectionName
            );
        }


        logTeacherActivity(db, auth, { action: "student_added", summary: `Added ${fullName}`, section: selectedSectionName, studentId: id });
        toast(`${fullName} was added to ${selectedSectionName}.`);


    } catch (error) {

        console.error(
            "Manual student add error:",
            error
        );

        toast("The student could not be added. Check your connection and try again.", "error");


    } finally {

        saveBtn.disabled = false;

        saveBtn.innerHTML =
            '<i class="bi bi-person-check"></i> Add Student';

        toggleLoading(false);
    }
};

// 6. EXCEL IMPORT LOGIC
window.updateFileName = function(input) {
    const label = document.getElementById("file-name-text"); 
    if (input.files.length > 0) {
        const name = input.files[0].name;
        if(label) {
            label.textContent = name;
            label.style.fontWeight = "600";
        }
    }
};

function excelDateToJSDate(value) {
    if (typeof value === "number") {
        const date = new Date((value - 25569) * 86400 * 1000);
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(date.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    if (typeof value === "string") {
        const raw = value.trim();
        const parts = raw.split(/[\/\-\.]/);

        if (parts.length === 3) {
            // yyyy-mm-dd, otherwise mm/dd/yyyy as written on the template's column header.
            let [month, day, year] = parts[0].length === 4 ? [parts[1], parts[2], parts[0]] : parts;
            day = day.padStart(2, "0");
            month = month.padStart(2, "0");

            if (year.length === 2) {
                // 2-digit years: 00 up to this year → 20xx, otherwise 19xx.
                const thisYear = new Date().getFullYear() % 100;
                year = (Number(year) <= thisYear ? "20" : "19") + year;
            }
            return `${year}-${month}-${day}`;
        }
    }
    return "";
}

// Lists the first rows that were skipped because they broke the input rules.
function invalidReport(rows) {
    if (!rows.length) return "";
    const shown = rows.slice(0, 8).join("\n");
    return `\n\nSkipped ${rows.length} row(s) with problems:\n${shown}${rows.length > 8 ? `\n…and ${rows.length - 8} more` : ""}\nFix them in the file and import again.`;
}

window.importExcel = async function () {
    const input = document.getElementById("excel-input");
    const sectionSelect = document.getElementById("section-select");
    const label = document.getElementById("file-name-text");

    if (!input.files.length) return alert("Please choose a file first!");
    if (!sectionSelect.value) return alert("Please select a section before importing!");

    const selectedSectionName = sectionSelect.value;
    const parentDocId = sectionDocMapping[selectedSectionName];

    const reader = new FileReader();
    reader.onload = async (e) => {
        toggleLoading(true);
        try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
            // Fixed columns A–D (header row skipped); raw:false keeps text such as leading zeros.
            const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false, blankrows: false }).slice(1);
            const batch = writeBatch(db);

            const allExistingIds = new Set(allStudents.map(s => String(s.id)));

            try {
                const archiveSnap = await getDocs(collection(db, "archivedStudents"));
                archiveSnap.forEach(doc => {
                    allExistingIds.add(String(doc.id));
                });
                console.log(`✅ Found ${archiveSnap.size} archived students - preventing duplicates`);
            } catch (archiveError) {
                console.warn("Could not check archive collection:", archiveError);
            }

            let addedCount = 0;
            let skippedCount = 0;
            const invalidRows = [];
            let skippedActiveCount = 0;
            let skippedArchiveCount = 0;

            data.forEach((values, index) => {

                const sId = String(values[0] || "").trim();
                const sName = cleanSpaces(values[1]);
                const sEmail = String(values[2] || "").trim();
                const rawBirthday = values[3];

                const sBirthday = excelDateToJSDate(rawBirthday);
                const sPassword = formatBirthdayToPassword(sBirthday);

                if (!sId && !sName) return; // empty row

                // Same rules as Add Student; row numbers match Excel (row 1 is the header).
                const problem = checkStudentNumber(sId) || checkFullName(sName) || checkBirthday(sBirthday) ||
                    checkEmail(sEmail);
                if (problem) {
                    invalidRows.push(`Row ${index + 2}${sId ? " (" + sId + ")" : ""}: ${problem}`);
                    return;
                }

                if (!allExistingIds.has(sId)) {
                    const studentRef = doc(db, "sections", parentDocId, "classList", sId);

                    batch.set(studentRef, {
                        id: sId,
                        name: sName,
                        email: sEmail,
                        birthday: sBirthday,
                        password: sPassword,
                        progress: 0,
                        idleTime: "0m",
                        difficulty: [0, 0, 0, 0, 0],
                        attempts: []
                    });

                    addedCount++;
                    allExistingIds.add(sId);
                } else {
                    skippedCount++;
                    const isActive = allStudents.some(s => s.id === sId);
                    if (isActive) {
                        skippedActiveCount++;
                    } else {
                        skippedArchiveCount++;
                    }
                }
            });

            if (addedCount > 0) {
                await batch.commit();
                logTeacherActivity(db, auth, { action: "students_imported", summary: `Imported ${addedCount} student(s) from a class list`, section: selectedSectionName });
                alert(`Import Complete!\n` +
                      `Added: ${addedCount} new students\n` +
                      `Skipped Active: ${skippedActiveCount}\n` +
                      `Skipped Archived: ${skippedArchiveCount}` +
                      invalidReport(invalidRows));
                await fetchClassList();
            } else {
                alert(`No new students found.\n` +
                      `Active duplicates: ${skippedActiveCount}\n` +
                      `Archived duplicates: ${skippedArchiveCount}` +
                      invalidReport(invalidRows));
            }

            input.value = "";
            if (label) {
                label.textContent = "Choose File";
                label.style.fontWeight = "normal";
            }

        } catch (err) {
            console.error(err);
            alert("Error reading Excel file.");
        } finally {
            toggleLoading(false);
        }
    };

    reader.readAsArrayBuffer(input.files[0]);
};

window.handlePasswordReset = function() {
    const modal = document.getElementById("reset-password-modal");
    const sectionDrop = document.getElementById("reset-section-select");
    const searchInput = document.getElementById("reset-search-input");
    const studentDrop = document.getElementById("reset-student-select");
    
    document.getElementById("reset-step-1").style.display = "block";
    document.getElementById("reset-step-2").style.display = "none";
    searchInput.value = "";
    
    sectionDrop.innerHTML = '<option value="">-- Select Section --</option>';
    currentUserSection.forEach(sec => {
        const opt = document.createElement("option");
        opt.value = sec;
        opt.textContent = sec;
        sectionDrop.appendChild(opt);
    });

    const filterResetList = () => {
        const selectedSec = sectionDrop.value;
        const term = searchInput.value;
        
        studentDrop.innerHTML = '';
        
        if (!selectedSec) {
            studentDrop.innerHTML = '<option disabled>Please select a section first...</option>';
            return;
        }

        const filtered = searchStudents(allStudents.filter(s => s.section === selectedSec), term);

        if (filtered.length === 0) {
            studentDrop.innerHTML = '<option disabled>No students found...</option>';
        } else {
            filtered.sort((a,b) => String(a.name || "").localeCompare(String(b.name || ""))).forEach(s => {
                const opt = document.createElement("option");
                opt.value = s.id;
                opt.textContent = `${s.name} (${s.id})`;
                studentDrop.appendChild(opt);
            });
        }
    };

    sectionDrop.onchange = filterResetList;
    searchInput.oninput = filterResetList;

    modal.style.display = "flex";
};

window.closeResetModal = () => {
    document.getElementById("reset-password-modal").style.display = "none";
};

window.confirmResetSelection = function() {
    const studentId = document.getElementById("reset-student-select").value;
    
    if (!studentId) {
        alert("Please select a student from the list!");
        return;
    }

    const student = allStudents.find(s => s.id === studentId);
    
    document.getElementById("reset-step-1").style.display = "none";
    document.getElementById("reset-step-2").style.display = "block";
    document.getElementById("reset-confirm-text").innerHTML = 
        `<i class="bi bi-exclamation-triangle"></i> You are about to reset the password for <b>${student.name}</b>. This action cannot be undone.` +
        (student.uid ? `<br><br>This student already signs in with their own account. This reset updates the class list only and may not change the password they use in the game.` : "");

    document.getElementById("final-reset-btn").onclick = () => saveNewPassword(student);
};

window.backToStep1 = () => {
    document.getElementById("reset-step-1").style.display = "block";
    document.getElementById("reset-step-2").style.display = "none";
};

async function saveNewPassword(student) {
    const newPass = document.getElementById("new-password-input").value.trim();
    if (newPass.length < 4) {
        alert("Password must be at least 4 characters long.");
        return;
    }

    toggleLoading(true);
    try {
        const studentRef = doc(db, "sections", student.parentDocId, "classList", student.id);
        
        await updateDoc(studentRef, {
            password: newPass
        });

        logTeacherActivity(db, auth, { action: "password_reset", summary: `Reset the password of ${student.name}`, section: student.section, studentId: student.id });
        toast(`Password for ${student.name} has been updated.`);
        closeResetModal();
        await fetchClassList();
    } catch (error) {
        console.error("Firestore Update Error:", error);
        toast("The password could not be updated. Check your connection.", "error");
    } finally {
        toggleLoading(false);
    }
}

// Event Listeners
document.getElementById("excel-input")?.addEventListener("change", function() {
    updateFileName(this);
});

document.getElementById("section-select")?.addEventListener("change", (e) => { loadStudents(e.target.value); focusMonitor.render(); });
document.getElementById("search-student")?.addEventListener("input", () => {
    const sec = document.getElementById("section-select").value;
    loadStudents(sec);
});


window.logoutUser = async () => {
    stopStudentRealtimeListeners();
    try {
        await signOut(auth);
        localStorage.removeItem(VERIFIED_KEY);
        sessionStorage.removeItem(VERIFIED_KEY);
        window.location.href = '../index.html'; 
    } catch (error) {
        console.error("Logout error", error);
    }
};

window.closeLogoutPopup = () => {
    document.getElementById("logout-popup").style.display = "none";
};

window.showLogoutPopup = () => {
    document.getElementById("logout-popup").style.display = "flex";
};


function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeToggleBtn = document.getElementById("theme-toggle");
    if (themeToggleBtn) {
        const icon = themeToggleBtn.querySelector("i");
        if (icon) {
            icon.className = (theme === "dark") ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('dashboard-theme') || 'light';
    applyTheme(savedTheme);

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const currentTheme = localStorage.getItem('dashboard-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            localStorage.setItem('dashboard-theme', newTheme);
            applyTheme(newTheme);
        });
    }
});

window.addEventListener('storage', (event) => {
    if (event.key === 'dashboard-theme') {
        const newTheme = event.newValue;
        applyTheme(newTheme);
    }
});

// Additional presentation controls: use the existing section/search filtering pipeline.
document.getElementById("student-sort")?.addEventListener("change", () => loadStudents(document.getElementById("section-select")?.value || ""));
