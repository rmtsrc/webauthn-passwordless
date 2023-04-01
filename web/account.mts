import { config } from './config.mjs';

const accountReq = await fetch(`${config.apiUrl}/account`, {
  credentials: 'include',
});
const accountDetails = await accountReq.json();
if (!accountDetails.email) {
  (window as Window).location = '/';
  throw new Error('Not logged in');
}

let loggedInAs = (document.querySelector('#loggedInAs') as HTMLSpanElement)?.innerText;
if (loggedInAs) loggedInAs = accountDetails.email;

let account: HTMLSelectElement | null = document.querySelector('#account');
if (account) account.style.visibility = 'visible';

document.querySelector('#logout')?.addEventListener('click', async (e) => {
  await fetch(`${config.apiUrl}/account/logout`, {
    credentials: 'include',
  });
  (window as Window).location = '/';
});
