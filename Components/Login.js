console.log("Login.js loaded");

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// NEW FIRESTORE IMPORTS (ADDED)
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
const db = getFirestore(app); // NEW ADDED

const email = document.getElementById("email");
const password = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const loginForm = document.getElementById("loginForm");
const popup = document.getElementById("popup");
const popupMessage = document.getElementById("popup-message");
const popupClose = document.getElementById("popup-close");

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

    try {
        const archiveRef = collection(db, "archivedUsers");
        const q = query(archiveRef, where("email", "==", email.value));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            showPopup("Your account has been archived. You cannot log in.");
            return;
        }

        // LOGIN IF NOT ARCHIVED
        await signInWithEmailAndPassword(auth, email.value, password.value);
        window.location.href = "../MainMenu/dashboard.html";

    } catch (error) {
        console.error("Login error:", error.code);

        switch (error.code) {
            case "auth/invalid-credential":
                showPopup("Account not found or incorrect password.");
                break;
            case "auth/too-many-requests":
                showPopup("Too many attempts. Try again later.");
                break;
            default:
                showPopup("Login failed. Please try again.");
        }
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