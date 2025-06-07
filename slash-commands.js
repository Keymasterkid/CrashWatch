const { SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('starttracker')
        .setDescription('Start the Minicopter crash tracker in the current channel'),
    
    new SlashCommandBuilder()
        .setName('stoptracker')
        .setDescription('Stop the Minicopter crash tracker in the current channel'),
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
    }
}; 