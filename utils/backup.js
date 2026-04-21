const crypto = require('crypto');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Derive a 32-byte encryption key from SESSION_SECRET using PBKDF2
// Salt is static per-app so the same secret always produces the same key
const BACKUP_SALT = 'leadflow-backup-v1';

function getEncryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET required for encrypted backups');
  return crypto.pbkdf2Sync(secret, BACKUP_SALT, 100_000, 32, 'sha256');
}

/**
 * Encrypt a buffer using AES-256-GCM.
 * Returns: IV (12 bytes) + authTag (16 bytes) + ciphertext
 */
function encryptBuffer(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Export all collections from MongoDB to an encrypted backup file.
 */
async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  try {
    // Ensure backup directory exists
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // Get all model names
    const modelNames = mongoose.modelNames();
    const backup = {};

    for (const modelName of modelNames) {
      const Model = mongoose.model(modelName);
      const docs = await Model.find().lean();
      backup[modelName.toLowerCase()] = docs;
      console.log(`  📦 Collected ${docs.length} ${modelName} documents`);
    }

    // Encrypt and write as a single file
    const plaintext = Buffer.from(JSON.stringify(backup), 'utf-8');
    const key = getEncryptionKey();
    const encrypted = encryptBuffer(plaintext, key);

    const filePath = path.join(BACKUP_DIR, `backup_${timestamp}.enc`);
    fs.writeFileSync(filePath, encrypted);
    // Restrict file permissions (owner read/write only, ignored on Windows)
    try { fs.chmodSync(filePath, 0o600); } catch {}

    console.log(`✅ Encrypted backup complete: ${filePath}`);

    // Cleanup old backups
    cleanupOldBackups();

    return filePath;
  } catch (err) {
    console.error('❌ Backup failed:', err);
    throw err;
  }
}

/**
 * Remove old backups, keeping only the most recent N.
 */
function cleanupOldBackups() {
  const keepCount = parseInt(process.env.BACKUP_KEEP_COUNT) || 7;

  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith('backup_') && name.endsWith('.enc'))
      .map(name => ({
        name,
        path: path.join(BACKUP_DIR, name),
        stat: fs.statSync(path.join(BACKUP_DIR, name))
      }))
      .filter(f => f.stat.isFile())
      .sort((a, b) => b.stat.mtime - a.stat.mtime);

    // Delete everything beyond keepCount
    for (let i = keepCount; i < files.length; i++) {
      fs.unlinkSync(files[i].path);
      console.log(`🗑️  Removed old backup: ${files[i].name}`);
    }
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

/**
 * Start the scheduled backup cron job.
 */
function startBackupScheduler() {
  const schedule = process.env.BACKUP_CRON || '0 0 * * *'; // Default: midnight daily
  
  if (!cron.validate(schedule)) {
    console.error(`❌ Invalid BACKUP_CRON schedule: ${schedule}`);
    return;
  }

  cron.schedule(schedule, async () => {
    console.log('⏰ Running scheduled backup...');
    await runBackup();
  });

  console.log(`📅 Backup scheduler started (cron: ${schedule})`);
}

module.exports = { runBackup, startBackupScheduler };
