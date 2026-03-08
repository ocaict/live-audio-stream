const { supabase: getSupabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const ChannelModel = {
  async findAll() {
    const { data, error } = await getSupabase()
      .from('channels')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching all channels:', error);
      return [];
    }
    return data || [];
  },

  async findById(id) {
    const { data, error } = await getSupabase()
      .from('channels')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error(`Error finding channel by ID ${id}:`, error);
      return null;
    }
    return data;
  },

  async findBySlug(slug) {
    const { data, error } = await getSupabase()
      .from('channels')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error(`Error finding channel by slug ${slug}:`, error);
      return null;
    }
    return data;
  },

  async findByAdminId(adminId) {
    const { data, error } = await getSupabase()
      .from('channels')
      .select('*')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`Error finding channels by admin ID ${adminId}:`, error);
      return [];
    }
    return data || [];
  },

  async create(channel) {
    const id = uuidv4();
    const slug = channel.slug || id.substring(0, 8);

    const { data, error } = await getSupabase()
      .from('channels')
      .insert([{
        id,
        name: channel.name,
        slug,
        description: channel.description || '',
        admin_id: channel.adminId,
        is_live: false,
        color: channel.color || '#e94560'
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating channel:', error);
      throw error;
    }
    return data;
  },

  async update(id, updates) {
    const fields = { ...updates };
    if (fields.adminId !== undefined) {
      fields.admin_id = fields.adminId;
      delete fields.adminId;
    }

    fields.updated_at = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('channels')
      .update(fields)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error(`Error updating channel ${id}:`, error);
      throw error;
    }
    return data;
  },

  async delete(id) {
    const { error } = await getSupabase()
      .from('channels')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`Error deleting channel ${id}:`, error);
      throw error;
    }
  },

  async setLiveStatus(id, isLive) {
    const { error } = await getSupabase()
      .from('channels')
      .update({
        is_live: isLive,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      console.error(`Error setting live status for channel ${id}:`, error);
      throw error;
    }
  }
};

module.exports = ChannelModel;
