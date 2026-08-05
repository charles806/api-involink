// Shared nodemailer fake for auth route tests. Installed via the CJS require
// shim (auth.js uses `require('nodemailer')`), so the same instance is used by
// tests to inspect/reset the captured sendMail calls.

const __STATE__ = {
  calls: [],
  installed: false,
};

async function sendMailFn(opts) {
  __STATE__.calls.push(opts);
  return { messageId: 'test-id' };
}

function install() {
  if (__STATE__.installed) return;
  __STATE__.installed = true;
}

export const nodemailerFake = {
  createTransport: () => ({ sendMail: sendMailFn }),
};

export const nodemailerState = __STATE__;

export function resetNodemailer() {
  __STATE__.calls = [];
}

export { install as installNodemailerMock, sendMailFn };