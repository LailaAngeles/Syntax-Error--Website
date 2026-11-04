// First-login Terms and Conditions / Privacy Notice gate for every teacher page.
// Load after the page's own Firebase module so it reuses the same app and session.
import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Raise this whenever the notice text changes; every teacher must accept the new version.
const TERMS_VERSION = "2026-11-02";
const VERIFIED_KEY = "syntaxerror_verified_uid";

const firebaseConfig = {
    apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const TERMS_HTML = `
<p class="tg-meta">Version ${TERMS_VERSION}. Please read this notice in full. You must agree to it before you can use the SyntaxError Data Analysis Portal.</p>

<h3>1. Welcome</h3>
<p>Welcome to the SyntaxError educational platform, a BSCS thesis project of STI College Caloocan. SyntaxError is made up of a mobile C# learning game for students and this web-based Data Analysis Portal for faculty. Your account was created by the platform's Super Admin so you can monitor the progress of the sections assigned to you.</p>

<h3>2. Scope of this notice</h3>
<p>These Terms and Conditions govern your use of the Data Analysis Portal. The Privacy Notice explains how personal information is collected, used, stored, and protected, in line with Republic Act No. 10173, the Data Privacy Act of 2012, its Implementing Rules and Regulations, and issuances of the National Privacy Commission (NPC).</p>

<h3>3. Information we process</h3>
<p><strong>About you (faculty):</strong></p>
<ul>
<li>Your complete name, official school email address, and assigned section(s).</li>
<li>Account details such as your login status, the date your account was created, and the date you accepted this notice.</li>
<li>Activity needed to keep the portal secure, such as sign-in and one-time PIN verification.</li>
</ul>
<p><strong>About students in your sections:</strong></p>
<ul>
<li>Names or identifiers, section, and in-game learning data such as levels attempted, scores, completion time, number of attempts, and topic performance.</li>
</ul>
<p>The portal does not ask for and should not be used to store sensitive personal information such as government ID numbers, health information, or financial details.</p>

<h3>4. Why we process it</h3>
<ul>
<li>To give you secure access to the dashboards of your assigned sections.</li>
<li>To show learning analytics that help you identify student learning gaps and support instruction.</li>
<li>To manage accounts, sections, and archives, and to keep the system secure and working properly.</li>
<li>For the academic evaluation of the SyntaxError thesis, using summarized or de-identified results wherever possible.</li>
</ul>
<p>Personal information is processed only for these stated purposes and is not used for unrelated purposes, advertising, or sale.</p>

<h3>5. Legal basis</h3>
<p>Processing is based on your consent given through this notice, on the legitimate educational interests of STI College Caloocan, and on the performance of your teaching functions, as allowed under Sections 12 and 13 of the Data Privacy Act.</p>

<h3>6. Storage and security</h3>
<p>Data is stored using Google Firebase services (Firebase Authentication and Cloud Firestore), which may keep data on servers outside the Philippines. Reasonable organizational, physical, and technical measures are used to protect it, including restricted accounts created only by the Super Admin, email PIN verification, and encrypted connections. No system is completely secure; any suspected breach will be handled and reported as required by the NPC.</p>

<h3>7. Sharing</h3>
<p>Personal information is accessible only to authorized faculty for their assigned sections, the Super Admin, and the thesis team for system maintenance. It is not shared with other third parties except where required by law or with your consent.</p>

<h3>8. Retention</h3>
<p>Records are kept only as long as needed for the purposes above, including the duration of the thesis and its evaluation. Archived accounts and student records are kept for reference and are deleted or anonymized when no longer needed.</p>

<h3>9. Your responsibilities as an account holder</h3>
<ul>
<li>Keep your password and one-time PINs confidential. Do not share your account.</li>
<li>Change the default password given by the Super Admin as soon as possible.</li>
<li>Access and use student data only for legitimate teaching purposes and only for your assigned sections.</li>
<li>Do not copy, export, publish, or disclose student data outside these purposes, including in screenshots or exported files.</li>
<li>Sign out on shared or public devices, and report any suspected unauthorized access to the Super Admin right away.</li>
</ul>

<h3>10. Acceptable use</h3>
<p>You agree not to attempt to bypass security controls, access data you are not authorized to see, interfere with the platform, or use it for any unlawful purpose. Misuse may result in your account being suspended or archived and may be reported to the school administration.</p>

<h3>11. Your rights as a data subject</h3>
<p>Under the Data Privacy Act you have the right to be informed, to access, to object, to correct, to erasure or blocking, to data portability, to file a complaint with the National Privacy Commission, and to damages. You may withdraw your consent at any time by contacting the Super Admin; withdrawing consent may mean you can no longer use the portal.</p>

<h3>12. Changes to this notice</h3>
<p>This notice may be updated. When it changes, you will be asked to read and accept the new version before you can continue using the portal.</p>

<h3>13. Contact</h3>
<p>For questions, requests, or concerns about this notice or your data, contact the SyntaxError Super Admin or the Data Protection Officer of STI College Caloocan.</p>

<p class="tg-meta">By ticking the box below and selecting <strong>I Agree and Continue</strong>, you confirm that you have read and understood these Terms and Conditions and this Privacy Notice, and that you consent to the processing of personal information described above.</p>
`;

function clearGate() {
    document.getElementById("termsGate")?.remove();
    document.documentElement.classList.add("terms-ok");
}

function mountGate(html) {
    let gate = document.getElementById("termsGate");
    if (!gate) {
        gate = document.createElement("div");
        gate.id = "termsGate";
        document.body.appendChild(gate);
    }
    gate.innerHTML = html;
    return gate;
}

async function leave() {
    localStorage.removeItem(VERIFIED_KEY);
    sessionStorage.removeItem(VERIFIED_KEY);
    await signOut(auth).catch(() => {});
    window.location.replace("../index.html");
}

function showStatus(message, retry) {
    const gate = mountGate(`
        <div class="tg-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tgStatusText">
            <div class="tg-status">
                <p id="tgStatusText"></p>
                <div class="tg-actions" style="justify-content:center">
                    <button type="button" class="tg-decline" id="tgSignOut">Sign out</button>
                    ${retry ? '<button type="button" class="tg-accept" id="tgRetry">Try again</button>' : ""}
                </div>
            </div>
        </div>`);
    gate.querySelector("#tgStatusText").textContent = message;
    gate.querySelector("#tgSignOut").addEventListener("click", leave);
    gate.querySelector("#tgRetry")?.addEventListener("click", retry);
}

// New accounts use the Auth UID as the document ID; older approved accounts are found by email.
async function findTeacherRecord(user) {
    const byUid = await getDoc(doc(db, "approvedUsers", user.uid));
    if (byUid.exists()) return byUid;
    const byEmail = await getDocs(query(collection(db, "approvedUsers"), where("email", "==", user.email)));
    return byEmail.empty ? null : byEmail.docs[0];
}

// First login only: ask whether to replace the default password given by the Super Admin.
function showPasswordPrompt(recordRef) {
    const gate = mountGate(`
        <div class="tg-dialog tg-small" role="dialog" aria-modal="true" aria-labelledby="tgPwTitle">
            <div class="tg-header">
                <div class="tg-badge" aria-hidden="true"><i class="bi bi-shield-lock"></i></div>
                <div>
                    <h2 id="tgPwTitle">Do you want to change your password?</h2>
                    <p>You are still using the default password given by the Super Admin.</p>
                </div>
            </div>
            <div class="tg-body">
                <p>For better account security, changing your default password is recommended. Select <strong>Yes</strong> to create a new password now, or <strong>No</strong> to keep using your current password.</p>
                <p class="tg-error" id="tgError" role="alert" hidden></p>
            </div>
            <div class="tg-footer">
                <div class="tg-actions" style="margin-top:0">
                    <button type="button" class="tg-decline" id="tgNo">No, keep current password</button>
                    <button type="button" class="tg-accept" id="tgYes">Yes, change password</button>
                </div>
            </div>
        </div>`);
    const errorBox = gate.querySelector("#tgError");
    gate.querySelector("#tgYes").addEventListener("click", () => showPasswordForm(recordRef));
    gate.querySelector("#tgNo").addEventListener("click", async event => {
        event.currentTarget.disabled = true;
        try {
            await updateDoc(recordRef, { isFirstLogin: false });
            clearGate();
        } catch (error) {
            console.error("Could not save password choice:", error);
            errorBox.textContent = "Your choice could not be saved. Check your connection and try again.";
            errorBox.hidden = false;
            event.currentTarget.disabled = false;
        }
    });
    gate.querySelector("#tgYes").focus();
}

function showPasswordForm(recordRef) {
    const field = (id, label, placeholder, autocomplete) => `
        <label class="tg-field" for="${id}">${label}
            <span class="tg-input">
                <input type="password" id="${id}" placeholder="${placeholder}" autocomplete="${autocomplete}" maxlength="128" aria-describedby="${id}Note">
                <button type="button" class="tg-eye" data-for="${id}" aria-label="Show password"><i class="bi bi-eye-slash"></i></button>
            </span>
            <small class="tg-note" id="${id}Note" aria-live="polite" hidden></small>
        </label>`;
    const gate = mountGate(`
        <div class="tg-dialog tg-small" role="dialog" aria-modal="true" aria-labelledby="tgPwFormTitle">
            <div class="tg-header">
                <div class="tg-badge" aria-hidden="true"><i class="bi bi-key"></i></div>
                <div>
                    <h2 id="tgPwFormTitle">Update your password</h2>
                    <p>Use at least 8 characters that are hard to guess.</p>
                </div>
            </div>
            <form class="tg-body" id="tgPwForm" novalidate>
                ${field("tgCurrentPw", "Current (default) password", "Enter current password", "current-password")}
                ${field("tgNewPw", "New password", "Enter new password", "new-password")}
                ${field("tgConfirmPw", "Confirm password", "Re-enter new password", "new-password")}
                <p class="tg-error" id="tgError" role="alert" hidden></p>
            </form>
            <div class="tg-footer">
                <div class="tg-actions" style="margin-top:0">
                    <button type="button" class="tg-decline" id="tgBack">Back</button>
                    <button type="submit" form="tgPwForm" class="tg-accept" id="tgSave">Save</button>
                </div>
            </div>
        </div>`);
    const form = gate.querySelector("#tgPwForm");
    const current = gate.querySelector("#tgCurrentPw");
    const next = gate.querySelector("#tgNewPw");
    const confirm = gate.querySelector("#tgConfirmPw");
    const save = gate.querySelector("#tgSave");
    const errorBox = gate.querySelector("#tgError");
    const dialogBox = gate.querySelector(".tg-dialog");
    const fail = message => { errorBox.textContent = message; errorBox.hidden = false; };
    const syncDialog = () => dialogBox.classList.toggle("tg-has-error", !!gate.querySelector(".tg-invalid") || !errorBox.hidden);

    // Turns one field red with its own message, green when good is set, or back to normal.
    function markField(input, message = "", good = "") {
        const box = input.closest(".tg-field");
        const note = gate.querySelector(`#${input.id}Note`);
        const wasInvalid = box.classList.contains("tg-invalid");
        box.classList.toggle("tg-invalid", !!message);
        box.classList.toggle("tg-valid", !message && !!good);
        input.setAttribute("aria-invalid", message ? "true" : "false");
        note.hidden = !message && !good;
        note.replaceChildren();
        if (message || good) {
            const icon = document.createElement("i");
            icon.className = `bi ${message ? "bi-exclamation-circle-fill" : "bi-check-circle-fill"}`;
            icon.setAttribute("aria-hidden", "true");
            note.append(icon, document.createTextNode(` ${message || good}`));
        }
        if (message && !wasInvalid) {
            box.classList.add("tg-shake");
            box.addEventListener("animationend", () => box.classList.remove("tg-shake"), { once: true });
        }
        syncDialog();
    }
    const currentProblem = () => current.value ? "" : "Enter your current (default) password.";
    const newProblem = () => next.value.length < 8 ? "Use at least 8 characters."
        : next.value === current.value ? "Must be different from your default password." : "";
    const confirmProblem = () => !confirm.value ? "Re-enter your new password."
        : confirm.value !== next.value ? "Passwords do not match." : "";
    const checkConfirm = () => markField(confirm, confirmProblem(), confirmProblem() ? "" : "Passwords match.");

    // Red appears as soon as a mistake is certain, not while the person is still typing it.
    current.addEventListener("input", () => {
        markField(current);
        if (next.closest(".tg-invalid")) markField(next, newProblem());
    });
    next.addEventListener("input", () => {
        if (next.closest(".tg-invalid") || next.value.length >= 8) markField(next, newProblem());
        if (confirm.value) checkConfirm();
    });
    next.addEventListener("blur", () => { if (next.value) markField(next, newProblem()); });
    confirm.addEventListener("input", () => {
        if (!confirm.value) return markField(confirm);
        if (confirm.closest(".tg-invalid") || confirm.value.length >= next.value.length) checkConfirm();
        else markField(confirm);
    });
    confirm.addEventListener("blur", () => { if (confirm.value) checkConfirm(); });

    gate.querySelectorAll(".tg-eye").forEach(eye => eye.addEventListener("click", () => {
        const input = gate.querySelector("#" + eye.dataset.for);
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.innerHTML = `<i class="bi ${show ? "bi-eye" : "bi-eye-slash"}"></i>`;
        eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
    }));
    gate.querySelector("#tgBack").addEventListener("click", () => showPasswordPrompt(recordRef));

    form.addEventListener("submit", async event => {
        event.preventDefault();
        errorBox.hidden = true;
        // Show every problem at once and go to the first one.
        const problems = [[current, currentProblem()], [next, newProblem()], [confirm, confirmProblem()]];
        problems.forEach(([input, message]) => markField(input, message, input === confirm && !message ? "Passwords match." : ""));
        const first = problems.find(([, message]) => message);
        if (first) return first[0].focus();

        save.disabled = true;
        save.textContent = "Saving...";
        try {
            const user = auth.currentUser;
            await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current.value));
            await updatePassword(user, next.value);
        } catch (error) {
            console.error("Password update failed:", error.code);
            save.disabled = false;
            save.textContent = "Save";
            switch (error.code) {
                case "auth/invalid-credential":
                case "auth/invalid-login-credentials":
                case "auth/wrong-password":
                    markField(current, "This is not your current password. Check it and try again.");
                    current.focus();
                    current.select();
                    return;
                case "auth/weak-password":
                    markField(next, "This password is too weak. Try a longer one that is harder to guess.");
                    next.focus();
                    return;
                case "auth/too-many-requests": fail("Too many attempts. Please wait a few minutes and try again."); break;
                case "auth/network-request-failed": fail("No connection. Check your internet and try again."); break;
                default: fail("Your password could not be changed. Please try again.");
            }
            syncDialog();
            return;
        }
        // The password is already changed; a failed flag update only means the prompt may appear again.
        await updateDoc(recordRef, { isFirstLogin: false, passwordChangedAt: serverTimestamp() })
            .catch(error => console.error("Could not record password change:", error));
        mountGate(`
            <div class="tg-dialog tg-small" role="alertdialog" aria-modal="true" aria-labelledby="tgDoneTitle">
                <div class="tg-status">
                    <p id="tgDoneTitle"><strong>Password updated.</strong><br>Use your new password the next time you sign in.</p>
                    <div class="tg-actions" style="justify-content:center">
                        <button type="button" class="tg-accept" id="tgContinue">Continue</button>
                    </div>
                </div>
            </div>`).querySelector("#tgContinue").addEventListener("click", clearGate);
        document.getElementById("tgContinue").focus();
    });
    current.focus();
}

function showTerms(recordRef, afterAccept) {
    const gate = mountGate(`
        <div class="tg-dialog" role="dialog" aria-modal="true" aria-labelledby="tgTitle" aria-describedby="tgBody">
            <div class="tg-header">
                <div class="tg-badge" aria-hidden="true">STI</div>
                <div>
                    <h2 id="tgTitle">TERMS AND CONDITIONS AND PRIVACY NOTICE</h2>
                    <p>SyntaxError Data Analysis Portal · STI College Caloocan</p>
                </div>
            </div>
            <div class="tg-body" id="tgBody" tabindex="0">${TERMS_HTML}</div>
            <div class="tg-footer">
                <p class="tg-hint" id="tgHint">Scroll to the end of the notice to enable the agreement checkbox.</p>
                <label class="tg-agree tg-locked" id="tgAgreeLabel">
                    <input type="checkbox" id="tgAgree" disabled>
                    <span>I have read and understood the Terms and Conditions and Privacy Notice, and I agree to them.</span>
                </label>
                <p class="tg-error" id="tgError" role="alert" hidden></p>
                <div class="tg-actions">
                    <button type="button" class="tg-decline" id="tgDecline">Decline and sign out</button>
                    <button type="button" class="tg-accept" id="tgAccept" disabled>I Agree and Continue</button>
                </div>
            </div>
        </div>`);

    const body = gate.querySelector("#tgBody");
    const agree = gate.querySelector("#tgAgree");
    const agreeLabel = gate.querySelector("#tgAgreeLabel");
    const accept = gate.querySelector("#tgAccept");
    const hint = gate.querySelector("#tgHint");
    const errorBox = gate.querySelector("#tgError");

    const unlockIfRead = () => {
        if (!agree.disabled) return;
        if (body.scrollTop + body.clientHeight < body.scrollHeight - 12) return;
        agree.disabled = false;
        agreeLabel.classList.remove("tg-locked");
        hint.textContent = "You reached the end of the notice. Tick the box to agree.";
        hint.classList.add("tg-done");
    };
    body.addEventListener("scroll", unlockIfRead, { passive: true });
    window.addEventListener("resize", unlockIfRead);
    requestAnimationFrame(unlockIfRead);
    agree.addEventListener("change", () => { accept.disabled = !agree.checked; });

    gate.querySelector("#tgDecline").addEventListener("click", leave);
    accept.addEventListener("click", async () => {
        if (!agree.checked) return;
        accept.disabled = true;
        accept.textContent = "Saving...";
        errorBox.hidden = true;
        try {
            await updateDoc(recordRef, {
                hasAcceptedTerms: true,
                termsVersion: TERMS_VERSION,
                termsAcceptedAt: serverTimestamp()
            });
            window.removeEventListener("resize", unlockIfRead);
            afterAccept();
        } catch (error) {
            console.error("Could not record terms acceptance:", error);
            errorBox.textContent = "Your agreement could not be saved. Check your connection and try again.";
            errorBox.hidden = false;
            accept.disabled = !agree.checked;
            accept.textContent = "I Agree and Continue";
        }
    });
    body.focus();
}

async function checkTerms(user) {
    try {
        const record = await findTeacherRecord(user);
        if (!record) {
            showStatus("This account is not registered as a teacher. Please contact the Super Admin.");
            return;
        }
        const data = record.data();
        // Accounts created by the Super Admin start with isFirstLogin: true.
        const afterTerms = () => data.isFirstLogin === true ? showPasswordPrompt(record.ref) : clearGate();
        if (data.hasAcceptedTerms === true && data.termsVersion === TERMS_VERSION) afterTerms();
        else showTerms(record.ref, afterTerms);
    } catch (error) {
        console.error("Terms check failed:", error);
        showStatus("Your account could not be checked. Please try again.", () => checkTerms(user));
    }
}

let checkedUid = null;
onAuthStateChanged(auth, user => {
    // Signed-out visitors are redirected by the page's own script.
    if (!user || user.uid === checkedUid) return;
    checkedUid = user.uid;
    checkTerms(user);
});
