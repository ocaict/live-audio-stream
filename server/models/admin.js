const { db: dbWrapper } = require('../config/database');

const AdminModel = {
  findByUsername(username) {
    const result = dbWrapper.exec(`SELECT * FROM admins WHERE username = '${username}'`);
    if (!result[0]) return null;
    const cols = result[0].columns;
    const values = result[0].values[0];
    if (!values) return null;
    const row = {};
    cols.forEach((col, i) => row[col] = values[i]);
    return row;
  },

  findById(id) {
    const result = dbWrapper.exec(`SELECT id, username, created_at FROM admins WHERE id = ${id}`);
    if (!result[0]) return null;
    const cols = result[0].columns;
    const values = result[0].values[0];
    if (!values) return null;
    const row = {};
    cols.forEach((col, i) => row[col] = values[i]);
    return row;
  },

  create(username, passwordHash) {
    dbWrapper.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
  },

  updatePassword(id, passwordHash) {
    dbWrapper.run('UPDATE admins SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  }
};

module.exports = AdminModel;
