const { EmbedBuilder, Collection } = require('discord.js');
const db = require('./database.js');
const config = require('./config.js');

// Status types
const TRACKER_STATUS = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    OFFLINE: 'Offline',
    ERROR: 'Error',
    RATE_LIMITED: 'Rate Limited',
    DATABASE_ERROR: 'Database Error',
    RECOVERING: 'Recovering',
    CORRUPTED: 'Corrupted',
    DEBUG: 'Debug Mode',
    DEGRADED: 'Degraded',
    MIGRATING: 'Migrating',
    BACKUP: 'Backup Mode',
    MISCONFIGURED: 'Misconfigured'
};

class TrackerManager {
    constructor(client) {
        this.client = client;
        // Map<guildId, Map<channelId, tracker>>
        this.activeTrackers = new Map();

        // Rate limits
        this.rateLimits = new Collection();

        // Bind methods to this instance
        this.startTracker = this.startTracker.bind(this);
        this.stopTracker = this.stopTracker.bind(this);
    }

    checkRateLimit(key, command, limit = 3, window = 60000) {
        const now = Date.now();
        const userLimits = this.rateLimits.get(key) || new Collection();
        const commandLimit = userLimits.get(command) || { count: 0, resetTime: now + window };

        if (now > commandLimit.resetTime) {
            commandLimit.count = 1;
            commandLimit.resetTime = now + window;
        } else {
            commandLimit.count++;
        }

        userLimits.set(command, commandLimit);
        this.rateLimits.set(key, userLimits);

        return commandLimit.count <= limit;
    }

    formatTime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        let timeString = '';
        if (days > 0) timeString += `${days}d `;
        if (hours > 0 || days > 0) timeString += `${hours}h `;
        if (minutes > 0 || hours > 0 || days > 0) timeString += `${minutes}m `;
        timeString += `${secs}s`;

        return timeString;
    }

    getStatusColor(status) {
        const colors = {
            [TRACKER_STATUS.ACTIVE]: '#2b2d31',
            [TRACKER_STATUS.INACTIVE]: '#747f8d',
            [TRACKER_STATUS.OFFLINE]: '#747f8d',
            [TRACKER_STATUS.ERROR]: '#ed4245',
            [TRACKER_STATUS.RATE_LIMITED]: '#faa61a',
            [TRACKER_STATUS.DATABASE_ERROR]: '#ed4245',
            [TRACKER_STATUS.RECOVERING]: '#faa61a',
            [TRACKER_STATUS.CORRUPTED]: '#ed4245',
            [TRACKER_STATUS.DEBUG]: '#5865f2',
            [TRACKER_STATUS.DEGRADED]: '#faa61a',
            [TRACKER_STATUS.MIGRATING]: '#faa61a',
            [TRACKER_STATUS.BACKUP]: '#5865f2',
            [TRACKER_STATUS.MISCONFIGURED]: '#faa61a'
        };
        return colors[status] || colors[TRACKER_STATUS.ERROR];
    }

    getStatusFooter(status) {
        const footers = {
            [TRACKER_STATUS.ACTIVE]: 'Click 🔄 to report a crash',
            [TRACKER_STATUS.INACTIVE]: 'Tracker is stopped',
            [TRACKER_STATUS.OFFLINE]: 'Bot is offline',
            [TRACKER_STATUS.ERROR]: 'Please restart the tracker',
            [TRACKER_STATUS.RATE_LIMITED]: 'Rate limit reached',
            [TRACKER_STATUS.DATABASE_ERROR]: 'Database connection error',
            [TRACKER_STATUS.RECOVERING]: 'Recovering from error',
            [TRACKER_STATUS.CORRUPTED]: 'Data corruption detected',
            [TRACKER_STATUS.DEBUG]: 'Debug mode active',
            [TRACKER_STATUS.DEGRADED]: 'Running in degraded mode',
            [TRACKER_STATUS.MIGRATING]: 'Database migration in progress',
            [TRACKER_STATUS.BACKUP]: 'Running in backup mode',
            [TRACKER_STATUS.MISCONFIGURED]: 'Using default configuration'
        };
        return footers[status] || 'Unknown status';
    }

    getDebugInfo(retryCount, maxRetries) {
        return [
            `Debug Mode: ${config.debug.enabled ? 'Enabled' : 'Disabled'}`,
            `Log Level: ${config.debug.logLevel}`,
            `Show SQL: ${config.debug.showSQL}`,
            `Show Timestamps: ${config.debug.showTimestamps}`,
            `Show Stack Traces: ${config.debug.showStackTraces}`,
            `Retry Count: ${retryCount}/${maxRetries}`,
            `Last Update: ${new Date().toISOString()}`,
            `Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
        ].join('\n');
    }

    createErrorEmbed(error, timeSinceLastCrash, retryCount, maxRetries) {
        const errorType = error.name || 'Unknown Error';
        return new EmbedBuilder()
            .setColor('#ed4245')
            .setTitle('⚠️ Tracker Error')
            .setDescription(`**Connection Error**\n\nLast known time:\n\`\`\`ansi\n${this.formatTime(timeSinceLastCrash)}\`\`\``)
            .addFields(
                { name: '📊 Status', value: '```Error```', inline: true },
                { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                { name: '❌ Error Type', value: `\`\`\`${errorType}\`\`\``, inline: true },
                { name: '🔍 Error Details', value: `\`\`\`${error.message}\`\`\``, inline: false },
                { name: '🔄 Retry Count', value: `\`\`\`${retryCount}/${maxRetries}\`\`\``, inline: true }
            )
            .setFooter({
                text: 'Please restart the tracker',
                iconURL: 'https://i.imgur.com/AfFp7pu.png'
            })
            .setTimestamp();
    }

    debugLog(message, level = 'info') {
        if (!config.debug.enabled) return;

        const logLevels = { debug: 0, info: 1, warn: 2, error: 3 };
        const minLevel = logLevels[config.debug.logLevel] || logLevels.info;
        const messageLevel = logLevels[level] || logLevels.info;

        if (messageLevel < minLevel) return;

        const timestamp = config.debug.showTimestamps ? `[${new Date().toISOString()}] ` : '';
        const emojis = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' };

        const emoji = emojis[level] || emojis.info;
        console.log(`${timestamp}${emoji} ${message}`);
    }

    async startTracker(channel, existingMessage = null, initialTime = 0, initialLastCrashBy = null, initialStatus = TRACKER_STATUS.ACTIVE) {
        this.debugLog(`Starting tracker in channel ${channel.id}`, 'info');
        const guildId = channel.guild.id;
        const channelId = channel.id;
        let trackerStatus = initialStatus;
        let retryCount = 0;
        const maxRetries = 3;

        // Check if there's already a tracker in this channel
        if (this.activeTrackers.has(guildId) && this.activeTrackers.get(guildId).has(channelId)) {
            this.debugLog(`Tracker already exists in guild ${guildId}, channel ${channelId}`, 'warn');
            return false;
        }

        // Check rate limit
        if (!this.checkRateLimit(channelId, 'startTracker', 1, 5000)) {
            this.debugLog(`Rate limit reached for channel ${channelId}`, 'warn');
            throw new Error('Please wait a moment before starting another tracker.');
        }

        // Initialize guild map if it doesn't exist
        if (!this.activeTrackers.has(guildId)) {
            this.activeTrackers.set(guildId, new Map());
        }

        // Check/Delete existing tracker in DB
        try {
            const existingTracker = await db.loadTracker(guildId, channelId);
            if (existingTracker && !existingMessage) {
                this.debugLog(`Found existing tracker in database for guild ${guildId}, channel ${channelId}`, 'info');
                await db.deleteTracker(guildId, channelId);
                this.debugLog(`Deleted old tracker from database`, 'debug');
            }
        } catch (error) {
            this.debugLog(`Error checking existing tracker: ${error.message}`, 'error');
        }

        let timeSinceLastCrash = initialTime;
        let lastCrashBy = initialLastCrashBy;
        let totalCrashes = 0;
        let interval;
        let collector;

        const version = require('./package.json').version || 'Unknown';

        const updateMessage = async (message) => {
            try {
                this.debugLog(`Updating tracker message in channel ${channelId}`, 'debug');
                const embed = new EmbedBuilder()
                    .setColor(this.getStatusColor(trackerStatus))
                    .setTitle('🛩️ Minicopter Crash Tracker')
                    .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${this.formatTime(timeSinceLastCrash)}\`\`\``)
                    .addFields(
                        { name: '📊 Status', value: `\`\`\`${trackerStatus}\`\`\``, inline: true },
                        { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        { name: '📦 Version', value: `\`\`\`${version}\`\`\``, inline: true },
                        { name: '💥 Total Crashes', value: `\`\`\`${totalCrashes}\`\`\``, inline: true }
                    )
                    .setFooter({
                        text: this.getStatusFooter(trackerStatus),
                        iconURL: 'https://i.imgur.com/AfFp7pu.png'
                    })
                    .setTimestamp();

                if (lastCrashBy) {
                    embed.addFields({
                        name: '👤 Last Crash Reporter',
                        value: `\`\`\`${lastCrashBy}\`\`\``,
                        inline: false
                    });
                }

                if (config.debug.enabled) {
                    embed.addFields({
                        name: '🔧 Debug Info',
                        value: `\`\`\`ansi\n${this.getDebugInfo(retryCount, maxRetries)}\`\`\``,
                        inline: false
                    });
                }

                await message.edit({ embeds: [embed] });
                retryCount = 0;

                // Save current state using database manager
                await db.saveTracker(guildId, channelId, {
                    messageId: message.id,
                    timeSinceLastCrash,
                    lastCrashBy,
                    lastUpdate: Date.now(),
                    status: trackerStatus,
                    version: version,
                    totalCrashes
                });

                // Update in-memory state for safe retrieval (instead of scraping embed)
                const tracker = this.activeTrackers.get(guildId)?.get(channelId);
                if (tracker) {
                    tracker.state = {
                        timeSinceLastCrash,
                        lastCrashBy,
                        totalCrashes,
                        lastUpdate: Date.now(),
                        status: trackerStatus
                    };
                }

                this.debugLog(`Saved tracker state to database`, 'debug');
            } catch (error) {
                this.debugLog(`Error updating tracker: ${error.message}`, 'error');
                if (config.debug.showStackTraces) {
                    console.error(error.stack);
                }
                retryCount++;

                if (retryCount >= maxRetries) {
                    this.debugLog('Max retries reached, stopping tracker', 'error');
                    trackerStatus = TRACKER_STATUS.ERROR;
                    await this.stopTracker(guildId, channelId);
                    try {
                        const errorEmbed = this.createErrorEmbed(error, timeSinceLastCrash, retryCount, maxRetries);
                        await message.edit({ embeds: [errorEmbed] });
                    } catch (e) {
                        this.debugLog(`Could not send final message: ${e.message}`, 'error');
                    }
                }
            }
        };

        try {
            let trackerMsg;
            if (existingMessage) {
                this.debugLog(`Using existing message for tracker`, 'info');
                trackerMsg = existingMessage;
                // If recovering, we should trust the passed params or DB, but here we might need to load totalCrashes if not passed
                // For now assuming existingMessage recovery means we might have data in DB.
                // The caller should ideally pass totalCrashes if known.
                // Let's check DB again just to be sure if we need totalCrashes
                const savedData = await db.loadTracker(guildId, channelId);
                if (savedData) {
                    totalCrashes = savedData.totalCrashes || 0;
                    if (initialTime === 0 && savedData.timeSinceLastCrash) timeSinceLastCrash = savedData.timeSinceLastCrash; // Fallback
                }

                // Initial update to sync state
                await updateMessage(trackerMsg);

            } else {
                this.debugLog(`Creating new tracker message`, 'info');
                const initialEmbed = new EmbedBuilder()
                    .setColor(this.getStatusColor(TRACKER_STATUS.ACTIVE))
                    .setTitle('🛩️ Minicopter Crash Tracker')
                    .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${this.formatTime(timeSinceLastCrash)}\`\`\``)
                    .addFields(
                        { name: '📊 Status', value: `\`\`\`${TRACKER_STATUS.ACTIVE}\`\`\``, inline: true },
                        { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        { name: '📦 Version', value: `\`\`\`${version}\`\`\``, inline: true },
                        { name: '💥 Total Crashes', value: `\`\`\`${totalCrashes}\`\`\``, inline: true }
                    )
                    .setFooter({
                        text: this.getStatusFooter(TRACKER_STATUS.ACTIVE),
                        iconURL: 'https://i.imgur.com/AfFp7pu.png'
                    })
                    .setTimestamp();

                trackerMsg = await channel.send({ embeds: [initialEmbed] });
                await trackerMsg.react('🔄');
                this.debugLog(`Created new tracker message and added crash reaction`, 'debug');
            }

            interval = setInterval(async () => {
                timeSinceLastCrash += config.tracker.incrementAmount;
                await updateMessage(trackerMsg);
            }, config.tracker.updateInterval);
            this.debugLog(`Started update interval: ${config.tracker.updateInterval}ms`, 'debug');

            const filter = (reaction, user) => (reaction.emoji.name === '🔄' || reaction.emoji.name === '⏹️') && !user.bot;
            collector = trackerMsg.createReactionCollector({ filter });
            this.debugLog(`Created reaction collector`, 'debug');

            collector.on('collect', async (reaction, user) => {
                if (reaction.emoji.name === '🔄') {
                    this.debugLog(`Crash reported by ${user.tag}`, 'info');
                    timeSinceLastCrash = 0;
                    lastCrashBy = user.tag;
                    totalCrashes++;
                } else if (reaction.emoji.name === '⏹️') {
                    this.debugLog(`Tracker reset by ${user.tag}`, 'info');
                    timeSinceLastCrash = 0;
                    lastCrashBy = null;
                    totalCrashes = 0;

                    const existingReactions = trackerMsg.reactions.cache;
                    if (!existingReactions.has('🔄')) {
                        try {
                            await trackerMsg.react('🔄');
                        } catch (e) {
                            this.debugLog(`Failed to re-add crash reaction: ${e.message}`, 'warn');
                        }
                    }
                }
                try {
                    await updateMessage(trackerMsg);
                    if (channel.permissionsFor(this.client.user).has('ManageMessages')) {
                        await reaction.users.remove(user.id);
                    }
                } catch (error) {
                    this.debugLog(`Error updating tracker on reaction: ${error.message}`, 'error');
                }
            });

            collector.on('end', () => {
                this.debugLog(`Reaction collector ended`, 'info');
                clearInterval(interval);
                const guildTrackers = this.activeTrackers.get(guildId);
                if (guildTrackers) {
                    guildTrackers.delete(channelId);
                    if (guildTrackers.size === 0) {
                        this.activeTrackers.delete(guildId);
                    }
                }
            });

            // Store the tracker info
            this.activeTrackers.get(guildId).set(channelId, {
                message: trackerMsg,
                interval,
                collector,
                status: trackerStatus,
                state: {
                    timeSinceLastCrash,
                    lastCrashBy,
                    totalCrashes,
                    lastUpdate: Date.now(),
                    status: trackerStatus
                }
            });
            this.debugLog(`Tracker started successfully`, 'info');

            return true;
        } catch (error) {
            this.debugLog(`Error starting tracker: ${error.message}`, 'error');
            const errorEmbed = this.createErrorEmbed(error, timeSinceLastCrash, 0, maxRetries);
            try {
                if (channel) await channel.send({ embeds: [errorEmbed] });
            } catch (e) { console.error("Failed to send error embed", e); }
            return false;
        }
    }

    async stopTracker(guildId, channelId) {
        console.log('stopTracker called for:', { guildId, channelId });

        if (!this.activeTrackers.has(guildId) || !this.activeTrackers.get(guildId).has(channelId)) {
            console.log(`No active tracker found in guild ${guildId}, channel ${channelId}`);
            return false;
        }

        const guildTrackers = this.activeTrackers.get(guildId);
        const tracker = guildTrackers.get(channelId);

        if (tracker) {
            console.log('Found tracker, stopping...');
            try {
                clearInterval(tracker.interval);
                if (tracker.collector) {
                    tracker.collector.stop();
                }

                // Use stored state instead of scraping
                const { timeSinceLastCrash } = tracker.state || { timeSinceLastCrash: 0 };

                try {
                    const message = tracker.message;
                    const embed = EmbedBuilder.from(message.embeds[0])
                        .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${this.formatTime(timeSinceLastCrash)}\`\`\``)
                        .spliceFields(0, 1, { name: '📊 Status', value: `\`\`\`${TRACKER_STATUS.INACTIVE}\`\`\``, inline: true })
                        .setFooter({
                            text: this.getStatusFooter(TRACKER_STATUS.INACTIVE),
                            iconURL: 'https://i.imgur.com/AfFp7pu.png'
                        });
                    await message.edit({ embeds: [embed] });
                } catch (error) {
                    console.error('Error updating message status:', error.message);
                }

                // Delete the tracker from the database
                try {
                    await db.deleteTracker(guildId, channelId);
                    console.log(`Deleted tracker from database: guild ${guildId}, channel ${channelId}`);
                } catch (error) {
                    console.error('Error deleting tracker from database:', error.message);
                }

                // Clean up map
                guildTrackers.delete(channelId);
                if (guildTrackers.size === 0) {
                    this.activeTrackers.delete(guildId);
                }

                console.log('Tracker stopped successfully');
                return true;
            } catch (error) {
                console.error('Error stopping tracker:', error);
                return false;
            }
        }
        return false;
    }

    async updateAllTrackersToOffline(reason = 'Bot is offline') {
        console.log('Updating all trackers to offline status...');
        const version = require('./package.json').version || 'Unknown';

        for (const [guildId, guildTrackers] of this.activeTrackers) {
            for (const [channelId, tracker] of guildTrackers) {
                try {
                    const message = tracker.message;
                    // Use state if available, otherwise try safe defaults
                    const state = tracker.state || {};
                    const timeSinceLastCrash = state.timeSinceLastCrash || 0;
                    const lastCrashBy = state.lastCrashBy;
                    const totalCrashes = state.totalCrashes || 0;

                    const offlineEmbed = new EmbedBuilder()
                        .setColor(this.getStatusColor(TRACKER_STATUS.OFFLINE))
                        .setTitle('🛩️ Minicopter Crash Tracker')
                        .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${this.formatTime(timeSinceLastCrash)}\`\`\``)
                        .addFields(
                            { name: '📊 Status', value: `\`\`\`${TRACKER_STATUS.OFFLINE}\`\`\``, inline: true },
                            { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                            { name: '📦 Version', value: `\`\`\`${version}\`\`\``, inline: true },
                            { name: '💥 Total Crashes', value: `\`\`\`${totalCrashes}\`\`\``, inline: true }
                        )
                        .setFooter({
                            text: reason,
                            iconURL: 'https://i.imgur.com/AfFp7pu.png'
                        })
                        .setTimestamp();

                    if (lastCrashBy) {
                        offlineEmbed.addFields({
                            name: '👤 Last Crash Reporter',
                            value: `\`\`\`${lastCrashBy}\`\`\``,
                            inline: false
                        });
                    }

                    await message.edit({ embeds: [offlineEmbed] });

                    // Also save to DB one last time
                    await db.saveTracker(guildId, channelId, {
                        messageId: message.id,
                        timeSinceLastCrash,
                        lastCrashBy,
                        lastUpdate: Date.now(),
                        status: TRACKER_STATUS.OFFLINE,
                        version: version,
                        totalCrashes
                    });

                } catch (error) {
                    console.error(`Error updating tracker in guild ${guildId}, channel ${channelId}:`, error.message);
                }
            }
        }
    }
}

module.exports = TrackerManager;
