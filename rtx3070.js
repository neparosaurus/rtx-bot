const puppeteer = require("puppeteer");
const dotenv = require('dotenv');
const config = dotenv.config();

(async () => {
  const browser = await puppeteer.launch({headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox']});
  const page = await browser.newPage();
  const timeout = parseInt(process.env.TIMEOUT);
  const timeout_randomness = parseInt(process.env.TIMEOUT_RANDOMNESS);
  const max_price = parseFloat(process.env.MAX_PRICE);
  const product_url = process.env.PRODUCT_URL;
  let price, symbol;

  // Configure browser
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0');
  await page.setViewport({ width: 1440, height: 900 });

  while (true) {
    await page.goto(product_url);

    await page.waitForSelector('#addToCart');

    const delay = getRandomDelay(timeout, timeout_randomness);
    const is_available = await page.evaluate(evaluateIsAvailable);

    if (is_available) {
      // Check for price minimum
      [price, symbol] = await page.evaluate(evaluateGetPrice);

      if (price < max_price) {
        break;
      }

      log('Found overpriced at '+symbol+price+' (Delay: '+delay+'ms)', 'i');

    } else {
      log('Not available... (Delay: '+delay+'ms)');

      await page.waitForTimeout(delay);
    }
  }

  log('Found at '+symbol+price+'!', 's');

  // await browser.close();
})();

/**
 * Console log with colors
 *
 * @param message
 * @param message_type
 */
log = (message, message_type = null) => {
  let color;

  switch (message_type) {
    case 's':
      color = '\x1b[32m';
      break;
    case 'i':
      color = '\x1b[33m';
      break;
    default:
      color = '\x1b[31m';
  }

  console.log(color, '['+getTime()+'] '+message);
}

/**
 * @returns {string}
 */
getTime = () => {
  let date = new Date();
  let hours = date.getHours().toString().padStart(2, 0);
  let minutes = date.getMinutes().toString().padStart(2, 0);
  let seconds = date.getSeconds().toString().padStart(2, 0);

  return hours+':'+minutes+':'+seconds;
}

/**
 * @param timeout
 * @param deviation
 * @returns {number}
 */
getRandomDelay = (timeout, deviation) => {
  const min = Math.ceil(timeout - deviation);
  const max = Math.floor(timeout + deviation);

  return Math.floor(Math.random() * (max - min) + min);
}


/**
 * Evaluate functions
 */

evaluateIsAvailable = async () => {
  return document.querySelector('#buy-now-button') !== null
}

evaluateGetPrice = async () => {
  const $price = document.querySelector('#priceblock_ourprice');

  return ($price !== null) ? [
    parseInt($price.textContent.replace(/\D/g,'')) / 100,
    $price.textContent.replace(/\d./g,'')
  ] : [];
}