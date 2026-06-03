'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config/env');

const supabase = createClient(
  config.supabaseUrl || 'https://mock.supabase.co',
  config.supabaseKey || 'mock'
);

/** Returns true only when a real Supabase project URL is configured. */
const isSupabaseReady = () =>
  !!config.supabaseUrl && !config.supabaseUrl.includes('mock');

module.exports = { supabase, isSupabaseReady };
