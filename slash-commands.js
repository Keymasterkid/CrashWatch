const { SlashCommandBuilder } = require('discord.js');
const { format, parse, addDays, subDays } = require('date-fns');

// Common timezones for users to choose from
const TIMEZONES = [
    { name: 'Pacific Time (PT)', value: 'America/Los_Angeles' },
    { name: 'Mountain Time (MT)', value: 'America/Denver' },
    { name: 'Central Time (CT)', value: 'America/Chicago' },
    { name: 'Eastern Time (ET)', value: 'America/New_York' },
    { name: 'Atlantic Time (AT)', value: 'America/Halifax' },
    { name: 'Greenwich Mean Time (GMT)', value: 'UTC' },
    { name: 'Central European Time (CET)', value: 'Europe/Paris' },
    { name: 'Eastern European Time (EET)', value: 'Europe/Athens' },
    { name: 'Australian Eastern Time (AET)', value: 'Australia/Sydney' },
    { name: 'Japan Standard Time (JST)', value: 'Asia/Tokyo' }
];

// Required permissions for the bot
const REQUIRED_PERMISSIONS = [
    'SendMessages',
    'ReadMessageHistory',
    'AddReactions',
    'UseExternalEmojis',
    'EmbedLinks',
    'AttachFiles',
    'ViewChannel',
    'ManageMessages'  // Added for message deletion
];

// Helper function to check permissions
async function checkPermissions(interaction) {
    const missingPermissions = REQUIRED_PERMISSIONS.filter(
        permission => !interaction.channel.permissionsFor(interaction.client.user).has(permission)
    );

    if (missingPermissions.length > 0) {
        await interaction.reply({
            content: `❌ I'm missing the following permissions in this channel: ${missingPermissions.join(', ')}. Please grant these permissions and try again.`,
            ephemeral: true
        });
        return false;
    }
    return true;
}

// Helper function to validate timezone
function isValidTimezone(timezone) {
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
    } catch (error) {
        return false;
    }
}

// Helper function to validate date
function isValidDate(date) {
    return date instanceof Date && !isNaN(date) && date.getTime() > 0;
}

// Helper function to validate time
function isValidTime(hours, minutes) {
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

const commands = [
    new SlashCommandBuilder()
        .setName('starttracker')
        .setDescription('Start the Minicopter crash tracker in the current channel'),

    new SlashCommandBuilder()
        .setName('stoptracker')
        .setDescription('Stop the Minicopter crash tracker in the current channel'),

    new SlashCommandBuilder()
        .setName('startfromtime')
        .setDescription('Start the tracker from a specific time')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Time in 12-hour format (e.g., 2:30pm, 11:45am)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('timezone')
                .setDescription('Your timezone')
                .setRequired(true)
                .addChoices(...TIMEZONES))
        .addStringOption(option =>
            option.setName('date')
                .setDescription('Optional date in MM/DD format (e.g., 5/7 for May 7th)')
                .setRequired(false)),
].map(command => command.toJSON());

module.exports = {
    commands,
    // Command handlers
    async startTracker(interaction) {
        try {
            // Check permissions
            if (!await checkPermissions(interaction)) return;

            // Check if tracker is already running in this channel
            if (interaction.client.trackerManager.activeTrackers.has(interaction.guildId) &&
                interaction.client.trackerManager.activeTrackers.get(interaction.guildId).has(interaction.channelId)) {
                return await interaction.reply({
                    content: '❌ A tracker is already running in this channel!',
                    ephemeral: true
                });
            }

            await interaction.reply('Starting Minicopter crash tracker...');
            const success = await interaction.client.trackerManager.startTracker(interaction.channel);
            if (!success) {
                await interaction.followUp('Failed to start the tracker. Please try again later.');
            }
        } catch (error) {
            console.error('Error starting tracker:', error);
            await interaction.reply({
                content: '❌ An error occurred while starting the tracker. Please try again.',
                ephemeral: true
            });
        }
    },

    async stopTracker(interaction) {
        try {
            // Check permissions
            if (!await checkPermissions(interaction)) return;

            // Defer the reply since stopping might take a moment
            await interaction.deferReply();

            const success = await interaction.client.trackerManager.stopTracker(interaction.guildId, interaction.channelId);
            if (success) {
                await interaction.editReply('Tracker stopped successfully.');
            } else {
                await interaction.editReply({
                    content: '❌ No active tracker found in this channel.',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error stopping tracker:', error);
            await interaction.editReply({
                content: '❌ An error occurred while stopping the tracker. Please try again.',
                ephemeral: true
            });
        }
    },

    async startFromTime(interaction) {
        try {
            // Check permissions
            if (!await checkPermissions(interaction)) return;

            const guildId = interaction.guildId;
            const channelId = interaction.channelId;

            // Check rate limit
            if (!interaction.client.trackerManager.checkRateLimit(interaction.user.id, 'startFromTime', 1, 5000)) {
                return await interaction.reply({
                    content: '❌ Please wait a moment before using this command again.',
                    ephemeral: true
                });
            }

            if (interaction.client.trackerManager.activeTrackers.has(guildId) &&
                interaction.client.trackerManager.activeTrackers.get(guildId).has(channelId)) {
                return await interaction.reply({
                    content: '❌ A tracker is already running in this channel. Use `/stoptracker` to stop it first.',
                    ephemeral: true
                });
            }

            const timeStr = interaction.options.getString('time');
            const dateStr = interaction.options.getString('date');
            const timezone = interaction.options.getString('timezone');

            // Validate timezone
            if (!isValidTimezone(timezone)) {
                return await interaction.reply({
                    content: '❌ Invalid timezone provided. Please select a valid timezone from the list.',
                    ephemeral: true
                });
            }

            const timeRegex = /^(\d{1,2}):(\d{2})([ap]m)$/i;
            const match = timeStr.match(timeRegex);

            if (!match) {
                return await interaction.reply({
                    content: '❌ Invalid time format. Please use format like "2:30pm" or "11:45am".',
                    ephemeral: true
                });
            }

            let [_, hours, minutes, meridiem] = match;
            hours = parseInt(hours);
            minutes = parseInt(minutes);

            // Validate hours and minutes
            if (!isValidTime(hours, minutes)) {
                return await interaction.reply({
                    content: '❌ Invalid time values. Hours must be 1-12 and minutes must be 0-59.',
                    ephemeral: true
                });
            }

            // Convert to 24-hour format
            if (meridiem.toLowerCase() === 'pm' && hours !== 12) {
                hours += 12;
            } else if (meridiem.toLowerCase() === 'am' && hours === 12) {
                hours = 0;
            }

            // Create a date object
            const now = new Date();
            let targetDate;

            if (dateStr) {
                // Parse the date string (MM/DD format)
                const [month, day] = dateStr.split('/').map(num => parseInt(num));
                if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
                    return await interaction.reply({
                        content: '❌ Invalid date format. Please use MM/DD format (e.g., 5/7 for May 7th).',
                        ephemeral: true
                    });
                }
                targetDate = new Date(now.getFullYear(), month - 1, day, hours, minutes, 0, 0);
            } else {
                // Use today's date
                targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
            }

            // Validate the final date
            if (!isValidDate(targetDate)) {
                return await interaction.reply({
                    content: '❌ Invalid date/time combination. Please check your input.',
                    ephemeral: true
                });
            }

            // Check if date is in the future
            if (targetDate > now) {
                return await interaction.reply({
                    content: '❌ Cannot start tracker from a future time. Please provide a past time.',
                    ephemeral: true
                });
            }

            // Check if date is too old (e.g., more than 30 days)
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
            if (targetDate < thirtyDaysAgo) {
                return await interaction.reply({
                    content: '❌ Cannot start tracker from more than 30 days ago. Please provide a more recent time.',
                    ephemeral: true
                });
            }

            const timeSinceCrash = Math.floor((now - targetDate) / 1000);

            // Format the time and date for display
            const formattedDate = format(targetDate, 'MM/dd');
            const formattedTime = format(targetDate, 'h:mm a');

            await interaction.reply(`Starting Minicopter crash tracker from ${formattedTime} ${formattedDate} ${timezone}...`);
            const success = await interaction.client.trackerManager.startTracker(interaction.channel, null, timeSinceCrash);
            if (!success) {
                await interaction.followUp('Failed to start the tracker. Please try again later.');
            }
        } catch (error) {
            console.error('Error starting tracker from time:', error);
            await interaction.reply({
                content: '❌ An error occurred while starting the tracker. Please try again.',
                ephemeral: true
            });
        }
    }
}; 