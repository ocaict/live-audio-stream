const { createClient } = require('@supabase/supabase-js');
const CONFIG = require('../config/constants');

async function checkDatabase() {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
        console.error('Error: Supabase URL or Key not found in environment.');
        process.exit(1);
    }

    const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

    console.log('Testing Supabase connection...');

    const { data: admins, error: adminError } = await supabase
        .from('admins')
        .select('id, username')
        .eq('username', 'admin')
        .single();

    if (adminError) {
        console.error('Error fetching admin:', adminError.message);
    } else {
        console.log('Successfully found admin user:', admins.username);
    }

    const { data: channels, error: channelError } = await supabase
        .from('channels')
        .select('id, name');

    if (channelError) {
        console.error('Error fetching channels:', channelError.message);
    } else {
        console.log(`Successfully connected to channels table. Found ${channels.length} channels.`);
    }

    const { data: recordings, error: recordingError } = await supabase
        .from('recordings')
        .select('id');

    if (recordingError) {
        console.error('Error fetching recordings:', recordingError.message);
    } else {
        console.log(`Successfully connected to recordings table. Found ${recordings.length} recordings.`);
    }
}

checkDatabase().catch(console.error);
