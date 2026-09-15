const Database = require('better-sqlite3');
const db = new Database('./data/response_desk.sqlite');
const tables = ['organizations', 'users', 'cases', 'evidence_items', 'pilot_entitlements', 'platform_playbooks'];
for (const t of tables) {
  try {
    const count = db.prepare('SELECT count(*) as count FROM ' + t).get().count;
    console.log(t + ': ' + count);
  } catch (e) {
    console.log(t + ': error ' + e.message);
  }
}
