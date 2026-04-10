const helpers = require('../core/helpers');

const IS_COMPONENTS_V2 = 1 << 15; // 32768

class NewsEmbedFactoryV2 {
    static createEmbed(kill, zkb, names, category) {
        const totalValue = helpers.formatIsk(zkb.totalValue);

        return {
            username: "Socket.Kill Intel",
            avatar_url: "https://edge.socketkill.com/favicon.png",
            flags: IS_COMPONENTS_V2,
            components: [
                {
                    type: 17,
                    accent_color: 0x3fb950,
                    components: [
                        {
                            type: 10,
                            content: `## ${names.finalVictimName} lost a ${names.shipName}\n-# V2 Test Render`
                        },
                        { type: 14, spacing: 1, divider: true },
                        {
                            type: 10,
                            content: `**Value**  ${totalValue} ISK\n**System**  ${names.systemName}\n**Attackers**  ${names.attackerCount}`
                        }
                    ]
                }
            ]
        };
    }
}

module.exports = NewsEmbedFactoryV2;