module.exports = {
    fromR2: (data) => {
        if (!data) return null;
        const killID = data.killmail_id || data.zkb?.killID || data.zkill?.killID;
        const hash = data.hash || data.zkb?.hash;
        const totalValue = data.zkb?.totalValue || data.zkill?.zkb?.totalValue || 0;
        const esiPayload = data.victim ? data : (data.esi || data);

        if (!killID) return null;

        return {
            killID: killID,
            hash: hash,
            zkb: {
                totalValue: totalValue,
                href: hash ? `https://esi.evetech.net/latest/killmails/${killID}/${hash}/` : null,
                isNPC: data.zkb?.npc || false,
                labels: data.zkb?.labels || []
            },
            isR2: true,
            esiData: esiPayload,
            sequence: data.sequence_id, // Good for tracking lag
            sequenceUpdated: data.sequence_updated || null 
        };
    },

        fromESI: (killmailId, killmailHash, esiData) => {
        if (!esiData || !killmailId) return null;
        return {
            killID: killmailId,
            hash: killmailHash,
            zkb: {
                totalValue: 0,
                href: `https://esi.evetech.net/latest/killmails/${killmailId}/${killmailHash}/`,
                isNPC: false,
                labels: []
            },
            isR2: false,
            esiData: esiData,
            sequence: null,
            sequenceUpdated: null
        };
    }
};