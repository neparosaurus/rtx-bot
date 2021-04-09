const puppeteer = require("puppeteer");
const dotenv = require('dotenv');
const config = dotenv.config();

(async () => {
  const browser = await puppeteer.launch({headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox']}),
        page = await browser.newPage(),
        timeout = parseInt(process.env.TIMEOUT),
        timeout_randomness = parseInt(process.env.TIMEOUT_RANDOMNESS),
        max_price = parseFloat(process.env.MAX_PRICE),
        product_url = process.env.PRODUCT_URL;

  let price,
    symbol,
    is_available,
    has_buying_options;

  // Configure browser
  // await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:87.0) Gecko/20100101 Firefox/87.0');
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_4_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 375, height: 812 });

  while (true) {
    await page.goto(product_url);
    await page.waitForSelector('#buybox');

    const delay = getRandomDelay(timeout, timeout_randomness);
    is_available = await page.evaluate(evaluateIsAvailable);

    // Is product available to buy
    if (is_available) {
      [price, symbol] = await page.evaluate(evaluateGetPrice, '#newPitchPriceWrapper_feature_div .a-section'); // #newPitchPriceWrapper_feature_div

      // If price is ok, break and add product to cart
      if (price < max_price) {
        break;
      }
      else {
        log('Found overpriced at '+symbol+''+price+' (Delay: '+delay+'ms)', 'i');
        await page.waitForTimeout(delay);
      }

    }
    else {
      has_buying_options = await page.evaluate(evaluateHasBuyingOptions);

      // If product has buying options instead of buy now
      if (has_buying_options) {
        await page.click('#buybox-see-all-buying-choices .a-button-text');
        await page.waitForSelector('#aod-offer-list');

        // Check if has buying options when options slide from right
        has_buying_options = await page.evaluate(evaluateHasBuyingOptionsWhenOpen);

        if (!has_buying_options) {
          log('Not available... (Delay: '+delay+'ms)');
        }
        else {
          [price, symbol] = await page.evaluate(evaluateGetPrice, '#aod-offer #aod-price-1 .a-offscreen');

          if (price < max_price) {
            const shippingMessage = await page.evaluate(evaluateShippingMessage);

            // If no shipping message, break and add product to cart
            if (shippingMessage === null) {
              break;
            }

            log('Found at ' + symbol + '' + price + ' with error: ' + shippingMessage + ' (Delay: ' + delay + 'ms)', 'i');
          } else {
            log('Found overpriced at ' + symbol + price + ' (Delay: ' + delay + 'ms)', 'i');
          }
        }

        await page.waitForTimeout(delay);

      } else {
        log('Not available... (Delay: '+delay+'ms)');
        await page.waitForTimeout(delay);
      }
    }
  }

  log('Found at '+symbol+price+'!', 's');

  // Buy product
  if (is_available) {
    // Buy now
    await page.click('#buy-now-button');
  } else if (has_buying_options) {
    // Add to cart
    await page.click('#aod-offer-list > div:first-of-type [name="submit.addToCart"]');
  }

  await page.waitForNavigation();
  await page.click('[name=data-feature-id="proceed-to-checkout-action"]');

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
 * Evaluate functions
 */

evaluateIsAvailable = async () => {
  return document.querySelector('#buy-now-button') !== null
}

evaluateIsShipping = async () => {
  return document.querySelector('#delivery-message') === null
}

evaluateHasBuyingOptions = async () => {
  return document.querySelector('#buybox-see-all-buying-choices') !== null
}

evaluateHasBuyingOptionsWhenOpen = async () => {
  return document.querySelector('#aod-offer-list > div') !== null
}

evaluateGetPrice = async (selector) => {
  const $price = document.querySelector(selector);

  return ($price !== null) ? [
    parseInt($price.textContent.replace(/\D/g,'')) / 100,
    $price.textContent.replace(/[\d,.\s]/g,'').trim()
  ] : [];
}

evaluateShippingMessage = async () => {
  const $message = document.querySelector('#delivery-message');

  return ($message !== null) ? $message.textContent.trim() : null;
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
  if (timeout < deviation) {
    deviation = timeout;
  }

  const min = Math.ceil(timeout - deviation);
  const max = Math.floor(timeout + deviation);

  return Math.floor(Math.random() * (max - min) + min);
}
