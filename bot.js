const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config.js');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ]
});

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

client.once('ready', () => {
    console.log(`Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`Using prefix: ${config.prefix}`);
    console.log(`Tracker settings: Updates every ${config.tracker.updateInterval/1000} seconds, increments by ${config.tracker.incrementAmount} seconds`);
});

client.on('messageCreate', async (message) => {
    console.log(`Received message: ${message.content}`);
    
    if (message.content === `${config.prefix}startTracker`) {
        console.log('Starting Minicopter crash tracker...');
        let timeSinceLastCrash = 0;
        let lastCrashBy = null;
        let retryCount = 0;
        const maxRetries = 3;
        
        try {
            const trackerMsg = await message.channel.send(`🛩️ Minicopter Crash Tracker\nTime since last crash: ${formatTime(timeSinceLastCrash)}`);
            await trackerMsg.react('🔄');

            const interval = setInterval(async () => {
                timeSinceLastCrash += config.tracker.incrementAmount;
                try {
                    const message = lastCrashBy 
                        ? `🛩️ Minicopter Crash Tracker\nTime since last crash: ${formatTime(timeSinceLastCrash)}\nLast crash reported by: ${lastCrashBy}`
                        : `🛩️ Minicopter Crash Tracker\nTime since last crash: ${formatTime(timeSinceLastCrash)}`;
                    await trackerMsg.edit(message);
                    retryCount = 0;
                } catch (error) {
                    console.error('Error updating tracker:', error.message);
                    retryCount++;
                    
                    if (retryCount >= maxRetries) {
                        console.error('Max retries reached, stopping tracker');
                        clearInterval(interval);
                        try {
                            await trackerMsg.edit(`🛩️ Minicopter Crash Tracker\nTracker stopped due to connection issues.\nLast known time: ${formatTime(timeSinceLastCrash)}`);
                        } catch (e) {
                            console.error('Could not send final message:', e.message);
                        }
                    }
                }
            }, config.tracker.updateInterval);

            const filter = (reaction, user) => reaction.emoji.name === '🔄' && !user.bot;
            const collector = trackerMsg.createReactionCollector({ filter });

            collector.on('collect', async (reaction, user) => {
                console.log(`Crash reported by ${user.tag}`);
                timeSinceLastCrash = 0;
                lastCrashBy = user.tag;
                try {
                    await trackerMsg.edit(`🛩️ Minicopter Crash Tracker\nTime since last crash: ${formatTime(timeSinceLastCrash)}\nLast crash reported by: ${user.tag}`);
                    await reaction.users.remove(user.id);
                } catch (error) {
                    console.error('Error updating crash report:', error.message);
                }
            });

            collector.on('end', () => {
                clearInterval(interval);
            });
        } catch (error) {
            console.error('Error starting tracker:', error.message);
            await message.channel.send('Failed to start Minicopter crash tracker. Please try again later.');
        }
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
