// Teacher Activity: one short record per change a teacher makes, shown on the Super Admin's Home page.
// A failed log must never stop the teacher's own work, so errors are only written to the console.
// It records what happened, never a password or other sensitive value.
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

export function logTeacherActivity(db, auth, { action, summary, section = "", studentId = "" }) {
    const user = auth?.currentUser;
    if (!user) return;
    addDoc(collection(db, "teacherActivity"), {
        action, summary, section, studentId: String(studentId),
        teacherUid: user.uid, teacherEmail: user.email || "",
        at: serverTimestamp()
    }).catch(error => console.warn("[Teacher activity] Could not save this entry:", error?.code || error));
}
