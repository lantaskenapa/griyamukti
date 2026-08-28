import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  deleteDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  getDoc,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCnYbNTo5dRdL1czXE1l8-cyUTFUV9gSq8",
  authDomain: "griyamukti-4ddbc.firebaseapp.com",
  projectId: "griyamukti-4ddbc",
  storageBucket: "griyamukti-4ddbc.firebasestorage.app",
  messagingSenderId: "48662351389",
  appId: "1:48662351389:web:b51f97d9c1603e26d340f4",
  measurementId: "G-72825DMNCE"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Koleksi Firestore
const roomsCollection = collection(db, "rooms");
const historyCollection = collection(db, "history");

// Daftar nomor kamar per kos
const roomsGriyaMukti     = Array.from({length: 8},  (_, i) => (i + 1).toString().padStart(2, '0')); // 01-08
const roomsNewGriyaMukti  = Array.from({length: 10}, (_, i) => (i + 1).toString().padStart(2, '0')); // 01-10
const totalRooms = {
  griyaMukti: roomsGriyaMukti.length,     // 8
  newGriyaMukti: roomsNewGriyaMukti.length // 10
};

function updateEmptyRoomsDisplay() {
  let occupiedGriya = 0;
  let occupiedNew   = 0;

  Object.keys(occupiedRoomsCache).forEach(fullRoomId => {
    if (fullRoomId.startsWith("griyaMukti-")) occupiedGriya++;
    if (fullRoomId.startsWith("newGriyaMukti-")) occupiedNew++;
  });

  const emptyGriya = totalRooms.griyaMukti - occupiedGriya;
  const emptyNew   = totalRooms.newGriyaMukti - occupiedNew;

  const elGriya = document.getElementById("emptyGriya");
  const elNew   = document.getElementById("emptyNew");

  if (elGriya) {
    elGriya.textContent = emptyGriya;
    elGriya.className = emptyGriya <= 2 ? "text-danger fw-bold" : 
                        emptyGriya <= 4 ? "text-warning fw-bold" : 
                        "text-success fw-bold";
  }
  if (elNew) {
    elNew.textContent = emptyNew;
    elNew.className = emptyNew <= 2 ? "text-danger fw-bold" : 
                      emptyNew <= 4 ? "text-warning fw-bold" : 
                      "text-success fw-bold";
  }
}

// Variabel global
let currentKosType = "griyaMukti"; // default
let currentAvailableRooms = roomsGriyaMukti;
let occupiedRoomsCache = {};
let notifiedRoomsToday = new Set(); // Cegah notifikasi berulang di sesi yang sama

// ===== Helper: Hitung tanggal jatuh tempo bulanan berikutnya =====
function getNextDueDate(checkInStr) {
  if (!checkInStr) return null;
  const checkIn = new Date(checkInStr + "T00:00:00");
  if (isNaN(checkIn.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dueDay = checkIn.getDate();
  let due = new Date(today.getFullYear(), today.getMonth(), dueDay);
  due.setHours(0, 0, 0, 0);

  // Jika tanggal due sudah lewat bulan ini, ambil bulan depan
  if (due < today) {
    due = new Date(today.getFullYear(), today.getMonth() + 1, dueDay);
  }

  // Handle kasus tanggal tidak valid (misal 31 di bulan Feb)
  if (due.getDate() !== dueDay) {
    due = new Date(due.getFullYear(), due.getMonth() + 1, 0); // last day of month
  }

  return due;
}

function getDaysUntilDue(checkInStr) {
  const due = getNextDueDate(checkInStr);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = due - today;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function formatDateID(date) {
  if (!date) return "-";
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

// ===== Reminder H-3: Popup + Browser Notification =====
function checkAndShowReminders(roomsData) {
  const reminders = [];

  Object.keys(roomsData).forEach((fullRoomId) => {
    const data = roomsData[fullRoomId];
    if (!data || !data.checkIn) return;

    const daysLeft = getDaysUntilDue(data.checkIn);
    // H-3: tepat 3 hari sebelum, atau 0–3 hari (mendekati / hari H)
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 3) {
      const dueDate = getNextDueDate(data.checkIn);
      reminders.push({
        fullRoomId,
        roomNumber: data.roomNumber,
        name: data.name,
        kosType: data.kosType,
        daysLeft,
        dueDate,
        phone: data.phone || "-"
      });
    }
  });

  if (reminders.length === 0) return;

  // Filter yang belum pernah dinotifikasi hari ini di sesi ini
  const newReminders = reminders.filter(r => {
    const key = `${r.fullRoomId}-${r.dueDate.toISOString().slice(0, 10)}`;
    if (notifiedRoomsToday.has(key)) return false;
    notifiedRoomsToday.add(key);
    return true;
  });

  if (newReminders.length === 0) return;

  // 1. Tampilkan popup in-app (toast/modal)
  showReminderPopup(newReminders);

  // 2. Browser Notification (jika izin sudah diberikan)
  showBrowserNotification(newReminders);
}

function showReminderPopup(reminders) {
  // Buat container toast jika belum ada
  let container = document.getElementById("reminderToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "reminderToastContainer";
    container.className = "toast-container position-fixed top-0 end-0 p-3";
    container.style.zIndex = "1090";
    document.body.appendChild(container);
  }

  reminders.forEach((r, idx) => {
    const kosName = r.kosType === "griyaMukti" ? "Griya Mukti" : "New Griya Mukti";
    const statusText =
      r.daysLeft === 0
        ? "HARI INI jatuh tempo!"
        : r.daysLeft === 1
        ? "Besok jatuh tempo!"
        : `${r.daysLeft} hari lagi jatuh tempo`;

    const toastId = `reminder-toast-${Date.now()}-${idx}`;
    const toastHtml = `
      <div id="${toastId}" class="toast align-items-center text-bg-warning border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="false">
        <div class="d-flex">
          <div class="toast-body">
            <div class="fw-bold mb-1">
              <i class="bi bi-bell-fill me-1"></i> Reminder Jatuh Tempo
            </div>
            <div>
              <strong>${kosName} - Kamar ${r.roomNumber}</strong><br>
              Penghuni: ${r.name}<br>
              <span class="badge bg-danger">${statusText}</span>
              <br><small>Jatuh tempo: ${formatDateID(r.dueDate)}</small>
            </div>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", toastHtml);

    const toastEl = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastEl, { autohide: false });
    toast.show();

    // Hapus elemen setelah ditutup
    toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
  });
}

function showBrowserNotification(reminders) {
  if (!("Notification" in window)) return;

  const show = () => {
    reminders.forEach((r) => {
      const kosName = r.kosType === "griyaMukti" ? "Griya Mukti" : "New Griya Mukti";
      const statusText =
        r.daysLeft === 0
          ? "HARI INI jatuh tempo!"
          : r.daysLeft === 1
          ? "Besok jatuh tempo!"
          : `${r.daysLeft} hari lagi jatuh tempo`;

      new Notification("Reminder Jatuh Tempo - Griya Mukti", {
        body: `${kosName} Kamar ${r.roomNumber} (${r.name})\n${statusText}\nJatuh tempo: ${formatDateID(r.dueDate)}`,
        icon: "asset/logogriyamukti.png",
        tag: `due-${r.fullRoomId}`, // replace previous for same room
        requireInteraction: true
      });
    });
  };

  if (Notification.permission === "granted") {
    show();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") show();
    });
  }
}

// Minta izin notifikasi saat halaman dimuat (sekali)
if ("Notification" in window && Notification.permission === "default") {
  // Tunda sedikit agar tidak mengganggu load awal
  setTimeout(() => {
    Notification.requestPermission();
  }, 2000);
}

// Cache global + trigger re-populate dropdown setelah update
onSnapshot(roomsCollection, (snapshot) => {
  occupiedRoomsCache = {};
  snapshot.forEach((doc) => {
    occupiedRoomsCache[doc.id] = doc.data();
  });

  updateEmptyRoomsDisplay();

  // Cek reminder H-3
  checkAndShowReminders(occupiedRoomsCache);

  // Panggil ulang populateRoomOptions kalau modal sedang terbuka atau dropdown perlu refresh
  if (document.getElementById("addModal").classList.contains("show")) {
    populateRoomOptions(currentKosType);
  }
});

// Fungsi helper
function getAvailableRooms(kosType) {
  return kosType === "griyaMukti" ? roomsGriyaMukti : roomsNewGriyaMukti;
}

function getFullRoomId(kosType, roomNumber) {
  return `${kosType}-${roomNumber}`;
}

// Handle radio button change
document.querySelectorAll('input[name="kosType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    currentKosType = e.target.value;
    currentAvailableRooms = getAvailableRooms(currentKosType);
    renderAccordion();
  });
});

// Populate opsi nomor kamar (pintar: hilangkan kamar terisi, kecuali kamar lama saat edit)
function populateRoomOptions(kosType = currentKosType) {
  const select = document.getElementById("roomNumber");
  if (!select) return;

  const rooms = getAvailableRooms(kosType);
  const isEditMode = document.getElementById("submitBtn").textContent === "Simpan Perubahan";

  const oldFullRoomId = document.getElementById("oldRoomId").value.trim();
  let oldRoomNumber = "";
  if (oldFullRoomId) {
    const [, roomNum] = oldFullRoomId.split('-');
    oldRoomNumber = roomNum;
  }

  select.innerHTML = '<option value="" disabled selected>Pilih Nomor Kamar</option>';

  console.log(`[DEBUG] Populate dropdown untuk ${kosType} | Total kamar: ${rooms.length} | Cache terisi: ${Object.keys(occupiedRoomsCache).length}`);

  rooms.forEach(room => {
    const fullRoomId = getFullRoomId(kosType, room);
    const isOccupied = !!occupiedRoomsCache[fullRoomId];

    console.log(`[DEBUG] Kamar ${room} (${fullRoomId}) → occupied? ${isOccupied}`);

    if (!isOccupied || (isEditMode && room === oldRoomNumber)) {
      const option = document.createElement("option");
      option.value = room;
      option.textContent = `Kamar ${room}`;
      select.appendChild(option);
    }
  });

  if (select.options.length === 1) {
    const option = document.createElement("option");
    option.value = "";
    option.disabled = true;
    option.textContent = "Tidak ada kamar kosong";
    select.appendChild(option);
  }
}

// Update dropdown saat lokasi berubah
document.getElementById("locationSelect").addEventListener("change", function() {
  populateRoomOptions(this.value);
});

// Reset modal ke mode tambah baru (hanya dipanggil saat tambah baru)
function resetModalToAddMode() {
  document.getElementById("addModalLabel").textContent = "Tambah Penghuni Baru";
  document.getElementById("submitBtn").textContent = "Simpan Penghuni";
  document.getElementById("roomNumber").removeAttribute("readonly");
  document.getElementById("oldRoomId").value = "";

  document.getElementById("name").value = "";
  document.getElementById("phone").value = "";
  document.getElementById("jumlahPenghuni").value = "1";
  document.getElementById("checkIn").value = "";
  document.getElementById("harga").value = "";
  document.getElementById("notes").value = "";
}

// Saat modal dibuka
document.getElementById("addModal").addEventListener("show.bs.modal", function (event) {
  const trigger = event.relatedTarget;

  if (trigger && (trigger.classList.contains("btn-add") || trigger.getAttribute("onclick")?.includes("preselectRoom"))) {
    resetModalToAddMode();
  }

  document.getElementById("locationSelect").value = currentKosType;
  
  // Tunggu sebentar agar cache ke-update, lalu populate
  setTimeout(() => {
    populateRoomOptions();
  }, 500);  // 500ms cukup untuk snapshot Firestore update
});

// Form Submit (Tambah/Edit)
document.getElementById("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const location = document.getElementById("locationSelect").value;
  const roomNumber = document.getElementById("roomNumber").value.trim();
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const jumlahPenghuni = document.getElementById("jumlahPenghuni").value;
  const checkIn = document.getElementById("checkIn").value;
  const hargaRaw = document.getElementById("harga").value;
  const notes = document.getElementById("notes").value.trim();

  const harga = parseInt(hargaRaw, 10);

  if (!roomNumber || !name || !checkIn || !jumlahPenghuni || isNaN(harga) || harga < 0) {
    alert("Mohon isi semua field yang wajib (termasuk Harga Kos)!");
    return;
  }

  try {
    const fullRoomId = getFullRoomId(location, roomNumber);
    const roomRef = doc(db, "rooms", fullRoomId);

    const submitBtn = document.getElementById("submitBtn");
    const isEdit = submitBtn.textContent === "Simpan Perubahan";

    const oldFullRoomId = document.getElementById("oldRoomId").value.trim();
    if (isEdit && oldFullRoomId && oldFullRoomId !== fullRoomId) {
      await deleteDoc(doc(db, "rooms", oldFullRoomId));
      console.log(`Data lama dihapus dari ${oldFullRoomId}`);
    }

    const data = {
      roomNumber,
      name,
      phone,
      jumlahPenghuni: parseInt(jumlahPenghuni),
      checkIn,
      harga,
      notes,
      kosType: location,
      createdAt: serverTimestamp()
    };

    await setDoc(roomRef, data);

    await addDoc(historyCollection, {
      ...data,
      roomId: fullRoomId,
      action: isEdit ? "edit" : "check-in",
      timestamp: serverTimestamp()
    });

    alert(isEdit ? "Data penghuni berhasil diupdate!" : "Penghuni berhasil ditambahkan!");

    document.getElementById("oldRoomId").value = "";
    document.getElementById("addForm").reset();
    bootstrap.Modal.getInstance(document.getElementById("addModal")).hide();

    document.getElementById("addModalLabel").textContent = "Tambah Penghuni Baru";
    submitBtn.textContent = "Simpan Penghuni";
  } catch (error) {
    console.error("Error:", error);
    alert("Terjadi kesalahan: " + error.message);
  }
});

// Fungsi preselect untuk tambah baru dari kamar kosong
window.preselectRoom = function(roomNumber) {
  resetModalToAddMode();  // Reset ke tambah baru

  document.getElementById("locationSelect").value = currentKosType;
  populateRoomOptions();
  document.getElementById("roomNumber").value = roomNumber;
  document.getElementById("roomNumber").setAttribute("readonly", true);

  const modal = new bootstrap.Modal(document.getElementById("addModal"));
  modal.show();
};

// Fungsi edit penghuni
window.editPenghuni = function(fullRoomId) {
  getDoc(doc(db, "rooms", fullRoomId)).then((docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      const [location, roomNumber] = fullRoomId.split('-');

      document.getElementById("locationSelect").value = location;
      document.getElementById("oldRoomId").value = fullRoomId;

      populateRoomOptions(location);  // Tampilkan kamar lama + kosong

      document.getElementById("roomNumber").value = roomNumber;
      document.getElementById("roomNumber").setAttribute("readonly", true);

      document.getElementById("name").value = data.name || "";
      document.getElementById("phone").value = data.phone || "";
      document.getElementById("jumlahPenghuni").value = data.jumlahPenghuni || "1";
      document.getElementById("checkIn").value = data.checkIn || "";
      document.getElementById("harga").value = data.harga != null ? data.harga : "";
      document.getElementById("notes").value = data.notes || "";

      document.getElementById("addModalLabel").textContent = `Edit Penghuni Kamar ${roomNumber}`;
      document.getElementById("submitBtn").textContent = "Simpan Perubahan";

      const modal = new bootstrap.Modal(document.getElementById("addModal"));
      modal.show();
    } else {
      alert("Data kamar tidak ditemukan!");
    }
  }).catch((error) => {
    console.error("Error:", error);
    alert("Gagal memuat data.");
  });
};

// Render accordion — simpan unsubscribe agar tidak double listener
let unsubscribeAccordion = null;

function renderAccordion() {
  const accordion = document.getElementById("roomAccordion");
  if (!accordion) return;

  // Matikan listener lama supaya tidak double / looping
  if (typeof unsubscribeAccordion === "function") {
    unsubscribeAccordion();
    unsubscribeAccordion = null;
  }

  accordion.innerHTML = "";

  const kosType = currentKosType;
  const roomsList = [...getAvailableRooms(kosType)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const q = query(roomsCollection, where("kosType", "==", kosType));

  unsubscribeAccordion = onSnapshot(q, (snapshot) => {
    const occupiedRooms = {};
    snapshot.forEach((docSnap) => {
      occupiedRooms[docSnap.id] = docSnap.data();
    });

    // Bangun HTML sekali, lalu set — hindari append berulang
    let html = "";

    roomsList.forEach((roomNumber) => {
      const fullRoomId = getFullRoomId(kosType, roomNumber);
      const roomData = occupiedRooms[fullRoomId];
      const isOccupied = !!roomData;

      let dueInfo = "";
      let dueBadge = "";
      let headerExtra = "";
      if (isOccupied && roomData.checkIn) {
        const daysLeft = getDaysUntilDue(roomData.checkIn);
        const dueDate = getNextDueDate(roomData.checkIn);
        if (daysLeft !== null && dueDate) {
          dueInfo = `<p><strong>Jatuh Tempo Berikutnya:</strong> ${formatDateID(dueDate)}</p>`;
          if (daysLeft === 0) {
            dueBadge = `<span class="badge bg-danger ms-2">Hari ini jatuh tempo!</span>`;
            headerExtra = ` <span class="badge bg-danger">H-0</span>`;
          } else if (daysLeft === 1) {
            dueBadge = `<span class="badge bg-danger ms-2">Besok jatuh tempo</span>`;
            headerExtra = ` <span class="badge bg-danger">H-1</span>`;
          } else if (daysLeft <= 3) {
            dueBadge = `<span class="badge bg-warning text-dark ms-2">${daysLeft} hari lagi jatuh tempo</span>`;
            headerExtra = ` <span class="badge bg-warning text-dark">H-${daysLeft}</span>`;
          } else {
            dueBadge = `<span class="badge bg-light text-muted ms-2">${daysLeft} hari lagi</span>`;
          }
        }
      }

      let content;
      if (isOccupied) {
        const hargaText = roomData.harga != null
          ? `Rp ${Number(roomData.harga).toLocaleString("id-ID")}`
          : "-";

        content = `
  <p><strong>Nama:</strong> ${roomData.name}</p>
  <p><strong>Jumlah Penghuni:</strong> ${roomData.jumlahPenghuni} Orang</p>
  <p><strong>No. HP:</strong> ${roomData.phone || "-"}</p>
  <p><strong>Tanggal Masuk:</strong> ${new Date(roomData.checkIn).toLocaleDateString('id-ID')}</p>
  <p><strong>Harga Kos:</strong> ${hargaText} / bulan</p>
  ${dueInfo}
  ${dueBadge}
  ${roomData.notes ? `<p class="mt-2"><strong>Catatan:</strong> ${roomData.notes}</p>` : ""}
  <div class="mt-3">
    <button class="btn btn-outline-primary btn-sm rounded-pill me-2" onclick="editPenghuni('${fullRoomId}')">Edit Data</button>
    <button 
      class="btn btn-outline-danger btn-sm rounded-pill checkout-btn"
      data-room-id="${fullRoomId}"
      data-name="${(roomData.name || '').replace(/"/g, '&quot;')}">
      Checkout
    </button>
  </div>
`;
      } else {
        content = `
  <div class="text-center py-4">
    <span class="badge bg-secondary mb-3 px-4 py-2">KOSONG</span>
    <button class="btn btn-primary btn-add rounded-pill px-4 py-2" onclick="preselectRoom('${roomNumber}')">+ Tambah Penghuni</button>
  </div>
`;
      }

      html += `
        <div class="accordion-item ${isOccupied && headerExtra ? 'border border-warning' : ''}">
          <h2 class="accordion-header" id="heading-${fullRoomId}">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${fullRoomId}">
              Kamar ${roomNumber} ${isOccupied ? `- ${roomData.name}` : ''}${headerExtra}
            </button>
          </h2>
          <div id="collapse-${fullRoomId}" class="accordion-collapse collapse" data-bs-parent="#roomAccordion">
            <div class="accordion-body">${content}</div>
          </div>
        </div>
      `;
    });

    accordion.innerHTML = html;
  });
}

// Checkout
window.checkout = async function(fullRoomId, name) {
  if (!confirm(`Yakin checkout penghuni Kamar ${fullRoomId.split('-')[1]} (${name})?`)) return;

  try {
    const roomDoc = await getDoc(doc(db, "rooms", fullRoomId));
    if (!roomDoc.exists()) return;

    const data = roomDoc.data();

    await addDoc(historyCollection, {
      roomNumber: data.roomNumber,
      name: data.name,
      phone: data.phone,
      jumlahPenghuni: data.jumlahPenghuni,
      checkIn: data.checkIn,
      harga: data.harga != null ? data.harga : null,
      notes: data.notes,
      kosType: data.kosType,
      roomId: fullRoomId,
      action: "check-out",
      timestamp: serverTimestamp()
    });

    await deleteDoc(doc(db, "rooms", fullRoomId));

    alert(`Penghuni berhasil checkout!`);
  } catch (error) {
    console.error("Error checkout:", error);
    alert("Gagal checkout: " + error.message);
  }
};

// History
onSnapshot(query(historyCollection, orderBy("timestamp", "desc")), (snapshot) => {
  const historyList = document.getElementById("historyList");
  if (!historyList) return;

  historyList.innerHTML = "";

  snapshot.forEach((doc) => {
    const data = doc.data();
    const date = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString('id-ID') : "-";
    const kosName = data.kosType === "griyaMukti" ? "Griya Mukti" : "New Griya Mukti";

    historyList.innerHTML += `
      <li class="list-group-item">
        <strong>${kosName} - Kamar ${data.roomNumber}</strong> - ${data.name}
        ${data.jumlahPenghuni ? ` (${data.jumlahPenghuni} Orang)` : ''}
        <br><small class="text-muted">${date}</small>
        <span class="badge ${data.action === 'check-in' ? 'bg-success' : data.action === 'edit' ? 'bg-warning' : 'bg-danger'} ms-2">
          ${data.action === 'check-in' ? 'Masuk' : data.action === 'edit' ? 'Edit' : 'Keluar'}
        </span>
      </li>
    `;
  });
});

// Load pertama
renderAccordion();

document.getElementById("addModal").addEventListener("hidden.bs.modal", function () {
  // Reset ke mode tambah setelah modal ditutup
  resetModalToAddMode();
  document.getElementById("addForm").reset();
});

// Taruh ini di paling bawah file, setelah semua fungsi didefinisikan
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('checkout-btn')) {
    const fullRoomId = e.target.dataset.roomId;
    const name = e.target.dataset.name;

    if (!fullRoomId || !name) {
      console.error("Data atribut hilang pada tombol checkout");
      return;
    }

    // Panggil fungsi checkout yang sudah ada
    checkout(fullRoomId, name);
  }
});