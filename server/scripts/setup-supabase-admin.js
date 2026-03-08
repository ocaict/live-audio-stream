const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');
const CONFIG = require('../config/constants');

async function setupAdmin() {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
        console.error('Error: Supabase URL or Key not found in environment.');
        process.exit(1);
    }

    const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

    const username = CONFIG.ADMIN_USERNAME || 'admin';
    const password = CONFIG.ADMIN_PASSWORD || 'admin1234';

    console.log(`Setting up admin user: ${username}`);

    const hash = bcrypt.hashSync(password, 10);

    const { data, error } = await supabase
        .from('admins')
        .insert([{
            username,
            password_hash: hash
        }])
        .select();

    if (error) {
        if (error.code === '23505') { // Duplicate key error
            console.log('Admin user already exists. Checking password update...');
            const { error: updateError } = await supabase
                .from('admins')
                .update({ password_hash: hash })
                .eq('username', username);

            if (updateError) {
                console.error('Error updating existing admin:', updateError);
            } else {
                console.log('Admin password updated successfully.');
            }
        } else {
            console.error('Error creating admin:', error);
        }
    } else {
        console.log('Admin user created successfully in Supabase!');
    }
}

setupAdmin().catch(console.error);
