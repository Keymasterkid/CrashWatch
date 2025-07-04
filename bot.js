const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, Collection } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config.js');
const slashCommands = require('./slash-commands.js');
const db = require('./database.js');

// Bot version
const VERSION = '1.0.4';

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ]
});

// Track active trackers
// Structure: Map<guildId, Map<channelId, tracker>>
client.activeTrackers = new Map();

// Add rate limit handling
client.rateLimits = new Collection();

// Add status types
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

// Add default configuration
const DEFAULT_CONFIG = {
    prefix: '!',
    debug: {
        enabled: false,
        logLevel: 'info',
        showSQL: false,
        showTimestamps: true,
        showStackTraces: false
    },
    tracker: {
        updateInterval: 10000,
        incrementAmount: 10
    },
    database: {
        type: 'sqlite',
        sqlitePath: './data/trackers.db',
        verbose: false,
        jsonPath: './data/trackers.json'
    }
};

// Add configuration validation
function validateConfig(userConfig) {
    const validatedConfig = { ...DEFAULT_CONFIG };
    const missingRequired = [];
    const misconfigured = [];

    // Check required fields
    if (!userConfig.token) missingRequired.push('token');
    if (!userConfig.clientId) missingRequired.push('clientId');

    // Validate debug settings (optional but will show as misconfigured if missing)
    if (!userConfig.debug) {
        misconfigured.push('debug (using defaults)');
    } else {
        validatedConfig.debug = {
            ...DEFAULT_CONFIG.debug,
            ...userConfig.debug
        };
        if (!['debug', 'info', 'warn', 'error'].includes(validatedConfig.debug.logLevel)) {
            misconfigured.push('debug.logLevel');
            validatedConfig.debug.logLevel = DEFAULT_CONFIG.debug.logLevel;
        }
    }

    // Validate tracker settings
    if (!userConfig.tracker) {
        missingRequired.push('tracker');
    } else {
        validatedConfig.tracker = {
            ...DEFAULT_CONFIG.tracker,
            ...userConfig.tracker
        };
        if (validatedConfig.tracker.updateInterval < 1000) {
            misconfigured.push('tracker.updateInterval');
            validatedConfig.tracker.updateInterval = DEFAULT_CONFIG.tracker.updateInterval;
        }
        if (validatedConfig.tracker.incrementAmount < 1) {
            misconfigured.push('tracker.incrementAmount');
            validatedConfig.tracker.incrementAmount = DEFAULT_CONFIG.tracker.incrementAmount;
        }
    }

    // Validate database settings
    if (!userConfig.database) {
        missingRequired.push('database');
    } else {
        validatedConfig.database = {
            ...DEFAULT_CONFIG.database,
            ...userConfig.database
        };
        if (!['json', 'sqlite'].includes(validatedConfig.database.type)) {
            misconfigured.push('database.type');
            validatedConfig.database.type = DEFAULT_CONFIG.database.type;
        }
    }

    // Add prefix if provided
    if (userConfig.prefix) {
        validatedConfig.prefix = userConfig.prefix;
    }

    // Add required fields
    validatedConfig.token = userConfig.token;
    validatedConfig.clientId = userConfig.clientId;

    return {
        config: validatedConfig,
        missingRequired,
        misconfigured
    };
}

function formatTime(seconds) {
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

// Remove old file-based functions and replace with db calls
async function saveCrashData(data) {
    // This function is now handled by the database manager
    // Keeping it for backward compatibility
    console.warn('saveCrashData is deprecated, use db.saveTracker instead');
}

async function loadCrashData() {
    // This function is now handled by the database manager
    // Keeping it for backward compatibility
    console.warn('loadCrashData is deprecated, use db.loadTracker instead');
    return await db.loadAllTrackers();
}

async function clearCrashData() {
    // This function is now handled by the database manager
    // Keeping it for backward compatibility
    console.warn('clearCrashData is deprecated, use db.deleteTracker instead');
}

// Add migration function
async function migrateToSqlite() {
    if (config.database.type !== 'sqlite') return;

    // Check if migration is needed first
    if (db.migrationCompleted) {
        console.log('Migration already completed, skipping...');
        return;
    }

    console.log('Starting migration from JSON to SQLite...');
    const migrationMessages = [];

    try {
        const success = await db.migrateFromJsonToSqlite();
        
        if (!success) {
            throw new Error('Migration failed');
        }
        
        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
        
        // Only send error message if there are active trackers
        for (const [guildId, guildTrackers] of client.activeTrackers) {
            for (const [channelId, tracker] of guildTrackers) {
                try {
                    const message = tracker.message;
                    if (message) {
                        const errorEmbed = new EmbedBuilder()
                            .setColor('#ED4245')  // Discord error red
                            .setTitle('❌ Database Migration Failed')
                            .setDescription('There was an error during the migration process.')
                            .addFields(
                                { name: '📊 Status', value: '```Failed```', inline: true },
                                { name: '⏰ Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                                { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true },
                                { name: '❌ Error', value: `\`\`\`${error.message}\`\`\``, inline: false }
                            )
                            .setFooter({ 
                                text: 'Migration failed - Please check logs', 
                                iconURL: 'https://i.imgur.com/AfFp7pu.png'
                            })
                            .setTimestamp();

                        await message.channel.send({ embeds: [errorEmbed] });
                    }
                } catch (sendError) {
                    console.error('Error sending migration error message:', sendError.message);
                }
            }
        }
    }
}

// Add rate limit check function
function checkRateLimit(userId, command, limit = 3, window = 60000) {
    const now = Date.now();
    const userLimits = client.rateLimits.get(userId) || new Collection();
    const commandLimit = userLimits.get(command) || { count: 0, resetTime: now + window };

    if (now > commandLimit.resetTime) {
        commandLimit.count = 1;
        commandLimit.resetTime = now + window;
    } else {
        commandLimit.count++;
    }

    userLimits.set(command, commandLimit);
    client.rateLimits.set(userId, userLimits);

    return commandLimit.count <= limit;
}

// Add debug logging function
function debugLog(message, level = 'info') {
    if (!config.debug.enabled) return;
    
    // Define log level priorities
    const logLevels = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3
    };

    // Get the minimum required log level from config
    const minLevel = logLevels[config.debug.logLevel] || logLevels.info;
    const messageLevel = logLevels[level] || logLevels.info;

    // Only log if the message level is at or above the minimum level
    if (messageLevel < minLevel) return;
    
    const timestamp = config.debug.showTimestamps ? `[${new Date().toISOString()}] ` : '';
    const emojis = {
        debug: '🔍',
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌'
    };
    
    const emoji = emojis[level] || emojis.info;
    console.log(`${timestamp}${emoji} ${message}`);
}

// Update the startTracker method
client.startTracker = async function(channel, existingMessage = null, initialTime = 0, initialLastCrashBy = null, initialStatus = TRACKER_STATUS.ACTIVE) {
    debugLog(`Starting tracker in channel ${channel.id}`, 'info');
    const guildId = channel.guild.id;
    const channelId = channel.id;
    let trackerStatus = initialStatus;
    let retryCount = 0;
    const maxRetries = 3;

    // Validate configuration
    const { config: validatedConfig, missingRequired, misconfigured } = validateConfig(config);
    
    // Update config with validated values
    Object.assign(config, validatedConfig);

    // Check for configuration issues
    if (missingRequired.length > 0 || misconfigured.length > 0) {
        debugLog('Configuration issues detected', 'warn');
        if (missingRequired.length > 0) {
            debugLog(`Missing required settings: ${missingRequired.join(', ')}`, 'warn');
        }
        if (misconfigured.length > 0) {
            debugLog(`Misconfigured settings (using defaults): ${misconfigured.join(', ')}`, 'warn');
        }
        trackerStatus = TRACKER_STATUS.MISCONFIGURED;
    }

    // Check rate limit
    if (!checkRateLimit(channelId, 'startTracker', 1, 5000)) {
        debugLog(`Rate limit reached for channel ${channelId}`, 'warn');
        throw new Error('Please wait a moment before starting another tracker.');
    }

    // Initialize guild map if it doesn't exist
    if (!this.activeTrackers.has(guildId)) {
        debugLog(`Creating new guild map for ${guildId}`, 'debug');
        this.activeTrackers.set(guildId, new Map());
    }

    // Check if there's already a tracker in this channel
    if (this.activeTrackers.get(guildId).has(channelId)) {
        debugLog(`Tracker already exists in guild ${guildId}, channel ${channelId}`, 'warn');
        return false;
    }

    // Check if there's an existing tracker in the database
    try {
        const existingTracker = await db.loadTracker(guildId, channelId);
        if (existingTracker && !existingMessage) {
            debugLog(`Found existing tracker in database for guild ${guildId}, channel ${channelId}`, 'info');
            // Delete the old tracker from database since we're starting a new one
            await db.deleteTracker(guildId, channelId);
            debugLog(`Deleted old tracker from database`, 'debug');
        }
    } catch (error) {
        debugLog(`Error checking existing tracker: ${error.message}`, 'error');
    }

    let timeSinceLastCrash = initialTime;
    let lastCrashBy = initialLastCrashBy;
    let totalCrashes = 0;
    let interval;
    let collector;
    
    const updateMessage = async (message) => {
        try {
            debugLog(`Updating tracker message in channel ${channelId}`, 'debug');
            const embed = new EmbedBuilder()
                .setColor(getStatusColor(trackerStatus))
                .setTitle('🛩️ Minicopter Crash Tracker')
                .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${formatTime(timeSinceLastCrash)}\`\`\``)
                .addFields(
                    { name: '📊 Status', value: `\`\`\`${trackerStatus}\`\`\``, inline: true },
                    { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true },
                    { name: '💥 Total Crashes', value: `\`\`\`${totalCrashes}\`\`\``, inline: true }
                )
                .setFooter({ 
                    text: getStatusFooter(trackerStatus), 
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

            // Add debug information if debug mode is enabled
            if (config.debug.enabled) {
                embed.addFields({
                    name: '🔧 Debug Info',
                    value: `\`\`\`ansi\n${getDebugInfo(retryCount, maxRetries)}\`\`\``,
                    inline: false
                });
            }

            // Add configuration issues if any
            if (missingRequired.length > 0 || misconfigured.length > 0) {
                let configIssues = [];
                if (missingRequired.length > 0) {
                    configIssues.push('Missing settings:');
                    configIssues.push(...missingRequired.map(setting => `- ${setting}`));
                }
                if (misconfigured.length > 0) {
                    if (configIssues.length > 0) configIssues.push('');
                    configIssues.push('Invalid settings (using defaults):');
                    configIssues.push(...misconfigured.map(setting => `- ${setting}`));
                }
                embed.addFields({
                    name: '⚠️ Configuration Issues',
                    value: `\`\`\`ansi\n${configIssues.join('\n')}\`\`\``,
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
                version: VERSION,
                totalCrashes
            });
            debugLog(`Saved tracker state to database`, 'debug');
        } catch (error) {
            debugLog(`Error updating tracker: ${error.message}`, 'error');
            if (config.debug.showStackTraces) {
                console.error(error.stack);
            }
            retryCount++;
            
            if (retryCount >= maxRetries) {
                debugLog('Max retries reached, stopping tracker', 'error');
                trackerStatus = TRACKER_STATUS.ERROR;
                await this.stopTracker(guildId, channelId);
                try {
                    const errorEmbed = createErrorEmbed(error, timeSinceLastCrash, retryCount, maxRetries);
                    await message.edit({ embeds: [errorEmbed] });
                } catch (e) {
                    debugLog(`Could not send final message: ${e.message}`, 'error');
                }
            }
        }
    };

    const startTracking = async () => {
        try {
            let trackerMsg;
            if (existingMessage) {
                debugLog(`Using existing message for tracker`, 'info');
                trackerMsg = existingMessage;
                // Load total crashes from saved data
                const crashData = await loadCrashData();
                if (crashData && crashData[guildId] && crashData[guildId][channelId]) {
                    totalCrashes = crashData[guildId][channelId].totalCrashes || 0;
                    debugLog(`Loaded total crashes: ${totalCrashes}`, 'debug');
                }
                await updateMessage(trackerMsg);
            } else {
                debugLog(`Creating new tracker message`, 'info');
                const initialEmbed = new EmbedBuilder()
                    .setColor(getStatusColor(TRACKER_STATUS.ACTIVE))
                    .setTitle('🛩️ Minicopter Crash Tracker')
                    .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${formatTime(timeSinceLastCrash)}\`\`\``)
                    .addFields(
                        { name: '📊 Status', value: `\`\`\`${TRACKER_STATUS.ACTIVE}\`\`\``, inline: true },
                        { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true },
                        { name: '💥 Total Crashes', value: `\`\`\`${totalCrashes}\`\`\``, inline: true }
                    )
                    .setFooter({ 
                        text: getStatusFooter(TRACKER_STATUS.ACTIVE), 
                        iconURL: 'https://i.imgur.com/AfFp7pu.png'
                    })
                    .setTimestamp();

                trackerMsg = await channel.send({ embeds: [initialEmbed] });
                await trackerMsg.react('🔄'); // Only auto-add crash reaction
                // Do NOT auto-add reset reaction (⏹️); user must add it manually
                debugLog(`Created new tracker message and added crash reaction`, 'debug');
            }

            interval = setInterval(async () => {
                timeSinceLastCrash += config.tracker.incrementAmount;
                await updateMessage(trackerMsg);
            }, config.tracker.updateInterval);
            debugLog(`Started update interval: ${config.tracker.updateInterval}ms`, 'debug');

            // Update: support both crash and reset reactions (reset = ⏹️, must be added by user)
            const filter = (reaction, user) => (reaction.emoji.name === '🔄' || reaction.emoji.name === '⏹️') && !user.bot;
            collector = trackerMsg.createReactionCollector({ filter });
            debugLog(`Created reaction collector`, 'debug');

            collector.on('collect', async (reaction, user) => {
                if (reaction.emoji.name === '🔄') {
                    debugLog(`Crash reported by ${user.tag}`, 'info');
                    timeSinceLastCrash = 0;
                    lastCrashBy = user.tag;
                    totalCrashes++;
                } else if (reaction.emoji.name === '⏹️') {
                    debugLog(`Tracker reset by ${user.tag}`, 'info');
                    timeSinceLastCrash = 0;
                    lastCrashBy = null;
                    // Optionally, you could log who reset it, or add a field for last resetter
                }
                try {
                    await updateMessage(trackerMsg);
                    // Check if bot has permission to remove reactions
                    if (channel.permissionsFor(this.user).has('ManageMessages')) {
                        await reaction.users.remove(user.id);
                        debugLog(`Removed reaction from ${user.tag}`, 'debug');
                    }
                } catch (error) {
                    debugLog(`Error updating tracker on reaction: ${error.message}`, 'error');
                }
            });

            collector.on('end', () => {
                debugLog(`Reaction collector ended`, 'info');
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
                status: trackerStatus
            });
            debugLog(`Tracker started successfully`, 'info');

            return true;
        } catch (error) {
            debugLog(`Error starting tracker: ${error.message}`, 'error');
            const errorType = error.name || 'Unknown Error';
            const errorEmbed = new EmbedBuilder()
                .setColor('#ed4245')
                .setTitle('⚠️ Error')
                .setDescription('**Failed to start Minicopter crash tracker**')
                .addFields(
                    { name: '📊 Status', value: '```Error```', inline: true },
                    { name: '⏰ Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '❌ Error Type', value: `\`\`\`${errorType}\`\`\``, inline: true },
                    { name: '🔍 Error Details', value: `\`\`\`${error.message}\`\`\``, inline: false }
                )
                .setFooter({ 
                    text: 'Please try again', 
                    iconURL: 'https://i.imgur.com/AfFp7pu.png'
                })
                .setTimestamp();
            channel.send({ embeds: [errorEmbed] });
            return false;
        }
    };

    return startTracking();
};

// Move stopTracker to be a client method
client.stopTracker = async function(guildId, channelId) {
    console.log('stopTracker called for:', { guildId, channelId });
    console.log('Current active trackers:', {
        hasGuild: this.activeTrackers.has(guildId),
        guildTrackers: this.activeTrackers.get(guildId) ? Array.from(this.activeTrackers.get(guildId).keys()) : []
    });

    // Check if there's actually a tracker in this channel
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
            guildTrackers.delete(channelId);
            
            // Clean up empty guild maps
            if (guildTrackers.size === 0) {
                this.activeTrackers.delete(guildId);
            }

            // Update the message to show stopped status
            try {
                const message = tracker.message;
                const embed = EmbedBuilder.from(message.embeds[0])
                    .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${message.embeds[0].description.split('```ansi\n')[1].split('```')[0]}\`\`\``)
                    .spliceFields(0, 1, { name: '📊 Status', value: `\`\`\`${TRACKER_STATUS.INACTIVE}\`\`\``, inline: true })
                    .setFooter({ 
                        text: getStatusFooter(TRACKER_STATUS.INACTIVE), 
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

            console.log('Tracker stopped successfully');
            return true;
        } catch (error) {
            console.error('Error stopping tracker:', error);
            return false;
        }
    }
    console.log('No tracker object found');
    return false;
};

// Function to register slash commands with retry mechanism
async function registerSlashCommands(guildId = null, retryCount = 0) {
    const maxRetries = 3;
    try {
        const rest = new REST({ version: '10' }).setToken(config.token);
        console.log('Started refreshing application (/) commands.');

        if (guildId) {
            // Register commands for specific guild
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: slashCommands.commands },
            );
            console.log(`Successfully registered commands for guild ${guildId}`);
        } else {
            // Register commands for all current guilds
            const guilds = client.guilds.cache;
            for (const [id, guild] of guilds) {
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, id),
                    { body: slashCommands.commands },
                );
                console.log(`Successfully registered commands for guild ${guild.name} (${id})`);
            }
        }
    } catch (error) {
        console.error('Error registering slash commands:', error);
        if (retryCount < maxRetries) {
            console.log(`Retrying command registration (attempt ${retryCount + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
            return registerSlashCommands(guildId, retryCount + 1);
        } else {
            console.error('Max retries reached for command registration');
        }
    }
}

// Update client.once('ready') to handle migration and configuration
client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    
    // Validate configuration
    const { config: validatedConfig, missingRequired, misconfigured } = validateConfig(config);
    
    // Update config with validated values
    Object.assign(config, validatedConfig);

    // Log configuration issues
    if (missingRequired.length > 0) {
        console.error('❌ Missing required configuration:', missingRequired.join(', '));
        process.exit(1);
    }

    if (misconfigured.length > 0) {
        console.warn('⚠️ Misconfigured settings (using defaults):', misconfigured.join(', '));
    }

    console.log(`Using prefix: ${config.prefix}`);
    console.log(`Tracker settings: Updates every ${config.tracker.updateInterval/1000} seconds, increments by ${config.tracker.incrementAmount} seconds`);
    console.log(`Database type: ${config.database.type}`);
    console.log(`Debug mode: ${config.debug.enabled ? 'Enabled' : 'Disabled'}`);

    // Register commands for all current guilds
    await registerSlashCommands();

    // Initialize database
    await db.initialize();

    // Try to recover any existing trackers first
    const crashData = await db.loadAllTrackers();
    if (crashData && Object.keys(crashData).length > 0) {
        console.log('Found existing trackers, attempting recovery...');
        
        for (const [guildId, channels] of Object.entries(crashData)) {
            for (const [channelId, data] of Object.entries(channels)) {
                try {
                    const guild = await client.guilds.fetch(guildId).catch(() => null);
                    if (!guild) {
                        console.log(`Guild ${guildId} not found, skipping recovery.`);
                        continue;
                    }

                    const channel = await guild.channels.fetch(channelId).catch(() => null);
                    if (!channel) {
                        console.log(`Channel ${channelId} in guild ${guildId} not found, skipping recovery.`);
                        continue;
                    }

                    // Calculate time elapsed since last update
                    const timeElapsed = Math.floor((Date.now() - data.lastUpdate) / 1000);
                    const newTimeSinceCrash = data.timeSinceLastCrash + timeElapsed;
                    
                    console.log(`Recovering tracker in guild ${guildId}, channel ${channelId}`);
                    console.log(`Time elapsed while offline: ${formatTime(timeElapsed)}`);
                    console.log(`New total time: ${formatTime(newTimeSinceCrash)}`);

                    const message = await channel.messages.fetch(data.messageId).catch(() => null);
                    
                    if (message) {
                        console.log(`Recovering existing message...`);
                        // Set initial status based on configuration validation
                        const initialStatus = misconfigured.length > 0 ? TRACKER_STATUS.MISCONFIGURED : TRACKER_STATUS.ACTIVE;
                        await client.startTracker(channel, message, newTimeSinceCrash, data.lastCrashBy, initialStatus);
                    } else {
                        console.log(`Creating new tracker message...`);
                        const initialStatus = misconfigured.length > 0 ? TRACKER_STATUS.MISCONFIGURED : TRACKER_STATUS.ACTIVE;
                        await client.startTracker(channel, null, newTimeSinceCrash, data.lastCrashBy, initialStatus);
                    }
                } catch (error) {
                    console.error(`Error recovering tracker in guild ${guildId}, channel ${channelId}:`, error.message);
                }
            }
        }
    } else {
        console.log('No existing trackers found in database.');
    }

    // Now that trackers are recovered, perform migration if needed
    if (config.database.type === 'sqlite') {
        await migrateToSqlite();
    }
});

// Handle new guild joins
client.on('guildCreate', async (guild) => {
    console.log(`Joined new guild: ${guild.name} (${guild.id})`);
    await registerSlashCommands(guild.id);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // Only log if it's a specific bot command
    if (message.content === `${config.prefix}startTracker` || 
        message.content === `${config.prefix}stopTracker`) {
        console.log(`Command received: ${message.content}`);
    }
    
    if (message.content === `${config.prefix}startTracker`) {
        if (client.activeTrackers.has(message.guild.id) && 
            client.activeTrackers.get(message.guild.id).has(message.channel.id)) {
            message.reply('A tracker is already running in this channel. Use `!stopTracker` to stop it first.');
            return;
        }
        console.log('Starting Minicopter crash tracker...');
        const success = await client.startTracker(message.channel);
        if (!success) {
            message.reply('Failed to start the tracker. Please try again later.');
        }
    } else if (message.content === `${config.prefix}stopTracker`) {
        console.log('Attempting to stop tracker...');
        try {
            const success = await client.stopTracker(message.guild.id, message.channel.id);
            console.log('stopTracker result:', success);
            if (success) {
                message.reply('Tracker stopped successfully.');
            } else {
                message.reply('No active tracker found in this channel.');
            }
        } catch (error) {
            console.error('Error stopping tracker:', error);
            message.reply('Failed to stop the tracker. Please try again later.');
        }
    }
});

// Add slash command handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'starttracker':
                await slashCommands.startTracker(interaction);
                break;
            case 'stoptracker':
                await slashCommands.stopTracker(interaction);
                break;
            case 'startfromtime':
                await slashCommands.startFromTime(interaction);
                break;
        }
    } catch (error) {
        console.error('Error handling slash command:', error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// Handle connection errors
client.on('error', error => {
    console.error('Discord client error:', error.message);
});

// Function to update all trackers to offline status
async function updateAllTrackersToOffline(reason = 'Bot is offline') {
    console.log('Updating all trackers to offline status...');
    
    for (const [guildId, guildTrackers] of client.activeTrackers) {
        for (const [channelId, tracker] of guildTrackers) {
            try {
                const message = tracker.message;
                if (message && message.embeds[0]) {
                    const currentTime = message.embeds[0].description.split('```ansi\n')[1].split('```')[0];
                    const lastCrashByField = message.embeds[0].fields.find(f => f.name === '👤 Last Crash Reporter');
                    const lastCrashBy = lastCrashByField ? lastCrashByField.value.replace(/```/g, '') : null;
                    const totalCrashesField = message.embeds[0].fields.find(f => f.name === '💥 Total Crashes');
                    const totalCrashes = totalCrashesField ? parseInt(totalCrashesField.value.replace(/```/g, '')) : 0;
                    
                    const offlineEmbed = new EmbedBuilder()
                        .setColor(getStatusColor(TRACKER_STATUS.OFFLINE))
                        .setTitle('🛩️ Minicopter Crash Tracker')
                        .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${currentTime}\`\`\``)
                        .addFields(
                            { name: '📊 Status', value: `\`\`\`${TRACKER_STATUS.OFFLINE}\`\`\``, inline: true },
                            { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                            { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true },
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
                }
            } catch (error) {
                console.error(`Error updating tracker in guild ${guildId}, channel ${channelId}:`, error.message);
            }
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nGracefully shutting down...');
    await updateAllTrackersToOffline('Bot is shutting down');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM signal');
    await updateAllTrackersToOffline('Bot is shutting down');
    process.exit(0);
});

// Update the disconnect handler to use db.saveTracker
client.on('disconnect', async () => {
    console.log('Bot disconnected from Discord');
    await updateAllTrackersToOffline('Bot is offline');
    
    // Save current state before disconnect
    client.activeTrackers.forEach((guildTrackers, guildId) => {
        guildTrackers.forEach((tracker, channelId) => {
            const message = tracker.message;
            if (message && message.embeds[0]) {
                const timeSinceLastCrash = parseInt(message.embeds[0].description.split('```ansi\n')[1].split('```')[0]);
                const lastCrashBy = message.embeds[0].fields.find(f => f.name === '👤 Last Crash Reporter')?.value;
                const totalCrashesField = message.embeds[0].fields.find(f => f.name === '💥 Total Crashes');
                const totalCrashes = totalCrashesField ? parseInt(totalCrashesField.value.replace(/```/g, '')) : 0;
                
                db.saveTracker(guildId, channelId, {
                    messageId: message.id,
                    timeSinceLastCrash,
                    lastCrashBy,
                    lastUpdate: Date.now(),
                    status: TRACKER_STATUS.OFFLINE,
                    version: VERSION,
                    totalCrashes
                });
            }
        });
    });
});

client.on('reconnecting', () => {
    console.log('Bot is reconnecting to Discord...');
});

// Helper function to get status color
function getStatusColor(status) {
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

// Helper function to get status footer
function getStatusFooter(status) {
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

// Update the getDebugInfo function to accept retryCount and maxRetries
function getDebugInfo(retryCount, maxRetries) {
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

// Update the createErrorEmbed function to accept maxRetries
function createErrorEmbed(error, timeSinceLastCrash, retryCount, maxRetries) {
    const errorType = error.name || 'Unknown Error';
    return new EmbedBuilder()
        .setColor('#ed4245')
        .setTitle('⚠️ Tracker Error')
        .setDescription(`**Connection Error**\n\nLast known time:\n\`\`\`ansi\n${formatTime(timeSinceLastCrash)}\`\`\``)
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

client.login(config.token);
