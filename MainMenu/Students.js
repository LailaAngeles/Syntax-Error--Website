import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, collection, getDocs, getDoc, onSnapshot, query, where, writeBatch, doc, updateDoc, deleteDoc, setDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { renderStudentSummary, renderStudentDetail, studentSummary, studentCsvRows, STUDENT_CSV_HEADER, downloadCsv, fmtDate } from "./record-analysis.js";
import { checkStudentNumber, checkName, checkMiddleInitial, formatMiddleInitial, checkFullName, checkEmail, checkBirthday, birthdayBounds, cleanSpaces, showFieldError } from "./student-rules.js";

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
const studentClassListeners = new Map();
const studentClassSnapshots = new Map();

function stopStudentRealtimeListeners() {
    if (unsubscribeStudentUser) { unsubscribeStudentUser(); unsubscribeStudentUser = null; }
    if (unsubscribeStudentSections) { unsubscribeStudentSections(); unsubscribeStudentSections = null; }
    studentClassListeners.forEach(stop => stop());
    studentClassListeners.clear();
    studentClassSnapshots.clear();
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
    toggleLoading(true);
    await getUserData(user);
    await fetchClassList();
    toggleLoading(false);
});

async function getUserData(user) {
    stopStudentRealtimeListeners();
    const select = document.getElementById("section-select");
    let sectionSnapshot = null;

    function syncAssignedSections() {
        if (!sectionSnapshot) return;
        const selected = select?.value || "";
        sectionDocMapping = {};
        if (select) select.innerHTML = '<option value="">-- All My Sections --</option>';
        sectionSnapshot.forEach(d => {
            const name = d.data().name;
            sectionDocMapping[name] = d.id;
            if (currentUserSection.includes(name) && select) {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            }
        });
        if (select && [...select.options].some(opt => opt.value === selected)) select.value = selected;
        fetchClassList();
    }

    const q = query(collection(db, "approvedUsers"), where("email", "==", user.email));
    unsubscribeStudentUser = onSnapshot(q, snap => {
        currentUserSection = [];
        snap.forEach(d => { currentUserSection = d.data().section || []; });
        const display = document.getElementById("user-section");
        if (display) display.textContent = currentUserSection.join(", ");
        syncAssignedSections();
    }, error => console.error("Error listening for user sections:", error));

    unsubscribeStudentSections = onSnapshot(collection(db, "sections"), snap => {
        sectionSnapshot = snap;
        syncAssignedSections();
    }, error => console.error("Error listening for sections:", error));
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
            renderRealtimeStudents();
        }, error => console.error("Class list listener error:", error));
        studentClassListeners.set(docId, stop);
    });
    studentClassSnapshots.forEach((students, id) => {
        const name = wanted.get(id);
        if (name) students.forEach(student => { student.section = name; });
    });
    renderRealtimeStudents();
}

// 3. TABLE LOADING & STAT UPDATES
function loadStudents(section) {
    const table = document.getElementById("students-table");
    const searchTerm = (document.getElementById("search-student")?.value || "").toLowerCase();
    const filterBy = document.getElementById("student-filter")?.value || "all";
    const sort = document.getElementById("student-sort")?.value || "name";
    const displayText = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };

    // Counts follow the section only, not the search box or the table filter.
    const inSection = allStudents.filter(s => section === "" || s.section === section)
        .map(s => ({ student: s, summary: studentSummary(s) }));
    setText("card-total-students", inSection.length);
    setText("online-count", inSection.filter(r => r.summary.online).length);
    setText("started-count", inSection.filter(r => r.summary.hasRecords).length);
    setText("not-started-count", inSection.filter(r => !r.summary.hasRecords).length);

    const rows = inSection.filter(({ student: s, summary }) => {
        const matchesSearch = !searchTerm ||
            (s.name && s.name.toLowerCase().includes(searchTerm)) ||
            (s.id && s.id.toString().toLowerCase().includes(searchTerm));
        const matchesFilter = filterBy === "all" ||
            (filterBy === "started" && summary.hasRecords) ||
            (filterBy === "notstarted" && !summary.hasRecords) ||
            (filterBy === "online" && summary.online);
        return matchesSearch && matchesFilter;
    });
    const byName = (a, b) => String(a.student.name || "").localeCompare(String(b.student.name || ""));
    const sorters = {
        "levels-desc": (a, b) => b.summary.levels - a.summary.levels || byName(a, b),
        "levels-asc": (a, b) => a.summary.levels - b.summary.levels || byName(a, b),
        "recent": (a, b) => b.summary.lastActivity - a.summary.lastActivity || byName(a, b)
    };
    rows.sort(sorters[sort] || byName);
    window.__visibleStudents = rows.map(r => r.student);
    setText("table-results", `Showing ${rows.length} of ${inSection.length} students`);

    if (!table) return;
    if (!rows.length) {
        table.innerHTML = `<tr><td colspan="4" class="no-students">No students match your current filters.</td></tr>`;
        return;
    }
    table.innerHTML = rows.map(({ student: s, summary: r }) => {
        const percent = Math.round(r.levels / TOTAL_GAME_LEVELS * 100);
        const stateClass = r.levels >= TOTAL_GAME_LEVELS ? "is-complete" : r.levels > 0 ? "is-active" : "is-new";
        // isOnline is the game's own flag (it can stay true after an abrupt exit), so the last date is always shown.
        const last = (r.lastActivity ? displayText(fmtDate(r.lastActivity)) : '<span class="cell-muted">No activity yet</span>')
            + (r.online ? '<br><span class="online-pill" title="Reported by the game"><span></span> Online</span>' : '');
        const id = displayText(s.id);
        return `
        <tr>
            <td data-label="Student"><div class="student-name-cell"><span class="student-avatar">${displayText(String(s.name || "?").trim().charAt(0).toUpperCase())}</span><span><strong>${displayText(s.name)}</strong><small>${id} · ${displayText(s.section)}</small></span></div></td>
            <td data-label="Levels completed">
                <div class="progress-label-row"><strong>${r.levels} of ${TOTAL_GAME_LEVELS}</strong></div>
                <div class="progress-track" role="progressbar" aria-valuenow="${r.levels}" aria-valuemin="0" aria-valuemax="${TOTAL_GAME_LEVELS}" aria-label="Levels completed"><div class="progress-fill ${stateClass}" style="width:${percent}%"></div></div>
            </td>
            <td data-label="Last activity">${last}</td>
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
document.getElementById("export-students-csv")?.addEventListener("click", () => {
    const section = document.getElementById("section-select")?.value || "all-sections";
    downloadCsv(`syntaxerror-students-${section}-${new Date().toISOString().slice(0, 10)}.csv`, STUDENT_CSV_HEADER, studentCsvRows(window.__visibleStudents || []));
});

// 4. EDIT & ARCHIVE LOGIC
window.editStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const idInput = document.getElementById("edit-id-input");
    const nameInput = document.getElementById("edit-name-input");
    const bdayInput = document.getElementById("edit-birthday-input");
    const saveBtn = document.getElementById("save-edit-btn");
    
    idInput.value = student.id;
    nameInput.value = student.name;
    bdayInput.value = student.birthday || "";
    const bounds = birthdayBounds();
    bdayInput.min = bounds.min;
    bdayInput.max = bounds.max;
    [idInput, nameInput, bdayInput].forEach(input => showFieldError(input, ""));
    
    document.getElementById("edit-modal").style.display = "flex";
    saveBtn.disabled = false;
    saveBtn.innerText = "Save Changes";

    saveBtn.onclick = async () => {
        const newId = idInput.value.trim();
        const newName = nameInput.value.trim();
        const newBday = bdayInput.value;

        const idTaken = newId !== String(student.id) && allStudents.some(s => String(s.id) === newId);
        const checks = [
            [idInput, checkStudentNumber(newId) || (idTaken ? `Student number ${newId} is already used in one of your sections.` : "")],
            [nameInput, checkFullName(newName)],
            [bdayInput, checkBirthday(newBday)]
        ];
        checks.forEach(([input, message]) => showFieldError(input, message));
        const firstProblem = checks.find(([, message]) => message);
        if (firstProblem) { firstProblem[0].focus(); return; }

        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
        toggleLoading(true);

        // Edit only changes details. The password is never touched here (use Reset Password),
        // and only fields that actually changed are written.
        const changes = {};
        if (newName !== String(student.name ?? "").trim()) changes.name = newName;
        if (newBday !== String(student.birthday ?? "")) changes.birthday = newBday;
        const idChanged = newId !== String(student.id);
        if (!idChanged && !Object.keys(changes).length) {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
            toggleLoading(false);
            closeEditModal();
            return;
        }

        try {
            const oldRef = doc(db, "sections", student.parentDocId, "classList", student.id);

            if (idChanged) {
                // Copy the stored record (game data, password, everything), not the page's computed copy.
                const stored = await getDoc(oldRef);
                if (!stored.exists()) throw new Error("Student record not found.");
                const newRef = doc(db, "sections", student.parentDocId, "classList", newId);
                await setDoc(newRef, { ...stored.data(), ...changes, id: newId });
                await deleteDoc(oldRef);
            } else {
                await updateDoc(oldRef, changes);
            }

            closeEditModal();
            await fetchClassList(); 
            alert("Student record updated!");
        } catch (error) {
            console.error("Update error:", error);
            alert("Failed to update record.");
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

        alert(`${student.name} has been moved to the archive.`);
        await fetchClassList(); 
        
    } catch (error) {
        console.error("Archive Error:", error);
        alert("Failed to archive student. Please try again.");
    } finally {
        toggleLoading(false);
    }
}

window.closeConfirmModal = () => document.getElementById("confirm-modal").style.display = "none";
window.closeArchiveModal = () => document.getElementById("custom-archive-modal").style.display = "none";

// 5. INDIVIDUAL STUDENT VIEW 







window.viewStudent = function(studentId, options = {}) {
    const student = allStudents.find(s => s.id === studentId);
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
    renderStudentDetail(document.getElementById("student-detail"), student);
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
            ["Student Email", "A valid email address (optional)", "juan.delacruz@caloocan.sti.edu.ph"],
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


    // Check every field and show each problem under its own field.
    const checks = [
        ["add-student-id", checkStudentNumber(id) ||
            (allStudents.some(s => String(s.id) === id) ? `Student number ${id} is already used in one of your sections.` : "")],
        ["add-student-surname", checkName(surname, "Surname")],
        ["add-student-first-name", checkName(firstName, "First name")],
        ["add-student-middle-initial", checkMiddleInitial(middleInitial)],
        ["add-student-email", checkEmail(email)],
        ["add-student-birthday", checkBirthday(birthday)]
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

                alert(
                    `Student Number ${id} already exists in the archive.`
                );

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


        alert(
            `Student ${fullName} was added successfully to ${selectedSectionName}.`
        );


    } catch (error) {

        console.error(
            "Manual student add error:",
            error
        );

        alert(
            "Failed to add the student. Please check your connection and try again."
        );


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
                const sEmail = String(values[2] || "").trim() || "No Email";
                const rawBirthday = values[3];

                const sBirthday = excelDateToJSDate(rawBirthday);
                const sPassword = formatBirthdayToPassword(sBirthday);

                if (!sId && !sName) return; // empty row

                // Same rules as Add Student; row numbers match Excel (row 1 is the header).
                const problem = checkStudentNumber(sId) || checkFullName(sName) || checkBirthday(sBirthday) ||
                    (sEmail !== "No Email" ? checkEmail(sEmail) : "");
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
        const term = searchInput.value.toLowerCase();
        
        studentDrop.innerHTML = '';
        
        if (!selectedSec) {
            studentDrop.innerHTML = '<option disabled>Please select a section first...</option>';
            return;
        }

        const filtered = allStudents.filter(s => {
            const matchesSection = s.section === selectedSec;
            const matchesSearch = s.name.toLowerCase().includes(term) || 
                                  s.id.toString().includes(term);
            return matchesSection && matchesSearch;
        });

        if (filtered.length === 0) {
            studentDrop.innerHTML = '<option disabled>No students found...</option>';
        } else {
            filtered.sort((a,b) => a.name.localeCompare(b.name)).forEach(s => {
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
        `<i class="bi bi-exclamation-triangle"></i> You are about to reset the password for <b>${student.name}</b>. This action cannot be undone.`;

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

        alert(`Success! Password for ${student.name} has been updated.`);
        closeResetModal();
        await fetchClassList();
    } catch (error) {
        console.error("Firestore Update Error:", error);
        alert("Failed to update password. Please check your connection.");
    } finally {
        toggleLoading(false);
    }
}

// Event Listeners
document.getElementById("excel-input")?.addEventListener("change", function() {
    updateFileName(this);
});

document.getElementById("section-select")?.addEventListener("change", (e) => loadStudents(e.target.value));
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
document.getElementById("progress-filter")?.addEventListener("change", () => loadStudents(document.getElementById("section-select")?.value || ""));
document.getElementById("student-sort")?.addEventListener("change", () => loadStudents(document.getElementById("section-select")?.value || ""));
