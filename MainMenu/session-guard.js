// One active website session per teacher account, checked against the teacher's Firestore record, so
// it works across devices (browser storage alone only knows about this device).
//
//   Finishing sign-in  -> this device writes a new id to activeSession on approvedUsers.
//   Every teacher page -> watches that record. If the id is no longer this device's, a newer sign-in
//                         replaced it: this device signs out and the login page says why.
//
// Two devices signing in at nearly the same moment: Firestore applies the writes one after the other,
// so the last one stays and the other sees a different id. A save that fails (no connection, or a rule
// that refuses it) leaves the teacher working without this check rather than locking them out.
import { collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const VERIFIED_KEY = "syntaxerror_verified_uid";
const SESSION_KEY = "syntaxerror_session_id";
const UNCLAIMED = "none";
const DEVICES = ["phone", "tablet", "computer"];

function thisDevice() {
    const agent = navigator.userAgent;
    if (/iPhone|iPod|Android.*Mobile/i.test(agent)) return "phone";
    return /iPad|Android|Tablet/i.test(agent) ? "tablet" : "computer";
}

const readLocalId = () => localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);

// The record may use the Auth uid as its id; older approved accounts are found by email.
async function teacherRecordRef(db, user) {
    const byUid = doc(db, "approvedUsers", user.uid);
    if ((await getDoc(byUid)).exists()) return byUid;
    const byEmail = await getDocs(query(collection(db, "approvedUsers"), where("email", "==", user.email)));
    return byEmail.empty ? null : byEmail.docs[0].ref;
}

async function writeSession(recordRef, storage) {
    const id = crypto.randomUUID();
    await updateDoc(recordRef, { activeSession: { id, device: thisDevice(), startedAt: serverTimestamp() } });
    storage.setItem(SESSION_KEY, id);
    return id;
}

// Called when the email PIN is accepted. This sign-in becomes the active one.
export async function claimSession(db, user, storage) {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    try {
        const ref = await teacherRecordRef(db, user);
        if (ref) await writeSession(ref, storage);
    } catch (error) {
        console.warn("[Session] Could not save the active session; continuing without the one-device check:", error?.code || error);
        storage.setItem(SESSION_KEY, UNCLAIMED);
    }
}

async function endThisSession(auth, device) {
    localStorage.removeItem(VERIFIED_KEY);
    sessionStorage.removeItem(VERIFIED_KEY);
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    await signOut(auth).catch(() => {});
    const on = DEVICES.includes(device) ? `&device=${device}` : "";
    window.location.replace(`../Components/LogIn.html?notice=other-device${on}`);
}

// Started once per page by terms-gate.js, which already holds the teacher's record.
let guarding = false;
export async function guardSession(db, auth, record) {
    if (guarding) return;
    guarding = true;
    const active = record.data()?.activeSession;
    let currentId = readLocalId();

    // Signed in on this device before a newer sign-in elsewhere took over.
    if (!currentId && active?.id) return endThisSession(auth, active.device);
    if (active?.id && currentId !== UNCLAIMED && currentId !== active.id) return endThisSession(auth, active.device);

    // Signed in before this check existed, or the save failed earlier: claim the session now.
    if (!currentId || currentId === UNCLAIMED) {
        const storage = localStorage.getItem(VERIFIED_KEY) ? localStorage : sessionStorage;
        try {
            currentId = await writeSession(record.ref, storage);
        } catch (error) {
            console.warn("[Session] Could not save the active session; continuing without the one-device check:", error?.code || error);
            return;
        }
    }

    onSnapshot(record.ref, snap => {
        if (snap.metadata?.hasPendingWrites) return;
        const latest = snap.data()?.activeSession;
        if (latest?.id && latest.id !== currentId) endThisSession(auth, latest.device);
    }, error => console.warn("[Session] Could not watch the active session:", error?.code || error));
}
