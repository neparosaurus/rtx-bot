const puppeteer = require("puppeteer");
const dotenv = require('dotenv');
const config = dotenv.config();
const fs = require('fs');
const load = require('audio-loader');
const play = require('audio-play');
const args = require('minimist')(process.argv.slice(2));
const open = require('open');

const timeout = parseInt((typeof args['timeout'] !== 'undefined') ? args['timeout'] : process.env.TIMEOUT),
      timeout_randomness = parseInt((typeof args['timeout-randomness'] !== 'undefined') ? args['timeout-randomness'] : process.env.TIMEOUT_RANDOMNESS),
      max_price = parseFloat((typeof args['max-price'] !== 'undefined') ? args['max-price'] : process.env.MAX_PRICE),
      cookies = JSON.parse(fs.readFileSync(__dirname + '/session.json', 'utf8')),
      open_in_browser = typeof args['open-in-browser'] !== 'undefined',
      is_test = typeof args['test'] !== 'undefined',
      mute = typeof args['mute'] !== 'undefined',
      debug = typeof args['debug'] !== 'undefined',
      wait_selector_timeout = 4000,
      screenshot_dir = './screenshots/',
      zip_code = process.env.ZIP_CODE,
      pages = {
        cart: 'https://www.amazon.com/gp/add-to-cart/html/',
        checkout: 'https://www.amazon.com/gp/buy/spc/handlers/display.html',
        proceed_to_checkout: 'https://www.amazon.com/gp/cart/mobile/go-to-checkout.html',
        prime_trial: 'https://www.amazon.com/gp/buy/primeinterstitial/handlers/display.html'
      };

(async () => {
  const browser = await puppeteer.launch({headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox']}),
    page = await browser.newPage();

  let price,
    symbol,
    title,
    is_available,
    has_buying_options,
    has_buying_options_open,
    audio_buffer_win,
    audio_buffer_notification,
    audio_buffer_captcha,
    playback,
    counter = 0,
    cookie_updated = false,
    finished = false;

  // Check if product url is set
  if (typeof args['product-url'] === 'undefined') {
    log('Product url not set. Add --product-url to set product url.');
    await browser.close();
    return;
  }

  // Prevent images/css/fonts loading
  if (typeof args['skip-assets'] !== 'undefined') {
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      if (req.resourceType() === 'font' || req.resourceType() === 'image' || req.resourceType() === 'html') {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  // Configure player
  audio_buffer_notification = await load('./sounds/siren.wav');
  audio_buffer_win = await load('./sounds/Zivotjejednatombola.wav');
  audio_buffer_captcha = await load('./sounds/calculating.wav');
  playback = play(audio_buffer_notification, {
    start: 49
  });
  playback.pause();

  // Configure browser
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_4_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
  await page.setViewport({width: 375, height: 812});

  // Set user cookies if open_in_browser is not set
  if (!open_in_browser) {
    for (let i = 0; i < cookies.length; i++) {
      await page.setCookie(cookies[i]);
    }
  }

  await page.goto(args['product-url'], {
    waitUntil: 'domcontentloaded'
  });

  // Get title
  title = await page.evaluate(evaluateGetProductTitle);

  // Loop through requests
  while (!finished) {
    const page_url = page.url();
    const delay = getRandomDelay(timeout, timeout_randomness)

    // Print out some product info
    ++counter;
    if (counter % 20 === 0) {
      log(title + ' (' + args['product-url'] + ')', 'i');
      log('Max price: ' + max_price, 'i');
    }

    /**
     *  Product page
     */
    if (page_url.startsWith(args['product-url'])) {
      log('product page', 'd');

      // Check for buy now
      const has_buy_now = await page.evaluate(evaluateHasBuyNow);
      const has_buying_options = await page.evaluate(evaluateHasBuyingOptions);
      const is_captcha = await page.evaluate(evaluateIsCaptcha);

      // If has buy now button
      if (is_captcha) {
        playback.pause();
        playback = play(audio_buffer_captcha, {
          start: 1
        });
        playback.pause();
        playback.play();

        log('Enter CAPTCHA to continue', 'i');

        try {
          await page.waitForNavigation({
            timeout: 1800000
          });
        } catch (e) {
          log(e + ' (Reloading...)');

          await reloadPageWithNoCache(page);
        }
      }
      else if (has_buy_now) {
        [price, symbol] = await page.evaluate(evaluateGetPrice, '#newPitchPriceWrapper_feature_div .a-section:first-child', '#newOfferShippingMessage_feature_div .a-size-base'); // #newPitchPriceWrapper_feature_div

        // If price is ok, buy now
        if (price < max_price) {
          await page.click('#buy-now-button');

          try {
            await page.waitForSelector('#turbo-checkout-bottom-sheet-frame', {
              timeout: 3000
            });

            const iframe = (await page.$('#turbo-checkout-bottom-sheet-frame')).contentFrame();

            await (await iframe).waitForNavigation();
            await (await iframe).waitForSelector('#turbo-checkout-pyo-button', {
              timeout: wait_selector_timeout
            });

            if (!is_test) {
              await (await iframe).click('#turbo-checkout-pyo-button');
            }

            log('\n***************************\n***************************\n****** YOU DID IT !!!******\n***************************\n***************************', 's');
            finished = true;

            if (!mute) {
              playback.pause();
              playback = play(audio_buffer_win, {
                start: 1
              });
              playback.pause();
              playback.play();
            }

          } catch (e) {
            log(e);
            await page.waitForNavigation();
          }
        }
        else {
          log('Found overpriced at ' + symbol + '' + price + ' (Delay: ' + delay + 'ms) [1]', 'i');
          await page.waitForTimeout(delay);
          await reloadPageWithNoCache(page);
        }
      }
      // If has buying options
      else if (has_buying_options) {
        await page.click('a[title="See All Buying Options"]');

        try {
          await page.waitForSelector('#aod-offer-list', {
            timeout: wait_selector_timeout
          });
        }
        catch (e) {
          log(e);
          await page.waitForTimeout(delay);
          await reloadPageWithNoCache(page);
        }

        // Check if has buying options when options slide from right
        has_buying_options_open = await page.evaluate(evaluateHasBuyingOptionsWhenOpen);

        if (!has_buying_options_open) {
          log('Not available... No buying options found. (Delay: ' + delay + 'ms)');
        }
        else {
          [price, symbol] = await page.evaluate(evaluateGetPrice, '#aod-price-1 .a-offscreen', '#aod-bottlingDepositFee-1 + span');

          if (price < max_price) {
            const shippingMessage = await page.evaluate(evaluateShippingMessage);

            // If no shipping message, add product to cart
            if (shippingMessage === null) {
              log('Found at ' + price + ' (Delay: ' + delay + 'ms)', 'i')

              // Add to cart
              await page.click('#aod-offer-list > div:first-of-type [name="submit.addToCart"]');
              await page.waitForNavigation();
              continue;
            }

            log('Found at ' + symbol + '' + price + ' with error: ' + shippingMessage + ' (Delay: ' + delay + 'ms)', 'i')
          }
          else {
            log('Found overpriced at ' + symbol + price + ' (Delay: ' + delay + 'ms) [2]', 'i');
            await page.waitForTimeout(delay);
            await reloadPageWithNoCache(page);
          }
        }
      }
      else {
        log('Not available... (Delay: ' + delay + 'ms)');
        await page.waitForTimeout(delay);
        await reloadPageWithNoCache(page);
      }
    }

    /**
     *  Cart page
     */
    else if (page_url.startsWith(pages.cart)) {
      log('cart page', 'd');

      // Check if cart is empty
      const is_cart_empty = await page.evaluate(evaluateIsCartEmpty);

      if (is_cart_empty) {
        log('Not added to cart.');
        await reloadPageWithNoCache(page);
        continue;
      }

      // Proceed to checkout
      try {
        await page.waitForSelector('#sc-mini-buy-box [name="proceedToRetailCheckout"]', {
          timeout: wait_selector_timeout
        });
        await page.click('#sc-mini-buy-box [name="proceedToRetailCheckout"]');
      } catch (e) {
        log(e);
        await screenshot(page);
        await page.waitForNavigation();
      }
    }

    /**
     *  Checkout page
     */
    else if (page_url.startsWith(pages.checkout)) {
      log('checkout page', 'd');

      // Proceed to checkout
      try {
        const has_button_proceed_to_checkout = await page.evaluate(evaluateHasButtonProceedToCheckout);

        if (has_button_proceed_to_checkout) {
          await page.click('[data-feature-id="proceed-to-checkout-action"]');
          await page.waitForNavigation();
        }
      } catch (e) {
        log(e);
        await screenshot(page);
        await reloadPageWithNoCache(page);
        continue;
        // await page.waitForNavigation();
      }

      // Place your order
      if (!is_test) {
        try {
          await page.click('#placeYourOrder [value="Place your order"]');
          await page.waitForNavigation();
        } catch (e) {
          log(e);
          await reloadPageWithNoCache(page);
        }
      }

      log('\n***************************\n***************************\n****** YOU DID IT !!!******\n***************************\n***************************', 's');
      finished = true;

      if (!mute) {
        playback.pause();
        playback = play(audio_buffer_win, {
          start: 1
        });
        playback.pause();
        playback.play();
      }
    }

    /**
     *  Prime trial offer page
     */
    else if (page_url.startsWith(pages.prime_trial)) {
      log('prime trial page', 'd');

      try {
        await page.click('.prime-nothanks-button');
        await page.waitForNavigation();
      }
      catch (e) {
        await reloadPageWithNoCache(page);
      }
    }

    /**
     *  Proceed to checkout page
     */
    else if (page_url.startsWith(pages.proceed_to_checkout)) {
      log('proceed to checkout page', 'd');

      await page.waitForNavigation();
    }

    /**
     *  No match
     */
    else {
      log('No page match. ('+page_url+')', 'd');
      await screenshot(page);
      await reloadPageWithNoCache(page);
      // await page.waitForNavigation();
    }
  }

  // await browser.close();
})();


/**
 * Console log with colors
 *
 * @param message
 * @param message_type
 */
log = (message, message_type = '') => {
  const no_logs = typeof args['no-logs'] !== 'undefined'
  let color,
      debug_text = '';

  switch (message_type) {
    // Success
    case 's':
      color = '\x1b[1;32;42m';
      break;
    // Info
    case 'i':
      color = '\x1b[33m';
      break;
    // Debug (works only with --debug flag)
    case 'd':
      color = '\x1b[35m';
      debug_text = '[debug] ';
      break;
    // Default to error
    default:
      color = '\x1b[31m';
  }

  if (!debug && debug_text) {
    return;
  }

  // Print out in console
  message = '['+getTime()+'] '+message;
  console.log(color, debug_text+message+'\x1b[31m');

  if (debug_text) {
    return;
  }

  message += '\n';

  // Output to log file
  if (!no_logs) {
    fs.appendFile('./log', message, err => {
      if (err) {
        console.log('\x1b[31m', err + '\x1b[31m');
        return;
      }
    });
  }
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

screenshot = async (page) => {
  const time_now = new Date();
  const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
  await page.screenshot({
    path: error_filename
  });
}

reloadPageWithNoCache = async (page) => {
  await page.setCacheEnabled(false);
  await page.goto(args['product-url'], {
    waitUntil: 'domcontentloaded'
  });
}


/**
 * Evaluate functions
 */

evaluateUpdateLocation = async () => {
  try {
    document.querySelector('#GLUXZipUpdateInput').value = process.env.ZIP_CODE;
    return true;
  } catch (e) {
    return false;
  }
}

evaluateGetProductTitle = async () => {
  return document.querySelector('#title') !== null ? document.querySelector('#title').innerText : null
}

evaluateHasBuyNow = async () => {
  return document.querySelector('#buy-now-button') !== null
}

evaluateHasBuyingOptions = async () => {
  return document.querySelector('a[title="See All Buying Options"]') !== null
}

evaluateGetPrice = async (priceSelector, shippingSelector) => {
  const $price = document.querySelector(priceSelector);
  const $shipping = document.querySelector(shippingSelector);
  let price, shipping, currency;

  if (!$price) {
    return [];
  }

  price = parseInt($price.textContent.replace(/\D/g,'')) / 100;
  if ($shipping) {
    price += parseInt($shipping.textContent.replace(/\D/g,'')) / 100;
  }

  return (price) ? [
    price,
    $price.textContent.replace(/[\d,.\s]/g,'').trim()
  ] : [];
}

evaluateHasBuyingOptionsWhenOpen = async () => {
  return document.querySelector('#aod-offer-list > div') !== null
}

evaluateShippingMessage = async () => {
  const $message = document.querySelector('#delivery-message .a-color-error');

  return ($message !== null) ? $message.textContent.trim() : null;
}

evaluateIsCartEmpty = async () => {
  return document.querySelector('.sc-your-amazon-cart-is-empty') !== null
}

evaluateHasButtonProceedToCheckout = async () => {
  return document.querySelector('[data-feature-id="proceed-to-checkout-action"]') !== null
}

evaluateIsCaptcha = async () => {
  return document.querySelector('form[action="/errors/validateCaptcha"]') !== null
}