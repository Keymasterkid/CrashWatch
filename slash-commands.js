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
                .addChoices(...TIMEZONES)),
].map(command => command.toJSON());

module.exports = {
    commands,
    // Command handlers
    async startTracker(interaction) {
        if (interaction.client.activeTrackers.has(interaction.channelId)) {
            await interaction.reply('A tracker is already running in this channel. Use `/stoptracker` to stop it first.');
            return;
        }
        await interaction.reply('Starting Minicopter crash tracker...');
        interaction.client.startTracker(interaction.channel);
    },

    async stopTracker(interaction) {
        if (interaction.client.stopTracker(interaction.channelId)) {
            await interaction.reply('Tracker stopped successfully.');
        } else {
            await interaction.reply('No active tracker found in this channel.');
        }
    },

    async startFromTime(interaction) {
        if (interaction.client.activeTrackers.has(interaction.channelId)) {
            await interaction.reply('A tracker is already running in this channel. Use `/stoptracker` to stop it first.');
            return;
        }

        const timeStr = interaction.options.getString('time');
        const timezone = interaction.options.getString('timezone');
        const timeRegex = /^(\d{1,2}):(\d{2})([ap]m)$/i;
        const match = timeStr.match(timeRegex);

        if (!match) {
            await interaction.reply('Invalid time format. Please use format like "2:30pm" or "11:45am".');
            return;
        }

        let [_, hours, minutes, meridiem] = match;
        hours = parseInt(hours);
        minutes = parseInt(minutes);

        // Convert to 24-hour format
        if (meridiem.toLowerCase() === 'pm' && hours !== 12) {
            hours += 12;
        } else if (meridiem.toLowerCase() === 'am' && hours === 12) {
            hours = 0;
        }

        // Create a date object for today with the specified time
        const now = new Date();
        const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

        // If the target time is in the future, assume it's for yesterday
        if (targetDate > now) {
            targetDate.setDate(targetDate.getDate() - 1);
        }

        const timeSinceCrash = Math.floor((now - targetDate) / 1000);
        
        // Format the time for display
        const formattedTime = format(targetDate, 'h:mm a');

        await interaction.reply(`Starting Minicopter crash tracker from ${formattedTime} ${timezone}...`);
        interaction.client.startTracker(interaction.channel, null, timeSinceCrash);
    }
}; 