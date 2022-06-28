#!/usr/bin/env node
'use strict'
import fs from "fs";
import * as path from "path";
import Puppeteer, {Browser, BrowserConnectOptions, BrowserLaunchArgumentOptions, LaunchOptions, Page} from "puppeteer";
import {ChildProcess} from "child_process";

const {spawn} = require('child_process');
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

const mochaDir = path.relative(process.cwd(), path.dirname(require.resolve('mocha')));
const html = `<!DOCTYPE html>
<html>
<head>
    <title>Mocha Tests</title>
    <meta charset="utf-8">
    <link rel="stylesheet" href="${mochaDir}/mocha.css">
</head>
<body>
<div id="mocha"></div>
<script type="text/javascript" src="${mochaDir}/mocha.js"></script>
<script type="text/javascript">mocha.setup('bdd');</script>
${testFiles.map(f => `<script src="${f}"></script>`).join("\n")}
</body>
</html>`

const htmlFile = `${process.cwd()}/mocha.html`;
fs.writeFileSync(htmlFile, html);
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
    return await Puppeteer.launch.bind(Puppeteer)(Object.assign(
        {
            headless: true,
            args: ['--no-sandbox']
        },
        extraOpts));
}

function parcelServerRunning(parcel: ChildProcess) {
    return new Promise((resolve, reject) => {
        parcel.on("exit", (code: number | null) => {
            if (code == 0) {
                resolve(code);
            } else {
                reject(code);
            }
        })
        // noinspection TypeScriptValidateTypes
        parcel.stdout?.on("data", (chunk: any):void => {
            const text = decoder.decode(chunk)
            if (text.includes("Server running at ")) {
                resolve(null)
            }
        });
    });
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
    if(process.env.PUPPETEER_LOAD_TIMEOUT_MILLIS) console.log("Using PUPPETEER_LOAD_TIMEOUT_MILLIS="+process.env.PUPPETEER_LOAD_TIMEOUT_MILLIS)
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

async function run() {
    const parcel = spawn("parcel", ["serve", "mocha.html"]);
    parcel.stdout.pipe(process.stdout);
    parcel.stderr.pipe(process.stderr);

    const parcelServerPromise = parcelServerRunning(parcel);
    const browser: Browser = await launchPuppeteerBrowser(getExtraOpts());

    try {
        // We open page in puppeteer and have parcel compiling in parallel...
        const page = await openPage(browser);

        // ...and then wait for parcel to catch up
        await parcelServerPromise;

        await runMochaTests(page, "http://localhost:1234");
    } finally {
        await browser.close();
        parcel.kill();
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
