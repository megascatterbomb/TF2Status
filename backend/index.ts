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

client.on('clientReady', () => {
    console.log(`Logged in as ${client.user?.tag}!`);
    mainLoop();
    startWebServer(config);
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
});

// CONFIG TYPES

export type PingConfig = {
    threshold: number,
    role: string,
}

export type TF2ServerConfig = {
    ip: string,
    port: number,
    urlPath: string,
    appID: number,
    supportsDirectConnect: boolean,
    connectString: string | undefined,
    description: string,
    channelID: string,
    graphDensity: number,
    modName: string | undefined // links store page using appID if defined
    pings: PingConfig[],
    alertChannelID: string | undefined
}

export type ExternalLinkConfig = {
    title: string,
    description: string,
    url: string
}

export type Config = {
    interval: number, // minutes
    queriesPerInterval: number
    pingCooldown: number, // minutes
    alertMessage: string,
    alertTime: number, // minutes
    alertDecayRate: number,
    discordToken: string,
    websiteTitle: string,
    urlBase: string,
    servers: TF2ServerConfig[],
    webPort: number,
    steamApiKey: string | undefined,
    fastdlPath: string | undefined,
    publishSite: boolean,
    externalLinks: ExternalLinkConfig[]
}

// RUNTIME TYPES

export type Ping = {
    config: PingConfig,
    triggerTime: number | undefined
}

const intervalMS = config.interval * 60 *  1000;
const pingCooldownMS = config.pingCooldown * 60 * 1000;

const resultArchiveLimit = 100;
const hysteresis = 3
const maxCharsFieldValue = 1024;
const maxQueries = 21; // 21 queries is the max that we show in a discord message (NOW and 1-20 MIN AGO).
const maxDisplay = 25; // 25 lines is the max that we show in a discord message (including map names)

// Use urlPath as key
let resultArchive = new Map<string, Result[]>(); 
let pingArchive = new Map<string, Ping[]>();
let alertArchive = new Map<string, boolean>();

export function getResultsArchive(): Map<string, Result[]> {
    return resultArchive;
}

// export let redirectIP: string | undefined = undefined;
// let redirectIPLastFetchTime: number = 0;

// async function fetchRedirectIP() {
//     const now = Date.now();
//     if ((!redirectIP && now - redirectIPLastFetchTime > redirectIPTimeout) || now - redirectIPLastFetchTime > redirectIPFetchInterval) {
//         redirectIPLastFetchTime = now;
//         try {
//             const response = await axios.get(`https://potato.tf/api/serverstatus/redirect`, {
//                 timeout: redirectIPTimeout,
//             });
//             const rip = response.data;
//             redirectIP = rip;
//         } catch (error) {
//             console.error("Error fetching Potato.tf redirect IP");
//             redirectIP = undefined;
//         }
//     }
// }

// fetchRedirectIP();

export function getConnectLinkSDR(sdrString: string, appID: number): string {
    return `steam://run/${appID}//+connect ${sdrString}`;
}

export let lastUpdateTime: number | undefined = undefined;

async function mainLoop() {

    config.servers.forEach(server => {
        server.pings.sort((a, b) => a.threshold - b.threshold);
        pingArchive.set(server.urlPath, server.pings.map(p => {
            return {
                config: p,
                triggerTime: undefined
            }
        }));
        alertArchive.set(server.urlPath, false);
    });

    let count = -1;

    while(true) {
        const time = Date.now();

        const updateString = count === 0 ? "=== PERFORMING QUERY + ARCHIVE === " : "=== PERFORMING QUERY ===";
        console.log(`${updateString}`);
        
        await Promise.allSettled(config.servers.map(async server => {
            await handleServer(server, count === 0);
        }))
        
        const time2 = Date.now();
        const actualInterval = intervalMS / config.queriesPerInterval;
        const nextInterval = (Math.floor(time2 / actualInterval) * actualInterval) + actualInterval;

        console.log(`Next update due at ${new Date(nextInterval)}`)

        await new Promise(r => setTimeout(r, nextInterval - time2));
        lastUpdateTime = time;

        if (count < 0) {
            resultArchive.clear();
        }

        count = (count + 1) % config.queriesPerInterval;
    }
}

async function handleServer(server: TF2ServerConfig, addToHistory: boolean) {
    try {
        // Skip if addToHistory is false and:
        // the most recent query has zero players, or
        // both of the last two queries failed
        if (!addToHistory && resultArchive.has(server.urlPath)) {
            const resultArray = resultArchive.get(server.urlPath) ?? [];
            const lastResult = resultArray.length >= 1 ? resultArray[resultArray.length - 1] : undefined;
            const secondLastResult = resultArray.length > 1 ? resultArray[resultArray.length - 2] : undefined;

            const lastPlayers = lastResult ? getPlayerCounts(lastResult)?.online ?? 0 : 0;

            if (lastPlayers === 0 || (lastResult?.query === undefined && secondLastResult?.query === undefined)) {
                console.log(`Skipping update for ${server.urlPath}`);
                return;
            }
        }

        const result = await getResults(server.ip, server.port, server.appID);

        let identity = server.urlPath;

        if(!resultArchive.has(identity)) {
            resultArchive.set(identity, [result]);
        } else if (addToHistory) {
            resultArchive.get(identity)?.push(result);
        } else {
            resultArchive.get(identity)?.splice(-1, 1, result);
        }

        const resultArray = resultArchive.get(identity) ?? [];

        await updateStatusEmbed(server, resultArray);
        await sendOutageAlerts(server, resultArray);

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

async function getResults(ip: string, port: number, appID: number): Promise<Result> {

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
        return getResultsSDR(ip, port, appID)
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

function getSDRQueryURL(ip: string, port: number, appID: number, queryType: number): string {
    // Convert IP to the format expected by Steam API
    // e.g. 169.254.1.1 -> (169 * 256^3) + (254 * 256^2) + (1 * 256) + 1 = 2851995905
    let decimalIp = ip.split(".").map(Number).reduce((acc, octet) => (acc << 8) + octet, 0);

    return `https://api.steampowered.com/IGameServersService/QueryByFakeIP/v1?key=${config.steamApiKey}&format=json` +
        `&fake_ip=${decimalIp}&fake_port=${port}&app_id=${appID}&query_type=${queryType}`;
}

async function getResultsSDR(ip: string, port: number, appID: number): Promise<Result> {
    // Need an API key to do this
    if (!config.steamApiKey) {
        return {
            err: "NO API KEY",
            time: Date.now()
        };
    }

    let result: Result | undefined = undefined;

    const serverQuery = getSDRQueryURL(ip, port, appID, 1);
    const playerQuery = getSDRQueryURL(ip, port, appID, 2);
    
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
                    appID: serverData?.response?.ping_data?.app_id ?? 440,
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
  
function buildServerActivity(resultArray: Result[], graphDensity: number = 4): string {
    while(resultArray.length > resultArchiveLimit) {
        resultArray.splice(0, resultArray.length - resultArchiveLimit)
    }

    let output = "```\n";
    let outputEnd = "```"

    let map = undefined;

    // Iterate by most recent first
    for(let i = resultArray.length - 1; i >= 0 && i >= resultArray.length - maxQueries; i-- ) {
        const result = resultArray[i];
        let newOutput = output;

        const players = getPlayerCounts(result);

        const queryAge = calculateMinutesBetweenTimestamps(Date.now(), result.time, (resultArray.length - 1) - i);
        const queryAgeString = queryAge === 0
            ? "       NOW: "
            : `${queryAge.toString().padStart(2)} MIN AGO: `
        //const mapNameString = `${result.query?.info.map.padEnd(longestMapNameLength) ?? "N/A"} `
        const playerCountString = ' ' + (players ? (players.online.toString()) : result.err ?? "UNKNOWN ERROR") + '\n';

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

        for(let j = players?.online ?? 0; j > 0; j-=increment) {
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

function getPings(server: TF2ServerConfig, result: Result): string {

    if (result.query === undefined || result.query.info.visibility === "private") return "";

    let now = Date.now();
    let toPing: string[] = [];

    let pings = pingArchive.get(server.urlPath) ?? [];
    const onlinePlayers = result.query.info.players.online - (result.query.info.players.bots ?? 0);

    pingArchive.set(server.urlPath, pings.map(ping => {
        if(ping.triggerTime === undefined && onlinePlayers >= ping.config.threshold) {
            ping.triggerTime = now;
            toPing.push(ping.config.role);
        } else if (onlinePlayers <= ping.config.threshold - hysteresis && now - (ping.triggerTime ?? now) > pingCooldownMS) {
            ping.triggerTime = undefined;
        }
        return ping;
    }));

    return toPing.map(s => `<@&${s}>`).join(" ")
}

const ACTIVE = 0x00ff00;
const EMPTY = 0x008800;
const DISRUPTED = 0xffff00;
const OFFLINE = 0xff0000;
const FULL = 0x00ffaa;

function getTitleAndColor(server: TF2ServerConfig, resultArray: Result[]): {title: string, notice: string, color: number, allowConnections?: boolean, sdr: boolean} {
    
    const { raw: consecutivefailCount, mostRecentResult } = getFailureCount(resultArray);

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
                notice: server.supportsDirectConnect && !!mostRecentResult
                    ? "[ONLINE] Click the server name to instantly connect."
                    : "[ONLINE] Use the console command below to connect.",
                color: color,
                allowConnections: server.supportsDirectConnect && !!mostRecentResult,
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

function buildPingActivity(server: TF2ServerConfig): string {
    const buildRow = (ping: Ping): string => {
        const start = `${ping.config.threshold} PLAYER PING: `
        if(ping.triggerTime === undefined) return `${start}READY`;
        if(Date.now() - ping.triggerTime > pingCooldownMS) return `${start}RESETS BELOW ${ping.config.threshold - hysteresis + 1} PLAYERS`;
        
        const timeRemaining = ping.triggerTime + pingCooldownMS - Date.now();
        const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutes = Math.floor(timeRemaining / (1000 * 60)) % 60

        return `${start}ON COOLDOWN ${hours}h ${minutes}m`
    }

    const pings = pingArchive.get(server.urlPath) ?? [];

    return "```" + pings.map(ping => buildRow(ping)).join("\n") + "```"
}

async function updateStatusEmbed(server: TF2ServerConfig, resultArray: Result[]) {
    const channel = await client.channels.fetch(server.channelID) as TextChannel;
    const lastMessage = (await channel.messages.fetch({ limit: 1 })).first();

    const result = resultArray[resultArray.length - 1];

    const { title, notice, color, allowConnections, sdr } = getTitleAndColor(server, resultArray);
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

    const players = getPlayerCounts(result);

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
            value: players
                ? `${players.online}/${players.max}${(players.bots) > 0 ? ` (${players.bots} bots)` : ""}`
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
        value: buildServerActivity(resultArray, server.graphDensity),
        inline: false
    });

    let connectUrl: string | undefined = undefined;
    if (allowConnections) {
        connectUrl = `${config.urlBase}/tf2/${server.urlPath}`;
    }

    let description = "\`\`\`" + server.description + (notice ? "\n\n" + notice : "") + "\`\`\`";

    if (server.modName) {
        const modUrl = `https://store.steampowered.com/app/${server.appID}/`;
        description = `A server for [${server.modName}](${modUrl})\n` + description;
    }

    const embed = new EmbedBuilder({
        title: title,
        url: connectUrl,
        description,
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
}

async function sendOutageAlerts(server: TF2ServerConfig, resultArray: Result[]) {
    if (!server.alertChannelID) return;

    const channel = await client.channels.fetch(server.alertChannelID) as TextChannel;
    const isAlerting = alertArchive.get(server.urlPath);
    const { withDecay: failureCount } = getFailureCount(resultArray);

    if (!isAlerting && failureCount >= config.alertTime) { // Send Alert
        
    } else if (isAlerting && failureCount <= 0) { // Send resolution notice

    }
}

function getFailureCount(resultArray: Result[]): { raw: number, withDecay: number, mostRecentResult: Result | undefined } {

    let rawFailureCount = 0;
    let mostRecentResult: Result | undefined = undefined;
    
    for(let i = resultArray.length - 1; i >= 0; i-- ) {
        const result = resultArray[i];
        if (result.query === undefined) {
            rawFailureCount++;
        } else {
            mostRecentResult = result;
            break;
        }
    }

    let withDecayFailureCount = 0;

    for (let i = 0; i < resultArray.length; i++) {
        const result = resultArray[i];
        if (result.query === undefined) {
            withDecayFailureCount++;
            if (withDecayFailureCount > config.alertTime) withDecayFailureCount = config.alertTime;
        } else {
            withDecayFailureCount -= config.alertDecayRate;
            if (withDecayFailureCount < 0) withDecayFailureCount = 0;
        }
    }

    return {
        raw: rawFailureCount,
        withDecay: withDecayFailureCount,
        mostRecentResult
    }
}

function getPlayerCounts(result: Result): { online: number, max: number, bots: number } | undefined {

    if (result.query === undefined) return;

    return {
        online: result.query.info.players.online - result.query.info.players.bots,
        max: result.query.info.players.max,
        bots: result.query.info.players.bots
    }
}