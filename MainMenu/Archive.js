import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, collection, getDocs, query, doc, setDoc, deleteDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// 1. FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyCEK9ungYl1PkiqgLkWJPCtNXAsQ3c6xxc",
    authDomain: "syntaxerror-data.firebaseapp.com",
    projectId: "syntaxerror-data",
    storageBucket: "syntaxerror-data.firebasestorage.app",
    messagingSenderId: "513961059475",
    appId: "1:513961059475:web:fbf6f471357465dbaad966"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Global Variables
const archivedTableBody = document.getElementById('archived-students-table');
let allArchived = [];
let pendingRestoreId = null;

// --- UI HELPER ---
const toggleLoading = (show) => {
    const loader = document.getElementById("loading-overlay");
    if (loader) loader.style.display = show ? "flex" : "none";
};

// --- AUTH OBSERVER ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Start loading as soon as we know the user is logged in
        toggleLoading(true);
        await loadArchivedStudents();
        // Stop loading only after the function finishes fetching and rendering
        toggleLoading(false);
    } else {
        window.location.href = '../Login/Login.html';
    }
});

// --- LOAD ARCHIVES ---
async function loadArchivedStudents() {
    try {
        const q = query(collection(db, "archivedStudents"));
        const querySnapshot = await getDocs(q);
        
        allArchived = [];
        archivedTableBody.innerHTML = ''; 

        if (querySnapshot.empty) {
            archivedTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:#94a3b8;">No archived students found.</td></tr>';
            return;
        }

        querySnapshot.forEach((d) => {
            const data = d.data();
            allArchived.push({ ...data, docId: d.id });
        });

        // This renders the data into the table
        renderTable(allArchived);
        
    } catch (error) {
        console.error("Error fetching archives:", error);
        archivedTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Error loading archives.</td></tr>';
    }
}

function renderTable(data) {
    if (!data || data.length === 0) {
        archivedTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:40px; color:#94a3b8;">No matches found.</td></tr>';
        return;
    }

    archivedTableBody.innerHTML = data.map(student => {
        const dateStr = student.archivedAt && typeof student.archivedAt.toDate === 'function' 
            ? student.archivedAt.toDate().toLocaleDateString() 
            : 'Recently';
        
        return `
            <tr id="row-${student.docId}" style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 15px;"><strong>${student.name}</strong><br><small style="color:#64748b;">ID: ${student.id}</small></td>
                <td style="padding: 15px;">${student.section}</td>
                <td style="padding: 15px;">${dateStr}</td>
                <td style="padding: 15px;">
                    <button onclick="restoreStudent('${student.docId}')" 
                            style="background: #10b981; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                        <i class="bi bi-arrow-counterclockwise"></i> Restore
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

// --- RESTORE LOGIC ---
window.restoreStudent = function(docId) {
    const student = allArchived.find(s => s.docId === docId);
    if (!student) return;

    pendingRestoreId = docId;
    const modal = document.getElementById('restore-modal');
    const modalText = modal.querySelector('p');
    if (modalText) {
        modalText.innerHTML = `This will move <strong>${student.name}</strong> back to the active list for <strong>${student.section}</strong>.`;
    }
    modal.style.display = 'flex';
};

window.closeRestoreModal = function() {
    document.getElementById('restore-modal').style.display = 'none';
    pendingRestoreId = null;
};

document.getElementById('confirm-restore-btn').onclick = async function() {
    if (!pendingRestoreId) return;

    const docId = pendingRestoreId;
    const student = allArchived.find(s => s.docId === docId);
    const restoreBtn = this;

    try {
        restoreBtn.disabled = true;
        restoreBtn.innerText = "Restoring...";

        const originalRef = doc(db, "sections", student.parentDocId, "classList", student.id);
        const { archivedAt, status, docId: _, ...restorationData } = student;
        
        await setDoc(originalRef, restorationData);
        await deleteDoc(doc(db, "archivedStudents", docId));

        const row = document.getElementById(`row-${docId}`);
        if (row) row.remove();
        
        closeRestoreModal();
        alert("Student restored successfully!");
        
    } catch (error) {
        console.error("Restore Error:", error);
        alert("Failed to restore student.");
    } finally {
        restoreBtn.disabled = false;
        restoreBtn.innerText = "Restore Now";
    }
};

// --- LOGOUT LOGIC ---
window.showLogoutPopup = () => document.getElementById("logout-popup").style.display = "flex";
window.closeLogoutPopup = () => document.getElementById("logout-popup").style.display = "none";
window.logoutUser = async () => {
    try {
        await signOut(auth);
     
        window.location.href = '../index.html'; 
    } catch (error) {
        console.error("Logout error", error);
    }
};

// --- SEARCH LOGIC ---
document.getElementById("search-archive")?.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allArchived.filter(s => 
        (s.name && s.name.toLowerCase().includes(term)) || 
        (s.id && s.id.toString().includes(term))
    );
    renderTable(filtered);
});
// Function to apply the theme
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme); // Saves the user's preference
}

// Function to toggle the theme
function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}


document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);


    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }
});
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update button icon if the button exists on the current page
    const themeToggleBtn = document.getElementById("theme-toggle");
    if (themeToggleBtn) {
        const icon = themeToggleBtn.querySelector("i");
        if (icon) {
            icon.className = (theme === "dark") ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
        }
    }
}document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('dashboard-theme') || 'light';
    applyTheme(savedTheme);

    // Event listener for the toggle button
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const currentTheme = localStorage.getItem('dashboard-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            localStorage.setItem('dashboard-theme', newTheme);
            applyTheme(newTheme); // Update current page
        });
    }
});

window.addEventListener('storage', (event) => {
    if (event.key === 'dashboard-theme') {
        const newTheme = event.newValue;
        applyTheme(newTheme); 
    }
})