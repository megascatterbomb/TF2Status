import Discord, { TextChannel, ThreadAutoArchiveDuration, User, Message, Attachment, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import {Server} from '@fabricio-191/valve-server-query'
import { startWebServer } from './webserver';
import https from 'https';
import axios from "axios";
import { json } from 'stream/consumers';

console.log("Starting process...")

let config = require("./config.json") as Config;

const client = new Discord.Client({
    intents: []
});

function shutdown(signal: string) {
    console.log(`Received ${signal}, clearing all status messages...`);
    sendShutdownMessages().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error("Error during shutdown:", err);
        process.exit(1);
    });
}

async function sendShutdownMessages() {
    await Promise.allSettled(config.servers.map(async server => {
        const channel = client.channels.cache.get(server.channelID) as TextChannel;
        const lastMessage = (await channel.messages.fetch({ limit: 1 })).first()
        if (channel) {
            const embed = new EmbedBuilder({
                title: "TF2 Status Discord bot is offline",
                description: "\`\`\`Server information is not available at this time.\`\`\`",
                timestamp: Date.now(),
                color: OFFLINE,
            })
            if (lastMessage && lastMessage.author.id === client.user?.id) {
                await lastMessage.edit({embeds: [embed]})
            } else {
                await channel.send({embeds: [embed]})
            }
        } else {
            console.error(`Channel with ID ${server.channelID} not found.`);
        }
    }))
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user?.tag}!`);
    mainLoop();
    startWebServer(config);
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
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

export type ExternalLink = {
    title: string,
    description: string,
    url: string
}

export type Config = {
    discordToken: string,
    urlBase: string,
    servers: TF2Server[],
    webPort: number,
    steamApiKey: string | undefined,
    fastdlPath: string | undefined,
    externalLinks: ExternalLink[]
}
const updateInterval = 1 * 60 * 1000;
const queriesPerInterval = 6;
const resultArchiveLimit = 100;
const pingTimeLimit = 2 * 60 * 60 * 1000;
const hysteresis = 3

const maxCharsFieldValue = 1024;
const maxCharsLine = 49;

const maxQueries = 21; // 21 queries is the max that we show in a discord message.
const maxDisplay = 25; // 25 lines is the max that we show in a discord message (including map names)

const redirectIPFetchInterval = 60 * 1000;
const redirectIPTimeout = 5000; 

let resultArchive = new Map<string, Result[]>(); // Use urlPath as key.

export function getResultsArchive(): Map<string, Result[]> {
    return resultArchive;
}

export let redirectIP: string | undefined = undefined;
let redirectIPLastFetchTime: number = 0;

async function fetchRedirectIP() {
    const now = Date.now();
    if ((!redirectIP && now - redirectIPLastFetchTime > redirectIPTimeout) || now - redirectIPLastFetchTime > redirectIPFetchInterval) {
        redirectIPLastFetchTime = now;
        try {
            const response = await axios.get(`https://potato.tf/api/serverstatus/redirect`, {
                timeout: redirectIPTimeout,
            });
            const rip = response.data;
            redirectIP = rip;
        } catch (error) {
            console.error("Error fetching Potato.tf redirect IP");
            redirectIP = undefined;
        }
    }
}

fetchRedirectIP();

export async function getConnectLinkSDR(sdrString: string): Promise<string | undefined> {
    await fetchRedirectIP();
    if (!redirectIP) return undefined;
    return `https://potato.tf/connect/${redirectIP}/dest=${sdrString}`;
}

export let lastUpdateTime: number | undefined = undefined;

async function mainLoop() {

    config.servers.forEach(server => {
        server.pings.sort((a, b) => a.threshold - b.threshold);
    });

    let count = -1; // next interval will be synced to the minute

    while(true) {
        const time = Date.now();

        const updateString = count === 0 ? "=== PERFORMING QUERY + ARCHIVE === " : "=== PERFORMING QUERY ===";
        console.log(`${updateString}`);
        
        await Promise.allSettled(config.servers.map(async server => {
            await handleServer(server, count === 0);
        }))
        
        const time2 = Date.now();
        const actualInterval = updateInterval / queriesPerInterval;
        const nextInterval = (Math.floor(time2 / actualInterval) * actualInterval) + actualInterval;
        await new Promise(r => setTimeout(r, nextInterval - time2));
        lastUpdateTime = time;

        if (count < 0) {
            resultArchive.clear();
        }

        count = (count + 1) % queriesPerInterval;
    }
}

async function handleServer(server: TF2Server, addToHistory: boolean) {
    try {
        // Skip if addToHistory is false and:
        // either of the last two queries have zero players, or
        // both of the last two queries failed
        if (!addToHistory && resultArchive.has(server.urlPath)) {
            const results = resultArchive.get(server.urlPath) ?? [];
            const lastResult = results.length >= 1 ? results[results.length - 1] : undefined;
            const secondLastResult = results.length > 1 ? results[results.length - 2] : undefined;

            const lastPlayers = lastResult?.query ? (lastResult.query.info.players.online - (lastResult.query.info.players.bots ?? 0)) : null;
            const secondLastPlayers = secondLastResult?.query ? (secondLastResult.query.info.players.online - (secondLastResult.query.info.players.bots ?? 0)) : null;

            if ((lastPlayers !== null && lastPlayers === 0) ||
                (secondLastPlayers !== null && secondLastPlayers === 0) ||
                (lastResult?.query === undefined && secondLastResult?.query === undefined)) {
                console.log(`Skipping update for ${server.urlPath}`);
                return;
            }
        }

        const channel = await client.channels.fetch(server.channelID) as TextChannel;
        const lastMessage = (await channel.messages.fetch({ limit: 1 })).first();
        const result = await getResults(server.ip, server.port);

        let identity = server.urlPath;

        if(!resultArchive.has(identity)) {
            resultArchive.set(identity, [result]);
        } else if (addToHistory) {
            resultArchive.get(identity)?.push(result);
        } else {
            resultArchive.get(identity)?.splice(-1, 1, result);
        }

        const results = resultArchive.get(identity) ?? [];

        const { title, notice, color, allowConnections, sdr } = getTitleAndColor(results);

        const pings = getPings(server, result);

        let ipString = `${server.ip}:${server.port}`;
        if (sdr) {
            ipString = result.query?.info.address || "SDR IP NOT AVAILABLE";
        } else if (server.connectString) {
            ipString = server.connectString;
        } else if (!server.ip.includes(".")) {
            ipString = result.query?.info.address || "IP NOT AVAILABLE";
        }
        let connectString = "connect " + ipString;

        let fields = [
            {
                name: "Connect via console:",
                value: `\`${connectString}\``,
                inline: true
            },
            {
                name: "Map:",
                value: result.query?.info.map ?? "N/A",
                inline: true
            },
            {
                name: "Players:",
                value: result.query
                    ? `${result.query?.info.players.online - result.query?.info.players.bots}/${result.query?.info.players.max}${(result.query?.info.players.bots ?? 0) > 0 ? ` (${result.query?.info.players.bots} bots)` : ""}`
                    : "N/A",
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

        let url: string | undefined = undefined;
        if (allowConnections) {
            url = `${config.urlBase}/tf2/${server.urlPath}`;
        }

        const embed = new EmbedBuilder({
            title: title,
            url,
            description: "\`\`\`" + server.description + (notice ?  "\n\n" + notice : "") + "\`\`\`",
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

        console.log(`Updated server ${server.urlPath} (${ipString})`);
    } catch (err) {
        console.log("shit hit the fan: " + err);
    }
}

export interface Result {
    query?: {
        info: Server.Info,
        playerInfo: Server.PlayerInfo[],
    }
    err?: string
    time: number
}

async function getResults(ip: string, port: number): Promise<Result> {

    // If ip has no dots, assume it's a server's SteamID.
    // need to get actual IP from Steam API.
    if (!ip.includes(".")) {
        const actualIP = await getIPfromSteamID(ip);
        if (actualIP === undefined) {
            return {
                err: "NO API KEY",
                time: Date.now()
            }
        } else if (actualIP === null) {
            return {
                err: "NO IP FROM STEAM ID",
                time: Date.now()
            }
        } else {
            ip = actualIP.ip;
            port = actualIP.port;
        }
    }

    // Handle SDR ips separately
    if (ip.startsWith("169.254.")) {
        return getResultsSDR(ip, port)
    }

    // Query
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
            err: "QUERY FAILED",
            time: Date.now()
        };
    }
    return result;
}

async function getResultsSDR(ip: string, port: number): Promise<Result> {
    // Need an API key to do this
    if (!config.steamApiKey) {
        return {
            err: "NO API KEY",
            time: Date.now()
        };
    }

    // Convert IP to the format expected by Steam API
    // e.g. 169.254.1.1 -> (169 * 256^3) + (254 * 256^2) + (1 * 256) + 1 = 2851995905
    let decimalIp = ip.split(".").map(Number).reduce((acc, octet) => (acc << 8) + octet, 0);

    let result: Result | undefined = undefined;

    const baseQuery = `https://api.steampowered.com/IGameServersService/QueryByFakeIP/v1?key=${config.steamApiKey}&format=json` +
        `&fake_ip=${decimalIp}&fake_port=${port}&app_id=440&query_type=`;
    
    const serverQuery = `${baseQuery}1`; // Get server info
    const playerQuery = `${baseQuery}2`; // Get player info
    
    try {
        const serverDataPromise = getSteamAPI(serverQuery)
        const playerDataPromise = getSteamAPI(playerQuery)
        const [serverData, playerData] = await Promise.all([serverDataPromise, playerDataPromise]);
        result = {
            query: {
                info: {
                    address: `${ip}:${port}`,
                    ping: 0,
                    protocol: 0,
                    goldSource: false,
                    name: serverData?.response?.ping_data?.server_name ?? "N/A",
                    map: serverData?.response?.ping_data?.map ?? "N/A",
                    folder: serverData?.response?.ping_data?.gamedir ?? "N/A",
                    game: serverData?.response?.ping_data?.game_description ?? 0,
                    appID: 440,
                    players: {
                        online: serverData?.response?.ping_data?.num_players ?? 0,
                        max: serverData?.response?.ping_data?.max_players ?? 0,
                        bots: serverData?.response?.ping_data?.num_bots ?? 0
                    },
                    type: serverData?.response?.ping_data?.dedicated ? "dedicated" : "non-dedicated",
                    OS: 'linux',
                    visibility: serverData?.response?.ping_data?.password ? "private" : "public",
                    VAC: serverData?.response?.ping_data?.secure
                },
                playerInfo: playerData?.response?.players_data?.players?.map((player: any, index: number) => {
                    return {
                        index,
                        name: player.name ?? "N/A",
                        timeOnline: player.time_played ?? 0,
                        score: player.score ?? 0,
                    } as Server.PlayerInfo;
                }) ?? []
            },
            time: Date.now()
        };
    }
    catch (err) {
        console.log(err)
        console.error(`Error fetching SDR query for IP ${ip}`);
        return {
            err: "SDR QUERY FAILED",
            time: Date.now()
        };
    }

    return result;
}

client.login(config.discordToken);

// null if no IP found or query fails, undefined if no API key
export async function getIPfromSteamID(steamID: string): Promise<{ ip: string, port: number } | null | undefined> {
    if (!config.steamApiKey) {
        return undefined;
    }

    const query = `https://api.steampowered.com/IGameServersService/GetServerIPsBySteamID/v1?key=${config.steamApiKey}&format=json&input_json={"server_steamids":[${steamID}]}`;
    
    try {
        const data = await getSteamAPI(query)
        let ipPort = data?.response?.servers[0]?.addr ?? null;
        if (ipPort === null) {
            return null; // No IP found
        }
        const [ip, port] = ipPort.split(":");
        return { ip: ip, port: parseInt(port) };
    } catch {
        console.error(`Error fetching IP for SteamID ${steamID}`);
        return null;
    }
}

async function getSteamAPI(query: string): Promise<any> {
    const response = await axios.get(query);
    return response.data;
}
  
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
        const maxPlayers = result.query?.info.players.max ?? 0;

        const queryAge = calculateMinutesBetweenTimestamps(Date.now(), result.time, (resultArchive.length - 1) - i);
        const queryAgeString = queryAge === 0
            ? "       NOW: "
            : `${queryAge.toString().padStart(2)} MIN AGO: `
        //const mapNameString = `${result.query?.info.map.padEnd(longestMapNameLength) ?? "N/A"} `
        const playerCountString = ' ' + (result.query ? (onlinePlayers.toString()) : result.err ?? "UNKNOWN ERROR").padStart(maxPlayers.toString().length, ' ') + '\n';

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

function calculateMinutesBetweenTimestamps(timestamp1: number, timestamp2: number, index: number): number {
    if (index === 0) return 0;

    const date1 = new Date(timestamp1);
    const date2 = new Date(timestamp2);
    const diffMs = Math.abs(date2.getTime() - date1.getTime());
    const diffMins = Math.ceil(diffMs / 60000);
    return Math.max(index, diffMins - 1);
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

const ACTIVE = 0x00ff00;
const EMPTY = 0x008800;
const DISRUPTED = 0xffff00;
const OFFLINE = 0xff0000;
const FULL = 0x00ffaa;

function getTitleAndColor(resultArchive: Result[]): {title: string, notice: string, color: number, allowConnections?: boolean, sdr: boolean} {
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

    const sdr = mostRecentResult?.query?.info.address?.startsWith("169.254.") ?? false;
    
    // password protected
    if(consecutivefailCount < 2 && mostRecentResult?.query?.info.visibility === "private") {
        return {
            title: "Server is password-protected",
            notice: "[PASSWORD]: The server is password-protected for now.",
            color: DISRUPTED,
            allowConnections: false,
            sdr
        }
    }
    // server is full
    if(consecutivefailCount < 2 && mostRecentResult?.query &&
        mostRecentResult?.query?.info.players.online
        - mostRecentResult?.query?.info.players.bots
        >= mostRecentResult?.query?.info.players.max &&
        mostRecentResult?.query?.info.players.max > 0) {
        return {
            title: mostRecentResult?.query?.info.name,
            notice: "[FULL]: The server has no room for you!",
            color: FULL,
            allowConnections: false,
            sdr
        }
    }

    switch (consecutivefailCount) {
        case 0:
            const color = mostRecentResult?.query && mostRecentResult?.query?.info.players.online - mostRecentResult?.query?.info.players.bots === 0 ? EMPTY : ACTIVE;
            return {
                title: mostRecentResult?.query?.info.name ?? "Awaiting initial server query...",
                notice: "[ONLINE] Click the server name to instantly connect.",
                color: color,
                allowConnections: !!mostRecentResult,
                sdr
            }
        case 1:
            return {
                title: mostRecentResult?.query?.info.name ?? "Awaiting initial server query...",
                notice: "[DISRUPTED]: The server may be changing maps.",
                color: DISRUPTED,
                allowConnections: false,
                sdr
            }
        default:
            return {
                title: mostRecentResult?.query?.info.name ?? "Unavailable",
                notice: `[OFFLINE] Server failed ${
                consecutivefailCount > resultArchiveLimit ? `${resultArchiveLimit}+` : consecutivefailCount
                    } consecutive queries.`,
                color: OFFLINE,
                allowConnections: false,
                sdr
            }
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