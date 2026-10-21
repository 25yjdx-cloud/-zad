import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCdPrKMXcsCMPgLcWhpYyvAjo1AgytpJu0",
  authDomain: "uns-app-2026.firebaseapp.com",
  projectId: "uns-app-2026",
  storageBucket: "uns-app-2026.firebasestorage.app",
  messagingSenderId: "458833662672",
  appId: "1:458833662672:web:193a6416d3955eead504d5",
  measurementId: "G-GK9D94VKDS"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
const db = getFirestore(app);

export { auth, db, googleProvider };
export default app;
