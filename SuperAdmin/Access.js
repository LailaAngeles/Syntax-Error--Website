import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, doc, getDoc } 
from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {

    // =========================
    // CONFIG
    // =========================
    const firebaseConfig = {
        apiKey: "AIzaSy...",
        authDomain: "syntaxerror-data.firebaseapp.com",
        projectId: "syntaxerror-data",
        storageBucket: "syntaxerror-data.firebasestorage.app",
        messagingSenderId: "513961059475",
        appId: "1:513961059475:web:fbf6f471357465dbaad966"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // =========================
    // ELEMENTS
    // =========================
    const passwordInput = document.getElementById("password");
    const pinInput = document.getElementById("pin");

    const passBtn = document.getElementById("passBtn");
    const pinBtn = document.getElementById("pinBtn");

    const passError = document.getElementById("passError");
    const pinError = document.getElementById("pinError");

    const passwordStep = document.getElementById("passwordStep");
    const pinStep = document.getElementById("pinStep");

    // =========================
    // STATE
    // =========================
    let passwordAttempts = 0;
    let pinAttempts = 0;
    let isLocked = false;
    const lockSeconds = 30;

    // =========================
    // LOCK SYSTEM
    // =========================
    function startLockCountdown() {
        isLocked = true;

        passBtn.disabled = true;
        pinBtn.disabled = true;
        passwordInput.disabled = true;
        pinInput.disabled = true;

        let timeLeft = lockSeconds;

        const timer = setInterval(() => {
            passError.textContent = `Too many attempts. Try again in ${timeLeft}s`;
            pinError.textContent = `Too many attempts. Try again in ${timeLeft}s`;

            timeLeft--;

            if (timeLeft < 0) {
                clearInterval(timer);

                isLocked = false;
                passwordAttempts = 0;
                pinAttempts = 0;

                passBtn.disabled = false;
                pinBtn.disabled = false;
                passwordInput.disabled = false;
                pinInput.disabled = false;

                passError.textContent = "";
                pinError.textContent = "";
            }

        }, 1000);
    }

    // =========================
    // PASSWORD LOGIN (Firestore)
    // =========================
    passBtn.addEventListener("click", async () => {

        if (isLocked) return;

        passError.textContent = "";

        if (!passwordInput.value) {
            passError.textContent = "Please fill out this field.";
            return;
        }

        try {
            const docRef = doc(db, "admin", "superadmin");
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                passError.textContent = "Admin data not found.";
                return;
            }

            const storedPassword = docSnap.data().Password; // plain text

            if (passwordInput.value.trim() === storedPassword.trim()) {
                passwordAttempts = 0;
                passwordStep.style.display = "none";
                pinStep.style.display = "block";
            } else {
                passwordAttempts++;
                passError.textContent = "Incorrect password.";
                if (passwordAttempts >= 3) {
                    startLockCountdown();
                }
            }

        } catch (err) {
            console.error(err);
            passError.textContent = "Error verifying password.";
        }
    });

    // =========================
    // PIN VERIFICATION (Firestore) - SAME AS PASSWORD
    // =========================
    pinBtn.addEventListener("click", async () => {

        if (isLocked) return;

        pinError.textContent = "";

        if (!pinInput.value) {
            pinError.textContent = "Please fill out this field.";
            return;
        }

        try {
            const docRef = doc(db, "admin", "superadmin");
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                pinError.textContent = "Admin data not found.";
                return;
            }

            const storedPIN = docSnap.data().pinHash; // treated as plain text now

            if (pinInput.value.trim() === storedPIN.trim()) {
                pinAttempts = 0 ;
                // SUCCESS → REDIRECT
                window.location.href = "Dashboard.html";
            } else {
                pinAttempts++;
                pinError.textContent = "Incorrect PIN.";
                if (pinAttempts >= 3) {
                    startLockCountdown();
                }
            }

        } catch (err) {
            console.error(err);
            pinError.textContent = "Error verifying PIN.";
        }
    });

});