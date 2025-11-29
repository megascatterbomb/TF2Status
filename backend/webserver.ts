import fs from "fs";
import express, {Request, Response} from "express";
import path from "path";
import { Config, ExternalLink, getConnectLinkSDR, getIPfromSteamID, getResultsArchive, Result } from ".";

let config = require("./config.json") as Config;

interface SimpleResult {
    serverName: string;
    serverAddress: string;
    onlinePlayers: number;
    maxPlayers: number;
    password: boolean;
    map: string;
    sdr: boolean
}

interface APIQuery {
    externalLinks: ExternalLink[],
    servers: {
        urlPath: string,
        supportsDirectConnect: boolean,
        results: SimpleResult[],
        modName: string | undefined,
        appID: number
    }[],
    urlBase: string,
    redirectIP?: string
}

function jsonResultsArchive(resultArchive: Map<string, Result[]>): APIQuery {
    const simpleForms: APIQuery = {
        externalLinks: config.externalLinks,
        servers: [],
        urlBase: config.urlBase
    };
    resultArchive.forEach((resultArray, urlPath) => {
        const serverConfig = config.servers.find(s => s.urlPath === urlPath);
        simpleForms.servers.push({
            urlPath,
            supportsDirectConnect: serverConfig?.supportsDirectConnect ?? false,
            results: resultArray.map(result => transformResult(urlPath, result)),
            modName: serverConfig?.modName,
            appID: serverConfig?.appID ?? 440
        });
    });
    simpleForms.servers.sort((a, b) => {
        const aIndex = config.servers.findIndex(s => s.urlPath === a.urlPath);
        const bIndex = config.servers.findIndex(s => s.urlPath === b.urlPath);

        return aIndex - bIndex;
    });
    return simpleForms;
}

function transformResult(id: string, result: Result): SimpleResult {

    const serverName = result.query?.info.name ?? "";
    const serverAddress = result.query?.info.address ?? "";
    const onlinePlayers = (result.query?.info.players.online ?? 0) - (result.query?.info.players.bots ?? 0);
    const maxPlayers = result.query?.info.players.max ?? 0;
    const map = result.query?.info.map ?? "N/A";

    return {
        serverName,
        serverAddress,
        onlinePlayers,
        maxPlayers,
        map,
        password: result.query?.info.visibility == "private",
        sdr: serverAddress.startsWith("169.254.")
    }
}

export function startWebServer(config: Config) {
    const app = express();
    config.servers.forEach(server => {
        app.get(`/tf2/${server.urlPath}`, async (req: Request, res: Response) => {

            let ip = server.ip;
            let port = server.port;
            const requesterIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";


            if (!ip.includes(".")) {
                const actualIP = await getIPfromSteamID(ip);
                if (actualIP === undefined || actualIP === null) {
                    res.status(500).send("<h1>Could not resolve server IP address. Wait a few seconds and refresh.</h1>");
                    return;
                }
                ip = actualIP.ip;
                port = actualIP.port;
            }
                
            if (!server.supportsDirectConnect) {
                res.status(200).send(
                    "<h1>Direct connect is not supported for this server.</h1>"
                    + `<p>Try connecting through console with the command <code>connect ${ip}:${port}</code></p>`
                    + `<p>If that fails, check the server status <a href="${config.urlBase}">here</a>.</p>`
                );
                return;
            }

            if (ip.startsWith("169.254.")) {
                const sdrLink = getConnectLinkSDR(`${ip}:${port}`, server.appID);
                if (!sdrLink) {
                    res.status(500).send(
                        "<h1>Could not resolve server IP address. Wait a few seconds and refresh.</h1>"
                        + `<p>If the issue persists, try connecting through console with the command <code>connect ${ip}:${port}</code></p>`
                        + `<p>If that fails, check the server status <a href="${config.urlBase}">here</a>.</p>`
                    );
                    return;
                }
                res.redirect(sdrLink);
                console.log(`Redirected ${requesterIP} to ${sdrLink}`);
                return;
            }

            const steamLink = `steam://connect/${ip}:${port}`;
            res.redirect(steamLink);
            console.log(`Redirected ${requesterIP} to ${steamLink}`);
        })
    });
    
    app.get("/tf2/*", (req: Request, res: Response) => {
        if (req.params[0]) {
            const fastDLRoot = config.fastdlPath;
            if(!fastDLRoot) {
                res.sendStatus(404);
                return;
            }
            const assetPath = path.join(fastDLRoot, req.params[0]);
            if(!fs.existsSync(assetPath)) {
                res.sendStatus(404);
                return;
            }
            const requesterIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
            console.log(`Serving asset ${req.params[0]} to ${requesterIP}`);
            res.download(assetPath);
        } else {
            res.sendStatus(503);
        }
    })

    app.get("/api", (req: Request, res: Response) => {
        const results = getResultsArchive();
        if (results.size === 0) {
            res.status(404).send("No results available");
            return;
        }
        try {
            const requesterIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
            const resultsJSON = jsonResultsArchive(results);
            console.log(`Serving API data to ${requesterIP}`);
            res.status(200).send(resultsJSON);
        } catch {
            res.sendStatus(500);
            return;
        }
    })

    app.get("/*", (req: Request, res: Response) => {
        let target = "index.html";
        if (req.params[0]) {
            target = req.params[0];
        } else {
            const requesterIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "unknown";
            console.log("Serving main site to " + requesterIP);
        }
        res.sendFile(path.join(__dirname, "../frontend/dist/" + target));
    })
    app.listen(config.webPort);
}