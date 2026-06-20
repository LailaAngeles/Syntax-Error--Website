import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

// ----------------------------
// CONFIG & INITIALIZATION
// ----------------------------
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

// Global State
let allStudentsData = [];
let mySections = [];
let trendChart;
let distChart;


const concepts = [
    "C# Basic Concepts (Variables, I/O)",   // Week 1-2 [cite: 8]
    "Conditionals and Loops",               // Week 3-4 [cite: 8]
    "Methods (Overloading, Recursion)",     // Week 5-6 [cite: 10]
    "Classes and Objects",                  // Week 7-8 [cite: 10]
    "Arrays and Strings",                   // Week 10-11 
    "Advanced Classes (Static, Indexers)",  // Week 12 
    "Inheritance and Polymorphism",         // Week 13-14 
    "Exceptions and Files",                 // Week 15 [cite: 12]
    "Generics and Collections"              // Week 16 [cite: 12]
];

// ----------------------------
// 1. AUTH & DATA LOADING
// ----------------------------
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "dashboard.html";
        return;
    }
    await loadTeacherDashboard(user);
});
// --- DYNAMIC MATRIX THEME ENGINE INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
    const themeToggleBtn = document.getElementById("theme-toggle");
    const htmlElement = document.documentElement;

    // Load saved preference state, fallback to system mode default
    const savedTheme = localStorage.getItem("dashboard-theme") || "light";
    htmlElement.setAttribute("data-theme", savedTheme);
    updateToggleIcon(savedTheme);

    themeToggleBtn?.addEventListener("click", () => {
        const currentTheme = htmlElement.getAttribute("data-theme");
        const newTheme = currentTheme === "light" ? "dark" : "light";
        
        htmlElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("dashboard-theme", newTheme);
        updateToggleIcon(newTheme);
    });

    function updateToggleIcon(theme) {
        const icon = themeToggleBtn?.querySelector("i");
        if (icon) {
            if (theme === "dark") {
                icon.className = "bi bi-sun-fill";
            } else {
                icon.className = "bi bi-moon-stars-fill";
            }
        }
    }
});
async function loadTeacherDashboard(user) {
    // 1. SHOW LOADING OVERLAY
    const loader = document.getElementById("loading-overlay");
    if (loader) loader.style.display = "flex";

    try {
        // Find teacher's assigned sections from approvedUsers
        const q = query(collection(db, "approvedUsers"), where("email", "==", user.email));
        const userSnap = await getDocs(q);
        userSnap.forEach(doc => { mySections = doc.data().section || []; });

        document.getElementById("user-section-display").textContent = mySections.join(", ");

        // Fetch ClassList from each assigned section
        const sectionSnap = await getDocs(collection(db, "sections"));
        const select = document.getElementById("section-select");

        // Reset data for fresh load
        allStudentsData = [];
        if (select) select.innerHTML = '<option value="">All My Sections</option>';
        
        for (const sDoc of sectionSnap.docs) {
            const sName = sDoc.data().name;
            if (mySections.includes(sName)) {
                // Populate Dropdown
                const opt = document.createElement("option");
                opt.value = sName; opt.textContent = sName;
                if (select) select.appendChild(opt);

                // Fetch subcollection: sections/[id]/classList
                const classSnap = await getDocs(collection(db, "sections", sDoc.id, "classList"));
                classSnap.forEach(student => {
                    allStudentsData.push({ ...student.data(), section: sName });
                });
            }
        }

        renderAnalytics(""); // Initial render with all data
    } catch (error) {
        console.error("Dashboard Load Error:", error);
    } finally {
        // 2. HIDE LOADING OVERLAY
        if (loader) loader.style.display = "none";
    }
}

// ----------------------------
// 2. CORE ANALYTICS LOGIC
// ----------------------------
function renderAnalytics(filterSection) {
    const table = document.getElementById("analytics-table");
    if (!table) return;
    table.innerHTML = "";

    const students = filterSection ? allStudentsData.filter(s => s.section === filterSection) : allStudentsData;
    
    // Preparation for Charts & Stats
    let criticalCount = 0;
    let masteryCount = 0;
    let reviewCount = 0;
    const avgScores = [];

    concepts.forEach((concept, i) => {
        let totalScore = 0;
        let count = 0;

        students.forEach(s => {
            // Difficulty array from game corresponds to the lesson index
            if (s.difficulty && s.difficulty[i] !== undefined) {
                totalScore += s.difficulty[i];
                count++;
            }
        });

        const avg = count > 0 ? parseFloat((totalScore / count).toFixed(1)) : 0;
        avgScores.push(avg);

        // Define thresholds (High score = Student finding it difficult)
        let status, badgeClass;
        if (avg >= 7.5) {
            status = "Hardest Topic"; // Critical Difficulty
            badgeClass = "red-badge";
            criticalCount++;
        } else if (avg >= 4.5) {
            status = "Needs Review";
            badgeClass = "orange-badge";
            reviewCount++;
        } else {
            status = "Mastered";
            badgeClass = "green-badge";
            masteryCount++;
        }

        // Inject Row with Curriculum Lesson Name
        table.innerHTML += `
            <tr>
                <td><strong>Module ${i+1}:</strong> ${concept}</td>
                <td>${avg} / 10</td>
                <td><span class="status-dot ${badgeClass}">${status}</span></td>
            </tr>
        `;
    });

    // Update Summary Cards
    document.getElementById("total-students").textContent = students.length;
    document.getElementById("at-risk-count").textContent = criticalCount;
    const rate = students.length > 0 ? Math.round((masteryCount / concepts.length) * 100) : 0;
    document.getElementById("mastery-rate").textContent = rate + "%";

    // Update Visualizations
    updateTrendChart(avgScores);
    updateDistributionChart(criticalCount, reviewCount, masteryCount);
}

// ----------------------------
// 3. CHARTS (CHART.JS)
// ----------------------------
function updateTrendChart(dataValues) {
    const canvas = document.getElementById("overallDifficultyChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (trendChart) trendChart.destroy();

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: concepts.map((_, i) => `Mod ${i+1}`),
            datasets: [{
                label: 'Avg Difficulty Score',
                data: dataValues,
                borderColor: '#1f2937',
                backgroundColor: 'rgba(31, 41, 55, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, max: 10 } }
        }
    });
}

function updateDistributionChart(red, orange, green) {
    const canvas = document.getElementById("distributionChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (distChart) distChart.destroy();

    distChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Hardest', 'Review', 'Mastered'],
            datasets: [{
                data: [red, orange, green],
                backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

// ----------------------------
// 4. UI EVENT LISTENERS
// ----------------------------
document.getElementById("section-select")?.addEventListener("change", (e) => {
    renderAnalytics(e.target.value);
});

/*window.logoutUser = () => {
    signOut(auth).then(() => {
        window.location.href = '../Components/LogIn.html';
    }).catch((error) => {
        console.error("Logout Error:", error);
        window.location.href = '../Components/LogIn.html';
    });
};*/
window.logoutUser = async () => {
    try {
        await signOut(auth);
     
        window.location.href = '../index.html'; 
    } catch (error) {
        console.error("Logout error", error);
    }
};

window.closeLogoutPopup = () => {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "none";
};

window.showLogoutPopup = () => {
    const popup = document.getElementById("logout-popup");
    if (popup) popup.style.display = "flex";
};
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('dashboard-theme') || 'light';
    applyTheme(savedTheme);

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const currentTheme = localStorage.getItem('dashboard-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            localStorage.setItem('dashboard-theme', newTheme);
            applyTheme(newTheme); 
        });
    }
});

window.addEventListener('storage', (event) => {
    if (event.key === 'dashboard-theme') {
        const newTheme = event.newValue;
        applyTheme(newTheme); 
    }
})