'use strict';

// Sets a new password for a player who forgot theirs.
// Stop the server first so it doesn't overwrite the change:
//   npx pm2 stop jedris
//   node server/reset-password.js s23105047 newpassword
//   npx pm2 start jedris
const { Store } = require('./store');
const { resetPassword } = require('./auth');
const { DATA_FILE } = require('./index');

const [dcismId, password] = process.argv.slice(2);
if (!dcismId || !password) {
  console.log('Usage: node server/reset-password.js <dcism id> <new password>');
  process.exit(1);
}
try {
  const user = resetPassword(new Store(DATA_FILE), dcismId.toLowerCase(), password);
  console.log(`Password changed for ${user.dcismId} (${user.username}).`);
} catch (e) {
  console.log(e.message);
  process.exit(1);
}
