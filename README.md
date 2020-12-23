# http4t Muppeteer

* Generates a `mocha.html` file that imports all `*.test.ts` files under the
  working directory
* Uses [Parcel](https://parceljs.org) to bundle and serve `mocha.html`
* Uses [Puppeteer](https://github.com/puppeteer/puppeteer/) to call `mocha.run()`
  in Chrome headless and report back the results, failing on errors

## Usage

Add `mocha.html` to your `.gitignore` file.

`mocha.html` is regenerated for every run, but we don't clean it up afterwards,
because it is often useful to run `parcel serve mocha.html` to debug failures.

Add to `package.json`:

```json
{
  "scripts": {
    "test:browser": "muppeteer"
  },
  "devDependencies": {
    "@http4t/muppeteer": "1.0.0"
  }
}
```
