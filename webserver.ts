import fs from "fs";
import express, {Request, Response} from "express";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("dotenv").config();

const port = process.env.ENVIRONMENT === "PRODUCTION" ? 3000 : 3001;

export function startWebServer() {
    if(process.env.ENVIRONMENT === "NOWEB" || !(process.env.TF2_SERVER_URL && process.env.FASTDL_PATH)) {
        return;
    }
    console.log("test");
    const app = express();
    app.get("/tf2", (req: Request, res: Response) => {
        if(process.env.TF2_SERVER_URL) {
            res.redirect(process.env.TF2_SERVER_URL);
        } else {
            res.sendStatus(503);
        }
    })
    app.get("/tf2/*", (req: Request, res: Response) => {
        if (req.params[0]) {
            const fastDLRoot = process.env.FASTDL_PATH;
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
    app.listen(port);
}