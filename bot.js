const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, Collection } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config.js');
const slashCommands = require('./slash-commands.js');
const db = require('./database.js');

// Bot version
const VERSION = '1.0.2';

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
    const migrationEmbed = new EmbedBuilder()
        .setColor('#2b2d31')
        .setTitle('🔄 Database Migration Started')
        .setDescription('The tracker is being migrated from JSON to SQLite database for better performance and reliability.')
        .addFields(
            { name: '📊 Status', value: '```Migrating```', inline: true },
            { name: '⏰ Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
            { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true }
        )
        .setFooter({ 
            text: 'Migration in progress...', 
            iconURL: 'https://i.imgur.com/AfFp7pu.png'
        })
        .setTimestamp();

    // Send migration start message to all active trackers
    const migrationMessages = [];
    let messageSent = false;

    for (const [guildId, guildTrackers] of client.activeTrackers) {
        for (const [channelId, tracker] of guildTrackers) {
            try {
                const message = tracker.message;
                if (message) {
                    console.log(`Sending migration message to guild ${guildId}, channel ${channelId}`);
                    const migrationMsg = await message.channel.send({ embeds: [migrationEmbed] });
                    migrationMessages.push(migrationMsg);
                    messageSent = true;
                }
            } catch (error) {
                console.error(`Error sending migration message in guild ${guildId}, channel ${channelId}:`, error.message);
            }
        }
    }

    if (!messageSent) {
        console.log('No active trackers found to send migration messages to');
    }

    try {
        const success = await db.migrateFromJsonToSqlite();
        
        if (success) {
            console.log('Migration completed successfully!');
            
            // Update all migration messages with success status
            const successEmbed = new EmbedBuilder()
                .setColor('#57F287')  // Discord success green
                .setTitle('✅ Database Migration Complete')
                .setDescription('The tracker has been successfully migrated to SQLite database.')
                .addFields(
                    { name: '📊 Status', value: '```Completed```', inline: true },
                    { name: '⏰ Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true }
                )
                .setFooter({ 
                    text: 'Migration completed successfully', 
                    iconURL: 'https://i.imgur.com/AfFp7pu.png'
                })
                .setTimestamp();

            for (const message of migrationMessages) {
                try {
                    await message.edit({ embeds: [successEmbed] });
                } catch (error) {
                    console.error('Error updating migration success message:', error.message);
                }
            }
        } else {
            throw new Error('Migration failed');
        }
    } catch (error) {
        console.error('Migration failed:', error);
        
        // Update all migration messages with error status
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

        for (const message of migrationMessages) {
            try {
                await message.edit({ embeds: [errorEmbed] });
            } catch (editError) {
                console.error('Error updating migration error message:', editError.message);
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

// Update the startTracker method
client.startTracker = async function(channel, existingMessage = null, initialTime = 0, initialLastCrashBy = null) {
    const guildId = channel.guild.id;
    const channelId = channel.id;

    // Check rate limit
    if (!checkRateLimit(channelId, 'startTracker', 1, 5000)) {
        throw new Error('Please wait a moment before starting another tracker.');
    }

    // Initialize guild map if it doesn't exist
    if (!this.activeTrackers.has(guildId)) {
        this.activeTrackers.set(guildId, new Map());
    }

    // Check if there's already a tracker in this channel
    if (this.activeTrackers.get(guildId).has(channelId)) {
        console.log(`Tracker already exists in guild ${guildId}, channel ${channelId}`);
        return false;
    }

    // Check if there's an existing tracker in the database
    try {
        const existingTracker = await db.loadTracker(guildId, channelId);
        if (existingTracker && !existingMessage) {
            console.log(`Found existing tracker in database for guild ${guildId}, channel ${channelId}`);
            // Delete the old tracker from database since we're starting a new one
            await db.deleteTracker(guildId, channelId);
        }
    } catch (error) {
        console.error('Error checking existing tracker:', error.message);
    }

    let timeSinceLastCrash = initialTime;
    let lastCrashBy = initialLastCrashBy;
    let totalCrashes = 0;
    let retryCount = 0;
    const maxRetries = 3;
    let interval;
    let collector;
    
    const updateMessage = async (message) => {
        try {
            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🛩️ Minicopter Crash Tracker')
                .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${formatTime(timeSinceLastCrash)}\`\`\``)
                .addFields(
                    { name: '📊 Status', value: '```Active```', inline: true },
                    { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                    { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true },
                    { name: '💥 Total Crashes', value: `\`\`\`${totalCrashes}\`\`\``, inline: true }
                )
                .setFooter({ 
                    text: 'Click 🔄 to report a crash', 
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

            // Add rate limit handling for message edits
            if (!checkRateLimit(message.id, 'editMessage', 2, 5000)) {
                console.log('Rate limit reached for message edits, skipping update');
                return;
            }

            await message.edit({ embeds: [embed] });
            retryCount = 0;
            
            // Save current state using database manager
            await db.saveTracker(guildId, channelId, {
                messageId: message.id,
                timeSinceLastCrash,
                lastCrashBy,
                lastUpdate: Date.now(),
                status: 'Active',
                version: VERSION,
                totalCrashes
            });
        } catch (error) {
            console.error('Error updating tracker:', error.message);
            retryCount++;
            
            if (retryCount >= maxRetries) {
                console.error('Max retries reached, stopping tracker');
                await this.stopTracker(guildId, channelId);
                try {
                    const errorType = error.name || 'Unknown Error';
                    const errorEmbed = new EmbedBuilder()
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
                    await message.edit({ embeds: [errorEmbed] });
                } catch (e) {
                    console.error('Could not send final message:', e.message);
                }
            }
        }
    };

    const startTracking = async () => {
        try {
            let trackerMsg;
            if (existingMessage) {
                trackerMsg = existingMessage;
                // Load total crashes from saved data
                const crashData = await loadCrashData();
                if (crashData && crashData[guildId] && crashData[guildId][channelId]) {
                    totalCrashes = crashData[guildId][channelId].totalCrashes || 0;
                }
                await updateMessage(trackerMsg);
            } else {
                const initialEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('🛩️ Minicopter Crash Tracker')
                    .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${formatTime(timeSinceLastCrash)}\`\`\``)
                    .addFields(
                        { name: '📊 Status', value: '```Active```', inline: true },
                        { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true },
                        { name: '💥 Total Crashes', value: `\`\`\`${totalCrashes}\`\`\``, inline: true }
                    )
                    .setFooter({ 
                        text: 'Click 🔄 to report a crash', 
                        iconURL: 'https://i.imgur.com/AfFp7pu.png'
                    })
                    .setTimestamp();

                trackerMsg = await channel.send({ embeds: [initialEmbed] });
                await trackerMsg.react('🔄');
            }

            interval = setInterval(async () => {
                timeSinceLastCrash += config.tracker.incrementAmount;
                await updateMessage(trackerMsg);
            }, config.tracker.updateInterval);

            const filter = (reaction, user) => reaction.emoji.name === '🔄' && !user.bot;
            collector = trackerMsg.createReactionCollector({ filter });

            collector.on('collect', async (reaction, user) => {
                console.log(`Crash reported by ${user.tag}`);
                timeSinceLastCrash = 0;
                lastCrashBy = user.tag;
                totalCrashes++;  // Increment total crashes
                try {
                    await updateMessage(trackerMsg);
                    // Check if bot has permission to remove reactions
                    if (channel.permissionsFor(this.user).has('ManageMessages')) {
                        await reaction.users.remove(user.id);
                    }
                } catch (error) {
                    console.error('Error updating crash report:', error.message);
                }
            });

            collector.on('end', () => {
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
                collector
            });

            return true;
        } catch (error) {
            console.error('Error starting tracker:', error.message);
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
                    .spliceFields(0, 1, { name: '📊 Status', value: '```Inactive```', inline: true })
                    .setFooter({ 
                        text: 'Tracker is stopped', 
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

// Update client.once('ready') to handle migration
client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`Using prefix: ${config.prefix}`);
    console.log(`Tracker settings: Updates every ${config.tracker.updateInterval/1000} seconds, increments by ${config.tracker.incrementAmount} seconds`);
    console.log(`Database type: ${config.database.type}`);

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
                        await client.startTracker(channel, message, newTimeSinceCrash, data.lastCrashBy);
                    } else {
                        console.log(`Creating new tracker message...`);
                        await client.startTracker(channel, null, newTimeSinceCrash, data.lastCrashBy);
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
                        .setColor('#747f8d')  // Discord offline gray
                        .setTitle('🛩️ Minicopter Crash Tracker')
                        .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${currentTime}\`\`\``)
                        .addFields(
                            { name: '📊 Status', value: '```Offline```', inline: true },
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
                    status: 'Offline',
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

client.login(config.token);
