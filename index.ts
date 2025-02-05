import Discord, { TextChannel, ThreadAutoArchiveDuration, User, Message, Attachment, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import {Server} from '@fabricio-191/valve-server-query'
import { startWebServer } from './webserver';

console.log("Starting process...")

let config = require("./config.json") as Config;

const client = new Discord.Client({
    intents: []
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  mainLoop();
  startWebServer(config);
});

export type Ping = {
    threshold: number,
    role: string,
    triggerTime: number | undefined // Undefined if cooldown expired. 
}

export type TF2Server = {
    ip: string,
    port: number,
    urlPath: string,
    connectString: string | undefined,
    description: string,
    channelID: string,
    graphDensity: number,
    pings: Ping[]
}

export type Config = {
    discordToken: string,
    connectURLBase: string,
    servers: TF2Server[],
    webPort: number,
    fastdlPath: string | undefined,
}
const queryInterval = 1 * 60 * 1000;
const resultArchiveLimit = 100;
const pingTimeLimit = 2 * 60 * 60 * 1000;
const hysteresis = 3

const maxCharsFieldValue = 1024;
const maxCharsLine = 49;

const maxQueries = 21; // 21 queries is the max that we show in a discord message.
const maxDisplay = 25; // 25 lines is the max that we show in a discord message (including map names)

let resultArchive = new Map<string, Result[]>(); // Use connectString as key.

async function mainLoop() {
    let prevtime: number | undefined = undefined;

    config.servers.forEach(server => {
        server.pings.sort((a, b) => a.threshold - b.threshold);
    });

    while(true) {
        const time = Date.now();
        
        await Promise.allSettled(config.servers.map(async server => {
            await handleServer(server);
        }))
        
        const time2 = Date.now();
        const nextInterval = (Math.floor(time2 / queryInterval) * queryInterval) + queryInterval
        await new Promise(r => setTimeout(r, nextInterval - time2));
        prevtime = time;
    }
}

async function handleServer(server: TF2Server) {
    try {
        const channel = await client.channels.fetch(server.channelID) as TextChannel;
        const lastMessage = (await channel.messages.fetch({ limit: 1 })).first();
        const result = await getResults(server.ip, server.port);

        const connectString = server.connectString ?? `${server.ip}:${server.port}`;
        if(!resultArchive.has(connectString)) {
            resultArchive.set(connectString, [result]);
        } else {
            resultArchive.get(connectString)?.push(result);
        }

        const results = resultArchive.get(connectString) ?? [];

        const {title, color, allowConnections} = getTitleAndColor(results)

        const pings = getPings(server, result);

        let fields = [
            {
                name: "Map:",
                value: result.query?.info.map ?? "N/A",
                inline: true
            },
            {
                name: "Current Players:",
                value: result.query
                    ? `${result.query?.info.players.online - result.query?.info.players.bots}/${result.query?.info.players.max}${(result.query?.info.players.bots ?? 0) > 0 ? ` (${result.query?.info.players.bots} bots)` : ""}`
                    : "N/A",
                inline: true
            },
            {
                name: "Connect via console:",
                value: `\`connect ${connectString}\``,
                inline: true
            }
        ];

        if (server.pings.length > 0) {
            fields.push({
                name: "Activity Pings:",
                value: buildPingActivity(server),
                inline: false
            })
        }

        fields.push({
            name: "Recent History:",
            value: buildServerActivity(results, server.graphDensity),
            inline: false
        });

        const embed = new EmbedBuilder({
            title: title,
            url: (allowConnections ? `${config.connectURLBase}/${server.urlPath}` : undefined),
            description: server.description,
            timestamp: Date.now(),
            color: color,
            fields: fields
        })

        if(pings.length === 0 && lastMessage && lastMessage.author.id === client.user?.id) {
            await lastMessage.edit({embeds: [embed]})
        } else {
            if(lastMessage && lastMessage.author.id === client.user?.id) {
                await lastMessage.delete();
            } 
            await channel.send({content: pings, embeds: [embed]})
        }
    } catch (err) {
        console.log("shit hit the fan: " + err);
    }
}

interface Result {
    query: {
        info: Server.Info,
        playerInfo: Server.PlayerInfo[],
    } | undefined
    time: number
}

async function getResults(ip: string, port: number): Promise<Result> {
    let result: Result | undefined = undefined;
    try {
        const server = await Server({
            ip: ip,
            port: port,
            timeout: 5000,
            retries: 3
        });
        result = {
            query: {
                info: await server.getInfo(),
                playerInfo: await server.getPlayers(),
            },
            time: Date.now()
        }
    } catch (err) {
        return {
            query: undefined,
            time: Date.now()
        };
    }
    return result;
}

client.login(config.discordToken);
  
function buildServerActivity(resultArchive: Result[], graphDensity: number = 4): string {
    while(resultArchive.length > resultArchiveLimit) {
        resultArchive.splice(0, resultArchive.length - resultArchiveLimit)
    }

    let output = "```\n";
    let outputEnd = "```"

    let map = undefined;

    // Iterate by most recent first
    for(let i = resultArchive.length - 1; i >= 0 && i >= resultArchive.length - maxQueries; i-- ) {
        const result = resultArchive[i];
        let newOutput = output;

        const onlinePlayers = (result.query?.info.players.online ?? 0) - (result.query?.info.players.bots ?? 0);
        const maxPlayers = result.query?.info.players.max ?? 100;

        const queryAge = calculateMinutesBetweenTimestamps(Date.now(), result.time);
        const queryAgeString = queryAge === 0
            ? "       NOW: "
            : `${queryAge.toString().padStart(2)} MIN AGO: `
        //const mapNameString = `${result.query?.info.map.padEnd(longestMapNameLength) ?? "N/A"} `
        const playerCountString = ' ' + (result.query ? (onlinePlayers.toString()) : "N/A").padStart(maxPlayers.toString().length, ' ') + '\n';

        let playerGraphString = ""

        let graphChars: string[] = [];
        switch (graphDensity) {
            case 8:
                graphChars = ['⡀', '⡄', '⡆', '⡇', '⣇', '⣧', '⣷', '⣿']
                break;
            case 6:
                graphChars = ['⡀', '⡄', '⡆', '⣆', '⣦', '⣶']
                break;
            default:
                graphChars = ['⠄', '⠆', '⠦', '⠶']
        }

        const increment = graphChars.length;

        for(let j = onlinePlayers; j > 0; j-=increment) {
            let charIndex = Math.min(graphChars.length, j);
            playerGraphString += graphChars[charIndex - 1];
        }

        if(result.query && (!map || result.query?.info.map !== map)) {
            newOutput += result.query?.info.map + "\n";
            map = result.query?.info.map;
        }

        newOutput += queryAgeString;
        newOutput += playerGraphString;
        newOutput += playerCountString;
        
        if(newOutput.length > maxCharsFieldValue - outputEnd.length || newOutput.split("\n").length > maxDisplay + 2) {
            break;
        }
        output = newOutput;
    }
    output += outputEnd
    return output
}

function calculateMinutesBetweenTimestamps(timestamp1: number, timestamp2: number): number {
    const date1 = new Date(timestamp1);
    const date2 = new Date(timestamp2);
    const diffMs = Math.abs(date2.getTime() - date1.getTime());
    const diffMins = Math.round(diffMs / 60000);
    return diffMins;
}

function getPings(server: TF2Server, result: Result): string {

    if(result.query?.info.visibility === "private") {
        return "";
    }

    let now = Date.now();

    if(result.query === undefined) {
        return "";
    }

    const onlinePlayers = result.query.info.players.online - (result.query.info.players.bots ?? 0);

    let toPing: string[] = [];

    server.pings = server.pings.map(ping => {
        if(ping.triggerTime === undefined && onlinePlayers >= ping.threshold) {
            ping.triggerTime = now;
            toPing.push(ping.role);
        } else if (onlinePlayers <= ping.threshold - hysteresis && now - (ping.triggerTime ?? now) > pingTimeLimit) {
            ping.triggerTime = undefined;
        }
        return ping;
    });

    return toPing.map(s => `<@&${s}>`).join(" ")
}

function getTitleAndColor(resultArchive: Result[]): {title: string, color: number, allowConnections: boolean} {
    let consecutivefailCount = 0;
    let mostRecentResult: Result | undefined = undefined;

    for(let i = resultArchive.length - 1; i >= 0; i-- ) {
        const result = resultArchive[i];
        if (result.query === undefined) {
            consecutivefailCount++
        } else {
            mostRecentResult = result
            break;
        }
    }
    
    // password protected
    if(consecutivefailCount < 2 && mostRecentResult?.query?.info.visibility === "private") {
        return {title: "Server is password-protected", color: 0xffff00, allowConnections: false}
    }
    // server is full
    if(consecutivefailCount < 2 && mostRecentResult?.query &&
        mostRecentResult?.query?.info.players.online
        - mostRecentResult?.query?.info.players.bots
        === mostRecentResult?.query?.info.players.max) {
            return {title: "Server is FULL!", color: 0x00ffaa, allowConnections: false}
    }

    switch (consecutivefailCount) {
        case 0:
            const color = mostRecentResult?.query && mostRecentResult?.query?.info.players.online - mostRecentResult?.query?.info.players.bots === 0 ? 0x008800 : 0x00ff00;
            return {title: mostRecentResult?.query?.info.name ?? "Awaiting initial server query...", color: color, allowConnections: true}
        case 1:
            return {title: mostRecentResult?.query?.info.name ?? "Awaiting initial server query...", color: 0xffff00, allowConnections: true}
        default:
            return {title: `Server is offline (failed ${
                consecutivefailCount > resultArchiveLimit ? `${resultArchiveLimit}+` : consecutivefailCount
            } queries)`, color: 0xff0000, allowConnections: false}
    }
}

function buildPingActivity(server: TF2Server): string {
    const buildRow = (ping: Ping): string => {
        const start = `${ping.threshold} PLAYER PING: `
        if(ping.triggerTime === undefined) return `${start}READY`;
        if(Date.now() - ping.triggerTime > pingTimeLimit) return `${start}RESETS BELOW ${ping.threshold - hysteresis + 1} PLAYERS`;
        
        const timeRemaining = ping.triggerTime + pingTimeLimit - Date.now();
        const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutes = Math.floor(timeRemaining / (1000 * 60)) % 60

        return `${start}ON COOLDOWN ${hours}h ${minutes}m`
    }

    return "```" + server.pings.map(ping => buildRow(ping)).join("\n") + "```"
}

