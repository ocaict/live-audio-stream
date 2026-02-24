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

const ChannelModel = {
  findAll() {
    const result = dbWrapper.exec('SELECT * FROM channels ORDER BY created_at DESC');
    return rowToObject(result);
  },

  findById(id) {
    const result = dbWrapper.exec(`SELECT * FROM channels WHERE id = '${id}'`);
    const rows = rowToObject(result);
    return rows[0] || null;
  },

  findBySlug(slug) {
    const result = dbWrapper.exec(`SELECT * FROM channels WHERE slug = '${slug}'`);
    const rows = rowToObject(result);
    return rows[0] || null;
  },

  findByAdminId(adminId) {
    const result = dbWrapper.exec(`SELECT * FROM channels WHERE admin_id = '${adminId}' ORDER BY created_at DESC`);
    return rowToObject(result);
  },

  create(channel) {
    const id = require('uuid').v4();
    const slug = channel.slug || id.substring(0, 8);
    const now = new Date().toISOString();
    
    dbWrapper.run(
      `INSERT INTO channels (id, name, slug, description, admin_id, is_live, color, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, channel.name, slug, channel.description || '', channel.adminId, 0, channel.color || '#e94560', now, now]
    );
    
    return this.findById(id);
  },

  update(id, updates) {
    const fields = [];
    const values = [];
    
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.slug !== undefined) {
      fields.push('slug = ?');
      values.push(updates.slug);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.is_live !== undefined) {
      fields.push('is_live = ?');
      values.push(updates.is_live ? 1 : 0);
    }
    if (updates.color !== undefined) {
      fields.push('color = ?');
      values.push(updates.color);
    }
    
    if (fields.length === 0) return this.findById(id);
    
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    
    dbWrapper.run(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  },

  delete(id) {
    dbWrapper.run('DELETE FROM channels WHERE id = ?', [id]);
  },

  setLiveStatus(id, isLive) {
    dbWrapper.run('UPDATE channels SET is_live = ?, updated_at = ? WHERE id = ?', 
      [isLive ? 1 : 0, new Date().toISOString(), id]);
  }
};

module.exports = ChannelModel;
