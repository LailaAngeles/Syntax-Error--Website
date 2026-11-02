// Manage School Years (Super Admin): create, start, end and archive school years, and move students
// into the new year. Works alongside Manage Sections / Manage Users, which stay as they are.
//
// What each action writes (nothing is ever deleted):
//   Create  -> schoolYears/{SY2026-2027} with status "upcoming".
//   Start   -> status "active". The first time, sections made before school years existed are put
//              under this year (schoolYearId). Optionally re-creates last year's section names as new,
//              empty sections, and keeps teachers on the same names.
//   End     -> each section of the year keeps a copy of its teachers (teachers) and student count;
//              each teacher keeps the year's assignment (sectionsByYear.{year}); then status "completed".
//              Student records, game progress, times and errors are not touched.
//   Archive -> status "archived" (still viewable in Students > school year).
//   Move    -> the student's account (name, email, birthday, password, Firebase uid) moves to a section of
//              the active year with a fresh record for the new year. The old record stays where it is,
//              with all its game data, as that year's history; it only loses the sign-in fields so the
//              game finds the student's new record (one account, never two).
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, onSnapshot, runTransaction, writeBatch,
    serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
    STATUS_LABEL, yearIdFor, yearLabelFor, activeYear, sectionYearId, watchSchoolYears
} from "../MainMenu/school-years.js";

const config = {
    apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};
const app = getApps().length ? getApp() : initializeApp(config);
const db = getFirestore(app);

// The account fields that follow a student into the new school year. Game data does not.
const ACCOUNT_FIELDS = ["id", "name", "email", "birthday", "password", "uid", "role", "accountStatus",
    "registeredAt", "authLinkedAt", "passwordChoiceDone", "passwordChangedAt", "gradeLevel"];

let years = [];
let sectionDocs = [];   // [{ id, ...data }] of every section, all years
let teachers = [];      // [{ id, ...data }] of approvedUsers

const $ = id => document.getElementById(id);
const loading = show => { const el = $("loading-overlay"); if (el) el.style.display = show ? "flex" : "none"; };
const text = (tag, value, className) => { const el = document.createElement(tag); if (className) el.className = className; el.textContent = value; return el; };
const when = value => { const d = value?.toDate?.() ?? (value ? new Date(value) : null); return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : ""; };
const sectionsOf = yearId => sectionDocs.filter(s => sectionYearId(s, years) === yearId).sort((a, b) => String(a.name).localeCompare(String(b.name)));
const sectionList = value => (Array.isArray(value) ? value : [value]).filter(s => typeof s === "string" && s.trim() && s !== "No Section");

// ---------------------------------------------------------------- dialogs
function dialog({ icon = "bi-calendar3", eyebrow = "MANAGE SCHOOL YEARS", title, intro, danger = false, wide = false }) {
    const overlay = document.createElement("div");
    overlay.className = "modal sy-modal";
    const box = document.createElement("div");
    box.className = "modal-box sa-section-dialog sy-dialog" + (wide ? " sy-wide" : "");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const head = document.createElement("div");
    head.className = "sa-section-heading";
    head.innerHTML = `<div class="sa-section-icon${danger ? " danger-icon" : ""}"><i class="bi ${icon}"></i></div><div></div>`;
    head.lastElementChild.append(text("span", eyebrow, "sa-section-eyebrow"), text("h3", title));
    if (intro) head.lastElementChild.append(text("p", intro));
    const body = document.createElement("div");
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    box.append(head, body, actions);
    overlay.append(box);
    document.body.append(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    const button = (label, kind, onClick) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = kind === "primary" ? "sa-section-primary" : kind === "danger" ? "sa-section-danger" : "sa-section-cancel";
        b.innerHTML = label;
        b.addEventListener("click", onClick);
        actions.append(b);
        return b;
    };
    return { overlay, body, actions, close, button };
}

function notify(title, message, ok = true) {
    const d = dialog({ icon: ok ? "bi-check2-circle" : "bi-exclamation-triangle", title, intro: message, danger: !ok });
    d.button("OK", "primary", d.close).focus();
}

function confirmDialog({ title, intro, points = [], confirmLabel, danger = false, icon }) {
    return new Promise(resolve => {
        const d = dialog({ title, intro, danger, icon });
        if (points.length) {
            const list = document.createElement("ul");
            list.className = "sy-points";
            points.forEach(([symbol, line]) => {
                const li = document.createElement("li");
                li.innerHTML = `<i class="bi ${symbol}"></i>`;
                li.append(text("span", line));
                list.append(li);
            });
            d.body.append(list);
        }
        const done = value => { d.close(); resolve(value); };
        d.button("Cancel", "cancel", () => done(false)).focus();
        d.button(confirmLabel, danger ? "danger" : "primary", () => done(true));
    });
}

async function run(action, successTitle, successMessage) {
    loading(true);
    try {
        const message = await action();
        loading(false);
        notify(successTitle, message || successMessage);
        return true;
    } catch (error) {
        loading(false);
        console.error("[School years]", error);
        notify("Not saved", error?.code === "permission-denied"
            ? "Firestore refused the change (permission denied). The Firestore rules must allow the schoolYears collection; see firestore-school-years.rules."
            : error?.message || "Something went wrong. Nothing was changed.", false);
        return false;
    }
}

// Firestore batches hold at most 500 writes.
async function commitInChunks(writes) {
    for (let i = 0; i < writes.length; i += 450) {
        const batch = writeBatch(db);
        writes.slice(i, i + 450).forEach(([ref, data]) => batch.update(ref, data));
        await batch.commit();
    }
}

// ---------------------------------------------------------------- Firestore actions
async function createYear(startYear) {
    const ref = doc(db, "schoolYears", yearIdFor(startYear));
    await runTransaction(db, async tx => {
        if ((await tx.get(ref)).exists()) throw new Error(`School year ${yearLabelFor(startYear)} already exists.`);
        tx.set(ref, {
            label: yearLabelFor(startYear), startYear, endYear: startYear + 1,
            status: "upcoming", createdAt: serverTimestamp()
        });
    });
}

async function startYear(year, { reuseFrom, keepTeachers }) {
    const running = activeYear(years);
    if (running) throw new Error(`End school year ${running.label} before starting another one.`);
    const ref = doc(db, "schoolYears", year.id);
    await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data().status !== "upcoming") throw new Error("Only a school year that has not started yet can be started.");
        tx.update(ref, { status: "active", activatedAt: serverTimestamp() });
    });

    const freshSections = (await getDocs(collection(db, "sections"))).docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));
    const writes = [];
    // The first school year ever started takes the sections made before school years existed.
    const firstEver = !years.some(y => y.id !== year.id && y.status !== "upcoming");
    if (firstEver) freshSections.filter(s => !s.schoolYearId).forEach(s => { writes.push([s.ref, { schoolYearId: year.id }]); s.schoolYearId = year.id; });
    await commitInChunks(writes);

    // Same section names as a previous year: new, empty section documents for this year.
    const namesNow = new Set(freshSections.filter(s => s.schoolYearId === year.id).map(s => String(s.name).toLowerCase()));
    let created = 0;
    if (reuseFrom) {
        const batch = writeBatch(db);
        for (const s of freshSections.filter(s => sectionYearId(s, years) === reuseFrom.id)) {
            const key = String(s.name || "").toLowerCase();
            if (!key || namesNow.has(key)) continue;
            namesNow.add(key);
            batch.set(doc(collection(db, "sections")), { name: s.name, schoolYearId: year.id, reusedFromSection: s.id, createdAt: serverTimestamp() });
            created++;
        }
        if (created) await batch.commit();
    }

    // Teachers: what was already prepared for this year, or (if chosen) the same names as last year.
    const teacherWrites = [];
    for (const t of (await getDocs(collection(db, "approvedUsers"))).docs) {
        const data = t.data();
        const prepared = data.sectionsByYear?.[year.id];
        let next = prepared ? sectionList(prepared) : [];
        if (!prepared && keepTeachers && reuseFrom) {
            next = sectionList(data.sectionsByYear?.[reuseFrom.id] ?? data.section).filter(n => namesNow.has(n.toLowerCase()));
        }
        if (firstEver && !prepared && !reuseFrom) continue; // first year: everyone keeps their sections
        teacherWrites.push([t.ref, { section: next.length ? next : ["No Section"], [`sectionsByYear.${year.id}`]: next }]);
    }
    await commitInChunks(teacherWrites);
    return `School year ${year.label} is now active.` +
        (firstEver && writes.length ? ` ${writes.length} existing section(s) were placed under this year.` : "") +
        (created ? ` ${created} section(s) were created with last year's names (no students yet).` : "") +
        " Assign teachers in Step 2 and move or add students when ready.";
}

async function endYear(year) {
    const ref = doc(db, "schoolYears", year.id);
    const latest = await getDoc(ref);
    if (latest.data()?.status !== "active") throw new Error("Only the active school year can be ended.");
    const inYear = sectionsOf(year.id);
    const names = new Set(inYear.map(s => s.name));
    const writes = [];
    let students = 0;
    for (const s of inYear) {
        const count = (await getDocs(collection(db, "sections", s.id, "classList"))).size;
        students += count;
        const teachersHere = teachers.filter(t => sectionList(t.section).includes(s.name))
            .map(t => ({ uid: t.id, name: t.name || "", email: t.email || "" }));
        writes.push([doc(db, "sections", s.id), { schoolYearId: year.id, teachers: teachersHere, studentCount: count, closedAt: serverTimestamp() }]);
    }
    for (const t of teachers) {
        writes.push([doc(db, "approvedUsers", t.id), { [`sectionsByYear.${year.id}`]: sectionList(t.section).filter(n => names.has(n)) }]);
    }
    await commitInChunks(writes);
    await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (snap.data()?.status !== "active") throw new Error("This school year was already ended.");
        tx.update(ref, { status: "completed", completedAt: serverTimestamp(), summary: { sections: inYear.length, students } });
    });
    return `School year ${year.label} is completed. ${inYear.length} section(s) and ${students} student record(s) were kept as history. You can now create or start the next school year.`;
}

async function archiveYear(year) {
    await runTransaction(db, async tx => {
        const ref = doc(db, "schoolYears", year.id);
        const snap = await tx.get(ref);
        if (snap.data()?.status !== "completed") throw new Error("Only a completed school year can be archived.");
        tx.update(ref, { status: "archived", archivedAt: serverTimestamp() });
    });
}

async function removeUnstartedYear(year) {
    if (sectionsOf(year.id).length) throw new Error("This school year already has sections, so it cannot be removed.");
    await runTransaction(db, async tx => {
        const ref = doc(db, "schoolYears", year.id);
        const snap = await tx.get(ref);
        if (snap.data()?.status !== "upcoming") throw new Error("Only a school year that has not started can be removed.");
        tx.delete(ref);
    });
}

// Moves one student into a section of the active year. Returns null when done, or the reason it was skipped.
async function moveStudent(fromSection, studentDocId, toSection, gradeLevel, active) {
    const fromRef = doc(db, "sections", fromSection.id, "classList", studentDocId);
    const toRef = doc(db, "sections", toSection.id, "classList", studentDocId);
    return runTransaction(db, async tx => {
        const [from, to] = [await tx.get(fromRef), await tx.get(toRef)];
        if (!from.exists()) return "record not found";
        const data = from.data();
        if (data.movedTo) return `already moved to ${data.movedTo.sectionName || "another section"}`;
        if (to.exists()) return `already in ${toSection.name}`;
        const account = {};
        ACCOUNT_FIELDS.forEach(key => { if (data[key] !== undefined) account[key] = data[key]; });
        if (gradeLevel) account.gradeLevel = gradeLevel;
        tx.set(toRef, {
            ...account,
            id: data.id ?? studentDocId,
            progress: 0, idleTime: "0m", difficulty: [0, 0, 0, 0, 0], attempts: [],
            schoolYearId: active.id,
            enrolledAt: serverTimestamp(),
            previousRecord: { path: fromRef.path, sectionId: fromSection.id, sectionName: fromSection.name, schoolYearId: sectionYearId(fromSection, years) }
        });
        // The old record keeps every game field. Only the sign-in fields leave it, so the game cannot
        // find two records for one student. The email stays readable as recordEmail.
        const history = {
            movedTo: { path: toRef.path, sectionId: toSection.id, sectionName: toSection.name, schoolYearId: active.id, movedAt: serverTimestamp() },
            email: deleteField(), password: deleteField(), uid: deleteField()
        };
        if (data.email) history.recordEmail = data.email;
        if (data.uid) history.formerUid = data.uid;
        tx.update(fromRef, history);
        return null;
    });
}

// ---------------------------------------------------------------- screens
function openCreate() {
    const latest = years[0];
    const suggested = latest ? (latest.startYear || new Date().getFullYear()) + 1 : new Date().getFullYear();
    const d = dialog({ icon: "bi-calendar-plus", title: "Create School Year", intro: "Add the next academic year. It starts as Not started; start it when classes begin." });
    const label = text("label", "SCHOOL YEAR STARTS IN", "sa-section-input-label");
    const input = document.createElement("input");
    input.type = "number"; input.min = "2020"; input.max = "2100"; input.value = String(suggested); input.className = "sy-input";
    label.htmlFor = input.id = "syStartInput";
    const preview = text("p", "", "sa-section-input-help");
    const sync = () => {
        const y = Number(input.value);
        const valid = Number.isInteger(y) && y >= 2020 && y <= 2100;
        preview.innerHTML = valid ? `<i class="bi bi-info-circle"></i> School Year <b>${yearLabelFor(y)}</b>` : `<i class="bi bi-exclamation-circle"></i> Enter a year between 2020 and 2100.`;
        save.disabled = !valid || years.some(x => x.startYear === y);
        if (valid && save.disabled) preview.innerHTML = `<i class="bi bi-exclamation-circle"></i> ${yearLabelFor(y)} already exists.`;
    };
    d.body.append(label, input, preview);
    d.button("Cancel", "cancel", d.close);
    const save = d.button('<i class="bi bi-plus-lg"></i> Create', "primary", async () => {
        const y = Number(input.value);
        d.close();
        await run(() => createYear(y), "School year created", `School year ${yearLabelFor(y)} was created. Start it from View School Years when classes begin.`);
    });
    input.addEventListener("input", sync);
    sync();
    input.focus();
}

async function openStart(year) {
    const running = activeYear(years);
    if (running) return notify("End the current year first", `School year ${running.label} is still active. End it first, then start ${year.label}.`, false);
    const previous = years.filter(y => y.id !== year.id && (y.status === "completed" || y.status === "archived"))[0] || null;
    const firstEver = !years.some(y => y.id !== year.id && y.status !== "upcoming");
    const unassigned = sectionDocs.filter(s => !s.schoolYearId).length;
    const d = dialog({ icon: "bi-play-circle", title: `Start School Year ${year.label}`, intro: "This becomes the active academic year. Teachers will see this year's sections only." });
    const options = document.createElement("div");
    options.className = "sy-options";
    let reuse = null, keep = null;
    if (firstEver && unassigned) {
        options.append(text("p", `The ${unassigned} section(s) you already have will be placed under ${year.label}. Their students and records stay exactly as they are.`, "sa-section-alert"));
    }
    if (previous && sectionsOf(previous.id).length) {
        const row = (labelText, checked) => {
            const l = document.createElement("label"); l.className = "sy-check";
            const c = document.createElement("input"); c.type = "checkbox"; c.checked = checked;
            l.append(c, text("span", labelText)); options.append(l); return c;
        };
        reuse = row(`Create the same section names as ${previous.label} (${sectionsOf(previous.id).map(s => s.name).join(", ")}). They start empty; last year's records stay in ${previous.label}.`, true);
        keep = row("Keep each teacher on the same section names. You can change this in Step 2.", false);
        reuse.addEventListener("change", () => { keep.disabled = !reuse.checked; if (!reuse.checked) keep.checked = false; });
    }
    d.body.append(options);
    d.button("Cancel", "cancel", d.close);
    d.button('<i class="bi bi-play-fill"></i> Start School Year', "primary", async () => {
        const opts = { reuseFrom: reuse?.checked ? previous : null, keepTeachers: !!keep?.checked };
        d.close();
        loading(true);
        try {
            const message = await startYear(year, opts);
            loading(false);
            notify("School year started", message);
        } catch (error) {
            loading(false);
            console.error("[School years]", error);
            notify("Not started", error?.message || "The school year could not be started.", false);
        }
    });
}

async function openEnd(year) {
    const count = sectionsOf(year.id).length;
    const ok = await confirmDialog({
        title: `End School Year ${year.label}?`,
        intro: "Read what happens before you continue.",
        icon: "bi-flag", danger: true, confirmLabel: '<i class="bi bi-flag-fill"></i> End School Year',
        points: [
            ["bi-check2-circle", `The year is marked Completed. Its ${count} section(s) become history.`],
            ["bi-lock", "No new students, level codes or section changes can be made under this year."],
            ["bi-shield-check", "Nothing is deleted: student and teacher accounts, game progress, time spent, wrong attempts and data analysis are all kept."],
            ["bi-people", "Each section keeps a record of its teachers and students for this year."],
            ["bi-arrow-right-circle", "Teachers see no sections until you start the next school year and assign them."]
        ]
    });
    if (ok) await run(() => endYear(year), "School year completed");
}

async function openArchive(year) {
    const ok = await confirmDialog({
        title: `Archive School Year ${year.label}?`,
        intro: "Archived years are hidden from the main list but stay viewable. No records are moved or deleted.",
        icon: "bi-archive", confirmLabel: '<i class="bi bi-archive"></i> Archive'
    });
    if (ok) await run(() => archiveYear(year), "School year archived", `School year ${year.label} is archived. Its data is still available in Students.`);
}

function openList() {
    const d = dialog({ icon: "bi-calendar3", title: "School Years", intro: "Current and previous academic years. Ending a year keeps all of its records.", wide: true });
    const list = document.createElement("div");
    list.className = "sy-list";
    const showArchived = document.createElement("label");
    showArchived.className = "sy-check sy-inline";
    const toggle = document.createElement("input"); toggle.type = "checkbox";
    showArchived.append(toggle, text("span", "Show archived years"));
    const render = () => {
        list.replaceChildren();
        const shown = years.filter(y => toggle.checked || y.status !== "archived");
        if (!shown.length) {
            list.append(text("div", years.length ? "No school years to show." : "No school years yet. Use Create School Year to add the first one.", "sa-section-empty"));
            return;
        }
        for (const y of shown) {
            const row = document.createElement("article");
            row.className = "sy-row";
            const info = document.createElement("div");
            const title = document.createElement("div");
            title.className = "sy-row-title";
            title.append(text("strong", `S.Y. ${y.label}`), text("span", STATUS_LABEL[y.status] || y.status, `sy-status sy-${y.status}`));
            const sections = sectionsOf(y.id);
            const facts = [
                `${sections.length} section${sections.length === 1 ? "" : "s"}`,
                y.summary?.students != null ? `${y.summary.students} student record(s)` : "",
                y.activatedAt ? `started ${when(y.activatedAt)}` : y.createdAt ? `created ${when(y.createdAt)}` : "",
                y.completedAt ? `ended ${when(y.completedAt)}` : "",
                y.archivedAt ? `archived ${when(y.archivedAt)}` : ""
            ].filter(Boolean).join(" · ");
            info.append(title, text("small", facts));
            if (sections.length) info.append(text("small", sections.map(s => s.name).join(", "), "sy-row-sections"));
            const buttons = document.createElement("div");
            buttons.className = "sy-row-actions";
            const add = (label, kind, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = kind; b.innerHTML = label; b.addEventListener("click", () => { d.close(); fn(); }); buttons.append(b); };
            if (y.status === "upcoming") {
                add('<i class="bi bi-play-fill"></i> Start', "sa-section-primary", () => openStart(y));
                if (!sections.length) add("Remove", "sa-section-cancel", async () => {
                    if (await confirmDialog({ title: `Remove ${y.label}?`, intro: "This school year has not started and has no sections or records.", confirmLabel: "Remove", danger: true }))
                        await run(() => removeUnstartedYear(y), "School year removed", `${y.label} was removed.`);
                });
            }
            if (y.status === "active") add('<i class="bi bi-flag"></i> End school year', "sa-section-danger", () => openEnd(y));
            if (y.status === "completed") add('<i class="bi bi-archive"></i> Archive', "sa-section-cancel", () => openArchive(y));
            if (y.status !== "upcoming") {
                const a = document.createElement("a");
                a.className = "sa-section-cancel sy-link";
                a.href = `StudentsList.html?year=${encodeURIComponent(y.id)}`;
                a.innerHTML = '<i class="bi bi-bar-chart"></i> View data';
                buttons.append(a);
            }
            row.append(info, buttons);
            list.append(row);
        }
    };
    toggle.addEventListener("change", render);
    d.body.append(showArchived, list);
    d.button('<i class="bi bi-plus-lg"></i> Create School Year', "cancel", () => { d.close(); openCreate(); });
    d.button("Close", "primary", d.close);
    render();
}

async function openMove() {
    const active = activeYear(years);
    if (!active) return notify("No active school year", "Start the new school year first. Students can only be moved into the active year.", false);
    const targets = sectionsOf(active.id);
    const sources = sectionDocs.filter(s => sectionYearId(s, years) !== active.id)
        .map(s => ({ ...s, yearId: sectionYearId(s, years) }))
        .sort((a, b) => String(b.yearId).localeCompare(String(a.yearId)) || String(a.name).localeCompare(String(b.name)));
    if (!targets.length) return notify("No sections in this year", `Add a section for ${active.label} first (Manage Sections > Add Section).`, false);
    if (!sources.length) return notify("No previous sections", "There are no sections from earlier school years to move students from. New students are added by their teacher on the Students page.", false);

    const d = dialog({ icon: "bi-arrow-up-right-circle", title: `Move Students into ${active.label}`, intro: "Assign returning students to their new section, or promote them (e.g. Grade 11 to Grade 12). Their old records stay with the old year.", wide: true });
    const grid = document.createElement("div");
    grid.className = "sy-move-grid";
    const select = (labelText, options) => {
        const wrap = document.createElement("label"); wrap.className = "sa-section-input-label";
        wrap.append(labelText);
        const s = document.createElement("select"); s.className = "sy-input";
        options.forEach(([value, label]) => s.add(new Option(label, value)));
        wrap.append(s); grid.append(wrap); return s;
    };
    const yearName = id => years.find(y => y.id === id)?.label || "earlier";
    const from = select("FROM (PREVIOUS YEAR)", sources.map(s => [s.id, `${s.name} · S.Y. ${yearName(s.yearId)}`]));
    const to = select(`TO (S.Y. ${active.label})`, targets.map(s => [s.id, s.name]));
    const grade = select("GRADE LEVEL", [["", "Keep as is"], ["Grade 11", "Grade 11"], ["Grade 12", "Grade 12 (promote)"]]);
    const bar = document.createElement("div");
    bar.className = "sa-section-listbar";
    const allBox = document.createElement("input"); allBox.type = "checkbox";
    const allLabel = document.createElement("label"); allLabel.className = "sa-section-selectall"; allLabel.append(allBox, " Select all");
    const counter = text("small", "0 selected");
    bar.append(text("b", "Students"), counter, allLabel);
    const list = document.createElement("div");
    list.className = "sa-section-options sy-students";
    d.body.append(grid, bar, list, text("p", "Each moved student keeps the same account and password and starts the new year with a fresh record. Their old game data stays in the previous year for data analysis.", "sa-section-input-help"));

    let rows = [];
    const sync = () => {
        const checks = [...list.querySelectorAll("input:not(:disabled)")];
        const n = checks.filter(c => c.checked).length;
        counter.textContent = `${n} selected`;
        allBox.checked = !!checks.length && n === checks.length;
        allBox.indeterminate = n > 0 && n < checks.length;
        moveBtn.disabled = !n;
    };
    const load = async () => {
        list.replaceChildren(text("div", "Loading students…", "sa-section-loading"));
        const snap = await getDocs(collection(db, "sections", from.value, "classList"));
        const inTarget = new Set((await getDocs(collection(db, "sections", to.value, "classList"))).docs.map(x => x.id));
        rows = snap.docs.map(x => ({ docId: x.id, ...x.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        list.replaceChildren();
        if (!rows.length) list.append(text("div", "No students in this section.", "sa-section-empty"));
        for (const r of rows) {
            const l = document.createElement("label");
            const c = document.createElement("input"); c.type = "checkbox"; c.value = r.docId;
            const reason = r.movedTo ? `already moved to ${r.movedTo.sectionName || "a new section"}` : inTarget.has(r.docId) ? "already in that section" : "";
            c.disabled = !!reason;
            l.append(c, text("span", `${r.name || "Unnamed"} · ${r.id ?? r.docId}`));
            if (reason) l.append(text("small", reason, "sy-muted"));
            list.append(l);
        }
        sync();
    };
    allBox.addEventListener("change", () => { list.querySelectorAll("input:not(:disabled)").forEach(c => { c.checked = allBox.checked; }); sync(); });
    list.addEventListener("change", sync);
    from.addEventListener("change", load);
    to.addEventListener("change", load);

    d.button("Cancel", "cancel", d.close);
    const moveBtn = d.button('<i class="bi bi-arrow-right"></i> Move Selected', "primary", async () => {
        const ids = [...list.querySelectorAll("input:checked:not(:disabled)")].map(c => c.value);
        const fromSection = sources.find(s => s.id === from.value);
        const toSection = targets.find(s => s.id === to.value);
        const ok = await confirmDialog({
            title: `Move ${ids.length} student(s) to ${toSection.name}?`,
            intro: `From ${fromSection.name} (S.Y. ${yearName(fromSection.yearId)}) to ${toSection.name} (S.Y. ${active.label})${grade.value ? `, as ${grade.value}` : ""}.`,
            confirmLabel: "Yes, move them", icon: "bi-arrow-up-right-circle",
            points: [
                ["bi-person-check", "Same account: same email, password and sign-in. No second account is made."],
                ["bi-clock-history", `Their ${yearName(fromSection.yearId)} game progress, time and errors stay in ${fromSection.name} as history.`],
                ["bi-stars", `They start ${active.label} with a fresh record in ${toSection.name}.`]
            ]
        });
        if (!ok) return;
        loading(true);
        const skipped = [];
        let moved = 0;
        for (const id of ids) {
            try {
                const reason = await moveStudent(fromSection, id, toSection, grade.value, active);
                if (reason) skipped.push(`${id}: ${reason}`); else moved++;
            } catch (error) {
                console.error("[School years] move failed", id, error);
                skipped.push(`${id}: ${error?.code === "permission-denied" ? "permission denied" : error?.message || "failed"}`);
            }
        }
        loading(false);
        await load();
        notify(skipped.length ? "Some students were not moved" : "Students moved",
            `${moved} student(s) moved to ${toSection.name}.` + (skipped.length ? ` Not moved: ${skipped.join("; ")}.` : ""), !skipped.length || moved > 0);
    });
    moveBtn.disabled = true;
    try { await load(); } catch (error) { console.error(error); list.replaceChildren(text("div", "Students could not be loaded. Check the connection.", "sa-section-empty")); }
}

// ---------------------------------------------------------------- page wiring
function renderBadge() {
    const badge = $("syActiveBadge");
    const active = activeYear(years);
    if (badge) {
        badge.hidden = !years.length;
        badge.className = "sy-badge " + (active ? "sy-active" : "sy-none");
        badge.innerHTML = active ? `<i class="bi bi-calendar-check"></i> S.Y. ${active.label}` : '<i class="bi bi-calendar-x"></i> No active school year';
    }
    const step2 = $("syStep2Year");
    if (step2) step2.textContent = active ? `Assignments for School Year ${active.label}.` : years.length ? "No school year is active, so assignments are paused." : "";
}

$("syCreateBtn")?.addEventListener("click", openCreate);
$("syViewBtn")?.addEventListener("click", openList);
$("syMoveBtn")?.addEventListener("click", () => openMove());

watchSchoolYears(db, list => { years = list; renderBadge(); });
onSnapshot(collection(db, "sections"), snap => { sectionDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })); },
    error => console.error("[School years] sections", error));
onSnapshot(collection(db, "approvedUsers"), snap => { teachers = snap.docs.map(d => ({ id: d.id, ...d.data() })); },
    error => console.error("[School years] teachers", error));
