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

// Variabel global
let currentKosType = "griyaMukti"; // default
let currentAvailableRooms = roomsGriyaMukti;
let occupiedRoomsCache = {};

// Cache global + trigger re-populate dropdown setelah update
onSnapshot(roomsCollection, (snapshot) => {
  occupiedRoomsCache = {};
  snapshot.forEach((doc) => {
    occupiedRoomsCache[doc.id] = doc.data();
  });
  
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
  const notes = document.getElementById("notes").value.trim();

  if (!roomNumber || !name || !checkIn || !jumlahPenghuni) {
    alert("Mohon isi semua field yang wajib!");
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

// Render accordion (tetap)
function renderAccordion() {
  const accordion = document.getElementById("roomAccordion");
  if (!accordion) return;

  accordion.innerHTML = "";

  const q = query(roomsCollection, where("kosType", "==", currentKosType));

  onSnapshot(q, (snapshot) => {
    const occupiedRooms = {};
    snapshot.forEach((doc) => {
      occupiedRooms[doc.id] = doc.data();
    });

    currentAvailableRooms.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    currentAvailableRooms.forEach(roomNumber => {
      const fullRoomId = getFullRoomId(currentKosType, roomNumber);
      const roomData = occupiedRooms[fullRoomId];
      const isOccupied = !!roomData;

let content = isOccupied ? `
  <p><strong>Nama:</strong> ${roomData.name}</p>
  <p><strong>Jumlah Penghuni:</strong> ${roomData.jumlahPenghuni} Orang</p>
  <p><strong>No. HP:</strong> ${roomData.phone || "-"}</p>
  <p><strong>Tanggal Masuk:</strong> ${new Date(roomData.checkIn).toLocaleDateString('id-ID')}</p>
  ${roomData.notes ? `<p><strong>Catatan:</strong> ${roomData.notes}</p>` : ""}
  <div class="mt-3">
    <button class="btn btn-outline-primary btn-sm rounded-pill me-2" onclick="editPenghuni('${fullRoomId}')">Edit Data</button>
    <button 
      class="btn btn-outline-danger btn-sm rounded-pill checkout-btn"
      data-room-id="${fullRoomId}"
      data-name="${(roomData.name || '').replace(/"/g, '&quot;')}">  <!-- tambah || '' untuk safety -->
      Checkout
    </button>
  </div>
` : `
  <div class="text-center py-4">
    <span class="badge bg-secondary mb-3 px-4 py-2">KOSONG</span>
    <button class="btn btn-primary btn-add rounded-pill px-4 py-2" onclick="preselectRoom('${roomNumber}')">+ Tambah Penghuni</button>
  </div>
`;

      accordion.innerHTML += `
        <div class="accordion-item">
          <h2 class="accordion-header" id="heading-${fullRoomId}">
            <button class="accordion-button ${isOccupied ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${fullRoomId}">
              Kamar ${roomNumber} ${isOccupied ? `- ${roomData.name}` : ''}
            </button>
          </h2>
          <div id="collapse-${fullRoomId}" class="accordion-collapse collapse ${isOccupied ? 'show' : ''}" data-bs-parent="#roomAccordion">
            <div class="accordion-body">${content}</div>
          </div>
        </div>
      `;
    });
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