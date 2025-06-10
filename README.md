# CrashWatch - Rust Minicopter Crash Tracker

A Discord bot that tracks Minicopter crashes in Rust. Created by BaseCode™ (keymasterkid).

## Features

- Tracks time since last Minicopter crash
- Configurable update interval and increment amount
- Shows who last reported a crash
- Easy to use with reaction-based crash reporting
- Continuous tracking until bot restart
- Automatic crash recovery after bot restarts
- Data persistence to maintain tracking state
- Support for both prefix commands and slash commands
- Multi-server and multi-channel support
- Automatic backup system for crash data
- Timezone support for crash reporting
- Beautiful embed messages with status indicators
- Automatic command registration for new servers
- Offline time tracking and recovery
- Graceful shutdown handling
- Database support (SQLite or JSON)
- Automatic migration from JSON to SQLite
- Rate limiting to prevent abuse
- Better error handling and recovery
- Database health monitoring
- Connection pooling and retry mechanism

## Required Permissions

The bot requires the following permissions to function properly:
- Send Messages
- Read Message History
- Add Reactions
- Use External Emojis
- Embed Links
- Attach Files
- Read Messages/View Channels
- Manage Messages (for reaction cleanup)

To ensure the bot has these permissions:
1. When inviting the bot to your server, use the OAuth2 URL with the required permissions
2. Make sure the bot's role has these permissions in the channel where you want to use it
3. Check that the bot's role is not being overridden by channel-specific permissions

## Setup

1. Clone the repository:
```bash
git clone https://github.com/Keymasterkid/CrashWatch.git
cd CrashWatch
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example config file and edit it:
```bash
cp config.js.example config.js
```

4. Edit `config.js` with your settings:
```javascript
module.exports = {
    token: "your_discord_bot_token",
    clientId: "your_client_id_here",  // Your bot's client ID
    prefix: "!",  // Command prefix
    tracker: {
        updateInterval: 10000,  // How often to update (in milliseconds)
        incrementAmount: 10     // How many seconds to add each update
    },
    database: {
        type: 'sqlite',  // Storage type ('json' or 'sqlite')
        sqlitePath: './data/trackers.db',  // Path for SQLite database
        verbose: false,  // Set to true to log SQL queries
        jsonPath: './data/trackers.json'  // Path for JSON storage
    }
};
```

> ⚠️ **IMPORTANT**: Never commit your `config.js` file to Git! It contains your bot token which should be kept private. The `config.js` file is already in `.gitignore` to prevent accidental commits.

5. Start the bot:
```bash
npm start
```

## Usage

### Prefix Commands
- Start the tracker: `!startTracker`
- Stop the tracker: `!stopTracker`

### Slash Commands
- Start the tracker: `/starttracker`
- Stop the tracker: `/stoptracker`
- Start from specific time: 
  - Basic: `/startfromtime time:2:30pm timezone:Pacific Time (PT)`
  - With date: `/startfromtime time:2:30pm timezone:Pacific Time (PT) date:5/7`

Available timezones:
- Pacific Time (PT)
- Mountain Time (MT)
- Central Time (CT)
- Eastern Time (ET)
- Atlantic Time (AT)
- Greenwich Mean Time (GMT)
- Central European Time (CET)
- Eastern European Time (EET)
- Australian Eastern Time (AET)
- Japan Standard Time (JST)

### Other Features
- Report a crash: Click the 🔄 reaction on the tracker message
- The tracker will continue running until stopped or the bot is restarted
- After a bot restart, the tracker will automatically recover and continue from where it left off
- Commands are automatically registered when the bot joins new servers
- Tracker status is shown in the embed (Active/Inactive/Error)
- Offline time is automatically tracked and added when the bot reconnects
- Rate limiting prevents command spam and abuse
- Automatic retry mechanism for failed operations
- Database health monitoring and automatic recovery

## Multi-Server Support

The bot now supports multiple servers and channels:
- Run multiple trackers in different channels
- Each channel maintains its own independent tracking
- Trackers can be started and stopped independently
- All trackers are automatically recovered after bot restart
- Commands are automatically registered for new servers
- Each server maintains its own crash data
- Rate limiting per channel and user
- Better error handling and recovery per channel

## Data Persistence and Backup

The bot automatically saves its state to the configured database, which includes:
- Current tracking time for each channel
- Last crash reporter for each channel
- Channel and message information
- Last update timestamp
- Tracker status
- Total crash count
- Migration status

The backup system:
- Creates automatic backups before saving new data
- Maintains a backup file for JSON storage
- Recovers from backup if the main file is corrupted
- Preserves data across bot restarts and crashes
- Handles offline time tracking
- Automatic database health checks
- Connection pooling for better performance

## Status Indicators

The tracker shows different statuses:
- **Active**: Tracker is running normally
- **Inactive**: Tracker has been stopped
- **Offline**: Bot is offline or shutting down
- **Error**: An error has occurred
- **Rate Limited**: Command usage is temporarily restricted
- **Database Error**: Database connection issues
- **Recovering**: Automatic recovery in progress 

## Offline Handling

The bot handles offline scenarios gracefully:
- Tracks time while offline
- Updates status to show offline state
- Preserves all tracking data
- Recovers automatically when back online
- Shows detailed error information if needed
- Handles graceful shutdowns (Ctrl+C)
- Automatic database reconnection
- Connection retry mechanism

## Configuration

You can customize the bot's behavior in `config.js`:

- `token`: Your Discord bot token
- `clientId`: Your bot's client ID
- `prefix`: Command prefix (default: "!")
- `tracker.updateInterval`: How often the tracker updates (in milliseconds)
- `tracker.incrementAmount`: How many seconds to add each update
- `database.type`: Storage type ('json' or 'sqlite')
- `database.sqlitePath`: Path for SQLite database (if using SQLite)
- `database.verbose`: Enable SQL query logging (SQLite only)
- `database.jsonPath`: Path for JSON storage (if using JSON)

## Database Support

The bot now supports two database types:

1. **JSON Storage**
   - Simple file-based storage
   - Good for small deployments
   - Data stored in `data/trackers.json`
   - Automatic backup system
   - Easy to read and modify manually

2. **SQLite Storage**
   - More robust database storage
   - Better for larger deployments
   - Data stored in `data/trackers.db`
   - Automatic migration from JSON to SQLite
   - Better performance and reliability
   - Connection pooling
   - Automatic retry mechanism
   - Health monitoring
   - WAL mode for better performance
   - Configurable query logging

### Migration from JSON to SQLite

When switching to SQLite:
1. Set `database.type` to `'sqlite'` in `config.js`
2. The bot will automatically migrate data from JSON to SQLite
3. A backup of the JSON file will be created
4. Migration status is tracked to prevent repeated migrations
5. Automatic rollback if migration fails
6. Progress tracking during migration
7. Detailed error reporting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

- BaseCode™ (keymasterkid)
- GitHub: [Keymasterkid](https://github.com/Keymasterkid)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Support

If you encounter any issues, please [open an issue](https://github.com/Keymasterkid/CrashWatch/issues) on GitHub.

---

© 2025 BaseCode™ 