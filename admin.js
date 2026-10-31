import { randomBytes } from 'node:crypto';
import { db, hashPassword, usernameKey } from './db.js';

const [command, rawName, suppliedPassword] = process.argv.slice(2);
const maxUsers = Math.max(1, Number.parseInt(process.env.MAX_USERS || '20', 10) || 20);
const usernamePattern = /^[\p{L}\p{N}_.-]{2,24}$/u;
const printHelp = () => console.log(`مدیریت حساب‌های چت (ثبت‌نام عمومی بسته است):
  node admin.js add <username> [password]
  node admin.js list
  node admin.js disable <username>
  node admin.js enable <username>
  node admin.js password <username> [new-password]

اگر رمز را ندهی، یک رمز تصادفی ساخته و فقط همین بار نمایش داده می‌شود.`);

if (!command || command === 'help') { printHelp(); process.exit(0); }
if (command === 'list') {
  for (const row of db.prepare('SELECT username, active, created_at FROM users ORDER BY username_key').all()) {
    console.log(`${row.active ? 'فعال' : 'غیرفعال'}  ${row.username}  ${new Date(row.created_at).toLocaleString('fa-IR')}`);
  }
  process.exit(0);
}
if (!rawName) { printHelp(); process.exit(1); }
const key = usernameKey(rawName);
const username = rawName.normalize('NFKC').trim();
if (!usernamePattern.test(username)) throw new Error('نام کاربری باید ۲ تا ۲۴ حرف یا عدد باشد؛ نقطه، خط تیره و زیرخط هم مجاز است.');
const existing = db.prepare('SELECT id FROM users WHERE username_key = ?').get(key);

if (command === 'add') {
  if (existing) throw new Error('این نام کاربری از قبل وجود دارد.');
  const current = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (current >= maxUsers) throw new Error(`سقف ${maxUsers} حساب پر شده است. مقدار MAX_USERS را تنظیم کن.`);
  const password = suppliedPassword || randomBytes(12).toString('base64url');
  if (password.length < 10 || password.length > 128) throw new Error('رمز باید بین ۱۰ تا ۱۲۸ نویسه باشد.');
  const passwordHash = await hashPassword(password);
  db.prepare('INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?)').run(username, key, passwordHash, Date.now());
  console.log(`حساب ساخته شد: ${username}\nرمز موقت: ${password}\nاین رمز را امن به کاربر بده؛ دوباره نمایش داده نمی‌شود.`);
} else if (command === 'disable') {
  if (!existing) throw new Error('حسابی با این نام پیدا نشد.');
  db.prepare('UPDATE users SET active=0 WHERE id = ?').run(existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`حساب ${username} غیرفعال شد؛ پیام‌های قبلی در تاریخچه می‌مانند.`);
} else if (command === 'enable') {
  if (!existing) throw new Error('حسابی با این نام پیدا نشد.');
  db.prepare('UPDATE users SET active=1 WHERE id = ?').run(existing.id);
  console.log(`حساب ${username} فعال شد.`);
} else if (command === 'password') {
  if (!existing) throw new Error('حسابی با این نام پیدا نشد.');
  const password = suppliedPassword || randomBytes(12).toString('base64url');
  if (password.length < 10 || password.length > 128) throw new Error('رمز باید بین ۱۰ تا ۱۲۸ نویسه باشد.');
  const passwordHash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`رمز حساب ${username} تغییر کرد: ${password}`);
} else {
  printHelp();
  process.exitCode = 1;
}
