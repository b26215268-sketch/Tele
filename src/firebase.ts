import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Initialize Firestore with settings for better connectivity in sandboxed environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);
export const storage = getStorage(app);

// Connection heartbeat test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, '_heartbeat', 'connection'));
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Firestore connectivity issue: Please check your configuration or network.");
    } else {
       // Ignore other errors (like document not found which is expected for a heartbeat doc)
       console.log("Firestore reachability test completed.");
    }
  }
}
testConnection();
