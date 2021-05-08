const puppeteer = require("puppeteer");
const dotenv = require('dotenv');
const config = dotenv.config();
const fs = require('fs');
const load = require('audio-loader');
const play = require('audio-play');
const args = require('minimist')(process.argv.slice(2));
const open = require('open');

(async () => {
  const browser = await puppeteer.launch({headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox']}),
        page = await browser.newPage(),
        timeout = parseInt((typeof args['timeout'] !== 'undefined') ? args['timeout'] : process.env.TIMEOUT),
        timeout_randomness = parseInt((typeof args['timeout-randomness'] !== 'undefined') ? args['timeout-randomness'] : process.env.TIMEOUT_RANDOMNESS),
        max_price = parseFloat((typeof args['max-price'] !== 'undefined') ? args['max-price'] :  process.env.MAX_PRICE),
        cookies = JSON.parse(fs.readFileSync(__dirname + '/session.json', 'utf8')),
        open_in_browser = typeof args['open-in-browser'] !== 'undefined',
        is_test = typeof args['test'] !== 'undefined',
        mute = typeof args['mute'] !== 'undefined',
        wait_selector_timeout = 4000,
        screenshot_dir = './screenshots/',
        zip_code = process.env.ZIP_CODE;

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
    cookie_updated = false;

  // Check product url
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
  await page.setViewport({ width: 375, height: 812 });

  // Set cookies if open_in_browser is set
  /*
  if (!open_in_browser) {
    for (let i = 0; i < cookies.length; i++) {
      await page.setCookie(cookies[i]);
    }
  }
   */

  await page.goto(args['product-url'], {
    waitUntil: 'domcontentloaded'
  });

  // Update location
  if (open_in_browser && zip_code) {
    try {
      await page.waitForSelector('#nav-global-location-slot');
      await page.click('#nav-global-location-slot');
      await page.waitForSelector('#GLUXMobilePostalCodeLink a');
      await page.click('#GLUXMobilePostalCodeLink a');
      await page.waitForSelector('#GLUXZipUpdateInput');
      await page.evaluate(evaluateUpdateLocation);
      await page.click('#GLUXMobilePostalCodeSubmit');
      await page.waitForNavigation();
      log('Location updated.', 's');
    }
    catch (e) {
      log('Can\'t update location. ' + e);
    }
  }

  while (true) {
    try {
      ++counter;
      const delay = getRandomDelay(timeout, timeout_randomness);

      await page.waitForSelector('#buybox', {
        timeout: wait_selector_timeout
      });

      // Get title
      if (!title) {
        title = await page.evaluate(evaluateGetProductTitle);
      }

      if (counter % 20 === 0) {
        log(title + ' (' + args['product-url'] + ')', 'i');
        log('Max price: ' + max_price, 'i');
      }

      is_available = await page.evaluate(evaluateIsAvailable);

      // Is product available to buy
      if (is_available) {
        [price, symbol] = await page.evaluate(evaluateGetPrice, '#newPitchPriceWrapper_feature_div .a-section:first-child', '#newOfferShippingMessage_feature_div .a-size-base'); // #newPitchPriceWrapper_feature_div

        // If price is ok, break and add product to cart
        if (price < max_price) {
          if (!cookie_updated) {
            if (!open_in_browser) {
              for (let i = 0; i < cookies.length; i++) {
                await page.setCookie(cookies[i]);
              }
              log('Session cookie updated', 's');
            }
            cookie_updated = true;
            continue;
          }
          break;
        } else {
          log('Found overpriced at ' + symbol + '' + price + ' (Delay: ' + delay + 'ms)', 'i');
          await page.waitForTimeout(delay);
        }
      } else {
        has_buying_options = await page.evaluate(evaluateHasBuyingOptions);

        // If product has buying options instead of buy now
        if (has_buying_options) {
          await page.click('a[title="See All Buying Options"]');

          // waitForTimeout instead of waitForSelector
          // await page.waitForTimeout(4000);

          await page.waitForSelector('#aod-offer-list', {
            timeout: wait_selector_timeout
          });

          // Check if has buying options when options slide from right
          has_buying_options_open = await page.evaluate(evaluateHasBuyingOptionsWhenOpen);

          if (!has_buying_options_open) {
            log('Not available... No buying options found. (Delay: ' + delay + 'ms)');
          } else {
            /*
            if (!cookie_updated) {
              if (!open_in_browser) {
                for (let i = 0; i < cookies.length; i++) {
                  await page.setCookie(cookies[i]);
                }
              }
              cookie_updated = true;
              continue;
            }
             */

            [price, symbol] = await page.evaluate(evaluateGetPrice, '#aod-price-1 .a-offscreen', '#aod-bottlingDepositFee-1 + span');

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
          log('Not available... (Delay: ' + delay + 'ms)');
          await page.waitForTimeout(delay);
        }
      }

      await page.setCacheEnabled(false);
      await page.reload({
        waitUntil: 'domcontentloaded'
      });

    } catch (e) {
      // Check if captcha
      const is_captcha = await page.evaluate(evaluateIsCaptcha);

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

          await page.setCacheEnabled(false);
          await page.reload({
            waitUntil: 'domcontentloaded'
          });
        }
      }
      else if (e) {
        // Set cookies if open_in_browser is set
        if (!open_in_browser) {
          for (let i = 0; i < cookies.length; i++) {
            await page.setCookie(cookies[i]);
          }
          log('Session cookie updated', 's');
        }

        log(e + ' (Reloading...)');

        try {
          await page.setCacheEnabled(false);
          await page.reload({
            waitUntil: 'domcontentloaded'
          });
        }
        catch (e) {
          log(e + ' (Reloading...)');
        }
      }
      else {
        const delay = getRandomDelay(timeout, timeout_randomness);

        log(e + ' (Delay: ' + delay + 'ms)');

        try {
          await page.waitForTimeout(delay);
          await page.setCacheEnabled(false);
          await page.reload({
            waitUntil: 'domcontentloaded'
          });
        }
        catch (e) {
          log(e + ' (Reloading...)');
        }
      }
    }
  }

  // Product is available
  log('Found at '+symbol+price+'! ('+args['product-url']+')', 's');

  // Play sound notification
  if (!mute) {
    playback.play();
  }

  if (open_in_browser) {
    // Open product in default browser
    await open(args['product-url']);
  }
  else {
    let is_in_cart = false;

    // Try to buy product
    while (!is_in_cart) {
      const delay = getRandomDelay(timeout, timeout_randomness);

      if (is_available) {
        // Buy now
        await page.waitForTimeout(3000);
        await page.click('#buy-now-button');

        // Regular buy now
        try {
          await page.waitForSelector('#turbo-checkout-bottom-sheet-frame', {
            timeout: 3000
          });
        } catch (e) {
          if (page.url() !== args['product-url']) {
            // Select a shipping address page
            try {
              await page.waitForNavigation();
              await page.waitForSelector('#a-autoid-0-announce', {
                timeout: wait_selector_timeout
              });
              await page.click('#a-autoid-0-announce');
            } catch (e) {
              log(e);
              const time_now = new Date();
              const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
                await page.screenshot({
                path: error_filename
              });
            }

            // Choose your shipping options page
            try {
              await page.waitForNavigation();
              await page.waitForSelector('form .continue-button [type=submit]', {
                timeout: wait_selector_timeout
              });
              await page.click('form .continue-button [type=submit]');
            } catch (e) {
              log(e);
              const time_now = new Date();
              const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
              await page.screenshot({
                path: error_filename
              });
            }

            // Select a payment method
            try {
              await page.waitForNavigation();
              await page.waitForSelector('.pmts-credit-card-row:nth-of-type(2)', {
                timeout: wait_selector_timeout
              });
              await page.click('.pmts-credit-card-row:nth-of-type(2)');
              await page.waitForTimeout(500);

              await page.click('.pmts-select-payment-instrument-form input[type=submit]');
            } catch (e) {
              log(e);
              const time_now = new Date();
              const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
              await page.screenshot({
                path: error_filename
              });
            }

            // Place an order
            try {
              await page.waitForNavigation();
              await page.waitForSelector('#placeYourOrder input[type=submit]', {
                timeout: wait_selector_timeout
              });

              if (!is_test) {
                await page.click('#placeYourOrder input[type=submit]');
              }

              is_in_cart = true;
              log('\n***************************\n***************************\n****** YOU DID IT !!!******\n***************************\n***************************', 's');

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
              const time_now = new Date();
              const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
              await page.screenshot({
                path: error_filename
              });
            }
          } else {
            log(e);
            const time_now = new Date();
            const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
            await page.screenshot({
              path: error_filename
            });
          }
        }

        try {
          const iframe = (await page.$('#turbo-checkout-bottom-sheet-frame')).contentFrame();

          await (await iframe).waitForNavigation();
          await (await iframe).waitForSelector('#turbo-checkout-pyo-button', {
            timeout: wait_selector_timeout
          });

          if (!is_test) {
            await (await iframe).click('#turbo-checkout-pyo-button');
          }

          is_in_cart = true;
          log('\n***************************\n***************************\n****** YOU DID IT !!!******\n***************************\n***************************', 's');

          if (!mute) {
            playback.pause();
            playback = play(audio_buffer_win, {
              start: 1
            });
            playback.pause();
            playback.play();
          }

        } catch (e) {
          log(e+' (Delay: ' + delay + 'ms)');
          const time_now = new Date();
          const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
          await page.screenshot({
            path: error_filename
          });
          await page.waitForTimeout(delay);
        }

        // Check if has buying options
      } else if (has_buying_options_open) {
        // Add to cart
        await page.click('#aod-offer-list > div:first-of-type [name="submit.addToCart"]');

        // Cart page
        try {
          await page.waitForNavigation();

          const is_cart_empty = await page.evaluate(evaluateIsCartEmpty);

          if (is_cart_empty) {
            log('Not added to cart.');
            await page.setCacheEnabled(false);
            await page.reload({
              waitUntil: 'domcontentloaded'
            });
            continue;
          }

          await page.waitForSelector('#sc-mini-buy-box [name="proceedToRetailCheckout"]', {
            timeout: wait_selector_timeout
          });
          await page.click('#sc-mini-buy-box [name="proceedToRetailCheckout"]');
        } catch (e) {
          log(e);
          const time_now = new Date();
          const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
          await page.screenshot({
            path: error_filename
          });
        }

        // Select a shipping address page
        try {
          await page.waitForNavigation();
          await page.waitForSelector('#a-autoid-0-announce', {
            timeout: wait_selector_timeout
          });
          await page.click('#a-autoid-0-announce');
        } catch (e) {
          log(e);
          const time_now = new Date();
          const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
          await page.screenshot({
            path: error_filename
          });
        }

        // Choose your shipping options page
        try {
          await page.waitForNavigation();
          await page.waitForSelector('form .one-shipment.first-shipment .continue-button input[type=submit]', {
            timeout: wait_selector_timeout
          });
          await page.click('form .one-shipment.first-shipment .continue-button input[type=submit]');
          await page.waitForSelector('form .one-shipment:not(.first-shipment) .continue-button input[type=submit]', {
            timeout: wait_selector_timeout
          });
          await page.click('form .one-shipment:not(.first-shipment) .continue-button input[type=submit]');
        } catch (e) {
          log(e);
          const time_now = new Date();
          const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
          await page.screenshot({
            path: error_filename
          });
        }

        // Select a payment method
        try {
          await page.waitForNavigation();
          await page.waitForSelector('.pmts-credit-card-row:nth-of-type(2)', {
            timeout: wait_selector_timeout
          });
          await page.click('.pmts-credit-card-row:nth-of-type(2)');

          // Check if need to verify a credit card
          let need_to_verify = await page.evaluate(evaluateDoNeedToVerify);

          if (need_to_verify) {
            const validation_errors = await page.evaluate(evaluateEnterCreditCard, process.env.CREDIT_CARD.toString());
            if (!validation_errors) {
              await page.click('.pmts-credit-card-row:nth-of-type(2) .pmts-cc-address-challenge-form button');
              log('Credit card successfully verified', 's');
            } else {
              log('Credit card validation failed. ' + validation_errors);
            }
          }

          await page.click('.pmts-select-payment-instrument-form input[type=submit]');

          // Check if need to verify a credit card after submitting the form
          const validation_errors = await page.evaluate(evaluateEnterCreditCard, process.env.CREDIT_CARD.toString());
          if (!validation_errors) {
            await page.click('.pmts-credit-card-row:nth-of-type(2) .pmts-cc-address-challenge-form button');
            log('Credit card successfully verified', 's');

            await page.click('.pmts-select-payment-instrument-form input[type=submit]');
          } else {
            log('Credit card validation failed. ' + validation_errors);
          }
        } catch (e) {
          log(e);
          const time_now = new Date();
          const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
          await page.screenshot({
            path: error_filename
          });
        }

        // Place an order
        try {
          await page.waitForNavigation();
          await page.waitForSelector('#placeYourOrder input[type=submit]', {
            timeout: wait_selector_timeout
          });

          if (!is_test) {
            await page.click('#placeYourOrder input[type=submit]');
          }

          is_in_cart = true;
          log('\n***************************\n***************************\n****** YOU DID IT !!!******\n***************************\n***************************', 's');

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
          const time_now = new Date();
          const error_filename = screenshot_dir + 'error_' + time_now.getHours() + '-' + time_now.getMinutes() + '-' + time_now.getSeconds() + '.png';
          await page.screenshot({
            path: error_filename
          });
        }
      }
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
log = (message, message_type = null) => {
  const no_logs = typeof args['no-logs'] !== 'undefined'
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

  message = '['+getTime()+'] '+message;

  console.log(color, message+'\x1b[31m');

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

evaluateIsInCart = async () => {
  return document.querySelector('button[name="proceedToRetailCheckout"]') !== null
}

evaluateIsLoggedIn = async () => {
  return document.querySelector('#nav-switch-account') !== null
}

evaluateGetProductTitle = async () => {
  return document.querySelector('#title') !== null ? document.querySelector('#title').innerText : null
}

evaluateIsCaptcha = async () => {
  return document.querySelector('form[action="/errors/validateCaptcha"]') !== null
}

evaluateIsAvailable = async () => {
  return document.querySelector('#buy-now-button') !== null
}

evaluateIsShipping = async () => {
  return document.querySelector('#delivery-message .a-color-error') === null
}

evaluateHasBuyingOptions = async () => {
  return document.querySelector('a[title="See All Buying Options"]') !== null
}

evaluateHasBuyingOptionsWhenOpen = async () => {
  return document.querySelector('#aod-offer-list > div') !== null
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

evaluateShippingMessage = async () => {
  const $message = document.querySelector('#delivery-message .a-color-error');

  return ($message !== null) ? $message.textContent.trim() : null;
}

evaluateDoNeedToVerify = async () => {
  return document.querySelector('.pmts-credit-card-row:nth-of-type(2) .pmts-cc-address-challenge-form') !== null
}

evaluateEnterCreditCard = async (credit_card) => {
  try {
    const last_4 = credit_card.slice(-4);
    document.querySelector('.pmts-credit-card-row:nth-of-type(2) .pmts-cc-address-challenge-form input[placeholder="ending in '+last_4+'"]').value = credit_card;
    return null;
  } catch (e) {
    return e.toString();
  }
}

evaluateIsCartEmpty = async () => {
  return document.querySelector('.sc-your-amazon-cart-is-empty') !== null
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
