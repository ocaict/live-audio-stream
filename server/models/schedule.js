const { supabase: getSupabase } = require('../config/database');

const ScheduleModel = {
    async create(schedule) {
        const { data, error } = await getSupabase()
            .from('schedules')
            .insert([{
                id: schedule.id || require('uuid').v4(),
                channel_id: schedule.channel_id,
                playlist_id: schedule.playlist_id,
                day_of_week: schedule.day_of_week, // 0-6 (Sun-Sat)
                start_time: schedule.start_time, // HH:mm:ss
                end_time: schedule.end_time, // HH:mm:ss
                is_enabled: typeof schedule.is_enabled === 'undefined' ? true : schedule.is_enabled,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating schedule:', error);
            throw error;
        }
        return data;
    },

    async findByChannelId(channelId) {
        const { data, error } = await getSupabase()
            .from('schedules')
            .select('*')
            .eq('channel_id', channelId)
            .order('day_of_week', { ascending: true })
            .order('start_time', { ascending: true });

        if (error) {
            console.error(`Error fetching schedules for channel ${channelId}:`, error);
            return [];
        }
        return data || [];
    },

    async findById(id) {
        const { data, error } = await getSupabase()
            .from('schedules')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            console.error(`Error finding schedule ${id}:`, error);
            return null;
        }
        return data;
    },

    async update(id, updates) {
        const { data, error } = await getSupabase()
            .from('schedules')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error(`Error updating schedule ${id}:`, error);
            throw error;
        }
        return data;
    },

    async delete(id) {
        const { error } = await getSupabase()
            .from('schedules')
            .delete()
            .eq('id', id);

        if (error) {
            console.error(`Error deleting schedule ${id}:`, error);
            throw error;
        }
    },

    /**
     * Finds the currently active schedule for a channel.
     * Checks if current UTC time falls within day_of_week and start_end window.
     * Note: Simplistic approach, assuming server/db are in reasonable timezone sync.
     */
    async findActiveSchedule(channelId) {
        const now = new Date();
        const currentDay = now.getUTCDay();
        const currentTime = now.getUTCHours().toString().padStart(2, '0') + ':' +
            now.getUTCMinutes().toString().padStart(2, '0') + ':00';

        const { data, error } = await getSupabase()
            .from('schedules')
            .select('*')
            .eq('channel_id', channelId)
            .eq('day_of_week', currentDay)
            .eq('is_enabled', true)
            .lte('start_time', currentTime)
            .gte('end_time', currentTime)
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error(`Error finding active schedule for channel ${channelId}:`, error);
            return null;
        }
        return data;
    }
};

module.exports = ScheduleModel;
