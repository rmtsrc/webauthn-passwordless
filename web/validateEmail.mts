import { register } from './webauthn/register.mjs';

import { config } from './config.mjs';

const feedbackTxt = document.querySelector('#feedbackTxt') as HTMLParagraphElement;
const passphraseForm = document.querySelector('#passphraseForm') as HTMLInputElement;

const params = new URLSearchParams(window.location.search);

const registerDevice = async () => {
  (document.querySelector('.alert') as HTMLElement).style.display = 'flex';
  try {
    await register({ isExistingUser: true });
  } catch (err) {
    console.error(err);
  }
};

const validateEmail = async (passphrase?: string) => {
  try {
    const req = await fetch(`${config.apiUrl}/email/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: params.get('code'), passphrase }),
      credentials: 'include',
    });

    const res = await req.json();

    if (!req.ok) {
      throw new Error(`Failed: ${req.statusText} ${JSON.stringify(res, null, 2)}`);
    }

    if (params.has('registerDevice')) {
      if (res.requiresPassphrase && !res.jwtToken) {
        passphraseForm.style.display = 'block';
      } else {
        await registerDevice();
        (window as Window).location = 'account.html';
      }
    } else if (res.jwtToken) {
      (window as Window).location = 'account.html';
    }
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }

    if (err.message.includes('code not found')) {
      feedbackTxt.innerText =
        'Verification code not found, has expired or you email has already been confirmed.';
    } else if (err.message.includes('Invalid passphrase')) {
      feedbackTxt.innerText = 'Invalid passphrase.';
    } else {
      feedbackTxt.innerText = 'There was an error while trying validate your account.';
    }
    throw err;
  }
};

passphraseForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const passphrase = (document.querySelector('#passphrase') as HTMLInputElement | null)?.value;
  await validateEmail(passphrase);
});

validateEmail();
