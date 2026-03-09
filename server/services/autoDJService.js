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

const CHUNK_SIZE_MS = 100; // emit a chunk every 100ms worth of audio
const SAMPLE_RATE = 44100;
const CHANNELS = 1; // mono
const BIT_DEPTH = 16; // 16-bit PCM
const BYTES_PER_MS = (SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8)) / 1000;
const CHUNK_BYTES = Math.floor(BYTES_PER_MS * CHUNK_SIZE_MS);

class AutoDJService extends EventEmitter {
    constructor() {
        super();
        // Map of channelId => { ffmpegProcess, queue, currentIndex, isRunning, isPaused }
        this.sessions = new Map();
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

        // Build the queue from the media library
        const library = await MediaLibraryModel.findByChannelId(channelId);

        if (!library || library.length === 0) {
            console.log(`[AutoDJ] No media in library for channel ${channelId}. Auto-DJ aborted.`);
            this.emit('no-media', { channelId });
            return;
        }

        // --- Auto-Jingle Injection (Rotation Logic) ---
        const musicTracks = library.filter(t => t.category === 'music' || t.category === 'show');
        const jingles = library.filter(t => t.category === 'jingle' || t.category === 'ad');

        let queue = [];
        if (musicTracks.length === 0) {
            queue = library; // Fallback: just play whatever is there if there's no music
        } else {
            for (let i = 0; i < musicTracks.length; i++) {
                queue.push(musicTracks[i]);
                // Insert a random jingle after every 3 music/show tracks
                if ((i + 1) % 3 === 0 && jingles.length > 0) {
                    const randomJingle = jingles[Math.floor(Math.random() * jingles.length)];
                    queue.push(randomJingle);
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
        };

        this.sessions.set(channelId, session);
        console.log(`[AutoDJ] Starting for channel ${channelId} with ${queue.length} tracks`);
        this.emit('started', { channelId });

        this._playNext(channelId);
    }

    _playNext(channelId) {
        const session = this.sessions.get(channelId);
        if (!session || !session.isRunning) return;

        let { queue, currentIndex } = session;

        if (currentIndex >= queue.length) {
            // Loop back to start
            console.log(`[AutoDJ] Queue complete for ${channelId}, looping.`);
            session.currentIndex = 0;
            currentIndex = 0;
        }

        const track = queue[currentIndex];
        session.currentIndex++;

        if (!track || !track.cloud_url) {
            console.warn(`[AutoDJ] Skipping track with no URL at index ${session.currentIndex}`);
            this._playNext(channelId);
            return;
        }

        console.log(`[AutoDJ] Now playing on ${channelId}: "${track.title}" (${track.category})`);
        session.emitMeta({
            channelId,
            title: track.title,
            category: track.category,
            tags: track.tags,
            index: session.currentIndex,
            total: queue.length
        });

        this._streamTrack(channelId, track);
    }

    _streamTrack(channelId, track) {
        const session = this.sessions.get(channelId);
        if (!session || !session.isRunning) return;

        let buffer = Buffer.alloc(0);
        let chunkTimer = null;
        let ended = false;

        const proc = ffmpeg(track.cloud_url)
            .noVideo()
            .audioChannels(CHANNELS)
            .audioFrequency(SAMPLE_RATE)
            .audioCodec('pcm_s16le')
            .format('s16le')
            // Volume Normalization: Broadcast standard -16 LUFS
            .audioFilter('loudnorm=I=-16:TP=-1.5:LRA=11')
            .on('start', (cmd) => {
                console.log(`[AutoDJ] FFmpeg started: ${cmd.substring(0, 80)}...`);
            })
            .on('error', (err) => {
                if (!session.isRunning) return; // Expected on stop
                console.error(`[AutoDJ] FFmpeg error for "${track.title}":`, err.message);
                clearInterval(chunkTimer);
                // Try next track after short delay
                setTimeout(() => this._playNext(channelId), 500);
            })
            .on('end', () => {
                ended = true;
                console.log(`[AutoDJ] Finished track: "${track.title}"`);
            });

        session.ffmpegProcess = proc;

        const stream = proc.pipe();

        stream.on('data', (data) => {
            buffer = Buffer.concat([buffer, data]);
        });

        stream.on('end', () => {
            ended = true;
        });

        // Drip-feed chunks at a consistent rate to simulate real-time streaming
        chunkTimer = setInterval(() => {
            if (!session.isRunning) {
                clearInterval(chunkTimer);
                return;
            }

            if (buffer.length >= CHUNK_BYTES) {
                const chunk = buffer.slice(0, CHUNK_BYTES);
                buffer = buffer.slice(CHUNK_BYTES);
                session.emitChunk(chunk);
            } else if (ended && buffer.length > 0) {
                // Drain remaining bytes
                session.emitChunk(buffer);
                buffer = Buffer.alloc(0);
            } else if (ended && buffer.length === 0) {
                // Track finished, move to next
                clearInterval(chunkTimer);
                // Small gap between tracks for transition
                setTimeout(() => this._playNext(channelId), 800);
            }
        }, CHUNK_SIZE_MS);
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
