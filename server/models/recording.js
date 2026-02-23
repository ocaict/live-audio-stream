const { db: dbWrapper } = require('../config/database');

function rowToObject(result) {
  if (!result[0]) return [];
  const cols = result[0].columns;
  return result[0].values.map(values => {
    const row = {};
    cols.forEach((col, i) => row[col] = values[i]);
    return row;
  });
}

const RecordingModel = {
  create(recording) {
    dbWrapper.run(
      `INSERT INTO recordings (id, filename, filepath, filesize, duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [recording.id, recording.filename, recording.filepath, recording.filesize, recording.duration, recording.created_at]
    );
  },

  findAll() {
    const result = dbWrapper.exec('SELECT * FROM recordings ORDER BY created_at DESC');
    return rowToObject(result);
  },

  findById(id) {
    const result = dbWrapper.exec(`SELECT * FROM recordings WHERE id = '${id}'`);
    const rows = rowToObject(result);
    return rows[0] || null;
  },

  delete(id) {
    dbWrapper.run('DELETE FROM recordings WHERE id = ?', [id]);
  },

  updateFilesize(id, filesize) {
    dbWrapper.run('UPDATE recordings SET filesize = ? WHERE id = ?', [filesize, id]);
  },

  updateDuration(id, duration) {
    dbWrapper.run('UPDATE recordings SET duration = ? WHERE id = ?', [duration, id]);
  }
};

module.exports = RecordingModel;
