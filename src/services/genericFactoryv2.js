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
                            type: 9,
                            components: [
                                {
                                    type: 10,
                                    content: `**Value**  ${totalValue} ISK\n**System**  ${names.systemName}\n**Attackers**  ${names.attackerCount}`
                                }
                            ],
                            accessory: {
                                type: 11,
                                media: {
                                    url: `https://images.evetech.net/types/${kill.victim.ship_type_id}/render?size=128`
                                }
                            }
                        },
                        { type: 14, spacing: 1, divider: false },
                        {
                            type: 10,
                            content: `-# Socket.Kill | Real-time EVE Intel · <t:${Math.floor(Date.now() / 1000)}:R>`
                        }
                    ]
                }
            ]
        };
    }
}

module.exports = NewsEmbedFactoryV2;