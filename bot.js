const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config.js');
const slashCommands = require('./slash-commands.js');

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
        await fs.writeFile(CRASH_DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving crash data:', error.message);
    }
}

async function loadCrashData() {
    try {
        const data = await fs.readFile(CRASH_DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading crash data:', error.message);
        return null;
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
    let timeSinceLastCrash = initialTime;
    let lastCrashBy = initialLastCrashBy;
    let retryCount = 0;
    const maxRetries = 3;
    let interval;
    
    const updateMessage = async (message) => {
        try {
            const messageContent = lastCrashBy 
                ? `🛩️ Minicopter Crash Tracker\nTime since last crash: ${formatTime(timeSinceLastCrash)}\nLast crash reported by: ${lastCrashBy}`
                : `🛩️ Minicopter Crash Tracker\nTime since last crash: ${formatTime(timeSinceLastCrash)}`;
            await message.edit(messageContent);
            retryCount = 0;
            
            // Save current state
            await saveCrashData({
                channelId: channel.id,
                messageId: message.id,
                timeSinceLastCrash,
                lastCrashBy,
                lastUpdate: Date.now()
            });
        } catch (error) {
            console.error('Error updating tracker:', error.message);
            retryCount++;
            
            if (retryCount >= maxRetries) {
                console.error('Max retries reached, stopping tracker');
                this.stopTracker(channel.id);
                try {
                    await message.edit(`🛩️ Minicopter Crash Tracker\nTracker stopped due to connection issues.\nLast known time: ${formatTime(timeSinceLastCrash)}`);
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
                trackerMsg = await channel.send(`🛩️ Minicopter Crash Tracker\nTime since last crash: ${formatTime(timeSinceLastCrash)}`);
                await trackerMsg.react('🔄');
            }

            interval = setInterval(async () => {
                timeSinceLastCrash += config.tracker.incrementAmount;
                await updateMessage(trackerMsg);
            }, config.tracker.updateInterval);

            const filter = (reaction, user) => reaction.emoji.name === '🔄' && !user.bot;
            const collector = trackerMsg.createReactionCollector({ filter });

            collector.on('collect', async (reaction, user) => {
                console.log(`Crash reported by ${user.tag}`);
                timeSinceLastCrash = 0;
                lastCrashBy = user.tag;
                try {
                    await updateMessage(trackerMsg);
                    await reaction.users.remove(user.id);
                } catch (error) {
                    console.error('Error updating crash report:', error.message);
                }
            });

            collector.on('end', () => {
                clearInterval(interval);
                this.activeTrackers.delete(channel.id);
            });

            // Store the tracker info
            this.activeTrackers.set(channel.id, {
                message: trackerMsg,
                interval,
                collector
            });

        } catch (error) {
            console.error('Error starting tracker:', error.message);
            channel.send('Failed to start Minicopter crash tracker. Please try again later.');
        }
    };

    startTracking();
};

// Move stopTracker to be a client method
client.stopTracker = function(channelId) {
    const tracker = this.activeTrackers.get(channelId);
    if (tracker) {
        clearInterval(tracker.interval);
        tracker.collector.stop();
        this.activeTrackers.delete(channelId);
        // Clear the crash data when stopping the tracker
        clearCrashData();
        return true;
    }
    return false;
};

client.once('ready', async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`Using prefix: ${config.prefix}`);
    console.log(`Tracker settings: Updates every ${config.tracker.updateInterval/1000} seconds, increments by ${config.tracker.incrementAmount} seconds`);

    // Register slash commands
    try {
        const rest = new REST({ version: '10' }).setToken(config.token);
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: slashCommands.commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }

    // Try to recover any existing crash data
    const crashData = await loadCrashData();
    if (crashData) {
        console.log('Found existing crash data, attempting recovery...');
        try {
            const channel = await client.channels.fetch(crashData.channelId);
            if (channel) {
                const message = await channel.messages.fetch(crashData.messageId);
                if (message) {
                    console.log('Recovering crash tracker...');
                    client.startTracker(channel, message, crashData.timeSinceLastCrash, crashData.lastCrashBy);
                }
            }
        } catch (error) {
            console.error('Error recovering crash tracker:', error.message);
        }
    }
});

client.on('messageCreate', async (message) => {
    console.log(`Received message: ${message.content}`);
    
    if (message.content === `${config.prefix}startTracker`) {
        if (client.activeTrackers.has(message.channel.id)) {
            message.reply('A tracker is already running in this channel. Use `!stopTracker` to stop it first.');
            return;
        }
        console.log('Starting Minicopter crash tracker...');
        client.startTracker(message.channel);
    } else if (message.content === `${config.prefix}stopTracker`) {
        if (client.stopTracker(message.channel.id)) {
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

client.on('disconnect', () => {
    console.log('Bot disconnected from Discord');
});

client.on('reconnecting', () => {
    console.log('Bot is reconnecting to Discord...');
});

client.login(config.token);
