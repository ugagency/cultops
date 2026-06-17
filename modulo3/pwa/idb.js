// ── IndexedDB helper para PrestAI Campo ──────────────────────
const DB_NAME    = 'prestai-campo';
const DB_VERSION = 1;

let _db = null;

function dbRequest(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

function cursorAll(store) {
    return new Promise((resolve, reject) => {
        const results = [];
        const req = store.openCursor();
        req.onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) { results.push(cursor.value); cursor.continue(); }
            else resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
}

async function initDB() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('eventos')) {
                db.createObjectStore('eventos', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('checkins')) {
                db.createObjectStore('checkins', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('fotos')) {
                db.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('sync_log')) {
                db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
            }
        };

        req.onsuccess = e => { _db = e.target.result; resolve(_db); };
        req.onerror   = () => reject(req.error);
    });
}

async function salvarEventoOffline(evento) {
    const db = await initDB();
    const tx = db.transaction('eventos', 'readwrite');
    await dbRequest(tx.objectStore('eventos').put(evento));
}

async function getEventosOffline() {
    const db = await initDB();
    const tx = db.transaction('eventos', 'readonly');
    return dbRequest(tx.objectStore('eventos').getAll());
}

async function getEventoOffline(id) {
    const db = await initDB();
    const tx = db.transaction('eventos', 'readonly');
    return dbRequest(tx.objectStore('eventos').get(id));
}

async function registrarCheckinOffline(checkin) {
    const db = await initDB();
    const tx = db.transaction('checkins', 'readwrite');
    return dbRequest(tx.objectStore('checkins').add({ ...checkin, sync_status: 'pendente' }));
}

async function getCheckinsPendentes() {
    const db = await initDB();
    const tx = db.transaction('checkins', 'readonly');
    const todos = await cursorAll(tx.objectStore('checkins'));
    return todos.filter(c => c.sync_status === 'pendente');
}

async function marcarSincronizado(checkinId) {
    const db = await initDB();
    const tx = db.transaction('checkins', 'readwrite');
    const store = tx.objectStore('checkins');
    const record = await dbRequest(store.get(checkinId));
    if (record) {
        record.sync_status = 'sincronizado';
        await dbRequest(store.put(record));
    }
}

async function salvarFotoOffline(eventId, base64, mimeType) {
    const db = await initDB();
    const tx = db.transaction('fotos', 'readwrite');
    return dbRequest(tx.objectStore('fotos').add({
        event_id:    eventId,
        base64,
        mime_type:   mimeType,
        timestamp:   new Date().toISOString(),
        sync_status: 'pendente',
    }));
}

async function getFotosPendentes() {
    const db = await initDB();
    const tx = db.transaction('fotos', 'readonly');
    const todas = await cursorAll(tx.objectStore('fotos'));
    return todas.filter(f => f.sync_status === 'pendente');
}

async function marcarFotoSincronizada(fotoId) {
    const db = await initDB();
    const tx = db.transaction('fotos', 'readwrite');
    const store = tx.objectStore('fotos');
    const record = await dbRequest(store.get(fotoId));
    if (record) {
        record.sync_status = 'sincronizado';
        await dbRequest(store.put(record));
    }
}

async function registrarSyncLog(tipo, sucesso, detalhes) {
    const db = await initDB();
    const tx = db.transaction('sync_log', 'readwrite');
    await dbRequest(tx.objectStore('sync_log').add({
        timestamp: new Date().toISOString(),
        tipo,
        sucesso,
        detalhes,
    }));
}

window.IDB = {
    initDB,
    salvarEventoOffline,
    getEventosOffline,
    getEventoOffline,
    registrarCheckinOffline,
    getCheckinsPendentes,
    marcarSincronizado,
    salvarFotoOffline,
    getFotosPendentes,
    marcarFotoSincronizada,
    registrarSyncLog,
};
