import Discord, { TextChannel, ThreadAutoArchiveDuration, User, Message, Attachment, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import https from 'https';
import { resolve } from 'path';
import url from 'url';
import fs from 'fs';
import {Server} from '@fabricio-191/valve-server-query'
import { getPackedSettings } from 'http2';

console.log("Starting process...")

require("dotenv").config();

const client = new Discord.Client({
    intents: []
});

client.on('ready', () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  mainLoop();
});

const queryInterval = 1 * 60 * 1000;
const resultArchiveLimit = 100;
const pingTimeLimit = 2 * 60 * 60 * 1000;
const hysteresis = 3

const maxCharsFieldValue = 1024;
const maxCharsLine = 49;

const lowThreshold = Number.parseInt(process.env.PING_THRESHOLD_LOW ?? Number.MAX_SAFE_INTEGER.toString())
const midThreshold = Number.parseInt(process.env.PING_THRESHOLD_MID ?? Number.MAX_SAFE_INTEGER.toString()) 
const highThreshold = Number.parseInt(process.env.PING_THRESHOLD_HIGH ?? Number.MAX_SAFE_INTEGER.toString())

let pingTimeLow: number | undefined
let pingTimeMid: number | undefined
let pingTimeHigh: number | undefined

async function mainLoop() {
    let prevtime: number | undefined = undefined;
    const channelID = process.env.CHANNEL ?? "";
    const channel = await client.channels.fetch(channelID) as TextChannel;
    const ip = process.env.SERVER_IP ?? ""
    const port: number =  Number.parseInt(process.env.SERVER_PORT ?? "0");

    const lowThreshold = Number.parseInt(process.env.PING_THRESHOLD_LOW ?? Number.MAX_SAFE_INTEGER.toString())
    const midThreshold = Number.parseInt(process.env.PING_THRESHOLD_MID ?? Number.MAX_SAFE_INTEGER.toString()) 
    const highThreshold = Number.parseInt(process.env.PING_THRESHOLD_HIGH ?? Number.MAX_SAFE_INTEGER.toString())

    let resultArchive: Result[] = [];

    while(true) {
        const time = Date.now();
        try {
            // Get image
            const lastMessage = (await channel.messages.fetch({ limit: 1 })).first();
            const result = await getResults(ip, port);

            resultArchive.push(result);

            const {title, color, allowConnections} = getTitleAndColor(resultArchive)

            const pings = getPings(result);

            const embed = new EmbedBuilder({
                title: title,
                url: (allowConnections ? process.env.LINK_TO_SERVER : undefined),
                description: process.env.DESCRIPTION,
                timestamp: Date.now(),
                color: color,
                fields: [
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
                        value: `\`connect ${process.env.SERVER_DOMAIN ?? process.env.SERVER_IP ?? "?"}\``,
                        inline: true
                    },
                    {
                        name: "Activity Pings:",
                        value: buildPingActivity()
                    },
                    {
                        name: "Recent History:",
                        value: buildServerActivity(resultArchive)
                    }
                ]
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
        const time2 = Date.now();
        const nextInterval = (Math.floor(time2 / queryInterval) * queryInterval) + queryInterval
        await new Promise(r => setTimeout(r, nextInterval - time2));
        prevtime = time;
    }
}

interface Result {
    query: {
        info: Server.Info,
        playerInfo: Server.PlayerInfo[],
    } | undefined
    time: number
}

function getCooldownText(pingTime: number | undefined): string {
    if(pingTime === undefined) return "Ready";
    if(Date.now() - pingTime > pingTimeLimit) return "Waiting for inactivity...";
    return `Pinged <t:${Math.floor(pingTime / 1000)}:R>`;
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

client.login(process.env.DISCORD_TOKEN);
  
function buildServerActivity(resultArchive: Result[]): string {
    while(resultArchive.length > resultArchiveLimit) {
        resultArchive.splice(0, resultArchive.length - resultArchiveLimit)
    }

    const maxQueries = 21;
    const maxDisplay = 25; 

    let output = "```\n";
    let outputEnd = "```"

    let map = undefined;

    // Iterate by most recent first
    for(let i = resultArchive.length - 1; i >= 0 && i >= resultArchive.length - maxQueries; i-- ) {
        const result = resultArchive[i];
        let newOutput = output;

        const queryAge = calculateMinutesBetweenTimestamps(Date.now(), result.time);
        const queryAgeString = queryAge === 0
            ? "       NOW: "
            : `${queryAge.toString().padStart(2)} MIN AGO: `
        //const mapNameString = `${result.query?.info.map.padEnd(longestMapNameLength) ?? "N/A"} `
        const playerCountString = result.query ? (" " + ((result.query?.info.players.online ?? 0) - (result.query?.info.players.bots ?? 0)) + "\n").padStart(5) : "N/A\n";

        let playerGraphString = ""
        const increment = Math.max((result.query?.info.players.max ?? 100)/(maxCharsLine - queryAgeString.length - playerCountString.length), 1)
        for(let j = 0; j < (result.query?.info.players.online ?? 0) - (result.query?.info.players.bots ?? 0); j+=increment) {
            playerGraphString += "|"
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

function getPings(result: Result): string {

    if(result.query?.info.visibility === "private") {
        return "";
    }

    let now = Date.now();

    if(result.query === undefined) {
        return "";
    }

    const onlinePlayers = result.query.info.players.online - (result.query.info.players.bots ?? 0);

    const low = pingTimeLow === undefined && onlinePlayers >= lowThreshold;
    const mid = pingTimeMid === undefined && onlinePlayers >= midThreshold;
    const high = pingTimeHigh === undefined && onlinePlayers >= highThreshold;

    if(low) pingTimeLow = now;
    if(mid) pingTimeMid = now;
    if(high) pingTimeHigh = now;

    if(!low && onlinePlayers < (lowThreshold - hysteresis + 1) && now - (pingTimeLow ?? now) > pingTimeLimit) pingTimeLow = undefined;
    if(!mid && onlinePlayers < (midThreshold - hysteresis + 1) && now - (pingTimeMid ?? now) > pingTimeLimit) pingTimeMid = undefined;
    if(!high && onlinePlayers < (highThreshold - hysteresis + 1) && now - (pingTimeHigh ?? now) > pingTimeLimit) pingTimeHigh = undefined;

    return [
        low ? process.env.PING_ROLE_LOW ?? "" : "",
        mid ? process.env.PING_ROLE_MID ?? "" : "",
        high ? process.env.PING_ROLE_HIGH ?? "" : ""
    ].filter(s => s.length > 0).map(s => `<@&${s}>`).join(" ")
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

    if(consecutivefailCount < 2 && mostRecentResult?.query &&
        mostRecentResult?.query?.info.players.online
        - mostRecentResult?.query?.info.players.bots
        === mostRecentResult?.query?.info.players.max) {
            return {title: "Server is FULL!", color: 0x00ffaa, allowConnections: false}
    }

    switch (consecutivefailCount) {
        case 0:
            return {title: mostRecentResult?.query?.info.name ?? "Awaiting initial server query...", color: 0x00ff00, allowConnections: true}
        case 1:
            return {title: mostRecentResult?.query?.info.name ?? "Awaiting initial server query...", color: 0xffff00, allowConnections: true}
        default:
            return {title: `Server is offline (failed ${consecutivefailCount} queries)`, color: 0xff0000, allowConnections: false}
    }
}

function getPlayerCountString(result: Result): string {

    if(!result.query) {
        return "N/A";
    }
    const playerCount = result.query?.info.players.online - result.query?.info.players.bots;
    if(playerCount === (result.query?.info.players.max ?? 100)) {
        return "FULL!";
    }

    let output = `${result.query?.info.players.online}/${result.query?.info.players.max}`;
    return output;
}

function buildPingActivity(): string {
    const buildRow = (time: number | undefined, threshold: number): string => {
        const start = `${threshold} PLAYER PING: `
        if(time === undefined) return `${start}READY`;
        if(Date.now() - time > pingTimeLimit) return `${start}WAITING FOR INACTIVITY (<=${threshold - hysteresis} PLAYERS)`;
        
        const timeRemaining = time + pingTimeLimit - Date.now();
        const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutes = Math.floor(timeRemaining / (1000 * 60)) % 60

        return `${start}ON COOLDOWN ${hours}h ${minutes}m`
    }

    return "```" + [
        buildRow(pingTimeLow, lowThreshold),
        buildRow(pingTimeMid, midThreshold),
        buildRow(pingTimeHigh, highThreshold)
    ].join("\n") + "```"
}

