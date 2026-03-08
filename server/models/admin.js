const { supabase: getSupabase } = require('../config/database');

const AdminModel = {
  async findByUsername(username) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('admins')
      .select('*')
      .eq('username', username)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error finding admin by username:', error);
      return null;
    }
    return data;
  },

  async findById(id) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('admins')
      .select('id, username, created_at')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error finding admin by id:', error);
      return null;
    }
    return data;
  },

  async create(username, passwordHash) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('admins')
      .insert([{ username, password_hash: passwordHash }]);

    if (error) {
      console.error('Error creating admin:', error);
      throw error;
    }
  },

  async updatePassword(id, passwordHash) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('admins')
      .update({ password_hash: passwordHash })
      .eq('id', id);

    if (error) {
      console.error('Error updating admin password:', error);
      throw error;
    }
  }
};

module.exports = AdminModel;
