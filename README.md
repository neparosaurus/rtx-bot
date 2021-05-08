# AMAZON BUYING BOT

### About

Amazon scraper built for purpose of buying RTX 3000 series graphic card on Amazon but can be used for any other product on Amazon.

### Usage

Run `node get_login_session.js` in order to get the session cookie.
Once authenticated you will have `session.json` file created in the root directory.

After that you can run `bot.js` 

Usage example:
`node bot.js --product-url=https://amazon.com/some-product --max-price=600 --timeout=1000 --timeout-randomness=800 --debug --test`

### Arguments

- `product-url` - Product url
- `timeout` - Default timeout (in milliseconds)
- `timeout-randomness` - Random offset added/deducted to/from timeout (in milliseconds)
- `max-price` - Maximum price limit
- `open-in-browser` **_(optional)_** - Open in default browser when product become available
- `test` **_(optional)_** - If set to true no checkout at the end
- `mute` **_(optional)_** - Mute all audio
- `debug` **_(optional)_** - Print debug messages in terminal
- `skip-assets` **_(optional)_** - Do not load images, fonts and html
- `no-logs` **_(optional)_** - Do not write to log file

### Environment variables

If mandatory arguments are not set, environment variables are used.

Rename `.env.sample` to `.env` and populate values.