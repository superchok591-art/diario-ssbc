/**
 * DIÁRIO SSBC — Serra Smash Badminton Club
 * Sistema Completo de Gestão de Alunos, Frequência, Calendário e Relatórios
 */

// Importações do SDK Oficial Modular v10 via CDN do Google
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import {
  listStudentsFromFirestore,
  saveStudentToFirestore,
  loadAttendanceByYearFromFirestore,
  saveAttendanceByYearToFirestore
} from "./firestore-service.js";

// Inicialização da Infraestrutura Firebase
let app = null;
let auth = null;
let db = null;

if (isFirebaseConfigured()) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("DIÁRIO SSBC: Firebase v10 inicializado com sucesso.");
  } catch (err) {
    console.error("DIÁRIO SSBC: Falha ao inicializar Firebase:", err);
  }
}

// --- Constantes e Configurações ---
const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%2394a3b8'%3E%3Ccircle cx='50' cy='36' r='24' fill='%23cbd5e1'/%3E%3Cpath d='M16 88c0-18.778 15.222-34 34-34s34 15.222 34 34z' fill='%23cbd5e1'/%3E%3C/svg%3E";
const STORAGE_KEYS = {
  STUDENTS: 'ssbc_students',
  THEME: 'ssbc_theme',
  ACTIVE_YEAR: 'ssbc_active_year',
  ATTENDANCE_PREFIX: 'ssbc_attendance_' // Ex: ssbc_attendance_2026
};

// --- Estado Global da Aplicação ---
const state = {
  currentYear: new Date().getFullYear(),
  activeYear: new Date().getFullYear(),
  activeTab: 'dashboard',
  calendarViewMonth: new Date().getMonth(),
  calendarViewYear: new Date().getFullYear(),
  students: [],
  attendanceData: {}, // Registros do ano ativo: { "YYYY-MM-DD": { studentId: "P" | "F" | "FJ" } }
  calendarEvents: {},  // { "YYYY-MM-DD": { type: "training" | "holiday", label: "..." } }
  tempPhotoBase64: null,
  currentEditingStudentId: null,
  isAuthenticated: false,
  currentUser: null
};

// --- Inicialização Robusta ---
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initAuthModule();
  });
} else {
  initTheme();
  initAuthModule();
}

// --- Módulo de Autenticação e Proteção ---
function initAuthModule() {
  setupAuthEventListeners();
  updateAuthUI();

  if (!auth) {
    console.warn("DIÁRIO SSBC: Firebase Auth não inicializado ou configuração incompleta.");
    return;
  }

  // Ouvinte de Estado de Autenticação do Firebase
  onAuthStateChanged(auth, async (user) => {
    const errorMsg = document.getElementById('authErrorMsg');
    if (user) {
      console.log(`DIÁRIO SSBC: Usuário autenticado no Auth: ${user.email} (UID: ${user.uid})`);
      
      // Validação de Administrador em /admins/{uid}
      try {
        const adminDocRef = doc(db, "admins", user.uid);
        const adminDocSnap = await getDoc(adminDocRef);

        if (adminDocSnap.exists() && adminDocSnap.data()?.active === true) {
          // Usuário é administrador confirmado e ativo
          state.isAuthenticated = true;
          state.currentUser = {
            uid: user.uid,
            email: user.email,
            name: adminDocSnap.data()?.name || user.displayName || user.email.split('@')[0],
            role: adminDocSnap.data()?.role || 'admin'
          };
          updateAuthUI();
          showToast(`Bem-vindo, ${state.currentUser.name}!`);
        } else {
          // Documento não existe ou active != true: encerra a sessão com signOut(auth)
          state.isAuthenticated = false;
          state.currentUser = null;
          updateAuthUI();
          try {
            await signOut(auth);
          } catch (soErr) {
            console.error("DIÁRIO SSBC: Erro ao encerrar sessão não autorizada:", soErr);
          }
          showAuthFeedback(
            errorMsg,
            `Acesso Restrito: O e-mail ${user.email} está cadastrado no sistema, mas não possui permissão ativa de administrador (/admins/${user.uid}). A sessão foi encerrada por segurança. Solicite autorização à diretoria do SSBC.`,
            'error'
          );
        }
      } catch (firestoreErr) {
        console.error("DIÁRIO SSBC: Erro ao validar administrador no Firestore:", firestoreErr);
        state.isAuthenticated = false;
        state.currentUser = null;
        updateAuthUI();

        // Encerra a sessão com signOut(auth) para manter o painel protegido
        try {
          await signOut(auth);
        } catch (soErr) {
          console.error("DIÁRIO SSBC: Erro ao deslogar após falha no Firestore:", soErr);
        }

        if (firestoreErr.code === 'permission-denied') {
          showAuthFeedback(
            errorMsg,
            `Autenticação realizada no Firebase Auth (${user.email}), mas as regras do Firestore atualmente no console bloqueiam o acesso (allow read, write: if false;). A sessão foi finalizada por segurança. Publique as regras de firestore.rules para habilitar a consulta de administradores.`,
            'info'
          );
        } else {
          showAuthFeedback(
            errorMsg,
            `Erro de conexão ao verificar permissões: ${firestoreErr.message || 'Tente novamente.'}. A sessão foi finalizada.`,
            'error'
          );
        }
      }
    } else {
      // Usuário desconectado
      state.isAuthenticated = false;
      state.currentUser = null;
      updateAuthUI();
    }
  });
}

function updateAuthUI() {
  const authScreen = document.getElementById('authScreen');
  const appHeader = document.getElementById('appHeader');
  const appNavbar = document.getElementById('appNavbar');
  const mainContent = document.getElementById('mainContent');

  if (state.isAuthenticated) {
    if (authScreen) authScreen.style.display = 'none';
    if (appHeader) appHeader.style.display = 'block';
    if (appNavbar) appNavbar.style.display = 'block';
    if (mainContent) mainContent.style.display = 'block';

    // Inicializa dados do diário apenas após login confirmado
    initYearControl();
    loadStorageData();
    setupNavigation();
    setupEventListeners();
    renderAll();
  } else {
    if (authScreen) authScreen.style.display = 'flex';
    if (appHeader) appHeader.style.display = 'none';
    if (appNavbar) appNavbar.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
  }
}

function setupAuthEventListeners() {
  const loginForm = document.getElementById('loginForm');
  const btnForgotPass = document.getElementById('btnForgotPass');
  const toggleEye = document.getElementById('togglePasswordVisibility');
  const loginPass = document.getElementById('loginPassword');
  const btnLogout = document.getElementById('btnLogoutBtn');
  const forgotForm = document.getElementById('forgotForm');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');

  // Toggle visibilidade de senha
  toggleEye?.addEventListener('click', () => {
    if (loginPass.type === 'password') {
      loginPass.type = 'text';
      toggleEye.textContent = '🙈';
    } else {
      loginPass.type = 'password';
      toggleEye.textContent = '👁️';
    }
  });

  // Submissão do Login com Firebase Authentication Real
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail')?.value.trim();
    const pass = document.getElementById('loginPassword')?.value;
    const errorMsg = document.getElementById('authErrorMsg');

    if (!auth) {
      showAuthFeedback(errorMsg, 'Serviço Firebase Auth indisponível ou chaves inválidas.', 'error');
      return;
    }

    if (!email || !pass) {
      showAuthFeedback(errorMsg, 'Informe o e-mail e a senha cadastrados.', 'error');
      return;
    }

    try {
      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = true;
        btnLoginSubmit.innerHTML = '<span class="btn-icon">⏳</span> Conectando...';
      }
      showAuthFeedback(errorMsg, 'Verificando credenciais no Firebase...', 'info');

      // Login real com Firebase Auth
      await signInWithEmailAndPassword(auth, email, pass);
      // onAuthStateChanged assumirá o fluxo de validação de administrador

    } catch (authErr) {
      console.error("DIÁRIO SSBC: Erro ao efetuar login:", authErr);
      let msg = 'Falha ao autenticar. Verifique e-mail e senha.';
      if (authErr.code === 'auth/invalid-credential' || authErr.code === 'auth/wrong-password' || authErr.code === 'auth/user-not-found') {
        msg = 'E-mail ou senha incorretos.';
      } else if (authErr.code === 'auth/invalid-email') {
        msg = 'O formato do e-mail é inválido.';
      } else if (authErr.code === 'auth/too-many-requests') {
        msg = 'Muitas tentativas sem sucesso. Aguarde alguns minutos ou redefina sua senha.';
      } else if (authErr.message) {
        msg = authErr.message;
      }
      showAuthFeedback(errorMsg, msg, 'error');
    } finally {
      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.innerHTML = '<span class="btn-icon">⚡</span> Entrar no Diário';
      }
    }
  });

  // Esqueci minha senha
  btnForgotPass?.addEventListener('click', () => {
    const modal = document.getElementById('forgotModal');
    const statusMsg = document.getElementById('forgotStatusMsg');
    if (statusMsg) statusMsg.style.display = 'none';
    modal?.classList.add('open');
  });

  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgotEmail')?.value.trim();
    const statusMsg = document.getElementById('forgotStatusMsg');
    const submitBtn = forgotForm.querySelector('button[type="submit"]');

    if (!auth) {
      showAuthFeedback(statusMsg, 'Serviço Firebase Auth não configurado.', 'error');
      return;
    }

    if (!email) {
      showAuthFeedback(statusMsg, 'Informe seu e-mail cadastrado.', 'error');
      return;
    }

    try {
      if (submitBtn) submitBtn.disabled = true;
      showAuthFeedback(statusMsg, 'Enviando e-mail de recuperação...', 'info');

      await sendPasswordResetEmail(auth, email);

      showAuthFeedback(statusMsg, `Link de redefinição enviado com sucesso para ${email}! Verifique sua caixa de entrada e a pasta de spam.`, 'success');
      setTimeout(() => {
        document.getElementById('forgotModal')?.classList.remove('open');
      }, 4000);
    } catch (resetErr) {
      console.error("DIÁRIO SSBC: Erro ao solicitar recuperação de senha:", resetErr);
      let msg = 'Erro ao enviar e-mail de recuperação.';
      if (resetErr.code === 'auth/user-not-found') {
        msg = 'Não encontramos nenhuma conta com este e-mail.';
      } else if (resetErr.code === 'auth/invalid-email') {
        msg = 'E-mail em formato inválido.';
      }
      showAuthFeedback(statusMsg, msg, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Informações de Provisionamento do Administrador
  const btnAdminSetupInfo = document.getElementById('btnAdminSetupInfo');
  btnAdminSetupInfo?.addEventListener('click', () => {
    const modal = document.getElementById('adminSetupModal');
    modal?.classList.add('open');
  });

  // Sair da Sessão (Sign Out Oficial do Firebase)
  btnLogout?.addEventListener('click', async () => {
    if (auth) {
      try {
        await signOut(auth);
      } catch (err) {
        console.error("DIÁRIO SSBC: Erro ao deslogar:", err);
      }
    }
    state.isAuthenticated = false;
    state.currentUser = null;
    updateAuthUI();
    showToast('Sessão encerrada com segurança.');
  });
}

function showAuthFeedback(element, message, type = 'error') {
  if (!element) return;
  element.className = `auth-feedback-msg ${type}`;
  element.textContent = message;
  element.style.display = 'block';
}

// Funções expostas para modais de auth
window.SSBC_AUTH = {
  closeForgotModal: () => document.getElementById('forgotModal')?.classList.remove('open'),
  closeAdminSetupModal: () => document.getElementById('adminSetupModal')?.classList.remove('open')
};

  // --- Tema Claro / Escuro ---
  function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEYS.THEME, next);
  }

  // --- Controle de Ano Automático e Histórico ---
  function initYearControl() {
    const nowYear = new Date().getFullYear();
    state.currentYear = nowYear;

    const savedYear = localStorage.getItem(STORAGE_KEYS.ACTIVE_YEAR);
    state.activeYear = savedYear ? parseInt(savedYear, 10) : nowYear;
    state.calendarViewYear = state.activeYear;

    renderYearSelectOptions();
  }

  function renderYearSelectOptions() {
    const select = document.getElementById('activeYearSelect');
    if (!select) return;

    select.innerHTML = '';
    // Disponibiliza 3 anos passados até o ano atual + 1 futuro
    const startYear = state.currentYear - 3;
    const endYear = state.currentYear + 1;

    for (let y = endYear; y >= startYear; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = `${y} ${y === state.currentYear ? '(Atual)' : ''}`;
      if (y === state.activeYear) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', (e) => {
      const chosen = parseInt(e.target.value, 10);
      switchActiveYear(chosen);
    });
  }

  function switchActiveYear(year) {
    state.activeYear = year;
    state.calendarViewYear = year;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_YEAR, year);
    loadAttendanceForYear(year);
    renderAll();
    showToast(`Ano letivo alterado para ${year}`);
  }

  // --- Persistência de Dados e Carregamento (Híbrido Firestore + LocalStorage) ---
  async function loadStorageData() {
    // 1. Carrega imediatamente do LocalStorage para renderização instantânea (offline/resiliente)
    try {
      const rawStudents = localStorage.getItem(STORAGE_KEYS.STUDENTS);
      if (rawStudents) {
        state.students = JSON.parse(rawStudents);
      } else {
        state.students = [];
      }
    } catch (e) {
      console.error("Erro ao ler alunos do LocalStorage:", e);
      state.students = [];
    }

    loadAttendanceForYear(state.activeYear);
    renderAll();

    // 2. Se o usuário for administrador autenticado, sincroniza com o Cloud Firestore
    if (state.isAuthenticated && db) {
      try {
        console.log("DIÁRIO SSBC: Sincronizando atletas da nuvem (Firestore)...");
        const res = await listStudentsFromFirestore(db);
        if (res.success && Array.isArray(res.students) && res.students.length > 0) {
          state.students = res.students;
          // Atualiza espelho local sem perder nada
          try {
            localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(state.students));
          } catch (lsErr) { }
          renderStudents();
          renderDashboard();
          console.log(`DIÁRIO SSBC: ${state.students.length} atletas sincronizados da nuvem.`);
        }
      } catch (fErr) {
        console.warn("DIÁRIO SSBC: Não foi possível obter atletas da nuvem, mantendo locais:", fErr);
      }

      // Sincroniza frequências do ano ativo da nuvem
      syncAttendanceFromFirestore(state.activeYear);
    }
  }

  function loadAttendanceForYear(year) {
    try {
      const key = `${STORAGE_KEYS.ATTENDANCE_PREFIX}${year}`;
      const raw = localStorage.getItem(key);
      state.attendanceData = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error(`Erro ao carregar presença de ${year}:`, e);
      state.attendanceData = {};
    }
  }

  async function syncAttendanceFromFirestore(year) {
    if (!state.isAuthenticated || !db) return;
    try {
      const res = await loadAttendanceByYearFromFirestore(year, db);
      if (res.success && res.records && Object.keys(res.records).length > 0) {
        // Se a nuvem tiver registros, combina ou adota os mais recentes
        state.attendanceData = { ...state.attendanceData, ...res.records };
        const key = `${STORAGE_KEYS.ATTENDANCE_PREFIX}${year}`;
        try {
          localStorage.setItem(key, JSON.stringify(state.attendanceData));
        } catch (lsErr) { }
        renderAttendance();
        renderDashboard();
        renderCalendar();
        console.log(`DIÁRIO SSBC: Frequências de ${year} sincronizadas da nuvem.`);
      }
    } catch (err) {
      console.warn(`DIÁRIO SSBC: Falha ao sincronizar frequência de ${year} da nuvem:`, err);
    }
  }

  function saveStudents() {
    // 1. Grava no LocalStorage local
    try {
      localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(state.students));
    } catch (e) {
      showToast("Aviso: Limite de armazenamento quase atingido. Exporte um backup!");
    }

    // 2. Grava na nuvem no Firestore se autenticado
    if (state.isAuthenticated && db) {
      // Salva em segundo plano preservando IDs
      Promise.all(state.students.map(s => saveStudentToFirestore(s, { allowLargePayload: true }, db)))
        .then(() => console.log("DIÁRIO SSBC: Atletas sincronizados no Firestore."))
        .catch(err => console.error("DIÁRIO SSBC: Erro ao sincronizar atletas no Firestore:", err));
    }
  }

  function saveAttendance() {
    const key = `${STORAGE_KEYS.ATTENDANCE_PREFIX}${state.activeYear}`;
    // 1. Grava no LocalStorage local
    try {
      localStorage.setItem(key, JSON.stringify(state.attendanceData));
    } catch (e) {
      showToast("Erro ao salvar presença: armazenamento cheio.");
    }

    // 2. Grava na nuvem no Firestore se autenticado
    if (state.isAuthenticated && db) {
      saveAttendanceByYearToFirestore(state.activeYear, state.attendanceData, db)
        .then(res => {
          if (res.success) {
            console.log(`DIÁRIO SSBC: Frequência do ano ${state.activeYear} salva no Firestore.`);
          } else {
            console.warn("DIÁRIO SSBC: Falha ao salvar frequência no Firestore:", res.error);
          }
        })
        .catch(err => console.error("DIÁRIO SSBC: Erro de rede ao salvar frequência no Firestore:", err));
    }
  }

  // --- Navegação por Abas ---
  let navigationInitialized = false;

  function setupNavigation() {
    if (navigationInitialized) return;
    navigationInitialized = true;

    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        const tab = link.dataset.tab;
        switchTab(tab);
      });
    });

    const mobileBtn = document.getElementById('mobileMenuBtn');
    const navbar = document.getElementById('appNavbar');
    if (mobileBtn && navbar) {
      mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navbar.classList.toggle('mobile-open');
      });

      // Fechar menu mobile ao tocar em qualquer área fora do menu
      document.addEventListener('click', (e) => {
        if (navbar.classList.contains('mobile-open') && !navbar.contains(e.target) && e.target !== mobileBtn) {
          navbar.classList.remove('mobile-open');
        }
      });
    }
  }

  function switchTab(tabId) {
    state.activeTab = tabId;

    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

    const targetTab = document.getElementById(`tab-${tabId}`);
    const targetLink = document.getElementById(`nav-${tabId}`);
    if (targetTab) targetTab.classList.add('active');
    if (targetLink) targetLink.classList.add('active');

    // Fecha menu mobile após clique
    const navbar = document.getElementById('appNavbar');
    if (navbar) navbar.classList.remove('mobile-open');

    // Executa atualizações específicas da aba
    if (tabId === 'dashboard') renderDashboard();
    if (tabId === 'students') renderStudents();
    if (tabId === 'attendance') renderAttendance();
    if (tabId === 'calendar') renderCalendar();
    if (tabId === 'reports') renderReports();
  }

  // --- Otimização e Compressão de Imagens ---
  function compressImage(file, maxWidth = 300, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  }

  // --- Handlers do Modal de Aluno & Upload de Foto ---
  function setupEventListeners() {
    // Alternador de Tema
    document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

    // Upload de Foto
    const photoInput = document.getElementById('studentPhotoInput');
    const previewImg = document.getElementById('photoPreviewImg');
    const removePhotoBtn = document.getElementById('btnRemovePhoto');

    photoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showToast('Por favor, selecione um arquivo de imagem válido.');
        return;
      }

      try {
        const compressed = await compressImage(file, 280, 0.75);
        state.tempPhotoBase64 = compressed;
        previewImg.src = compressed;
        removePhotoBtn.style.display = 'inline-flex';
      } catch (err) {
        showToast('Erro ao processar imagem.');
      }
    });

    removePhotoBtn?.addEventListener('click', () => {
      state.tempPhotoBase64 = '';
      previewImg.src = DEFAULT_AVATAR;
      removePhotoBtn.style.display = 'none';
      if (photoInput) photoInput.value = '';
    });

    // Form de Aluno
    const studentForm = document.getElementById('studentForm');
    studentForm?.addEventListener('submit', handleSaveStudent);

    // Filtros de Aluno
    document.getElementById('studentSearchInput')?.addEventListener('input', renderStudents);
    document.getElementById('studentFilterTurma')?.addEventListener('change', renderStudents);
    document.getElementById('studentFilterStatus')?.addEventListener('change', renderStudents);

    // Frequência
    const todayStr = getTodayISO();
    const dateInput = document.getElementById('attendanceDateInput');
    if (dateInput) {
      dateInput.value = todayStr;
      dateInput.addEventListener('change', renderAttendance);
    }
    document.getElementById('attendanceTurmaSelect')?.addEventListener('change', renderAttendance);
    document.getElementById('btnMarkAllPresent')?.addEventListener('click', markAllPresent);
    document.getElementById('btnSaveAttendance')?.addEventListener('click', () => {
      saveAttendance();
      renderDashboard();
      renderCalendar();
      showToast('Frequência salva com sucesso!');
    });

    // Calendário
    document.getElementById('btnPrevMonth')?.addEventListener('click', () => {
      state.calendarViewMonth--;
      if (state.calendarViewMonth < 0) {
        state.calendarViewMonth = 11;
        state.calendarViewYear--;
      }
      renderCalendar();
    });

    document.getElementById('btnNextMonth')?.addEventListener('click', () => {
      state.calendarViewMonth++;
      if (state.calendarViewMonth > 11) {
        state.calendarViewMonth = 0;
        state.calendarViewYear++;
      }
      renderCalendar();
    });

    document.getElementById('btnGoCurrentMonth')?.addEventListener('click', () => {
      const now = new Date();
      state.calendarViewMonth = now.getMonth();
      state.calendarViewYear = now.getFullYear();
      renderCalendar();
    });

    // Relatórios
    document.getElementById('reportTypeSelect')?.addEventListener('change', (e) => {
      const monthWrap = document.getElementById('reportMonthWrap');
      if (monthWrap) {
        monthWrap.style.display = e.target.value === 'monthly' ? 'flex' : 'none';
      }
      renderReports();
    });
    document.getElementById('reportMonthSelect')?.addEventListener('change', renderReports);
    document.getElementById('reportTurmaSelect')?.addEventListener('change', renderReports);
    document.getElementById('btnPrintReportBtn')?.addEventListener('click', () => window.print());

    // Backup
    document.getElementById('btnExportBackup')?.addEventListener('click', exportBackup);
    document.getElementById('importBackupInput')?.addEventListener('change', handleImportBackup);
    document.getElementById('btnLoadSampleData')?.addEventListener('click', loadSampleData);
  }

  // --- Funções Auxiliares de Data ---
  function getTodayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatDateBR(isoStr) {
    if (!isoStr) return '--/--/----';
    const [y, m, d] = isoStr.split('-');
    return `${d}/${m}/${y}`;
  }

  // --- Renderização Geral ---
  function renderAll() {
    renderDashboard();
    renderStudents();
    renderAttendance();
    renderCalendar();
    renderReports();
  }

  // ==========================================================================
  // ABA 1: DASHBOARD
  // ==========================================================================
  function renderDashboard() {
    const totalStudents = state.students.length;
    const activeStudents = state.students.filter(s => s.status === 'Ativo').length;

    document.getElementById('kpiActiveStudents').textContent = activeStudents;
    document.getElementById('kpiTotalStudents').textContent = `de ${totalStudents} cadastrados`;
    document.getElementById('kpiYearLabel').textContent = `Temporada ${state.activeYear}`;

    // Total de sessões de treino registradas no ano ativo
    const dates = Object.keys(state.attendanceData);
    document.getElementById('kpiTotalSessions').textContent = dates.length;

    // Frequência de hoje
    const today = getTodayISO();
    document.getElementById('kpiTodayDate').textContent = `${today.split('-')[2]}/${today.split('-')[1]}`;
    const todayRecords = state.attendanceData[today] || {};
    const presentToday = Object.values(todayRecords).filter(status => status === 'P').length;
    document.getElementById('kpiTodayCount').textContent = presentToday;

    // Taxa média geral
    let totalP = 0;
    let totalTotal = 0;
    dates.forEach(d => {
      const dayRec = state.attendanceData[d];
      Object.values(dayRec).forEach(val => {
        if (val === 'P') totalP++;
        if (val === 'P' || val === 'F' || val === 'FJ') totalTotal++;
      });
    });
    const avgRate = totalTotal > 0 ? Math.round((totalP / totalTotal) * 100) : 0;
    document.getElementById('kpiOverallAttendance').textContent = `${avgRate}%`;

    // Recentes treinos
    const recentDiv = document.getElementById('dashboardRecentSessions');
    if (recentDiv) {
      if (dates.length === 0) {
        recentDiv.innerHTML = '<p class="text-muted">Nenhum treino registrado neste ano ainda. Comece fazendo uma chamada na aba Frequência!</p>';
      } else {
        const sortedDates = [...dates].sort().reverse().slice(0, 5);
        let html = '<ul class="info-list" style="padding-left:0; list-style:none;">';
        sortedDates.forEach(d => {
          const rec = state.attendanceData[d];
          const pres = Object.values(rec).filter(s => s === 'P').length;
          const abs = Object.values(rec).filter(s => s === 'F').length;
          html += `
            <li style="display:flex; justify-content:space-between; padding:0.4rem 0; border-bottom:1px solid var(--border-color);">
              <span>📅 <strong>${formatDateBR(d)}</strong></span>
              <span><span style="color:var(--color-primary); font-weight:700;">${pres} P</span> / <span style="color:var(--color-danger); font-weight:700;">${abs} F</span></span>
            </li>
          `;
        });
        html += '</ul>';
        recentDiv.innerHTML = html;
      }
    }

    // Top Atletas Assíduos
    const topDiv = document.getElementById('dashboardTopStudents');
    if (topDiv) {
      const ranking = calculateRanking();
      if (ranking.length === 0) {
        topDiv.innerHTML = '<p class="text-muted">Nenhum registro suficiente para o ranking ainda.</p>';
      } else {
        const top5 = ranking.slice(0, 5);
        let html = '<div style="display:flex; flex-direction:column; gap:0.5rem;">';
        top5.forEach((item, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🏸';
          html += `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
              <div style="display:flex; align-items:center; gap:0.6rem;">
                <span>${medal}</span>
                <img src="${item.student.photo || DEFAULT_AVATAR}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;">
                <span style="font-weight:600; font-size:0.9rem;">${item.student.name}</span>
              </div>
              <span style="font-weight:700; color:var(--color-primary);">${item.percentage}%</span>
            </div>
          `;
        });
        html += '</div>';
        topDiv.innerHTML = html;
      }
    }
  }

  function calculateRanking() {
    const dates = Object.keys(state.attendanceData);
    if (dates.length === 0) return [];

    const stats = state.students.map(s => {
      let p = 0;
      let total = 0;
      dates.forEach(d => {
        const status = state.attendanceData[d]?.[s.id];
        if (status) {
          total++;
          if (status === 'P') p++;
        }
      });
      const pct = total > 0 ? Math.round((p / total) * 100) : 0;
      return { student: s, presentCount: p, totalCount: total, percentage: pct };
    });

    return stats.sort((a, b) => b.percentage - a.percentage || b.presentCount - a.presentCount);
  }

  // ==========================================================================
  // ABA 2: ALUNOS
  // ==========================================================================
  function renderStudents() {
    const container = document.getElementById('studentsContainer');
    if (!container) return;

    const searchTerm = (document.getElementById('studentSearchInput')?.value || '').toLowerCase();
    const filterTurma = document.getElementById('studentFilterTurma')?.value || 'ALL';
    const filterStatus = document.getElementById('studentFilterStatus')?.value || 'ALL';

    const filtered = state.students.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchTerm) ||
        (s.guardianName && s.guardianName.toLowerCase().includes(searchTerm));
      const matchTurma = filterTurma === 'ALL' || s.turma === filterTurma;
      const matchStatus = filterStatus === 'ALL' || s.status === filterStatus;
      return matchSearch && matchTurma && matchStatus;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding:3rem 1rem; color:var(--text-muted);">
          <div style="font-size:2.5rem; margin-bottom:0.5rem;">🏸</div>
          <h4>Nenhum aluno encontrado</h4>
          <p>Tente ajustar os filtros ou clique em "Cadastrar Aluno" para adicionar novos atletas.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(s => {
      const avatarSrc = s.photo || DEFAULT_AVATAR;
      const statusClass = s.status === 'Ativo' ? 'status-active' : 'status-inactive';

      return `
        <div class="student-card" data-id="${s.id}">
          <div class="student-card-top">
            <div class="student-photo-wrapper">
              <img src="${avatarSrc}" alt="${s.name}" class="student-avatar" loading="lazy">
              <span class="student-status-badge ${statusClass}" title="${s.status}"></span>
            </div>
            <div class="student-meta">
              <h4 class="student-name" title="${s.name}">${s.name}</h4>
              <span class="student-turma-tag">${s.turma}</span>
            </div>
          </div>

          <div class="student-card-details">
            <div>🎂 Nasc: <strong>${formatDateBR(s.birthDate)}</strong></div>
            <div>🗓️ Início: <strong>${formatDateBR(s.entryDate)}</strong></div>
            ${s.guardianName ? `<div>👤 Resp: <strong>${s.guardianName}</strong></div>` : ''}
            ${s.guardianPhone ? `<div>📱 Tel: <strong>${s.guardianPhone}</strong></div>` : ''}
          </div>

          <div class="student-card-actions">
            <button class="btn btn-outline btn-sm" onclick="window.SSBC.openProfileModal('${s.id}')">
              👁️ Perfil
            </button>
            <button class="btn btn-primary btn-sm" onclick="window.SSBC.editStudent('${s.id}')">
              ✏️ Editar
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function openStudentModal(editingId = null) {
    state.currentEditingStudentId = editingId;
    const modal = document.getElementById('studentModal');
    const title = document.getElementById('studentModalTitle');
    const form = document.getElementById('studentForm');
    const previewImg = document.getElementById('photoPreviewImg');
    const removeBtn = document.getElementById('btnRemovePhoto');
    const photoInput = document.getElementById('studentPhotoInput');

    form.reset();
    state.tempPhotoBase64 = null;
    if (photoInput) photoInput.value = '';

    if (editingId) {
      title.textContent = 'Editar Dados do Aluno';
      const student = state.students.find(s => s.id === editingId);
      if (student) {
        document.getElementById('studentEditId').value = student.id;
        document.getElementById('studentName').value = student.name;
        document.getElementById('studentBirthDate').value = student.birthDate;
        document.getElementById('studentTurma').value = student.turma;
        document.getElementById('studentEntryDate').value = student.entryDate;
        document.getElementById('studentStatus').value = student.status;
        document.getElementById('studentGuardianName').value = student.guardianName || '';
        document.getElementById('studentGuardianPhone').value = student.guardianPhone || '';
        document.getElementById('studentPhotoConsent').checked = !!student.photoConsent;

        if (student.photo) {
          previewImg.src = student.photo;
          removeBtn.style.display = 'inline-flex';
          state.tempPhotoBase64 = student.photo;
        } else {
          previewImg.src = DEFAULT_AVATAR;
          removeBtn.style.display = 'none';
        }
      }
    } else {
      title.textContent = 'Cadastrar Novo Aluno';
      document.getElementById('studentEditId').value = '';
      document.getElementById('studentEntryDate').value = getTodayISO();
      previewImg.src = DEFAULT_AVATAR;
      removeBtn.style.display = 'none';
    }

    modal.classList.add('open');
  }

  function closeStudentModal() {
    const modal = document.getElementById('studentModal');
    if (modal) modal.classList.remove('open');
    state.currentEditingStudentId = null;
    state.tempPhotoBase64 = null;
  }

  function handleSaveStudent(e) {
    e.preventDefault();

    const editId = document.getElementById('studentEditId').value;
    const name = document.getElementById('studentName').value.trim();
    const birthDate = document.getElementById('studentBirthDate').value;
    const turma = document.getElementById('studentTurma').value;
    const entryDate = document.getElementById('studentEntryDate').value;
    const status = document.getElementById('studentStatus').value;
    const guardianName = document.getElementById('studentGuardianName').value.trim();
    const guardianPhone = document.getElementById('studentGuardianPhone').value.trim();
    const photoConsent = document.getElementById('studentPhotoConsent').checked;

    if (!name || !birthDate || !turma) {
      showToast('Preencha os campos obrigatórios.');
      return;
    }

    if (editId) {
      // Edição
      const student = state.students.find(s => s.id === editId);
      if (student) {
        student.name = name;
        student.birthDate = birthDate;
        student.turma = turma;
        student.entryDate = entryDate;
        student.status = status;
        student.guardianName = guardianName;
        student.guardianPhone = guardianPhone;
        student.photoConsent = photoConsent;

        // Se o usuário selecionou uma nova foto ou removeu explicitamente
        if (state.tempPhotoBase64 !== null) {
          student.photo = state.tempPhotoBase64;
        }
        showToast('Aluno atualizado com sucesso!');
      }
    } else {
      // Novo cadastro
      const newStudent = {
        id: 'ssbc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name,
        birthDate,
        turma,
        entryDate,
        status,
        guardianName,
        guardianPhone,
        photoConsent,
        photo: state.tempPhotoBase64 || ''
      };
      state.students.push(newStudent);
      showToast('Aluno cadastrado com sucesso!');
    }

    saveStudents();
    closeStudentModal();
    renderStudents();
    renderDashboard();
    renderAttendance();
  }

  function openProfileModal(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;

    const modal = document.getElementById('profileModal');
    const content = document.getElementById('profileModalContent');
    const editBtn = document.getElementById('btnEditFromProfile');

    const avatar = student.photo || DEFAULT_AVATAR;

    // Estatísticas do aluno
    const dates = Object.keys(state.attendanceData);
    let pres = 0;
    let abs = 0;
    let just = 0;
    dates.forEach(d => {
      const st = state.attendanceData[d]?.[student.id];
      if (st === 'P') pres++;
      if (st === 'F') abs++;
      if (st === 'FJ') just++;
    });
    const totalSessions = pres + abs + just;
    const assiduity = totalSessions > 0 ? Math.round((pres / totalSessions) * 100) : 0;

    content.innerHTML = `
      <img src="${avatar}" alt="${student.name}" class="profile-avatar-xl">
      <h3 style="font-size:1.35rem; color:var(--text-heading); font-weight:800; text-align:center;">${student.name}</h3>
      <span class="student-turma-tag" style="font-size:0.85rem; padding:0.3rem 0.8rem;">${student.turma} • Situação: ${student.status}</span>

      <div class="profile-info-grid">
        <div class="profile-field">
          <span class="profile-field-label">Nascimento</span>
          <span class="profile-field-value">${formatDateBR(student.birthDate)}</span>
        </div>
        <div class="profile-field">
          <span class="profile-field-label">Entrada no SSBC</span>
          <span class="profile-field-value">${formatDateBR(student.entryDate)}</span>
        </div>
        <div class="profile-field">
          <span class="profile-field-label">Responsável</span>
          <span class="profile-field-value">${student.guardianName || 'Não informado'}</span>
        </div>
        <div class="profile-field">
          <span class="profile-field-label">Contato</span>
          <span class="profile-field-value">${student.guardianPhone || 'Não informado'}</span>
        </div>
      </div>

      <div style="width:100%; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--border-radius); padding:1rem;">
        <h4 style="font-size:0.9rem; font-weight:700; margin-bottom:0.75rem; text-transform:uppercase; color:var(--text-muted);">
          Assiduidade na Temporada ${state.activeYear}
        </h4>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span style="font-size:1.6rem; font-weight:800; color:var(--color-primary);">${assiduity}%</span>
            <div style="font-size:0.75rem; color:var(--text-muted);">${pres} presenças em ${totalSessions} treinos</div>
          </div>
          <div style="display:flex; gap:0.5rem; font-size:0.8rem; font-weight:700;">
            <span style="color:#10b981;">${pres} P</span>
            <span style="color:#ef4444;">${abs} F</span>
            <span style="color:#f59e0b;">${just} FJ</span>
          </div>
        </div>
      </div>
    `;

    editBtn.onclick = () => {
      closeProfileModal();
      openStudentModal(student.id);
    };

    modal.classList.add('open');
  }

  function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.classList.remove('open');
  }

  // ==========================================================================
  // ABA 3: FREQUÊNCIA DIÁRIA
  // ==========================================================================
  function renderAttendance() {
    const dateInput = document.getElementById('attendanceDateInput');
    const selectedDate = dateInput?.value || getTodayISO();
    const filterTurma = document.getElementById('attendanceTurmaSelect')?.value || 'ALL';
    const listContainer = document.getElementById('attendanceListContainer');

    if (!listContainer) return;

    if (!state.attendanceData[selectedDate]) {
      state.attendanceData[selectedDate] = {};
    }
    const currentDayAttendance = state.attendanceData[selectedDate];

    const activeStudents = state.students.filter(s => {
      const matchTurma = filterTurma === 'ALL' || s.turma === filterTurma;
      return s.status === 'Ativo' && matchTurma;
    });

    if (activeStudents.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center; padding:3rem 1rem; color:var(--text-muted);">
          <div style="font-size:2.5rem; margin-bottom:0.5rem;">👥</div>
          <h4>Nenhum aluno ativo encontrado para esta turma</h4>
          <p>Cadastre alunos ou altere a turma selecionada.</p>
        </div>
      `;
      updateAttendanceCounters(currentDayAttendance);
      return;
    }

    listContainer.innerHTML = activeStudents.map(student => {
      const avatarSrc = student.photo || DEFAULT_AVATAR;
      const currentStatus = currentDayAttendance[student.id] || null;

      const isP = currentStatus === 'P';
      const isF = currentStatus === 'F';
      const isFJ = currentStatus === 'FJ';

      return `
        <div class="attendance-row">
          <div class="attendance-student-info">
            <img src="${avatarSrc}" alt="${student.name}" class="attendance-avatar" loading="lazy">
            <div class="attendance-student-details">
              <span class="attendance-name">${student.name}</span>
              <span class="attendance-sub">${student.turma}</span>
            </div>
          </div>
          <div class="attendance-actions">
            <button type="button" class="btn-status-choice ${isP ? 'active-present' : ''}" 
              onclick="window.SSBC.setStudentAttendance('${student.id}', 'P')">
              ✅ Presente
            </button>
            <button type="button" class="btn-status-choice ${isF ? 'active-absent' : ''}" 
              onclick="window.SSBC.setStudentAttendance('${student.id}', 'F')">
              ❌ Falta
            </button>
            <button type="button" class="btn-status-choice ${isFJ ? 'active-justified' : ''}" 
              onclick="window.SSBC.setStudentAttendance('${student.id}', 'FJ')">
              ⚠️ Justificada
            </button>
          </div>
        </div>
      `;
    }).join('');

    updateAttendanceCounters(currentDayAttendance);
  }

  function setStudentAttendance(studentId, status) {
    const dateInput = document.getElementById('attendanceDateInput');
    const selectedDate = dateInput?.value || getTodayISO();

    if (!state.attendanceData[selectedDate]) {
      state.attendanceData[selectedDate] = {};
    }

    // Toggle se clicar no mesmo
    if (state.attendanceData[selectedDate][studentId] === status) {
      delete state.attendanceData[selectedDate][studentId];
    } else {
      state.attendanceData[selectedDate][studentId] = status;
    }

    saveAttendance();
    renderAttendance();
  }

  function markAllPresent() {
    const dateInput = document.getElementById('attendanceDateInput');
    const selectedDate = dateInput?.value || getTodayISO();
    const filterTurma = document.getElementById('attendanceTurmaSelect')?.value || 'ALL';

    if (!state.attendanceData[selectedDate]) {
      state.attendanceData[selectedDate] = {};
    }

    const activeStudents = state.students.filter(s => {
      const matchTurma = filterTurma === 'ALL' || s.turma === filterTurma;
      return s.status === 'Ativo' && matchTurma;
    });

    activeStudents.forEach(s => {
      state.attendanceData[selectedDate][s.id] = 'P';
    });

    saveAttendance();
    renderAttendance();
    showToast('Todos os alunos filtrados foram marcados como Presente!');
  }

  function updateAttendanceCounters(dayRecords) {
    let p = 0, f = 0, fj = 0;
    Object.values(dayRecords).forEach(status => {
      if (status === 'P') p++;
      if (status === 'F') f++;
      if (status === 'FJ') fj++;
    });

    const cP = document.getElementById('countPresent');
    const cF = document.getElementById('countAbsent');
    const cJ = document.getElementById('countJustified');
    if (cP) cP.textContent = p;
    if (cF) cF.textContent = f;
    if (cJ) cJ.textContent = fj;
  }

  // ==========================================================================
  // ABA 4: CALENDÁRIO ANUAL INTELIGENTE
  // ==========================================================================
  const MONTH_NAMES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  function renderCalendar() {
    const grid = document.getElementById('calendarDaysGrid');
    const label = document.getElementById('currentMonthYearLabel');
    if (!grid || !label) return;

    const month = state.calendarViewMonth;
    const year = state.calendarViewYear;

    label.textContent = `${MONTH_NAMES[month]} ${year}`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const todayStr = getTodayISO();

    let html = '';

    // Dias do mês anterior
    for (let i = firstDay - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      html += `
        <div class="calendar-day-cell other-month">
          <span class="day-cell-num">${dayNum}</span>
        </div>
      `;
    }

    // Dias do mês atual
    for (let day = 1; day <= daysInMonth; day++) {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;

      const isToday = dateStr === todayStr;
      const dayAttendance = state.attendanceData[dateStr];
      const hasAttendance = dayAttendance && Object.keys(dayAttendance).length > 0;

      let badgeHtml = '';
      if (hasAttendance) {
        const presCount = Object.values(dayAttendance).filter(s => s === 'P').length;
        badgeHtml = `<span class="day-badge day-badge-training">🏸 ${presCount} pres.</span>`;
      }

      html += `
        <div class="calendar-day-cell ${isToday ? 'today' : ''}" onclick="window.SSBC.selectCalendarDay('${dateStr}')">
          <span class="day-cell-num">${day}</span>
          <div class="day-cell-badges">
            ${badgeHtml}
          </div>
        </div>
      `;
    }

    // Completar restante da grade
    const totalCells = firstDay + daysInMonth;
    const remaining = 7 - (totalCells % 7);
    if (remaining < 7) {
      for (let j = 1; j <= remaining; j++) {
        html += `
          <div class="calendar-day-cell other-month">
            <span class="day-cell-num">${j}</span>
          </div>
        `;
      }
    }

    grid.innerHTML = html;
  }

  function selectCalendarDay(dateStr) {
    const title = document.getElementById('selectedDateTitle');
    const body = document.getElementById('selectedDateBody');
    if (!title || !body) return;

    title.textContent = `Treino do Dia ${formatDateBR(dateStr)}`;

    const attendance = state.attendanceData[dateStr];
    if (!attendance || Object.keys(attendance).length === 0) {
      body.innerHTML = `
        <p class="text-muted" style="margin-bottom:1rem;">Nenhuma presença registrada nesta data.</p>
        <button class="btn btn-primary btn-sm" onclick="window.SSBC.goToAttendanceDate('${dateStr}')">
          📝 Realizar Chamada Deste Dia
        </button>
      `;
      return;
    }

    let p = 0, f = 0, fj = 0;
    const studentListHtml = Object.entries(attendance).map(([studentId, status]) => {
      const st = state.students.find(s => s.id === studentId);
      const name = st ? st.name : 'Aluno Removido';
      const avatar = st?.photo || DEFAULT_AVATAR;
      let badge = '';
      if (status === 'P') { p++; badge = '<span style="color:#10b981; font-weight:700;">Presente</span>'; }
      if (status === 'F') { f++; badge = '<span style="color:#ef4444; font-weight:700;">Falta</span>'; }
      if (status === 'FJ') { fj++; badge = '<span style="color:#f59e0b; font-weight:700;">Justificada</span>'; }

      return `
        <li style="display:flex; align-items:center; justify-content:space-between; padding:0.4rem 0; border-bottom:1px solid var(--border-color);">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <img src="${avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover;">
            <span style="font-size:0.85rem;">${name}</span>
          </div>
          ${badge}
        </li>
      `;
    }).join('');

    body.innerHTML = `
      <div style="display:flex; gap:0.5rem; margin-bottom:1rem; font-size:0.85rem; font-weight:700;">
        <span class="badge-status-counter badge-present">${p} Presentes</span>
        <span class="badge-status-counter badge-absent">${f} Faltas</span>
        <span class="badge-status-counter badge-justified">${fj} Just.</span>
      </div>
      <ul style="list-style:none; padding:0; max-height:220px; overflow-y:auto; margin-bottom:1rem;">
        ${studentListHtml}
      </ul>
      <button class="btn btn-outline btn-sm" onclick="window.SSBC.goToAttendanceDate('${dateStr}')">
        ✏️ Editar Chamada Deste Dia
      </button>
    `;
  }

  function goToAttendanceDate(dateStr) {
    const input = document.getElementById('attendanceDateInput');
    if (input) input.value = dateStr;
    switchTab('attendance');
  }

  // ==========================================================================
  // ABA 5: RELATÓRIOS & PDF
  // ==========================================================================
  function renderReports() {
    const type = document.getElementById('reportTypeSelect')?.value || 'monthly';
    const month = parseInt(document.getElementById('reportMonthSelect')?.value || '9', 10);
    const filterTurma = document.getElementById('reportTurmaSelect')?.value || 'ALL';

    const headerMeta = document.getElementById('reportHeaderMeta');
    const summaryStats = document.getElementById('reportSummaryStats');
    const thead = document.getElementById('reportTableHead');
    const tbody = document.getElementById('reportTableBody');

    if (!tbody || !thead) return;

    const filteredStudents = state.students.filter(s => filterTurma === 'ALL' || s.turma === filterTurma);

    if (type === 'monthly') {
      headerMeta.textContent = `Ano Letivo: ${state.activeYear} | Mês: ${MONTH_NAMES[month]} | Turma: ${filterTurma === 'ALL' ? 'Geral' : filterTurma}`;

      // Acha datas do mês selecionado
      const monthPrefix = `${state.activeYear}-${String(month + 1).padStart(2, '0')}`;
      const monthDates = Object.keys(state.attendanceData).filter(d => d.startsWith(monthPrefix)).sort();

      summaryStats.innerHTML = `
        <div class="report-stat-item">
          <span class="report-stat-label">Treinos no Mês</span>
          <span class="report-stat-val">${monthDates.length}</span>
        </div>
        <div class="report-stat-item">
          <span class="report-stat-label">Atletas Avaliados</span>
          <span class="report-stat-val">${filteredStudents.length}</span>
        </div>
      `;

      thead.innerHTML = `
        <tr>
          <th>Atleta</th>
          <th>Turma</th>
          <th>Presenças</th>
          <th>Faltas</th>
          <th>Faltas Just.</th>
          <th>% Assiduidade</th>
        </tr>
      `;

      if (filteredStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem;">Nenhum aluno cadastrado.</td></tr>';
        return;
      }

      tbody.innerHTML = filteredStudents.map(student => {
        let p = 0, f = 0, fj = 0;
        monthDates.forEach(d => {
          const status = state.attendanceData[d]?.[student.id];
          if (status === 'P') p++;
          if (status === 'F') f++;
          if (status === 'FJ') fj++;
        });
        const total = p + f + fj;
        const rate = total > 0 ? Math.round((p / total) * 100) : 0;
        const avatar = student.photo || DEFAULT_AVATAR;

        return `
          <tr>
            <td>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <img src="${avatar}" style="width:26px; height:26px; border-radius:50%; object-fit:cover;">
                <strong>${student.name}</strong>
              </div>
            </td>
            <td>${student.turma}</td>
            <td style="color:#008744; font-weight:700;">${p}</td>
            <td style="color:#ef4444; font-weight:700;">${f}</td>
            <td style="color:#f59e0b; font-weight:700;">${fj}</td>
            <td><strong>${rate}%</strong></td>
          </tr>
        `;
      }).join('');

    } else if (type === 'annual') {
      headerMeta.textContent = `Ano Letivo: ${state.activeYear} | Consolidado Anual | Turma: ${filterTurma === 'ALL' ? 'Geral' : filterTurma}`;
      const allDates = Object.keys(state.attendanceData);

      summaryStats.innerHTML = `
        <div class="report-stat-item">
          <span class="report-stat-label">Total Treinos no Ano</span>
          <span class="report-stat-val">${allDates.length}</span>
        </div>
        <div class="report-stat-item">
          <span class="report-stat-label">Atletas Cadastrados</span>
          <span class="report-stat-val">${filteredStudents.length}</span>
        </div>
      `;

      thead.innerHTML = `
        <tr>
          <th>Atleta</th>
          <th>Turma</th>
          <th>Situação</th>
          <th>Total Presenças</th>
          <th>Total Aulas Avaliadas</th>
          <th>Taxa Anual</th>
        </tr>
      `;

      tbody.innerHTML = filteredStudents.map(student => {
        let p = 0, total = 0;
        allDates.forEach(d => {
          const status = state.attendanceData[d]?.[student.id];
          if (status) {
            total++;
            if (status === 'P') p++;
          }
        });
        const rate = total > 0 ? Math.round((p / total) * 100) : 0;
        const avatar = student.photo || DEFAULT_AVATAR;

        return `
          <tr>
            <td>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <img src="${avatar}" style="width:26px; height:26px; border-radius:50%; object-fit:cover;">
                <strong>${student.name}</strong>
              </div>
            </td>
            <td>${student.turma}</td>
            <td>${student.status}</td>
            <td style="color:#008744; font-weight:700;">${p}</td>
            <td>${total}</td>
            <td><strong>${rate}%</strong></td>
          </tr>
        `;
      }).join('');

    } else if (type === 'ranking') {
      headerMeta.textContent = `Ano Letivo: ${state.activeYear} | Ranking Oficial de Frequência`;
      const ranking = calculateRanking().filter(item => filterTurma === 'ALL' || item.student.turma === filterTurma);

      summaryStats.innerHTML = `
        <div class="report-stat-item">
          <span class="report-stat-label">Atleta Mais Assíduo</span>
          <span class="report-stat-val">${ranking[0]?.student.name || 'N/A'}</span>
        </div>
      `;

      thead.innerHTML = `
        <tr>
          <th>Posição</th>
          <th>Atleta</th>
          <th>Turma</th>
          <th>Presenças</th>
          <th>Taxa de Assiduidade</th>
        </tr>
      `;

      tbody.innerHTML = ranking.map((item, idx) => {
        const medal = idx === 0 ? '🥇 1º Lugar' : idx === 1 ? '🥈 2º Lugar' : idx === 2 ? '🥉 3º Lugar' : `${idx + 1}º`;
        const avatar = item.student.photo || DEFAULT_AVATAR;

        return `
          <tr>
            <td><strong>${medal}</strong></td>
            <td>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <img src="${avatar}" style="width:26px; height:26px; border-radius:50%; object-fit:cover;">
                <strong>${item.student.name}</strong>
              </div>
            </td>
            <td>${item.student.turma}</td>
            <td style="color:#008744; font-weight:700;">${item.presentCount}</td>
            <td style="color:var(--color-primary); font-weight:800; font-size:1.05rem;">${item.percentage}%</td>
          </tr>
        `;
      }).join('');
    }
  }

  // ==========================================================================
  // ABA 6: BACKUP & DADOS (EXPORT / IMPORT JSON)
  // ==========================================================================
  function exportBackup() {
    const includePhotos = document.getElementById('backupIncludePhotos')?.checked ?? true;

    // Clona os alunos para remover fotos se o usuário desmarcou a opção
    const studentsToExport = state.students.map(s => {
      const copy = { ...s };
      if (!includePhotos) {
        delete copy.photo;
      }
      return copy;
    });

    // Coleta as presenças de todos os anos salvos no LocalStorage
    const allAttendance = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEYS.ATTENDANCE_PREFIX)) {
        try {
          allAttendance[key] = JSON.parse(localStorage.getItem(key));
        } catch (e) { }
      }
    }

    const payload = {
      project: "DIÁRIO SSBC — Serra Smash Badminton Club",
      version: "1.0",
      exportDate: new Date().toISOString(),
      activeYear: state.activeYear,
      students: studentsToExport,
      attendanceByYears: allAttendance
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_diario_ssbc_${getTodayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Backup exportado com sucesso!');
  }

  function handleImportBackup(e) {
    const file = e.target.files[0];
    const statusDiv = document.getElementById('importStatus');
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!data.students || !Array.isArray(data.students)) {
          throw new Error("Formato de backup inválido: lista de alunos ausente.");
        }

        // Restaura alunos
        state.students = data.students;
        saveStudents();

        // Restaura presenças por ano
        if (data.attendanceByYears) {
          Object.entries(data.attendanceByYears).forEach(([key, val]) => {
            localStorage.setItem(key, JSON.stringify(val));
          });
        }

        // Recarrega ano ativo
        loadAttendanceForYear(state.activeYear);
        renderAll();

        statusDiv.innerHTML = '<span style="color:#10b981;">✅ Backup restaurado com sucesso! ' + state.students.length + ' alunos carregados.</span>';
        showToast('Backup restaurado com sucesso!');
      } catch (err) {
        statusDiv.innerHTML = '<span style="color:#ef4444;">❌ Erro ao restaurar arquivo: ' + err.message + '</span>';
        showToast('Erro ao importar backup.');
      }
    };
    reader.readAsText(file);
  }

  // --- Carregador de Dados de Demonstração (Para teste inicial) ---
  function loadSampleData() {
    if (state.students.length > 0) {
      if (!confirm('Deseja realmente carregar dados de demonstração? Seus dados atuais serão preservados e somados.')) {
        return;
      }
    }

    const sampleStudents = [
      {
        id: 'ssbc_sample_1',
        name: 'Mateus Henrique Silva',
        birthDate: '2010-04-12',
        turma: 'Avançado / Alto Rendimento',
        entryDate: '2024-02-10',
        status: 'Ativo',
        guardianName: 'Marcos Silva',
        guardianPhone: '(27) 99876-5432',
        photoConsent: true,
        photo: ''
      },
      {
        id: 'ssbc_sample_2',
        name: 'Camila Rodrigues Neves',
        birthDate: '2012-08-23',
        turma: 'Intermediário',
        entryDate: '2024-03-01',
        status: 'Ativo',
        guardianName: 'Luciana Neves',
        guardianPhone: '(27) 99765-4321',
        photoConsent: true,
        photo: ''
      },
      {
        id: 'ssbc_sample_3',
        name: 'Enzo Gabriel Santos',
        birthDate: '2015-11-05',
        turma: 'Infantil',
        entryDate: '2025-01-15',
        status: 'Ativo',
        guardianName: 'Patrícia Santos',
        guardianPhone: '(27) 99654-3210',
        photoConsent: true,
        photo: ''
      },
      {
        id: 'ssbc_sample_4',
        name: 'Beatriz Almeida Costa',
        birthDate: '2008-06-19',
        turma: 'Iniciante',
        entryDate: '2026-02-01',
        status: 'Ativo',
        guardianName: 'Carlos Costa',
        guardianPhone: '(27) 99543-2109',
        photoConsent: true,
        photo: ''
      }
    ];

    state.students = [...state.students, ...sampleStudents];
    saveStudents();

    // Cria alguns dias de frequência de exemplo para o ano ativo
    const today = getTodayISO();
    const [y, m] = today.split('-');
    const sampleDates = [
      `${y}-${m}-05`,
      `${y}-${m}-10`,
      `${y}-${m}-15`,
      `${y}-${m}-20`,
      today
    ];

    sampleDates.forEach((d, idx) => {
      if (!state.attendanceData[d]) {
        state.attendanceData[d] = {};
        sampleStudents.forEach((st, sIdx) => {
          state.attendanceData[d][st.id] = (idx + sIdx) % 4 === 0 ? 'F' : 'P';
        });
      }
    });

    saveAttendance();
    renderAll();
    showToast('Dados de demonstração do SSBC carregados!');
  }

  // --- Toast Notification ---
  function showToast(message) {
    const toast = document.getElementById('toastNotification');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  // --- Expor API global controlada para handlers inline seguros ---
  window.SSBC = {
    switchTab,
    openStudentModal,
    closeStudentModal,
    editStudent: (id) => openStudentModal(id),
    openProfileModal,
    closeProfileModal,
    setStudentAttendance,
    selectCalendarDay,
    goToAttendanceDate
  };

