#!/usr/bin/env node
'use strict'
import fs, {mkdirSync, readFileSync, writeFileSync} from "fs";
import * as path from "path";
import Puppeteer, {Browser, BrowserConnectOptions, BrowserLaunchArgumentOptions, LaunchOptions, Page} from "puppeteer";
import {build} from "esbuild"
import {createServer} from "http";
import {Readable} from "stream";

const {TextDecoder} = require('util');
const decoder = new TextDecoder('utf-8')

function files(dir: string): string[] {
    return fs.readdirSync(dir)
        .reduce(
            (acc: string[], f: string) => {
                const fullPath = `${dir}/${f}`;
                return fs.statSync(fullPath).isDirectory()
                    ? [...acc, ...files(fullPath)]
                    : [...acc, fullPath];
            },
            [] as string[]);
}

const testFiles = files(".")
    .filter((f: string) => {
        return f.endsWith("test.ts")
    });

const mochaJs = path.relative(process.cwd(), path.dirname(require.resolve('mocha')) + "/mocha.js");
const mochaCss = path.relative(process.cwd(), path.dirname(require.resolve('mocha')) + "/mocha.css");

const buildHtml = (mochaCss: string, mochaJs: string, js: string) => `<!DOCTYPE html>
<html>
<head>
    <title>Mocha Tests</title>
    <meta charset="utf-8">
    <style>
    ${mochaCss}
    </style>
</head>
<body>
<div id="mocha"></div>
<script type="text/javascript">
    ${mochaJs}

    mocha.setup('bdd');

    ${js}
</script>
</body>
</html>`

console.log(testFiles);

const importMocha = testFiles.filter(f => {
    const file = decoder.decode(fs.readFileSync(f));
    return /from\s+['"]mocha['"]/.test(file);
});
if (importMocha.length !== 0) {
    throw new Error(`Importing 'describe' or 'it' from mocha in test files breaks browser testing in ${importMocha.join(", ")}`);
}

function getExtraOpts(): LaunchOptions & BrowserLaunchArgumentOptions & BrowserConnectOptions {
    if (!process.env.PUPPETEER_EXEC_PATH) return {};
    console.log(`PUPPETEER_EXEC_PATH=${process.env.PUPPETEER_EXEC_PATH}`)
    return {executablePath: process.env.PUPPETEER_EXEC_PATH};
}

async function launchPuppeteerBrowser(extraOpts: object) {
    return time(
        "Launched Puppeteer",
        Puppeteer.launch.bind(Puppeteer)(
            {
                headless: true,
                args: ['--no-sandbox'],
                ...extraOpts
            })
    );
}

function pipePageConsoleToProcConsole(page: Page) {
    page.on("console", (message: any) => {
        (async () => {
            const args = await Promise.all(message.args().map((a: any) => a.jsonValue()));
            const log = (console as any)[message.type()];
            typeof log === 'function'
                ? log(...args)
                : console.log(...args);
        })();
    });
}

async function openPage(browser: Browser) {
    const page = await browser.newPage();
    pipePageConsoleToProcConsole(page);
    return page;
}

async function runMochaTests(page: Page, parcelServerUrl: string) {
    if (process.env.PUPPETEER_LOAD_TIMEOUT_MILLIS) console.log("Using PUPPETEER_LOAD_TIMEOUT_MILLIS=" + process.env.PUPPETEER_LOAD_TIMEOUT_MILLIS)
    let puppeteerTimeout = process.env.PUPPETEER_LOAD_TIMEOUT_MILLIS ? parseInt(process.env.PUPPETEER_LOAD_TIMEOUT_MILLIS) : 20000;

    await page.goto(parcelServerUrl, {waitUntil: 'load', timeout: puppeteerTimeout});

    await page.evaluate(() => {
        return new Promise((resolved: Function, rejected: Function) => {
            // @ts-ignore
            mocha
                .reporter('spec')
                .run((failures: any) => failures == 0
                    ? resolved("SUCCESS")
                    : rejected("FAILED: " + failures))
        });
    });
}

async function time<T>(desc: string, p: Promise<T>): Promise<T> {
    const start = Date.now();
    const result = await p;
    console.log(`${desc} (${Date.now() - start}ms)`);

    return result;
}

async function run() {
    const outdir = ".muppeteer";
    const index = testFiles.reduce((acc, file) => {
        return acc + `import '${file.replace(/^.\//, "../").replace(/.ts$/, "")}';\n`;
    }, "")
    const indexInput = path.join(outdir, "index.ts");
    if (!fs.existsSync(outdir))
        mkdirSync(outdir);
    writeFileSync(indexInput, index);
    const indexOutput = path.join(outdir, "index.js");
    await time(
        "Bundled test files",
        build({
            bundle: true,
            entryPoints: [indexInput],
            sourcemap: "inline",
            outfile: indexOutput
        })
    )

    const builtHtml = buildHtml(
        readFileSync(mochaCss).toString("utf8"),
        readFileSync(mochaJs).toString("utf8"),
        readFileSync(indexOutput).toString("utf8"))

    const server = createServer((req, res) => {
        const s = new Readable();
        s._read = () => {
        }; // redundant? see update below
        s.push(builtHtml);
        s.push(null);

        res.writeHead(200, {"Content-Type": "text/html"})
        s.pipe(res)
    });
    const serverStartPromise = new Promise<void>(resolve =>
        server.listen(1234, () => {
            resolve();
        }))
    ;

    const browser: Browser = await launchPuppeteerBrowser(getExtraOpts());

    try {
        const page = await openPage(browser);

        await serverStartPromise;

        await time(
            "Ran tests",
            runMochaTests(page, "http://localhost:1234")
        );
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run()
    .then(value => {
        process.exit(0);
    })
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
