import fs from "fs";
import express, {Request, Response} from "express";
import path from "path";
import { Config } from ".";


export function startWebServer(config: Config) {
    const app = express();
    config.servers.forEach(server => {
        app.get(`/tf2/${server.urlPath}`, (req: Request, res: Response) => {
            res.redirect(`steam://connect/${server.ip}:${server.port}`);
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
    app.listen(config.webPort);
}