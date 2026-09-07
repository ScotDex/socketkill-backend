require(`dotenv`).config();
const { TwitterApi } = require(`twitter-api-v2`)
const { AtpAgent } = require('@atproto/api');
const helpers = require('../core/helpers');
const axios = require('./agent');

const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const agent = new AtpAgent({ service: 'https://bsky.social' });
agent.login({
    identifier: process.env.BLUESKY_IDENTIFIER,
    password: process.env.BLUESKY_APP_PASSWORD,
}).then(() => {
    console.log(`[BLUESKY] Logged in as ${process.env.BLUESKY_IDENTIFIER}`);
}).catch((err) => {
    console.error(`[BLUESKY] Login failed: ${err.message}`); 
});

class TwitterService {
    static async postWhale(names, formattedValue, killId, png = null) {
    try {
        const date = new Date().toISOString().slice(0, 10);
        const status = `BOOM! ${names.shipName} destroyed! || ${formattedValue} ISK || ${helpers.getSocketKillLink(killId, date)} || #TweetFleet #eveonline #SocketKill`;

        const tweetPayload = {};
        if (png) {
            const mediaId = await twitterClient.v1.uploadMedia(png, { mimeType: 'image/png' });
            tweetPayload.media = { media_ids: [mediaId] };
        }
        await twitterClient.v2.tweet(status, tweetPayload);
        console.log(`Tweet posted for Kill #${killId}${png ? ' with card' : ''}`);
    } catch (err) {
        console.error("Twitter/X API Error:", err.message);
    }
}
}

class BlueSkyService {
    static async postWhale(names, formattedValue, killId, png = null) {
        try {
            const date = new Date().toISOString().slice(0, 10);
            const status = `BOOM! ${names.shipName} destroyed! || ${formattedValue} ISK || #EveOnline #SocketKill`;
            const url = helpers.getSocketKillLink(killId, date);

            let thumb = null;
            if (png) {
                try {
                    console.log(`[BLUESKY] Card size: ${png.length} bytes`);
                    const blob = await agent.uploadBlob(png, { encoding: 'image/png' });
                    thumb = blob.data.blob;
                } catch (imgErr) {
                    console.error("Bluesky image upload failed, posting without:", imgErr.message);
                }
            }

            await agent.post({
                text: status,
                embed: {
                    $type: 'app.bsky.embed.external',
                    external: {
                        uri: url,
                        title: `${names.shipName} destroyed`,
                        description: `${formattedValue} ISK`,
                        ...(thumb && { thumb }),
                    }
                }
            });
            console.log(`Bluesky post made for Kill #${killId}`);
        } catch (err) {
            console.error("Bluesky API Error:", err.message);
        }
    }
}

class MastodonService {
    static async postWhale (names, formattedValue, killId){
        try {
            const date = new Date().toISOString().slice(0,10);
            const url = helpers.getSocketKillLink(killId, date);
            const status = `BOOM! ${names.shipName} destroyed! || ${formattedValue} ISK || ${url} || #EveOnline #SocketKill #TweetFleet`;

                        await axios.post(
                `${process.env.MASTODON_INSTANCE}/api/v1/statuses`,
                { status },
                { headers: { Authorization: `Bearer ${process.env.MASTODON_ACCESS_TOKEN}` } }
            );
            console.log(`Mastodon post made for Kill #${killId}`);
        } catch (err) {
            console.error("Mastodon API Error:", err.response?.status, err.message);
        }
    }
}


module.exports = { TwitterService, BlueSkyService, MastodonService }