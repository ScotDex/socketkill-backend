require("dotenv").config();
const axios = require("../network/agent");


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

  static getEveKillLink(killId) {
    return `https://evekill.com/kill/${killId}/`;
  }

  static async getPlayerCount() {
    try {
      const url = "https://esi.evetech.net/latest/status/";
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Socket.Kill / Dexomus Viliana (https://socketkill.com)' },
        timeout: 5000,
      });

      return {
        count: response.data.players,
        version: response.data.server_version,
        vip: response.data.vip === true,
        active: true,
      };
    } catch (err) {
      console.error("[ESI] Status Check Failed:", err.message);
      return { count: 0, version: "OFFLINE", active: false };
    }
  }

  static getBackPhoto() {
    return {
      url: process.env.BACKGROUND_API_URL,
      name: "EVE Online Nebula",
      media_type: "image",
    };
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

}

module.exports = utils;

