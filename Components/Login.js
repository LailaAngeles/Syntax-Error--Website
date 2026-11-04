console.log("Login.js loaded");

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    setPersistence,
    inMemoryPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import { 
    getFirestore, 
    collection, 
    getDocs, 
    query, 
    where 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const email = document.getElementById("email");
const password = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const loginForm = document.getElementById("loginForm");
const rememberMe = document.getElementById("rememberMe");
const VERIFIED_KEY = "syntaxerror_verified_uid";
const HOME_URL = "../MainMenu/welcome.html";
let otpExpiresAt = 0;
let loginInProgress = false;

// Busy buttons + one PIN email per minute per address, so repeated clicks cannot flood the inbox.
const loginButton = loginForm?.querySelector('button[type="submit"]');
const PIN_COOLDOWN_MS = 60 * 1000;
const PIN_SENT_KEY = "syntaxerror_pin_sent";
const RESET_SENT_KEY = "syntaxerror_reset_sent";
const buttonLabels = new WeakMap();

function setBusy(button, busy, text = "") {
    if (!button) return;
    if (!buttonLabels.has(button)) buttonLabels.set(button, button.innerHTML);
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
    button.setAttribute("aria-busy", String(busy));
    button.innerHTML = busy ? `<span class="btn-spinner" aria-hidden="true"></span> ${text}` : buttonLabels.get(button);
}

// Milliseconds left before another email may be sent to this address (0 = allowed now).
function cooldownLeft(key, address) {
    try {
        const record = JSON.parse(sessionStorage.getItem(key) || "null");
        if (record && record.email === address.trim().toLowerCase()) return Math.max(0, PIN_COOLDOWN_MS - (Date.now() - record.at));
    } catch (error) { /* storage unavailable: no cooldown memory */ }
    return 0;
}
function rememberSent(key, address) {
    try { sessionStorage.setItem(key, JSON.stringify({ email: address.trim().toLowerCase(), at: Date.now() })); } catch (error) { /* ignore */ }
}

// Resume only sessions that have successfully completed the email PIN step.
onAuthStateChanged(auth, async (user) => {
    if (loginInProgress || !user) return;
    const verifiedUid = localStorage.getItem(VERIFIED_KEY) || sessionStorage.getItem(VERIFIED_KEY);
    if (verifiedUid !== user.uid) return;
    try {
        const archived = await getDocs(query(collection(db, "archivedUsers"), where("email", "==", user.email)));
        if (!archived.empty) {
            localStorage.removeItem(VERIFIED_KEY);
            sessionStorage.removeItem(VERIFIED_KEY);
            await signOut(auth);
            showPopup("Your account has been archived. You cannot log in.");
            return;
        }
        window.location.replace(HOME_URL);
    } catch (error) {
        console.error("Unable to check remembered session:", error);
        // Do not redirect if the archive check cannot be completed.
    }
});
const popup = document.getElementById("popup");
const popupMessage = document.getElementById("popup-message");
const popupClose = document.getElementById("popup-close");

let generatedOtp = "";

function showPopup(message) {
    if (popup && popupMessage) {
        popup.style.display = "flex";
        popupMessage.textContent = message;
    } else {
        alert(message);
    }
}

popupClose?.addEventListener("click", () => {
    if (popup) popup.style.display = "none";
});

togglePassword?.addEventListener("click", function () {
    const isHidden = password.type === "password";
    password.type = isHidden ? "text" : "password";
    this.classList.toggle("bi-eye", isHidden);
    this.classList.toggle("bi-eye-slash", !isHidden);
});

function showError(input, message) {
    const inputGroup = input.closest(".input-group");
    inputGroup.classList.add("error");

    let errorTooltip = inputGroup.querySelector(".error-tooltip");
    if (!errorTooltip) {
        errorTooltip = document.createElement("div");
        errorTooltip.className = "error-tooltip";
        inputGroup.appendChild(errorTooltip);
    }

    errorTooltip.textContent = message;
    errorTooltip.style.display = "flex";
}

function hideErrors() {
    document.querySelectorAll(".input-group").forEach(group => {
        group.classList.remove("error");
    });
    document.querySelectorAll(".error-tooltip").forEach(e => {
        e.style.display = "none";
    });
}

[email, password].forEach(input => {
    input?.addEventListener("input", () => {
        input.parentElement.classList.remove("error");
        const tooltip = input.parentElement.querySelector(".error-tooltip");
        if (tooltip) tooltip.style.display = "none";
    });
});

loginForm?.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (loginInProgress) return; // a sign-in is already running
    hideErrors();

    const allowedDomain = /^[a-zA-Z0-9._%+-]+@caloocan\.sti\.edu\.ph$/;
    let hasError = false;

    if (!email.value.trim()) {
        showError(email, "Please fill out this field.");
        hasError = true;
    } else if (!allowedDomain.test(email.value)) {
        showError(email, "Invalid STI email.");
        hasError = true;
    }

    if (!password.value) {
        showError(password, "Please fill out this field.");
        hasError = true;
    }

    if (hasError) return;

    // A valid PIN for this same account is already waiting: show it again instead of emailing a new one.
    if (generatedOtp && Date.now() < otpExpiresAt &&
        auth.currentUser?.email?.toLowerCase() === email.value.trim().toLowerCase()) {
        openOtpPopup("Your PIN was already sent. Enter it below.");
        return;
    }

    loginInProgress = true;
    setBusy(loginButton, true, "Checking your account…");
    try {
        // Do not persist an authenticated session until PIN verification succeeds.
        await setPersistence(auth, inMemoryPersistence);
        localStorage.removeItem(VERIFIED_KEY);
        sessionStorage.removeItem(VERIFIED_KEY);
        const archiveRef = collection(db, "archivedUsers");
        const q = query(archiveRef, where("email", "==", email.value));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            showPopup("Your account has been archived. You cannot log in.");
            return;
        }

        // Validate credentials before initiating OTP
        const credential = await signInWithEmailAndPassword(auth, email.value, password.value);

        // Only accounts provisioned or approved by the Super Admin may continue.
        const approved = await getDocs(query(collection(db, "approvedUsers"), where("email", "==", credential.user.email)));
        if (approved.empty || approved.docs[0].data().status !== "approved") {
            await signOut(auth);
            showPopup("This account was not created by the Super Admin. Please contact your administrator.");
            return;
        }

        // Credentials valid, initiate OTP
        setBusy(loginButton, true, "Sending your PIN…");
        await handleLoginAttempt(email.value);

    } catch (error) {
        await signOut(auth).catch(() => {});
        console.error("Login error:", error.code);
        switch (error.code) {
            case "auth/invalid-credential":
                const emailGroup = email.closest(".input-group");
                const passGroup = password.closest(".input-group");
                emailGroup.classList.add("error");
                passGroup.classList.add("error");
                showError(password, "Invalid email or password.");
                break;
            case "auth/too-many-requests":
                showPopup("Too many attempts. Try again later.");
                break;
            default:
                showPopup("Login failed. Please try again.");
        }
    } finally {
        loginInProgress = false;
        setBusy(loginButton, false);
    }
});

document.addEventListener("DOMContentLoaded", () => {
    let clickCount = 0;
    const logo = document.querySelector(".logo-container");

    logo?.addEventListener("click", () => {
        clickCount++;
        if (clickCount === 5) {
            window.location.href = "../SuperAdmin/SuperAdmim.html";
            clickCount = 0;
        }
    });
});

const reset = document.getElementById("forgotPasswordLink");

function toggleFeedbackPopup(show) {
    const popup = document.getElementById("emailFeedbackPopup");
    if (popup) popup.style.display = show ? "flex" : "none";
}

document.getElementById("closeFeedbackBtn")?.addEventListener("click", function() {
    toggleFeedbackPopup(false);
});

// Firebase's email enumeration protection makes sendPasswordResetEmail "succeed" even for
// unknown addresses, so look the email up in our own records before sending anything.
// Returns "approved", "archived" or "missing".
async function findAccountStatus(address) {
    const variants = [...new Set([address, address.toLowerCase()])];
    for (const value of variants) {
        const archived = await getDocs(query(collection(db, "archivedUsers"), where("email", "==", value)));
        if (!archived.empty) return "archived";
    }
    for (const value of variants) {
        const approved = await getDocs(query(collection(db, "approvedUsers"), where("email", "==", value)));
        if (!approved.empty && approved.docs.some(d => d.data().status === "approved")) return "approved";
    }
    return "missing";
}

let resetInProgress = false;
reset?.addEventListener("click", async function(event) {
    event.preventDefault();
    if (resetInProgress) return;
    const emailValue = document.getElementById("email").value.trim();
    if (!emailValue) {
        showPopup("Please enter your email address first, then click Forgot Password.");
        return;
    }
    if (!/^[a-zA-Z0-9._%+-]+@caloocan\.sti\.edu\.ph$/.test(emailValue)) {
        showPopup("Please enter a valid STI email (ending in @caloocan.sti.edu.ph).");
        return;
    }
    // One reset email per minute for the same address.
    const wait = cooldownLeft(RESET_SENT_KEY, emailValue);
    if (wait) {
        showPopup(`A password reset email was already sent. Check your inbox and Junk folder, or try again in ${Math.ceil(wait / 1000)} seconds.`);
        return;
    }
    resetInProgress = true;
    reset.setAttribute("aria-disabled", "true");
    reset.textContent = "Checking…";
    try {
        let status;
        try {
            status = await findAccountStatus(emailValue);
        } catch (error) {
            console.error("Could not check account for reset:", error);
            showPopup("We couldn't check your account right now. Please check your internet connection and try again.");
            return;
        }
        if (status === "missing") {
            showPopup("No account was found with this email. Please check the address, or contact your Super Admin to create your account.");
            return;
        }
        if (status === "archived") {
            showPopup("This account has been archived, so its password cannot be reset. Please contact your Super Admin.");
            return;
        }

        reset.textContent = "Sending…";
        await sendPasswordResetEmail(auth, emailValue);
        rememberSent(RESET_SENT_KEY, emailValue);
        const forgotPopup = document.getElementById("forgotPopup");
        if (forgotPopup) forgotPopup.style.display = "none";
        toggleFeedbackPopup(true);
    } catch (error) {
        console.error("Password reset failed:", error.code);
        switch (error.code) {
            case "auth/user-not-found":
                showPopup("No account was found with this email. Please check the address, or contact your Super Admin to create your account.");
                break;
            case "auth/too-many-requests":
                showPopup("Too many reset requests. Please wait a few minutes and try again.");
                break;
            case "auth/network-request-failed":
                showPopup("Network error. Please check your internet connection and try again.");
                break;
            default:
                showPopup("We couldn't send the reset email. Please try again.");
        }
    } finally {
        resetInProgress = false;
        reset.removeAttribute("aria-disabled");
        reset.textContent = "Forgot Password?";
    }
});

emailjs.init({ publicKey: "SZvtmcDCW3hy4qm5v" });

const resendButton = document.getElementById("resendOtpBtn");
let resendTimer = null;

function startResendCountdown(ms = PIN_COOLDOWN_MS) {
    clearInterval(resendTimer);
    if (!resendButton) return;
    const until = Date.now() + ms;
    const tick = () => {
        const left = Math.ceil((until - Date.now()) / 1000);
        if (left <= 0) {
            clearInterval(resendTimer);
            resendButton.disabled = false;
            resendButton.textContent = "Resend PIN";
        } else {
            resendButton.disabled = true;
            resendButton.textContent = `Resend PIN in ${left}s`;
        }
    };
    tick();
    resendTimer = setInterval(tick, 1000);
}

function openOtpPopup(note = "") {
    const noteEl = document.getElementById("otpNote");
    if (noteEl) { noteEl.textContent = note; noteEl.hidden = !note; }
    document.getElementById("otpPopup").style.display = "flex";
    const left = cooldownLeft(PIN_SENT_KEY, auth.currentUser?.email || email.value);
    startResendCountdown(left);
    setTimeout(() => document.getElementById("otpInput")?.focus(), 50);
}

async function handleLoginAttempt(userEmail) {
    // At most one PIN email per minute for the same address (also across page reloads).
    const wait = cooldownLeft(PIN_SENT_KEY, userEmail);
    if (wait) {
        await signOut(auth).catch(() => {});
        generatedOtp = "";
        showPopup(`A PIN was sent to this email less than a minute ago. Check your inbox and Junk folder, or try again in ${Math.ceil(wait / 1000)} seconds.`);
        return;
    }
    generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    otpExpiresAt = Date.now() + 15 * 60 * 1000;
    try {
        await emailjs.send("service_ixe2e5j", "template_kvlen8d", {
            email: userEmail,
            passcode: generatedOtp,
            time: "15 minutes"
        });
        rememberSent(PIN_SENT_KEY, userEmail);
        const otpInput = document.getElementById("otpInput");
        if (otpInput) otpInput.value = "";
        openOtpPopup();
    } catch (error) {
        console.error("Email failed:", error);
        await signOut(auth).catch(() => {});
        generatedOtp = "";
        showPopup("Failed to send PIN. Please check your internet.");
    }
}

// Resend: only after the countdown, and only for the account that passed the password check.
resendButton?.addEventListener("click", async () => {
    const userEmail = auth.currentUser?.email;
    if (!userEmail || resendButton.disabled) return;
    setBusy(resendButton, true, "Sending…");
    await handleLoginAttempt(userEmail);
    setBusy(resendButton, false);
    if (generatedOtp) openOtpPopup("A new PIN was sent. The previous one no longer works.");
});
document.getElementById("otpInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") document.getElementById("verifyOtpBtn")?.click();
});

document.getElementById("verifyOtpBtn")?.addEventListener("click", async () => {
    const verifyButton = document.getElementById("verifyOtpBtn");
    const entered = document.getElementById("otpInput").value.trim();
    if (!generatedOtp || !auth.currentUser || Date.now() > otpExpiresAt) {
        alert("The PIN expired. Please sign in again.");
        await signOut(auth);
        document.getElementById("otpPopup").style.display = "none";
        return;
    }
    if (entered !== generatedOtp) {
        alert("Invalid PIN. Please try again.");
        return;
    }

    verifyButton.disabled = true;
    try {
        const shouldRemember = rememberMe?.checked === true;
        await setPersistence(auth, shouldRemember ? browserLocalPersistence : browserSessionPersistence);
        const storage = shouldRemember ? localStorage : sessionStorage;
        localStorage.removeItem(VERIFIED_KEY);
        sessionStorage.removeItem(VERIFIED_KEY);
        storage.setItem(VERIFIED_KEY, auth.currentUser.uid);
        generatedOtp = "";
        window.location.replace(HOME_URL);
    } catch (error) {
        console.error("Unable to finish login:", error);
        showPopup("Could not save your login session. Please try again.");
    } finally {
        verifyButton.disabled = false;
    }
});