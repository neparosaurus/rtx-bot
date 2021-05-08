const puppeteer = require('puppeteer');
const fs = require('fs');

let address = {
  'default': 'https://www.amazon.com',
  'sign_in': 'https://www.betburger.com/users/sign_in',
  'sign_in_success': 'https://www.betburger.com/profile',
  'redirect_to': 'https://www.betburger.com/arbs'
};

(async () => {
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();
  const cookies = JSON.parse(fs.readFileSync(__dirname + '/session.json', 'utf8'));
  let is_logged_in = false;

  // Configure browser
  await page.setViewport({ width: 375, height: 812 });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_4_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
  await page.setDefaultNavigationTimeout(3600000);

  // Set cookies
  for (i = 0; i < cookies.length; i++) {
    await page.setCookie(cookies[i]);
  }

  // Go to login page
  await page.goto(address.default);

  // Wait for data
  await page.waitForSelector('#nav-logobar-greeting');

  // Click on sign in
  await page.click('#nav-logobar-greeting');

  // Wait for login success and redirect to bets page
  /*
  await Promise.all([
    page.click("button[type=submit]"),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  await page.goto(address.redirect_to);

  // Wait for data
  await page.waitForSelector('#leftArbList');
   */

  while (!is_logged_in) {
    await page.waitForNavigation();

    is_logged_in = await page.evaluate(evaluateIsLoggedIn);
  }

  // Get page cookies
  var page_cookies = await page.cookies(address.default);

  // Write session cookie to file
  if (typeof (page_cookies) != 'undefined') {
    console.log('Session cookie saved!');
    let jsonData = JSON.stringify(page_cookies);
    fs.writeFileSync('session.json', jsonData, 'utf8');
  } else {
    console.log('Page cookies undefined');
  }

  // Exit
  await browser.close();
})();

evaluateIsLoggedIn = async () => {
  return (location.hostname + location.pathname) === 'www.amazon.com/';
}