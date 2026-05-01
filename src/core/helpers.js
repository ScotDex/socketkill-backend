require("dotenv").config();
const axios = require("../network/agent");
const fs = require("fs");
const path = require("path");
const DATA_PATH = path.join(process.cwd(), "data", "stats.json");
const FIN_PATH = path.join(process.cwd(), "data", "financials.json");

class utils {
  static getArticle(name) {
    if (!name || typeof name !== 'string') return "a";
    const vowels = ["a", "e", "i", "o", "u"];
    const firstLetter = name.charAt(0).toLowerCase();
    return vowels.includes(firstLetter) ? "an" : "a";
  }

  static formatIsk(rawValue) {
    const value = rawValue || 0;

    if (value >= 1_000_000_000_000) {
      return `${(value / 1_000_000_000_000).toFixed(2)}T`;
    }
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(2)}K`;
    }
    return value.toFixed(2);

  }

  static getZkillLink(killId) {
    return `https://zkillboard.com/kill/${killId}/`;
  }

  static getSocketKillLink(killId) {
    return `https://socketkill.com/kill/${killId}`;
  }

  static async getPlayerCount() {
    try {
      const url = "https://api.socketkill.com/eve/status";
      const response = await axios.get(url);

      return {
        count: response.data.players,
        active: true,
      };
    } catch (err) {
      console.error("[ESI] Status Check Failed:", err.message);
      return { count: 0, version: "OFFLINE", active: false };
    }
  }

  static async getBackPhoto() {
    try {
      const url = process.env.BACKGROUND_API_URL;
      return {
        url: url,
        name: "EVE Online Nebula",
        media_type: "image",
      };
    } catch (err) {
      console.error("Background Pic Retrieval Issue", err.message);
      return null;
    }
  }

  static formatDuration(ms) {
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(" ");
  }

  // helpers.js

  static loadPersistentStats() {
    try {
      const directory = path.dirname(DATA_PATH);

      // Ensure directory exists
      if (!fs.existsSync(directory)) {
        console.log(`[STORAGE] Creating missing directory: ${directory}`);
        fs.mkdirSync(directory, { recursive: true });
      }

      // Check if file exists
      if (!fs.existsSync(DATA_PATH)) {
        console.log("[STORAGE] No stats file found. Starting a new one.");
        return 0;
      }

      // Read and parse
      const rawData = fs.readFileSync(DATA_PATH, "utf8");

      // Check if file is empty string
      if (!rawData || rawData.trim() === "") {
        console.log("[STORAGE] Stats file is empty. Initializing with 0.");
        return 0;
      }

      const data = JSON.parse(rawData);
      console.log(
        `[STORAGE] Successfully loaded ${data.totalKills} kills from disk.`,
      );
      return Number(data.totalKills) || 0;
    } catch (err) {
      console.error("[STORAGE] Critical error loading stats:", err.message);
      return 0;
    }
  }

  static loadPersistentIsk() {
    try {
      if (!fs.existsSync(FIN_PATH)) return 0;
      const rawData = fs.readFileSync(FIN_PATH, "utf8");
      if (!rawData) return 0;

      const data = JSON.parse(rawData);
      return Number(data.totalIsk) || 0;
    } catch (err) {
      console.error("[STORAGE] Error loading ISK stats:", err.message);
      return 0;
    }
  }

  static async savePersistentIsk(total) {
    try {
      const payload = JSON.stringify({
        totalIsk: total,
        lastUpdate: new Date().toISOString(),
      });
      await fs.promises.writeFile(FIN_PATH, payload);
    } catch (err) {
      console.error("[STORAGE] Error saving ISK total:", err.message);
    }
  }

  static async savePersistentStats(count) {
    try {
      // Force save as an object with totalKills key
      const payload = JSON.stringify({ totalKills: Math.floor(count) });
      await fs.promises.writeFile(DATA_PATH, payload);
    } catch (err) {
      console.error("[STORAGE] Error saving stats count:", err.message);
    }
  }
}

module.exports = utils;

