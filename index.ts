import Discord, { TextChannel, ThreadAutoArchiveDuration, User, Message, Attachment, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import https from 'https';
import { resolve } from 'path';
import url from 'url';
import fs from 'fs';
import {Server} from '@fabricio-191/valve-server-query'

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
const resultArchiveLimit = 20;

async function mainLoop() {
    let prevtime: number | undefined = undefined;
    const channelID = process.env.CHANNEL ?? "";
    const channel = await client.channels.fetch(channelID) as TextChannel;
    const ip = process.env.SERVER_IP ?? ""
    const port: number =  Number.parseInt(process.env.SERVER_PORT ?? "0");

    let resultArchive: Result[] = [];

    while(true) {
        const time = Date.now();
        try {
            // Get image
            const lastMessage = (await channel.messages.fetch({ limit: 1 })).first();
            const result = await getResults(ip, port);

            resultArchive.push(result);

            const embed = new EmbedBuilder({
                title: result.query?.info.name ?? "Server may be offline...",
                url: process.env.LINK_TO_SERVER,
                description: process.env.DESCRIPTION,
                timestamp: Date.now(),
                color: result.query === undefined ? 0xff0000 : 0x00ff00,
                fields: [
                    {
                        name: "Map:",
                        value: result.query?.info.map ?? "N/A",
                        inline: true
                    },
                    {
                        name: "Current Players:",
                        value: `${result.query?.info.players.online ?? "N"}/${result.query?.info.players.max ?? "A"}`,
                        inline: true
                    },
                    {
                        name: "Connect via console:",
                        value: `connect ${process.env.SERVER_DOMAIN ?? process.env.SERVER_IP ?? "?"}`,
                        inline: true
                    },
                    {
                        name: "Server Activity:",
                        value: buildServerActivity(resultArchive)
                    }
                ]
            })
            if(lastMessage && lastMessage.author.id === client.user?.id) {
                await lastMessage.edit({embeds: [embed]})
            } else {
                await channel.send({embeds: [embed]})
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
    const maxCharsFieldValue = 1024
    const maxCharsLine = 61
    while(resultArchive.length > resultArchiveLimit) {
        resultArchive.splice(0, resultArchive.length - resultArchiveLimit)
    }

    const mapNames = resultArchive.filter(r => r !== undefined).map(r => r.query?.info.map ?? "")
    const longestMapNameLength = mapNames.reduce((prev, curr) => {
        return curr.length > prev.length ? curr : prev
    }).length

    let output = "```\n";
    let outputEnd = "```"
    // Iterate by most recent first
    for(let i = resultArchive.length - 1; i >= 0; i-- ) {
        const result = resultArchive[i];
        let newOutput = output;

        const queryAge = calculateMinutesBetweenTimestamps(Date.now(), result.time);
        const queryAgeString = queryAge === 0
            ? "       NOW: "
            : `${queryAge.toString().padStart(2)} MIN AGO: `
        const mapNameString = `${result.query?.info.map.padEnd(longestMapNameLength) ?? "N/A"} `
        const playerCountString = ` ${result.query?.info.players.online ?? "N"}/${result.query?.info.players.max ?? "A"}\n`

        let playerGraphString = ""
        const increment = Math.max((result.query?.info.players.max ?? 100)/(maxCharsLine - queryAgeString.length - mapNameString.length - playerCountString.length), 1)
        for(let j = 0; j < (result.query?.info.players.online ?? 0); j+=increment) {
            playerGraphString += "|"
        }

        newOutput += queryAgeString;
        newOutput += mapNameString;
        newOutput += playerGraphString;
        newOutput += playerCountString;
        
        if(newOutput.length > maxCharsFieldValue - outputEnd.length) {
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
  

