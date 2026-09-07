import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
   apiKey: "AIzaSyDKeCWoloft-hm71VKKBFxTjsJBpr-JESo",
  authDomain: "finance-e3b5a.firebaseapp.com",
  projectId: "finance-e3b5a",
  storageBucket: "finance-e3b5a.firebasestorage.app",
  messagingSenderId: "863475693155",
  appId: "1:863475693155:web:e989913cc2abf5a9d16a56"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore and export it so other files can use it
export const db = getFirestore(app);