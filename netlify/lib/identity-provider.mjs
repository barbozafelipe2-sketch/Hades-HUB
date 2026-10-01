import {
  getUser as sdkGetUser,
  getIdentityConfig as sdkGetIdentityConfig,
  login as sdkLogin,
  signup as sdkSignup,
  confirmEmail as sdkConfirmEmail,
  logout as sdkLogout,
  verifyRequestOrigin as sdkVerifyRequestOrigin,
} from '@netlify/identity';
import { isNetlifyRuntime } from './env.mjs';

const productionAdapter=Object.freeze({
  getUser:sdkGetUser,
  getIdentityConfig:sdkGetIdentityConfig,
  login:sdkLogin,
  signup:sdkSignup,
  confirmEmail:sdkConfirmEmail,
  logout:sdkLogout,
  verifyRequestOrigin:sdkVerifyRequestOrigin,
});
let testAdapter=null;

function active(){ return testAdapter||productionAdapter; }
function fn(name){
  const value=active()?.[name];
  if(typeof value!=='function') throw new Error(`IDENTITY_ADAPTER_MISSING:${name}`);
  return value;
}

export function getIdentityConfig(...args){ return fn('getIdentityConfig')(...args); }
export async function getIdentityUser(...args){ return await fn('getUser')(...args); }
export async function identityLogin(...args){ return await fn('login')(...args); }
export async function identitySignup(...args){ return await fn('signup')(...args); }
export async function identityConfirmEmail(...args){ return await fn('confirmEmail')(...args); }
export async function identityLogout(...args){ return await fn('logout')(...args); }
export function verifyIdentityRequestOrigin(...args){ return fn('verifyRequestOrigin')(...args); }

// Unit-test seam only. Hosted Netlify runtimes may never replace the official SDK adapter.
export function setIdentityAdapterForTests(adapter){
  if(isNetlifyRuntime()) throw new Error('IDENTITY_TEST_ADAPTER_FORBIDDEN');
  if(!adapter || typeof adapter!=='object') throw new Error('IDENTITY_TEST_ADAPTER_INVALID');
  testAdapter=adapter;
}
export function resetIdentityAdapterForTests(){
  if(isNetlifyRuntime()) throw new Error('IDENTITY_TEST_ADAPTER_FORBIDDEN');
  testAdapter=null;
}
