import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  doc,
  getDoc,
  setDoc,
  increment,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  updateDoc,
  arrayUnion,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAOzUb2_VSPwGOQP0n83rHt93_1TmjJvLc",
  authDomain: "pfunani-caring-foundation.firebaseapp.com",
  projectId: "pfunani-caring-foundation",
  storageBucket: "pfunani-caring-foundation.appspot.com",
  messagingSenderId: "272050789215",
  appId: "1:272050789215:web:5a62496a24ad87fa61b4ea"
};

console.log("Initializing Firebase...");
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
console.log("Firebase initialized");


window.firebaseServices = {
  db,
  collection,
  getDocs,
  addDoc,
  doc,
  getDoc,
  setDoc,
  increment,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  updateDoc,
  arrayUnion,
  deleteDoc,
  serverTimestamp
};



// REPORTS PAGE 
window.attachReportsPageListeners = function () {
  const form = document.getElementById("generateReportForm");
  const typeEl = document.getElementById("report-type");
  const rangeEl = document.getElementById("date-range");
  const resultsEl = document.getElementById("reportResults");

  if (!typeEl || !rangeEl || !resultsEl) {
    console.error("Reports UI not found");
    return;
  }

  const { db, collection, getDocs, addDoc, onSnapshot } = window.firebaseServices;

  
  const totalChildrenEl = document.getElementById("totalChildren");
  const activeProgramsEl = document.getElementById("activePrograms");
  const attendanceRateEl = document.getElementById("attendanceRate");
  const volunteerCountEl = document.getElementById("volunteerCount");

  
  onSnapshot(collection(db, "children"), (snap) => {
    totalChildrenEl.textContent = snap.size;
  }, (err) => console.error("children snapshot err", err));

  // programs active count
  onSnapshot(collection(db, "programs"), (snap) => {
    let active = 0;
    snap.forEach(d => {
      const data = d.data();
      if ((data.status || "").toLowerCase() === "active" || (data.status || "").toLowerCase() === "ongoing") active++;
    });
    activeProgramsEl.textContent = active;
  }, (err) => console.error("programs snapshot err", err));

  // volunteers / members count
  onSnapshot(collection(db, "members"), (snap) => {
    volunteerCountEl.textContent = snap.size;
  }, (err) => console.error("members snapshot err", err));

  // attendance rate: compute average percent if attendance records include presentCount & totalCount
  onSnapshot(collection(db, "attendanceRecords"), (snap) => {
    let totalPercent = 0;
    let countWithFields = 0;
    snap.forEach(d => {
      const rec = d.data();
      if (typeof rec.presentCount === "number" && typeof rec.totalCount === "number" && rec.totalCount > 0) {
        totalPercent += (rec.presentCount / rec.totalCount) * 100;
        countWithFields++;
      }
    });
    if (countWithFields > 0) {
      attendanceRateEl.textContent = `${Math.round(totalPercent / countWithFields)}%`;
    } else {
      attendanceRateEl.textContent = "N/A";
    }
  }, (err) => {
    // if collection not present, fallback to compute from enrollments/attendance if available
    console.warn("attendanceRecords snapshot error or not present", err);
    attendanceRateEl.textContent = "N/A";
  });

  // helper: convert date-range key to start date
  function rangeToStartDate(key) {
    const end = new Date();
    const start = new Date(end);
    if (key === "last_week") start.setDate(end.getDate() - 7);
    else if (key === "last_month") start.setMonth(end.getMonth() - 1);
    else if (key === "last_year") start.setFullYear(end.getFullYear() - 1);
    else start.setFullYear(1970);
    return start;
  }

  async function fetchCollectionWithinRange(colName, startDate, dateFields = ["createdAt", "enrolledAt", "date", "timestamp"]) {
    try {
      const snap = await getDocs(collection(db, colName));
      const items = [];
      snap.forEach(s => {
        const d = s.data();
        d._id = s.id;
        const dateString = dateFields.map(f => d[f]).find(Boolean);
        d._parsedDate = dateString ? new Date(dateString) : null;
        items.push(d);
      });
      return items.filter(it => !it._parsedDate || it._parsedDate >= startDate);
    } catch (err) {
      console.warn(`read ${colName} failed`, err);
      return [];
    }
  }

  async function generateReport(reportType, dateRangeKey) {
    resultsEl.innerHTML = "<p>Generating report...</p>";
    const startDate = rangeToStartDate(dateRangeKey);

    try {
      if (reportType === "attendance") {
        let attendance = await fetchCollectionWithinRange("attendanceRecords", startDate, ["date", "timestamp", "createdAt"]);
        if (attendance.length === 0) {
          attendance = await fetchCollectionWithinRange("enrollments", startDate, ["enrolledAt", "createdAt"]);
        }

        const totalSessions = attendance.length;
        const byProgram = {};
        attendance.forEach(a => {
          const pid = a.programId || "unknown";
          byProgram[pid] = (byProgram[pid] || 0) + 1;
        });

        // resolve program names
        const programsSnap = await getDocs(collection(db, "programs"));
        const programMap = {};
        programsSnap.forEach(p => {
          programMap[p.id] = (p.data && p.data().name) || (p.data && p.data().name) || p.data()?.name || "Program";
        });

        let html = `<h3>Attendance report (${dateRangeKey.replace("_", " ")})</h3>`;
        html += `<p>Total records: ${totalSessions}</p><ul>`;
        for (const pid in byProgram) {
          const name = programMap[pid] || pid;
          html += `<li><strong>${name}</strong>: ${byProgram[pid]}</li>`;
        }
        html += `</ul>`;

        // save summary
        await addDoc(collection(db, "reports"), {
          type: "attendance",
          range: dateRangeKey,
          generatedAt: new Date().toISOString(),
          summary: { totalRecords: totalSessions, byProgram }
        });

        resultsEl.innerHTML = html;
        return;
      }

      if (reportType === "enrollment") {
        const enrollments = await fetchCollectionWithinRange("enrollments", startDate, ["enrolledAt", "createdAt"]);
        const programsSnap = await getDocs(collection(db, "programs"));
        const programMap = {};
        programsSnap.forEach(p => programMap[p.id] = p.data ? p.data().name : p.data()?.name || "Program");

        const byProgram = {};
        enrollments.forEach(e => {
          const pid = e.programId || "unknown";
          byProgram[pid] = (byProgram[pid] || 0) + 1;
        });

        let html = `<h3>Enrollment report (${dateRangeKey.replace("_", " ")})</h3>`;
        html += `<p>Total enrollments: ${enrollments.length}</p><ul>`;
        for (const pid in byProgram) {
          const name = programMap[pid] || pid;
          html += `<li><strong>${name}</strong>: ${byProgram[pid]}</li>`;
        }
        html += `</ul>`;

        await addDoc(collection(db, "reports"), {
          type: "enrollment",
          range: dateRangeKey,
          generatedAt: new Date().toISOString(),
          summary: { totalEnrollments: enrollments.length, byProgram }
        });

        resultsEl.innerHTML = html;
        return;
      }

      if (reportType === "performance") {
        const performance = await fetchCollectionWithinRange("performance", startDate, ["date", "createdAt"]);
        let html = `<h3>Performance report (${dateRangeKey.replace("_", " ")})</h3>`;
        if (performance.length === 0) {
          html += `<p>No performance records found for the selected range.</p>`;
        } else {
          const avgScore = (performance.reduce((s, r) => s + (r.score || 0), 0) / Math.max(1, performance.length)).toFixed(2);
          html += `<p>Records: ${performance.length}</p>`;
          html += `<p>Average score: ${avgScore}</p>`;
        }

        await addDoc(collection(db, "reports"), {
          type: "performance",
          range: dateRangeKey,
          generatedAt: new Date().toISOString(),
          summary: { count: performance.length }
        });

        resultsEl.innerHTML = html;
        return;
      }

      resultsEl.innerHTML = "<p>Please select a valid report type.</p>";
    } catch (err) {
      console.error("Report generation failed:", err);
      resultsEl.innerHTML = `<p class="error">Failed to generate report. See console for details.</p>`;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = typeEl.value;
    const range = rangeEl.value;
    if (!type || !range) {
      resultsEl.innerHTML = "<p>Please choose a report type and date range.</p>";
      return;
    }
    generateReport(type, range);
  });
};

// Wait for DOM to be fully loaded before attaching event listeners
document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM loaded - attaching event listeners");

  // Password toggle functionality
  const loginPasswordToggle = document.getElementById('loginPasswordToggle');
  const loginPasswordInput = document.getElementById('loginPassword');
  
  const registerPasswordToggle = document.getElementById('registerPasswordToggle');
  const registerPasswordInput = document.getElementById('password');

  function togglePasswordVisibility(toggleButton, passwordInput) {
    if (passwordInput && toggleButton) {
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleButton.textContent = 'Hide';
      } else {
        passwordInput.type = 'password';
        toggleButton.textContent = 'Show';
      }
    }
  }

  if (loginPasswordToggle && loginPasswordInput) {
    loginPasswordToggle.addEventListener('click', () => togglePasswordVisibility(loginPasswordToggle, loginPasswordInput));
  }

  if (registerPasswordToggle && registerPasswordInput) {
    registerPasswordToggle.addEventListener('click', () => togglePasswordVisibility(registerPasswordToggle, registerPasswordInput));
  }

  // Role selection styling
  document.querySelectorAll('.role-option').forEach(option => {
    option.addEventListener('click', function() {
      const radio = this.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        
        // Update styling for all options in the same group
        const groupName = radio.name;
        document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
          r.closest('.role-option').classList.remove('selected');
        });
        
        this.classList.add('selected');
      }
    });
  });

  // Initialize role selection styling for pre-selected values
  document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
    radio.closest('.role-option').classList.add('selected');
  });

  // Ripple effect for buttons
  document.querySelectorAll('.auth-button').forEach(button => {
    button.addEventListener('click', function(e) {
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      
      const ripple = document.createElement('span');
      ripple.classList.add('ripple');
      ripple.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        left: ${x}px;
        top: ${y}px;
      `;
      
      this.appendChild(ripple);
      
      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });

  // Register form submission
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    console.log("Register form found, attaching listener");
    registerForm.addEventListener("submit", handleRegister);
  } else {
    console.log("Register form not found on this page");
  }

  // Login form submission
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    console.log("Login form found, attaching listener");
    loginForm.addEventListener("submit", handleLogin);
  } else {
    console.log("Login form not found on this page");
  }
});

// REGISTER PAGE
async function handleRegister(e) {
  e.preventDefault();
  console.log("Register form submitted");

  const name = document.getElementById("fullname").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const role = document.querySelector('input[name="role"]:checked')?.value;

  console.log("Register form submitted with values:", { name, email, role });

  if (!name || !email || !password || !role) {
    alert("Please fill in all fields");
    return;
  }

  try {
    console.log("Creating Firebase Auth user...");
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    console.log("Auth user created. UID:", uid);

    console.log("Saving user role to Firestore...");
    await setDoc(doc(db, "users", uid), {
      name,
      email,
      role,
      createdAt: new Date().toISOString(),
      registrationDate: new Date().toISOString()
    });

    // If the user is a volunteer, also add them to the members collection
    if (role === "volunteer") {
      console.log("Adding volunteer to members collection...");
      const memberData = {
        fullName: name,
        email: email,
        role: "Volunteer",
        status: "active",
        userId: uid,
        registrationDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        phone: "",
        address: "",
        availability: []
      };
      
      await addDoc(collection(db, "members"), memberData);
      console.log("Volunteer added to members collection successfully");

      // Add to recent activity
      await addDoc(collection(db, "recentActivity"), {
        title: "New Volunteer Registered",
        details: `${name} has joined as a volunteer`,
        type: "volunteer_registration",
        timestamp: new Date().toISOString(),
        userId: uid
      });
    }
    // If the user is a partner, add them to partners collection
    else if (role === "partner") {
      console.log("Adding partner to partners collection...");
      const partnerData = {
        fullName: name,
        email: email,
        role: "Partner",
        status: "active",
        userId: uid,
        registrationDate: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        phone: "",
        address: "",
        organization: ""
      };
      
      await addDoc(collection(db, "partners"), partnerData);
      console.log("Partner added to partners collection successfully");

      // Add to recent activity
      await addDoc(collection(db, "recentActivity"), {
        title: "New Partner Registered",
        details: `${name} has joined as a partner`,
        type: "partner_registration",
        timestamp: new Date().toISOString(),
        userId: uid
      });
    }

    console.log("User registration completed successfully");
    alert("Account created! Please log in.");
    window.location.href = "index.html";
  } catch (error) {
    console.error("Error during registration:", error);
    alert("Registration failed: " + error.message);
  }
}

// LOGIN PAGE
async function handleLogin(e) {
  e.preventDefault();
  console.log("Login form submitted");

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const role = document.querySelector('input[name="loginRole"]:checked')?.value;

  console.log("Login attempt for:", email, "with role:", role);

  if (!email || !password || !role) {
    alert("Please fill in all fields");
    return;
  }

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    console.log("Auth success. UID:", uid);

    const userDoc = await getDoc(doc(db, "users", uid));
    const userData = userDoc.data();

    if (userData) {
      console.log("User data from Firestore:", userData);

      // Verify the selected role matches the user's actual role
      if (userData.role !== role) {
        alert(`Role mismatch. Your account is registered as ${userData.role}, but you selected ${role}.`);
        return;
      }

      // Store user info for dashboard to use
      const userInfo = {
        name: userData.name,
        email: userData.email,
        role: userData.role,
        uid: uid
      };

      if (userData.role?.toLowerCase() === "admin") {
        console.log("Role is admin. Redirecting...");
        localStorage.setItem("loggedInUser", JSON.stringify(userInfo));
        window.location.href = "admin-dashboard.html";
      } 
      else if (userData.role?.toLowerCase() === "volunteer") {
        console.log("Role is volunteer. Redirecting...");
        localStorage.setItem("loggedInUser", JSON.stringify(userInfo));
        window.location.href = "volunteer-dashboard.html";
      }
      else if (userData.role?.toLowerCase() === "partner") {
        console.log("Role is partner. Redirecting...");
        localStorage.setItem("loggedInUser", JSON.stringify(userInfo));
        window.location.href = "partner-dashboard.html";
      }
      else {
        alert(`No dashboard available for your role: ${userData.role}`);
      }
    } else {
      console.warn("No user data found in Firestore.");
      alert("Login failed: User data not found.");
    }
  } catch (error) {
    console.error("Login failed:", error);
    alert("Login failed: " + error.message);
  }
}

// Dashboard Page
// Updated helper function to count new volunteers this week from both collections
async function countNewVolunteersThisWeek() {
  try {
    const { db, collection, getDocs } = window.firebaseServices;
    
    // Get the start of the week (Monday)
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    startOfWeek.setHours(0, 0, 0, 0);
    
    let newVolunteersThisWeek = 0;
    
    // Count from members collection
    const membersSnap = await getDocs(collection(db, "members"));
    membersSnap.forEach((doc) => {
      const member = doc.data();
      let registrationDate = null;
      
      if (member.registrationDate) {
        registrationDate = new Date(member.registrationDate);
      } else if (member.createdAt) {
        registrationDate = new Date(member.createdAt);
      }
      
      if (registrationDate && registrationDate instanceof Date && !isNaN(registrationDate)) {
        if (registrationDate >= startOfWeek) {
          newVolunteersThisWeek++;
        }
      }
    });
    
    // Count from users collection (volunteers only)
    const usersSnap = await getDocs(collection(db, "users"));
    usersSnap.forEach((doc) => {
      const user = doc.data();
      // Only count users with volunteer role
      if (user.role && user.role.toLowerCase() === "volunteer") {
        let registrationDate = null;
        
        if (user.registrationDate) {
          registrationDate = new Date(user.registrationDate);
        } else if (user.createdAt) {
          registrationDate = new Date(user.createdAt);
        }
        
        if (registrationDate && registrationDate instanceof Date && !isNaN(registrationDate)) {
          if (registrationDate >= startOfWeek) {
            newVolunteersThisWeek++;
          }
        }
      }
    });
    
    console.log(`Found ${newVolunteersThisWeek} new volunteers this week`);
    return newVolunteersThisWeek;
    
  } catch (error) {
    console.error("Error counting new volunteers:", error);
    return 0;
  }
}

// Separate function for recent activity with better error handling
async function loadRecentActivity() {
  try {
    const { db, collection, getDocs, query, orderBy, limit } = window.firebaseServices;
    
    const recentList = document.getElementById("recentActivityList");
    if (!recentList) {
      console.error("Recent activity list element not found");
      return;
    }

    console.log("Loading recent activity...");
    
    const recentActivityRef = query(
      collection(db, "recentActivity"),
      orderBy("timestamp", "desc"),
      limit(5)
    );
    
    const recentSnap = await getDocs(recentActivityRef);
    console.log(`Found ${recentSnap.size} recent activities`);

    recentList.innerHTML = "";

    if (recentSnap.empty) {
      recentList.innerHTML = "<li>No recent activity</li>";
      console.log("No recent activity found in collection");
      return;
    }

    recentSnap.forEach((doc) => {
      const activity = doc.data();
      console.log("Activity data:", activity);
      
      const listItem = document.createElement("li");
      listItem.innerHTML = `
        <strong>${activity.title || 'Untitled Activity'}</strong>
        <p>${activity.details || 'No details available'}</p>
      `;
      recentList.appendChild(listItem);
    });

    console.log("Recent activity loaded successfully");

  } catch (error) {
    console.error("Error loading recent activity:", error);
    const recentList = document.getElementById("recentActivityList");
    if (recentList) {
      recentList.innerHTML = "<li>Error loading recent activity</li>";
    }
  }
}

// Updated admin dashboard function using the helper
window.attachDashboardListeners = async function () {
  try {
    const { db, collection, getDocs, query, orderBy, limit } = window.firebaseServices;

    console.log("Loading admin dashboard data...");

    // Debug: Check which elements exist
    console.log("=== DEBUG: Checking dashboard elements ===");
    const elementIds = [
      'totalChildren', 'childrenDelta', 'activePrograms', 'programsStatus',
      'partnersCount', 'partnersDelta', 'volunteerCount', 'volunteerDelta',
      'recentActivityList'
    ];
    
    const elements = {};
    elementIds.forEach(id => {
      elements[id] = document.getElementById(id);
      console.log(`Element '${id}':`, elements[id] ? 'FOUND' : 'NULL/MISSING');
    });
    console.log("=== END DEBUG ===");

    // Check if all required elements exist
    if (!elements.totalChildren) {
      console.error("MISSING: totalChildren element");
      return;
    }
    if (!elements.childrenDelta) {
      console.error("MISSING: childrenDelta element");
      return;
    }
    if (!elements.activePrograms) {
      console.error("MISSING: activePrograms element");
      return;
    }
    if (!elements.programsStatus) {
      console.error("MISSING: programsStatus element");
      return;
    }
    if (!elements.partnersCount) {
      console.error("MISSING: partnersCount element");
      return;
    }
    if (!elements.partnersDelta) {
      console.error("MISSING: partnersDelta element");
      return;
    }
    if (!elements.volunteerCount) {
      console.error("MISSING: volunteerCount element");
      return;
    }
    if (!elements.volunteerDelta) {
      console.error("MISSING: volunteerDelta element");
      return;
    }

    // Now load the data - we know all elements exist
    console.log("All dashboard elements found, loading data...");

    // Total Children
    const childrenSnap = await getDocs(collection(db, "children"));
    const totalChildren = childrenSnap.size;
    elements.totalChildren.textContent = totalChildren;
    elements.childrenDelta.textContent = `+${totalChildren} this month`;
    console.log("Loaded children data");

    // Active Programs
    const programsSnap = await getDocs(collection(db, "programs"));
    let activeCount = 0;
    programsSnap.forEach((doc) => {
      const data = doc.data();
      if (data.status?.toLowerCase() === "active") activeCount++;
    });
    elements.activePrograms.textContent = activeCount;
    elements.programsStatus.textContent = `${activeCount === programsSnap.size ? "All running" : `${activeCount} running`}`;
    console.log("Loaded programs data");

    // Partners - Count total partners and new partners this week
    const partnersSnap = await getDocs(collection(db, "partners"));
    const totalPartners = partnersSnap.size;
    
    // Calculate new partners this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    let newPartnersThisWeek = 0;
    partnersSnap.forEach((doc) => {
      const partner = doc.data();
      const registrationDate = partner.registrationDate ? new Date(partner.registrationDate) : new Date(partner.createdAt);
      if (registrationDate && registrationDate >= oneWeekAgo) {
        newPartnersThisWeek++;
      }
    });

    elements.partnersCount.textContent = totalPartners;
    elements.partnersDelta.textContent = `${newPartnersThisWeek} new this week`;
    console.log("Loaded partners data");

    // Volunteers - Use the helper function
    const membersSnap = await getDocs(collection(db, "members"));
    const totalMembers = membersSnap.size;
    const newVolunteersThisWeek = await countNewVolunteersThisWeek();

    elements.volunteerCount.textContent = totalMembers;
    elements.volunteerDelta.textContent = `${newVolunteersThisWeek} new this week`;
    console.log("Loaded volunteers data");

    // Recent Activity - Only load if the element exists
    if (elements.recentActivityList) {
      await loadRecentActivity();
      console.log("Loaded recent activity");
    } else {
      console.error("Recent activity list element not found");
    }

    console.log("Dashboard data loaded successfully!");

  } catch (err) {
    console.error("Error loading dashboard data:", err);
  }
};

//CHILDREN PAGE
window.attachAddChildListeners = function () {
  const form = document.getElementById("addChildForm");
  if (!form) {
    console.error("Form not found");
    return;
  }

  console.log("attachAddChildListeners called");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const child = {
      fullName: document.getElementById("childFullName").value.trim(),
      age: +document.getElementById("childAge").value,
      educationLevel: document.getElementById("educationLevel").value.trim(),
      homeAddress: document.getElementById("homeAddress").value.trim(),
      guardianName: document.getElementById("guardianName").value.trim(),
      guardianPhone: document.getElementById("guardianPhone").value.trim(),
      guardianEmail: document.getElementById("guardianEmail").value.trim(),
      emergencyContact: document.getElementById("emergencyContact").value.trim(),
      emergencyPhone: document.getElementById("emergencyPhone").value.trim(),
      additionalNotes: document.getElementById("additionalNotes").value.trim(),
      status: "active",
      createdAt: new Date().toISOString()
    };

    console.log("Child data:", child);

    try {
      const { db, collection, addDoc } = window.firebaseServices;
      await addDoc(collection(db, "children"), child);
      alert("Child successfully added!");
      loadPage("children");
    } catch (error) {
      console.error("Failed to add child:", error);
      alert("Error: Failed to add child.");
    }
  });
};

window.attachChildrenPageListeners = function () {
    const grid = document.getElementById("childrenGrid");
    const filterButtons = document.querySelectorAll(".filter-btn");
    const searchInput = document.querySelector(".search-bar");

    if (!grid || filterButtons.length === 0) {
      console.error("Children grid or filter buttons not found");
      return;
    }

    console.log("✅ attachChildrenPageListeners called");

    // debounce helper
    function debounce(fn, wait = 250) {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
      };
    }

    loadChildren("all", "");

    filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelector(".filter-btn.active")?.classList.remove("active");
        btn.classList.add("active");
        loadChildren(btn.dataset.filter, searchInput?.value || "");
      });
    });

    // wire search input if present
    if (searchInput) {
      const debounced = debounce(() => {
        const activeBtn = document.querySelector(".filter-btn.active");
        const filter = activeBtn ? activeBtn.dataset.filter : "all";
        loadChildren(filter, searchInput.value);
      }, 300);
      searchInput.addEventListener("input", debounced);
    }

    async function loadChildren(filter, query = "") {
      const { db, collection, getDocs } = window.firebaseServices;
      const childrenRef = collection(db, "children");

      try {
        const snapshot = await getDocs(childrenRef);
        const children = [];

        snapshot.forEach((doc) => {
          const child = doc.data();
          child.id = doc.id;
          children.push(child);
        });

        let filtered = children;
        if (filter === "active") {
          filtered = children.filter((c) => c.status === "active");
        } else if (filter === "inactive") {
          filtered = children.filter((c) => c.status === "inactive");
        }

        const q = (query || "").trim().toLowerCase();
        if (q) {
          filtered = filtered.filter(c => {
            const name = (c.fullName || "").toLowerCase();
            const guardian = (c.guardianName || "").toLowerCase();
            const grade = (c.educationLevel || "").toLowerCase();
            return name.includes(q) || guardian.includes(q) || grade.includes(q);
          });
        }

        if (filtered.length === 0) {
          grid.innerHTML = `<p>No ${filter} children found.</p>`;
          return;
        }

        grid.innerHTML = filtered.map(renderChildCard).join("");

      } catch (error) {
        console.error("Error loading children:", error);
        grid.innerHTML = "<p>Error loading children</p>";
      }
    }

    function renderChildCard(child) {
      const initials = getInitials(child.fullName || "NA");
      return `
        <div class="child-card">
          <div class="child-card-header">
            <div class="child-avatar">${initials}</div>
            <div class="child-status ${child.status}">${child.status}</div>
          </div>
          <div class="child-card-body">
            <h3>${child.fullName}</h3>
            <p>Age: ${child.age}</p>
            <p>Guardian: ${child.guardianName}</p>
            <p class="grade">${child.educationLevel}</p>
            <p class="program">N/A</p>
          </div>
          <div class="child-card-footer">
            <button class="view-child-btn" onclick="openChildDetails('${child.id}')">👁️</button>
          </div>
        </div>
      `;
    }

    function getInitials(name) {
      return name
        .split(" ")
        .map((part) => part.charAt(0))
        .join("")
        .toUpperCase();
    }
  };

// Open child details view
window.openChildDetails = async function(childId) {
  try {
    const { db, doc, getDoc, setDoc } = window.firebaseServices;
    
    // Load the child details page
    loadPage('child-details');
    
    // Wait for the page to load, then populate with data
    setTimeout(async () => {
      const docRef = doc(db, "children", childId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const childData = docSnap.data();
        populateChildDetailsForm(childData, childId);
      } else {
        console.error("Child not found");
        alert("Child data not found");
        loadPage("children");
      }
    }, 300);
  } catch (error) {
    console.error("Error opening child details:", error);
    alert("Error loading child details");
  }
};

// Populate child details form for viewing/editing
function populateChildDetailsForm(childData, childId) {
  // Set form values
  document.getElementById("editChildFullName").value = childData.fullName || "";
  document.getElementById("editChildAge").value = childData.age || "";
  document.getElementById("editEducationLevel").value = childData.educationLevel || "";
  document.getElementById("editHomeAddress").value = childData.homeAddress || "";
  document.getElementById("editGuardianName").value = childData.guardianName || "";
  document.getElementById("editGuardianPhone").value = childData.guardianPhone || "";
  document.getElementById("editGuardianEmail").value = childData.guardianEmail || "";
  document.getElementById("editEmergencyContact").value = childData.emergencyContact || "";
  document.getElementById("editEmergencyPhone").value = childData.emergencyPhone || "";
  document.getElementById("editAdditionalNotes").value = childData.additionalNotes || "";
  document.getElementById("editChildStatus").value = childData.status || "active";
  
  // Store the child ID for updating
  document.getElementById("childDetailsForm").dataset.childId = childId;
  
  // Set the page title
  document.getElementById("childDetailsTitle").textContent = `Edit ${childData.fullName}`;
}

// Attach listeners for child details form
window.attachChildDetailsListeners = function() {
  const form = document.getElementById("childDetailsForm");
  if (!form) {
    console.error("Child details form not found");
    return;
  }

  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    
    const childId = this.dataset.childId;
    if (!childId) {
      alert("Error: Child ID not found");
      return;
    }

    const updatedChild = {
      fullName: document.getElementById("editChildFullName").value.trim(),
      age: +document.getElementById("editChildAge").value,
      educationLevel: document.getElementById("editEducationLevel").value.trim(),
      homeAddress: document.getElementById("editHomeAddress").value.trim(),
      guardianName: document.getElementById("editGuardianName").value.trim(),
      guardianPhone: document.getElementById("editGuardianPhone").value.trim(),
      guardianEmail: document.getElementById("editGuardianEmail").value.trim(),
      emergencyContact: document.getElementById("editEmergencyContact").value.trim(),
      emergencyPhone: document.getElementById("editEmergencyPhone").value.trim(),
      additionalNotes: document.getElementById("editAdditionalNotes").value.trim(),
      status: document.getElementById("editChildStatus").value,
      updatedAt: new Date().toISOString()
    };

    console.log("Updating child:", updatedChild);

    try {
      const { db, doc, setDoc } = window.firebaseServices;
      await setDoc(doc(db, "children", childId), updatedChild, { merge: true });
      alert("Child information updated successfully!");
      loadPage("children");
    } catch (error) {
      console.error("Failed to update child:", error);
      alert("Error: Failed to update child information.");
    }
  });

  // Delete child functionality
  const deleteBtn = document.getElementById("deleteChildBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async function() {
      const childId = form.dataset.childId;
      if (!childId) return;

      if (confirm("Are you sure you want to delete this child? This action cannot be undone.")) {
        try {
          const { db, doc, deleteDoc } = window.firebaseServices;
          await deleteDoc(doc(db, "children", childId));
          alert("Child deleted successfully!");
          loadPage("children");
        } catch (error) {
          console.error("Failed to delete child:", error);
          alert("Error: Failed to delete child.");
        }
      }
    });
  }
};

//Partners PAGE
window.attachPartnersPageListeners = function () {
  const grid = document.getElementById("partnersGrid");
  const searchInput = document.querySelector(".search-filter-container .search-bar");
  const filterContainer = document.querySelector(".search-filter-container .filters");
  const filterButtons = filterContainer ? filterContainer.querySelectorAll(".filter-btn") : [];

  if (!grid) {
    console.error("Partners grid not found");
    return;
  }

  console.log("Loading partners page...");

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // Fetch partners from both members and users collections
  async function fetchAllPartners() {
    const services = window.firebaseServices || {};
    const _db = services.db || db;
    const _collection = services.collection || collection;
    const _getDocs = services.getDocs || getDocs;
    
    const allPartners = [];
    
    try {
      // 1. Get members from "members" collection
      const membersRef = _collection(_db, "members");
      const membersSnap = await _getDocs(membersRef);
      console.log(`Members collection has ${membersSnap.size} documents`);
      
      membersSnap.forEach(doc => {
        const data = doc.data();
        data.id = doc.id;
        data.source = "members"; // Track where this came from
        allPartners.push(data);
      });

      // 2. Get volunteers from "users" collection
      const usersRef = _collection(_db, "users");
      const usersSnap = await _getDocs(usersRef);
      console.log(`Users collection has ${usersSnap.size} documents`);
      
      usersSnap.forEach(doc => {
        const data = doc.data();
        // Only include users with role "volunteer"
        if (data.role && data.role.toLowerCase() === "volunteer") {
          data.id = doc.id;
          data.source = "users"; // Track where this came from
          // Map user fields to partner fields for consistent display
          data.fullName = data.name || data.fullName || "Unnamed Volunteer";
          data.role = "Volunteer";
          data.status = data.status || "active";
          data.email = data.email || "";
          data.phone = data.phone || "";
          data.address = data.address || "";
          allPartners.push(data);
        }
      });

      console.log(`Total partners loaded: ${allPartners.length} (${membersSnap.size} from members, ${allPartners.length - membersSnap.size} from users)`);
      return allPartners;
      
    } catch (err) {
      console.warn("Error loading partners:", err);
      return [];
    }
  }

  async function loadPartners(filter = "all", query = "") {
    try {
      console.log("Loading partners with filter:", filter, "query:", query);
      const partners = await fetchAllPartners();

      if (!partners || partners.length === 0) {
        grid.innerHTML = "<p>No partners found.</p>";
        console.log("No partners data found");
        return;
      }

      console.log("Total partners found:", partners.length);
      
      let filtered = partners;
      if (filter === "active") {
        filtered = partners.filter(p => (p.status || "").toLowerCase() === "active");
      } else if (filter === "inactive") {
        filtered = partners.filter(p => (p.status || "").toLowerCase() === "inactive");
      } else if (filter === "ongoing") {
        filtered = partners.filter(p => (p.status || "").toLowerCase() === "ongoing");
      }

      console.log("After status filter:", filtered.length);

      const q = (query || "").trim().toLowerCase();
      if (q) {
        filtered = filtered.filter(p => {
          const name = (p.fullName || p.name || "").toString().toLowerCase();
          const role = (p.role || "").toString().toLowerCase();
          const address = (p.address || "").toString().toLowerCase();
          const email = (p.email || "").toString().toLowerCase();
          return name.includes(q) || role.includes(q) || address.includes(q) || email.includes(q);
        });
        console.log("After search filter:", filtered.length);
      }

      if (filtered.length === 0) {
        grid.innerHTML = "<p>No partners match your filters.</p>";
        console.log("No partners match filters");
        return;
      }

      console.log("Rendering partners:", filtered);
      grid.innerHTML = filtered.map(renderPartnerCard).join("");
      
    } catch (error) {
      console.error("Error loading partners:", error);
      grid.innerHTML = "<p>Error loading partners</p>";
    }
  }

  function renderPartnerCard(partner) {
    console.log("Rendering partner card:", partner);
    const name = partner.fullName || partner.name || "Unnamed";
    const role = partner.role || partner.title || "N/A";
    const phone = partner.phone || partner.contact || "";
    const email = partner.email || "";
    const address = partner.address || "";
    const organization = partner.organization || "";
    const status = (partner.status || "active").toString().toLowerCase();
    const id = partner.id || partner._id || "";
    const source = partner.source || "members";
    
    return `
     <div class="partner-card">
  <span class="partner-status ${status}">${status}</span>
  
  <div class="partner-card-header">
    <div class="partner-avatar">${getInitials(name)}</div>
    <div class="partner-info">
      <h4>${escapeHtml(name)}</h4>
      <p class="role">${escapeHtml(role)}</p>
      <p class="phone">${escapeHtml(phone)}</p>
      <p class="email">${escapeHtml(email)}</p>
    </div>
  </div>

  <div class="partner-card-footer">
    <button class="view-btn" onclick="openPartnerDetails('${id}', '${source}')">👁️</button>
  </div>
</div>
    `;
  }

  function getInitials(name) {
    return (name || "")
      .split(" ")
      .filter(Boolean)
      .map(part => part.charAt(0))
      .slice(0,2)
      .join("")
      .toUpperCase();
  }

  function escapeHtml(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // wire filter buttons
  if (filterButtons.length) {
    filterButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".search-filter-container .filter-btn.active")?.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const key = (btn.dataset.filter || (btn.textContent || "").trim().toLowerCase()).toLowerCase();
        let filter = "all";
        if (key === "active") filter = "active";
        if (key === "inactive") filter = "inactive";
        if (key === "ongoing") filter = "ongoing";
        loadPartners(filter, searchInput?.value || "");
      });
    });
  }

  // wire search input
  if (searchInput) {
    const debounced = debounce(() => {
      const activeBtn = document.querySelector(".search-filter-container .filter-btn.active");
      const filterText = (activeBtn?.textContent || "All").trim().toLowerCase();
      const filter = filterText === "ongoing" ? "ongoing" : filterText === "active" ? "active" : "all";
      loadPartners(filter, searchInput.value);
    }, 300);
    searchInput.addEventListener("input", debounced);
  }

  // initial load
  const activeBtn = document.querySelector(".search-filter-container .filter-btn.active");
  const initialFilterText = (activeBtn?.textContent || "All").trim().toLowerCase();
  const initialFilter = initialFilterText === "ongoing" ? "ongoing" : initialFilterText === "active" ? "active" : "all";
  loadPartners(initialFilter, "");
};

// Open partner details view
window.openPartnerDetails = async function(partnerId, source = "members") {
  try {
    const { db, doc, getDoc, setDoc } = window.firebaseServices;
    
    // Load the partner details page
    loadPage('partner-details');
    
    // Wait for the page to load, then populate with data
    setTimeout(async () => {
      // Determine which collection to query based on source
      const collectionName = source === "users" ? "users" : "members";
      const docRef = doc(db, collectionName, partnerId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const partnerData = docSnap.data();
        populatePartnerDetailsForm(partnerData, partnerId, collectionName);
      } else {
        console.error("Partner not found");
        alert("Partner data not found");
        loadPage("partners");
      }
    }, 300);
  } catch (error) {
    console.error("Error opening partner details:", error);
    alert("Error loading partner details");
  }
};

// Populate partner details form for viewing/editing
function populatePartnerDetailsForm(partnerData, partnerId, collectionName) {
  // Set form values
  document.getElementById("editPartnerFullName").value = partnerData.fullName || partnerData.name || "";
  document.getElementById("editPartnerRole").value = partnerData.role || "";
  document.getElementById("editPartnerEmail").value = partnerData.email || "";
  document.getElementById("editPartnerPhone").value = partnerData.phone || "";
  document.getElementById("editPartnerAddress").value = partnerData.address || "";
  document.getElementById("editPartnerOrganization").value = partnerData.organization || "";
  document.getElementById("editPartnerStatus").value = partnerData.status || "active";
  
  // Handle availability (for volunteers)
  if (partnerData.availability && Array.isArray(partnerData.availability)) {
    document.getElementById("editPartnerAvailability").value = partnerData.availability.join(", ");
  }
  
  // Store the partner ID and collection for updating
  const form = document.getElementById("partnerDetailsForm");
  form.dataset.partnerId = partnerId;
  form.dataset.collectionName = collectionName;
  
  // Set the page title
  document.getElementById("partnerDetailsTitle").textContent = `Edit ${partnerData.fullName || partnerData.name}`;
  
  // Show/hide delete button based on collection (don't delete users from users collection)
  const deleteBtn = document.getElementById("deletePartnerBtn");
  if (deleteBtn) {
    if (collectionName === "users") {
      deleteBtn.style.display = 'none';
    } else {
      deleteBtn.style.display = 'block';
    }
  }
}

// Attach listeners for partner details form
window.attachPartnerDetailsListeners = function() {
  const form = document.getElementById("partnerDetailsForm");
  if (!form) {
    console.error("Partner details form not found");
    return;
  }

  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    
    const partnerId = this.dataset.partnerId;
    const collectionName = this.dataset.collectionName;
    
    if (!partnerId || !collectionName) {
      alert("Error: Partner ID or collection not found");
      return;
    }

    const updatedPartner = {
      fullName: document.getElementById("editPartnerFullName").value.trim(),
      role: document.getElementById("editPartnerRole").value.trim(),
      email: document.getElementById("editPartnerEmail").value.trim(),
      phone: document.getElementById("editPartnerPhone").value.trim(),
      address: document.getElementById("editPartnerAddress").value.trim(),
      organization: document.getElementById("editPartnerOrganization").value.trim(),
      status: document.getElementById("editPartnerStatus").value,
      updatedAt: new Date().toISOString()
    };

    // Handle availability field
    const availabilityInput = document.getElementById("editPartnerAvailability").value.trim();
    if (availabilityInput) {
      updatedPartner.availability = availabilityInput.split(',').map(item => item.trim()).filter(item => item);
    }

    // For users collection, also update the name field
    if (collectionName === "users") {
      updatedPartner.name = updatedPartner.fullName;
    }

    console.log("Updating partner:", updatedPartner);

    try {
      const { db, doc, setDoc } = window.firebaseServices;
      await setDoc(doc(db, collectionName, partnerId), updatedPartner, { merge: true });
      alert("Partner information updated successfully!");
      loadPage("partners");
    } catch (error) {
      console.error("Failed to update partner:", error);
      alert("Error: Failed to update partner information.");
    }
  });

  // Delete partner functionality (only for members collection)
  const deleteBtn = document.getElementById("deletePartnerBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async function() {
      const partnerId = form.dataset.partnerId;
      const collectionName = form.dataset.collectionName;
      
      if (!partnerId || collectionName === "users") return;

      if (confirm("Are you sure you want to delete this partner? This action cannot be undone.")) {
        try {
          const { db, doc, deleteDoc } = window.firebaseServices;
          await deleteDoc(doc(db, collectionName, partnerId));
          alert("Partner deleted successfully!");
          loadPage("partners");
        } catch (error) {
          console.error("Failed to delete partner:", error);
          alert("Error: Failed to delete partner.");
        }
      }
    });
  }
};

//PROGRAMS PAGE
window.attachAddProgramListeners = function () {
  const form = document.getElementById("addProgramForm");
  if (!form) {
    console.error("Form not found");
    return;
  }

  console.log("attachAddProgramListeners called");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const program = {
      name: document.getElementById("programName").value.trim(),
      category: document.getElementById("category").value.trim(),
      description: document.getElementById("programDescription").value.trim(),
      targetAgeGroup: document.getElementById("targetAgeGroup").value.trim(),
      maxCapacity: +document.getElementById("maxCapacity").value,
      leadInstructor: document.getElementById("leadInstructor").value.trim(),
      schedule: [
        {
          day: document.getElementById("scheduleDay").value.trim(),
          time: document.getElementById("scheduleTime").value.trim(),
          activity: document.getElementById("scheduleActivity").value.trim()
        }
      ],
      createdAt: new Date().toISOString()
    };

    console.log("Program data:", program);

    try {
      const { db, collection, addDoc } = window.firebaseServices;
      await addDoc(collection(db, "programs"), program);
      alert("Program successfully created!");
      loadPage("programs");
    } catch (error) {
      console.error("Failed to create program:", error);
      alert("Error: Failed to create program.");
    }
  });
};

window.attachProgramsPageListeners = function () {
  const grid = document.getElementById("programsGrid");
  const searchInput = document.querySelector(".search-filter-container .search-bar");
  const filterContainer = document.querySelector(".search-filter-container .filters");
  const filterButtons = filterContainer ? filterContainer.querySelectorAll(".filter-btn") : [];

  if (!grid) {
    console.error("Programs grid not found");
    return;
  }

  // debounce helper
  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // load programs from Firestore and apply search & filter
  async function loadPrograms(filter = "all", query = "") {
    try {
      const { db, collection, getDocs } = window.firebaseServices;
      const programsRef = collection(db, "programs");
      const snapshot = await getDocs(programsRef);
      const programs = [];

      snapshot.forEach((doc) => {
        const p = doc.data();
        p.id = doc.id;
        programs.push(p);
      });

      // apply status filter
      let filtered = programs;
      if (filter === "ongoing") {
        filtered = programs.filter(p => (p.status || "").toLowerCase() === "ongoing" || (p.status || "").toLowerCase() === "active");
      } else if (filter === "completed") {
        filtered = programs.filter(p => (p.status || "").toLowerCase() === "completed" || (p.status || "").toLowerCase() === "finished");
      }

      // apply search (name or description)
      const q = (query || "").trim().toLowerCase();
      if (q) {
        filtered = filtered.filter(p => {
          const name = (p.name || "").toLowerCase();
          const desc = (p.description || "").toLowerCase();
          return name.includes(q) || desc.includes(q);
        });
      }

      if (filtered.length === 0) {
        grid.innerHTML = "<p>No programs found.</p>";
        return;
      }

      grid.innerHTML = filtered.map(renderProgramCard).join("");
    } catch (error) {
      console.error("Error loading programs:", error);
      grid.innerHTML = "<p>Error loading programs</p>";
    }
  }

  // render card (keeps existing markup & behavior)
  function renderProgramCard(program) {
    const instructor = program.leadInstructor || "N/A";
    const startDate = program.createdAt ? new Date(program.createdAt).toLocaleDateString() : "Unknown";
    const enrollment = program.enrollmentCount || 0;
    const capacity = program.maxCapacity || 30;
    const isFull = enrollment >= capacity;
    const scheduleItem = program.schedule?.[0]?.day && program.schedule?.[0]?.time
      ? `${program.schedule[0].day}, ${program.schedule[0].time}`
      : "No schedule";

    return `
      <div class="program-card">
        <div class="program-card-header">
          <h3>${program.name}</h3>
          ${isFull ? '<span class="program-status full">Full</span>' : ""}
        </div>
        <div class="program-card-body">
          <p><strong>Instructor:</strong> ${instructor}</p>
          <p><strong>Start Date:</strong> ${startDate}</p>
          <p><strong>Enrollment:</strong> ${enrollment}/${capacity}</p>
          <p><strong>Schedule:</strong> ${scheduleItem}</p>
        </div>
        <div class="program-card-footer">
          <button class="view-btn" onclick="openProgramDetails('${program.id}')">👁️</button>
        </div>
      </div>
    `;
  }

  // wire filter buttons
  if (filterButtons.length) {
    filterButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        // prevent page-level form/button default behaviour
        e.preventDefault();
        document.querySelectorAll(".search-filter-container .filter-btn.active")?.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const text = (btn.textContent || "").trim().toLowerCase();
        let filter = "all";
        if (text === "ongoing") filter = "ongoing";
        if (text === "completed") filter = "completed";

        loadPrograms(filter, searchInput?.value || "");
      });
    });
  }

  // wire search input with debounce
  if (searchInput) {
    const debounced = debounce(() => {
      const activeBtn = document.querySelector(".search-filter-container .filter-btn.active");
      const filterText = (activeBtn?.textContent || "All").trim().toLowerCase();
      const filter = filterText === "ongoing" ? "ongoing" : filterText === "completed" ? "completed" : "all";
      loadPrograms(filter, searchInput.value);
    }, 300);

    searchInput.addEventListener("input", debounced);
  }

  // initial load: find active filter button or default to All
  const activeBtn = document.querySelector(".search-filter-container .filter-btn.active");
  const initialFilterText = (activeBtn?.textContent || "All").trim().toLowerCase();
  const initialFilter = initialFilterText === "ongoing" ? "ongoing" : initialFilterText === "completed" ? "completed" : "all";
  loadPrograms(initialFilter, "");
};

//PROGRAM DETAILS
window.loadProgramDetails = async function (programId) {
  // Save the programId globally for use in tab switching
  window.currentProgramId = programId;

  const { db, doc, getDoc } = window.firebaseServices;

  try {
    const docRef = doc(db, "programs", programId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const programData = docSnap.data();
      document.getElementById("programTitle").innerText = programData.name || "Untitled";

      // Automatically load the default tab
      loadTabContent("overview");
    } else {
      console.error("Program not found");
      document.getElementById("tabContent").innerHTML = "<p>Program not found.</p>";
    }
  } catch (error) {
    console.error("Error loading program details:", error);
    document.getElementById("tabContent").innerHTML = "<p>Error loading program details.</p>";
  }
};

window.loadTabContent = async function (tabName) {
  const programId = window.currentProgramId;
  const container = document.getElementById("tabContent");
  const { db, doc, getDoc, collection, query, orderBy, getDocs } = window.firebaseServices;

  if (!programId) {
    container.innerHTML = "<p>No program selected.</p>";
    return;
  }

  try {
    const docSnap = await getDoc(doc(db, "programs", programId));
    if (!docSnap.exists()) {
      container.innerHTML = "<p>Program data not found.</p>";
      return;
    }

    const program = docSnap.data();
    let html = "";

    switch (tabName) {
      case "overview":
        {
          // derive dates and enrollment info
          const startDate = program.startDate ? new Date(program.startDate).toLocaleDateString() : (program.createdAt ? new Date(program.createdAt).toLocaleDateString() : "—");
          const endDate = program.endDate ? new Date(program.endDate).toLocaleDateString() : "—";
          const capacity = program.maxCapacity || 0;

          // get enrollment count from enrollments collection (best-effort)
          let enrollmentCount = program.enrollmentCount || 0;
          try {
            const enrollSnap = await getDocs(collection(db, "enrollments"));
            const matched = enrollSnap.docs.filter(d => d.data().programId === programId);
            enrollmentCount = matched.length;
          } catch (e) {
            // ignore - fall back to program.enrollmentCount
          }

          const pctFilled = capacity > 0 ? Math.round((enrollmentCount / capacity) * 100) : 0;
          const isFull = capacity > 0 && enrollmentCount >= capacity;

          // Recent activity - fetch last session/activity records
          let recentHtml = `<div class="recent-activity"><h3>Recent Activity</h3><div class="activity-card"><p>No recent activity</p></div></div>`;
          try {
            const recentQ = query(collection(db, "recentActivity"), orderBy("timestamp", "desc"), /* limit handled client-side */);
            const recentSnap = await getDocs(recentQ);
            const items = recentSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(it => !it.programId || it.programId === programId)
              .slice(0, 3);

            if (items.length > 0) {
              recentHtml = `<div class="recent-activity"><h3>Recent Activity</h3>`;
              items.forEach(it => {
                recentHtml += `<div class="schedule-card"><strong>${it.title || "Activity"}</strong><p>${it.details || ""}</p></div>`;
              });
              recentHtml += `</div>`;
            }
          } catch (e) {
            // ignore
          }

          html = `
            <div style="display:flex;gap:20px;flex-wrap:wrap;">
              <div class="program-info" style="flex:1;min-width:420px;">
                <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:20px;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                    <div>
                      <h3 style="margin:0 0 8px 0;font-size:18px;font-weight:800">Program Information</h3>
                      <p style="margin:0;color:#666">${program.description || ""}</p>
                    </div>
                    ${isFull ? `<div style="background:#ffe9e6;color:#d04a32;padding:6px 10px;border-radius:16px;font-weight:700">Full</div>` : ''}
                  </div>

                  <div style="display:flex;gap:18px;margin-top:18px;flex-wrap:wrap;">
                    <div style="min-width:160px;">
                      <div style="font-size:13px;color:#666;margin-bottom:6px">Start Date</div>
                      <div style="font-weight:700">${startDate}</div>
                    </div>
                    <div style="min-width:160px;">
                      <div style="font-size:13px;color:#666;margin-bottom:6px">End Date</div>
                      <div style="font-weight:700">${endDate}</div>
                    </div>
                    <div style="flex:1;min-width:160px;align-self:center;">
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="opacity:.8"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zM4 20a8 8 0 0116 0" stroke="#6f42c1" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </div>
                        <div style="font-size:13px;color:#666">Enrollment: <strong>${enrollmentCount}/${capacity || '—'}</strong></div>
                      </div>
                      <div style="height:8px;background:#eef2ff;border-radius:999px;margin-top:10px;overflow:hidden">
                        <div style="width:${Math.min(pctFilled,100)}%;height:100%;background:#3b82f6"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div style="margin-top:18px;">
                  ${recentHtml}
                </div>
              </div>

              <div style="width:320px;min-width:260px;display:flex;flex-direction:column;gap:18px;">
                <div class="quick-stats" style="background:#fff;border:1px solid #eee;border-radius:8px;padding:18px;">
                  <h3 style="margin:0 0 12px 0;font-size:18px;font-weight:800">Quick Stats</h3>
                  <div style="display:flex;flex-direction:column;gap:12px;">
                    <div class="stat-card blue" style="background:#e7f0ff;border:1px solid #cfe3ff;padding:12px;border-radius:6px;color:#0b57c5">
                      <div style="font-weight:800;font-size:18px;text-align:center">92%</div>
                      <div style="text-align:center;color:#0b57c5">Average Attendance</div>
                    </div>
                    <div class="stat-card green" style="background:#e9f9ef;border:1px solid #cfeed4;padding:12px;border-radius:6px;color:#10703a">
                      <div style="font-weight:800;font-size:18px;text-align:center">${program.completionRate ? program.completionRate+'%' : '85%'}</div>
                      <div style="text-align:center;color:#10703a">Completion Rate</div>
                    </div>
                    <div class="stat-card orange" style="background:#fff7ef;border:1px solid #f7d7c1;padding:12px;border-radius:6px;color:#c05b25">
                      <div style="font-weight:800;font-size:18px;text-align:center">${(program.schedule && program.schedule.length) ? program.schedule.length : 3}</div>
                      <div style="text-align:center;color:#c05b25">Sessions/Week</div>
                    </div>
                  </div>
                </div>

                <div class="quick-actions" style="background:#fff;border:1px solid #eee;border-radius:8px;padding:18px;">
                  <h3 style="margin:0 0 10px 0;font-size:16px;font-weight:800">Quick Actions</h3>
                  <button class="btn gray" onclick="openScheduleModal && openScheduleModal('${programId}')">Schedule Session</button>
                  <button class="btn orange" style="margin-top:10px" onclick="openProgramDetails && openProgramDetails('${programId}')">View Full Details</button>
                </div>
              </div>
            </div>
          `;
        }
        break;

      case "schedule":
        {
          // Build weekly schedule and upcoming sessions
          const schedule = Array.isArray(program.schedule) ? program.schedule : [];
          let weeklyHtml = `<div class="weekly-schedule"><h3>Weekly Schedule</h3>`;
          if (schedule.length === 0) {
            weeklyHtml += `<div class="schedule-card"><p>No scheduled sessions</p></div>`;
          } else {
            schedule.forEach(item => {
              weeklyHtml += `
                <div class="schedule-card">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <strong style="display:block">${item.day || 'Day'}</strong>
                      <a href="#" style="color:#2563eb;font-weight:700;text-decoration:none">${item.activity || item.title || 'Session'}</a>
                    </div>
                    <div style="color:#666">${item.time || ''}</div>
                  </div>
                </div>
              `;
            });
          }
          weeklyHtml += `</div>`;

          // upcoming sessions summary
          let upcomingHtml = `<div class="upcoming-sessions"><h3>Upcoming Sessions</h3>`;
          const next = schedule[0];
          if (next) {
            upcomingHtml += `
              <div class="next-session">
                <strong>Next Session</strong>
                <div style="margin-top:8px;font-weight:700">${next.activity || next.title || 'Session'}</div>
                <div style="color:#666;margin-top:6px">${next.day || ''}, ${next.time || ''}</div>
              </div>
            `;
          } else {
            upcomingHtml += `<div class="next-session"><p>No upcoming sessions</p></div>`;
          }

          // this week summary simple counts
          upcomingHtml += `
            <div class="this-week">
              <strong>This Week</strong>
              <p style="margin:10px 0 0 0;color:#666">${schedule.length} sessions scheduled</p>
              <p style="margin:6px 0 0 0;color:#666">${program.enrollmentCount || 0} students expected</p>
            </div>
          `;

          upcomingHtml += `</div>`;

          html = `
            <div style="display:flex;gap:20px;flex-wrap:wrap;">
              <div style="flex:1;min-width:420px;">
                ${weeklyHtml}
              </div>
              <div style="width:360px;min-width:260px;">
                <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:18px;">
                  ${upcomingHtml}
                </div>
              </div>
            </div>
          `;
        }
        break;

      case "students":
        {
          // load enrollments + children + attendance records (best-effort)
          const enrollSnap = await getDocs(collection(db, "enrollments"));
          const childrenSnap = await getDocs(collection(db, "children"));
          const attendanceSnap = await getDocs(collection(db, "attendanceRecords"));

          // index children by id
          const childrenById = {};
          childrenSnap.forEach(c => { childrenById[c.id] = c.data(); });

          // collect enrollments for this program
          const enrollments = enrollSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(e => e.programId === programId);

          // normalize attendance records and build lookup of present ids per session
          const attendanceRecords = attendanceSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(r => !r.programId || r.programId === programId)
            .sort((a,b) => {
              const ta = a.date || a.timestamp || a.createdAt || "";
              const tb = b.date || b.timestamp || b.createdAt || "";
              return new Date(tb) - new Date(ta);
            });

          const sessionPresentMap = attendanceRecords.map(r => {
            let presentIds = [];
            if (Array.isArray(r.present)) presentIds = r.present;
            else if (Array.isArray(r.presentIds)) presentIds = r.presentIds;
            else if (Array.isArray(r.presentChildIds)) presentIds = r.presentChildIds;
            else if (Array.isArray(r.attendees)) presentIds = r.attendees;
            else if (r.attendees && typeof r.attendees === "object") {
              presentIds = Object.keys(r.attendees).filter(k => !!r.attendees[k]);
            }
            return { id: r.id, presentIds };
          });

          // render students list
          if (enrollments.length === 0) {
            html = `<div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:20px"><h3>Enrolled Students</h3><p style="color:#666">No students enrolled.</p></div>`;
          } else {
            const studentItems = enrollments.map(enr => {
              const child = childrenById[enr.childId] || {};
              const name = child.fullName || child.name || (enr.name || "Unnamed");
              const initials = (name || "U").split(" ").map(s=>s.charAt(0)).slice(0,2).join("").toUpperCase();
              // compute attendance: count sessions where presentIds includes childId
              const attended = sessionPresentMap.reduce((acc, s) => acc + (s.presentIds.includes(enr.childId) ? 1 : 0), 0);
              const totalSessions = attendanceRecords.length || program.schedule?.length || 0;
              const percent = totalSessions ? Math.round((attended/totalSessions)*100) : 0;
              const progressText = (enr.progress || child.progress || "Progress: Unknown");
              return `
                <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:12px;display:flex;align-items:center;gap:12px;margin-bottom:12px">
                  <div style="width:56px;height:56px;border-radius:999px;background:#eaf2ff;display:flex;align-items:center;justify-content:center;font-weight:800;color:#1e3a8a">${initials}</div>
                  <div style="flex:1">
                    <div style="font-weight:800">${name}</div>
                    <div style="color:#666;font-size:13px;margin-top:6px">${typeof progressText === 'string' ? progressText : 'Progress: N/A'}</div>
                  </div>
                  <div style="text-align:right;min-width:80px">
                    <div style="font-weight:800">${attended}/${totalSessions || '—'}</div>
                    <div style="color:#666;font-size:13px">Attendance</div>
                  </div>
                </div>
              `;
            }).join("");
            html = `<div style="background:transparent"><h3 style="margin:0 0 12px 0;font-size:18px;font-weight:800">Enrolled Students</h3><div style="margin-top:6px">${studentItems}</div></div>`;
          }
        }
        break;

      case "attendance":
        {
          // fetch attendance records for program and render list of cards
          const recordsSnap = await getDocs(collection(db, "attendanceRecords"));
          const records = recordsSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(r => !r.programId || r.programId === programId)
            .sort((a,b) => {
              const ta = a.date || a.timestamp || a.createdAt || "";
              const tb = b.date || b.timestamp || b.createdAt || "";
              return new Date(tb) - new Date(ta);
            });

          if (records.length === 0) {
            html = `<div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:20px"><h3>Attendance Records</h3><p style="color:#666">No attendance records yet.</p></div>`;
          } else {
            const recItems = records.map(r => {
              const dateStr = r.date ? (new Date(r.date)).toLocaleDateString() : (r.timestamp ? new Date(r.timestamp).toLocaleDateString() : "Unknown");
              // determine present / total
              let present = typeof r.presentCount === "number" ? r.presentCount : (Array.isArray(r.present) ? r.present.length : (Array.isArray(r.presentIds) ? r.presentIds.length : 0));
              let total = typeof r.totalCount === "number" ? r.totalCount : (Array.isArray(r.present) || Array.isArray(r.presentIds) ? (r.totalCount || (r.total || 0)) : (r.attendanceTotal || r.totalCount || 0));
              if (!total && r.attendees && typeof r.attendees === "object") total = Object.keys(r.attendees).length;
              const pct = total ? Math.round((present/total)*100) : (present ? 100 : 0);
              return `
                <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                  <div>
                    <div style="font-weight:700">${dateStr}</div>
                    <div style="color:#666;font-size:13px;margin-top:6px">${r.notes || r.title || "Session attendance"}</div>
                  </div>
                  <div style="text-align:right;min-width:80px">
                    <div style="font-weight:800">${present}/${total || '—'}</div>
                    <div style="color:#666;font-size:13px">${pct}%</div>
                  </div>
                </div>
              `;
            }).join("");
            html = `<div><h3 style="margin:0 0 12px 0;font-size:18px;font-weight:800">Attendance Records</h3><div style="margin-top:8px">${recItems}</div></div>`;
          }
        }
        break;

      default:
        html = "<p>Invalid tab selected.</p>";
    }

    container.innerHTML = html;

    // Set active tab styling
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelector(`.tab-btn[onclick="loadTabContent('${tabName}')"]`)?.classList.add("active");

  } catch (error) {
    console.error("Error loading tab content:", error);
    container.innerHTML = "<p>Error loading content.</p>";
  }
};

window.openProgramDetails = function (programId) {
  // Load the program-details page fragment first
  loadPage("program-details");

  // Wait for the fragment to load, then call loadProgramDetails
  setTimeout(() => {
    if (typeof loadProgramDetails === "function") {
      loadProgramDetails(programId);
    } else {
      console.error("loadProgramDetails function is not defined.");
    }
  }, 300);
};

//Enroll Child in Program
window.attachEnrollChildListeners = async function () {
  const {
    db,
    collection,
    getDocs,
    doc,
    addDoc,
    setDoc,
    increment
  } = window.firebaseServices;

  const programSelect = document.getElementById("programSelect");
  const childSelect   = document.getElementById("childSelect");
  const enrollForm    = document.getElementById("enrollChildForm");
  const messageBox    = document.getElementById("enrollMessage");

  let allChildren = [];

  // 1. Load programs into dropdown
  programSelect.innerHTML = `<option value="" disabled selected>Select Program</option>`;
  const programsSnap = await getDocs(collection(db, "programs"));
  programsSnap.forEach((docSnap) => {
    const p = docSnap.data();
    const opt = document.createElement("option");
    opt.value = docSnap.id;
    opt.textContent = p.name;
    programSelect.appendChild(opt);
  });

  // 2. Load all children once
  const childrenSnap = await getDocs(collection(db, "children"));
  allChildren = childrenSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 3. When program changes, populate child dropdown
  programSelect.addEventListener("change", async () => {
    const progId = programSelect.value;
    // enable and reset childSelect
    childSelect.disabled = false;
    childSelect.innerHTML = `<option value="" disabled selected>Select Child</option>`;
    messageBox.textContent = "";

    if (!progId) return;

    // find already enrolled childIds for this program
    const enrSnap = await getDocs(collection(db, "enrollments"));
    const enrolledIds = new Set(
      enrSnap.docs
        .filter(d => d.data().programId === progId)
        .map(d => d.data().childId)
    );

    // filter available
    const available = allChildren.filter(c => !enrolledIds.has(c.id));

    if (available.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No available children";
      opt.disabled = true;
      childSelect.appendChild(opt);
    } else {
      available.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.fullName || "Unnamed";
        childSelect.appendChild(opt);
      });
    }
  });

  // 4. Handle the enrollment submission
  enrollForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    messageBox.textContent = "";

    const progId  = programSelect.value;
    const childId = childSelect.value;

    if (!progId || !childId) {
      messageBox.textContent = "Please select both program & child.";
      messageBox.style.color = "red";
      return;
    }

    try {
      // write enrollment record
      await addDoc(collection(db, "enrollments"), {
        programId: progId,
        childId,
        enrolledAt: new Date().toISOString()
      });
      // bump program count
      const progRef = doc(db, "programs", progId);
      await setDoc(progRef, { enrollmentCount: increment(1) }, { merge: true });

      messageBox.textContent = "Child enrolled!";
      messageBox.style.color = "green";
      enrollForm.reset();

      // re‐trigger change to refresh children list
      programSelect.dispatchEvent(new Event("change"));
    } catch (err) {
      console.error("Enroll error:", err);
      messageBox.textContent = "Failed to enroll. Try again.";
      messageBox.style.color = "red";
    }
  });
};

// SETTINGS PAGE 
window.attachSettingsPageListeners = async function () {
  const form = document.getElementById("settingsForm");
  const msg = document.getElementById("settingsMessage");
  if (!form) return console.error("Settings form not found");

  const { db, doc, getDoc, setDoc } = window.firebaseServices;
  const user = auth.currentUser;
  let uid = null;
  let userDoc = {};

  // prefill from auth/localStorage/firestore
  try {
    uid = user?.uid || JSON.parse(localStorage.getItem("loggedInUser") || "{}")?.uid;
    if (uid) {
      const userRef = doc(db, "users", uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) userDoc = snap.data();
    }
  } catch (e) {
    console.warn("Could not prefill settings from firestore", e);
  }

  // prefill form fields (non-blocking) — theme removed
  try {
    document.getElementById("fullname").value = userDoc.name || (user && user.displayName) || "";
    document.getElementById("email").value = userDoc.email || (user && user.email) || "";
    document.getElementById("notifications").value = userDoc.notifications || "enabled";
  } catch (e) { /* ignore */ }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    const newName = document.getElementById("fullname").value.trim();
    const newEmail = document.getElementById("email").value.trim();
    const newPassword = document.getElementById("password").value;
    const notifications = document.getElementById("notifications").value;
    // theme removed

    if (!uid && !user) {
      msg.innerText = "User not signed in.";
      msg.style.color = "red";
      return;
    }
    uid = uid || user.uid;

    const updates = {};
    if (newName && newName !== (userDoc.name || (user && user.displayName) || "")) updates.name = newName;
    if (notifications) updates.notifications = notifications;
    if (newEmail && newEmail !== (userDoc.email || (user && user.email) || "")) updates.email = newEmail;

    // apply Firestore user doc updates (non-blocking)
    try {
      if (Object.keys(updates).length > 0) {
        await setDoc(doc(db, "users", uid), updates, { merge: true });
      }
      // removed theme localStorage persistence
    } catch (err) {
      console.error("Failed to update users doc:", err);
      msg.innerText = "Failed to save profile changes.";
      msg.style.color = "red";
      return;
    }

    // apply auth-sensitive changes: email/password
    try {
      if (user && newEmail && newEmail !== user.email) {
        await updateEmail(user, newEmail);
      }
    } catch (err) {
      console.warn("updateEmail failed:", err);
      msg.innerHTML = "Email update failed. You may need to re-login to change email.";
      msg.style.color = "orange";
    }

    try {
      if (user && newPassword) {
        await updatePassword(user, newPassword);
      }
    } catch (err) {
      console.warn("updatePassword failed:", err);
      msg.innerHTML = "Password update failed. You may need to re-login to change password.";
      msg.style.color = "orange";
    }

    // update localStorage copy if present
    try {
      const stored = JSON.parse(localStorage.getItem("loggedInUser") || "{}");
      if (stored) {
        if (updates.name) stored.name = updates.name;
        if (updates.email) stored.email = updates.email;
        localStorage.setItem("loggedInUser", JSON.stringify(stored));
      }
    } catch (e) { /* ignore */ }

    // success message
    if (!msg.textContent || msg.style.color !== "orange") {
      msg.innerText = "Settings saved.";
      msg.style.color = "green";
    }
    // clear password field
    document.getElementById("password").value = "";
  });
};

// Volunteer Dashboard
window.attachVolunteerDashboardListeners = async function () {
  try {
    const { db, collection, getDocs, query, orderBy, limit, where } = window.firebaseServices;

    // Total Children
    const childrenSnap = await getDocs(collection(db, "children"));
    const totalChildren = childrenSnap.size;
    document.getElementById("totalChildren").textContent = totalChildren;
    document.getElementById("childrenDelta").textContent = `+${totalChildren} this month`;

    // Active Programs
    const programsSnap = await getDocs(collection(db, "programs"));
    let activeCount = 0;
    programsSnap.forEach((doc) => {
      const data = doc.data();
      if (data.status?.toLowerCase() === "active") activeCount++;
    });
    document.getElementById("activePrograms").textContent = activeCount;
    document.getElementById("programsStatus").textContent = `${activeCount === programsSnap.size ? "All running" : `${activeCount} running`}`;

    // My Tasks
    const user = JSON.parse(localStorage.getItem("loggedInUser"));
    const tasksSnap = await getDocs(collection(db, "tasks"));
    const myTasks = [];
    tasksSnap.forEach((doc) => {
      const task = doc.data();
      if (task.assignedTo === user.uid) {
        myTasks.push(task);
      }
    });
    document.getElementById("myTasks").textContent = myTasks.length;
    document.getElementById("tasksDelta").textContent = `${myTasks.length > 0 ? myTasks.length + " assigned" : "No tasks"}`;

    // Volunteers - Use the helper function
    const membersSnap = await getDocs(collection(db, "members"));
    const totalMembers = membersSnap.size;
    const newVolunteersThisWeek = await countNewVolunteersThisWeek();

    document.getElementById("attendanceRate").textContent = totalMembers;
    document.getElementById("attendanceDelta").textContent = `${newVolunteersThisWeek} new this week`;

    // Load Upcoming Events for Volunteer
    await eventManager.loadVolunteerEvents();

    // Recent Activity
    const recentActivityRef = query(
      collection(db, "recentActivity"),
      orderBy("timestamp", "desc"),
      limit(5)
    );
    const recentSnap = await getDocs(recentActivityRef);
    const recentList = document.getElementById("recentActivityList");
    recentList.innerHTML = "";

    if (recentSnap.empty) {
      recentList.innerHTML = "<li>No recent activity</li>";
    } else {
      recentSnap.forEach((doc) => {
        const activity = doc.data();
        recentList.innerHTML += `
          <li>
            <strong>${activity.title}</strong>
            <p>${activity.details}</p>
          </li>
        `;
      });
    }

  } catch (err) {
    console.error("Error loading dashboard data:", err);
  }
};

// Volunteer Tasks Page
window.attachTasksPageListeners = function () {
  const grid = document.getElementById("tasksGrid");
  const searchInput = document.querySelector(".search-bar");
  const filterContainer = document.querySelector(".filters");
  const filterButtons = filterContainer ? filterContainer.querySelectorAll(".filter-btn") : [];

  if (!grid) {
    console.error("Tasks grid not found");
    return;
  }

  // Get current user
  const user = JSON.parse(localStorage.getItem("loggedInUser"));
  if (!user) {
    console.error("No user logged in");
    return;
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  async function loadMyTasks(filter = "all", query = "") {
    try {
      const { db, collection, getDocs } = window.firebaseServices;
      const tasksSnap = await getDocs(collection(db, "tasks"));
      const tasks = [];

      tasksSnap.forEach((doc) => {
        const task = doc.data();
        task.id = doc.id;
        // Only show tasks assigned to this volunteer
        if (task.assignedTo === user.uid) {
          tasks.push(task);
        }
      });

      // Apply status filter
      let filtered = tasks;
      if (filter === "pending") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "pending");
      } else if (filter === "in-progress") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "in-progress");
      } else if (filter === "completed") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "completed");
      }

      // Apply search
      const q = (query || "").trim().toLowerCase();
      if (q) {
        filtered = filtered.filter(t => {
          const title = (t.title || "").toLowerCase();
          const desc = (t.description || "").toLowerCase();
          return title.includes(q) || desc.includes(q);
        });
      }

      if (filtered.length === 0) {
        grid.innerHTML = "<p>No tasks found.</p>";
        return;
      }

      grid.innerHTML = filtered.map(renderTaskCard).join("");
    } catch (error) {
      console.error("Error loading tasks:", error);
      grid.innerHTML = "<p>Error loading tasks</p>";
    }
  }

  function renderTaskCard(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date";
    const priority = task.priority || "medium";
    const status = task.status || "pending";
    
    return `
      <div class="task-card">
        <div class="task-header">
          <h3>${task.title}</h3>
          <span class="task-priority ${priority}">${priority}</span>
        </div>
        <div class="task-details">
          <p>${task.description || "No description provided"}</p>
          <p><strong>Due:</strong> ${dueDate}</p>
          <p><strong>Program:</strong> ${task.programName || "General"}</p>
        </div>
        <div class="task-footer">
          <span class="task-status ${status}">${status}</span>
          <div class="task-actions">
            ${status !== "completed" ? `
              <button class="task-btn" onclick="taskManager.updateTaskStatus('${task.id}', 'in-progress')">Start</button>
              <button class="task-btn" onclick="taskManager.updateTaskStatus('${task.id}', 'completed')">Complete</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // Wire up filter buttons and search
  if (filterButtons.length) {
    filterButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".filters .filter-btn.active")?.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const text = (btn.textContent || "").trim().toLowerCase();
        let filter = "all";
        if (text === "pending") filter = "pending";
        if (text === "in progress") filter = "in-progress";
        if (text === "completed") filter = "completed";

        loadMyTasks(filter, searchInput?.value || "");
      });
    });
  }

  if (searchInput) {
    const debounced = debounce(() => {
      const activeBtn = document.querySelector(".filters .filter-btn.active");
      const filterText = (activeBtn?.textContent || "All Tasks").trim().toLowerCase();
      const filter = filterText === "pending" ? "pending" : 
                    filterText === "in progress" ? "in-progress" : 
                    filterText === "completed" ? "completed" : "all";
      loadMyTasks(filter, searchInput.value);
    }, 300);
    searchInput.addEventListener("input", debounced);
  }

  // Initial load
  const activeBtn = document.querySelector(".filters .filter-btn.active");
  const initialFilterText = (activeBtn?.textContent || "All Tasks").trim().toLowerCase();
  const initialFilter = initialFilterText === "pending" ? "pending" : 
                      initialFilterText === "in progress" ? "in-progress" : 
                      initialFilterText === "completed" ? "completed" : "all";
  loadMyTasks(initialFilter, "");
};

// Admin Task Management
window.attachAdminTasksListeners = async function () {
  const grid = document.getElementById("tasksGrid");
  const searchInput = document.querySelector(".search-bar");
  const filterContainer = document.querySelector(".filters");
  const filterButtons = filterContainer ? filterContainer.querySelectorAll(".filter-btn") : [];

  if (!grid) {
    console.error("Tasks grid not found");
    return;
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  async function loadAllTasks(filter = "all", query = "") {
    try {
      const { db, collection, getDocs } = window.firebaseServices;
      const tasksSnap = await getDocs(collection(db, "tasks"));
      const tasks = [];

      // Get all volunteers for display
      const volunteers = await getAllVolunteers();

      tasksSnap.forEach((doc) => {
        const task = doc.data();
        task.id = doc.id;
        
        // Find volunteer name
        const volunteer = volunteers.find(v => v.id === task.assignedTo);
        task.volunteerName = volunteer ? volunteer.name : "Unknown Volunteer";
        
        tasks.push(task);
      });

      // Apply status filter
      let filtered = tasks;
      if (filter === "pending") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "pending");
      } else if (filter === "in-progress") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "in-progress");
      } else if (filter === "completed") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "completed");
      }

      // Apply search
      const q = (query || "").trim().toLowerCase();
      if (q) {
        filtered = filtered.filter(t => {
          const title = (t.title || "").toLowerCase();
          const desc = (t.description || "").toLowerCase();
          const volunteerName = (t.volunteerName || "").toLowerCase();
          return title.includes(q) || desc.includes(q) || volunteerName.includes(q);
        });
      }

      if (filtered.length === 0) {
        grid.innerHTML = "<p>No tasks found.</p>";
        return;
      }

      grid.innerHTML = filtered.map(renderAdminTaskCard).join("");
    } catch (error) {
      console.error("Error loading tasks:", error);
      grid.innerHTML = "<p>Error loading tasks</p>";
    }
  }

  function renderAdminTaskCard(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date";
    const priority = task.priority || "medium";
    const status = task.status || "pending";
    
    return `
      <div class="task-card">
        <div class="task-header">
          <h3>${task.title}</h3>
          <span class="task-priority ${priority}">${priority}</span>
        </div>
        <div class="task-details">
          <p>${task.description || "No description provided"}</p>
          <p><strong>Assigned to:</strong> ${task.volunteerName}</p>
          <p><strong>Due:</strong> ${dueDate}</p>
          <p><strong>Program:</strong> ${task.programName || "General"}</p>
        </div>
        <div class="task-footer">
          <span class="task-status ${status}">${status}</span>
          <div class="task-actions">
            <button class="task-btn" onclick="taskManager.updateTaskStatus('${task.id}', 'completed')">Mark Complete</button>
            <button class="task-btn delete" onclick="taskManager.deleteTask('${task.id}')">Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  // Wire up filter buttons and search
  if (filterButtons.length) {
    filterButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".filters .filter-btn.active")?.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const text = (btn.textContent || "").trim().toLowerCase();
        let filter = "all";
        if (text === "pending") filter = "pending";
        if (text === "in progress") filter = "in-progress";
        if (text === "completed") filter = "completed";

        loadAllTasks(filter, searchInput?.value || "");
      });
    });
  }

  if (searchInput) {
    const debounced = debounce(() => {
      const activeBtn = document.querySelector(".filters .filter-btn.active");
      const filterText = (activeBtn?.textContent || "All Tasks").trim().toLowerCase();
      const filter = filterText === "pending" ? "pending" : 
                    filterText === "in progress" ? "in-progress" : 
                    filterText === "completed" ? "completed" : "all";
      loadAllTasks(filter, searchInput.value);
    }, 300);
    searchInput.addEventListener("input", debounced);
  }

  // Initial load
  const activeBtn = document.querySelector(".filters .filter-btn.active");
  const initialFilterText = (activeBtn?.textContent || "All Tasks").trim().toLowerCase();
  const initialFilter = initialFilterText === "pending" ? "pending" : 
                      initialFilterText === "in progress" ? "in-progress" : 
                      initialFilterText === "completed" ? "completed" : "all";
  loadAllTasks(initialFilter, "");
};

// Add Task Form
window.attachAddTaskListeners = async function () {
  const form = document.getElementById("addTaskForm");
  const assignedToSelect = document.getElementById("assignedTo");
  const programSelect = document.getElementById("relatedProgram");

  if (!form) {
    console.error("Add task form not found");
    return;
  }

  // Load volunteers into dropdown
  const volunteers = await getAllVolunteers();
  assignedToSelect.innerHTML = '<option value="">Select Volunteer</option>';
  volunteers.forEach(volunteer => {
    const option = document.createElement("option");
    option.value = volunteer.id;
    option.textContent = volunteer.name;
    assignedToSelect.appendChild(option);
  });

  // Load programs into dropdown
  const programs = await getAllPrograms();
  programSelect.innerHTML = '<option value="">Select Program</option>';
  programs.forEach(program => {
    const option = document.createElement("option");
    option.value = program.id;
    option.textContent = program.name;
    programSelect.appendChild(option);
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const task = {
      title: document.getElementById("taskTitle").value.trim(),
      description: document.getElementById("taskDescription").value.trim(),
      assignedTo: document.getElementById("assignedTo").value,
      priority: document.getElementById("taskPriority").value,
      dueDate: document.getElementById("dueDate").value,
      programId: document.getElementById("relatedProgram").value,
      programName: programSelect.options[programSelect.selectedIndex].text,
      status: "pending",
      createdAt: new Date().toISOString(),
      createdBy: JSON.parse(localStorage.getItem("loggedInUser")).uid
    };

    console.log("Task data:", task);

    try {
      const { db, collection, addDoc } = window.firebaseServices;
      await addDoc(collection(db, "tasks"), task);
      
      // Add to recent activity
      const volunteer = volunteers.find(v => v.id === task.assignedTo);
      await addDoc(collection(db, "recentActivity"), {
        title: "New Task Assigned",
        details: `Task "${task.title}" assigned to ${volunteer ? volunteer.name : 'volunteer'}`,
        type: "task_assigned",
        timestamp: new Date().toISOString()
      });

      alert("Task successfully assigned!");
      loadPage("admin-tasks");
    } catch (error) {
      console.error("Failed to assign task:", error);
      alert("Error: Failed to assign task.");
    }
  });
};

// Helper function to get all volunteers
async function getAllVolunteers() {
  try {
    const { db, collection, getDocs } = window.firebaseServices;
    const volunteers = [];

    // Get volunteers from users collection
    const usersSnap = await getDocs(collection(db, "users"));
    usersSnap.forEach(doc => {
      const user = doc.data();
      if (user.role && user.role.toLowerCase() === "volunteer") {
        volunteers.push({
          id: doc.id,
          name: user.name || user.fullName || "Unknown Volunteer",
          email: user.email
        });
      }
    });

    return volunteers;
  } catch (error) {
    console.error("Error getting volunteers:", error);
    return [];
  }
}

// Helper function to get all programs
async function getAllPrograms() {
  try {
    const { db, collection, getDocs } = window.firebaseServices;
    const programs = [];

    const programsSnap = await getDocs(collection(db, "programs"));
    programsSnap.forEach(doc => {
      const program = doc.data();
      programs.push({
        id: doc.id,
        name: program.name
      });
    });

    return programs;
  } catch (error) {
    console.error("Error getting programs:", error);
    return [];
  }
};



// Partner Dashboard
window.attachPartnerDashboardListeners = async function () {
  try {
    const { db, collection, getDocs, query, orderBy, limit, where } = window.firebaseServices;

    // Total Children
    const childrenSnap = await getDocs(collection(db, "children"));
    const totalChildren = childrenSnap.size;
    document.getElementById("totalChildren").textContent = totalChildren;
    document.getElementById("childrenDelta").textContent = `+${totalChildren} this month`;

    // Active Programs
    const programsSnap = await getDocs(collection(db, "programs"));
    let activeCount = 0;
    programsSnap.forEach((doc) => {
      const data = doc.data();
      if (data.status?.toLowerCase() === "active") activeCount++;
    });
    document.getElementById("activePrograms").textContent = activeCount;
    document.getElementById("programsStatus").textContent = `${activeCount === programsSnap.size ? "All running" : `${activeCount} running`}`;

    // My Tasks (specific to partner)
    const user = JSON.parse(localStorage.getItem("loggedInUser"));
    const tasksSnap = await getDocs(collection(db, "tasks"));
    const myTasks = [];
    tasksSnap.forEach((doc) => {
      const task = doc.data();
      if (task.assignedTo === user.uid) {
        myTasks.push(task);
      }
    });
    document.getElementById("myTasks").textContent = myTasks.length;
    document.getElementById("tasksDelta").textContent = `${myTasks.length > 0 ? myTasks.length + " assigned" : "No tasks"}`;

    // Partners Count
    const partnersSnap = await getDocs(collection(db, "partners"));
    const totalPartners = partnersSnap.size;
    
    // Calculate new partners this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    let newPartnersThisWeek = 0;
    partnersSnap.forEach((doc) => {
      const partner = doc.data();
      const registrationDate = partner.registrationDate ? new Date(partner.registrationDate) : new Date(partner.createdAt);
      if (registrationDate && registrationDate >= oneWeekAgo) {
        newPartnersThisWeek++;
      }
    });

    document.getElementById("partnerCount").textContent = totalPartners;
    document.getElementById("partnerDelta").textContent = `${newPartnersThisWeek} new this week`;

    // Load Upcoming Events for Partner
    await eventManager.loadPartnerEvents();

    // Recent Activity
    const recentActivityRef = query(
      collection(db, "recentActivity"),
      orderBy("timestamp", "desc"),
      limit(5)
    );
    const recentSnap = await getDocs(recentActivityRef);
    const recentList = document.getElementById("recentActivityList");
    recentList.innerHTML = "";

    if (recentSnap.empty) {
      recentList.innerHTML = "<li>No recent activity</li>";
    } else {
      recentSnap.forEach((doc) => {
        const activity = doc.data();
        recentList.innerHTML += `
          <li>
            <strong>${activity.title}</strong>
            <p>${activity.details}</p>
          </li>
        `;
      });
    }

  } catch (err) {
    console.error("Error loading partner dashboard data:", err);
  }
};

// Partner Tasks Page (similar to volunteer but for partners)
window.attachPartnerTasksPageListeners = function () {
  const grid = document.getElementById("tasksGrid");
  const searchInput = document.querySelector(".search-bar");
  const filterContainer = document.querySelector(".filters");
  const filterButtons = filterContainer ? filterContainer.querySelectorAll(".filter-btn") : [];

  if (!grid) {
    console.error("Tasks grid not found");
    return;
  }

  // Get current user
  const user = JSON.parse(localStorage.getItem("loggedInUser"));
  if (!user) {
    console.error("No user logged in");
    return;
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  async function loadMyTasks(filter = "all", query = "") {
    try {
      const { db, collection, getDocs } = window.firebaseServices;
      const tasksSnap = await getDocs(collection(db, "tasks"));
      const tasks = [];

      tasksSnap.forEach((doc) => {
        const task = doc.data();
        task.id = doc.id;
        // Only show tasks assigned to this partner
        if (task.assignedTo === user.uid) {
          tasks.push(task);
        }
      });

      // Apply status filter
      let filtered = tasks;
      if (filter === "pending") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "pending");
      } else if (filter === "in-progress") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "in-progress");
      } else if (filter === "completed") {
        filtered = tasks.filter(t => (t.status || "").toLowerCase() === "completed");
      }

      // Apply search
      const q = (query || "").trim().toLowerCase();
      if (q) {
        filtered = filtered.filter(t => {
          const title = (t.title || "").toLowerCase();
          const desc = (t.description || "").toLowerCase();
          return title.includes(q) || desc.includes(q);
        });
      }

      if (filtered.length === 0) {
        grid.innerHTML = "<p>No tasks found.</p>";
        return;
      }

      grid.innerHTML = filtered.map(renderTaskCard).join("");
    } catch (error) {
      console.error("Error loading tasks:", error);
      grid.innerHTML = "<p>Error loading tasks</p>";
    }
  }

  function renderTaskCard(task) {
    const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date";
    const priority = task.priority || "medium";
    const status = task.status || "pending";
    
    return `
      <div class="task-card">
        <div class="task-header">
          <h3>${task.title}</h3>
          <span class="task-priority ${priority}">${priority}</span>
        </div>
        <div class="task-details">
          <p>${task.description || "No description provided"}</p>
          <p><strong>Due:</strong> ${dueDate}</p>
          <p><strong>Program:</strong> ${task.programName || "General"}</p>
        </div>
        <div class="task-footer">
          <span class="task-status ${status}">${status}</span>
          <div class="task-actions">
            ${status !== "completed" ? `
              <button class="task-btn" onclick="taskManager.updateTaskStatus('${task.id}', 'in-progress')">Start</button>
              <button class="task-btn" onclick="taskManager.updateTaskStatus('${task.id}', 'completed')">Complete</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // Wire up filter buttons and search (same as volunteer)
  if (filterButtons.length) {
    filterButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        document.querySelectorAll(".filters .filter-btn.active")?.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const text = (btn.textContent || "").trim().toLowerCase();
        let filter = "all";
        if (text === "pending") filter = "pending";
        if (text === "in progress") filter = "in-progress";
        if (text === "completed") filter = "completed";

        loadMyTasks(filter, searchInput?.value || "");
      });
    });
  }

  if (searchInput) {
    const debounced = debounce(() => {
      const activeBtn = document.querySelector(".filters .filter-btn.active");
      const filterText = (activeBtn?.textContent || "All Tasks").trim().toLowerCase();
      const filter = filterText === "pending" ? "pending" : 
                    filterText === "in progress" ? "in-progress" : 
                    filterText === "completed" ? "completed" : "all";
      loadMyTasks(filter, searchInput.value);
    }, 300);
    searchInput.addEventListener("input", debounced);
  }

  // Initial load
  const activeBtn = document.querySelector(".filters .filter-btn.active");
  const initialFilterText = (activeBtn?.textContent || "All Tasks").trim().toLowerCase();
  const initialFilter = initialFilterText === "pending" ? "pending" : 
                      initialFilterText === "in progress" ? "in-progress" : 
                      initialFilterText === "completed" ? "completed" : "all";
  loadMyTasks(initialFilter, "");
};

// Partner Reports Page (simplified version of admin reports)
window.attachPartnerReportsPageListeners = function () {
  const form = document.getElementById("generateReportForm");
  const typeEl = document.getElementById("report-type");
  const rangeEl = document.getElementById("date-range");
  const resultsEl = document.getElementById("reportResults");

  if (!typeEl || !rangeEl || !resultsEl) {
    console.error("Reports UI not found");
    return;
  }

  const { db, collection, getDocs, addDoc, onSnapshot } = window.firebaseServices;

  // Live quick stats for partners
  const totalChildrenEl = document.getElementById("totalChildren");
  const activeProgramsEl = document.getElementById("activePrograms");
  const partnerCountEl = document.getElementById("partnerCount");
  const taskCountEl = document.getElementById("taskCount");

  // children count
  onSnapshot(collection(db, "children"), (snap) => {
    totalChildrenEl.textContent = snap.size;
  }, (err) => console.error("children snapshot err", err));

  // programs active count
  onSnapshot(collection(db, "programs"), (snap) => {
    let active = 0;
    snap.forEach(d => {
      const data = d.data();
      if ((data.status || "").toLowerCase() === "active" || (data.status || "").toLowerCase() === "ongoing") active++;
    });
    activeProgramsEl.textContent = active;
  }, (err) => console.error("programs snapshot err", err));

  // partners count
  onSnapshot(collection(db, "partners"), (snap) => {
    partnerCountEl.textContent = snap.size;
  }, (err) => console.error("partners snapshot err", err));

  // tasks count (partner's tasks only)
  const user = JSON.parse(localStorage.getItem("loggedInUser"));
  onSnapshot(collection(db, "tasks"), (snap) => {
    let partnerTasks = 0;
    snap.forEach(d => {
      const task = d.data();
      if (task.assignedTo === user.uid) {
        partnerTasks++;
      }
    });
    taskCountEl.textContent = partnerTasks;
  }, (err) => console.error("tasks snapshot err", err));

  // Simplified report generation for partners
  async function generateReport(reportType, dateRangeKey) {
    resultsEl.innerHTML = "<p>Generating report...</p>";

    try {
      if (reportType === "programs") {
        const programsSnap = await getDocs(collection(db, "programs"));
        let html = `<h3>Programs Report</h3>`;
        html += `<p>Total Programs: ${programsSnap.size}</p><ul>`;
        
        programsSnap.forEach(doc => {
          const program = doc.data();
          html += `<li><strong>${program.name}</strong>: ${program.status || 'No status'}</li>`;
        });
        html += `</ul>`;

        resultsEl.innerHTML = html;
        return;
      }

      if (reportType === "children") {
        const childrenSnap = await getDocs(collection(db, "children"));
        let html = `<h3>Children Report</h3>`;
        html += `<p>Total Children: ${childrenSnap.size}</p>`;
        
        // Simple age distribution
        const ageGroups = { '0-5': 0, '6-12': 0, '13-18': 0, '19+': 0 };
        childrenSnap.forEach(doc => {
          const child = doc.data();
          const age = child.age || 0;
          if (age <= 5) ageGroups['0-5']++;
          else if (age <= 12) ageGroups['6-12']++;
          else if (age <= 18) ageGroups['13-18']++;
          else ageGroups['19+']++;
        });
        
        html += `<h4>Age Distribution:</h4><ul>`;
        for (const [group, count] of Object.entries(ageGroups)) {
          html += `<li>${group} years: ${count}</li>`;
        }
        html += `</ul>`;

        resultsEl.innerHTML = html;
        return;
      }

      resultsEl.innerHTML = "<p>Please select a valid report type.</p>";
    } catch (err) {
      console.error("Report generation failed:", err);
      resultsEl.innerHTML = `<p class="error">Failed to generate report. See console for details.</p>`;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = typeEl.value;
    const range = rangeEl.value;
    if (!type || !range) {
      resultsEl.innerHTML = "<p>Please choose a report type and date range.</p>";
      return;
    }
    generateReport(type, range);
  });
};



