import admin from 'firebase-admin';

try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKeyB64 = process.env.FIREBASE_PRIVATE_KEY_B64;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const databaseUrl = process.env.FIREBASE_DATABASE_URL;

    if (!projectId || !privateKeyB64 || !clientEmail) {
        throw new Error(
            'Please set the FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY_B64, FIREBASE_CLIENT_EMAIL, FIREBASE_DATABASE_URL environment variables.'
        );
    }

    let decodedPrivateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_B64 ?? '', 'base64').toString('utf-8');
    if (decodedPrivateKey.includes('\\n')) {
        decodedPrivateKey = decodedPrivateKey.replace(/(\\n)/g, '\n');
    }

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId,
            privateKey: decodedPrivateKey,
            clientEmail,
        }),
        databaseURL: databaseUrl,
    });
} catch (error) {
    /*
     * We skip the "already exists" message which is
     * not an actual error when we're hot-reloading.
     */
    if (!/already exists/u.test(error.message)) {
        // eslint-disable-next-line no-console
        console.error('Firebase admin initialization error', error.stack);
    }
}

export interface Tokens {
    accessToken?: string;
    refreshToken?: string;
}

export async function getTokensFromFirebase(user: string): Promise<Tokens> {
    const ref = admin.database().ref().child(user);
    const accessToken = (await ref.child('access_token').once('value')).val() ?? undefined;
    const refreshToken = (await ref.child('refresh_token').once('value')).val() ?? undefined;

    return {
        accessToken,
        refreshToken,
    };
}

export async function writeTokensToFirebase(user: string, accessToken: string, refreshToken: string): Promise<void> {
    const ref = admin.database().ref().child(user);
    await ref.child('access_token').set(accessToken);
    await ref.child('refresh_token').set(refreshToken);
}

export async function warmup(): Promise<void> {
    const ref = admin.database().ref();
    return (await ref.limitToFirst(1).once('value')).val();
}
