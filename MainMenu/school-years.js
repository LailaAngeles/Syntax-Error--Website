// School years: shared rules for the teacher pages and the Super Admin pages.
//
// Firestore: schoolYears/{SY2026-2027} = { label, startYear, endYear, status, ... }
//   status: "upcoming" (created, not started) -> "active" -> "completed" -> "archived"
// A section belongs to one school year through sections/{id}.schoolYearId. Section names can repeat
// across years (ICT1202 in 2026-2027 and in 2027-2028 are different documents), so records never mix.
// Sections made before school years existed have no schoolYearId; they count as the earliest year.
// Nothing here deletes or rewrites records: ending a year only changes the year's status.
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

export const STATUS_LABEL = { upcoming: "Not started", active: "Active", completed: "Completed", archived: "Archived" };

export const yearIdFor = startYear => `SY${startYear}-${startYear + 1}`;
export const yearLabelFor = startYear => `${startYear}–${startYear + 1}`;

export function toYears(snapshot) {
    const years = [];
    snapshot.forEach(d => years.push({ id: d.id, ...d.data() }));
    return years.sort((a, b) => (b.startYear || 0) - (a.startYear || 0));
}

export const activeYear = years => years.find(y => y.status === "active") || null;
export const earliestYear = years => years.length ? years[years.length - 1] : null;
export const yearById = (years, id) => years.find(y => y.id === id) || null;
export const yearLabel = (years, id) => yearById(years, id)?.label || "Before school years";

// The school year a section belongs to (null only while no school year exists yet).
export function sectionYearId(section, years) {
    return section?.schoolYearId || earliestYear(years)?.id || null;
}

// Sections open for day-to-day work (teacher pages, adding students, level codes, teacher assignments):
// - no school years set up yet: every section, exactly as before;
// - otherwise only the active year's sections. Between years (none active) nothing is open.
export function isCurrentSection(section, years) {
    if (!years.length) return true;
    const active = activeYear(years);
    return !!active && sectionYearId(section, years) === active.id;
}

// Message for teacher pages when school years exist but none is active.
export function closedYearNotice(years) {
    if (!years.length || activeYear(years)) return "";
    const last = years.find(y => y.status === "completed" || y.status === "archived");
    return last
        ? `School year ${last.label} has ended. Your sections for the next school year will appear once the Super Admin starts it. Past records are kept.`
        : "No school year is active yet. Your sections will appear once the Super Admin starts the school year.";
}

// Live list of school years. A read error (e.g. rules not updated yet) behaves like "no school years",
// so pages keep working exactly as before.
export function watchSchoolYears(db, onChange) {
    return onSnapshot(collection(db, "schoolYears"),
        snap => onChange(toYears(snap)),
        error => { console.warn("[SyntaxError] School years could not be read; showing all sections.", error); onChange([]); });
}
