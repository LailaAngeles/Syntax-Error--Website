import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { 
    getFirestore, collection, getDocs, query, where, writeBatch, doc, updateDoc, deleteDoc, setDoc, serverTimestamp 
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
const mockStudent = {
    id: "2024-0512",
    name: "Alex Rivera",
    section: "BSCS-201",
    progress: 65,
    // raw metrics from your game levels
    gameStats: [
        { level: "Variables", wrongs: 1, time: 95 },   // Easy for them
        { level: "If-Else",   wrongs: 8, time: 420 },  // Major Struggle
        { level: "Loops",     wrongs: 4, time: 210 },  // Moderate Struggle
        { level: "Functions", wrongs: 0, time: 0 },    // Locked
        { level: "Firestore", wrongs: 0, time: 0 }     // Locked
    ],
    // Normalized 1-10 scores for the Radar Chart
    difficulty: [1, 9, 5, 0, 0] 
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Global Variables
let allStudents = [];
let currentUserSection = []; 
let sectionDocMapping = {}; 
let difficultyChart;
// =============================
// COURSE OUTLINE (SOURCE OF TRUTH)
// =============================
const COURSE_OUTLINE = [
    { level: 1, module: "C# Basics", lesson: "Variables & Data Types" },
    { level: 2, module: "Control Flow", lesson: "If-Else Statements" },
    { level: 3, module: "Loops", lesson: "For & While Loops" },
    { level: 4, module: "Functions", lesson: "Methods & Parameters" },
    { level: 5, module: "Integration", lesson: "Firestore Integration" }
];

function formatBirthdayToPassword(dateStr) {
    if (!dateStr || dateStr === "No Birthday") return "";

    // Converts 2005-01-14 -> 20050114
    return String(dateStr).replace(/-/g, "");
}

// UI Helpers
const toggleLoading = (show) => {
    const loader = document.getElementById("loading-overlay");
    if(loader) loader.style.display = show ? "flex" : "none";
};



function renderStudentInsights(students) {
    const container = document.getElementById("student-analysis");

    let struggling = students.filter(s => (s.progress || 0) < 50);

    container.innerHTML = struggling.map(s => {
        let weakestIndex = (s.difficulty || []).indexOf(Math.max(...(s.difficulty || [0])));
        let lesson = COURSE_OUTLINE[weakestIndex];

        return `
            <div class="lesson-alert">
                <strong>${s.name}</strong><br>
                Struggling with: ${lesson.module} → ${lesson.lesson}
            </div>
        `;
    }).join("") || "<p>All students performing well.</p>";
}
// ----------------------------
// 2. DATA INITIALIZATION
// ----------------------------
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../Login/Login.html";
        return;
    }
    toggleLoading(true);
    await getUserData(user);
    await fetchClassList();
    toggleLoading(false);
});

async function getUserData(user) {
    const select = document.getElementById("section-select");
    if (select) select.innerHTML = '<option value="">-- All My Sections --</option>';
    
    sectionDocMapping = {};
    currentUserSection = [];

    try {
        const q = query(collection(db, "approvedUsers"), where("email", "==", user.email));
        const userSnap = await getDocs(q);
        userSnap.forEach(doc => {
            currentUserSection = doc.data().section || [];
        });

        if(document.getElementById("user-section")) {
            document.getElementById("user-section").textContent = currentUserSection.join(", ");
        }

        const sectionSnap = await getDocs(collection(db, "sections"));
        sectionSnap.forEach(d => {
            const sectionName = d.data().name;
            sectionDocMapping[sectionName] = d.id;
            
            if (currentUserSection.includes(sectionName) && select) {
                const opt = document.createElement("option");
                opt.value = sectionName;
                opt.textContent = sectionName;
                select.appendChild(opt);
            }
        });

    } catch (error) {
        console.error("Error fetching user data:", error);
    }
}

async function fetchClassList() {
    allStudents = [];
    for (const sectionName of currentUserSection) {
        const docId = sectionDocMapping[sectionName];
        if (!docId) continue;
        
        const classRef = collection(db, "sections", docId, "classList");
        const snap = await getDocs(classRef);
        
        snap.forEach(sDoc => {
            allStudents.push({ 
                ...sDoc.data(), 
                section: sectionName, 
                parentDocId: docId 
            });
        });
    }
    loadStudents("");
}

// ----------------------------
// 3. TABLE LOADING & STAT UPDATES
// ----------------------------
function loadStudents(section) {
    const table = document.getElementById("students-table");
    const emptyState = document.getElementById("empty-state");
    const searchInput = document.getElementById("search-student");
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    if(table) table.innerHTML = "";

    let filtered = allStudents.filter(s => {
        const matchesSection = (section === "" || s.section === section);
        const matchesSearch = !searchTerm || 
                              (s.name && s.name.toLowerCase().includes(searchTerm)) || 
                              (s.id && s.id.toString().toLowerCase().includes(searchTerm));
        return matchesSection && matchesSearch;
    });

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    document.getElementById("card-total-students").textContent = filtered.length;
    let avgProg = filtered.length > 0 
        ? Math.round(filtered.reduce((acc, s) => acc + (s.progress || 0), 0) / filtered.length) 
        : 0;
    document.getElementById("average-score").textContent = avgProg + "%";

    if (filtered.length === 0) {
        if(emptyState) emptyState.style.display = "block";
        return;
    } else {
        if(emptyState) emptyState.style.display = "none";
    }

    if(table) {
        table.innerHTML = filtered.map(s => `
           
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 15px;"><strong>${s.id}</strong></td>
                <td style="padding: 15px;">${s.name}</td>
                <td style="padding: 15px;">
                    <div style="width:100px; background:#e5e7eb; border-radius:10px; height:8px; margin-bottom:4px;">
                        <div style="width:${s.progress || 0}%; background:#3b82f6; height:100%; border-radius:10px;"></div>
                    </div>
                    <small style="color:#64748b;">${s.progress || 0}% Complete</small>
                </td>
                <td style="padding: 15px;">${s.idleTime || "0m"}</td>
                <td style="padding: 15px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button onclick="viewStudent('${s.id}')" 
                                style="background: #3b82f6; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 5px; font-size: 14px;">
                            <i class="bi bi-eye"></i> Details
                        </button>
                        <button onclick="editStudent('${s.id}')" 
                                style="background:#f59e0b; color:white; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; display: flex; align-items: center; height: 35px;">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button onclick="archiveStudent('${s.id}')" 
                                style="background:#6b7280; color:white; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; display: flex; align-items: center; height: 35px;">
                            <i class="bi bi-archive"></i>
                        </button>
                    </div>
                </td>
            </tr>`).join("");
             updateInstructorSummary(filtered);
    }
}

// ----------------------------
// 4. EDIT & ARCHIVE LOGIC
// ----------------------------
window.editStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const idInput = document.getElementById("edit-id-input");
    const nameInput = document.getElementById("edit-name-input");
    const bdayInput = document.getElementById("edit-birthday-input");
    const saveBtn = document.getElementById("save-edit-btn");
    
    idInput.value = student.id;
    nameInput.value = student.name;
    bdayInput.value = student.birthday || "";
    
    document.getElementById("edit-modal").style.display = "flex";
    saveBtn.disabled = false;
    saveBtn.innerText = "Save Changes";

    saveBtn.onclick = async () => {
        const newId = idInput.value.trim();
        const newName = nameInput.value.trim();
        const newBday = bdayInput.value;
        const newPassword = formatBirthdayToPassword(newBday); // Generate Password

        if (!newId || !newName) {
            alert("Student Number and Name are required!");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerText = "Saving...";
        toggleLoading(true);

        try {
            const oldRef = doc(db, "sections", student.parentDocId, "classList", student.id);
            
            if (newId !== student.id) {
                const newRef = doc(db, "sections", student.parentDocId, "classList", newId);
                await setDoc(newRef, {
                    ...student,
                    id: newId,
                    name: newName,
                    birthday: newBday,
                    password: newPassword // Added password update
                });
                await deleteDoc(oldRef);
            } else {
                await updateDoc(oldRef, { 
                    name: newName,
                    birthday: newBday,
                    password: newPassword // Added password update
                });
            }
            
            closeEditModal();
            await fetchClassList(); 
            alert("Student record updated!");
        } catch (error) {
            console.error("Update error:", error);
            alert("Failed to update record.");
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = "Save Changes";
            toggleLoading(false);
        }
    };
};

window.closeEditModal = function() {
    document.getElementById("edit-modal").style.display = "none";
};

window.archiveStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const confirmModal = document.getElementById("confirm-modal");
    document.getElementById("confirm-title").textContent = `Archive ${student.name}?`;
    document.getElementById("confirm-message").textContent = `This student will be moved to the archive and removed from ${student.section}.`;
    confirmModal.style.display = "flex";

    document.getElementById("confirm-action-btn").onclick = async () => {
        const actionBtn = document.getElementById("confirm-action-btn");
        actionBtn.disabled = true;
        actionBtn.innerText = "Archiving...";
        
        await proceedWithArchive(student);
        
        actionBtn.disabled = false;
        actionBtn.innerText = "Confirm Archive";
        closeConfirmModal();
    };
};

async function proceedWithArchive(student) {
    toggleLoading(true);
    try {
        const archiveRef = doc(db, "archivedStudents", student.id);
        
        await setDoc(archiveRef, {
            ...student,
            archivedAt: serverTimestamp(),
            status: "archived"
        });

        const originalRef = doc(db, "sections", student.parentDocId, "classList", student.id);
        await deleteDoc(originalRef);

        alert(`${student.name} has been moved to the archive.`);
        await fetchClassList(); 
        
    } catch (error) {
        console.error("Archive Error:", error);
        alert("Failed to archive student. Please try again.");
    } finally {
        toggleLoading(false);
    }
}

window.closeConfirmModal = () => document.getElementById("confirm-modal").style.display = "none";
window.closeArchiveModal = () => document.getElementById("custom-archive-modal").style.display = "none";

// ----------------------------
// 5. INDIVIDUAL STUDENT VIEW 
// ----------------------------
let gapChart; 
let modalDifficultyChart;

window.viewStudent = function(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    // 1. OPEN MODAL & BASIC INFO
    document.getElementById("student-details-modal").style.display = "flex";
    document.getElementById("modal-student-name").textContent = student.name;
    document.getElementById("modal-student-id").textContent = student.id;
  const birthdayText = student.birthday
    ? student.birthday
    : "No Birthday Saved";

document.getElementById("modal-student-birthday").textContent =
    `Birthday: ${birthdayText}`;
    document.getElementById("modal-progress").textContent = (student.progress || 0) + "%";
    document.getElementById("modal-idle").textContent = (student.idleTime || "0") + "m";

    // 2. COURSE TOPICS (Based on LO 1-8)
    const topics = [
        "C# Basic Concepts",           // LO 1-2
        "Conditionals and Loops",      // LO 3
        "Methods",                     // LO 4
        "Classes and Objects",         // LO 5
        "Arrays and Strings",          // LO 6
        "Advanced Class Concepts",     // LO 7
        "Inheritance & Polymorphism"   // LO 8
    ];

    const difficulty = student.difficulty || [0, 0, 0, 0, 0, 0, 0];
    const highest = Math.max(...difficulty);
    const weakestIndex = difficulty.indexOf(highest);

    // Update UI Stats
    document.getElementById("modal-difficulty").textContent = `${highest}/10`;
    document.getElementById("modal-weakest-topic").textContent = topics[weakestIndex];

    // 3. DYNAMIC STATUS & ANALYSIS
    const statusBox = document.getElementById("status-card");
    const statusTitle = document.getElementById("modal-status-title");
    const perfText = document.getElementById("modal-performance-text");
    const analysisBox = document.getElementById("modal-analysis-content");

    if (highest >= 7) {
        statusBox.style.borderLeft = "6px solid #ef4444";
        statusBox.style.background = "#fef2f2";
        statusTitle.textContent = "Critical Intervention";
        perfText.textContent = "At Risk";
        perfText.className = "text-red";
        
        analysisBox.innerHTML = `
            <div style="border-left: 4px solid #ef4444; padding: 10px; background: #fef2f2;">
                <strong style="color: #b91c1c;">Gap Detected: ${topics[weakestIndex]}</strong>
                <p style="font-size: 0.85rem; margin-top: 5px; color: #b91c1c;">
                    Repeated incorrect attempts in ${topics[weakestIndex]}. Recommend review of Laboratory Activity 1-3.
                </p>
            </div>`;
    } else {
        statusBox.style.borderLeft = "6px solid #10b981";
        statusBox.style.background = "#f0fdf4";
        statusTitle.textContent = "Good Progress (C# Mastery)";
        perfText.textContent = "On Track";
        perfText.className = "text-green";

        analysisBox.innerHTML = `
            <div style="border-left: 4px solid #10b981; padding: 10px; background: #f0fdf4;">
                <strong style="color: #15803d;">Performance: On Track</strong>
                <p style="font-size: 0.85rem; margin-top: 5px; color: #15803d;">
                    Student demonstrates strong understanding. Ready for 1st Periodical Examination.
                </p>
            </div>`;
    }

    // 4. RENDER THE DIAGRAM
    const ctx = document.getElementById("modalDifficultyChart").getContext("2d");
    if (window.modalDifficultyChart instanceof Chart) {
        window.modalDifficultyChart.destroy();
    }

    window.modalDifficultyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ["Basics", "Logic", "Methods", "Classes", "Arrays", "Adv. Class", "OOP"],
            datasets: [{
                data: difficulty,
                borderRadius: 6,
                backgroundColor: difficulty.map(v => v >= 7 ? '#ef4444' : (v >= 4 ? '#f59e0b' : '#10b981'))
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 10, ticks: { stepSize: 2 } },
                x: { grid: { display: false } }
            }
        }
    });
};
window.closeStudentModal = function(){
    document.getElementById("student-details-modal").style.display = "none";
};
// --- NEW CHART FUNCTION (RADAR TYPE) ---
function renderGapChart(data) {
    const ctx = document.getElementById("gapChart")?.getContext("2d");
    if (!ctx) return;
    if (gapChart) gapChart.destroy();

    gapChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ["Variables", "Control Flow", "Loops", "Functions", "Firestore"],
            datasets: [{
                label: 'Difficulty Level',
                data: data,
                backgroundColor: 'rgba(239, 68, 68, 0.2)', // Red tint for "gaps"
                borderColor: '#ef4444',
                pointBackgroundColor: '#ef4444',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 10,
                    ticks: { display: false }
                }
            },
            plugins: { legend: { display: false } }
        }
    });
}
function calculateDifficulty(wrongs, timeInSeconds) {
    // 1 wrong = 0.5 points, every 60s = 1 point
    let score = (wrongs * 0.5) + (timeInSeconds / 60);
    return Math.min(Math.round(score), 10); // Keep it between 0-10
}
// --- NEW CONCLUSION GENERATOR ---
function renderGapConclusion(student, difficulty) {
    const container = document.getElementById("student-analysis");
    const maxVal = Math.max(...difficulty);
    const gapIndex = difficulty.indexOf(maxVal);
    const topic = COURSE_OUTLINE[gapIndex];
    
    // Check gameStats if available
    const levelStats = student.gameStats ? student.gameStats[`level${gapIndex + 1}`] : null;

    let detailNote = "";
    if (levelStats) {
        detailNote = `caused by <b>${levelStats.wrongs} incorrect attempts</b> and <b>${Math.round(levelStats.time / 60)} minutes</b> spent on this level.`;
    }

    let statement = "";
    if (maxVal > 7) {
        statement = `<strong>Critical Gap:</strong> ${student.name} is stuck on ${topic.lesson}. ${detailNote}`;
    } else if (maxVal > 0) {
        statement = `<strong>Minor Struggle:</strong> ${student.name} completed ${topic.lesson}, but showed some hesitation ${detailNote}`;
    } else {
        statement = `<strong>Perfect Run:</strong> No errors or delays recorded for current levels.`;
    }

    container.innerHTML = `
        <div style="padding: 15px; background: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 4px;">
            ${statement}
        </div>
    `;
}
function renderStudentChart(student) {

    const ctx = document.getElementById("difficultyChart")?.getContext("2d");
    if (!ctx) return;

    if (difficultyChart) difficultyChart.destroy();

    const difficulty = student.difficulty || [0,0,0,0,0];

    const labels = [
        "Variables & Data Types",
        "If-Else Statements",
        "Loops",
        "Functions",
        "Firestore"
    ];

    difficultyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Difficulty Level',
                data: difficulty,
                borderRadius: 10,
                borderSkipped: false,
                backgroundColor: difficulty.map(v => {

                    // Hard
                    if (v >= 7) return '#ef4444';

                    // Moderate
                    if (v >= 4) return '#f59e0b';

                    // Easy
                    return '#10b981';
                })
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                },

                tooltip: {
                    callbacks: {
                        label: function(context) {

                            const value = context.raw;

                            if (value >= 7)
                                return `Hard Difficulty (${value}/10)`;

                            if (value >= 4)
                                return `Moderate Difficulty (${value}/10)`;

                            return `Easy Difficulty (${value}/10)`;
                        }
                    }
                }
            },

            scales: {
                y: {
                    beginAtZero: true,
                    max: 10,
                    ticks: {
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: "Difficulty Score"
                    }
                }
            }
        }
    });

    // =========================
    // ADDITIONAL ANALYSIS
    // =========================

    renderAdvancedAnalysis(student);
}
function renderAdvancedAnalysis(student) {

    const container = document.getElementById("student-analysis");

    const difficulty = student.difficulty || [0,0,0,0,0];

    const topics = [
        {
            lesson: "Variables & Data Types",
            explanation: "Student struggles in understanding variable declaration, assigning values, and identifying proper data types."
        },

        {
            lesson: "If-Else Statements",
            explanation: "Student struggles in understanding decision making and logical conditions."
        },

        {
            lesson: "Loops",
            explanation: "Student struggles in repetition logic and controlling loop execution."
        },

        {
            lesson: "Functions",
            explanation: "Student struggles in method creation, parameters, and code organization."
        },

        {
            lesson: "Firestore",
            explanation: "Student struggles in database integration and backend communication."
        }
    ];

    const highest = Math.max(...difficulty);
    const weakestIndex = difficulty.indexOf(highest);

    const weakestTopic = topics[weakestIndex];

    // Difficulty Meaning
    let level = "";
    let recommendation = "";
    let severityColor = "";

    if (highest >= 7) {

        level = "Critical Learning Gap";

        severityColor = "#ef4444";

        recommendation =
            "Teacher should reteach this lesson step-by-step with visual demonstrations and guided coding exercises.";

    }
    else if (highest >= 4) {

        level = "Moderate Difficulty";

        severityColor = "#f59e0b";

        recommendation =
            "Student understands some concepts but still needs additional practice and reinforcement activities.";

    }
    else {

        level = "Good Understanding";

        severityColor = "#10b981";

        recommendation =
            "Student shows good understanding and may proceed to more advanced challenges.";

    }

    // Time + Wrong Attempts
    let wrongs = 0;
    let timeSpent = 0;

    if (student.gameStats && student.gameStats[weakestIndex]) {

        wrongs = student.gameStats[weakestIndex].wrongs || 0;
        timeSpent = student.gameStats[weakestIndex].time || 0;
    }

    // Teacher Insights
    let teacherInsight = "";

    if (wrongs >= 5) {

        teacherInsight =
            "The student repeatedly made incorrect attempts, indicating confusion with the lesson logic rather than simple syntax errors.";

    }
    else if (timeSpent >= 300) {

        teacherInsight =
            "The student spent a long time solving the activity, suggesting hesitation and lack of confidence.";

    }
    else {

        teacherInsight =
            "The student was able to continue with manageable difficulty.";
    }

    container.innerHTML = `

        <div style="
            background:white;
            border-radius:12px;
            padding:20px;
            display:flex;
            flex-direction:column;
            gap:18px;
            box-shadow:0 4px 15px rgba(0,0,0,0.08);
        ">

            <div style="
                padding:15px;
                border-left:6px solid ${severityColor};
                background:#f8fafc;
                border-radius:8px;
            ">

                <h3 style="margin:0; color:${severityColor};">
                    ${level}
                </h3>

                <p style="margin-top:10px; line-height:1.6;">
                    <strong>${student.name}</strong> is currently struggling most in
                    <strong>${weakestTopic.lesson}</strong>.
                </p>

                <p style="line-height:1.6;">
                    ${weakestTopic.explanation}
                </p>

            </div>

            <div style="
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
                gap:15px;
            ">

                <div style="
                    background:#f1f5f9;
                    padding:15px;
                    border-radius:10px;
                ">
                    <h4>Wrong Attempts</h4>
                    <div style="
                        font-size:28px;
                        font-weight:bold;
                        color:#ef4444;
                    ">
                        ${wrongs}
                    </div>
                </div>

                <div style="
                    background:#f1f5f9;
                    padding:15px;
                    border-radius:10px;
                ">
                    <h4>Time Spent</h4>
                    <div style="
                        font-size:28px;
                        font-weight:bold;
                        color:#3b82f6;
                    ">
                        ${Math.round(timeSpent / 60)} mins
                    </div>
                </div>

                <div style="
                    background:#f1f5f9;
                    padding:15px;
                    border-radius:10px;
                ">
                    <h4>Difficulty Score</h4>
                    <div style="
                        font-size:28px;
                        font-weight:bold;
                        color:#f59e0b;
                    ">
                        ${highest}/10
                    </div>
                </div>

            </div>

            <div style="
                background:#eff6ff;
                padding:18px;
                border-radius:10px;
                border-left:5px solid #3b82f6;
            ">

                <h4 style="margin-top:0;">
                    Teacher Insight
                </h4>

                <p style="line-height:1.7;">
                    ${teacherInsight}
                </p>

            </div>

            <div style="
                background:#f0fdf4;
                padding:18px;
                border-radius:10px;
                border-left:5px solid #10b981;
            ">

                <h4 style="margin-top:0;">
                    Suggested Intervention
                </h4>

                <p style="line-height:1.7;">
                    ${recommendation}
                </p>

            </div>

        </div>
    `;
}
// ----------------------------
// 6. EXCEL IMPORT LOGIC
// ----------------------------
window.updateFileName = function(input) {
    const label = document.getElementById("file-name-text"); 
    if (input.files.length > 0) {
        const name = input.files[0].name;
        if(label) {
            label.textContent = name;
            label.style.fontWeight = "600";
        }
    }
};


function excelDateToJSDate(value) {

    // Excel serial number
    if (typeof value === "number") {

        const date = new Date((value - 25569) * 86400 * 1000);

        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(date.getUTCDate()).padStart(2, "0");

        return `${yyyy}-${mm}-${dd}`;
    }

    if (typeof value === "string") {

        const raw = value.trim();

        // Handles 14/01/2005 or 14-01-2005
        const parts = raw.split(/[\/\-\.]/);

        if (parts.length === 3) {

            let [day, month, year] = parts;

            day = day.padStart(2, "0");
            month = month.padStart(2, "0");

            if (year.length === 2) {
                year = "20" + year;
            }

            return `${year}-${month}-${day}`;
        }
    }

    return "";
}
window.importExcel = async function () {
    const input = document.getElementById("excel-input");
    const sectionSelect = document.getElementById("section-select");
    const label = document.getElementById("file-name-text");

    if (!input.files.length) return alert("Please choose a file first!");
    if (!sectionSelect.value) return alert("Please select a section before importing!");

    const selectedSectionName = sectionSelect.value;
    const parentDocId = sectionDocMapping[selectedSectionName];

    const reader = new FileReader();
    reader.onload = async (e) => {
        toggleLoading(true);
        try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
            const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            const batch = writeBatch(db);

           
            const allExistingIds = new Set(
                allStudents.map(s => String(s.id))
            );

            
            try {
                const archiveSnap = await getDocs(collection(db, "archivedStudents"));
                archiveSnap.forEach(doc => {
                    allExistingIds.add(String(doc.id));
                });
                console.log(`✅ Found ${archiveSnap.size} archived students - preventing duplicates`);
            } catch (archiveError) {
                console.warn("Could not check archive collection:", archiveError);
            }

            let addedCount = 0;
            let skippedCount = 0;
            let skippedActiveCount = 0;
            let skippedArchiveCount = 0;

            data.forEach(row => {

    // =========================
    // EXCEL COLUMN ORDER
    // =========================
    // Column 1 = Student Number
    // Column 2 = Name
    // Column 3 = Email
    // Column 4 = Birthday

    const values = Object.values(row);

    const sId = String(values[0] || "").trim();
    const sName = values[1] || "Unknown";
    const sEmail = values[2] || "No Email";
    const rawBirthday = values[3];

    console.log("RAW BIRTHDAY:", rawBirthday);

    // Convert Excel date properly
    const sBirthday = excelDateToJSDate(rawBirthday);

    console.log("PARSED BIRTHDAY:", sBirthday);

    // Default password = birthday
    // Example:
    // 2005-01-14 -> 20050114
    const sPassword = formatBirthdayToPassword(sBirthday);

    // Skip empty student number
    if (!sId) return;

    // =========================
    // CHECK DUPLICATES
    // =========================
                if (!allExistingIds.has(sId)) {

                    const studentRef = doc(
                        db,
                        "sections",
                        parentDocId,
                        "classList",
                        sId
                    );

                    batch.set(studentRef, {

                        id: sId,
                        name: sName,
                        email: sEmail,

                        // IMPORTANT
                        birthday: sBirthday,

                        // IMPORTANT
                        password: sPassword,

                        progress: 0,
                        idleTime: "0m",

                        difficulty: [0, 0, 0, 0, 0],

                        attempts: []
                    });

                    console.log("✅ SAVED:", {
                        id: sId,
                        birthday: sBirthday,
                        password: sPassword
                    });

                    addedCount++;
                    allExistingIds.add(sId);

                } else {

                    skippedCount++;

                    const isActive = allStudents.some(s => s.id === sId);

                    if (isActive) {
                        skippedActiveCount++;
                    } else {
                        skippedArchiveCount++;
                    }
                }
            });

            if (addedCount > 0) {
                await batch.commit();
                alert(`Import Complete!\n` +
                      `Added: ${addedCount} new students\n` +
                      `Skipped Active: ${skippedActiveCount}\n` +
                      `Skipped Archived: ${skippedArchiveCount}`);
                await fetchClassList();
            } else {
                alert(`No new students found.\n` +
                      `Active duplicates: ${skippedActiveCount}\n` +
                      `Archived duplicates: ${skippedArchiveCount}`);
            }

            // Reset file input
            input.value = "";
            if (label) {
                label.textContent = "Choose File";
                label.style.fontWeight = "normal";
            }

        } catch (err) {
            console.error(err);
            alert("Error reading Excel file.");
        } finally {
            toggleLoading(false);
        }
    };

    reader.readAsArrayBuffer(input.files[0]);
};

window.handlePasswordReset = function() {
    const modal = document.getElementById("reset-password-modal");
    const sectionDrop = document.getElementById("reset-section-select");
    const searchInput = document.getElementById("reset-search-input");
    const studentDrop = document.getElementById("reset-student-select");
    
    // Reset modal UI
    document.getElementById("reset-step-1").style.display = "block";
    document.getElementById("reset-step-2").style.display = "none";
    searchInput.value = "";
    
    // Fill Sections
    sectionDrop.innerHTML = '<option value="">-- Select Section --</option>';
    currentUserSection.forEach(sec => {
        const opt = document.createElement("option");
        opt.value = sec;
        opt.textContent = sec;
        sectionDrop.appendChild(opt);
    });

    // Function to filter students based on Section AND Search Input
    const filterResetList = () => {
        const selectedSec = sectionDrop.value;
        const term = searchInput.value.toLowerCase();
        
        studentDrop.innerHTML = '';
        
        if (!selectedSec) {
            studentDrop.innerHTML = '<option disabled>Please select a section first...</option>';
            return;
        }

        const filtered = allStudents.filter(s => {
            const matchesSection = s.section === selectedSec;
            const matchesSearch = s.name.toLowerCase().includes(term) || 
                                  s.id.toString().includes(term);
            return matchesSection && matchesSearch;
        });

        if (filtered.length === 0) {
            studentDrop.innerHTML = '<option disabled>No students found...</option>';
        } else {
            filtered.sort((a,b) => a.name.localeCompare(b.name)).forEach(s => {
                const opt = document.createElement("option");
                opt.value = s.id;
                opt.textContent = `${s.name} (${s.id})`;
                studentDrop.appendChild(opt);
            });
        }
    };

    // Listeners for typing and section changing
    sectionDrop.onchange = filterResetList;
    searchInput.oninput = filterResetList;

    modal.style.display = "flex";
};

window.closeResetModal = () => {
    document.getElementById("reset-password-modal").style.display = "none";
};

window.confirmResetSelection = function() {
    const studentId = document.getElementById("reset-student-select").value;
    
    if (!studentId) {
        alert("Please select a student from the list!");
        return;
    }

    const student = allStudents.find(s => s.id === studentId);
    
    document.getElementById("reset-step-1").style.display = "none";
    document.getElementById("reset-step-2").style.display = "block";
    document.getElementById("reset-confirm-text").innerHTML = 
        `<i class="bi bi-exclamation-triangle"></i> You are about to reset the password for <b>${student.name}</b>. This action cannot be undone.`;

    document.getElementById("final-reset-btn").onclick = () => saveNewPassword(student);
};

window.backToStep1 = () => {
    document.getElementById("reset-step-1").style.display = "block";
    document.getElementById("reset-step-2").style.display = "none";
};

async function saveNewPassword(student) {
    const newPass = document.getElementById("new-password-input").value.trim();
    if (newPass.length < 4) {
        alert("Password must be at least 4 characters long.");
        return;
    }

    toggleLoading(true);
    try {
        // Targets the student document inside the specific section's classList
        const studentRef = doc(db, "sections", student.parentDocId, "classList", student.id);
        
        await updateDoc(studentRef, {
            password: newPass
        });

        alert(`Success! Password for ${student.name} has been updated.`);
        closeResetModal();
        await fetchClassList(); // Refresh data to keep system in sync
    } catch (error) {
        console.error("Firestore Update Error:", error);
        alert("Failed to update password. Please check your connection.");
    } finally {
        toggleLoading(false);
    }
}
// Event Listeners
document.getElementById("excel-input")?.addEventListener("change", function() {
    updateFileName(this);
});

document.getElementById("section-select")?.addEventListener("change", (e) => loadStudents(e.target.value));
document.getElementById("search-student")?.addEventListener("input", () => {
    const sec = document.getElementById("section-select").value;
    loadStudents(sec);
});// ----------------------------
// 7. LESSON GAP ANALYSIS ENGINE (NEW - SAFE APPEND)
// ----------------------------
function generateInstructorSummary(students) {
    if (!students || students.length === 0) {
        return "No student data available for analysis.";
    }

    let avgProgress = students.reduce((acc, s) => acc + (s.progress || 0), 0) / students.length;

    let avgIdle = students.reduce((acc, s) => {
        let time = parseInt((s.idleTime || "0").replace("m", ""));
        return acc + (isNaN(time) ? 0 : time);
    }, 0) / students.length;

    let difficultyTotals = [0, 0, 0, 0, 0];

    students.forEach(s => {
        (s.difficulty || [0,0,0,0,0]).forEach((val, i) => {
            difficultyTotals[i] += val;
        });
    });

    let difficultyAvg = difficultyTotals.map(d => d / students.length);

    // Identify hardest level
    let maxDifficulty = Math.max(...difficultyAvg);
    let hardestLevelIndex = difficultyAvg.indexOf(maxDifficulty);
    let hardestLevel = `Level ${hardestLevelIndex + 1}`;

    // ----------------------------
    // INTERPRETATION LOGIC
    // ----------------------------
    let roadblock = "";
    let reason = "";
    let recommendation = "";

    if (maxDifficulty >= 7) {
        roadblock = `${hardestLevel} - Complex Logic & Problem Solving`;

        reason = `Students show high difficulty (${maxDifficulty.toFixed(1)}/10) at ${hardestLevel}, indicating they struggle when tasks require combining multiple concepts.`;

        recommendation = `Break the problem into smaller steps and guide students through each step before coding. Encourage them to explain their logic before writing code.`;

    } else if (avgProgress < 50) {
        roadblock = `Early Programming Concepts (Variables / Output)`;

        reason = `Average progress is only ${Math.round(avgProgress)}%, suggesting students are not confidently completing even basic tasks.`;

        recommendation = `Reinforce fundamentals using simple examples and repetition. Use guided exercises before independent tasks.`;

    } else if (avgIdle > 10) {
        roadblock = `Code Understanding & Debugging`;

        reason = `High idle time (~${Math.round(avgIdle)} minutes) suggests students are getting stuck and unsure how to proceed.`;

        recommendation = `Introduce step-by-step tracing. Ask students to predict outputs before running their code.`;

    } else {
        roadblock = `Applying Concepts Independently`;

        reason = `Students perform well initially but show difficulty as tasks become less guided.`;

        recommendation = `Provide scaffolded challenges that gradually reduce hints to build independence.`;
    }

    return `
        <strong>📌 Identified Roadblock:</strong><br>
        ${roadblock}
        <br><br>

        <strong>📊 Why This is Happening:</strong><br>
        ${reason}
        <br><br>

        <strong>✅ Teaching Recommendation:</strong><br>
        ${recommendation}
    `;
}


// ----------------------------
// 8. UPDATE UI WITH SUMMARY
// ----------------------------
function updateInstructorSummary(filteredStudents) {
    const container = document.getElementById("instructor-summary-content");
    if (!container) return;

    const summary = generateInstructorSummary(filteredStudents);
    container.innerHTML = summary;
}

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
    document.getElementById("logout-popup").style.display = "none";
};

window.showLogoutPopup = () => {
    document.getElementById("logout-popup").style.display = "flex";
};
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

// 3. Listen for changes from OTHER tabs/files
window.addEventListener('storage', (event) => {
    if (event.key === 'dashboard-theme') {
        const newTheme = event.newValue;
        applyTheme(newTheme); // Update this page when the other one changes
    }
})