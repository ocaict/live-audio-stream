const { supabase: getSupabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

const ScheduleModel = {
    async create(schedule) {
        const { data, error } = await getSupabase()
            .from('schedules')
            .insert([{
                id: schedule.id || uuidv4(),
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
    },

    /**
     * Finds the next scheduled show for a channel when it's currently offline.
     */
    async findNextUpcomingSchedule(channelId) {
        const now = new Date();
        const currentDay = now.getUTCDay();
        const currentTime = now.getUTCHours().toString().padStart(2, '0') + ':' +
            now.getUTCMinutes().toString().padStart(2, '0') + ':00';

        // Fetch all enabled schedules for this channel in a single round-trip
        const { data: schedules, error } = await getSupabase()
            .from('schedules')
            .select('*, playlists(name)')
            .eq('channel_id', channelId)
            .eq('is_enabled', true);

        if (error || !schedules || schedules.length === 0) return null;

        // Find the one that occurs soonest from "now"
        const sorted = schedules.map(s => {
            let daysUntil = (s.day_of_week - currentDay + 7) % 7;
            // If it's today but the start time has already passed, it actually occurs in 7 days
            if (daysUntil === 0 && s.start_time <= currentTime) {
                daysUntil = 7;
            }
            return { ...s, daysUntil };
        }).sort((a, b) => {
            if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
            return a.start_time.localeCompare(b.start_time);
        });

        return sorted[0] || null;
    }
};

module.exports = ScheduleModel;
