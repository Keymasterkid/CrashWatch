const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config.js');
const slashCommands = require('./slash-commands.js');

// Bot version
const VERSION = '1.0.0';

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ]
});

// File to store crash data
const CRASH_DATA_FILE = 'crash_data.json';

// Track active trackers
// Structure: Map<guildId, Map<channelId, tracker>>
client.activeTrackers = new Map();

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

async function saveCrashData(data) {
    try {
        // Create a backup of the current data before saving
        try {
            const currentData = await fs.readFile(CRASH_DATA_FILE, 'utf8');
            await fs.writeFile(CRASH_DATA_FILE + '.backup', currentData);
        } catch (error) {
            // Ignore if backup fails
        }

        // Save the new data
        await fs.writeFile(CRASH_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving crash data:', error.message);
        // Try to restore from backup if save fails
        try {
            const backupData = await fs.readFile(CRASH_DATA_FILE + '.backup', 'utf8');
            await fs.writeFile(CRASH_DATA_FILE, backupData);
        } catch (backupError) {
            console.error('Error restoring from backup:', backupError.message);
        }
    }
}

async function loadCrashData() {
    try {
        const data = await fs.readFile(CRASH_DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If main file fails, try backup
        try {
            const backupData = await fs.readFile(CRASH_DATA_FILE + '.backup', 'utf8');
            console.log('Recovered data from backup file');
            return JSON.parse(backupData);
        } catch (backupError) {
            console.error('Error loading crash data:', error.message);
            return null;
        }
    }
}

async function clearCrashData() {
    try {
        await fs.unlink(CRASH_DATA_FILE);
    } catch (error) {
        // Ignore error if file doesn't exist
        if (error.code !== 'ENOENT') {
            console.error('Error clearing crash data:', error.message);
        }
    }
}

// Move startTracker to be a client method
client.startTracker = function(channel, existingMessage = null, initialTime = 0, initialLastCrashBy = null) {
    const guildId = channel.guild.id;
    const channelId = channel.id;

    // Initialize guild map if it doesn't exist
    if (!this.activeTrackers.has(guildId)) {
        this.activeTrackers.set(guildId, new Map());
    }

    // Check if there's already a tracker in this channel
    if (this.activeTrackers.get(guildId).has(channelId)) {
        return false;
    }

    let timeSinceLastCrash = initialTime;
    let lastCrashBy = initialLastCrashBy;
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
                    { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true }
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

            await message.edit({ embeds: [embed] });
            retryCount = 0;
            
            // Save current state
            const crashData = await loadCrashData() || {};
            if (!crashData[guildId]) {
                crashData[guildId] = {};
            }
            crashData[guildId][channelId] = {
                messageId: message.id,
                timeSinceLastCrash,
                lastCrashBy,
                lastUpdate: Date.now(),
                status: 'Active',
                version: VERSION
            };
            await saveCrashData(crashData);
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
                await updateMessage(trackerMsg);
            } else {
                const initialEmbed = new EmbedBuilder()
                    .setColor('#2b2d31')
                    .setTitle('🛩️ Minicopter Crash Tracker')
                    .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${formatTime(timeSinceLastCrash)}\`\`\``)
                    .addFields(
                        { name: '📊 Status', value: '```Active```', inline: true },
                        { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true }
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
    const guildTrackers = this.activeTrackers.get(guildId);
    if (!guildTrackers) return false;

    const tracker = guildTrackers.get(channelId);
    if (tracker) {
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

        // Update crash data
        try {
            const crashData = await loadCrashData();
            if (crashData && crashData[guildId]) {
                delete crashData[guildId][channelId];
                if (Object.keys(crashData[guildId]).length === 0) {
                    delete crashData[guildId];
                }
                await saveCrashData(crashData);
            }
        } catch (error) {
            console.error('Error updating crash data:', error.message);
        }

        return true;
    }
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

client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`Using prefix: ${config.prefix}`);
    console.log(`Tracker settings: Updates every ${config.tracker.updateInterval/1000} seconds, increments by ${config.tracker.incrementAmount} seconds`);

    // Register commands for all current guilds
    await registerSlashCommands();

    // Try to recover any existing crash data
    const crashData = await loadCrashData();
    if (crashData) {
        console.log('Found existing crash data, attempting recovery...');
        
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
                        client.startTracker(channel, message, newTimeSinceCrash, data.lastCrashBy);
                    } else {
                        console.log(`Creating new tracker message...`);
                        client.startTracker(channel, null, newTimeSinceCrash, data.lastCrashBy);
                    }
                } catch (error) {
                    console.error(`Error recovering tracker in guild ${guildId}, channel ${channelId}:`, error.message);
                }
            }
        }
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
        if (client.stopTracker(message.guild.id, message.channel.id)) {
            message.reply('Tracker stopped successfully.');
        } else {
            message.reply('No active tracker found in this channel.');
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
                    
                    const offlineEmbed = new EmbedBuilder()
                        .setColor('#747f8d')  // Discord offline gray
                        .setTitle('🛩️ Minicopter Crash Tracker')
                        .setDescription(`**Time since last crash:**\n\`\`\`ansi\n${currentTime}\`\`\``)
                        .addFields(
                            { name: '📊 Status', value: '```Offline```', inline: true },
                            { name: '⏰ Last Update', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                            { name: '📦 Version', value: `\`\`\`${VERSION}\`\`\``, inline: true }
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

// Handle disconnects
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
                
                loadCrashData().then(crashData => {
                    if (!crashData[guildId]) crashData[guildId] = {};
                    crashData[guildId][channelId] = {
                        messageId: message.id,
                        timeSinceLastCrash,
                        lastCrashBy,
                        lastUpdate: Date.now()
                    };
                    saveCrashData(crashData);
                });
            }
        });
    });
});

client.on('reconnecting', () => {
    console.log('Bot is reconnecting to Discord...');
});

client.login(config.token);
