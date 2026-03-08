const { supabase: getSupabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const UserModel = {
    async findByUsername(username) {
        const supabase = getSupabase();
        // Case-insensitive and trimmed search
        const cleanUsername = username.trim();

        const { data, error } = await supabase
            .from('users')
            .select('*')
            .ilike('username', cleanUsername)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null; // Not found
            console.error(`[UserModel] Error finding user "${cleanUsername}":`, error);
            return null;
        }
        return data;
    },

    async findById(id) {
        const supabase = getSupabase();
        const { data, error } = await supabase
            .from('users')
            .select('id, username, role, created_at')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null; // Not found
            console.error('Error finding user by id:', error);
            return null;
        }
        return data;
    },

    async create(user) {
        const supabase = getSupabase();
        const { data, error } = await supabase
            .from('users')
            .insert([{
                username: user.username,
                password_hash: user.passwordHash,
                role: user.role || 'broadcaster'
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating user:', error);
            throw error;
        }
        return data;
    }
};

module.exports = UserModel;
