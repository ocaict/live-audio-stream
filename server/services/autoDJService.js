/**
 * Auto-DJ Service — Phase 7
 *
 * Architecture:
 *   The current live broadcast uses WebRTC P2P (browser → listeners).
 *   The Auto-DJ CANNOT use WebRTC because the server has no browser context.
 *
 *   Instead, when the Auto-DJ is active, the server:
 *   1. Fetches the channel's media_library queue
 *   2. Uses FFmpeg to read each audio file from Cloudinary (via HTTPS URL)
 *   3. Re-encodes it to PCM/raw audio chunks
 *   4. Emits each chunk via Socket.IO to all listeners as `dj-audio-chunk`
 *   5. Listeners decode the binary ArrayBuffer and feed it into the Web Audio API
 *
 *   When a real broadcaster goes live, the Auto-DJ stops immediately.
 */

const { EventEmitter } = require('events');
const ffmpeg = require('fluent-ffmpeg');
const MediaLibraryModel = require('../models/mediaLibrary');
const PlaylistModel = require('../models/playlist');
const ScheduleModel = require('../models/schedule');

const CHUNK_SIZE_MS = 100; // emit a chunk every 100ms worth of audio
const SAMPLE_RATE = 44100;
const CHANNELS = 1; // mono
const BIT_DEPTH = 16; // 16-bit PCM
const BYTES_PER_MS = (SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8)) / 1000;
const CHUNK_BYTES = Math.floor(BYTES_PER_MS * CHUNK_SIZE_MS);

class AutoDJService extends EventEmitter {
    constructor() {
        super();
        // Map of channelId => { ffmpegProcess, queue, currentIndex, isRunning, isPaused, activeScheduleId }
        this.sessions = new Map();
        // Map of channelId => { isEnabled: boolean }
        this.channelConfigs = new Map();
    }

    /**
     * Check if Auto-DJ is allowed to run (the "Master Toggle")
     */
    isAutoDJEnabled(channelId) {
        const config = this.channelConfigs.get(channelId);
        // Default to TRUE so handover works normally until explicitly stopped
        return config ? config.isEnabled : true;
    }

    /**
     * Set the intent toggle for Auto-DJ
     */
    setAutoDJEnabled(channelId, isEnabled) {
        console.log(`[AutoDJ] Setting Master Toggle for ${channelId} to: ${isEnabled}`);
        this.channelConfigs.set(channelId, { isEnabled });
    }

    /**
     * Start Auto-DJ for a channel.
     * @param {string} channelId
     * @param {Function} emitChunk - callback(chunk: Buffer) for each audio chunk
     * @param {Function} emitMeta  - callback(meta: object) when track changes
     */
    async start(channelId, emitChunk, emitMeta) {
        if (this.isRunning(channelId)) {
            console.log(`[AutoDJ] Already running for channel ${channelId}`);
            return;
        }

        let queue = [];
        let activeScheduleId = null;

        // --- Priority Layer 1: Check for active schedule ---
        try {
            const activeSchedule = await ScheduleModel.findActiveSchedule(channelId);
            if (activeSchedule) {
                console.log(`[AutoDJ] Found active schedule ${activeSchedule.id} for channel ${channelId}`);
                const playlistItems = await PlaylistModel.getMedia(activeSchedule.playlist_id);
                if (playlistItems && playlistItems.length > 0) {
                    queue = playlistItems.map(item => item.media_library);
                    activeScheduleId = activeSchedule.id;
                }
            }
        } catch (e) {
            console.warn(`[AutoDJ] Schedule lookup failed: ${e.message}. Falling back to general library.`);
        }

        // --- Priority Layer 2: General library rotation (Fallback) ---
        if (queue.length === 0) {
            const library = await MediaLibraryModel.findByChannelId(channelId);
            if (!library || library.length === 0) {
                console.log(`[AutoDJ] No media in library/schedule for channel ${channelId}. Auto-DJ aborted.`);
                this.emit('no-media', { channelId });
                return;
            }

            // --- Auto-Jingle Injection (Shuffle Logic) ---
            const musicTracks = library.filter(t => t.category === 'music' || t.category === 'show');
            const jingles = library.filter(t => t.category === 'jingle' || t.category === 'ad');

            if (musicTracks.length === 0) {
                queue = library;
            } else {
                for (let i = 0; i < musicTracks.length; i++) {
                    queue.push(musicTracks[i]);
                    if ((i + 1) % 3 === 0 && jingles.length > 0) {
                        const randomJingle = jingles[Math.floor(Math.random() * jingles.length)];
                        queue.push(randomJingle);
                    }
                }
            }
        }

        const session = {
            queue,
            currentIndex: 0,
            isRunning: true,
            ffmpegProcess: null,
            emitChunk,
            emitMeta,
            activeScheduleId,
            consecutiveErrors: 0 // Issue #8 Tracker
        };

        this.sessions.set(channelId, session);
        console.log(`[AutoDJ] Starting for channel ${channelId} with ${queue.length} tracks (Scheduled: ${!!activeScheduleId})`);
        this.emit('started', { channelId });

        this._playNext(channelId);
    }

    async _playNext(channelId) {
        const session = this.sessions.get(channelId);
        if (!session || !session.isRunning) return;

        // --- Between-Track Check: See if a new schedule has started or the old one ended ---
        try {
            const currentSchedule = await ScheduleModel.findActiveSchedule(channelId);
            const currentSchedId = currentSchedule ? currentSchedule.id : null;

            if (currentSchedId !== session.activeScheduleId) {
                console.log(`[AutoDJ] Schedule transition detected on ${channelId}. Reloading queue...`);
                // Reload the entire session state with new queue
                const { emitChunk, emitMeta } = session;
                this.stop(channelId);
                await this.start(channelId, emitChunk, emitMeta);
                return; // start() will handle playing next
            }
        } catch (e) {
            console.warn(`[AutoDJ] Error checking schedule during transition: ${e.message}`);
        }

        let { queue, currentIndex } = session;

        if (currentIndex >= queue.length) {
            console.log(`[AutoDJ] Queue complete for ${channelId}, looping.`);
            session.currentIndex = 0;
            currentIndex = 0;
        }

        const track = queue[currentIndex];
        session.currentIndex++;

        if (!track || (!track.cloud_url && !track.filename)) {
            console.warn(`[AutoDJ] Skipping track at index ${session.currentIndex}`);
            this._playNext(channelId);
            return;
        }

        const nextTrackIdx = (session.currentIndex >= queue.length) ? 0 : session.currentIndex;
        const nextTrack = queue[nextTrackIdx];

        console.log(`[AutoDJ] Now playing on ${channelId}: "${track.title}" (${track.category})`);
        session.emitMeta({
            channelId,
            title: track.title,
            category: track.category,
            tags: track.tags,
            index: session.currentIndex,
            total: queue.length,
            next: nextTrack ? {
                title: nextTrack.title,
                category: nextTrack.category
            } : null
        });

        this._streamTrack(channelId, track);
    }

    _streamTrack(channelId, track) {
        const session = this.sessions.get(channelId);
        if (!session || !session.isRunning) return;

        let buffer = Buffer.alloc(0);
        let ended = false;

        // Use a Node.js PassThrough stream instead of concatenating to memory
        const { PassThrough } = require('stream');
        const passThrough = new PassThrough();

        // "-re" reads the input at its native frame rate. This ensures FFmpeg 
        // doesn't convert the entire file instantly and dump it into our stream.
        const proc = ffmpeg(track.cloud_url)
            .inputOptions(['-re'])
            .noVideo()
            .audioChannels(CHANNELS)
            .audioFrequency(SAMPLE_RATE)
            .audioCodec('pcm_s16le')
            .format('s16le')
            // Volume Normalization: Broadcast standard -16 LUFS
            .audioFilter('loudnorm=I=-16:TP=-1.5:LRA=11')
            .on('start', (cmd) => {
                console.log(`[AutoDJ] FFmpeg started (${track.title})`);
                session.consecutiveErrors = 0; // Reset error counter on successful start
            })
            .on('error', (err) => {
                if (!session.isRunning) return; // Expected on manual stop

                console.error(`[AutoDJ] FFmpeg error for "${track.title}":`, err.message);
                session.consecutiveErrors++;

                if (session.consecutiveErrors >= 3) {
                    console.error(`[AutoDJ] Aborting Auto-DJ on ${channelId} due to consecutive failures. (Circuit Breaker)`);
                    this.stop(channelId);
                    // Broadcast error state out if possible
                    this.emit('circuit-breaker', { channelId });
                    return;
                }

                // Try next track after short delay
                setTimeout(() => this._playNext(channelId), 1000);
            })
            .on('end', () => {
                ended = true;
                console.log(`[AutoDJ] Finished track: "${track.title}"`);
            });

        session.ffmpegProcess = proc;
        proc.pipe(passThrough);

        // Read chunks from the PassThrough stream 
        // This solves Issue #7 (RAM starvation) by only keeping chunk-sized buffers in JS memory
        passThrough.on('data', (data) => {
            if (!session.isRunning) return;

            buffer = Buffer.concat([buffer, data]);

            // Extract and emit exactly CHUNK_BYTES segments
            while (buffer.length >= CHUNK_BYTES) {
                const chunk = buffer.slice(0, CHUNK_BYTES);
                buffer = buffer.slice(CHUNK_BYTES);
                session.emitChunk({ chunk, trackId: track.id });
            }
        });

        passThrough.on('end', () => {
            if (!session.isRunning) return;

            // Drain any remaining bytes at the end of the track
            if (buffer.length > 0) {
                session.emitChunk({ chunk: buffer, trackId: track.id });
            }
            // Move to next
            setTimeout(() => this._playNext(channelId), 50);
        });
    }

    stop(channelId) {
        const session = this.sessions.get(channelId);
        if (!session) return;

        console.log(`[AutoDJ] Stopping for channel ${channelId}`);
        session.isRunning = false;

        if (session.ffmpegProcess) {
            try {
                session.ffmpegProcess.kill('SIGKILL');
            } catch (e) {
                // Already ended
            }
        }

        this.sessions.delete(channelId);
        this.emit('stopped', { channelId });
    }

    isRunning(channelId) {
        const session = this.sessions.get(channelId);
        return session ? session.isRunning : false;
    }

    getCurrentTrack(channelId) {
        const session = this.sessions.get(channelId);
        if (!session) return null;
        const idx = Math.max(0, session.currentIndex - 1);
        return session.queue[idx] || null;
    }

    getNextTrack(channelId) {
        const session = this.sessions.get(channelId);
        if (!session) return null;
        const idx = session.currentIndex;
        const nextIdx = (idx >= session.queue.length) ? 0 : idx;
        return session.queue[nextIdx] || null;
    }

    getSessionMetadata(channelId) {
        const session = this.sessions.get(channelId);
        if (!session || !session.isRunning) return null;

        const currentTrack = this.getCurrentTrack(channelId);
        const nextTrack = this.getNextTrack(channelId);

        if (!currentTrack) return null;

        return {
            channelId,
            title: currentTrack.title,
            category: currentTrack.category,
            tags: currentTrack.tags,
            index: Math.max(1, session.currentIndex),
            total: session.queue.length,
            next: nextTrack ? {
                title: nextTrack.title,
                category: nextTrack.category
            } : null
        };
    }

    skipTrack(channelId) {
        const session = this.sessions.get(channelId);
        if (!session || !session.isRunning) return;
        console.log(`[AutoDJ] Skipping track for channel ${channelId}`);
        if (session.ffmpegProcess) {
            try { session.ffmpegProcess.kill('SIGKILL'); } catch (e) { }
        }
    }
}

const autoDJService = new AutoDJService();
module.exports = autoDJService;
