// ==========================================================================
// DIÁRIO SSBC — Serra Smash Badminton Club
// Configuração Oficial do Firebase Authentication & Firestore
// ==========================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBJRCAwmbIvw-vhvo1ITdpW__z0cW3sfhs",
  authDomain: "diario-ssbc.firebaseapp.com",
  projectId: "diario-ssbc",
  storageBucket: "diario-ssbc.firebasestorage.app",
  messagingSenderId: "188482024524",
  appId: "1:188482024524:web:07782fd5dfe9702aba30e9"
};

export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey.startsWith("AIzaSy") &&
    firebaseConfig.projectId === "diario-ssbc"
  );
}
