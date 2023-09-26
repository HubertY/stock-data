import express from "express";
import request from "request-promise";
import * as cheerio from "cheerio";

const CACHE: Record<string, string> = {};

export async function grab(ticker: string) {
    let ret = {} as Record<string, string>;
    const ss = [`https://finance.yahoo.com/quote/${ticker}`,
    `https://finance.yahoo.com/quote/${ticker}/key-statistics?p=${ticker}`]
    for (const s of ss) {
        const data = await request(s);
        const $ = cheerio.load(data);
        for (const node of $("script")) {
            $(node).remove();
        }
        for (const node of $("tr")) {
            const cells = $(node).find("td");
            if (cells.length >= 2) {
                const attr = $(cells[0]).text();
                const val = $(cells[1]).text();
                if (attr && val) {
                    ret[attr.trim()] = val.trim();
                }
            }
        }
    }
    return ret;
}

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3000");

app.use(express.static('dist'));
app.get('/endpoint', async (req, res) => {
    const ticker = !!req.query.ticker && req.query.ticker.toString().trim().toUpperCase();
    const nocache = !!req.query.nocache && req.query.nocache.toString().trim().toLowerCase() === "true";
    if (ticker) {
        console.log(ticker);
        if (!CACHE[ticker] || nocache) {
            CACHE[ticker] = JSON.stringify(await grab(ticker.toString()));
        }
        res.send(CACHE[ticker]);
    }
    else {
        res.send("{}");
    }

});
const server = app.listen(PORT, () => console.log(`Server listening on port: ${PORT}`));

process.on('SIGINT', () => {
    server.close(() => {
        process.exit(0);
    });
});