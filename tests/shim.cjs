// CommonJS require shim so route files (`require('.../lib/supabase')`) can be
// faked in tests. Vitest does not intercept `require()`, so we patch Node's
// Module._load to redirect the resolved supabase module to a test double.

const Module = require('module');
const path = require('path');

const TARGET = path.resolve(__dirname, '../src/lib/supabase.js');
let fake = null;
let nodemailerFake = null;
let installed = false;

function installSupabaseMock(fakeModule) {
  fake = fakeModule;
  if (installed) return;
  installed = true;

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent && request) {
      try {
        const abs = Module._resolveFilename(request, parent, false);
        if (fake && abs === TARGET) {
          return fake;
        }
        if (nodemailerFake && request === 'nodemailer') {
          return nodemailerFake;
        }
      } catch (e) {
        /* resolve failure: fall through to original */
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function installNodemailerMock(fakeModule) {
  nodemailerFake = fakeModule;
}

module.exports = { installSupabaseMock, installNodemailerMock, getInstalled: () => installed };