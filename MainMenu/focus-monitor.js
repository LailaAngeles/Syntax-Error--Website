// Game Activity Monitor (Students page): the times a student left the game while a level was in
// progress (switched app, went to the home screen, lost focus, or closed the game while away).
//
// Where the records come from: the game (AppSwitchWarning + LevelResults.LeftGame + ProgressSync)
// writes one document per interruption to
//     sections/<sectionDocId>/focusEvents/<eventId>
// The document id is the game's event id, so a retried upload rewrites the same document and the
// teacher never sees the same interruption twice. Security rules (firestore-focus-events.rules)
// let a student create only their own records and only the section's teachers read them; this page
// also listens only to the sections assigned to the signed-in teacher.
//
// This is activity monitoring only. A record is not a mistake, not a failed or completed level, and
// it is never labelled as cheating.
import { collection, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const PER_SECTION = 100;
const POPUP_MS = 20000;
const MAX_POPUPS = 4;

export const EVENT_LABELS = {
    app_paused: "Left the game (app sent to background)",
    focus_lost: "Game window lost focus",
    closed_while_away: "Closed the game while away",
    tab_switch: "Switched browser tab",
    window_blur: "Browser window lost focus"
};
const EVENT_SHORT = {
    app_paused: "App paused",
    focus_lost: "Focus lost",
    closed_while_away: "Closed while away",
    tab_switch: "Tab switch",
    window_blur: "Window focus lost"
};

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const toDate = value => value?.toDate ? value.toDate() : value instanceof Date ? value : null;

export function fmtDateTime(date) {
    if (!date) return "--";
    const day = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${day} – ${time}`;
}

export function fmtDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s < 60) return `${s}s`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}h ${m}m` : `${m}m ${r}s`;
}

/**
 * @param {object} o
 * @param {import("firebase/firestore").Firestore} o.db
 * @param {() => string} o.teacherUid         signed-in teacher (unread marker is kept per teacher)
 * @param {(sectionDocId: string, studentDocId: string) => ({name, number, online, completedLevels: Set<number>} | null)} o.describeStudent
 * @param {() => string} o.selectedSection    section name chosen on the page ("" = all)
 */
export function createFocusMonitor({ db, teacherUid, describeStudent, selectedSection, pageLoading = () => false }) {
    const listeners = new Map();   // sectionDocId -> unsubscribe
    const state = new Map();       // sectionDocId -> { name, status: "loading"|"ready"|"error", error, events: Map }
    const els = {
        root: document.getElementById("focus-monitor"),
        list: document.getElementById("focus-monitor-list"),
        count: document.getElementById("focus-monitor-count"),
        badge: document.getElementById("focus-monitor-new"),
        range: document.getElementById("focus-monitor-range"),
        markSeen: document.getElementById("focus-monitor-mark-seen")
    };
    const seenKey = () => `syntaxerror_focus_seen_${teacherUid() || "teacher"}`;
    const readSeen = () => { try { return Number(localStorage.getItem(seenKey())) || 0; } catch { return 0; } };
    let seenAt = 0;
    const notified = new Set();

    els.range?.addEventListener("change", render);
    els.markSeen?.addEventListener("click", () => {
        seenAt = Date.now();
        try { localStorage.setItem(seenKey(), String(seenAt)); } catch { /* private mode: badge resets on reload */ }
        render();
    });

    // Keep exactly one listener per assigned section.
    function sync(wanted) {
        seenAt = readSeen();
        listeners.forEach((stop, id) => {
            if (!wanted.has(id)) { stop(); listeners.delete(id); state.delete(id); }
        });
        wanted.forEach((name, id) => {
            if (state.has(id)) { state.get(id).name = name; return; }
            state.set(id, { name, status: "loading", error: null, events: new Map() });
            let first = true;
            const q = query(collection(db, "sections", id, "focusEvents"), orderBy("leftAt", "desc"), limit(PER_SECTION));
            const stop = onSnapshot(q, snap => {
                const entry = state.get(id);
                if (!entry) return;
                entry.status = "ready";
                entry.error = null;
                const added = [];
                snap.docChanges().forEach(change => {
                    if (change.type === "removed") { entry.events.delete(change.doc.id); return; }
                    const event = normalize(change.doc.id, change.doc.data(), id);
                    entry.events.set(change.doc.id, event);
                    if (!first && change.type === "added") added.push(event);
                });
                first = false;
                render();
                added.forEach(popup);
            }, error => {
                const entry = state.get(id);
                if (!entry) return;
                console.warn(`[Activity monitor] ${name}:`, error?.code || error);
                entry.status = "error";
                entry.error = error?.code || "unknown";
                render();
            });
            listeners.set(id, stop);
        });
        render();
    }

    function stopAll() {
        listeners.forEach(stop => stop());
        listeners.clear();
        state.clear();
    }

    function normalize(id, d, sectionDocId) {
        const left = toDate(d.leftAt);
        const back = toDate(d.returnedAt);
        let secondsAway = Number.isFinite(Number(d.secondsAway)) ? Number(d.secondsAway) : null;
        if (secondsAway === null && left && back) secondsAway = (back - left) / 1000;
        return {
            id, sectionDocId,
            type: String(d.type || ""),
            levelId: Number(d.levelId) || 0,
            levelName: String(d.levelName || ""),
            studentDocId: String(d.studentDocId || ""),
            leftAt: left,
            returnedAt: back,
            returned: d.returned === true || !!back,
            secondsAway,
            awayCount: Number(d.awayCount) || 0,
            syncedAt: toDate(d.syncedAt)
        };
    }

    // Who, which section, which level: always the page's own class list (the teacher's sections).
    function details(event) {
        const sectionName = state.get(event.sectionDocId)?.name || "";
        const student = describeStudent(event.sectionDocId, event.studentDocId);
        return {
            sectionName,
            name: student?.name || "Student not in the class list",
            number: student?.number || event.studentDocId,
            online: !!student?.online,
            levelDone: !!student?.completedLevels?.has(event.levelId)
        };
    }

    const isNew = event => (event.syncedAt || event.leftAt || new Date(0)).getTime() > seenAt;

    function visibleEvents() {
        const section = selectedSection();
        const days = Number(els.range?.value || 7);
        const since = days > 0 ? Date.now() - days * 86400000 : 0;
        const all = [];
        state.forEach(entry => {
            if (section && entry.name !== section) return;
            entry.events.forEach(event => { if (!since || (event.leftAt?.getTime() || 0) >= since) all.push(event); });
        });
        return all.sort((a, b) => (b.leftAt?.getTime() || 0) - (a.leftAt?.getTime() || 0));
    }

    function render() {
        if (!els.list) return;
        const section = selectedSection();
        const entries = [...state.values()].filter(e => !section || e.name === section);
        const events = visibleEvents();
        const unread = events.filter(isNew).length;
        if (els.badge) { els.badge.hidden = !unread; els.badge.textContent = `${unread} new`; }
        if (els.markSeen) els.markSeen.disabled = !unread;
        if (els.count) els.count.textContent = events.length ? `${events.length} record${events.length === 1 ? "" : "s"}` : "";

        const failed = entries.filter(e => e.status === "error");
        const loading = entries.some(e => e.status === "loading");
        if (!entries.length && pageLoading()) {
            els.list.innerHTML = `<p class="fm-state"><span class="da-loading" role="status"><span class="da-spinner" aria-hidden="true"></span> Loading game activity...</span></p>`;
            return;
        }
        if (!entries.length) {
            els.list.innerHTML = `<p class="fm-state">No section to monitor yet. Sections assigned to you for this school year appear here.</p>`;
            return;
        }
        if (!events.length && loading) {
            els.list.innerHTML = `<p class="fm-state"><span class="da-loading" role="status"><span class="da-spinner" aria-hidden="true"></span> Loading game activity...</span></p>`;
            return;
        }
        const errorNote = failed.length ? `<p class="fm-state fm-error" role="alert"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> ${
            failed.some(e => e.error === "permission-denied")
                ? `Game activity for ${esc(failed.map(e => e.name).join(", "))} is blocked by the Firestore security rules. Add the <code>focusEvents</code> block from <code>firestore-focus-events.rules</code> in the Firebase console.`
                : `Game activity for ${esc(failed.map(e => e.name).join(", "))} could not be loaded. Check your connection and refresh the page.`}</p>` : "";
        if (!events.length) {
            els.list.innerHTML = errorNote || `<p class="fm-state fm-empty"><i class="bi bi-shield-check" aria-hidden="true"></i> No student left the game during a level in this period.</p>`;
            return;
        }
        // How many times each student left the game in the selected period.
        const timesLeft = new Map();
        events.forEach(e => {
            const key = `${e.sectionDocId}/${e.studentDocId}`;
            timesLeft.set(key, (timesLeft.get(key) || 0) + 1);
        });
        els.list.innerHTML = errorNote + `
            <div class="table-responsive"><table class="fm-table">
                <thead><tr><th>Student</th><th>Section</th><th>Level</th><th>Event</th><th>Left the game</th><th>Returned / time away</th><th>Session</th></tr></thead>
                <tbody>${events.map(e => row(e, timesLeft.get(`${e.sectionDocId}/${e.studentDocId}`) || 1)).join("")}</tbody>
            </table></div>`;
    }

    function row(event, timesLeft = 1) {
        const d = details(event);
        const away = event.returned
            ? `${esc(event.returnedAt ? fmtDateTime(event.returnedAt) : "Returned")}<small>${event.secondsAway !== null ? `${esc(fmtDuration(event.secondsAway))} away` : ""}</small>`
            : `<span class="fm-pill fm-pill-warn">Did not return</span><small>The game was closed while away</small>`;
        const session = `${d.levelDone ? `<span class="fm-pill fm-pill-done">Level completed</span>` : `<span class="fm-pill fm-pill-active">Level not completed yet</span>`}${
            d.online ? `<small class="fm-online"><span></span> In the game now</small>` : ""}`;
        return `<tr class="${isNew(event) ? "fm-row-new" : ""}">
            <td data-label="Student"><strong>${esc(d.name)}</strong><small>${esc(d.number)}</small><span class="fm-pill fm-pill-warn fm-times" title="Times this student left the game in the selected period">Left ${timesLeft} time${timesLeft === 1 ? "" : "s"}</span></td>
            <td data-label="Section">${esc(d.sectionName)}</td>
            <td data-label="Level"><strong>Level ${esc(event.levelId || "?")}</strong>${event.levelName ? `<small>${esc(event.levelName)}</small>` : ""}</td>
            <td data-label="Event"><span class="fm-type">${esc(EVENT_SHORT[event.type] || "Left active game")}</span><small>${esc(EVENT_LABELS[event.type] || "")}${event.awayCount > 1 ? ` · ${event.awayCount}${ordinal(event.awayCount)} time this level` : ""}</small></td>
            <td data-label="Left the game">${esc(fmtDateTime(event.leftAt))}</td>
            <td data-label="Returned">${away}</td>
            <td data-label="Session">${session}</td>
        </tr>`;
    }

    // A notification that stays until it is closed (or for 20 s), with the details teachers need.
    function popup(event) {
        // One notification per record, even if the same record is delivered again.
        if (!isNew(event) || notified.has(event.id)) return;
        notified.add(event.id);
        const d = details(event);
        let holder = document.getElementById("fm-popups");
        if (!holder) {
            holder = document.createElement("div");
            holder.id = "fm-popups";
            holder.setAttribute("aria-live", "polite");
            document.body.append(holder);
        }
        while (holder.children.length >= MAX_POPUPS) holder.firstElementChild.remove();
        const card = document.createElement("div");
        card.className = "fm-popup";
        card.setAttribute("role", "status");
        card.innerHTML = `
            <div class="fm-popup-head"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i><strong>Student left an active game</strong>
                <button type="button" class="fm-popup-close" aria-label="Close notification">&times;</button></div>
            <dl>
                <dt>Student</dt><dd>${esc(d.name)}</dd>
                <dt>Student Number</dt><dd>${esc(d.number)}</dd>
                <dt>Section</dt><dd>${esc(d.sectionName)}</dd>
                <dt>Level</dt><dd>${esc(event.levelId || "?")}${event.levelName ? ` – ${esc(event.levelName)}` : ""}</dd>
                <dt>Event</dt><dd>${esc(EVENT_SHORT[event.type] || "Left active game")}</dd>
                <dt>Time</dt><dd>${esc(fmtDateTime(event.leftAt))}</dd>
                <dt>Away</dt><dd>${event.returned ? esc(event.secondsAway !== null ? fmtDuration(event.secondsAway) : "Returned") : "Did not return"}</dd>
            </dl>
            <button type="button" class="fm-popup-view">View activity</button>`;
        const close = () => card.remove();
        card.querySelector(".fm-popup-close").addEventListener("click", close);
        card.querySelector(".fm-popup-view").addEventListener("click", () => {
            close();
            els.root?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        holder.append(card);
        setTimeout(close, POPUP_MS);
    }

    return { sync, render, stop: stopAll };
}

function ordinal(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) return "th";
    return ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th";
}
