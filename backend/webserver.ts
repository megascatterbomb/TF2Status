import fs from "fs";
import express, {Request, Response} from "express";
import path from "path";
import { Config, ExternalLink, getIPfromSteamID, getResultsArchive, redirectIP, Result } from ".";

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
    servers: { id: string, results: SimpleResult[] }[],
    redirectIP?: string
}

function jsonResultsArchive(resultArchive: Map<string, Result[]>): APIQuery {
    const simpleForms: APIQuery = {
        externalLinks: config.externalLinks,
        servers: [],
        redirectIP
    };
    resultArchive.forEach((resultArray, key) => {
        simpleForms.servers.push({id: key, results: resultArray.map(result => transformResult(key, result))});
    });
    simpleForms.servers.sort((a, b) => {
        const aName = a.results[a.results.length - 1].serverName;
        const bName = b.results[b.results.length - 1].serverName;

        return aName.localeCompare(bName);
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
            if (!ip.includes(".")) {
                const actualIP = await getIPfromSteamID(ip);
                if (actualIP === undefined || actualIP === null) {
                    res.status(500).send("<h1>Could not resolve server IP address. Wait a few seconds and refresh.</h1>");
                    return;
                } else if (actualIP.ip.startsWith("169.254.")) {
                    res.status(200).send(`<h1>SDR is enabled: connect by typing "connect ${actualIP.ip}:${actualIP.port}" in your TF2 console.</h1>`);
                    return;
                } else {
                    ip = actualIP.ip;
                    port = actualIP.port;
                }
            }

            res.redirect(`steam://connect/${ip}:${port}`);
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
            const resultsJSON = jsonResultsArchive(results);
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
        }
        res.sendFile(path.join(__dirname, "../frontend/dist/" + target));
    })
    app.listen(config.webPort);
}