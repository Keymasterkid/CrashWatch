const { Client, GatewayIntentBits, REST, Routes, Events } = require('discord.js');
const db = require('./database.js');
const config = require('./config.js');
const slashCommands = require('./slash-commands.js');
const TrackerManager = require('./TrackerManager.js');

// Bot version
const VERSION = '1.0.5';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ]
});

// Initialize TrackerManager
client.trackerManager = new TrackerManager(client);

// Default configuration
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

// Configuration validation
function validateConfig(userConfig) {
    const validatedConfig = { ...DEFAULT_CONFIG };
    const missingRequired = [];
    const misconfigured = [];

    // Check required fields
    if (!userConfig.token) missingRequired.push('token');
    if (!userConfig.clientId) missingRequired.push('clientId');

    // Validate debug settings
    if (!userConfig.debug) {
        misconfigured.push('debug (using defaults)');
    } else {
        validatedConfig.debug = { ...DEFAULT_CONFIG.debug, ...userConfig.debug };
        if (!['debug', 'info', 'warn', 'error'].includes(validatedConfig.debug.logLevel)) {
            misconfigured.push('debug.logLevel');
            validatedConfig.debug.logLevel = DEFAULT_CONFIG.debug.logLevel;
        }
    }

    // Validate tracker settings
    if (!userConfig.tracker) {
        missingRequired.push('tracker');
    } else {
        validatedConfig.tracker = { ...DEFAULT_CONFIG.tracker, ...userConfig.tracker };
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
        validatedConfig.database = { ...DEFAULT_CONFIG.database, ...userConfig.database };
        if (!['json', 'sqlite'].includes(validatedConfig.database.type)) {
            misconfigured.push('database.type');
            validatedConfig.database.type = DEFAULT_CONFIG.database.type;
        }
    }

    if (userConfig.prefix) validatedConfig.prefix = userConfig.prefix;

    validatedConfig.token = userConfig.token;
    validatedConfig.clientId = userConfig.clientId;

    return { config: validatedConfig, missingRequired, misconfigured };
}

async function registerSlashCommands(guildId = null, retryCount = 0) {
    const maxRetries = 3;
    try {
        const rest = new REST({ version: '10' }).setToken(config.token);
        console.log('Started refreshing application (/) commands.');

        if (guildId) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: slashCommands.commands },
            );
            console.log(`Successfully registered commands for guild ${guildId}`);
        } else {
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
            await new Promise(resolve => setTimeout(resolve, 5000));
            return registerSlashCommands(guildId, retryCount + 1);
        } else {
            console.error('Max retries reached for command registration');
        }
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);

    // Validate configuration
    const { config: validatedConfig, missingRequired, misconfigured } = validateConfig(config);
    Object.assign(config, validatedConfig);

    if (missingRequired.length > 0) {
        console.error('❌ Missing required configuration:', missingRequired.join(', '));
        process.exit(1);
    }
    if (misconfigured.length > 0) {
        console.warn('⚠️ Misconfigured settings (using defaults):', misconfigured.join(', '));
    }

    console.log(`Using prefix: ${config.prefix}`);
    console.log(`Tracker settings: Updates every ${config.tracker.updateInterval / 1000} seconds, increments by ${config.tracker.incrementAmount} seconds`);
    console.log(`Database type: ${config.database.type}`);
    console.log(`Debug mode: ${config.debug.enabled ? 'Enabled' : 'Disabled'}`);

    await registerSlashCommands();
    await db.initialize();

    // Recovery
    const crashData = await db.loadAllTrackers();
    if (crashData && Object.keys(crashData).length > 0) {
        console.log('Found existing trackers, attempting recovery...');

        for (const [guildId, channels] of Object.entries(crashData)) {
            for (const [channelId, data] of Object.entries(channels)) {
                try {
                    const guild = await client.guilds.fetch(guildId).catch(() => null);
                    if (!guild) continue;
                    const channel = await guild.channels.fetch(channelId).catch(() => null);
                    if (!channel) continue;

                    const timeElapsed = Math.floor((Date.now() - data.lastUpdate) / 1000);
                    const newTimeSinceCrash = data.timeSinceLastCrash + timeElapsed;

                    console.log(`Recovering tracker in guild ${guildId}, channel ${channelId}`);

                    const message = await channel.messages.fetch(data.messageId).catch(() => null);
                    // Pass misconfigured status check logic here if we want strictness, or mostly active.
                    // To keep logic simple:
                    await client.trackerManager.startTracker(
                        channel,
                        message,
                        newTimeSinceCrash,
                        data.lastCrashBy,
                        // If we wanted to pass status we could, but active is fine for recovery
                    );

                } catch (error) {
                    console.error(`Error recovering tracker in guild ${guildId}, channel ${channelId}:`, error.message);
                }
            }
        }
    } else {
        console.log('No existing trackers found in database.');
    }

    if (config.database.type === 'sqlite') {
        const migrated = await db.migrateFromJsonToSqlite();
        if (migrated) console.log('Migration check completed.');
    }
});

client.on('guildCreate', async (guild) => {
    console.log(`Joined new guild: ${guild.name} (${guild.id})`);
    await registerSlashCommands(guild.id);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === `${config.prefix}startTracker` ||
        message.content === `${config.prefix}stopTracker`) {
        console.log(`Command received: ${message.content}`);
    }

    if (message.content === `${config.prefix}startTracker`) {
        console.log('Starting Minicopter crash tracker...');
        const success = await client.trackerManager.startTracker(message.channel);
        if (!success) {
            message.reply('Failed to start the tracker. Please try again later.');
        }
    } else if (message.content === `${config.prefix}stopTracker`) {
        console.log('Attempting to stop tracker...');
        try {
            const success = await client.trackerManager.stopTracker(message.guild.id, message.channel.id);
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
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

client.on('error', error => {
    console.error('Discord client error:', error.message);
});

// Graceful shutdown
const handleShutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await client.trackerManager.updateAllTrackersToOffline('Bot is shutting down');
    process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

client.on('disconnect', async () => {
    console.log('Bot disconnected from Discord');
    await client.trackerManager.updateAllTrackersToOffline('Bot is offline');
});

client.on('reconnecting', () => {
    console.log('Bot is reconnecting to Discord...');
});

client.login(config.token);
