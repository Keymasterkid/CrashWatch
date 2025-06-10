const Database = require('better-sqlite3');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config.js');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.initialized = false;
        this.migrationCompleted = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            if (config.database.type === 'sqlite') {
                // Ensure data directory exists
                const dbDir = path.dirname(config.database.sqlitePath);
                await fs.mkdir(dbDir, { recursive: true });

                // Initialize SQLite database with proper error handling
                try {
                    this.db = new Database(config.database.sqlitePath, { 
                        verbose: config.database.verbose ? console.log : null,
                        fileMustExist: false
                    });

                    // Enable foreign keys and WAL mode for better performance
                    this.db.pragma('foreign_keys = ON');
                    this.db.pragma('journal_mode = WAL');
                    
                    // Create tables if they don't exist
                    this.db.exec(`
                        CREATE TABLE IF NOT EXISTS trackers (
                            guild_id TEXT,
                            channel_id TEXT,
                            message_id TEXT,
                            time_since_last_crash INTEGER,
                            last_crash_by TEXT,
                            last_update INTEGER,
                            total_crashes INTEGER DEFAULT 0,
                            PRIMARY KEY (guild_id, channel_id)
                        );

                        CREATE TABLE IF NOT EXISTS migration_status (
                            id INTEGER PRIMARY KEY CHECK (id = 1),
                            completed BOOLEAN NOT NULL DEFAULT 0,
                            completed_at INTEGER
                        );
                    `);

                    // Check if migration has been completed
                    const stmt = this.db.prepare('SELECT completed FROM migration_status WHERE id = 1');
                    const result = stmt.get();
                    this.migrationCompleted = result?.completed || false;
                } catch (error) {
                    this.connectionAttempts++;
                    if (this.connectionAttempts >= this.maxConnectionAttempts) {
                        throw new Error(`Failed to connect to database after ${this.maxConnectionAttempts} attempts: ${error.message}`);
                    }
                    console.error(`Database connection attempt ${this.connectionAttempts} failed:`, error.message);
                    await new Promise(resolve => setTimeout(resolve, 1000 * this.connectionAttempts));
                    return this.initialize();
                }
            }

            this.initialized = true;
            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error;
        }
    }

    // Add method to close database connection
    async close() {
        if (this.db) {
            try {
                this.db.close();
                this.initialized = false;
                console.log('Database connection closed');
            } catch (error) {
                console.error('Error closing database connection:', error);
            }
        }
    }

    // Add method to check database health
    async checkHealth() {
        if (!this.db) return false;
        try {
            this.db.prepare('SELECT 1').get();
            return true;
        } catch (error) {
            console.error('Database health check failed:', error);
            return false;
        }
    }

    async saveTracker(guildId, channelId, data) {
        await this.initialize();

        try {
            if (config.database.type === 'sqlite') {
                const stmt = this.db.prepare(`
                    INSERT OR REPLACE INTO trackers (
                        guild_id, channel_id, message_id, time_since_last_crash,
                        last_crash_by, last_update, total_crashes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `);

                stmt.run(
                    guildId,
                    channelId,
                    data.messageId,
                    data.timeSinceLastCrash,
                    data.lastCrashBy,
                    data.lastUpdate,
                    data.totalCrashes || 0
                );
            } else {
                // JSON storage
                const crashData = await this.loadAllData();
                if (!crashData[guildId]) crashData[guildId] = {};
                crashData[guildId][channelId] = {
                    messageId: data.messageId,
                    timeSinceLastCrash: data.timeSinceLastCrash,
                    lastCrashBy: data.lastCrashBy,
                    lastUpdate: data.lastUpdate,
                    totalCrashes: data.totalCrashes || 0
                };
                await this.saveAllData(crashData);
            }
        } catch (error) {
            console.error('Error saving tracker:', error);
            throw error;
        }
    }

    async loadTracker(guildId, channelId) {
        await this.initialize();

        try {
            if (config.database.type === 'sqlite') {
                const stmt = this.db.prepare(`
                    SELECT * FROM trackers 
                    WHERE guild_id = ? AND channel_id = ?
                `);
                const result = stmt.get(guildId, channelId);
                return result ? {
                    messageId: result.message_id,
                    timeSinceLastCrash: result.time_since_last_crash,
                    lastCrashBy: result.last_crash_by,
                    lastUpdate: result.last_update,
                    totalCrashes: result.total_crashes
                } : null;
            } else {
                // JSON storage
                const crashData = await this.loadAllData();
                return crashData[guildId]?.[channelId] || null;
            }
        } catch (error) {
            console.error('Error loading tracker:', error);
            throw error;
        }
    }

    async loadAllTrackers() {
        await this.initialize();

        try {
            if (config.database.type === 'sqlite') {
                const stmt = this.db.prepare('SELECT * FROM trackers');
                const rows = stmt.all();
                
                if (!rows || rows.length === 0) {
                    return null;
                }
                
                const result = {};
                for (const row of rows) {
                    if (!result[row.guild_id]) result[row.guild_id] = {};
                    result[row.guild_id][row.channel_id] = {
                        messageId: row.message_id,
                        timeSinceLastCrash: row.time_since_last_crash,
                        lastCrashBy: row.last_crash_by,
                        lastUpdate: row.last_update,
                        totalCrashes: row.total_crashes
                    };
                }
                return result;
            } else {
                const data = await this.loadAllData();
                return (!data || Object.keys(data).length === 0) ? null : data;
            }
        } catch (error) {
            console.error('Error loading all trackers:', error);
            throw error;
        }
    }

    async deleteTracker(guildId, channelId) {
        await this.initialize();

        try {
            if (config.database.type === 'sqlite') {
                const stmt = this.db.prepare(`
                    DELETE FROM trackers 
                    WHERE guild_id = ? AND channel_id = ?
                `);
                stmt.run(guildId, channelId);
            } else {
                const crashData = await this.loadAllData();
                if (crashData[guildId]) {
                    delete crashData[guildId][channelId];
                    if (Object.keys(crashData[guildId]).length === 0) {
                        delete crashData[guildId];
                    }
                    await this.saveAllData(crashData);
                }
            }
        } catch (error) {
            console.error('Error deleting tracker:', error);
            throw error;
        }
    }

    // JSON-specific methods
    async loadAllData() {
        try {
            const data = await fs.readFile(config.database.jsonPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {};
            }
            throw error;
        }
    }

    async saveAllData(data) {
        try {
            await fs.writeFile(config.database.jsonPath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving data:', error);
            throw error;
        }
    }

    // Migration method
    async migrateFromJsonToSqlite() {
        if (config.database.type !== 'sqlite') return false;
        if (this.migrationCompleted) {
            console.log('Migration already completed, skipping...');
            return true;
        }

        try {
            // Check if JSON file exists
            try {
                await fs.access(config.database.jsonPath);
            } catch (error) {
                console.log('No JSON file found, skipping migration...');
                const updateStmt = this.db.prepare(`
                    INSERT OR REPLACE INTO migration_status (id, completed, completed_at)
                    VALUES (1, 1, ?)
                `);
                updateStmt.run(Date.now());
                this.migrationCompleted = true;
                return true;
            }

            const jsonData = await this.loadAllData();
            if (!jsonData || Object.keys(jsonData).length === 0) {
                console.log('No JSON data to migrate');
                const updateStmt = this.db.prepare(`
                    INSERT OR REPLACE INTO migration_status (id, completed, completed_at)
                    VALUES (1, 1, ?)
                `);
                updateStmt.run(Date.now());
                this.migrationCompleted = true;
                return true;
            }

            // Clear existing SQLite data
            this.db.prepare('DELETE FROM trackers').run();

            // Insert all JSON data into SQLite
            const stmt = this.db.prepare(`
                INSERT INTO trackers (
                    guild_id, channel_id, message_id, time_since_last_crash,
                    last_crash_by, last_update, total_crashes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            for (const [guildId, channels] of Object.entries(jsonData)) {
                for (const [channelId, data] of Object.entries(channels)) {
                    stmt.run(
                        guildId,
                        channelId,
                        data.messageId,
                        data.timeSinceLastCrash,
                        data.lastCrashBy,
                        data.lastUpdate,
                        data.totalCrashes || 0
                    );
                }
            }

            // Create backup of JSON file
            await fs.copyFile(
                config.database.jsonPath,
                config.database.jsonPath + '.migration_backup'
            );

            // Mark migration as completed
            const updateStmt = this.db.prepare(`
                INSERT OR REPLACE INTO migration_status (id, completed, completed_at)
                VALUES (1, 1, ?)
            `);
            updateStmt.run(Date.now());
            this.migrationCompleted = true;

            console.log('Migration completed successfully');
            return true;
        } catch (error) {
            console.error('Migration error:', error);
            return false;
        }
    }
}

module.exports = new DatabaseManager(); 