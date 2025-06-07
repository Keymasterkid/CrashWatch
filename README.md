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
    prefix: "!",  // Command prefix
    tracker: {
        updateInterval: 10000,  // How often to update (in milliseconds)
        incrementAmount: 10     // How many seconds to add each update
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
- Start from specific time: `/startfromtime time:2:30pm timezone:Pacific Time (PT)` (Use 12-hour format and select your timezone)

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

## Multi-Server Support

The bot now supports multiple servers and channels:
- Run multiple trackers in different channels
- Each channel maintains its own independent tracking
- Trackers can be started and stopped independently
- All trackers are automatically recovered after bot restart

## Data Persistence and Backup

The bot automatically saves its state to `crash_data.json`, which includes:
- Current tracking time for each channel
- Last crash reporter for each channel
- Channel and message information
- Last update timestamp

The backup system:
- Creates automatic backups before saving new data
- Maintains a backup file (`crash_data.json.backup`)
- Recovers from backup if the main file is corrupted
- Preserves data across bot restarts and crashes

This allows the bot to:
- Recover after crashes or restarts
- Continue tracking from the last known state
- Maintain tracking history
- Handle multiple servers and channels
- Protect against data corruption

## Configuration

You can customize the bot's behavior in `config.js`:

- `token`: Your Discord bot token
- `prefix`: Command prefix (default: "!")
- `tracker.updateInterval`: How often the tracker updates (in milliseconds)
- `tracker.incrementAmount`: How many seconds to add each update

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