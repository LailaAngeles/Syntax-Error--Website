// Saves a teacher's sections with a Firestore transaction, so the one-section-one-teacher rule holds
// even when two Super Admins save at the same moment.
//
// Every approvedUsers record is read inside the transaction. If another Super Admin changes any of
// them first, Firestore retries this save, and the retry sees the new holder and is refused.
import { collection, doc, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { planTeacherSections } from "./section-rules.js";

export async function saveTeacherSections(db, uid, names, { yearId = null } = {}) {
    // The list of teacher records is only used to pick what to read; the transaction re-reads each one.
    const refs = (await getDocs(collection(db, "approvedUsers"))).docs.map(d => d.ref);
    const targetRef = doc(db, "approvedUsers", uid);
    if (!refs.some(ref => ref.id === uid)) refs.push(targetRef);

    return runTransaction(db, async tx => {
        const entries = [];
        for (const ref of refs) {
            const snap = await tx.get(ref);
            if (snap.exists()) entries.push({ id: snap.id, data: snap.data() });
        }
        const update = planTeacherSections({ uid, entries, names, yearId });
        tx.update(targetRef, update);
    });
}
