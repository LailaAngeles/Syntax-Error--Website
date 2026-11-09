// Manage School Years (Super Admin): create, start, end and archive school years from the panel on
// Teachers & Sections. Students are Grade 12, so nobody is carried into another school year.
//
// What each action writes (nothing is ever deleted):
//   Create  -> schoolYears/{SY2026-2027} with status "upcoming".
//   Start   -> status "active". The first time, sections made before school years existed are put
//              under this year (schoolYearId). Optionally re-creates last year's section names as new,
//              empty sections, and keeps teachers on the same names.
//   End     -> each section of the year keeps a copy of its teachers (teachers) and student count;
//              each teacher keeps the year's assignment (sectionsByYear.{year}); then status "completed".
//              The year moves to "Past school years", where its student details stay. It is never
//              deleted automatically; only the Super Admin can delete it (Delete permanently).
//   Remove  -> only for a year that never started and has no sections: status "archived" + removedAt +
//              expiresAt (7 days). It appears in the Archived list with Restore. If not restored in
//              7 days, the page deletes it.
//   Restore -> an archived year returns to "Not started" (if it was removed) or to "Past school years".
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, deleteDoc, onSnapshot, runTransaction, writeBatch,
    serverTimestamp, deleteField, Timestamp
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

let years = [];
let sectionDocs = [];   // [{ id, ...data }] of every section, all years
let teachers = [];      // [{ id, ...data }] of approvedUsers

const ARCHIVE_DAYS = 7;
const DAY_MS = 86400000;
// When a removed school year is deleted automatically (7 days after it was removed).
const expiryMillis = y => {
    if (y.expiresAt?.toMillis) return y.expiresAt.toMillis();
    const removed = y.removedAt?.toMillis?.();
    return removed ? removed + ARCHIVE_DAYS * DAY_MS : null;
};

const $ = id => document.getElementById(id);
const loading = show => { const el = $("loading-overlay"); if (el) el.style.display = show ? "flex" : "none"; };
const text = (tag, value, className) => { const el = document.createElement(tag); if (className) el.className = className; el.textContent = value; return el; };
const when = value => { const d = value?.toDate?.() ?? (value ? new Date(value) : null); return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : ""; };
const sectionsOf = yearId => sectionDocs.filter(s => sectionYearId(s, years) === yearId).sort((a, b) => String(a.name).localeCompare(String(b.name)));
const sectionList = value => (Array.isArray(value) ? value : [value]).filter(s => typeof s === "string" && s.trim() && s !== "No Section");

// ---------------------------------------------------------------- dialogs
function dialog({ icon = "bi-calendar3", eyebrow = "MANAGE SCHOOL YEARS", title, intro, danger = false }) {
    const overlay = document.createElement("div");
    overlay.className = "modal sy-modal";
    const box = document.createElement("div");
    box.className = "modal-box sa-section-dialog sy-dialog";
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
    overlay.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
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
        const existing = await tx.get(ref);
        if (existing.exists() && existing.data().removedAt) throw new Error(`School year ${yearLabelFor(startYear)} was removed earlier. It stays in the Archived list and cannot be created again.`);
        if (existing.exists()) throw new Error(`School year ${yearLabelFor(startYear)} already exists.`);
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
        " Assign teachers under Current teachers. Teachers add their students on the Students page.";
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

// Remove keeps the record for 7 days in the Archived list, so it can be restored. Then it is deleted.
async function removeUnstartedYear(year) {
    if (sectionsOf(year.id).length) throw new Error("This school year already has sections, so it cannot be removed.");
    await runTransaction(db, async tx => {
        const ref = doc(db, "schoolYears", year.id);
        const snap = await tx.get(ref);
        if (snap.data()?.status !== "upcoming") throw new Error("Only a school year that has not started can be removed.");
        const now = Date.now();
        tx.update(ref, { status: "archived", removedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + ARCHIVE_DAYS * DAY_MS) });
    });
}

// Restore an archived year: a removed one returns to Not started, an older archived one to Past school years.
async function restoreYear(year) {
    const ref = doc(db, "schoolYears", year.id);
    let back = "";
    await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!snap.exists() || data.status !== "archived") throw new Error("Only an archived school year can be restored.");
        if (data.removedAt) {
            back = "Not started";
            tx.update(ref, { status: "upcoming", removedAt: deleteField(), expiresAt: deleteField(), restoredAt: serverTimestamp() });
        } else {
            back = "Past school years";
            tx.update(ref, { status: "completed", archivedAt: deleteField(), restoredAt: serverTimestamp() });
        }
    });
    return `School year ${year.label} was restored. It is now under ${back}.`;
}

// Deletes removed years whose 7 days have passed. Runs when the panel loads and after each change.
const purgeFailed = new Set();
let purging = false;
async function purgeExpiredRemovedYears() {
    if (purging) return;
    purging = true;
    try {
        const now = Date.now();
        for (const y of years) {
            const expiry = expiryMillis(y);
            if (y.status !== "archived" || !y.removedAt || expiry === null || expiry > now || purgeFailed.has(y.id)) continue;
            try {
                await deleteDoc(doc(db, "schoolYears", y.id));
            } catch (error) {
                purgeFailed.add(y.id);
                console.warn("[School years] Could not delete expired removed year", y.id, error);
            }
        }
    } finally {
        purging = false;
    }
}

// Firestore batches hold at most 500 operations.
async function deleteRefs(refs) {
    for (let i = 0; i < refs.length; i += 450) {
        const batch = writeBatch(db);
        refs.slice(i, i + 450).forEach(ref => batch.delete(ref));
        await batch.commit();
    }
}

// Permanently deletes an ended school year: its sections, their student records (classList) and the year itself.
// The year record is deleted last, so a failed attempt can be retried from the same card.
async function deletePastYear(year) {
    const latest = await getDoc(doc(db, "schoolYears", year.id));
    if (latest.data()?.status !== "completed") throw new Error("Only an ended (past) school year can be deleted here.");
    const secs = sectionsOf(year.id);
    for (const s of secs) {
        const students = (await getDocs(collection(db, "sections", s.id, "classList"))).docs.map(d => d.ref);
        await deleteRefs(students);
        await deleteRefs([doc(db, "sections", s.id)]);
    }
    const teacherWrites = teachers
        .filter(t => t.sectionsByYear && Object.prototype.hasOwnProperty.call(t.sectionsByYear, year.id))
        .map(t => [doc(db, "approvedUsers", t.id), { [`sectionsByYear.${year.id}`]: deleteField() }]);
    await commitInChunks(teacherWrites);
    await deleteRefs([doc(db, "schoolYears", year.id)]);
    return `School year ${year.label} was permanently deleted, with ${secs.length} section(s) and their student records.`;
}

// ---------------------------------------------------------------- screens
// "2026-2027", "2026–2027" or just "2026" -> 2026. Returns null if it is not a valid school year.
function parseYearName(value) {
    const match = String(value).trim().match(/^(\d{4})(?:\s*[-–—/]\s*(\d{4}))?$/);
    if (!match) return null;
    const start = Number(match[1]);
    if (match[2] && Number(match[2]) !== start + 1) return null;
    return start >= 2020 && start <= 2100 ? start : null;
}

function openCreate() {
    const suggested = years[0]?.startYear ? years[0].startYear + 1 : new Date().getFullYear();
    const d = dialog({ icon: "bi-calendar-plus", title: "Add School Year", intro: "It is saved as Not started. Start it when classes begin." });
    const label = text("label", "SCHOOL YEAR NAME", "sa-section-input-label");
    const input = document.createElement("input");
    input.type = "text"; input.value = yearLabelFor(suggested); input.className = "sy-input"; input.autocomplete = "off"; input.placeholder = "e.g. 2026–2027";
    label.htmlFor = input.id = "syNameInput";
    const message = text("p", "", "sy-field-note");
    message.id = "syNameNote";
    input.setAttribute("aria-describedby", message.id);
    const facts = document.createElement("dl");
    facts.className = "sy-year-facts";
    facts.innerHTML = '<div><dt>Start of school year</dt><dd id="syFactStart">--</dd></div><div><dt>End of school year</dt><dd id="syFactEnd">--</dd></div>';
    d.body.append(label, input, message, facts);
    d.button("Cancel", "cancel", d.close);
    const save = d.button('<i class="bi bi-check-lg"></i> Create School Year', "primary", async () => {
        const start = parseYearName(input.value);
        if (start === null || years.some(y => y.startYear === start)) return;
        d.close();
        await run(() => createYear(start), "School year created", `School year ${yearLabelFor(start)} was added. Select Start on its card when classes begin.`);
    });
    const sync = () => {
        const start = parseYearName(input.value);
        const taken = start !== null && years.some(y => y.startYear === start);
        const problem = !input.value.trim() ? "Enter the school year, for example 2026–2027."
            : start === null ? "Use two back-to-back years between 2020 and 2101, for example 2026–2027."
            : taken ? `School year ${yearLabelFor(start)} already exists.` : "";
        facts.querySelector("#syFactStart").textContent = start === null ? "--" : String(start);
        facts.querySelector("#syFactEnd").textContent = start === null ? "--" : String(start + 1);
        message.textContent = problem;
        message.hidden = !problem;
        input.classList.toggle("is-invalid", !!problem);
        input.setAttribute("aria-invalid", problem ? "true" : "false");
        save.disabled = !!problem;
    };
    input.addEventListener("input", sync);
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !save.disabled) save.click(); });
    sync();
    input.focus();
    input.select();
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
        keep = row("Keep each teacher on the same section names. You can change this under Current teachers.", false);
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

// Second step: the school year's name must be typed, so a stray click can never end it.
const sameYearName = (a, b) => String(a).trim().replace(/[-–—]/g, "-") === String(b).trim().replace(/[-–—]/g, "-");
function confirmTypedYear(year) {
    return new Promise(resolve => {
        const d = dialog({ icon: "bi-exclamation-octagon", title: `Final step: end ${year.label}`, intro: "Type the school year name to confirm.", danger: true });
        const label = text("label", `TYPE ${year.label} BELOW`, "sa-section-input-label");
        const input = document.createElement("input");
        input.type = "text"; input.className = "sy-input"; input.autocomplete = "off"; input.placeholder = year.label;
        label.htmlFor = input.id = "syEndConfirmInput";
        d.body.append(label, input);
        const done = value => { d.close(); resolve(value); };
        d.button("Cancel", "cancel", () => done(false));
        const end = d.button('<i class="bi bi-flag-fill"></i> End School Year', "danger", () => done(true));
        const sync = () => { end.disabled = !sameYearName(input.value, year.label); };
        input.addEventListener("input", sync);
        input.addEventListener("keydown", e => { if (e.key === "Enter" && !end.disabled) end.click(); });
        d.overlay.addEventListener("keydown", e => { if (e.key === "Escape") resolve(false); });
        sync();
        input.focus();
    });
}

let endingYear = false;
async function openEnd(year) {
    if (endingYear) return;
    const count = sectionsOf(year.id).length;
    const proceed = await confirmDialog({
        title: `End School Year ${year.label}?`,
        intro: "Read what happens before you continue.",
        icon: "bi-flag", danger: true, confirmLabel: 'Continue <i class="bi bi-arrow-right"></i>',
        points: [
            ["bi-check2-circle", `The year moves to Past school years. Its ${count} section(s) become history.`],
            ["bi-lock", "No new students, level codes or section changes can be made under this year."],
            ["bi-shield-check", "Nothing is deleted: student and teacher accounts, game progress, time spent, incorrect submissions and data analysis are all kept. The year is kept until you delete it yourself."],
            ["bi-people", "Each section keeps a record of its teachers and students for this year."],
            ["bi-arrow-right-circle", "Teachers see no sections until you start the next school year and assign them."]
        ]
    });
    if (!proceed || !(await confirmTypedYear(year))) return;
    endingYear = true;
    renderYears();
    try {
        await run(() => endYear(year), "School year completed");
    } finally {
        endingYear = false;
        renderYears();
    }
}

async function openRestore(year) {
    const removed = !!year.removedAt;
    const ok = await confirmDialog({
        title: `Restore School Year ${year.label}?`,
        intro: removed ? "It returns to Not started. You can start it when classes begin." : "It returns to Past school years, with its student details.",
        icon: "bi-arrow-counterclockwise", confirmLabel: '<i class="bi bi-arrow-counterclockwise"></i> Restore'
    });
    if (ok) await run(() => restoreYear(year));
}

// Second step for a permanent delete: the school year's name must be typed.
function confirmPermanentDelete(year) {
    return new Promise(resolve => {
        const count = sectionsOf(year.id).length;
        const students = year.summary?.students;
        const d = dialog({ icon: "bi-trash3", title: `Delete ${year.label} permanently?`, intro: "This cannot be undone. Type the school year name to confirm.", danger: true });
        d.body.append(text("p", `Deletes ${count} section(s)${students != null ? ` and ${students} student record(s)` : " and all student records kept for this year"}. Teacher and student accounts are not deleted.`, "sy-field-note"));
        const label = text("label", `TYPE ${year.label} BELOW`, "sa-section-input-label");
        const input = document.createElement("input");
        input.type = "text"; input.className = "sy-input"; input.autocomplete = "off"; input.placeholder = year.label;
        label.htmlFor = input.id = "syDeleteConfirmInput";
        d.body.append(label, input);
        const done = value => { d.close(); resolve(value); };
        d.button("Cancel", "cancel", () => done(false));
        const del = d.button('<i class="bi bi-trash3"></i> Delete permanently', "danger", () => done(true));
        const sync = () => { del.disabled = !sameYearName(input.value, year.label); };
        input.addEventListener("input", sync);
        input.addEventListener("keydown", e => { if (e.key === "Enter" && !del.disabled) del.click(); });
        sync();
        input.focus();
    });
}

async function openDeletePast(year) {
    if (!(await confirmPermanentDelete(year))) return;
    await run(() => deletePastYear(year), "School year deleted");
}

// ---------------------------------------------------------------- the panel
function yearCard(y) {
    const row = document.createElement("article");
    row.className = "sy-row" + (y.status === "active" ? " sy-row-active" : "");
    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "sy-row-title";
    const removed = y.status === "archived" && !!y.removedAt;
    title.append(text("strong", `S.Y. ${y.label}`), text("span", removed ? "Removed" : (STATUS_LABEL[y.status] || y.status), `sy-status sy-${y.status}`));
    const sections = sectionsOf(y.id);
    const names = new Set(sections.map(s => s.name));
    const teacherCount = y.status === "active" ? teachers.filter(t => sectionList(t.section).some(n => names.has(n))).length : null;
    const facts = [
        `${sections.length} section${sections.length === 1 ? "" : "s"}`,
        teacherCount != null ? `${teacherCount} teacher${teacherCount === 1 ? "" : "s"} assigned` : "",
        y.summary?.students != null ? `${y.summary.students} student record(s)` : "",
        y.activatedAt ? `started ${when(y.activatedAt)}` : y.createdAt ? `created ${when(y.createdAt)}` : "",
        y.completedAt ? `ended ${when(y.completedAt)}` : "",
        y.removedAt ? `removed ${when(y.removedAt)} before it started` : "",
        removed && expiryMillis(y) !== null ? `deleted on ${new Date(expiryMillis(y)).toLocaleDateString()} unless restored` : ""
    ].filter(Boolean).join(" · ");
    info.append(title, text("small", facts));
    if (sections.length) info.append(text("small", sections.map(s => s.name).join(", "), "sy-row-sections"));
    const buttons = document.createElement("div");
    buttons.className = "sy-row-actions";
    const add = (label, kind, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = kind; b.innerHTML = label; b.addEventListener("click", fn); buttons.append(b); };
    // An archived year can be restored; an ended year is kept until the Super Admin deletes it.
    if (y.status === "upcoming") {
        add('<i class="bi bi-play-fill"></i> Start', "sa-section-primary", () => openStart(y));
        if (!sections.length) add("Remove", "sa-section-cancel", async () => {
            if (await confirmDialog({ title: `Remove ${y.label}?`, intro: "This school year has not started and has no sections or records. It will move to the Archived list as Removed, where it stays visible. It cannot be started afterwards.", confirmLabel: "Remove", danger: true }))
                await run(() => removeUnstartedYear(y), "School year removed", `${y.label} was removed.`);
        });
    }
    if (y.status === "active") {
        add(endingYear ? "Ending..." : '<i class="bi bi-exclamation-triangle-fill"></i> End School Year', "sy-end-btn", () => openEnd(y));
        if (endingYear) buttons.lastElementChild.disabled = true;
    }
    if (y.status === "archived") add('<i class="bi bi-arrow-counterclockwise"></i> Restore', "sa-section-primary", () => openRestore(y));
    if (y.status === "completed") add('<i class="bi bi-trash3"></i> Delete permanently', "sa-section-danger", () => openDeletePast(y));
    if (y.status !== "upcoming" && !removed) {
        const a = document.createElement("a");
        a.className = "sa-section-cancel sy-link";
        a.href = `StudentsList.html?year=${encodeURIComponent(y.id)}`;
        a.innerHTML = '<i class="bi bi-bar-chart"></i> View data';
        buttons.append(a);
    }
    row.append(info, buttons);
    return row;
}

function renderYears() {
    const activeBox = $("syActiveCard");
    if (!activeBox) return;
    const active = activeYear(years);
    activeBox.replaceChildren(active ? yearCard(active) : text("p",
        years.length ? "No school year is active. Teachers see no sections until you start one." : "No school years yet. Select Add School Year to create the first one.", "sy-no-active"));
    const notStarted = years.filter(y => y.status === "upcoming");
    $("syYearList").replaceChildren(...notStarted.map(yearCard));
    $("syOtherWrap").hidden = !notStarted.length;
    const past = years.filter(y => y.status === "completed");
    $("syPastList").replaceChildren(...past.map(yearCard));
    $("syPastWrap").hidden = !past.length;
    const archived = years.filter(y => y.status === "archived");
    $("syArchiveList").replaceChildren(...(archived.length ? archived.map(yearCard) : [text("p", "Nothing archived. A removed school year stays here for 7 days so you can restore it.", "sy-no-active")]));
    $("syArchiveCount").textContent = String(archived.length);
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
    const note = $("syAssignYear");
    if (note) note.textContent = active ? `Assignments for School Year ${active.label}.` : years.length ? "No school year is active, so assignments are paused." : "";
}

$("syCreateBtn")?.addEventListener("click", openCreate);

watchSchoolYears(db, list => { years = list; renderBadge(); renderYears(); purgeExpiredRemovedYears(); });
onSnapshot(collection(db, "sections"), snap => { sectionDocs = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderYears(); },
    error => console.error("[School years] sections", error));
onSnapshot(collection(db, "approvedUsers"), snap => { teachers = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderYears(); },
    error => console.error("[School years] teachers", error));
