const { REST, Routes } = require('discord.js');
const config = require('./config.js');

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Starting cleanup of global commands...');
    const commands = await rest.get(Routes.applicationCommands(config.clientId));
    console.log(`Found ${commands.length} global commands to delete.`);
    
    for (const command of commands) {
      await rest.delete(Routes.applicationCommand(config.clientId, command.id));
      console.log(`Deleted global command ${command.name}`);
    }
    console.log('All global commands deleted successfully.');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
})();
