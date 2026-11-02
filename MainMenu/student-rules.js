// Input rules for student records (Add Student, Edit Student, Excel import).
// Each check returns an error message, or "" when the value is valid.

export const MIN_AGE = 16;
export const MAX_AGE = 60;          // catches typing mistakes such as 1905
export const NAME_MAX = 50;
export const FULL_NAME_MAX = 120;

// Letters (including ñ and accented letters), spaces, hyphens, apostrophes and periods.
const NAME_RE = /^[\p{L}][\p{L} .'-]*$/u;

export function cleanSpaces(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function checkStudentNumber(value) {
    const id = String(value ?? '').trim();
    if (!id) return 'Enter the student number.';
    if (!/^\d+$/.test(id)) return 'Use numbers only (no letters, spaces or dashes).';
    if (id.length < 10 || id.length > 11) return `Student numbers have 10 or 11 digits (this one has ${id.length}).`;
    return '';
}

export function checkName(value, label) {
    const name = cleanSpaces(value);
    if (!name) return `Enter the ${label.toLowerCase()}.`;
    if (name.length < 2) return `${label} must have at least 2 letters.`;
    if (name.length > NAME_MAX) return `${label} can have up to ${NAME_MAX} characters.`;
    if (!NAME_RE.test(name)) return `${label} can only use letters, spaces, hyphens (-), apostrophes (') and periods.`;
    return '';
}

// Optional: one letter, with or without a period (e.g. "B" or "B.").
export function checkMiddleInitial(value) {
    const mi = cleanSpaces(value);
    if (!mi) return '';
    if (!/^\p{L}\.?$/u.test(mi)) return 'Use a single letter, for example B.';
    return '';
}
export function formatMiddleInitial(value) {
    const mi = cleanSpaces(value).replace('.', '');
    return mi ? mi.toUpperCase() + '.' : '';
}

// Full name as stored, e.g. "Acabo, Jerick B." (used by Edit and the Excel import).
export function checkFullName(value) {
    const name = cleanSpaces(value);
    if (!name) return 'Enter the full name.';
    if (name.length < 3) return 'Full name is too short.';
    if (name.length > FULL_NAME_MAX) return `Full name can have up to ${FULL_NAME_MAX} characters.`;
    if (!/^[\p{L}][\p{L} .,'-]*$/u.test(name)) return 'Full name can only use letters, spaces, commas, hyphens, apostrophes and periods.';
    return '';
}

export function checkEmail(value) {
    const email = String(value ?? '').trim();
    if (!email) return 'Enter the student email.';
    if (email.length > 100) return 'Email can have up to 100 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Enter a valid email address, for example name@example.com.';
    return '';
}

function ageOn(birthday, today = new Date()) {
    let age = today.getFullYear() - birthday.getFullYear();
    const beforeBirthday = today.getMonth() < birthday.getMonth() ||
        (today.getMonth() === birthday.getMonth() && today.getDate() < birthday.getDate());
    return beforeBirthday ? age - 1 : age;
}

// Birthday as YYYY-MM-DD.
export function checkBirthday(value) {
    const text = String(value ?? '').trim();
    if (!text) return 'Enter the birthday.';
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    if (!date || date.getMonth() !== +m[2] - 1 || date.getDate() !== +m[3]) return 'Enter a real date.';
    const age = ageOn(date);
    if (age < MIN_AGE) return `The student must be at least ${MIN_AGE} years old (this birthday makes them ${Math.max(0, age)}).`;
    if (age > MAX_AGE) return `Please check the year. This birthday makes the student ${age} years old.`;
    return '';
}

// min/max for <input type="date">, so the picker itself blocks dates outside the range.
export function birthdayBounds(today = new Date()) {
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const max = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate());
    const min = new Date(today.getFullYear() - MAX_AGE - 1, today.getMonth(), today.getDate() + 1);
    return { min: iso(min), max: iso(max) };
}

// Shows or clears an error under an input (adds .field-error after it once).
export function showFieldError(input, message) {
    if (!input) return;
    const holder = input.parentElement;
    let note = holder.querySelector('.field-error');
    if (!note) {
        note = document.createElement('small');
        note.className = 'field-error';
        note.setAttribute('role', 'alert');
        input.insertAdjacentElement('afterend', note);
    }
    note.textContent = message || '';
    note.hidden = !message;
    input.classList.toggle('is-invalid', !!message);
    input.setAttribute('aria-invalid', String(!!message));
}
