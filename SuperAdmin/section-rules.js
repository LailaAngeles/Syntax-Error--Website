// Section assignment rules: one section = one teacher.
// Pure functions with no imports, so they can be tested without Firebase.
//
// A teacher's sections are the names stored in approvedUsers/{uid}.section (the same field the
// Current teachers table shows). Section names are unique within the active school year, so a name
// identifies the section while that year is active.

export const NO_SECTION = "No Section";

export class SectionConflictError extends Error {
    constructor(conflicts) {
        const list = conflicts.map(c => `${c.section} is already assigned to ${c.teacher}`).join("; ");
        super(`${list}. Remove it from that teacher first, or choose a different section.`);
        this.name = "SectionConflictError";
        this.code = "section-already-assigned";
        this.conflicts = conflicts;
    }
}

export const isSectionConflict = error => error?.code === "section-already-assigned";

// Real section names a teacher record holds ("No Section" is only a placeholder).
export function sectionsOf(data) {
    return (Array.isArray(data?.section) ? data.section : []).filter(n => n && n !== NO_SECTION);
}

// entries: [{ id, data }] for teacher records.
// Returns Map: section name -> [{ uid, name }] of every teacher record that holds it.
export function sectionHolders(entries) {
    const holders = new Map();
    for (const { id, data } of entries) {
        for (const name of sectionsOf(data)) {
            if (!holders.has(name)) holders.set(name, []);
            holders.get(name).push({ uid: id, name: data?.name || data?.email || "another teacher" });
        }
    }
    return holders;
}

// Teachers other than `uid` who hold `name`. Pass uid = null for a teacher not yet saved.
export function heldByOthers(holders, name, uid = null) {
    return (holders.get(name) || []).filter(h => h.uid !== uid);
}

// Decides what a teacher's section list may become.
// Only sections being ADDED are checked. A section the teacher already holds is never blocked, so a
// teacher who keeps (or edits) their own sections is never rejected, even if old data had a duplicate.
// entries: every teacher record [{ id, data }], read in the same transaction as the write.
// Returns the update to write, or throws SectionConflictError.
export function planTeacherSections({ uid, entries, names, yearId = null }) {
    const target = entries.find(e => e.id === uid);
    if (!target) throw new Error("This teacher's record could not be found. Refresh the page and try again.");

    const chosen = [...new Set(names.filter(n => n && n !== NO_SECTION))];
    const current = new Set(sectionsOf(target.data));
    const added = chosen.filter(n => !current.has(n));

    const holders = sectionHolders(entries.filter(e => e.id !== uid));
    const conflicts = added
        .filter(n => holders.has(n))
        .map(n => ({ section: n, teacher: holders.get(n)[0].name }));
    if (conflicts.length) throw new SectionConflictError(conflicts);

    const update = { section: chosen.length ? chosen : [NO_SECTION] };
    if (yearId) update[`sectionsByYear.${yearId}`] = chosen;
    return update;
}
