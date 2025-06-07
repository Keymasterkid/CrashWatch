const { Client, GatewayIntentBits } = require('discord.js');
const config = require('config.js')

const client = new Client({ intents: [config.intents] });

client.on('messageCreate', async (message) => {
    if (message.content === '!startCounter') {
        let counter = 0;
        const counterMsg = await message.channel.send(Counter: ${counter}s);

        const interval = setInterval(async () => {
            counter++;
            await counterMsg.edit(Counter: ${counter}s);
        }, 1000);

        const filter = (reaction) => reaction.emoji.name === '';
        const collector = counterMsg.createReactionCollector({ filter });

        collector.on('collect', async () => {
            counter = 0;
            await counterMsg.edit(Counter reset!);
        });
    }
});

client.login(config.token);
