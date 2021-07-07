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

## Running in github actions

```yaml
name: Browser test
jobs:
  test-browser:
    runs-on: ubuntu-latest
    name: Browser test
    steps:
      - uses: actions/checkout@v1
      - name: Setup node
        uses: actions/setup-node@v1
        with:
          node-version: 15.x
          registry-url: https://registry.npmjs.org/
      - name: install
        run: yarn install
      - name: test
        uses: mujo-code/puppeteer-headful@12.3.1
        env:
          CI: 'true'
        with:
          args: yarn run browser-test-using-muppeteer
```