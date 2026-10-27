/**
 * DIÁRIO SSBC — Serra Smash Badminton Club
 * firestore-service.js
 * 
 * Camada de Serviço Oficial para Integração com Cloud Firestore.
 * Desenvolvido seguindo as diretrizes de segurança, compatibilidade de esquemas
 * e isolamento absoluto (sem executar migração e sem interferir no localStorage).
 */

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Constantes de Limites Técnicos do Firestore
export const FIRESTORE_LIMITS = {
  MAX_DOC_SIZE_BYTES: 1048576, // 1 MiB
  SAFE_ALERT_SIZE_BYTES: 400 * 1024, // 400 KiB (alerta para fotos)
  COLLECTIONS: {
    ADMINS: "admins",
    STUDENTS: "students",
    ATTENDANCE: "attendance"
  }
};

/**
 * Utilitário: Traduz e normaliza exceções do Firebase para mensagens claras em português.
 * @param {Error} error 
 * @returns {string} Mensagem amigável de diagnóstico
 */
export function formatFirestoreError(error) {
  if (!error) return "Erro desconhecido ao comunicar com Firestore.";
  
  const code = error.code || "";
  const msg = error.message || error.toString();

  if (code === "permission-denied") {
    return "Permissão negada (permission-denied): As regras de segurança do Firestore exigem um administrador ativo em /admins/{uid}.";
  }
  if (code === "unauthenticated") {
    return "Usuário não autenticado (unauthenticated): Faça login com Firebase Authentication antes de prosseguir.";
  }
  if (code === "unavailable") {
    return "Serviço Firestore temporariamente indisponível ou dispositivo sem conexão com a internet.";
  }
  if (code === "resource-exhausted") {
    return "Limite de cota excedido (resource-exhausted) ou documento grande demais (>1 MiB).";
  }
  if (code === "not-found") {
    return "O documento solicitado não foi encontrado no Cloud Firestore.";
  }
  
  return `Erro no Firestore [${code || "GENÉRICO"}]: ${msg}`;
}

/**
 * Utilitário: Estima o tamanho em bytes e KiB de uma estrutura de dados em memória UTF-8.
 * Não altera nem envia os dados.
 * @param {*} data 
 * @returns {{ bytes: number, kib: number, isSafe: boolean }}
 */
export function estimateDataSize(data) {
  try {
    const jsonString = JSON.stringify(data || {});
    // Codificação UTF-8 precisa
    const bytes = new TextEncoder().encode(jsonString).length;
    const kib = Math.round((bytes / 1024) * 10) / 10;
    const isSafe = bytes < FIRESTORE_LIMITS.SAFE_ALERT_SIZE_BYTES;
    return { bytes, kib, isSafe };
  } catch (err) {
    return { bytes: -1, kib: -1, isSafe: false, error: err.message };
  }
}

/**
 * Validação de Permissões Administrativas conforme firestore.rules
 * O usuário autenticado tem permissão de leitura sobre seu próprio documento `/admins/{uid}`.
 * Para operações em `/students` e `/attendance`, a regra exige que `active == true`.
 * 
 * IMPORTANTE: Testar esta leitura valida a credencial do administrador, mas a permissão
 * de escrita sobre outras coleções depende das regras de autorização ativas no servidor.
 * 
 * @param {object} [customDb] Instância opcional do Firestore
 * @param {object} [customAuth] Instância opcional do Auth
 * @returns {Promise<{ isAuthenticated: boolean, isClubAdmin: boolean, uid: string|null, adminData: object|null, details: string }>}
 */
export async function verifyAdminStatus(customDb, customAuth) {
  try {
    const auth = customAuth || getAuth();
    const db = customDb || getFirestore();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      return {
        isAuthenticated: false,
        isClubAdmin: false,
        uid: null,
        adminData: null,
        details: "Nenhum usuário logado no Firebase Authentication."
      };
    }

    const adminDocRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.ADMINS, currentUser.uid);
    const snap = await getDoc(adminDocRef);

    if (!snap.exists()) {
      return {
        isAuthenticated: true,
        isClubAdmin: false,
        uid: currentUser.uid,
        adminData: null,
        details: `Usuário autenticado (${currentUser.email}), porém o documento /admins/${currentUser.uid} não existe no Firestore.`
      };
    }

    const data = snap.data();
    const isActive = data?.active === true;

    return {
      isAuthenticated: true,
      isClubAdmin: isActive,
      uid: currentUser.uid,
      adminData: data,
      details: isActive
        ? `Administrador ativo confirmado: ${data?.name || currentUser.email} (Perfil: ${data?.role || "admin"})`
        : `Documento de administrador encontrado, mas o campo 'active' está ${data?.active}. Permissão suspensa.`
    };
  } catch (err) {
    return {
      isAuthenticated: false,
      isClubAdmin: false,
      uid: null,
      adminData: null,
      details: formatFirestoreError(err)
    };
  }
}

// ============================================================================
// MÓDULO 1: GESTÃO DE ATLETAS (Coleção 'students')
// ============================================================================

/**
 * Lista todos os atletas cadastrados na coleção '/students' no Cloud Firestore.
 * Não lista nem expõe dados se o usuário não for administrador ativo.
 * 
 * @param {object} [customDb] 
 * @returns {Promise<{ success: boolean, students?: Array<object>, error?: string }>}
 */
export async function listStudentsFromFirestore(customDb) {
  try {
    const db = customDb || getFirestore();
    const colRef = collection(db, FIRESTORE_LIMITS.COLLECTIONS.STUDENTS);
    const querySnapshot = await getDocs(colRef);

    const students = [];
    querySnapshot.forEach((docSnap) => {
      students.push({
        ...docSnap.data(),
        id: docSnap.id // Garante preservação do ID do documento
      });
    });

    return { success: true, students };
  } catch (err) {
    return { success: false, error: formatFirestoreError(err) };
  }
}

/**
 * Obtém os dados de um atleta específico a partir do seu ID.
 * @param {string} studentId 
 * @param {object} [customDb] 
 * @returns {Promise<{ success: boolean, student?: object, error?: string }>}
 */
export async function getStudentFromFirestore(studentId, customDb) {
  if (!studentId) {
    return { success: false, error: "ID do atleta não fornecido." };
  }

  try {
    const db = customDb || getFirestore();
    const docRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.STUDENTS, String(studentId));
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      return { success: false, error: `Atleta com ID '${studentId}' não encontrado no Firestore.` };
    }

    return { success: true, student: { ...snap.data(), id: snap.id } };
  } catch (err) {
    return { success: false, error: formatFirestoreError(err) };
  }
}

/**
 * Salva ou cria um atleta no Cloud Firestore preservando estritamente seu ID original.
 * Aplica verificação de limite de tamanho em memória antes de qualquer tentativa.
 * 
 * @param {object} student Objeto completo do atleta (deve conter student.id)
 * @param {object} [options]
 * @param {boolean} [options.allowLargePayload=false] Permite salvar mesmo com alerta de tamanho
 * @param {object} [customDb]
 * @returns {Promise<{ success: boolean, sizeReport: object, error?: string }>}
 */
export async function saveStudentToFirestore(student, options = {}, customDb) {
  if (!student || !student.id) {
    return {
      success: false,
      sizeReport: null,
      error: "Objeto do atleta inválido ou ausência do campo obrigatório 'id'."
    };
  }

  // 1. Verificação de Tamanho e Segurança em Memória
  const sizeReport = estimateDataSize(student);
  if (!sizeReport.isSafe && !options.allowLargePayload) {
    return {
      success: false,
      sizeReport,
      error: `Atenção: O atleta '${student.name || student.id}' possui dados de ${sizeReport.kib} KiB (provavelmente devido à foto em Base64). Limite de segurança é ${FIRESTORE_LIMITS.SAFE_ALERT_SIZE_BYTES / 1024} KiB. Envio bloqueado para evitar estouro de limites.`
    };
  }

  if (sizeReport.bytes >= FIRESTORE_LIMITS.MAX_DOC_SIZE_BYTES) {
    return {
      success: false,
      sizeReport,
      error: `Erro fatal: O tamanho do documento (${sizeReport.kib} KiB) excede o limite máximo permitido pelo Firestore (1 MiB).`
    };
  }

  try {
    const db = customDb || getFirestore();
    const docRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.STUDENTS, String(student.id));

    // Gravação com merge para preservar eventuais metadados adicionais
    await setDoc(docRef, {
      ...student,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    return { success: true, sizeReport };
  } catch (err) {
    return { success: false, sizeReport, error: formatFirestoreError(err) };
  }
}

/**
 * Atualiza campos específicos de um atleta existente sem regravar o documento inteiro.
 * 
 * @param {string} studentId 
 * @param {object} fieldsToUpdate 
 * @param {object} [customDb] 
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function updateStudentInFirestore(studentId, fieldsToUpdate, customDb) {
  if (!studentId || !fieldsToUpdate) {
    return { success: false, error: "Parâmetros inválidos para atualização de atleta." };
  }

  try {
    const db = customDb || getFirestore();
    const docRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.STUDENTS, String(studentId));

    await updateDoc(docRef, {
      ...fieldsToUpdate,
      updatedAt: new Date().toISOString()
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: formatFirestoreError(err) };
  }
}

/**
 * Exclui o documento de um atleta da coleção '/students'.
 * @param {string} studentId 
 * @param {object} [customDb] 
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function deleteStudentFromFirestore(studentId, customDb) {
  if (!studentId) {
    return { success: false, error: "ID do atleta não fornecido para exclusão." };
  }

  try {
    const db = customDb || getFirestore();
    const docRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.STUDENTS, String(studentId));

    await deleteDoc(docRef);
    return { success: true };
  } catch (err) {
    return { success: false, error: formatFirestoreError(err) };
  }
}

// ============================================================================
// MÓDULO 2: GESTÃO DE FREQUÊNCIAS (Coleção 'attendance')
// ============================================================================

/**
 * Carrega o registro de presenças de um determinado ano da coleção '/attendance/{year}'.
 * O modelo segue a estrutura do DIÁRIO SSBC:
 * {
 *   year: 2026,
 *   records: {
 *     "2026-10-24": { "studentId1": "P", "studentId2": "F" }
 *   }
 * }
 * 
 * @param {number|string} year 
 * @param {object} [customDb] 
 * @returns {Promise<{ success: boolean, records?: object, error?: string }>}
 */
export async function loadAttendanceByYearFromFirestore(year, customDb) {
  if (!year) {
    return { success: false, error: "Ano de frequência não informado." };
  }

  try {
    const db = customDb || getFirestore();
    const docRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.ATTENDANCE, String(year));
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      // Documento ainda não existe no Firestore: retorna registros vazios com sucesso
      return { success: true, records: {}, isNew: true };
    }

    const data = snap.data();
    return { success: true, records: data.records || {}, updatedAt: data.updatedAt };
  } catch (err) {
    return { success: false, error: formatFirestoreError(err) };
  }
}

/**
 * Salva o mapa anual completo de presenças em '/attendance/{year}'.
 * Valida o tamanho do documento antes da gravação.
 * 
 * @param {number|string} year 
 * @param {object} records Objeto { "YYYY-MM-DD": { studentId: "P" | "F" | "FJ" } }
 * @param {object} [customDb] 
 * @returns {Promise<{ success: boolean, sizeReport: object, error?: string }>}
 */
export async function saveAttendanceByYearToFirestore(year, records = {}, customDb) {
  if (!year) {
    return { success: false, sizeReport: null, error: "Ano de frequência não informado." };
  }

  const payload = {
    year: Number(year),
    records: records || {},
    updatedAt: new Date().toISOString()
  };

  const sizeReport = estimateDataSize(payload);
  if (sizeReport.bytes >= FIRESTORE_LIMITS.MAX_DOC_SIZE_BYTES) {
    return {
      success: false,
      sizeReport,
      error: `O volume anual de frequências (${sizeReport.kib} KiB) excede o limite por documento de 1 MiB.`
    };
  }

  try {
    const db = customDb || getFirestore();
    const docRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.ATTENDANCE, String(year));

    await setDoc(docRef, payload, { merge: true });
    return { success: true, sizeReport };
  } catch (err) {
    return { success: false, sizeReport, error: formatFirestoreError(err) };
  }
}

/**
 * Atualiza de maneira granular a frequência de uma data específica.
 * Utiliza o caminho de campo "records.YYYY-MM-DD" para não regravar todo o ano.
 * 
 * Atenção de Esquema:
 * As datas ISO (ex: "2026-10-24") usam hífens, que são perfeitamente suportados
 * como chaves dentro de mapas no Firestore.
 * 
 * @param {number|string} year 
 * @param {string} dateKey Data no formato "YYYY-MM-DD"
 * @param {object} dayRecords Objeto { studentId: "P" | "F" | "FJ" }
 * @param {object} [customDb] 
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function updateAttendanceDayInFirestore(year, dateKey, dayRecords, customDb) {
  if (!year || !dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return { success: false, error: "Ano ou formato de data inválido (esperado: YYYY-MM-DD)." };
  }

  try {
    const db = customDb || getFirestore();
    const docRef = doc(db, FIRESTORE_LIMITS.COLLECTIONS.ATTENDANCE, String(year));

    // Atualização com notação de mapa aninhado seguro
    const updatePayload = {};
    updatePayload[`records.${dateKey}`] = dayRecords || {};
    updatePayload["updatedAt"] = new Date().toISOString();

    await updateDoc(docRef, updatePayload);
    return { success: true };
  } catch (err) {
    // Se o documento do ano ainda não existe, cria com setDoc
    if (err.code === "not-found") {
      return saveAttendanceByYearToFirestore(year, { [dateKey]: dayRecords || {} }, customDb);
    }
    return { success: false, error: formatFirestoreError(err) };
  }
}
