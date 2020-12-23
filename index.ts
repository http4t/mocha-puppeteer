#!/usr/bin/env node
'use strict'
import fs from "fs";
import {Browser} from "puppeteer";

const path = require('path');
const Puppeteer = require('puppeteer');
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

function findMocha(dir: string, log: string[] = []): string {
    const packageFile = `${dir}/package.json`;
    if (fs.statSync(packageFile).isFile()) {
        const mochaDir = `${dir}/node_modules/mocha`;
        if (fs.existsSync(mochaDir)) {
            return mochaDir;
        }
        // Do not throw an error if using yarn workspaces- look for mocha in the root project
        const pack = JSON.parse(fs.readFileSync(packageFile).toString('utf-8'));
        if (pack.type !== "module")
            throw new Error(`Expected to find mocha at ${mochaDir}`);

        log.push(`${dir}: no node_modules/mocha, but "type"="module", so continuing to search for root package.json`)
    } else {
        log.push(`${dir}: no package.json`)
    }
    const parent = path.dirname(dir);
    if (parent === ".")
        throw new Error(`Could not find node_modules/mocha: ${log.join("\n")}`);
    return findMocha(parent, log);
}

const mochaDir = path.relative(__dirname, findMocha(__dirname));
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

async function run() {
    const parcel = spawn("parcel", ["serve", "mocha.html"]);
    parcel.stdout.pipe(process.stdout);
    parcel.stderr.pipe(process.stderr);

    const parcelStarted = new Promise((resolve, reject) => {
        parcel.on("exit", (code: number | null) => {
            if (code == 0) {
                resolve(code);
            } else {
                reject(code);
            }
        })
        parcel.stdout.on('data', (data: Buffer) => {
            const text = decoder.decode(data)
            if (text.startsWith("Server running at ")) {
                resolve(null)
            }
        });
    });
    const browser: Browser = await Puppeteer.launch.bind(Puppeteer)({headless: true, args: ['--no-sandbox']});

    try {
        const page = await browser.newPage();
        page.on("console", (message: any) => {
            (async () => {
                const args = await Promise.all(message.args().map((a: any) => a.jsonValue()));
                const log = (console as any)[message.type()];
                typeof log === 'function'
                    ? log(...args)
                    : console.log(...args);
            })();
        });

        await parcelStarted;
        await page.goto("http://localhost:1234", {waitUntil: 'load', timeout: 20000});

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
