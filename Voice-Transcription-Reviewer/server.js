const express = require('express');
const session = require('express-session');
const multer = require('multer');
const csvParser = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ── App setup ─────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/originals', express.static(path.join(__dirname, 'originals')));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'transcription-reviewer-secret-key-2026',
  resave: false,
  saveUninitialized: false,
}));

// ── Persistence Setup ─────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
try { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}

const usersFilePath = path.join(dataDir, 'users.json');
const recordsFilePath = path.join(dataDir, 'records.json');
const originalRecordsPath = path.join(dataDir, 'records_original.json');

const uploadsDir = path.join(__dirname, 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}

const originalsDir = path.join(__dirname, 'originals');
try { if (!fs.existsSync(originalsDir)) fs.mkdirSync(originalsDir, { recursive: true }); } catch (e) {}

const editsDir = path.join(__dirname, 'edits');
try { if (!fs.existsSync(editsDir)) fs.mkdirSync(editsDir, { recursive: true }); } catch (e) {}
const editsLogPath = path.join(editsDir, 'edits_log.json');

// Password hashing helper
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === storedHash;
}

// User Persistence Helpers
function loadUsers() {
  if (!fs.existsSync(usersFilePath)) {
    const { salt, hash } = hashPassword('Admin@76');
    const defaultAdmin = [{
      id: 'usr_admin',
      username: 'admin',
      salt,
      hash,
      role: 'admin',
      quota: 0,
      startIndex: 0,
      canTrim: true,
      createdAt: new Date().toISOString()
    }];
    fs.writeFileSync(usersFilePath, JSON.stringify(defaultAdmin, null, 2));
    return defaultAdmin;
  }
  try {
    const raw = fs.readFileSync(usersFilePath, 'utf-8');
    const loaded = JSON.parse(raw);
    let runningStart = 0;
    return loaded.map(u => {
      const quota = typeof u.quota === 'number' ? u.quota : 0;
      let startIndex = typeof u.startIndex === 'number' ? u.startIndex : 0;
      if (u.role !== 'admin' && quota > 0 && typeof u.startIndex !== 'number') {
        startIndex = runningStart;
        runningStart += quota;
      } else if (u.role !== 'admin' && quota > 0) {
        runningStart = Math.max(runningStart, startIndex + quota);
      }
      return {
        ...u,
        quota,
        startIndex,
        canTrim: typeof u.canTrim === 'boolean' ? u.canTrim : true
      };
    });
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  } catch (e) {
    console.warn('Warning: saveUsers disk write failed (running in read-only environment):', e.message);
  }
}

let users = loadUsers();

// Edit History Logger (stores every change separately from original baseline)
function logEdit(entry) {
  try {
    let logs = [];
    if (fs.existsSync(editsLogPath)) {
      logs = JSON.parse(fs.readFileSync(editsLogPath, 'utf-8'));
    }
    logs.push(entry);
    fs.writeFileSync(editsLogPath, JSON.stringify(logs, null, 2));

    // Save individual snapshot file
    if (typeof entry.idx === 'number') {
      const snapPath = path.join(editsDir, `rec_${entry.idx}_${Date.now()}.json`);
      fs.writeFileSync(snapPath, JSON.stringify(entry, null, 2));
    }
  } catch (e) {
    console.error('Failed to log edit:', e);
  }
}

// Records Persistence Helpers
function loadRecords() {
  if (!fs.existsSync(recordsFilePath)) return [];
  try {
    const raw = fs.readFileSync(recordsFilePath, 'utf-8');
    const recs = JSON.parse(raw);
    return recs.map(r => {
      if (r.status === 'pending') {
        return {
          ...r,
          backgroundNoise: '',
          audioComplete: '',
          silenceAtBeginning: '',
          silenceAtEnd: '',
          speakingRate: '',
          emotion: '',
          volume: '',
          accent: ''
        };
      }
      return r;
    });
  } catch (e) {
    return [];
  }
}

function saveRecords(recs) {
  try {
    fs.writeFileSync(recordsFilePath, JSON.stringify(recs, null, 2));
  } catch (e) {
    console.warn('Warning: saveRecords disk write failed (running in read-only environment):', e.message);
  }
}

function loadOriginalRecords() {
  if (!fs.existsSync(originalRecordsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(originalRecordsPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function saveOriginalRecords(recs) {
  try {
    fs.writeFileSync(originalRecordsPath, JSON.stringify(recs, null, 2));
  } catch (e) {
    console.warn('Warning: saveOriginalRecords disk write failed (running in read-only environment):', e.message);
  }
}

let records = loadRecords();
let csvFilePath = path.join(uploadsDir, 'mapping.csv');

// Auto-seed original records if not present
if (records.length > 0 && !fs.existsSync(originalRecordsPath)) {
  saveOriginalRecords(records);
}

// ── Helper: Calculate next available start index ─────────
function getNextAvailableStartIndex(usersList) {
  let nextStart = 0;
  for (const u of usersList) {
    if (u.role !== 'admin' && typeof u.quota === 'number' && u.quota > 0) {
      const st = typeof u.startIndex === 'number' ? u.startIndex : 0;
      const uEnd = st + u.quota;
      if (uEnd > nextStart) {
        nextStart = uEnd;
      }
    }
  }
  return nextStart;
}

// ── Helper: Calculate user verified count ─────────────────
function getUserVerifiedCount(username) {
  if (!username) return 0;
  return records.filter(r => r.verifiedBy && r.verifiedBy.toLowerCase() === username.toLowerCase()).length;
}

// ── Auth Middleware ────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const currentUser = loadUsers().find(u => u.username.toLowerCase() === req.session.user.username.toLowerCase());
  if (!currentUser) {
    req.session.destroy(() => {});
    return res.redirect('/login?error=Your account has been removed.');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('index', {
      mode: 'error',
      user: req.session.user,
      error: 'Access Denied: Admin privileges required.'
    });
  }
  next();
}

// ── Multer setup ───────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    if (file.fieldname === 'csvFile') {
      cb(null, 'mapping.csv');
    } else {
      cb(null, file.originalname);
    }
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'csvFile') {
      if (!file.originalname.match(/\.csv$/i)) {
        return cb(new Error('Only CSV files are allowed for the mapping file.'));
      }
    } else if (file.fieldname === 'audioFiles') {
      if (!file.originalname.match(/\.(wav|mp3|ogg|m4a|flac|zip)$/i)) {
        return cb(new Error('Only audio files (wav/mp3/ogg/m4a/flac) or a ZIP archive are allowed.'));
      }
    }
    cb(null, true);
  },
});

// Helper: ZIP extraction
const AUDIO_EXT = /\.(wav|mp3|ogg|m4a|flac)$/i;
function extractAudioZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  let extracted = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const basename = path.basename(entry.entryName);
    if (!AUDIO_EXT.test(basename)) continue;
    if (basename.startsWith('.') || basename.startsWith('__MACOSX')) continue;
    const destPath = path.join(uploadsDir, basename);
    fs.writeFileSync(destPath, entry.getData());
    // Also save copy in originals
    const origPath = path.join(originalsDir, basename);
    fs.writeFileSync(origPath, entry.getData());
    extracted++;
  }
  fs.unlinkSync(zipPath);
  return extracted;
}

// Helper: parse CSV with strict SegAUD format support and validation
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let idCounter = 0;
    let isValidFormat = false;

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('headers', (headers) => {
        // SegAUD format check: requires an audio identifier AND a transcription field
        const lowerHeaders = headers.map(h => h.trim().toLowerCase());
        const hasAudioId = lowerHeaders.some(h => ['voice', 'file', 'segment_id', 'audio_file', 'source'].includes(h));
        const hasTranscription = lowerHeaders.some(h => [
          'transcript', 'transcription', 'orthographic_transcription', 'orthographictranscription', 'text'
        ].includes(h));

        if (hasAudioId && hasTranscription) {
          isValidFormat = true;
        }
      })
      .on('data', (row) => {
        // Fallback check on keys if headers event was skipped
        if (!isValidFormat) {
          const keys = Object.keys(row).map(k => k.trim().toLowerCase());
          const hasAudioId = keys.some(k => ['voice', 'file', 'segment_id', 'audio_file', 'source'].includes(k));
          const hasTranscription = keys.some(k => [
            'transcript', 'transcription', 'orthographic_transcription', 'orthographictranscription', 'text'
          ].includes(k));
          if (hasAudioId && hasTranscription) {
            isValidFormat = true;
          }
        }

        // Handle audio filename
        let voice = row.voice || row.Voice || '';
        if (!voice && row.file) {
          voice = path.basename(row.file.trim());
        }
        if (!voice && row.segment_id) {
          const sId = row.segment_id.trim();
          voice = sId.match(/\.(wav|mp3|ogg|m4a|flac)$/i) ? sId : `${sId}.wav`;
        }

        const transcription = (
          row.orthographic_transcription ||
          row.orthographicTranscription ||
          row.transcript ||
          row.Transcript ||
          row.transcription ||
          row.Transcription ||
          row.text ||
          ''
        ).trim();

        const normalizedTranscription = (
          row.normalized_transcription ||
          row.normalizedTranscription ||
          row.Normalized_Transcription ||
          transcription
        ).trim();

        const rawStatus = (row.status || row.Status || '').trim();
        const isVerified = (row.verified === 'yes' || row.verified === true || row.verified === 'true' || rawStatus === 'verified');
        const status = isVerified ? 'verified' : (rawStatus === 'edited' ? 'edited' : 'pending');

        const verifiedBy = row.verified_by || row.verifiedBy || (isVerified ? 'SegAUD' : null);

        rows.push({
          id: idCounter++,
          voice: voice.trim(),
          transcription,
          normalizedTranscription,
          speaker: (row.speaker || row.Speaker || 'Speaker 1').trim(),
          domain: (row.domain || row.Domain || '').trim(),
          backgroundNoise: row.background_noise || row.backgroundNoise || '',
          audioComplete: row.audio_complete || row.audioComplete || '',
          silenceAtBeginning: row.silence_at_beginning || row.silenceAtBeginning || '',
          silenceAtEnd: row.silence_at_end || row.silenceAtEnd || '',
          speakingRate: row.speaking_rate || row.speakingRate || '',
          emotion: row.emotion || row.Emotion || '',
          volume: row.volume || row.Volume || '',
          accent: row.accent || row.Accent || '',
          status,
          verifiedBy: verifiedBy ? verifiedBy.trim() : null,
          updatedAt: row.updated_at || null
        });
      })
      .on('end', () => {
        if (rows.length > 0 && !isValidFormat) {
          return reject(new Error('Invalid CSV format. Only SegAUD format CSV files (with columns: segment_id/voice, transcript/orthographic_transcription, speaker, domain) are accepted.'));
        }
        resolve(rows);
      })
      .on('error', reject);
  });
}

// Helper: write CSV
async function writeCSV(filePath, data) {
  const writer = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'voice', title: 'voice' },
      { id: 'transcription', title: 'orthographic_transcription' },
      { id: 'normalizedTranscription', title: 'normalized_transcription' },
      { id: 'speaker', title: 'speaker' },
      { id: 'domain', title: 'domain' },
      { id: 'backgroundNoise', title: 'background_noise' },
      { id: 'audioComplete', title: 'audio_complete' },
      { id: 'silenceAtBeginning', title: 'silence_at_beginning' },
      { id: 'silenceAtEnd', title: 'silence_at_end' },
      { id: 'speakingRate', title: 'speaking_rate' },
      { id: 'emotion', title: 'emotion' },
      { id: 'volume', title: 'volume' },
      { id: 'accent', title: 'accent' },
      { id: 'status', title: 'status' },
      { id: 'verifiedBy', title: 'verified_by' },
      { id: 'updatedAt', title: 'updated_at' },
    ],
  });
  await writer.writeRecords(data);
}

// ── Auth Routes ───────────────────────────────────────────

// GET /auth/segaud-admin (Direct seamless admin session for local launcher from SegAUD)
app.get('/auth/segaud-admin', (req, res) => {
  const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip) ||
                  req.hostname === 'localhost' ||
                  req.hostname === '127.0.0.1';
  if (!isLocal) {
    return res.status(403).send('Direct SegAUD integration is only allowed from local machine.');
  }

  users = loadUsers();
  let adminUser = users.find(u => u.role === 'admin' || u.username.toLowerCase() === 'admin');
  if (!adminUser) {
    adminUser = {
      id: 'usr_admin',
      username: 'admin',
      role: 'admin',
      quota: 0,
      startIndex: 0,
      canTrim: true
    };
  }

  req.session.user = {
    id: adminUser.id,
    username: adminUser.username,
    role: 'admin',
    quota: 0,
    startIndex: 0,
    canTrim: true
  };

  const target = req.query.target || '/';
  res.redirect(target);
});

// GET /login
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('index', {
    mode: 'login',
    user: null,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// POST /login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('index', {
      mode: 'login',
      user: null,
      error: 'Please enter both username and password.',
      success: null
    });
  }

  users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  const passwordValid = user && verifyPassword(password, user.salt, user.hash);

  if (!user || !passwordValid) {
    return res.render('index', {
      mode: 'login',
      user: null,
      error: 'Invalid username or password.',
      success: null
    });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    quota: typeof user.quota === 'number' ? user.quota : 0,
    startIndex: typeof user.startIndex === 'number' ? user.startIndex : 0,
    canTrim: typeof user.canTrim === 'boolean' ? user.canTrim : true
  };

  res.redirect('/');
});

// GET /logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ── Admin Routes ───────────────────────────────────────────

// POST /admin/users/create
app.post('/admin/users/create', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, quota, startRecord, canTrim } = req.body;
  const cleanUsername = (username || '').trim();
  const cleanPassword = (password || '').trim();
  const cleanRole = (role === 'admin') ? 'admin' : 'verifier';
  const cleanQuota = Math.max(0, parseInt(quota || '0', 10));
  const cleanCanTrim = (canTrim === 'true' || canTrim === 'on' || canTrim === true);

  users = loadUsers();

  let cleanStart = 0;
  if (cleanRole !== 'admin' && cleanQuota > 0) {
    if (typeof startRecord !== 'undefined' && startRecord !== '') {
      cleanStart = Math.max(0, parseInt(startRecord, 10) - 1);
    } else {
      cleanStart = getNextAvailableStartIndex(users);
    }
  }

  if (!cleanUsername || cleanUsername.length < 3) {
    return res.redirect('/?tab=users&error=Username must be at least 3 characters long');
  }
  if (!cleanPassword || cleanPassword.length < 4) {
    return res.redirect('/?tab=users&error=Password must be at least 4 characters long');
  }

  const exists = users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (exists) {
    return res.redirect('/?tab=users&error=User already exists with that username');
  }

  const { salt, hash } = hashPassword(cleanPassword);
  const newUser = {
    id: 'usr_' + Date.now(),
    username: cleanUsername,
    salt,
    hash,
    role: cleanRole,
    quota: cleanQuota,
    startIndex: cleanStart,
    canTrim: cleanCanTrim,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);

  const rangeMsg = cleanQuota > 0 ? `Assigned records ${cleanStart + 1} to ${cleanStart + cleanQuota}` : 'Assigned all records';
  res.redirect(`/?tab=users&success=User "${cleanUsername}" created successfully! (${rangeMsg}, Trimming: ${cleanCanTrim ? 'Allowed' : 'Disabled'})`);
});

// POST /admin/users/update-quota
app.post('/admin/users/update-quota', requireAuth, requireAdmin, (req, res) => {
  const { username, quota, startRecord, canTrim } = req.body;
  const cleanUsername = (username || '').trim();
  const cleanQuota = Math.max(0, parseInt(quota || '0', 10));
  const cleanStart = Math.max(0, parseInt(startRecord || '1', 10) - 1);
  const cleanCanTrim = (canTrim === 'true' || canTrim === 'on' || canTrim === true);

  users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (!user) {
    return res.redirect('/?tab=users&error=User not found');
  }

  user.quota = cleanQuota;
  user.startIndex = cleanStart;
  user.canTrim = cleanCanTrim;
  saveUsers(users);

  if (req.session.user && req.session.user.username.toLowerCase() === cleanUsername.toLowerCase()) {
    req.session.user.quota = cleanQuota;
    req.session.user.startIndex = cleanStart;
    req.session.user.canTrim = cleanCanTrim;
  }

  const rangeMsg = cleanQuota > 0 ? `Records ${cleanStart + 1}–${cleanStart + cleanQuota}` : 'Unlimited';
  res.redirect(`/?tab=users&success=Updated "${cleanUsername}": ${rangeMsg}, Trimming: ${cleanCanTrim ? 'Allowed' : 'Restricted'}.`);
});

// POST /admin/users/delete
app.post('/admin/users/delete', requireAuth, requireAdmin, (req, res) => {
  const { username } = req.body;
  const cleanUsername = (username || '').trim();

  if (!cleanUsername) {
    return res.redirect('/?tab=users&error=Username is required for deletion');
  }

  if (req.session.user.username.toLowerCase() === cleanUsername.toLowerCase()) {
    return res.redirect('/?tab=users&error=You cannot delete your own active admin account.');
  }

  users = loadUsers();
  const initialLength = users.length;
  users = users.filter(u => u.username.toLowerCase() !== cleanUsername.toLowerCase());

  if (users.length === initialLength) {
    return res.redirect('/?tab=users&error=User account not found.');
  }

  saveUsers(users);

  res.redirect(`/?tab=users&success=User account "${cleanUsername}" deleted successfully!`);
});

// GET /admin/export-csv
app.get('/admin/export-csv', requireAuth, requireAdmin, async (req, res) => {
  if (records.length === 0) {
    return res.redirect('/?error=No records to export');
  }
  const exportPath = path.join(uploadsDir, 'exported_transcriptions.csv');
  await writeCSV(exportPath, records);
  res.download(exportPath, 'verified_transcriptions.csv');
});

// GET /admin/export-zip — Download full dataset (CSV + Audio)
app.get('/admin/export-zip', requireAuth, requireAdmin, async (req, res) => {
  if (records.length === 0) {
    return res.redirect('/?error=No records to export');
  }
  try {
    const csvPath = path.join(uploadsDir, 'mapping.csv');
    await writeCSV(csvPath, records);

    const zip = new AdmZip();
    const files = fs.readdirSync(uploadsDir);
    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      if (fs.statSync(filePath).isFile()) {
        zip.addLocalFile(filePath);
      }
    }

    const zipBuffer = zip.toBuffer();
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename=voice_dataset_export.zip');
    res.send(zipBuffer);
  } catch (err) {
    console.error('ZIP export error:', err);
    res.redirect('/?error=Failed to generate ZIP dataset export');
  }
});

// ── Main App Routes ────────────────────────────────────────

// GET / — main page
app.get('/', requireAuth, (req, res) => {
  users = loadUsers();
  const dbUser = users.find(u => u.username.toLowerCase() === req.session.user.username.toLowerCase());
  if (dbUser) {
    req.session.user.quota = dbUser.quota;
    req.session.user.startIndex = dbUser.startIndex;
    req.session.user.role = dbUser.role;
    req.session.user.canTrim = dbUser.canTrim;
  }
  const user = req.session.user;
  const tab = req.query.tab || null;

  const userVerifiedCount = getUserVerifiedCount(user.username);

  if (tab === 'users') {
    if (user.role !== 'admin') {
      return res.redirect('/');
    }
    const safeUsers = users.map(u => ({
      username: u.username,
      role: u.role,
      quota: typeof u.quota === 'number' ? u.quota : 0,
      startIndex: typeof u.startIndex === 'number' ? u.startIndex : 0,
      canTrim: typeof u.canTrim === 'boolean' ? u.canTrim : true,
      verifiedCount: getUserVerifiedCount(u.username),
      createdAt: u.createdAt
    }));
    const nextStartIndex = getNextAvailableStartIndex(users);
    return res.render('index', {
      mode: 'users',
      user,
      userVerifiedCount,
      usersList: safeUsers,
      nextStartIndex,
      error: req.query.error || null,
      success: req.query.success || null
    });
  }

  // Dataset upload tab — restricted to administrators
  if (tab === 'upload') {
    if (user.role !== 'admin') {
      return res.redirect('/?error=' + encodeURIComponent('Access restricted: Only administrators can upload or configure datasets.'));
    }
    return res.render('index', {
      mode: 'upload',
      user,
      userVerifiedCount,
      error: req.query.error || null,
      success: req.query.success || null
    });
  }

  // View Dataset — browse all records in a table
  if (tab === 'dataset') {
    const datasetStats = {
      total: records.length,
      verified: records.filter(r => r.status === 'verified').length,
      edited: records.filter(r => r.status === 'edited').length,
      pending: records.filter(r => r.status === 'pending' || !r.status).length
    };
    return res.render('index', {
      mode: 'dataset',
      user,
      userVerifiedCount,
      records: records,
      datasetStats,
      error: req.query.error || null,
      success: req.query.success || null
    });
  }

  // Review mode or Empty mode
  if (records.length === 0) {
    return res.render('index', {
      mode: (user.role === 'admin') ? 'upload' : 'empty',
      user,
      userVerifiedCount,
      error: req.query.error || null,
      success: req.query.success || null
    });
  }

  // Range & Boundary calculations per user
  let minIdx = 0;
  let maxIdx = records.length > 0 ? records.length - 1 : 0;

  if (user.role !== 'admin' && user.quota > 0) {
    minIdx = Math.max(0, user.startIndex || 0);
    maxIdx = Math.min(records.length - 1, minIdx + user.quota - 1);
  }

  const isQuotaReached = (user.role !== 'admin' && user.quota > 0 && userVerifiedCount >= user.quota);
  const canTrimAudio = (user.role === 'admin' || user.canTrim === true);

  const defaultIdx = (records.length > 0) ? minIdx : 0;
  const requestedIdx = parseInt(req.query.idx ?? req.session.currentIndex ?? defaultIdx, 10);
  const safeIdx = (records.length > 0) ? Math.max(minIdx, Math.min(requestedIdx, maxIdx)) : 0;
  req.session.currentIndex = safeIdx;

  const record = records[safeIdx];
  const audioFile = record && record.voice ? `/uploads/${record.voice}` : null;

  const assignedTotal = (user.role !== 'admin' && user.quota > 0) ? Math.max(1, maxIdx - minIdx + 1) : records.length;
  const assignedRelativeIdx = safeIdx - minIdx;

  // Statistics
  const stats = {
    total: records.length,
    verified: records.filter(r => r.status === 'verified').length,
    edited: records.filter(r => r.status === 'edited').length,
    pending: records.filter(r => r.status === 'pending' || !r.status).length
  };

  res.render('index', {
    mode: 'review',
    user,
    userVerifiedCount,
    isQuotaReached,
    canTrimAudio,
    record,
    idx: safeIdx,
    minIdx,
    maxIdx,
    assignedRelativeIdx,
    assignedTotal,
    total: records.length,
    stats,
    audioFile,
    error: req.query.error || null,
    success: req.query.success || null,
    saved: req.query.saved === '1'
  });
});

// POST /upload — Upload CSV (SegAUD format) + audio/ZIP upload (Admin only)
app.post('/upload', requireAuth, requireAdmin, upload.fields([
  { name: 'csvFile', maxCount: 1 },
  { name: 'audioFiles' },
]), async (req, res) => {
  try {
    if (!req.files || !req.files.csvFile) {
      return res.render('index', { mode: 'upload', user: req.session.user, userVerifiedCount: 0, error: 'Please upload a SegAUD CSV mapping file.', success: null });
    }

    const audioFiles = req.files.audioFiles || [];
    let zipCount = 0;
    for (const f of audioFiles) {
      if (f.originalname.match(/\.zip$/i)) {
        const extracted = extractAudioZip(f.path);
        zipCount += extracted;
      } else {
        // Copy audio file to originals backup directory
        const origPath = path.join(originalsDir, f.originalname);
        try {
          fs.copyFileSync(f.path, origPath);
        } catch (e) {}
      }
    }

    csvFilePath = path.join(uploadsDir, 'mapping.csv');
    const parsed = await parseCSV(csvFilePath);

    if (parsed.length === 0) {
      return res.render('index', { mode: 'upload', user: req.session.user, userVerifiedCount: 0, error: 'CSV is empty or has no valid rows.', success: null });
    }

    records = parsed;
    saveRecords(records);
    // Baseline backup for full dataset or single record revert
    saveOriginalRecords(records);

    // Also copy all existing audio files in uploads to originals as backup
    for (const r of records) {
      if (r.voice) {
        const src = path.join(uploadsDir, r.voice);
        const orig = path.join(originalsDir, r.voice);
        if (fs.existsSync(src) && !fs.existsSync(orig)) {
          try {
            fs.copyFileSync(src, orig);
          } catch (e) {}
        }
      }
    }

    // Reset edits log for newly uploaded dataset
    fs.writeFileSync(editsLogPath, JSON.stringify([], null, 2));

    logEdit({
      action: 'upload_dataset',
      user: req.session.user.username,
      recordsCount: records.length,
      timestamp: new Date().toISOString()
    });

    req.session.currentIndex = 0;
    res.redirect('/?idx=0&success=SegAUD dataset uploaded and original baseline saved successfully!');
  } catch (err) {
    console.error(err);
    res.render('index', { mode: 'upload', user: req.session.user, userVerifiedCount: 0, error: `Upload error: ${err.message}`, success: null });
  }
});

// POST /trim-audio — handle trimmed audio upload with automatic original backup
app.post('/trim-audio', requireAuth, (req, res) => {
  const currentUser = req.session.user;
  const dbUser = loadUsers().find(u => u.username.toLowerCase() === currentUser.username.toLowerCase());
  const hasTrimPermission = (currentUser.role === 'admin' || (dbUser && dbUser.canTrim === true));

  if (!hasTrimPermission) {
    return res.status(403).json({ error: 'Access Denied: Audio trimming permission is not enabled for your account by an Admin.' });
  }

  const uploadOverwrite = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => {
        const idx = parseInt(req.body.idx, 10);
        if (!isNaN(idx) && idx >= 0 && idx < records.length && records[idx].voice) {
          cb(null, records[idx].voice);
        } else {
          cb(null, file.originalname);
        }
      }
    })
  }).fields([{ name: 'audioFiles', maxCount: 1 }]);

  uploadOverwrite(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    try {
      const idx = parseInt(req.body.idx, 10);
      if (isNaN(idx) || idx < 0 || idx >= records.length) {
        return res.status(400).json({ error: 'Invalid record index' });
      }

      const files = req.files ? req.files.audioFiles : null;
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No trimmed audio file received' });
      }

      const sameVoiceFilename = records[idx].voice;

      // Preserve original audio file before overwriting (if not already backed up)
      const currentAudioPath = path.join(uploadsDir, sameVoiceFilename);
      const origAudioPath = path.join(originalsDir, sameVoiceFilename);
      if (fs.existsSync(currentAudioPath) && !fs.existsSync(origAudioPath)) {
        try {
          fs.copyFileSync(currentAudioPath, origAudioPath);
        } catch (copyErr) {
          console.warn('Backup original audio note:', copyErr);
        }
      }

      records[idx].verifiedBy = currentUser.username;
      records[idx].updatedAt = new Date().toISOString();

      saveRecords(records);

      if (csvFilePath) {
        try {
          await writeCSV(csvFilePath, records);
        } catch (csvErr) {
          console.error('Failed to write CSV:', csvErr);
        }
      }

      logEdit({
        action: 'trim_audio',
        idx,
        voice: sameVoiceFilename,
        user: currentUser.username,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        voice: sameVoiceFilename,
        message: 'Audio trimmed and saved! Original is preserved for instant revert.'
      });
    } catch (err) {
      console.error('Trim error:', err);
      res.status(500).json({ error: err.message });
    }
  });
});

// POST /revert-audio — Revert trimmed audio file back to original untrimmed version
app.post('/revert-audio', requireAuth, (req, res) => {
  if (req.session.user.role !== 'admin' && !req.session.user.canTrim) {
    return res.status(403).json({ error: 'Permission denied: Audio trimming and revert are restricted to administrators.' });
  }
  const idx = parseInt(req.body.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= records.length) {
    return res.status(400).json({ error: 'Invalid record index' });
  }

  const voiceFilename = records[idx].voice;
  if (!voiceFilename) {
    return res.status(400).json({ error: 'No audio filename associated with this record.' });
  }

  const origAudioPath = path.join(originalsDir, voiceFilename);
  const currentAudioPath = path.join(uploadsDir, voiceFilename);

  if (!fs.existsSync(origAudioPath)) {
    return res.status(404).json({
      error: `Original audio backup not found for "${voiceFilename}". It may not have been trimmed yet.`
    });
  }

  try {
    fs.copyFileSync(origAudioPath, currentAudioPath);

    records[idx].updatedAt = new Date().toISOString();
    saveRecords(records);

    logEdit({
      action: 'revert_audio',
      idx,
      voice: voiceFilename,
      user: req.session.user.username,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      voice: voiceFilename,
      message: `Audio "${voiceFilename}" successfully reverted to original version!`
    });
  } catch (err) {
    console.error('Revert audio error:', err);
    res.status(500).json({ error: `Failed to revert audio: ${err.message}` });
  }
});

// POST /revert-record — Revert an individual record's transcription and audio to baseline
app.post('/revert-record', requireAuth, (req, res) => {
  const user = req.session.user;
  const idx = parseInt(req.body.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= records.length) {
    return res.status(400).json({ error: 'Invalid record index' });
  }

  // Non-admins can only revert records assigned to them
  if (user.role !== 'admin' && user.quota > 0) {
    const minIdx = Math.max(0, user.startIndex || 0);
    const maxIdx = Math.min(records.length - 1, minIdx + user.quota - 1);
    if (idx < minIdx || idx > maxIdx) {
      return res.status(403).json({ error: `Permission denied: Record ${idx + 1} is outside your assigned quota.` });
    }
  }

  const origRecords = loadOriginalRecords();
  if (!origRecords || !origRecords[idx]) {
    return res.status(404).json({ error: 'Original baseline data not found for this record.' });
  }

  const origRec = origRecords[idx];
  const voiceFilename = records[idx].voice || origRec.voice;

  // If audio was trimmed, revert audio as well if original exists
  const origAudioPath = path.join(originalsDir, voiceFilename);
  const currentAudioPath = path.join(uploadsDir, voiceFilename);
  if (fs.existsSync(origAudioPath)) {
    try {
      fs.copyFileSync(origAudioPath, currentAudioPath);
    } catch (e) {}
  }

  records[idx] = {
    ...origRec,
    voice: voiceFilename,
    updatedAt: new Date().toISOString(),
    verifiedBy: req.session.user.username + ' (reverted)'
  };

  saveRecords(records);

  if (csvFilePath) {
    writeCSV(csvFilePath, records).catch(e => console.error(e));
  }

  logEdit({
    action: 'revert_record',
    idx,
    voice: voiceFilename,
    user: req.session.user.username,
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    record: records[idx],
    message: `Record ${idx + 1} reverted to original state successfully!`
  });
});

// POST /revert-all — Revert entire dataset & audio files to original baseline (Admin only)
app.post('/revert-all', requireAuth, requireAdmin, (req, res) => {
  const origRecords = loadOriginalRecords();
  if (!origRecords || origRecords.length === 0) {
    return res.status(404).json({ error: 'No original baseline dataset found.' });
  }

  // Restore records
  records = origRecords.map(r => ({ ...r }));
  saveRecords(records);

  // Restore all original audio files
  if (fs.existsSync(originalsDir)) {
    const origFiles = fs.readdirSync(originalsDir);
    for (const file of origFiles) {
      const src = path.join(originalsDir, file);
      const dst = path.join(uploadsDir, file);
      if (fs.statSync(src).isFile()) {
        try {
          fs.copyFileSync(src, dst);
        } catch (e) {}
      }
    }
  }

  if (csvFilePath) {
    writeCSV(csvFilePath, records).catch(e => console.error(e));
  }

  logEdit({
    action: 'revert_all',
    user: req.session.user.username,
    count: records.length,
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    message: `Entire dataset reverted to original state (${records.length} records restored)!`
  });
});

// POST /save — save transcription & set status ('verify' or 'save')
app.post('/save', requireAuth, express.urlencoded({ extended: true }), async (req, res) => {
  const idx = parseInt(req.body.idx, 10);
  const transcription = req.body.transcription ?? '';
  const normalizedTranscription = req.body.normalizedTranscription ?? '';
  const action = req.body.action || 'save'; // 'verify' or 'save'

  if (isNaN(idx) || idx < 0 || idx >= records.length) {
    return res.redirect('/');
  }

  const currentUser = req.session.user;
  const dbUser = loadUsers().find(u => u.username.toLowerCase() === currentUser.username.toLowerCase());
  const userQuota = dbUser ? (typeof dbUser.quota === 'number' ? dbUser.quota : 0) : 0;
  const userStart = dbUser ? (typeof dbUser.startIndex === 'number' ? dbUser.startIndex : 0) : 0;
  const userVerifiedCount = getUserVerifiedCount(currentUser.username);

  let minIdx = 0;
  let maxIdx = records.length > 0 ? records.length - 1 : 0;

  if (currentUser.role !== 'admin' && userQuota > 0) {
    minIdx = Math.max(0, userStart);
    maxIdx = Math.min(records.length - 1, minIdx + userQuota - 1);
  }

  // Prevent accessing out-of-range records
  if (currentUser.role !== 'admin' && userQuota > 0 && (idx < minIdx || idx > maxIdx)) {
    return res.redirect(`/?idx=${minIdx}&error=Access restricted! Record ${idx + 1} is outside your assigned range (${minIdx + 1} to ${maxIdx + 1}).`);
  }

  // Check if this record was already modified by this verifier
  const alreadyVerifiedBySelf = records[idx].verifiedBy && records[idx].verifiedBy.toLowerCase() === currentUser.username.toLowerCase();

  // Enforce quota limit for non-admin users
  if (currentUser.role !== 'admin' && userQuota > 0 && userVerifiedCount >= userQuota && !alreadyVerifiedBySelf) {
    return res.redirect(`/?idx=${idx}&error=Quota limit reached! You have completed your assigned quota of ${userQuota} verifications.`);
  }

  records[idx].transcription = transcription;
  records[idx].normalizedTranscription = normalizedTranscription;
  records[idx].backgroundNoise = req.body.backgroundNoise || '';
  records[idx].audioComplete = req.body.audioComplete || '';
  records[idx].silenceAtBeginning = req.body.silenceAtBeginning || '';
  records[idx].silenceAtEnd = req.body.silenceAtEnd || '';
  records[idx].speakingRate = req.body.speakingRate || '';
  records[idx].emotion = req.body.emotion || '';
  records[idx].volume = req.body.volume || '';
  records[idx].accent = req.body.accent || '';
  records[idx].verifiedBy = currentUser.username;
  records[idx].updatedAt = new Date().toISOString();

  if (action === 'verify') {
    if (!transcription.trim() || !normalizedTranscription.trim()) {
      return res.redirect(`/?idx=${idx}&error=Both orthographic and normalized transcriptions must be filled before marking as verified.`);
    }
    records[idx].status = 'verified';
  } else if (action === 'save') {
    records[idx].status = 'edited';
  }

  saveRecords(records);

  if (csvFilePath) {
    try {
      await writeCSV(csvFilePath, records);
    } catch (err) {
      console.error('Failed to write CSV:', err);
    }
  }

  // Store every save differently from original data for audit & easy rollback
  logEdit({
    action: 'save_record',
    idx,
    voice: records[idx].voice,
    user: currentUser.username,
    status: records[idx].status,
    transcription: records[idx].transcription,
    normalizedTranscription: records[idx].normalizedTranscription,
    timestamp: new Date().toISOString()
  });

  const nextIdx = Math.min(idx + 1, maxIdx);
  req.session.currentIndex = nextIdx;
  res.redirect(`/?idx=${nextIdx}&saved=1`);
});

// POST /reset — Admin only dataset clear
app.post('/reset', requireAuth, requireAdmin, (req, res) => {
  records = [];
  saveRecords(records);
  req.session.currentIndex = 0;
  res.redirect('/?success=Dataset reset successfully');
});

// POST /api/import-segaud — Programmatic SegAUD integration endpoint
app.post('/api/import-segaud', express.json(), async (req, res) => {
  try {
    const { segments, projectName } = req.body;
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'No segments provided' });
    }

    const newRecords = segments.map((seg, i) => {
      let voiceName = seg.file ? path.basename(seg.file) : (seg.voice || (seg.id ? (seg.id.match(/\.(wav|mp3|ogg|m4a|flac)$/i) ? seg.id : `${seg.id}.wav`) : `segment_${i + 1}.wav`));
      return {
        id: i,
        voice: voiceName,
        transcription: (seg.transcript || seg.text || seg.transcription || '').trim(),
        normalizedTranscription: (seg.normalizedTranscription || seg.transcript || seg.text || '').trim(),
        speaker: (seg.speaker || 'Speaker 1').trim(),
        domain: (seg.domain || '').trim(),
        backgroundNoise: '',
        audioComplete: '',
        silenceAtBeginning: '',
        silenceAtEnd: '',
        speakingRate: '',
        emotion: '',
        volume: '',
        accent: '',
        status: seg.verified ? 'verified' : 'pending',
        verifiedBy: seg.verified ? 'SegAUD' : null,
        updatedAt: new Date().toISOString()
      };
    });

    records = newRecords;
    saveRecords(records);
    saveOriginalRecords(records);

    csvFilePath = path.join(uploadsDir, 'mapping.csv');
    await writeCSV(csvFilePath, records);

    logEdit({
      action: 'import_segaud',
      projectName: projectName || 'SegAUD',
      recordsCount: records.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: `Successfully imported ${records.length} segments from SegAUD!`,
      count: records.length
    });
  } catch (err) {
    console.error('Import SegAUD error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅  Shruti-Lekhan running at http://localhost:${PORT}`);
  });
}

module.exports = app;
