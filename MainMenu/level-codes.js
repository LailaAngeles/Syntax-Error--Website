// Level access codes: make sure a code stops working once its 5 minutes are over.
// The stored PIN is blanked (not just labelled), so an expired code can never match what a
// student types, whatever the game checks. Only the signed-in teacher's own codes are touched.
import { collection, doc, getDocs, query, updateDoc, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const pending = new Set();

export function isPastExpiry(code, now = Date.now()) {
    const expires = code?.expiresAt?.toMillis?.() ?? 0;
    return !expires || expires <= now;
}

// Marks one code as expired and removes its PIN. Safe to call more than once.
export async function expireCode(db, sectionId, codeId, status = "expired") {
    const key = `${sectionId}/${codeId}`;
    if (pending.has(key)) return;
    pending.add(key);
    try {
        await updateDoc(doc(db, "sections", sectionId, "levelAccessCodes", codeId), {
            status, code: "", endedAt: serverTimestamp()
        });
    } finally {
        pending.delete(key);
    }
}

// Expires every still-active code of this teacher whose time has run out (in the given sections).
export async function expireStaleCodes(db, sectionIds, teacherUid) {
    let count = 0;
    for (const sectionId of sectionIds) {
        const snap = await getDocs(query(collection(db, "sections", sectionId, "levelAccessCodes"), where("teacherUid", "==", teacherUid)));
        for (const d of snap.docs) {
            const data = d.data();
            if (data.status === "active" && isPastExpiry(data)) {
                await expireCode(db, sectionId, d.id).then(() => count++).catch(error => console.warn("Could not expire code", d.id, error));
            }
        }
    }
    return count;
}
