import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC3mmkXtgYDScesuIGJxhnEWeH-voTRQ9A",
  authDomain: "areen-5b706.firebaseapp.com",
  projectId: "areen-5b706",
  storageBucket: "areen-5b706.firebasestorage.app",
  messagingSenderId: "1067344931821",
  appId: "1:1067344931821:web:7b22548790f356eb4895e4"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

export function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

export function usernameToEmail(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error("INVALID_USERNAME");
  return `${normalized}@areen.local`;
}

export async function loginWithUsername(username, password) {
  return signInWithEmailAndPassword(auth, usernameToEmail(username), password);
}

export async function logout() {
  return signOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function createAuthUserWithoutSwitching(username, password) {
  const secondary = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondary);
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, usernameToEmail(username), password);
    await signOut(secondaryAuth);
    return credential.user;
  } finally {
    await deleteApp(secondary).catch(() => {});
  }
}

export {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  serverTimestamp
};
