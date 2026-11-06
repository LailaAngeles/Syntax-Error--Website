// Student search used by the Students page (table search and Reset Password list).
// Matching only: nothing here changes or rewrites a stored student number.
//
// Student numbers are compared as digits with leading zeros removed, so "0200252", "200252" and
// "0200-252" all mean the same student number. A query that is the complete number of a student
// shows only the exact match(es); a shorter number keeps the type-as-you-search behaviour.
// Names and emails match case-insensitively anywhere in the text.

const digitsOnly = value => String(value ?? "").replace(/\D/g, "");

// "0200252" -> "200252". All zeros stays "0" so it is still a number.
export function normalizeStudentNumber(value) {
    const digits = digitsOnly(value);
    if (!digits) return "";
    return digits.replace(/^0+/, "") || "0";
}

// The query is a student number (digits, optionally typed with spaces or dashes).
function numberQuery(term) {
    return /^[\d\s-]+$/.test(term) ? normalizeStudentNumber(term) : "";
}

function textMatch(student, term) {
    return [student?.name, student?.email].some(value => String(value ?? "").toLowerCase().includes(term));
}

// True when the student number is exactly the queried number (leading zeros ignored).
export function isExactStudentNumber(student, rawTerm) {
    const query = numberQuery(String(rawTerm ?? "").trim());
    return !!query && normalizeStudentNumber(student?.id) === query;
}

export function matchesStudentSearch(student, rawTerm) {
    const term = String(rawTerm ?? "").trim().toLowerCase();
    if (!term) return true;
    if (textMatch(student, term)) return true;
    const id = String(student?.id ?? "").toLowerCase();
    if (id.includes(term)) return true;
    const query = numberQuery(term);
    if (!query) return false;
    // Partial numbers match from the start of the number, after its leading zeros.
    return normalizeStudentNumber(id).startsWith(query);
}

// Filters a list. When some students have exactly the searched number, only they are returned, so a
// complete student number never brings up other students whose numbers merely contain it.
export function searchStudents(students, rawTerm, idOf = s => s) {
    const term = String(rawTerm ?? "").trim();
    if (!term) return students;
    const exact = students.filter(item => isExactStudentNumber(idOf(item), term));
    if (exact.length) return exact;
    return students.filter(item => matchesStudentSearch(idOf(item), term));
}
