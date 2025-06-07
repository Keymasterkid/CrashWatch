# CrashWatch - Rust Minicopter Crash Tracker

A Discord bot that tracks Minicopter crashes in Rust. Created by BaseCode™ (keymasterkid).

## Features

- Tracks time since last Minicopter crash
- Configurable update interval and increment amount
- Shows who last reported a crash
- Easy to use with reaction-based crash reporting
- Continuous tracking until bot restart

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

- Start the tracker: `!startTracker`
- Report a crash: Click the 🔄 reaction on the tracker message
- The tracker will continue running until the bot is restarted

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